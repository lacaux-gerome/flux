import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeSchedule,
  draftProblem,
  dueSlot,
  jobArgs,
  jobPrompt,
  matchSkills,
  mcpLabel,
  nextRun,
  whenLabel,
  type Job,
  type JobDraft,
  type JobSchedule,
} from '../src/shared/jobs'
import { parseMcpInit, skillInfo } from '../src/main/jobs/catalog'
import { JobScheduler, type JobDeps } from '../src/main/jobs/scheduler'

// 17 November 2026 is a Tuesday; local time, as the schedule reads it
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)
const WEEKDAYS: JobSchedule = { repeat: 'daily', days: [1, 2, 3, 4, 5], time: '09:00' }

const draft = (overrides: Partial<JobDraft> = {}): JobDraft => ({
  name: 'Daily du matin',
  enabled: true,
  schedule: WEEKDAYS,
  skill: 'gl_daily',
  prompt: '',
  mcps: ['plugin:linear:linear'],
  cwd: '/tmp',
  permission: 'auto',
  ...overrides,
})

const job = (overrides: Partial<JobDraft> = {}): Job => ({ ...draft(overrides), id: 'daily', createdAt: at(16, 8).toISOString() })

describe('horaires des jobs', () => {
  it('trouve le prochain passage, jamais l’instant même', () => {
    expect(nextRun(WEEKDAYS, at(17, 8))).toEqual(at(17, 9))
    expect(nextRun(WEEKDAYS, at(17, 9))).toEqual(at(18, 9))
    // Friday after the run: Monday
    expect(nextRun(WEEKDAYS, at(20, 10))).toEqual(at(23, 9))
    expect(nextRun({ repeat: 'hourly', days: [], time: '00:15' }, at(17, 10, 20))).toEqual(at(17, 11, 15))
    expect(nextRun({ repeat: 'manual', days: [], time: '09:00' }, at(17, 8))).toBeNull()
  })

  it('ne garde que le dernier passage dû, même après un week-end fermé', () => {
    expect(dueSlot(WEEKDAYS, at(16, 10), at(17, 9, 1))).toEqual(at(17, 9))
    expect(dueSlot(WEEKDAYS, at(17, 9), at(17, 12))).toBeNull()
    expect(dueSlot(WEEKDAYS, at(20, 10), at(23, 11))).toEqual(at(23, 9))
  })

  it('dit la récurrence et le moment comme on les lit', () => {
    expect(describeSchedule(WEEKDAYS)).toBe('Du lundi au vendredi à 9:00')
    expect(describeSchedule({ repeat: 'daily', days: [0, 1, 2, 3, 4, 5, 6], time: '08:30' })).toBe('Tous les jours à 8:30')
    expect(describeSchedule({ repeat: 'daily', days: [1], time: '10:00' })).toBe('Chaque lundi à 10:00')
    expect(describeSchedule({ repeat: 'daily', days: [5, 1, 3], time: '09:00' })).toBe('Lun, mer, ven à 9:00')
    expect(describeSchedule({ repeat: 'daily', days: [6, 0], time: '09:00' })).toBe('Le week-end à 9:00')
    expect(describeSchedule({ repeat: 'hourly', days: [], time: '00:15' })).toBe('Toutes les heures à :15')
    expect(describeSchedule({ repeat: 'manual', days: [], time: '09:00' })).toBe('À la demande')
    expect(whenLabel(at(17, 14), at(17, 9))).toBe('aujourd’hui 14:00')
    expect(whenLabel(at(18, 9), at(17, 9))).toBe('demain 9:00')
    expect(whenLabel(at(20, 9), at(17, 9))).toBe('ven. 9:00')
  })
})

describe('lancement d’un job', () => {
  it('appelle la skill avec le prompt pour arguments, ou le prompt seul', () => {
    expect(jobPrompt({ skill: 'gl_daily', prompt: '' })).toBe('/gl_daily')
    expect(jobPrompt({ skill: '/gl_jump_in', prompt: ' OFF-917 ' })).toBe('/gl_jump_in OFF-917')
    expect(jobPrompt({ skill: null, prompt: 'Résume mes PR' })).toBe('Résume mes PR')
  })

  it('n’autorise que les MCP choisis et refuse tous les autres', () => {
    const servers = ['plugin:linear:linear', 'claude.ai Notion', 'sentry', 'plugin:slack:slack']
    const args = jobArgs(job({ mcps: ['plugin:linear:linear', 'claude.ai Notion'] }), servers, 'session-1')
    const value = (flag: string) => args[args.indexOf(flag) + 1]
    expect(value('--session-id')).toBe('session-1')
    expect(value('--allowedTools')).toBe('mcp__plugin_linear_linear,mcp__claude_ai_Notion')
    expect(value('--disallowedTools')).toBe('mcp__sentry,mcp__plugin_slack_slack')
    expect(value('--permission-mode')).toBe('auto')
    const strict = jobArgs(job({ mcps: [], permission: 'strict' }), ['sentry'], 'session-2')
    expect(strict).not.toContain('--allowedTools')
    expect(strict[strict.indexOf('--permission-mode') + 1]).toBe('dontAsk')
  })

  it('lit les serveurs que la run charge vraiment, sous le nom de leurs outils', () => {
    const init = {
      type: 'system',
      subtype: 'init',
      mcp_servers: [
        { name: 'claude.ai Linear', status: 'connected', source: 'claudeai' },
        { name: 'amplitude', status: 'pending', source: 'user' },
        { name: 'plugin:design-to-code:figma', status: 'needs-auth', source: 'plugin' },
        { name: 'postgres', status: 'failed', source: 'user' },
        { name: 'old', status: 'disabled', source: 'user' },
      ],
    }
    const output = [JSON.stringify({ type: 'system', subtype: 'hook_started' }), JSON.stringify(init), 'not json'].join('\n')
    expect(parseMcpInit(output)).toEqual([
      { name: 'claude.ai Linear', status: 'ok' },
      { name: 'amplitude', status: 'ok' },
      { name: 'plugin:design-to-code:figma', status: 'auth' },
      { name: 'postgres', status: 'failed' },
    ])
    expect(parseMcpInit('{"type":"result"}')).toBeNull()
    expect(mcpLabel('claude.ai Notion')).toBe('Notion')
    expect(mcpLabel('plugin:linear:linear')).toBe('Linear')
    expect(mcpLabel('amplitude')).toBe('Amplitude')
    expect(mcpLabel('plugin:design-to-code:figma')).toBe('Figma · design-to-code')
  })

  it('lit le nom et ce que fait une skill, d’un frontmatter plié ou de sa première ligne', () => {
    const folded = '---\nname: design-taste\ndescription: >-\n  Builds sites\n  with taste.\n---\n# Title\n'
    expect(skillInfo(folded, 'dir')).toEqual({ name: 'design-taste', description: 'Builds sites with taste.' })
    expect(skillInfo('Daily en **lecture seule**.\n\nSuite', 'gl_daily')).toEqual({
      name: 'gl_daily',
      description: 'Daily en lecture seule.',
    })
  })

  it('dit ce qui manque avant d’enregistrer', () => {
    expect(draftProblem(draft())).toBeNull()
    expect(draftProblem(draft({ name: ' ' }))).toBe('Donne un nom à la tâche.')
    expect(draftProblem(draft({ skill: null, prompt: '' }))).toBe('Écris le prompt.')
    expect(draftProblem(draft({ schedule: { ...WEEKDAYS, days: [] } }))).toBe('Choisis au moins un jour.')
  })

  it('filtre les skills par leur nom d’abord, puis par ce qu’elles font', () => {
    const skills = [
      { name: 'gl_daily', description: 'Daily en lecture seule.' },
      { name: 'gl_commit', description: 'Crée des commits propres.' },
      { name: 'commit-commands:commit', description: 'Create a git commit' },
      { name: 'gl_jump_in', description: 'Génère un document jump-in à partir d’un cadrage.' },
    ]
    expect(matchSkills(skills, '')).toBe(skills)
    expect(matchSkills(skills, ' /COMMIT').map(skill => skill.name)).toEqual(['gl_commit', 'commit-commands:commit'])
    expect(matchSkills(skills, 'lecture').map(skill => skill.name)).toEqual(['gl_daily'])
    expect(matchSkills(skills, 'gl_').map(skill => skill.name)).toEqual(['gl_daily', 'gl_commit', 'gl_jump_in'])
    expect(matchSkills(skills, 'cadrage jump')).toEqual([])
  })
})

describe('planificateur', () => {
  const schedulers: JobScheduler[] = []
  afterEach(() => schedulers.splice(0).forEach(scheduler => scheduler.stop()))

  async function setup(start: Date, launch: JobDeps['launch']) {
    const file = join(await mkdtemp(join(tmpdir(), 'flux-jobs-')), 'jobs.json')
    const clock = { now: start }
    const deps: JobDeps = {
      launch,
      listMcps: vi.fn(async () => [
        { name: 'plugin:linear:linear', status: 'ok' as const },
        { name: 'sentry', status: 'ok' as const },
      ]),
      listSkills: async () => [],
      daily: async () => null,
      defaultCwd: '/tmp',
      onChange: () => undefined,
      onFinish: vi.fn(),
    }
    const scheduler = new JobScheduler(file, deps, () => clock.now)
    schedulers.push(scheduler)
    return { file, clock, deps, scheduler }
  }

  it('lance un job à son heure, une seule fois, avec ses MCP', async () => {
    const launch = vi.fn<JobDeps['launch']>(async () => ({ ok: true, summary: 'Fait', costUsd: 0.12 }))
    const { clock, deps, scheduler } = await setup(at(17, 8, 59), launch)
    const saved = await scheduler.save(null, draft())
    expect(saved.id).toBe('daily-du-matin')

    await scheduler.tick()
    expect(launch).not.toHaveBeenCalled()

    clock.now = at(17, 9, 1)
    await scheduler.tick()
    await scheduler.tick()
    await vi.waitFor(() => expect(deps.onFinish).toHaveBeenCalledTimes(1))
    expect(scheduler.board().jobs[0].runs[0].status).toBe('ok')
    expect(launch).toHaveBeenCalledTimes(1)
    const [, prompt, args] = launch.mock.calls[0]
    expect(prompt).toBe('/gl_daily')
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('mcp__sentry')
    expect(deps.listMcps).toHaveBeenLastCalledWith('/tmp')
    expect(scheduler.board().jobs[0].next).toBe(at(18, 9).toISOString())
  })

  it('laisse passer un créneau manqué depuis plus de douze heures', async () => {
    const launch = vi.fn<JobDeps['launch']>(async () => ({ ok: true, summary: null, costUsd: null }))
    const { clock, scheduler } = await setup(at(17, 8), launch)
    await scheduler.save(null, draft())
    clock.now = at(17, 22)
    await scheduler.tick()
    clock.now = at(17, 23)
    await scheduler.tick()
    expect(launch).not.toHaveBeenCalled()
  })

  it('ne relance pas un job qui tourne déjà', async () => {
    let finish: () => void = () => undefined
    const launch = vi.fn<JobDeps['launch']>(
      () => new Promise(resolve => (finish = () => resolve({ ok: true, summary: null, costUsd: null }))),
    )
    const { scheduler } = await setup(at(17, 8), launch)
    const saved = await scheduler.save(null, draft({ schedule: { repeat: 'manual', days: [], time: '09:00' } }))
    await scheduler.runNow(saved.id)
    await expect(scheduler.runNow(saved.id)).rejects.toThrow('Cette tâche tourne déjà.')
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1))
    finish()
    await vi.waitFor(() => expect(scheduler.board().jobs[0].runs[0]?.status).toBe('ok'))
  })

  it('marque interrompue une exécution que Flux a quittée en route', async () => {
    const launch = vi.fn<JobDeps['launch']>()
    const { file, scheduler } = await setup(at(17, 8), launch)
    const running = {
      session: 's',
      jobId: 'daily',
      trigger: 'schedule',
      startedAt: at(17, 7).toISOString(),
      endedAt: null,
      status: 'running',
      summary: null,
      costUsd: null,
    }
    await writeFile(file, JSON.stringify({ jobs: [job()], runs: [running], slots: { daily: at(17, 7).toISOString() } }))
    await scheduler.start()
    expect(scheduler.board().jobs[0].runs[0].status).toBe('interrupted')
    expect(JSON.parse(await readFile(file, 'utf8')).runs[0].status).toBe('interrupted')
  })
})
