import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  mcpAddArgs,
  mcpDraftProblem,
  parseMcpGet,
  parseMcpList,
  removable,
  type ListedServer,
  type McpBoard,
  type McpDraft,
  type McpEntry,
  type McpScope,
} from '../../shared/claude'
import type { McpServer } from '../../shared/jobs'

// The MCP servers of Claude Code, managed through its own CLI: `claude mcp list` checks them all,
// `get` one, `login` signs one in, `add` and `remove` write the config. Flux reads the config files
// only to say where each server is declared, which the list does not say.

const LIST_TIMEOUT_MS = 90_000
const GET_TIMEOUT_MS = 60_000
// A sign-in waits for you in the browser
const LOGIN_TIMEOUT_MS = 5 * 60_000

export interface McpDeps {
  home: string
  // Where local and project servers are read and added
  cwd: string
  // The state file of the last list, so the tab opens on it
  file: string
  claude(args: string[], options: { cwd: string; timeoutMs: number }): Promise<string>
  // The claude.ai connectors a run loads, which `claude mcp list` does not show
  connectors(): McpServer[]
  refreshConnectors(): Promise<void>
  onChange(board: McpBoard): void
  now?: () => Date
}

interface Stored {
  servers: McpEntry[]
  checkedAt: string | null
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

const keys = (value: unknown): string[] => (value && typeof value === 'object' ? Object.keys(value) : [])

// Where each server is declared: ~/.claude.json for the user and this folder's local ones,
// .mcp.json for the project; a plugin's carry its name
export async function mcpScopes(home: string, cwd: string): Promise<Map<string, McpScope>> {
  const scopes = new Map<string, McpScope>()
  const config = (await readJson(join(home, '.claude.json'))) ?? {}
  const project = (config.projects as Record<string, { mcpServers?: unknown }> | undefined)?.[cwd]
  for (const name of keys((await readJson(join(cwd, '.mcp.json')))?.mcpServers)) scopes.set(name, 'project')
  for (const name of keys(config.mcpServers)) scopes.set(name, 'user')
  for (const name of keys(project?.mcpServers)) scopes.set(name, 'local')
  return scopes
}

export function mcpEntries(listed: ListedServer[], scopes: Map<string, McpScope>, connectors: McpServer[]): McpEntry[] {
  const entries: McpEntry[] = listed.map(server => ({
    ...server,
    scope: server.name.startsWith('plugin:') ? 'plugin' : (scopes.get(server.name) ?? 'user'),
  }))
  for (const connector of connectors) {
    if (!connector.name.startsWith('claude.ai ')) continue
    entries.push({
      name: connector.name,
      scope: 'claude.ai',
      transport: null,
      target: 'Connecteur claude.ai',
      status: connector.status,
      detail: null,
    })
  }
  return entries
}

export class McpManager {
  private stored: Stored = { servers: [], checkedAt: null }
  private loaded = false
  private checking: Promise<void> | null = null
  private error: string | null = null

  constructor(private readonly deps: McpDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  board(): McpBoard {
    return {
      servers: this.stored.servers,
      checkedAt: this.stored.checkedAt,
      checking: this.checking !== null,
      error: this.error,
      cwd: this.deps.cwd,
    }
  }

  private emit(): void {
    this.deps.onChange(this.board())
  }

  // The last list right away; a new one behind when it is older than a few minutes
  async snapshot(): Promise<McpBoard> {
    await this.load()
    const age = this.stored.checkedAt ? this.now().getTime() - Date.parse(this.stored.checkedAt) : Infinity
    if (age > 5 * 60_000) void this.refresh().catch(() => undefined)
    return this.board()
  }

  // `claude mcp list` waits for each server to answer, up to its timeout: tens of seconds
  refresh(): Promise<void> {
    this.checking ??= (async () => {
      try {
        const output = await this.deps.claude(['mcp', 'list'], { cwd: this.deps.cwd, timeoutMs: LIST_TIMEOUT_MS })
        const scopes = await mcpScopes(this.deps.home, this.deps.cwd)
        this.stored = {
          servers: mcpEntries(parseMcpList(output), scopes, this.deps.connectors()),
          checkedAt: this.now().toISOString(),
        }
        this.error = null
        await this.save()
      } catch (error) {
        this.error = (error as Error).message
        throw error
      } finally {
        this.checking = null
        this.emit()
      }
    })()
    this.emit()
    return this.checking
  }

  private find(name: string): McpEntry {
    const server = this.stored.servers.find(entry => entry.name === name)
    if (!server) throw new Error(`Le serveur « ${name} » n’est plus déclaré.`)
    return server
  }

  private async update(name: string, patch: Partial<McpEntry>): Promise<McpEntry> {
    this.stored.servers = this.stored.servers.map(entry => (entry.name === name ? { ...entry, ...patch } : entry))
    await this.save()
    this.emit()
    return this.find(name)
  }

  // A server waiting for a sign-in opens it in the browser; any other is checked again
  async reconnect(name: string): Promise<McpEntry> {
    const server = this.find(name)
    if (server.status === 'auth') {
      await this.deps.claude(['mcp', 'login', name], { cwd: this.deps.cwd, timeoutMs: LOGIN_TIMEOUT_MS })
    }
    if (server.scope === 'claude.ai') {
      await this.deps.refreshConnectors()
      const connector = this.deps.connectors().find(entry => entry.name === name)
      return this.update(name, { status: connector?.status ?? 'unknown', detail: null })
    }
    const output = await this.deps.claude(['mcp', 'get', name], { cwd: this.deps.cwd, timeoutMs: GET_TIMEOUT_MS })
    const next = parseMcpGet(output) ?? { status: 'unknown' as const, detail: null }
    // `mcp get` rarely says why: a server still failing keeps the reason the list gave
    return this.update(name, next.status === server.status ? { ...next, detail: next.detail ?? server.detail } : next)
  }

  async remove(name: string): Promise<void> {
    const server = this.find(name)
    if (!removable(server)) {
      throw new Error(
        server.scope === 'plugin'
          ? 'Ce serveur vient d’un plugin : retire le plugin pour le retirer.'
          : 'Ce connecteur se gère sur claude.ai.',
      )
    }
    await this.deps.claude(['mcp', 'remove', name, '--scope', server.scope], {
      cwd: this.deps.cwd,
      timeoutMs: GET_TIMEOUT_MS,
    })
    this.stored.servers = this.stored.servers.filter(entry => entry.name !== name)
    await this.save()
    this.emit()
  }

  async add(draft: McpDraft): Promise<void> {
    const problem = mcpDraftProblem(
      draft,
      this.stored.servers.map(entry => entry.name),
    )
    if (problem) throw new Error(problem)
    await this.deps.claude(mcpAddArgs(draft), { cwd: this.deps.cwd, timeoutMs: GET_TIMEOUT_MS })
    // The new server is checked with all the others
    void this.refresh().catch(() => undefined)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    const parsed = (await readJson(this.deps.file)) as Partial<Stored> | null
    if (parsed && Array.isArray(parsed.servers)) {
      this.stored = { servers: parsed.servers, checkedAt: parsed.checkedAt ?? null }
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.deps.file), { recursive: true })
    const temporary = `${this.deps.file}.tmp`
    await writeFile(temporary, JSON.stringify(this.stored, null, 2))
    await rename(temporary, this.deps.file)
  }
}
