import { homedir } from 'node:os'

import type { McpServer, McpStatus, SkillOption } from '../../shared/jobs'
import { run } from '../exec'
import { BIN } from '../paths'
import { claudeEnv } from '../llm/claude'
import { scanSkills } from '../claude/skills'

export { skillInfo } from '../claude/skills'

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

// Yours first, then those of your plugins, each as /name would call it
export async function listSkills(home = homedir()): Promise<SkillOption[]> {
  return (await scanSkills(home)).map(({ name, description }) => ({ name, description }))
}
