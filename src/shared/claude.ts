// The Claude space: the skills you call, the MCP servers Claude loads, and how Flux reads them

export type SkillSource = 'skill' | 'command' | 'plugin'

export interface SkillEntry {
  // source:name, the same from one read to the next
  id: string
  // As /name calls it
  name: string
  description: string
  source: SkillSource
  plugin: string | null
  // The SKILL.md or the command Claude Code loads
  file: string
  // Yours; a plugin's skills are rewritten by each update of the plugin
  editable: boolean
  lastUsedAt: string | null
  uses: number
}

export interface SkillVersion {
  n: number
  // When it was validated
  at: string
}

export interface SkillDetail {
  skill: SkillEntry
  // What Claude loads now
  content: string
  // Oldest first; the last one is the current version, the others are read only
  versions: SkillVersion[]
  // The file has changed since the last validated version
  draft: boolean
}

export interface SkillBoard {
  skills: SkillEntry[]
  // The transcripts are still being read for the last uses
  scanning: boolean
}

export type McpScope = 'user' | 'local' | 'project' | 'plugin' | 'claude.ai'
// Connected, waiting for a sign-in, out of reach, waiting for the project's approval
export type McpHealth = 'ok' | 'auth' | 'failed' | 'pending' | 'unknown'
export type McpTransport = 'http' | 'sse' | 'stdio'

export interface McpEntry {
  name: string
  scope: McpScope
  transport: McpTransport | null
  // The URL, or the command line
  target: string
  status: McpHealth
  // Why it failed
  detail: string | null
}

export interface McpBoard {
  servers: McpEntry[]
  checkedAt: string | null
  checking: boolean
  error: string | null
  // The folder whose local and project servers are listed
  cwd: string
}

export interface McpDraft {
  name: string
  transport: McpTransport
  // The URL of an http or sse server, the command line of a stdio one
  target: string
  scope: 'user' | 'local'
  // KEY=value, one per line
  env: string
  // Name: value, one per line
  headers: string
}

// A server Flux can take away: a plugin's goes with its plugin, a connector lives on claude.ai
export function removable(server: Pick<McpEntry, 'scope'>): boolean {
  return server.scope === 'user' || server.scope === 'local' || server.scope === 'project'
}

export const SCOPE_LABEL: Record<McpScope, string> = {
  user: 'Utilisateur',
  local: 'Local',
  project: 'Projet',
  plugin: 'Plugin',
  'claude.ai': 'claude.ai',
}

const LIST_STATUS: Array<[RegExp, McpHealth]> = [
  [/^(✔|✓)/u, 'ok'],
  [/^(!|⚠)/u, 'auth'],
  [/^(✘|✗|×)/u, 'failed'],
  [/^⏸/u, 'pending'],
]

export interface ListedServer {
  name: string
  transport: McpTransport | null
  target: string
  status: McpHealth
  detail: string | null
}

// Why a server fails, without the HTML page some endpoints answer with
function reasonOf(state: string): string | null {
  const reason = state
    .split(/\s[—–-]\s/)
    .slice(1)
    .join(' — ')
    .replace(/\s*<(!doctype|html)\b[\s\S]*$/i, '')
    .replace(/[\s:]+$/, '')
    .trim()
  return reason || null
}

// One line of `claude mcp list` per server: "name: target (HTTP) - ✔ Connected"
export function parseMcpList(output: string): ListedServer[] {
  const servers: ListedServer[] = []
  for (const line of output.split('\n')) {
    const status = line.match(/^(.+?)\s-\s([✔✓!⚠✘✗×⏸].*)$/u)
    if (!status) continue
    const head = status[1].match(/^(.+?):\s(.+)$/)
    if (!head) continue
    const typed = head[2].match(/^(.*)\s\((HTTP|SSE|STDIO)\)$/i)
    const state = status[2].trim()
    const health = LIST_STATUS.find(([pattern]) => pattern.test(state))?.[1] ?? 'unknown'
    servers.push({
      name: head[1].trim(),
      transport: typed ? (typed[2].toLowerCase() as McpTransport) : 'stdio',
      target: (typed ? typed[1] : head[2]).trim(),
      status: health,
      detail: health === 'failed' || health === 'auth' ? reasonOf(state) : null,
    })
  }
  return servers
}

// The status line of `claude mcp get <name>`
export function parseMcpGet(output: string): Pick<ListedServer, 'status' | 'detail'> | null {
  const line = output.match(/^\s*Status:\s*(.+)$/m)
  if (!line) return null
  const state = line[1].trim()
  const status = LIST_STATUS.find(([pattern]) => pattern.test(state))?.[1] ?? 'unknown'
  return { status, detail: status === 'failed' || status === 'auth' ? reasonOf(state) : null }
}

// A command line split as a shell would, quotes kept together
export function splitCommand(line: string): string[] {
  const words: string[] = []
  let word = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const char of line.trim()) {
    if (quote) {
      if (char === quote) quote = null
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started || word) words.push(word)
      word = ''
      started = false
    } else {
      word += char
    }
  }
  if (started || word) words.push(word)
  return words
}

const lines = (text: string) =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

export function mcpDraftProblem(draft: McpDraft, taken: string[]): string | null {
  const name = draft.name.trim()
  if (!name) return 'Donne un nom au serveur.'
  if (!/^[\w.-]+$/.test(name)) return 'Le nom ne prend que des lettres, chiffres, points, tirets et soulignés.'
  if (taken.includes(name)) return `Un serveur « ${name} » existe déjà.`
  const target = draft.target.trim()
  if (draft.transport === 'stdio' ? splitCommand(target).length === 0 : !/^https?:\/\/\S+$/.test(target)) {
    return draft.transport === 'stdio' ? 'Écris la commande qui lance le serveur.' : 'Colle l’URL du serveur (https://…).'
  }
  if (lines(draft.env).some(entry => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(entry))) return 'Une variable s’écrit CLEF=valeur.'
  if (lines(draft.headers).some(entry => !/^[\w-]+:\s*\S/.test(entry))) return 'Un en-tête s’écrit Nom: valeur.'
  return null
}

// The arguments of `claude mcp add`. The name comes before -e, which would take it for a value
export function mcpAddArgs(draft: McpDraft): string[] {
  const target = draft.transport === 'stdio' ? splitCommand(draft.target) : [draft.target.trim()]
  return [
    'mcp',
    'add',
    '--scope',
    draft.scope,
    '--transport',
    draft.transport,
    draft.name.trim(),
    ...lines(draft.env).flatMap(entry => ['-e', entry]),
    ...(draft.transport === 'stdio' ? [] : lines(draft.headers).flatMap(entry => ['-H', entry])),
    '--',
    ...target,
  ]
}

// The last use of each skill, newest first; never used, by name
export function byLastUse(a: SkillEntry, b: SkillEntry): number {
  if (a.lastUsedAt && b.lastUsedAt) return b.lastUsedAt.localeCompare(a.lastUsedAt)
  if (a.lastUsedAt) return -1
  if (b.lastUsedAt) return 1
  return a.name.localeCompare(b.name)
}
