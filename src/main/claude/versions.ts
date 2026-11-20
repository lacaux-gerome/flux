import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SkillVersion } from '../../shared/claude'

// The validated versions of a skill, kept by Flux outside every folder Claude Code reads. Claude
// loads ~/.claude/skills/<name>/SKILL.md and each .md of ~/.claude/commands: a copy beside them
// would load as a skill or a command of its own. So the file Claude reads stays the only live
// one, the working copy, and each validation freezes a copy of it here, read only:
//
//   ~/.flux/skills/<source>__<name>/versions.json   the list, with the hash of each version
//   ~/.flux/skills/<source>__<name>/v1.md, v2.md…   each version as validated, mode 444
//
// The file differs from the last version: that is a draft, and validating it makes the next one.

interface StoredVersion extends SkillVersion {
  sha: string
}

interface VersionIndex {
  file: string
  versions: StoredVersion[]
}

const sha = (content: string) => createHash('sha256').update(content).digest('hex')

export class SkillVersions {
  constructor(private readonly root: string) {}

  private dir(id: string): string {
    return join(this.root, id.replace(/[^\w.-]+/g, '__'))
  }

  private async index(id: string): Promise<VersionIndex | null> {
    try {
      const parsed = JSON.parse(await readFile(join(this.dir(id), 'versions.json'), 'utf8')) as VersionIndex
      return Array.isArray(parsed.versions) ? parsed : null
    } catch {
      return null
    }
  }

  async list(id: string): Promise<SkillVersion[]> {
    return ((await this.index(id))?.versions ?? []).map(({ n, at }) => ({ n, at }))
  }

  async read(id: string, n: number): Promise<string> {
    return readFile(join(this.dir(id), `v${n}.md`), 'utf8')
  }

  async isDraft(id: string, content: string): Promise<boolean> {
    const last = (await this.index(id))?.versions.at(-1)
    return last !== undefined && last.sha !== sha(content)
  }

  // A skill Flux sees for the first time: what it is now becomes v1
  async baseline(id: string, file: string, content: string, at: Date): Promise<void> {
    if ((await this.index(id))?.versions.length) return
    await this.write(id, { file, versions: [] }, content, at)
  }

  // The file as it is now becomes the next version; the ones before stay as they were
  async validate(id: string, file: string, content: string, at: Date): Promise<SkillVersion> {
    const index = (await this.index(id)) ?? { file, versions: [] }
    const last = index.versions.at(-1)
    if (last && last.sha === sha(content)) throw new Error(`Rien à valider : le fichier est la v${last.n}.`)
    return this.write(id, index, content, at)
  }

  private async write(id: string, index: VersionIndex, content: string, at: Date): Promise<SkillVersion> {
    const dir = this.dir(id)
    await mkdir(dir, { recursive: true })
    const n = (index.versions.at(-1)?.n ?? 0) + 1
    // wx: a version once written is never written over
    await writeFile(join(dir, `v${n}.md`), content, { flag: 'wx', mode: 0o444 })
    const version: StoredVersion = { n, at: at.toISOString(), sha: sha(content) }
    const next: VersionIndex = { file: index.file, versions: [...index.versions, version] }
    const temporary = join(dir, 'versions.json.tmp')
    await writeFile(temporary, JSON.stringify(next, null, 2))
    await rename(temporary, join(dir, 'versions.json'))
    return { n, at: version.at }
  }
}
