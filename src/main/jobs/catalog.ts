import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import type { McpServer, McpStatus, SkillOption } from '../../shared/jobs'
import { run } from '../exec'
import { BIN } from '../paths'
import { claudeEnv } from '../llm/claude'

const DESCRIPTION_MAX = 160
// The init event of a run names each server Claude loads, under the name its tools carry. claude mcp
// list does not: it shows a plugin where the run loads the claude.ai connector of the same service
const INIT_STATUS: Record<string, McpStatus> = { connected: 'ok', pending: 'ok', 'needs-auth': 'auth', failed: 'failed' }

export function parseMcpInit(output: string): McpServer[] | null {
  for (const line of output.split('\n')) {
    let event: { type?: string; subtype?: string; mcp_servers?: Array<{ name?: unknown; status?: unknown }> }
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type !== 'system' || event.subtype !== 'init' || !Array.isArray(event.mcp_servers)) continue
    return event.mcp_servers.flatMap(server =>
      typeof server.name === 'string' && server.status !== 'disabled'
        ? [{ name: server.name, status: INIT_STATUS[String(server.status)] ?? 'ok' }]
        : [],
    )
  }
  return null
}

// /mcp answers without asking the model: a run that costs nothing, a few seconds long, that says
// which servers a job started in this folder would get
export async function listMcpServers(cwd: string): Promise<McpServer[]> {
  const output = await run(
    BIN.claude,
    ['-p', '--no-session-persistence', '--settings', '{"disableAllHooks":true}', '--output-format', 'stream-json', '--verbose'],
    { input: '/mcp', cwd, env: await claudeEnv(), timeoutMs: 60_000 },
  )
  const servers = parseMcpInit(output)
  if (!servers) throw new Error('Claude n’a pas dit quels MCP il charge')
  return servers
}

function clip(text: string): string {
  const plain = text.replace(/\s+/g, ' ').replace(/[*`_#>]/g, '').trim()
  return plain.length > DESCRIPTION_MAX ? `${plain.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : plain
}

// A skill's name and what it does: from its frontmatter, or else its first line
export function skillInfo(text: string, fallback: string): SkillOption {
  const front = text.match(/^---\n([\s\S]*?)\n---\n?/)
  const head = front?.[1] ?? ''
  const name = head.match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '') || fallback
  const inline = head.match(/^description:\s*(.*)$/m)
  let description = inline?.[1].trim() ?? ''
  // A folded description goes on over the indented lines below it
  if (inline && /^([>|][-+]?)?$/.test(description)) {
    const lines = head.split('\n')
    const folded: string[] = []
    for (const line of lines.slice(lines.indexOf(inline[0]) + 1)) {
      if (!/^\s+\S/.test(line)) break
      folded.push(line.trim())
    }
    description = folded.join(' ')
  }
  if (!description) {
    const body = front ? text.slice(front[0].length) : text
    description = body.split('\n').find(line => line.trim() && !line.startsWith('#')) ?? ''
  }
  return { name, description: clip(description.replace(/^['"]|['"]$/g, '')) }
}

async function names(dir: string): Promise<string[]> {
  return readdir(dir).catch(() => [])
}

async function read(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

// Skills and commands in one folder: <name>/SKILL.md and <name>.md
async function skillsIn(dir: string, prefix: string): Promise<SkillOption[]> {
  const found: SkillOption[] = []
  for (const entry of await names(join(dir, 'skills'))) {
    if (entry === 'synced' || entry.startsWith('.')) continue
    const text = await read(join(dir, 'skills', entry, 'SKILL.md'))
    if (text !== null) found.push(skillInfo(text, entry))
  }
  for (const entry of await names(join(dir, 'commands'))) {
    if (!entry.endsWith('.md')) continue
    const text = await read(join(dir, 'commands', entry))
    if (text !== null) found.push({ ...skillInfo(text, basename(entry, '.md')), name: basename(entry, '.md') })
  }
  return found.map(skill => ({ ...skill, name: `${prefix}${skill.name}` }))
}

// Yours first, then those of your plugins, each as /name would call it
export async function listSkills(home = homedir()): Promise<SkillOption[]> {
  const claude = join(home, '.claude')
  const own = await skillsIn(claude, '')
  const plugins: SkillOption[] = []
  let entries: Record<string, Array<{ installPath?: string }>> = {}
  try {
    const installed = await read(join(claude, 'plugins', 'installed_plugins.json'))
    entries = (installed ? JSON.parse(installed) : {}).plugins ?? {}
  } catch {
    entries = {}
  }
  for (const [key, versions] of Object.entries(entries)) {
    const path = versions[0]?.installPath
    if (path) plugins.push(...(await skillsIn(path, `${key.split('@')[0]}:`)))
  }
  const byName = (a: SkillOption, b: SkillOption) => a.name.localeCompare(b.name)
  return [...own.sort(byName), ...plugins.sort(byName)]
}
