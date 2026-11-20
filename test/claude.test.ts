import { appendFile, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  byLastUse,
  mcpAddArgs,
  mcpDraftProblem,
  parseMcpGet,
  parseMcpList,
  splitCommand,
  type McpDraft,
  type SkillEntry,
} from '../src/shared/claude'
import { nextDaily } from '../src/shared/jobs'
import { callsIn, skillGraph } from '../src/shared/skillGraph'
import { McpManager, mcpScopes, type McpDeps } from '../src/main/claude/mcp'
import { editPrompt, scanSkills, SkillLibrary } from '../src/main/claude/skills'
import { mergeUsage, readSkillUsage, readUsageLine, TranscriptUsage, type Usage } from '../src/main/claude/usage'
import { SkillVersions } from '../src/main/claude/versions'
import { dailyTask } from '../src/main/llm/daily'
import { JobScheduler } from '../src/main/jobs/scheduler'

const temp = (prefix: string) => mkdtemp(join(tmpdir(), prefix))

const TICKET_SKILL = `---
name: ticket
description: Exécute un ticket
---
# Ticket

Intro.

## Setup worktree

1. **Vérifier la branche** : \`git branch --show-current\`.
2. **Créer le worktree** via \`wt switch -c feat/x\`.

## Avant

1. **Passer le ticket en cours** via \`mcp__plugin_linear_linear__save_issue\`.
2. **Lire Sentry** si une URL est donnée : https://sentry.io/issues/1

## Finition

1. **Commit** : exécute le skill \`/gl_commit\`.
2. **PR** : \`gh pr create --base master\`, puis charge \`anthropic-skills:built-in-browser\`.

\`\`\`
## Pas une section
\`\`\`

## Règles

- Lire \`~/.claude/CLAUDE.md\` avant tout.
`

describe('graphe d’un skill', () => {
  it('suit les sections, garde les règles en cadre et trouve les appels de chaque étape', () => {
    const graph = skillGraph(TICKET_SKILL)
    expect(graph.steps.map(step => step.title)).toEqual(['Setup worktree', 'Avant', 'Finition'])
    expect(graph.frame).toEqual(['Règles'])
    expect(graph.steps[0].points).toEqual(['Vérifier la branche', 'Créer le worktree'])
    expect(graph.steps[0].calls).toEqual([
      { kind: 'cli', label: 'git', details: ['git branch'] },
      { kind: 'cli', label: 'wt', details: ['wt switch'] },
    ])
    expect(graph.steps[1].calls).toContainEqual({ kind: 'mcp', label: 'Linear', details: ['save_issue'] })
    expect(graph.steps[1].calls).toContainEqual({ kind: 'mcp', label: 'Sentry', details: [] })
    expect(graph.steps[1].calls).toContainEqual({ kind: 'web', label: 'Web', details: ['sentry.io'] })
    const finish = graph.steps[2].calls.map(call => `${call.kind}:${call.label}`)
    expect(finish).toEqual(expect.arrayContaining(['cli:gh', 'skill:/gl_commit', 'skill:/anthropic-skills:built-in-browser']))
    // A heading inside a code block is not a section
    expect(graph.steps.some(step => step.title === 'Pas une section')).toBe(false)
  })

  it('déplie une section Procédure en ses sous-sections, ou en ses points numérotés', () => {
    const procedure = skillGraph('## Posture\n\nCalme.\n\n## Procédure\n\n### 1. Lire la source\n\nLinear.\n\n### 2. Qualifier\n\nTexte.\n')
    expect(procedure.steps.map(step => step.title)).toEqual(['Lire la source', 'Qualifier'])
    expect(procedure.frame).toEqual(['Posture'])
    const steps = skillGraph('## Étapes\n\n1. **Inspecter l’état**\n   - `git status`\n2. **Vérifier**\n\n## Règles\n\n- Rien.\n')
    expect(steps.steps.map(step => step.title)).toEqual(['Inspecter l’état', 'Vérifier'])
    expect(steps.steps[0].calls).toEqual([{ kind: 'cli', label: 'git', details: ['git status'] }])
  })

  it('lit un skill sans section comme ses points, ou comme un bloc d’instructions', () => {
    expect(skillGraph('1. Un\n2. Deux\n').steps.map(step => step.title)).toEqual(['Un', 'Deux'])
    expect(skillGraph('Fais ceci.').steps.map(step => step.title)).toEqual(['Instructions'])
    expect(skillGraph('').steps).toEqual([])
  })

  it('ne compte pas le skill parmi ses propres appels', () => {
    const text = '## Lancé à la main\n\nTape `/gl_daily`, puis `/gl_commit`.\n'
    expect(skillGraph(text, 'gl_daily').calls.map(call => call.label)).toEqual(['/gl_commit'])
    expect(skillGraph(text).calls.map(call => call.label)).toEqual(['/gl_commit', '/gl_daily'])
  })

  it('reconnaît fichiers, sous-agents et outils web', () => {
    const calls = callsIn('Délègue à un sous-agent, lis `CHANGELOG.md` et /Users/me/notes/a.md, puis WebFetch.')
    expect(calls.map(call => call.label)).toEqual(['Sous-agent', 'Web', 'Fichiers'])
    expect(calls.at(-1)?.details).toEqual(['/Users/me/notes/a.md', 'CHANGELOG.md'])
  })
})

const LIST = `Checking MCP server health…

plugin:linear:linear: https://mcp.linear.app/mcp (HTTP) - ✔ Connected
plugin:design-to-code:figma: https://mcp.figma.com/mcp (HTTP) - ! Needs authentication
sentry: https://mcp.sentry.dev/mcp (HTTP) - ✔ Connected
postgres: /opt/homebrew/bin/uvx --python 3.13 postgres-mcp==0.3.0 --access-mode=restricted - ✘ Failed to connect — MCP server "postgres" connection timed out after 30000ms
local-one: npx -y local-server - ✔ Connected
`

describe('serveurs MCP', () => {
  it('lit la liste de claude mcp list, état et raison compris', () => {
    const servers = parseMcpList(LIST)
    expect(servers.map(server => [server.name, server.transport, server.status])).toEqual([
      ['plugin:linear:linear', 'http', 'ok'],
      ['plugin:design-to-code:figma', 'http', 'auth'],
      ['sentry', 'http', 'ok'],
      ['postgres', 'stdio', 'failed'],
      ['local-one', 'stdio', 'ok'],
    ])
    expect(servers[3].target).toBe('/opt/homebrew/bin/uvx --python 3.13 postgres-mcp==0.3.0 --access-mode=restricted')
    expect(servers[3].detail).toBe('MCP server "postgres" connection timed out after 30000ms')
  })

  it('garde la raison d’un échec sans la page HTML renvoyée par le serveur', () => {
    const [server] = parseMcpList(
      'essai: https://example.com/mcp (HTTP) - ✘ Failed to connect — HTTP 405: Error POSTing to endpoint: <!doctype html><html><body>Example</body></html>',
    )
    expect(server.detail).toBe('HTTP 405: Error POSTing to endpoint')
  })

  it('lit l’état d’un seul serveur', () => {
    expect(parseMcpGet('sentry:\n  Scope: User config\n  Status: ✔ Connected\n  Type: http\n')).toEqual({ status: 'ok', detail: null })
    expect(parseMcpGet('figma:\n  Status: ! Needs authentication\n')).toEqual({ status: 'auth', detail: null })
    expect(parseMcpGet('No MCP server named "x"')).toBeNull()
  })

  it('écrit les arguments de claude mcp add, le nom avant les variables', () => {
    const stdio: McpDraft = { name: 'db', transport: 'stdio', target: 'npx -y "my server" --flag', scope: 'user', env: 'A=1\n\nB=two words', headers: 'X: 1' }
    expect(mcpAddArgs(stdio)).toEqual(['mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'db', '-e', 'A=1', '-e', 'B=two words', '--', 'npx', '-y', 'my server', '--flag'])
    const http: McpDraft = { name: 'acme', transport: 'http', target: ' https://mcp.acme.dev/mcp ', scope: 'local', env: '', headers: 'Authorization: Bearer t' }
    expect(mcpAddArgs(http)).toEqual(['mcp', 'add', '--scope', 'local', '--transport', 'http', 'acme', '-H', 'Authorization: Bearer t', '--', 'https://mcp.acme.dev/mcp'])
    expect(splitCommand(`a 'b c' "" d`)).toEqual(['a', 'b c', '', 'd'])
  })

  it('dit ce qui manque avant d’ajouter', () => {
    const draft: McpDraft = { name: 'acme', transport: 'http', target: 'https://x.dev/mcp', scope: 'user', env: '', headers: '' }
    expect(mcpDraftProblem(draft, [])).toBeNull()
    expect(mcpDraftProblem({ ...draft, name: 'a b' }, [])).toMatch(/lettres/)
    expect(mcpDraftProblem(draft, ['acme'])).toBe('Un serveur « acme » existe déjà.')
    expect(mcpDraftProblem({ ...draft, target: 'mcp.dev' }, [])).toMatch(/URL/)
    expect(mcpDraftProblem({ ...draft, env: 'pas une variable' }, [])).toMatch(/CLEF=valeur/)
  })

  it('dit où chaque serveur est déclaré et passe par le CLI pour le changer', async () => {
    const home = await temp('flux-mcp-')
    const cwd = join(home, 'code')
    await mkdir(cwd)
    await writeFile(
      join(home, '.claude.json'),
      JSON.stringify({ mcpServers: { sentry: {}, postgres: {} }, projects: { [cwd]: { mcpServers: { 'local-one': {} } } } }),
    )
    expect(await mcpScopes(home, cwd)).toEqual(new Map([['sentry', 'user'], ['postgres', 'user'], ['local-one', 'local']]))

    const claude = vi.fn<McpDeps['claude']>(async args => {
      if (args[1] === 'list') return LIST
      if (args[1] === 'get') return args[2] === 'postgres' ? 'postgres:\n  Status: ✘ Failed to connect\n' : 'figma:\n  Status: ✔ Connected\n'
      return ''
    })
    const manager = new McpManager({
      home,
      cwd,
      file: join(home, 'mcp.json'),
      claude,
      connectors: () => [{ name: 'claude.ai Notion', status: 'ok' }, { name: 'sentry', status: 'ok' }],
      refreshConnectors: async () => undefined,
      onChange: () => undefined,
    })
    await manager.refresh()
    const scopes = Object.fromEntries(manager.board().servers.map(server => [server.name, server.scope]))
    expect(scopes).toEqual({
      'plugin:linear:linear': 'plugin',
      'plugin:design-to-code:figma': 'plugin',
      sentry: 'user',
      postgres: 'user',
      'local-one': 'local',
      'claude.ai Notion': 'claude.ai',
    })

    await expect(manager.remove('plugin:linear:linear')).rejects.toThrow(/plugin/)
    await manager.remove('local-one')
    expect(claude).toHaveBeenLastCalledWith(['mcp', 'remove', 'local-one', '--scope', 'local'], expect.objectContaining({ cwd }))
    expect(manager.board().servers.some(server => server.name === 'local-one')).toBe(false)

    // A server waiting for a sign-in is signed in first, then checked
    const figma = await manager.reconnect('plugin:design-to-code:figma')
    expect(claude.mock.calls.slice(-2).map(call => call[0].slice(0, 2))).toEqual([['mcp', 'login'], ['mcp', 'get']])
    expect(figma.status).toBe('ok')

    // Still failing: the reason given by the list stays
    const postgres = await manager.reconnect('postgres')
    expect(postgres).toMatchObject({ status: 'failed', detail: 'MCP server "postgres" connection timed out after 30000ms' })
  })
})

describe('dernière utilisation des skills', () => {
  const at = '2026-11-16T16:40:00.000Z'
  const skillCall = JSON.stringify({ type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'gl_commit' } }] } })
  const command = JSON.stringify({ type: 'user', timestamp: at, message: { content: '<command-message>gl_daily</command-message>\n<command-name>/gl_daily</command-name>' } })

  it('compte un appel du tool Skill et une /commande tapée, pas un prompt qui les cite', () => {
    const usage: Usage = new Map()
    readUsageLine(skillCall, usage)
    readUsageLine(command, usage)
    readUsageLine(JSON.stringify({ type: 'api-request-shape', timestamp: at, shape: '"name":"Skill" <command-name>/x</command-name>' }), usage)
    readUsageLine(JSON.stringify({ type: 'user', timestamp: at, message: { content: 'Que fait <command-name>/y</command-name> ?' } }), usage)
    expect([...usage.keys()]).toEqual(['gl_commit', 'gl_daily'])
    expect(usage.get('gl_commit')).toEqual({ at: Date.parse(at), count: 1 })
  })

  it('ne relit que ce qui a été ajouté aux transcripts, et attend la fin d’une ligne', async () => {
    const root = await temp('flux-transcripts-')
    await mkdir(join(root, 'project', 'session', 'subagents'), { recursive: true })
    const main = join(root, 'project', 'a.jsonl')
    await writeFile(main, `${skillCall}\n`)
    await writeFile(join(root, 'project', 'session', 'subagents', 'agent.jsonl'), `${command}\n`)
    const transcripts = new TranscriptUsage(root, join(root, 'cache.json'))
    expect([...(await transcripts.scan()).keys()].sort()).toEqual(['gl_commit', 'gl_daily'])

    const later = JSON.stringify({ type: 'assistant', timestamp: '2026-11-18T09:00:00.000Z', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'gl_commit' } }] } })
    await appendFile(main, later.slice(0, 40))
    expect((await transcripts.scan()).get('gl_commit')?.count).toBe(1)
    await appendFile(main, `${later.slice(40)}\n`)
    const usage = await new TranscriptUsage(root, join(root, 'cache.json')).scan()
    expect(usage.get('gl_commit')).toEqual({ at: Date.parse('2026-11-18T09:00:00.000Z'), count: 2 })
  })

  it('prend la plus récente des deux sources, et le compte de Claude Code', () => {
    const counted = readSkillUsage(JSON.stringify({ skillUsage: { gl_commit: { usageCount: 149, lastUsedAt: 1000 } } }))
    const read: Usage = new Map([['gl_commit', { at: 2000, count: 3 }], ['run', { at: 500, count: 1 }]])
    expect(mergeUsage(counted, read)).toEqual(new Map([['gl_commit', { at: 2000, count: 149 }], ['run', { at: 500, count: 1 }]]))
  })

  it('range les skills du plus récent au jamais lancé', () => {
    const skill = (name: string, lastUsedAt: string | null) => ({ name, lastUsedAt }) as SkillEntry
    const sorted = [skill('b', null), skill('old', '2026-01-01'), skill('a', null), skill('new', '2026-11-01')].sort(byLastUse)
    expect(sorted.map(entry => entry.name)).toEqual(['new', 'old', 'a', 'b'])
  })
})

describe('versions d’un skill', () => {
  it('fige la v1 à la première lecture, puis chaque validation, en lecture seule', async () => {
    const versions = new SkillVersions(await temp('flux-versions-'))
    await versions.baseline('command:gl_daily', '/x/gl_daily.md', 'v1', new Date('2026-11-10T10:00:00Z'))
    await versions.baseline('command:gl_daily', '/x/gl_daily.md', 'autre', new Date())
    expect(await versions.list('command:gl_daily')).toEqual([{ n: 1, at: '2026-11-10T10:00:00.000Z' }])
    expect(await versions.isDraft('command:gl_daily', 'v1')).toBe(false)
    expect(await versions.isDraft('command:gl_daily', 'v2')).toBe(true)

    await versions.validate('command:gl_daily', '/x/gl_daily.md', 'v2', new Date('2026-11-20T10:00:00Z'))
    await expect(versions.validate('command:gl_daily', '/x/gl_daily.md', 'v2', new Date())).rejects.toThrow('Rien à valider')
    expect((await versions.list('command:gl_daily')).map(version => version.n)).toEqual([1, 2])
    expect(await versions.read('command:gl_daily', 1)).toBe('v1')
    expect(await versions.isDraft('command:gl_daily', 'v2')).toBe(false)
  })

  it('liste les skills de Claude Code, valide les tiens et laisse ceux des plugins', async () => {
    const home = await temp('flux-home-')
    const claude = join(home, '.claude')
    await mkdir(join(claude, 'skills', 'design', 'references'), { recursive: true })
    await mkdir(join(claude, 'skills', 'synced'), { recursive: true })
    await mkdir(join(claude, 'commands'), { recursive: true })
    const plugin = join(home, 'plugin')
    await mkdir(join(plugin, 'skills', 'upgrade'), { recursive: true })
    await writeFile(join(claude, 'skills', 'design', 'SKILL.md'), '---\nname: design\ndescription: Dessine\n---\n## Étapes\n')
    await writeFile(join(claude, 'commands', 'gl_daily.md'), '# Daily\n\nLe daily.\n')
    await writeFile(join(claude, 'commands', 'gl_commit.md'), '# Commit\n\nCommite.\n')
    await writeFile(join(plugin, 'skills', 'upgrade', 'SKILL.md'), '---\nname: expo-upgrade\ndescription: Monte Expo\n---\n')
    await mkdir(join(claude, 'plugins'))
    await writeFile(join(claude, 'plugins', 'installed_plugins.json'), JSON.stringify({ plugins: { 'expo@market': [{ installPath: plugin }] } }))
    await writeFile(join(home, '.claude.json'), JSON.stringify({ skillUsage: { gl_commit: { usageCount: 9, lastUsedAt: Date.parse('2026-11-19T10:00:00Z') } } }))

    expect((await scanSkills(home)).map(skill => skill.id)).toEqual(['skill:design', 'command:gl_commit', 'command:gl_daily', 'plugin:expo:expo-upgrade'])

    const root = join(home, '.flux')
    const opened = vi.fn(async () => undefined)
    const library = new SkillLibrary({
      home,
      versions: new SkillVersions(join(root, 'skills')),
      transcripts: new TranscriptUsage(join(home, 'projects'), join(root, 'usage.json')),
      openSession: opened,
      onChange: () => undefined,
    })
    const board = await library.list()
    expect(board.skills[0]).toMatchObject({ name: 'gl_commit', uses: 9, lastUsedAt: '2026-11-19T10:00:00.000Z', editable: true })

    const first = await library.detail('command:gl_daily')
    expect(first.versions.map(version => version.n)).toEqual([1])
    expect(first.draft).toBe(false)
    await writeFile(join(claude, 'commands', 'gl_daily.md'), '# Daily\n\nLe daily, revu.\n')
    expect((await library.detail('command:gl_daily')).draft).toBe(true)
    const validated = await library.validate('command:gl_daily')
    expect(validated.versions.map(version => version.n)).toEqual([1, 2])
    expect(validated.draft).toBe(false)
    const frozen = await stat(join(root, 'skills', 'command__gl_daily', 'v1.md'))
    expect(frozen.mode & 0o222).toBe(0)
    expect(await library.version('command:gl_daily', 1)).toBe('# Daily\n\nLe daily.\n')
    // The file Claude Code loads stays where it was, as edited
    expect(await readFile(join(claude, 'commands', 'gl_daily.md'), 'utf8')).toBe('# Daily\n\nLe daily, revu.\n')

    const pluginDetail = await library.detail('plugin:expo:expo-upgrade')
    expect(pluginDetail).toMatchObject({ versions: [], draft: false, skill: { editable: false } })
    await expect(library.validate('plugin:expo:expo-upgrade')).rejects.toThrow(/plugin/)

    await library.edit('command:gl_daily')
    expect(opened).toHaveBeenCalledWith(editPrompt({ name: 'gl_daily', file: join(claude, 'commands', 'gl_daily.md') }, 2), [join(claude, 'commands')])
  })
})

describe('le daily parmi les tâches', () => {
  it('vient au prochain jour ouvré à son heure, ou tout de suite s’il est dû', () => {
    // Friday 20 November 2026
    expect(nextDaily(new Date(2026, 10, 20, 8, 0), '09:30', false, 19)).toEqual(new Date(2026, 10, 20, 9, 30))
    expect(nextDaily(new Date(2026, 10, 20, 11, 0), '09:30', false, 19)).toEqual(new Date(2026, 10, 20, 11, 0))
    expect(nextDaily(new Date(2026, 10, 20, 11, 0), '09:30', true, 19)).toEqual(new Date(2026, 10, 23, 9, 30))
    expect(nextDaily(new Date(2026, 10, 21, 11, 0), '09:30', false, 19)).toEqual(new Date(2026, 10, 23, 9, 30))
  })

  it('lit les daily écrits, du plus récent au plus ancien', async () => {
    const dir = await temp('flux-daily-')
    await writeFile(join(dir, '2026-11-17.json'), JSON.stringify({ generatedAt: '2026-11-17T11:14:12.092Z' }))
    await writeFile(join(dir, '2026-11-20.json'), '{')
    await writeFile(join(dir, 'notes.txt'), '')
    const task = await dailyTask(new Date(2026, 10, 20, 11, 0), '09:30', 19, dir)
    expect(task.runs).toEqual([
      { date: '2026-11-20', at: null },
      { date: '2026-11-17', at: '2026-11-17T11:14:12.092Z' },
    ])
    expect(task.next).toBe(new Date(2026, 10, 23, 9, 30).toISOString())
  })

  it('montre le daily même quand aucune tâche n’a été créée', async () => {
    const file = join(await temp('flux-jobs-'), 'jobs.json')
    const daily = { skill: 'gl_daily', file: '/x/gl_daily.md', exists: true, time: '09:30', next: null, runs: [] }
    const scheduler = new JobScheduler(file, {
      launch: vi.fn(),
      listMcps: async () => [],
      listSkills: async () => [],
      daily: async () => daily,
      defaultCwd: '/tmp',
      onChange: () => undefined,
      onFinish: () => undefined,
    })
    await scheduler.start()
    scheduler.stop()
    expect(scheduler.board().jobs).toEqual([])
    expect(scheduler.board().daily).toEqual(daily)
  })
})
