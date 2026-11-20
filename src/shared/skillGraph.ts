// The steps of a skill and what each one reaches outside Claude, read from its Markdown alone.
// A skill is written as a procedure: its sections, its numbered points and the tools it names in
// backticks. Reading that structure is instant, free, and gives the same graph for the same text,
// so two versions compare step by step. Asking a model would cost a run per version and per
// change, and could draw two graphs for one text.

export type CallKind = 'mcp' | 'cli' | 'skill' | 'file' | 'web' | 'agent'

export interface SkillCall {
  kind: CallKind
  // Linear, gh, /gl_commit, Fichiers, Web, Sous-agent
  label: string
  // What exactly: the tools, the subcommands, the paths, the hosts
  details: string[]
}

export interface SkillStep {
  id: string
  title: string
  // Its numbered points, in a few words each
  points: string[]
  calls: SkillCall[]
}

export interface SkillGraph {
  steps: SkillStep[]
  // The sections that frame the skill rather than run in it: rules, constants, notes
  frame: string[]
  // Every outside call, all steps together
  calls: SkillCall[]
}

interface Section {
  title: string
  lines: string[]
}

const FRAME = /^(r[èe]gles?|rules?|notes?|constantes?|identit[ée]|posture|grille|formats?|exemples?|examples?|sources?|annexes?|r[ée]f[ée]rences?|glossaire|anti-?patterns?|[àa] [ée]viter|principes?|pi[èe]ges?|limites?|pr[ée]requis|ton\b|style\b|when to use|quand l.utiliser)/i
const PROCEDURE = /^(proc[ée]dure|[ée]tapes?|steps?|workflow|d[ée]roul[ée]|process(us)?|m[ée]thode|instructions?)\b/i
const NUMBERED = /^(\d+)[.)]\s+(.*)$/
const FENCE = /^\s*(```|~~~)/
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

const CLI = new Set([
  'gh',
  'git',
  'pnpm',
  'npm',
  'npx',
  'yarn',
  'eas',
  'expo',
  'wt',
  'curl',
  'uvx',
  'xcrun',
  'adb',
  'claude',
  'cursor',
  'docker',
  'psql',
  'kubectl',
  'gcloud',
  'aws',
  'fastlane',
  'pod',
  'osascript',
  'open',
])

// A server or a product as one reads it, whichever name its tools carry
const SERVICES: Array<[RegExp, string]> = [
  [/linear/i, 'Linear'],
  [/sentry/i, 'Sentry'],
  [/slack/i, 'Slack'],
  [/figma/i, 'Figma'],
  [/notion/i, 'Notion'],
  [/datadog/i, 'Datadog'],
  [/amplitude/i, 'Amplitude'],
  [/github/i, 'GitHub'],
  [/postgres/i, 'Postgres'],
  [/expo|\beas\b/i, 'Expo'],
  [/calendar|agenda/i, 'Google Agenda'],
  [/chrome/i, 'Chrome'],
  [/gmail/i, 'Gmail'],
  [/drive/i, 'Google Drive'],
]
// Products named in the prose, capitalised as products are, not as words
const MENTION = /\b(Linear|Sentry|Slack|Figma|Notion|Datadog|Amplitude|Postgres|Expo|EAS|Google (?:Agenda|Calendar))\b/g

const MAX_POINTS = 8
const MAX_DETAILS = 8
const POINT_WORDS = 8

function stripFrontmatter(text: string): string {
  const front = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return front ? text.slice(front[0].length) : text
}

// Markdown down to the words: no emphasis, no links, no code marks
function plain(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stepTitle(heading: string): string {
  return plain(heading)
    .replace(/^(\d+[.)]|[ée]tape\s+\d+\s*[:.–-]?|step\s+\d+\s*[:.–-]?)\s*/i, '')
    .replace(/\s*[:：]$/, '')
}

// A point by its bold lead when it has one, else by its first words
function pointLabel(item: string): string {
  const bold = item.match(/^\*\*(.+?)\*\*/) ?? item.match(/^__(.+?)__/)
  if (bold) return plain(bold[1]).replace(/\s*[:：.]$/, '')
  const words = plain(item).replace(/\s*[:：]\s.*$/, '').split(' ')
  const label = words.slice(0, POINT_WORDS).join(' ')
  return words.length > POINT_WORDS ? `${label}…` : label.replace(/[.:]$/, '')
}

// The H2 sections, the text before the first one apart; headings inside code do not count
function splitSections(body: string): { intro: string[]; sections: Section[] } {
  const intro: string[] = []
  const sections: Section[] = []
  let fenced = false
  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced
    const heading = fenced ? null : line.match(HEADING)
    if (heading && heading[1].length <= 2) {
      // The H1 is the skill's own title
      if (heading[1].length === 2) sections.push({ title: heading[2], lines: [] })
      continue
    }
    if (sections.length === 0) intro.push(line)
    else sections[sections.length - 1].lines.push(line)
  }
  return { intro, sections }
}

// Top-level numbered items, each with the lines that continue it
function numberedItems(lines: string[]): Section[] {
  const items: Section[] = []
  let fenced = false
  let current: Section | null = null
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced
    const match = fenced ? null : line.match(NUMBERED)
    if (match) {
      current = { title: match[2], lines: [] }
      items.push(current)
    } else if (!fenced && current && line.match(HEADING)) {
      current = null
    } else if (current) {
      current.lines.push(line)
    }
  }
  return items
}

function subHeadings(lines: string[]): Section[] {
  const parts: Section[] = []
  let fenced = false
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced
    const heading = fenced ? null : line.match(HEADING)
    if (heading && heading[1].length === 3) {
      parts.push({ title: heading[2], lines: [] })
      continue
    }
    parts[parts.length - 1]?.lines.push(line)
  }
  return parts
}

function serviceOf(name: string): string {
  const found = SERVICES.find(([pattern]) => pattern.test(name))
  if (found) return found[1]
  const bare = name.replace(/^plugin_[^_]+_/, '').replace(/^claude_ai_/, '')
  return bare.charAt(0).toUpperCase() + bare.slice(1)
}

function codeSpans(text: string): string[] {
  const spans: string[] = []
  let fenced = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) spans.push(line.trim())
    else for (const match of line.matchAll(/`([^`\n]+)`/g)) spans.push(match[1].trim())
  }
  return spans
}

class Calls {
  private readonly found = new Map<string, SkillCall>()

  add(kind: CallKind, label: string, detail?: string): void {
    const key = `${kind}:${label}`
    const call = this.found.get(key) ?? { kind, label, details: [] }
    if (detail && !call.details.includes(detail) && call.details.length < MAX_DETAILS) call.details.push(detail)
    this.found.set(key, call)
  }

  list(): SkillCall[] {
    const order: CallKind[] = ['mcp', 'cli', 'skill', 'agent', 'web', 'file']
    return [...this.found.values()].sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label),
    )
  }
}

// What a piece of a skill reaches outside Claude: MCP tools and the products they serve, command
// lines, other skills, sub-agents, the web and files
export function callsIn(text: string): SkillCall[] {
  const calls = new Calls()
  for (const match of text.matchAll(/\bmcp__([A-Za-z0-9.-]+(?:_[A-Za-z0-9.-]+)*?)__([A-Za-z0-9_-]+)/g)) {
    calls.add('mcp', serviceOf(match[1]), match[2])
  }
  for (const match of text.matchAll(MENTION)) calls.add('mcp', serviceOf(match[1]))
  for (const span of codeSpans(text)) {
    for (const segment of span.split(/&&|\|\||;|\|/)) {
      const words = segment.trim().replace(/^\$\s+/, '').split(/\s+/)
      if (!CLI.has(words[0])) continue
      const sub = words[1] && /^[a-z][\w:-]*$/.test(words[1]) ? `${words[0]} ${words[1]}` : words[0]
      calls.add('cli', words[0], sub)
    }
    if (/^\/[A-Za-z][\w-]*(:[\w-]+)?$/.test(span)) calls.add('skill', span)
    // A plugin's skill, called by its full name
    else if (/^[a-z][\w-]+:[a-z][\w-]+$/.test(span)) calls.add('skill', `/${span}`)
  }
  for (const match of text.matchAll(/\bskills?\s+`\/?([A-Za-z][\w:-]*)`/gi)) calls.add('skill', `/${match[1]}`)
  if (/\b(sous-agents?|subagents?|agent Explore)\b/i.test(text)) calls.add('agent', 'Sous-agent')
  for (const match of text.matchAll(/https?:\/\/([^\s/)`>\]'"]+)[^\s)`>\]'"]*/g)) calls.add('web', 'Web', match[1])
  if (/\b(WebFetch|WebSearch)\b/.test(text)) calls.add('web', 'Web')
  const paths = new Set<string>()
  for (const match of text.matchAll(/(?:~|\/Users\/[^/\s`]+)\/[^\s`'"),;*]+/g)) paths.add(match[0].replace(/[.:]$/, ''))
  for (const span of codeSpans(text)) {
    if (/^[\w.~<>-]*\/?[\w.<>/-]+\.(md|json|ya?ml|ts|tsx|js|py|sh|txt|ics|csv|toml)$/.test(span)) paths.add(span)
  }
  for (const path of paths) calls.add('file', 'Fichiers', path)
  return calls.list()
}

function step(id: number, title: string, lines: string[], points: string[]): SkillStep {
  return {
    id: `s${id}`,
    title: stepTitle(title) || `Étape ${id + 1}`,
    points: points.slice(0, MAX_POINTS),
    calls: callsIn([title, ...lines].join('\n')),
  }
}

function pointsOf(lines: string[]): string[] {
  const subs = subHeadings(lines)
  if (subs.length > 0) return subs.map(part => stepTitle(part.title))
  return numberedItems(lines).map(item => pointLabel(item.title))
}

// The procedure, as the skill writes it. A section named Procédure or Étapes (or the only one that
// is not a frame) spreads into its own sub-sections or numbered points; every other section is a
// step with its points inside. Rules, constants and notes frame the steps without being one. A skill
// naming itself (its own usage line) does not call itself.
export function skillGraph(text: string, self?: string): SkillGraph {
  const { intro, sections } = splitSections(stripFrontmatter(text))
  const frame = sections.filter(section => FRAME.test(stepTitle(section.title)))
  const working = sections.filter(section => !frame.includes(section))
  const steps: SkillStep[] = []
  const lone = working.length === 1 ? working[0] : null

  for (const section of working) {
    const spread = PROCEDURE.test(stepTitle(section.title)) || section === lone
    const subs = spread ? subHeadings(section.lines) : []
    const items = spread && subs.length === 0 ? numberedItems(section.lines) : []
    if (subs.length >= 2) {
      for (const sub of subs) steps.push(step(steps.length, sub.title, sub.lines, numberedItems(sub.lines).map(item => pointLabel(item.title))))
    } else if (items.length >= 2) {
      for (const item of items) steps.push(step(steps.length, pointLabel(item.title), [item.title, ...item.lines], []))
    } else {
      steps.push(step(steps.length, section.title, section.lines, pointsOf(section.lines)))
    }
  }

  // A skill without sections: its numbered points, or one block of instructions
  if (sections.length === 0) {
    const items = numberedItems(intro)
    if (items.length >= 2) {
      for (const item of items) steps.push(step(steps.length, pointLabel(item.title), [item.title, ...item.lines], []))
    } else if (intro.join('').trim()) {
      steps.push(step(0, 'Instructions', intro, []))
    }
  }

  const other = (call: SkillCall) => !(call.kind === 'skill' && self !== undefined && call.label === `/${self}`)
  for (const entry of steps) entry.calls = entry.calls.filter(other)
  const all = new Calls()
  for (const call of [...steps.flatMap(entry => entry.calls), ...callsIn(intro.join('\n')).filter(other)]) {
    for (const detail of call.details.length > 0 ? call.details : [undefined]) all.add(call.kind, call.label, detail)
  }
  return { steps, frame: frame.map(section => stepTitle(section.title)), calls: all.list() }
}
