import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import {
  CATCH_UP_MS,
  draftProblem,
  dueSlot,
  jobArgs,
  jobPrompt,
  nextRun,
  parseTime,
  type Job,
  type JobBoard,
  type JobDraft,
  type JobRun,
  type McpServer,
  type SkillOption,
} from '../../shared/jobs'
import { claudeEnv } from '../llm/claude'
import { BIN } from '../paths'

const TICK_MS = 30_000
const RUNS_KEPT = 10
const RUNS_SHOWN = 5
// The list the form offers; each run asks again in its own folder
const MCPS_STALE_MS = 10 * 60_000
const JOB_TIMEOUT_MS = 45 * 60_000
const SUMMARY_MAX = 280

interface JobsState {
  jobs: Job[]
  runs: JobRun[]
  // The last slot each job ran for, or let pass
  slots: Record<string, string>
  mcps: { at: string | null; servers: McpServer[] }
}

export interface RunOutcome {
  ok: boolean
  summary: string | null
  costUsd: number | null
}

export interface JobDeps {
  // Runs claude to the end; the signal stops it
  launch(job: Job, prompt: string, args: string[], signal: AbortSignal): Promise<RunOutcome>
  // The servers a run started in this folder would load
  listMcps(cwd: string): Promise<McpServer[]>
  listSkills(): Promise<SkillOption[]>
  defaultCwd: string
  onChange(board: JobBoard): void
  onFinish(job: Job, run: JobRun): void
}

function summaryOf(text: string | undefined): string | null {
  const plain = (text ?? '').replace(/[*`#>_]/g, '').replace(/\s+/g, ' ').trim()
  if (!plain) return null
  return plain.length > SUMMARY_MAX ? `${plain.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : plain
}

// The run is a real Claude session, kept so that it reopens in Desktop
export async function launchClaude(job: Job, prompt: string, args: string[], signal: AbortSignal): Promise<RunOutcome> {
  if (!existsSync(job.cwd)) throw new Error(`Dossier introuvable : ${job.cwd}`)
  const env = await claudeEnv()
  return new Promise((resolve, reject) => {
    const child = execFile(
      BIN.claude,
      args,
      { cwd: job.cwd, env, timeout: JOB_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, signal },
      (error, stdout, stderr) => {
        let payload: { result?: string; subtype?: string; is_error?: boolean; total_cost_usd?: number } | null = null
        try {
          payload = JSON.parse(stdout)
        } catch {
          payload = null
        }
        if (payload) {
          resolve({
            ok: !error && payload.is_error !== true,
            summary: summaryOf(payload.result ?? payload.subtype),
            costUsd: payload.total_cost_usd ?? null,
          })
        } else if (error) {
          reject(new Error((stderr.trim() || error.message).split('\n')[0]))
        } else {
          resolve({ ok: true, summary: summaryOf(stdout), costUsd: null })
        }
      },
    )
    child.stdin?.end(prompt)
  })
}

function slug(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'job'
  let id = base
  for (let index = 2; taken.has(id); index++) id = `${base}-${index}`
  return id
}

function normalize(draft: JobDraft): JobDraft {
  const [hour, minute] = parseTime(draft.schedule.time)
  const skill = draft.skill?.trim().replace(/^\//, '') ?? null
  return {
    name: draft.name.trim(),
    enabled: draft.enabled,
    schedule: {
      repeat: draft.schedule.repeat,
      days: [...new Set(draft.schedule.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort(),
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    },
    skill,
    prompt: draft.prompt.trim(),
    mcps: [...new Set(draft.mcps)],
    cwd: draft.cwd.trim(),
    permission: draft.permission === 'strict' ? 'strict' : 'auto',
  }
}

const sameSchedule = (a: Job['schedule'], b: Job['schedule']) => JSON.stringify(a) === JSON.stringify(b)

export class JobScheduler {
  private state: JobsState = { jobs: [], runs: [], slots: {}, mcps: { at: null, servers: [] } }
  private skills: SkillOption[] = []
  private live = new Map<string, AbortController>()
  private mcpsLoading: Promise<void> | null = null
  private writing: Promise<void> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly file: string,
    private readonly deps: JobDeps,
    private readonly now = () => new Date(),
  ) {}

  async start(): Promise<void> {
    await this.load()
    // A run Flux was in when it quit has no end to wait for
    const stopped = this.state.runs.filter(run => run.status === 'running')
    for (const run of stopped) {
      run.status = 'interrupted'
      run.endedAt = run.endedAt ?? this.now().toISOString()
    }
    if (stopped.length > 0) await this.persist()
    this.skills = await this.deps.listSkills().catch(() => [])
    this.emit()
    void this.refreshMcps(false).catch(() => undefined)
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    await this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    for (const controller of this.live.values()) controller.abort()
  }

  board(): JobBoard {
    const now = this.now()
    const newest = (a: JobRun, b: JobRun) => b.startedAt.localeCompare(a.startedAt)
    return {
      jobs: this.state.jobs.map(job => ({
        job,
        next: job.enabled ? (nextRun(job.schedule, now)?.toISOString() ?? null) : null,
        runs: this.state.runs
          .filter(run => run.jobId === job.id)
          .sort(newest)
          .slice(0, RUNS_SHOWN),
      })),
      mcps: this.state.mcps.servers,
      mcpsAt: this.state.mcps.at,
      mcpsLoading: this.mcpsLoading !== null,
      skills: this.skills,
      defaultCwd: this.deps.defaultCwd,
    }
  }

  // What the tab shows on opening: skills read again, servers asked again once stale
  async snapshot(): Promise<JobBoard> {
    this.skills = await this.deps.listSkills().catch(() => this.skills)
    void this.refreshMcps(false).catch(() => undefined)
    return this.board()
  }

  refreshMcps(force: boolean): Promise<void> {
    const at = this.state.mcps.at
    if (!force && at && this.now().getTime() - Date.parse(at) < MCPS_STALE_MS) return Promise.resolve()
    if (this.mcpsLoading) return this.mcpsLoading
    this.mcpsLoading = (async () => {
      try {
        const servers = await this.deps.listMcps(this.deps.defaultCwd)
        this.state.mcps = { at: this.now().toISOString(), servers }
        await this.persist()
      } finally {
        this.mcpsLoading = null
        this.emit()
      }
    })()
    this.emit()
    return this.mcpsLoading
  }

  async save(id: string | null, draft: JobDraft): Promise<Job> {
    const problem = draftProblem(draft)
    if (problem) throw new Error(problem)
    const clean = normalize(draft)
    const now = this.now().toISOString()
    const existing = id === null ? undefined : this.state.jobs.find(job => job.id === id)
    if (id !== null && !existing) throw new Error('Ce job n’existe plus.')
    const job: Job = existing
      ? { ...existing, ...clean }
      : { ...clean, id: slug(clean.name, new Set(this.state.jobs.map(entry => entry.id))), createdAt: now }
    // A new schedule counts from now: what it would have run before is not run late
    if (!existing || !sameSchedule(existing.schedule, job.schedule) || (job.enabled && !existing.enabled)) {
      this.state.slots[job.id] = now
    }
    this.state.jobs = existing
      ? this.state.jobs.map(entry => (entry.id === job.id ? job : entry))
      : [...this.state.jobs, job]
    await this.persist()
    this.emit()
    return job
  }

  async remove(id: string): Promise<void> {
    this.live.get(id)?.abort()
    this.state.jobs = this.state.jobs.filter(job => job.id !== id)
    this.state.runs = this.state.runs.filter(run => run.jobId !== id)
    delete this.state.slots[id]
    await this.persist()
    this.emit()
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const job = this.state.jobs.find(entry => entry.id === id)
    if (!job || job.enabled === enabled) return
    job.enabled = enabled
    // Back from a pause, what passed meanwhile stays passed
    if (enabled) this.state.slots[id] = this.now().toISOString()
    await this.persist()
    this.emit()
  }

  // Resolves once the run has started, not when it ends
  async runNow(id: string): Promise<void> {
    const job = this.state.jobs.find(entry => entry.id === id)
    if (!job) throw new Error('Ce job n’existe plus.')
    if (this.live.has(id)) throw new Error('Ce job tourne déjà.')
    void this.execute(job, 'manual')
  }

  async tick(): Promise<void> {
    const now = this.now()
    let changed = false
    for (const job of this.state.jobs) {
      if (!job.enabled || job.schedule.repeat === 'manual' || this.live.has(job.id)) continue
      const slot = dueSlot(job.schedule, new Date(this.state.slots[job.id] ?? job.createdAt), now)
      if (!slot) continue
      this.state.slots[job.id] = slot.toISOString()
      changed = true
      // Flux was closed: a slot missed long ago is let pass, the next one will come
      if (now.getTime() - slot.getTime() <= CATCH_UP_MS) void this.execute(job, 'schedule')
    }
    if (changed) await this.persist()
  }

  private async execute(job: Job, trigger: JobRun['trigger']): Promise<void> {
    const controller = new AbortController()
    this.live.set(job.id, controller)
    const run: JobRun = {
      session: randomUUID(),
      jobId: job.id,
      trigger,
      startedAt: this.now().toISOString(),
      endedAt: null,
      status: 'running',
      summary: null,
      costUsd: null,
    }
    this.state.runs.push(run)
    const mine = this.state.runs.filter(entry => entry.jobId === job.id)
    if (mine.length > RUNS_KEPT) {
      const dropped = new Set(mine.slice(0, mine.length - RUNS_KEPT))
      this.state.runs = this.state.runs.filter(entry => !dropped.has(entry))
    }
    await this.persist()
    this.emit()
    try {
      // Every server the job does not name is refused, so the run first asks which ones it would load
      const servers = await this.deps.listMcps(job.cwd).then(
        list => list.map(server => server.name),
        error => {
          throw new Error(`Flux ne sait pas quels MCP refuser : ${(error as Error).message}`)
        },
      )
      const outcome = await this.deps.launch(job, jobPrompt(job), jobArgs(job, servers, run.session), controller.signal)
      run.status = outcome.ok ? 'ok' : 'failed'
      run.summary = outcome.summary
      run.costUsd = outcome.costUsd
    } catch (error) {
      run.status = controller.signal.aborted ? 'interrupted' : 'failed'
      run.summary = (error as Error).message
    } finally {
      run.endedAt = this.now().toISOString()
      this.live.delete(job.id)
    }
    await this.persist()
    this.emit()
    if (run.status !== 'interrupted') this.deps.onFinish(job, run)
  }

  private emit(): void {
    this.deps.onChange(this.board())
  }

  private async load(): Promise<void> {
    const raw = await readFile(this.file, 'utf8').catch(() => null)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Partial<JobsState>
      this.state = {
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        slots: parsed.slots && typeof parsed.slots === 'object' ? parsed.slots : {},
        mcps: parsed.mcps?.servers ? parsed.mcps : { at: null, servers: [] },
      }
    } catch {
      // An unreadable file starts over rather than block Flux
    }
  }

  // Writes one after the other, each of the whole state
  private persist(): Promise<void> {
    const content = JSON.stringify(this.state, null, 2)
    // A failed write does not hold back the next one
    this.writing = this.writing.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      await writeFile(temporary, content, { mode: 0o600 })
      await rename(temporary, this.file)
    })
    return this.writing
  }
}
