// Claude jobs that Flux runs itself, on a schedule or on demand. Each one is a prompt or a skill,
// with the MCP servers it may use. Claude Desktop cannot be handed a task from outside, and does not
// limit MCP servers per task, so Flux runs them through the claude CLI. Each run is a Claude session
// that reopens in Desktop.

import { serviceOf } from './skillGraph'

export type JobRepeat = 'manual' | 'hourly' | 'daily'

// Auto lets the classifier decide; strict refuses anything your settings do not already allow
export type JobPermission = 'auto' | 'strict'

export interface JobSchedule {
  repeat: JobRepeat
  // The days a daily job runs, 0 for Sunday
  days: number[]
  // HH:MM; an hourly job only keeps the minutes
  time: string
}

export interface JobDraft {
  name: string
  enabled: boolean
  schedule: JobSchedule
  // A skill runs as /skill with the prompt as its arguments; without one, the prompt runs alone
  skill: string | null
  prompt: string
  // The MCP servers the job may use; every other one is refused
  mcps: string[]
  cwd: string
  permission: JobPermission
}

export interface Job extends JobDraft {
  id: string
  createdAt: string
}

export type JobRunStatus = 'running' | 'ok' | 'failed' | 'interrupted'

export interface JobRun {
  // The run's Claude session, which reopens it in Desktop
  session: string
  jobId: string
  trigger: 'schedule' | 'manual'
  startedAt: string
  endedAt: string | null
  status: JobRunStatus
  // The start of the run's last answer, or why it failed
  summary: string | null
  costUsd: number | null
}

export interface JobView {
  job: Job
  next: string | null
  // Newest first
  runs: JobRun[]
}

// As a run reports it: connected, waiting for a sign-in, or out of reach
export type McpStatus = 'ok' | 'auth' | 'failed'

export interface McpServer {
  name: string
  status: McpStatus
}

export interface SkillOption {
  name: string
  description: string
  // The services it reaches through MCP, read from its text: Linear, Sentry…
  services: string[]
}

// Flux's own daily, which runs the daily command each workday morning on its own schedule, apart
// from the jobs: it lives in the settings (dailyTime) and in the config (paths.dailyCommand)
export interface DailyTask {
  // The command as /name calls it
  skill: string
  file: string
  exists: boolean
  time: string
  next: string | null
  // The days it wrote, newest first
  runs: Array<{ date: string; at: string | null }>
}

export interface JobBoard {
  jobs: JobView[]
  daily: DailyTask | null
  mcps: McpServer[]
  // When Claude last said which servers it loads; null until it has
  mcpsAt: string | null
  mcpsLoading: boolean
  skills: SkillOption[]
  defaultCwd: string
}

export const WEEKDAYS = [1, 2, 3, 4, 5]
// Monday first, as a French week reads
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_NAME = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const DAY_SHORT = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// Past this, a missed slot is not run late: the next one will come
export const CATCH_UP_MS = 12 * HOUR_MS

const pad = (value: number) => String(value).padStart(2, '0')

export function parseTime(time: string): [number, number] {
  const [hour, minute] = time.split(':').map(Number)
  const valid = (value: number, max: number) => Number.isInteger(value) && value >= 0 && value <= max
  return [valid(hour, 23) ? hour : 9, valid(minute, 59) ? minute : 0]
}

// The first run strictly after the given moment, in local time; none for a manual job
export function nextRun(schedule: JobSchedule, after: Date): Date | null {
  const [hour, minute] = parseTime(schedule.time)
  if (schedule.repeat === 'manual') return null
  if (schedule.repeat === 'hourly') {
    const next = new Date(after)
    next.setSeconds(0, 0)
    next.setMinutes(minute)
    if (next <= after) next.setHours(next.getHours() + 1)
    return next
  }
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset, hour, minute)
    if (day > after && schedule.days.includes(day.getDay())) return day
  }
  return null
}

// The latest run due after `since` and by `now`: what is due now, or what a closed Flux missed
export function dueSlot(schedule: JobSchedule, since: Date, now: Date): Date | null {
  const floor = new Date(Math.max(since.getTime(), now.getTime() - 8 * DAY_MS))
  let slot: Date | null = null
  for (let cursor = nextRun(schedule, floor); cursor && cursor <= now; cursor = nextRun(schedule, cursor)) {
    slot = cursor
  }
  return slot
}

function dayList(days: number[]): string {
  const sorted = WEEK_ORDER.filter(day => days.includes(day))
  if (sorted.length === 7) return 'Tous les jours'
  if (sorted.length === 5 && WEEKDAYS.every(day => sorted.includes(day))) return 'Du lundi au vendredi'
  if (sorted.length === 2 && sorted.includes(6) && sorted.includes(0)) return 'Le week-end'
  if (sorted.length === 1) return `Chaque ${DAY_NAME[sorted[0]]}`
  const short = sorted.map(day => DAY_SHORT[day].replace('.', ''))
  return `${short.join(', ').replace(/^./, letter => letter.toUpperCase())}`
}

export function describeSchedule(schedule: JobSchedule): string {
  const [hour, minute] = parseTime(schedule.time)
  if (schedule.repeat === 'manual') return 'À la demande'
  if (schedule.repeat === 'hourly') return minute === 0 ? 'Toutes les heures' : `Toutes les heures à :${pad(minute)}`
  if (schedule.days.length === 0) return 'Aucun jour choisi'
  return `${dayList(schedule.days)} à ${hour}:${pad(minute)}`
}

// A coming moment the way one says it: today, tomorrow, or the day of the week
export function whenLabel(at: Date, now: Date): string {
  const time = `${at.getHours()}:${pad(at.getMinutes())}`
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
      DAY_MS,
  )
  if (days === 0) return `aujourd’hui ${time}`
  if (days === 1) return `demain ${time}`
  if (days === -1) return `hier ${time}`
  if (days > 1 && days < 7) return `${DAY_SHORT[at.getDay()]} ${time}`
  return `${at.getDate()}/${pad(at.getMonth() + 1)} ${time}`
}

// The prefix Claude gives the tools of an MCP server, which permission rules match whole
export function toolPrefix(server: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

// How a server reads in a list: a claude.ai connector by its name, a plugin's by its own
export function mcpLabel(server: string): string {
  const capital = (name: string) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`
  if (server.startsWith('claude.ai ')) return server.slice('claude.ai '.length)
  const plugin = server.match(/^plugin:([^:]+):(.+)$/)
  if (plugin) return plugin[1] === plugin[2] ? capital(plugin[2]) : `${capital(plugin[2])} · ${plugin[1]}`
  return capital(server)
}

export function jobPrompt(job: Pick<JobDraft, 'skill' | 'prompt'>): string {
  const prompt = job.prompt.trim()
  const skill = job.skill?.trim().replace(/^\//, '')
  if (!skill) return prompt
  return prompt ? `/${skill} ${prompt}` : `/${skill}`
}

// The skills a typed filter keeps: those whose name matches first, then those whose description does
export function matchSkills(skills: SkillOption[], query: string): SkillOption[] {
  const needle = query.trim().replace(/^\//, '').toLowerCase()
  if (!needle) return skills
  const byName = skills.filter(skill => skill.name.toLowerCase().includes(needle))
  const byText = skills.filter(skill => !byName.includes(skill) && skill.description.toLowerCase().includes(needle))
  return [...byName, ...byText]
}

// A server of its own first, then a claude.ai connector, then one that comes with another plugin
function directness(server: string): number {
  const plugin = server.match(/^plugin:([^:]+):(.+)$/)
  if (plugin) return plugin[1] === plugin[2] ? 0 : 2
  return server.startsWith('claude.ai ') ? 1 : 0
}

// The servers that give a skill the services it names: one each, a connected one first
export function serversFor(services: string[], servers: McpServer[]): string[] {
  return services.flatMap(service => {
    const [best] = servers
      .filter(server => serviceOf(server.name) === service)
      .sort((a, b) => Number(b.status === 'ok') - Number(a.status === 'ok') || directness(a.name) - directness(b.name))
    return best ? [best.name] : []
  })
}

// The claude flags of a run: its session id, its name, and the servers it may use or not. The
// prompt goes on stdin
export function jobArgs(job: Job, servers: string[], session: string): string[] {
  const allowed = job.mcps.map(toolPrefix)
  const refused = servers.filter(name => !job.mcps.includes(name)).map(toolPrefix)
  return [
    '-p',
    '--session-id',
    session,
    '--name',
    `Flux · ${job.name}`,
    '--output-format',
    'json',
    '--permission-mode',
    job.permission === 'auto' ? 'auto' : 'dontAsk',
    ...(allowed.length > 0 ? ['--allowedTools', allowed.join(',')] : []),
    ...(refused.length > 0 ? ['--disallowedTools', refused.join(',')] : []),
  ]
}

// The daily's next run: each workday at its time, unless today's is written or the day is over
export function nextDaily(now: Date, time: string, doneToday: boolean, workdayEnd: number): Date | null {
  const schedule: JobSchedule = { repeat: 'daily', days: WEEKDAYS, time }
  const [hour, minute] = parseTime(time)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
  const workday = WEEKDAYS.includes(now.getDay())
  // Due and not yet written: Flux writes it at its next refresh
  if (workday && !doneToday && today <= now && now.getHours() < workdayEnd) return now
  if (workday && !doneToday && today > now) return today
  return nextRun(schedule, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59))
}

// What is missing before a draft can be saved, in the words of the form
export function draftProblem(draft: JobDraft): string | null {
  if (!draft.name.trim()) return 'Donne un nom à la tâche.'
  if (draft.skill !== null && !draft.skill.trim().replace(/^\//, '')) return 'Choisis une skill.'
  if (draft.skill === null && !draft.prompt.trim()) return 'Écris le prompt.'
  if (draft.schedule.repeat === 'daily' && draft.schedule.days.length === 0) return 'Choisis au moins un jour.'
  if (!draft.cwd.trim()) return 'Choisis le dossier où la tâche tourne.'
  return null
}
