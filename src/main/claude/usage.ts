import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

// When a skill was last called, from two places. Claude Code counts each skill it runs in
// ~/.claude.json (skillUsage); the transcripts keep every Skill call and every /command typed,
// sessions Claude Code no longer counts included. The transcripts weigh over a gigabyte, so Flux
// reads each one once and then only what was appended to it.

export interface UsageMark {
  // Epoch ms of the last use
  at: number
  count: number
}

export type Usage = Map<string, UsageMark>

interface UsageCache {
  // Bytes already read of each transcript
  files: Record<string, number>
  marks: Record<string, UsageMark>
}

const MARKERS = ['"name":"Skill"', '<command-name>']

function mark(usage: Usage, name: string, at: number): void {
  const clean = name.trim().replace(/^\//, '')
  if (!clean || !Number.isFinite(at)) return
  const current = usage.get(clean)
  usage.set(clean, { at: Math.max(current?.at ?? 0, at), count: (current?.count ?? 0) + 1 })
}

export function readSkillUsage(claudeJson: string): Usage {
  const usage: Usage = new Map()
  let parsed: { skillUsage?: Record<string, { usageCount?: number; lastUsedAt?: number }> }
  try {
    parsed = JSON.parse(claudeJson)
  } catch {
    return usage
  }
  for (const [name, entry] of Object.entries(parsed.skillUsage ?? {})) {
    if (typeof entry?.lastUsedAt === 'number') usage.set(name, { at: entry.lastUsedAt, count: entry.usageCount ?? 0 })
  }
  return usage
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => (block?.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('\n')
}

// One transcript line: a Skill tool call of the assistant, or a /command the user typed. Only the
// structure counts: a system prompt that quotes either one is not a use
export function readUsageLine(line: string, usage: Usage): void {
  if (!MARKERS.some(marker => line.includes(marker))) return
  // The shape of each API request carries the whole system prompt: big, and never a use
  if (line.slice(0, 64).includes('"type":"api-request-shape"')) return
  let entry: { type?: string; timestamp?: string; message?: { content?: unknown } }
  try {
    entry = JSON.parse(line)
  } catch {
    return
  }
  const at = Date.parse(entry.timestamp ?? '')
  const content = entry.message?.content
  if (entry.type === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name === 'Skill' && typeof block.input?.skill === 'string') {
        mark(usage, block.input.skill, at)
      }
    }
  } else if (entry.type === 'user') {
    const command = textOf(content)
      .trimStart()
      .match(/^(?:<command-message>[^<]*<\/command-message>\s*)?<command-name>\/?([^<\s]+)<\/command-name>/)
    if (command) mark(usage, command[1], at)
  }
}

// Reads from `start` to the last full line; returns where the next read starts
async function readFrom(path: string, start: number, end: number, usage: Usage): Promise<number> {
  if (end <= start) return start
  const decoder = new StringDecoder('utf8')
  let pending = ''
  for await (const chunk of createReadStream(path, { start, end: end - 1 })) {
    const text = pending + decoder.write(chunk as Buffer)
    const lines = text.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) readUsageLine(line, usage)
  }
  pending += decoder.end()
  return end - Buffer.byteLength(pending, 'utf8')
}

async function transcripts(root: string): Promise<string[]> {
  const found: string[] = []
  for (const project of await readdir(root).catch(() => [] as string[])) {
    const dir = join(root, project)
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(join(dir, entry.name))
      // A session's sub-agents keep their own transcripts beside it
      if (entry.isDirectory()) {
        const sub = join(dir, entry.name, 'subagents')
        for (const file of await readdir(sub).catch(() => [] as string[])) {
          if (file.endsWith('.jsonl')) found.push(join(sub, file))
        }
      }
    }
  }
  return found
}

export class TranscriptUsage {
  private cache: UsageCache = { files: {}, marks: {} }
  private loaded = false
  private scanning: Promise<Usage> | null = null

  constructor(
    private readonly root: string,
    private readonly cacheFile: string,
  ) {}

  get busy(): boolean {
    return this.scanning !== null
  }

  // What is known without reading anything new
  async known(): Promise<Usage> {
    await this.load()
    return new Map(Object.entries(this.cache.marks))
  }

  scan(): Promise<Usage> {
    this.scanning ??= this.run().finally(() => {
      this.scanning = null
    })
    return this.scanning
  }

  private async run(): Promise<Usage> {
    await this.load()
    const usage: Usage = new Map(Object.entries(this.cache.marks))
    const files: Record<string, number> = {}
    for (const path of await transcripts(this.root)) {
      const info = await stat(path).catch(() => null)
      if (!info) continue
      // A transcript rewritten shorter is read again from its start
      const known = this.cache.files[path] ?? 0
      const start = known <= info.size ? known : 0
      files[path] = await readFrom(path, start, info.size, usage).catch(() => start)
    }
    // Transcripts cleaned up since are forgotten, their uses are not
    this.cache = { files, marks: Object.fromEntries(usage) }
    await this.save()
    return usage
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.cacheFile, 'utf8')) as Partial<UsageCache>
      this.cache = { files: parsed.files ?? {}, marks: parsed.marks ?? {} }
    } catch {
      this.cache = { files: {}, marks: {} }
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.cacheFile), { recursive: true })
    const temporary = `${this.cacheFile}.tmp`
    await writeFile(temporary, JSON.stringify(this.cache))
    await rename(temporary, this.cacheFile)
  }
}

// The latest of both sources; the count is Claude Code's when it has one
export function mergeUsage(counted: Usage, read: Usage): Usage {
  const merged: Usage = new Map(read)
  for (const [name, entry] of counted) {
    const other = merged.get(name)
    merged.set(name, { at: Math.max(entry.at, other?.at ?? 0), count: entry.count || other?.count || 0 })
  }
  return merged
}
