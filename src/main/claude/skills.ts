import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { byLastUse, type SkillBoard, type SkillDetail, type SkillEntry, type SkillSource } from '../../shared/claude'
import type { SkillOption } from '../../shared/jobs'
import { mergeUsage, readSkillUsage, type TranscriptUsage, type Usage } from './usage'
import type { SkillVersions } from './versions'

// Where Claude Code finds skills: ~/.claude/skills/<name>/SKILL.md, ~/.claude/commands/<name>.md,
// and the same two folders inside each installed plugin, called plugin:name
export interface FoundSkill {
  id: string
  name: string
  description: string
  source: SkillSource
  plugin: string | null
  file: string
}

const DESCRIPTION_MAX = 160

function clip(text: string): string {
  const plain = text.replace(/\s+/g, ' ').replace(/[*`_#>]/g, '').trim()
  return plain.length > DESCRIPTION_MAX ? `${plain.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : plain
}

// A skill's name and what it does: from its frontmatter, or else its first line
export function skillInfo(text: string, fallback: string): Pick<SkillOption, 'name' | 'description'> {
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

async function skillsIn(dir: string, plugin: string | null): Promise<FoundSkill[]> {
  const found: FoundSkill[] = []
  const prefix = plugin ? `${plugin}:` : ''
  for (const entry of await names(join(dir, 'skills'))) {
    // synced/ holds the skills claude.ai shares with Claude Desktop, not yours
    if (entry === 'synced' || entry.startsWith('.')) continue
    const file = join(dir, 'skills', entry, 'SKILL.md')
    const text = await read(file)
    if (text === null) continue
    const info = skillInfo(text, entry)
    const name = `${prefix}${info.name}`
    found.push({ id: `${plugin ? 'plugin' : 'skill'}:${name}`, name, description: info.description, source: plugin ? 'plugin' : 'skill', plugin, file })
  }
  for (const entry of await names(join(dir, 'commands'))) {
    if (!entry.endsWith('.md')) continue
    const file = join(dir, 'commands', entry)
    const text = await read(file)
    if (text === null) continue
    const name = `${prefix}${basename(entry, '.md')}`
    found.push({ id: `${plugin ? 'plugin' : 'command'}:${name}`, name, description: skillInfo(text, name).description, source: plugin ? 'plugin' : 'command', plugin, file })
  }
  return found
}

// Yours, then those of your plugins, each named as /name calls it
export async function scanSkills(home: string): Promise<FoundSkill[]> {
  const claude = join(home, '.claude')
  const own = await skillsIn(claude, null)
  let entries: Record<string, Array<{ installPath?: string }>> = {}
  try {
    const installed = await read(join(claude, 'plugins', 'installed_plugins.json'))
    entries = (installed ? JSON.parse(installed) : {}).plugins ?? {}
  } catch {
    entries = {}
  }
  const plugins: FoundSkill[] = []
  for (const [key, versions] of Object.entries(entries)) {
    const path = versions[0]?.installPath
    if (path) plugins.push(...(await skillsIn(path, key.split('@')[0])))
  }
  const byName = (a: FoundSkill, b: FoundSkill) => a.name.localeCompare(b.name)
  // A skill and a command of one name: Claude Code loads the skill
  const unique = (list: FoundSkill[]) => list.filter((skill, index) => list.findIndex(other => other.name === skill.name) === index)
  return [...unique(own.sort(byName)), ...unique(plugins.sort(byName))]
}

export interface SkillLibraryDeps {
  home: string
  versions: SkillVersions
  transcripts: TranscriptUsage
  // Opens a Claude Desktop session on these folders, with this prompt
  openSession(prompt: string, folders: string[]): Promise<void>
  onChange(board: SkillBoard): void
  now?: () => Date
}

export function editPrompt(skill: Pick<SkillEntry, 'name' | 'file'>, version: number | null): string {
  const kept = version === null ? '' : ` Flux garde ses versions validées (la v${version} est l’actuelle) :`
  return `Je veux modifier le skill /${skill.name}, dans \`${skill.file}\`.${kept} n’écris que dans ce fichier, je validerai la nouvelle version depuis Flux. Lis-le, puis demande-moi ce que je veux changer.`
}

export class SkillLibrary {
  private skills: FoundSkill[] = []
  private usage: Usage = new Map()
  private scannedAt = 0

  constructor(private readonly deps: SkillLibraryDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private entry(found: FoundSkill): SkillEntry {
    const mark = this.usage.get(found.name)
    return {
      ...found,
      editable: found.source !== 'plugin',
      lastUsedAt: mark ? new Date(mark.at).toISOString() : null,
      uses: mark?.count ?? 0,
    }
  }

  private board(): SkillBoard {
    return { skills: this.skills.map(found => this.entry(found)).sort(byLastUse), scanning: this.deps.transcripts.busy }
  }

  private async counted(): Promise<Usage> {
    return readSkillUsage((await read(join(this.deps.home, '.claude.json'))) ?? '{}')
  }

  // The skills as they are on disk, with what is known of their uses; the transcripts are read
  // again behind, at most every few minutes
  async list(): Promise<SkillBoard> {
    this.skills = await scanSkills(this.deps.home)
    this.usage = mergeUsage(await this.counted(), await this.deps.transcripts.known())
    if (this.now().getTime() - this.scannedAt > 5 * 60_000 && !this.deps.transcripts.busy) {
      this.scannedAt = this.now().getTime()
      void this.deps.transcripts
        .scan()
        .then(async scanned => {
          this.usage = mergeUsage(await this.counted(), scanned)
        })
        .catch(() => undefined)
        .finally(() => this.deps.onChange(this.board()))
    }
    return this.board()
  }

  private async find(id: string): Promise<FoundSkill> {
    let found = this.skills.find(skill => skill.id === id)
    if (!found) {
      this.skills = await scanSkills(this.deps.home)
      found = this.skills.find(skill => skill.id === id)
    }
    if (!found) throw new Error('Ce skill n’existe plus.')
    return found
  }

  // A skill of yours seen for the first time gets its v1: what it is before any edit
  async detail(id: string): Promise<SkillDetail> {
    const found = await this.find(id)
    const content = await readFile(found.file, 'utf8')
    const skill = this.entry(found)
    if (skill.editable) {
      const modified = await stat(found.file).then(info => info.mtime, () => this.now())
      await this.deps.versions.baseline(id, found.file, content, modified)
    }
    return {
      skill,
      content,
      versions: skill.editable ? await this.deps.versions.list(id) : [],
      draft: skill.editable && (await this.deps.versions.isDraft(id, content)),
    }
  }

  version(id: string, n: number): Promise<string> {
    return this.deps.versions.read(id, n)
  }

  async validate(id: string): Promise<SkillDetail> {
    const found = await this.find(id)
    if (found.source === 'plugin') throw new Error('Un skill de plugin se met à jour avec son plugin.')
    await this.deps.versions.validate(id, found.file, await readFile(found.file, 'utf8'), this.now())
    return this.detail(id)
  }

  async edit(id: string): Promise<void> {
    const found = await this.find(id)
    if (found.source === 'plugin') throw new Error('Un skill de plugin se met à jour avec son plugin.')
    const detail = await this.detail(id)
    await this.deps.openSession(editPrompt(found, detail.versions.at(-1)?.n ?? null), [dirname(found.file)])
  }
}
