import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Check,
  ChevronDown,
  ChevronsLeftRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  ExternalLink,
  FileText,
  GitPullRequest,
  GitPullRequestDraft,
  GripVertical,
  Hand,
  Hourglass,
  KeyRound,
  LoaderCircle,
  Lock,
  Maximize2,
  MessagesSquare,
  Minimize2,
  Minus,
  Pause,
  PenLine,
  Play,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Scan,
  Search,
  Settings as Gear,
  Sparkles,
  SquareSlash,
  SquareTerminal,
  Trash2,
  UserRound,
  Waves,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { RANKS } from '../../shared/ranks'
import type { Rank } from '../../shared/types'
import { BrandIcon } from './Brand'
import { rankStyle, tint } from './rankStyle'
import { Stage } from './Stage'

// The motion of a feature in the changelog, played on a miniature of the Flux window, 960 by 600:
// what changed, where it lives, and a dive into it. The changelog writes its name and what it does
// above; the scene shows it. A before/after scene stacks two windows and a split wipes from one to
// the other. Every timing below is in seconds from the start of its scene.

const W = 960
const H = 600
const EASE = 'cubic-bezier(0.65, 0, 0.25, 1)'

// Camera: at time t, scale s, the window point x, y at the centre of the frame
type Cam = [t: number, s: number, x: number, y: number]
type View = [s: number, x: number, y: number]
// Cursor: at time t, at x, y in the window, shown or not
type Pt = [t: number, x: number, y: number, shown?: number]
type Click = [t: number, x: number, y: number]
// Spotlight: between two times, everything but this rectangle of the window dims
type Focus = [from: number, to: number, x: number, y: number, w: number, h: number, r: number]
// Split: at time t, the line between before (left) and after (right) sits at x, shown or not
type Split = [t: number, x: number, shown?: number]

function cam(t: number, view: View): Cam {
  return [t, ...view]
}

function camTransform([, s, x, y]: Cam): string {
  return `translate(${W / 2 - x * s}px, ${H / 2 - y * s}px) scale(${s})`
}

// A keyframes rule from timed steps, held between steps and eased through each move
function keyframes(name: string, total: number, steps: Array<[number, string]>): string {
  const all: Array<[number, string]> = [[0, steps[0][1]], ...steps, [total, steps[steps.length - 1][1]]]
  const frames = all.map(
    ([t, css]) => `${Math.min(100, (t / total) * 100).toFixed(3)}% { ${css} animation-timing-function: ${EASE}; }`,
  )
  return `@keyframes ${name} { ${frames.join(' ')} }`
}

function d(delay: number, extra: CSSProperties = {}): CSSProperties {
  return { '--d': `${delay}s`, ...extra } as CSSProperties
}

function span(from: number, to: number, extra: CSSProperties = {}): CSSProperties {
  return { '--d': `${from}s`, '--len': `${Math.max(0.1, to - from)}s`, ...extra } as CSSProperties
}

function pos(left: number, top: number, extra: CSSProperties = {}): CSSProperties {
  return { left, top, ...extra }
}

/* The window */

type Range = [from: number, to: number]

interface TabSpec {
  label: string
  width: number
  // A number, one change, or a number from each time on
  count?: number | [before: number, after: number, at: number] | Array<[t: number, value: number]>
  // Active between two times, or over several stretches
  on?: Range | Range[]
}

const TAB_ORDER = ['File', 'En cours', 'Attente', 'À démarrer', 'Mes PR', 'Journée', 'Claude']
const TAB_WIDTH: Record<string, number> = {
  File: 62,
  'En cours': 86,
  Attente: 80,
  'À démarrer': 98,
  'Mes PR': 76,
  Journée: 80,
  Claude: 86,
}
const TAB_COUNT: Record<string, number> = { File: 4, 'En cours': 2, Attente: 2, 'À démarrer': 2, 'Mes PR': 6 }
// Where the first tab starts: .w-tabs sits 4px left of it, its padding
const TABS_LEFT = 174
// The centre of each tab, for the cursor
const TAB_X: Record<string, number> = Object.fromEntries(
  TAB_ORDER.map((label, index) => [
    label,
    TABS_LEFT + TAB_ORDER.slice(0, index).reduce((sum, other) => sum + TAB_WIDTH[other], 0) + TAB_WIDTH[label] / 2,
  ]),
)
const TAB_Y = 32

// A spotlight on one tab of the bar, or on a run of them, between two times
function tabFocus(label: string, from: number, to: number, last = label): Focus {
  const left = TAB_X[label] - TAB_WIDTH[label] / 2 - 4
  const right = TAB_X[last] + TAB_WIDTH[last] / 2 + 4
  return [from, to, left, 12, right - left, 40, 20]
}

const ranges = (on: TabSpec['on']): Range[] =>
  on === undefined ? [] : typeof on[0] === 'number' ? [on as Range] : (on as Range[])

// A value that changes over time, each shown from its time to the next
function Ticker({ values }: { values: Array<[t: number, value: ReactNode]> }) {
  return (
    <span className="w-ticker">
      {values.map(([t, value], index) => (
        <span key={t} className="w-tick" style={span(t, values[index + 1]?.[0] ?? 999)}>
          {value}
        </span>
      ))}
    </span>
  )
}

function tabs(overrides: Record<string, Partial<TabSpec>>): TabSpec[] {
  return TAB_ORDER.map(label => ({
    label,
    width: TAB_WIDTH[label],
    count: TAB_COUNT[label],
    ...overrides[label],
  }))
}

function Count({ count }: { count: TabSpec['count'] }) {
  if (count === undefined) return null
  if (typeof count === 'number') return <span className="w-count">{count}</span>
  if (Array.isArray(count[0])) {
    return (
      <span className="w-count">
        <Ticker values={count as Array<[number, number]>} />
      </span>
    )
  }
  const [before, after, at] = count as [number, number, number]
  return (
    <span className="w-count swap">
      <span className="w-out" style={d(at)}>
        {before}
      </span>
      <span className="w-bump" style={d(at)}>
        {after}
      </span>
    </span>
  )
}

function TabLabel({ tab }: { tab: TabSpec }) {
  return (
    <span className="w-tab-label">
      {tab.label === 'Claude' && <BrandIcon brand="claude" size={12} />}
      {tab.label}
      <Count count={tab.count} />
    </span>
  )
}

function Tabs({ specs }: { specs: TabSpec[] }) {
  return (
    <div className="w-tabs">
      {specs.map(tab => (
        <span key={tab.label} className="w-tab" style={{ width: tab.width }}>
          <TabLabel tab={tab} />
          {/* The selected look covers the tab with its own dark label */}
          {ranges(tab.on).map(([from, to]) => (
            <span key={from} className="w-tab-on w-span" style={span(from, to)}>
              <TabLabel tab={tab} />
            </span>
          ))}
        </span>
      ))}
    </div>
  )
}

function Chrome({
  specs,
  className = '',
  style,
  children,
}: {
  specs: TabSpec[]
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <div className={`w-window ${className}`} style={style}>
      <div className="w-backdrop" />
      {children}
      <div className="w-topbar">
        <span className="w-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="w-brand">
          <span className="w-brand-mark">
            <Waves size={12} strokeWidth={2.4} />
          </span>
          Flux
        </span>
        <Tabs specs={specs} />
        <span className="w-round" style={pos(774, 14)}>
          <Sparkles size={13} />
        </span>
        <span className="w-note" style={pos(818, 14)}>
          Note
          <Plus size={12} />
        </span>
        <span className="w-round" style={pos(896, 14)}>
          <Gear size={13} />
        </span>
      </div>
    </div>
  )
}

function Toast({ from, to, text, top }: { from: number; to: number; text: string; top: number }) {
  return (
    <span className="w-toast w-span" style={span(from, to, { top })}>
      {text}
    </span>
  )
}

/* The real layout, drawn small: the topic at the bottom left, its links on the right, the rail
   along the bottom. Only the topic the scene is about is written out; the other cards are
   skeletons, so the eye goes where the change is */

const RAIL_TOP = 498
const railLeft = (index: number) => 38 + index * 194

interface Topic {
  ref: string
  // No rank: a card in Attente
  rank: Rank | null
  age: string
  title?: string
  busy?: boolean
  // The ticket's board column
  column?: string
  // Where it comes from, in front of the ref: a PR no topic holds yet, a Figma file
  brand?: 'github' | 'figma'
}

function TopicCard({
  topic,
  selected,
  className = '',
  style,
  children,
}: {
  topic: Topic
  selected?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
}) {
  return (
    <span
      className={`w-topic${selected ? ' selected' : ''} ${className}`}
      style={{ ...tint(rankStyle(topic.rank)), ...style }}
    >
      <span className="w-topic-head">
        {topic.brand && <BrandIcon brand={topic.brand} size={11} />}
        <b>{topic.ref}</b>
        {topic.column && <span className="w-pill">{topic.column}</span>}
        {children}
        <span className="w-topic-age">{topic.age}</span>
      </span>
      {topic.title ? (
        <span className="w-topic-title">{topic.title}</span>
      ) : (
        <>
          <i className="w-skel" />
          <i className="w-skel short" />
        </>
      )}
    </span>
  )
}

const SESSION_ACTIONS = (
  <>
    <span className="w-button solid">
      <BrandIcon brand="claude" size={14} />
      Ouvrir dans Claude
      <ArrowUpRight size={14} />
    </span>
    <span className="w-button">
      <BrandIcon brand="linear" size={13} />
      Voir le ticket
    </span>
  </>
)

function TopicHero({
  topic,
  meta,
  signal,
  extra,
  actions = SESSION_ACTIONS,
  className = '',
  style,
}: {
  topic: Topic
  meta: ReactNode[]
  signal?: ReactNode
  // Between the signal and the actions: the comments of a Figma file
  extra?: ReactNode
  actions?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const rank = topic.rank ?? 6
  const Icon = rankStyle(rank).icon
  return (
    <div className={`w-focus-hero ${className}`} style={style}>
      <span className="w-hero-rank">
        <span className="w-tile">
          <Icon size={13} strokeWidth={2.2} />
        </span>
        {RANKS[rank].label}
      </span>
      <h3 className="w-focus-title">{topic.title}</h3>
      <span className="w-focus-meta">
        {meta.map((entry, index) => (
          <span key={index}>{entry}</span>
        ))}
      </span>
      {signal && <span className="w-signal">{signal}</span>}
      {extra}
      <span className="w-focus-actions">
        {actions}
        <span className="w-button round">
          <Hand size={14} />
        </span>
        <span className="w-button round">
          <Check size={14} />
        </span>
      </span>
    </div>
  )
}

// A PR or ticket no topic holds: what it is, and one way out, to GitHub
function LooseHero({ topic, meta }: { topic: Topic; meta: string[] }) {
  return (
    <div className="w-focus-hero raised">
      <span className="w-hero-rank">
        <span className="w-tile">
          <Hourglass size={13} strokeWidth={2.2} />
        </span>
        En attente des autres
      </span>
      <h3 className="w-focus-title">{topic.title}</h3>
      <span className="w-focus-meta">
        {meta.map(entry => (
          <span key={entry}>{entry}</span>
        ))}
      </span>
      <span className="w-focus-actions">
        <span className="w-button solid">
          <BrandIcon brand="github" size={14} />
          Ouvrir sur GitHub
          <ArrowUpRight size={14} />
        </span>
      </span>
    </div>
  )
}

// A group of the rail: its label above its cards
function RailGroup({
  label,
  left,
  rank,
  icon,
  className = '',
  style: extra,
}: {
  label: string
  left: number
  rank?: Rank
  icon?: LucideIcon
  className?: string
  style?: CSSProperties
}) {
  const style = rank === undefined ? undefined : rankStyle(rank)
  const Icon = icon ?? style?.icon
  return (
    <span
      className={`w-group ${className}`}
      style={{ ...(style ? tint(style) : {}), left: left + 3, top: RAIL_TOP - 23, ...extra }}
    >
      {Icon && <Icon size={11} strokeWidth={2.4} />}
      {label}
    </span>
  )
}

const KIND_BRAND = { conversation: 'claude', ticket: 'linear', pr: 'github', figma: 'figma' } as const

function LinkRow({ kind, title, detail, className = '', style }: {
  kind: keyof typeof KIND_BRAND
  title: string
  detail: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={`w-row-link ${className}`} style={style}>
      <span className={`w-kind ${kind}`}>
        <BrandIcon brand={KIND_BRAND[kind]} size={13} />
      </span>
      <span className="w-row-text">
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      <ArrowUpRight size={13} className="w-row-go" />
    </span>
  )
}

// The panel on the right: the topic's links, then its note
function TopicLinks({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`w-inspector ${className}`} style={style}>
      <span className="w-inspector-label">Liens</span>
      <span className="w-rows">{children}</span>
      <span className="w-inspector-label">Note</span>
      <i className="w-skel" />
      <i className="w-skel short" />
    </div>
  )
}

// The before window, then the after one clipped to the right of the split line; at the end both
// step back and sit side by side
function Compare({ before, after, apart }: { before: ReactNode; after: ReactNode; apart: number }) {
  return (
    <>
      <div className="w-pane" style={d(apart)}>
        {before}
      </div>
      <div className="w-after" style={d(apart)}>
        {after}
      </div>
      <span className="w-pane-label w-in" style={d(apart + 0.6, pos(16, 110))}>
        Avant
      </span>
      <span className="w-pane-label now w-in" style={d(apart + 0.6, pos(493, 110))}>
        Maintenant
      </span>
    </>
  )
}

function Tag({ children, side, until }: { children: ReactNode; side: 'left' | 'right'; until: number }) {
  return (
    <span className={`w-tag ${side} w-span`} style={span(0, until)}>
      {children}
    </span>
  )
}

function State({ label, status = 'idle' }: { label: string; status?: 'idle' | 'busy' }) {
  return (
    <span className="w-state-line">
      <span className={`w-state ${status}`} />
      {label}
    </span>
  )
}

// The topic both windows show, and the conversation Flux now keeps in its links
const SESSION_TOPIC: Topic = { ref: 'OFF-1048', rank: 6, age: '2 h', title: 'Corriger l’enregistrement du fichier' }
const SESSION_TITLE = 'Diagnostic de l’enregistrement'
const SESSION_TICKET = <LinkRow kind="ticket" title="OFF-1048" detail="Impossible d’enregistrer le fichier" />

// En cours as it is now, the liveliest first: at work, waiting for you, paused in Claude
const AFTER_RAIL: Topic[] = [
  { ref: 'daca#1516', rank: 1, age: '16 j', busy: true },
  SESSION_TOPIC,
  { ref: 'daca#1600', rank: 4, age: '1 j' },
  { ref: 'aura#247', rank: 5, age: '3 j' },
]

// The scene's beats, in seconds
const HANDS_BACK = 4.4
const LEAVES = 6
const WIPE = 8.6
const ZOOM = 11.2
const CLICK = 13.6
const UNZOOM = 14.6
const RAIL_LOOK = 16.9
const APART = 19.8
// A touch smaller than the usual whole view, so the captions stay clear of the rail
const WINDOW_VIEW: View = [0.78, 480, 345]

function SessionsPicture() {
  const before = (
    <Chrome specs={tabs({ 'En cours': { on: [0, 99], count: [1, 0, LEAVES] } })}>
      <div className="w-layer w-out" style={d(LEAVES + 0.3)}>
        <TopicHero topic={SESSION_TOPIC} meta={[SESSION_TOPIC.ref, '1 sur 1']} />
        <TopicLinks>{SESSION_TICKET}</TopicLinks>
      </div>
      <TopicCard topic={SESSION_TOPIC} selected className="w-drop" style={d(LEAVES, pos(railLeft(0), RAIL_TOP))}>
        <Bot size={12} className="w-out" style={d(HANDS_BACK)} />
      </TopicCard>
      <h3 className="w-empty w-in" style={d(LEAVES + 0.6)}>
        Rien ici pour le moment.
      </h3>
      <Tag side="left" until={APART}>
        Avant
      </Tag>
    </Chrome>
  )
  const after = (
    <Chrome specs={tabs({ 'En cours': { on: [0, 99], count: AFTER_RAIL.length } })}>
      <div className="w-layer">
        <TopicHero topic={SESSION_TOPIC} meta={[SESSION_TOPIC.ref, '2 sur 4']} />
        <TopicLinks>
          <LinkRow
            kind="conversation"
            title={SESSION_TITLE}
            detail={<State label="T’attend" />}
            className="w-press"
            style={d(CLICK)}
          />
          {SESSION_TICKET}
        </TopicLinks>
      </div>
      {AFTER_RAIL.map((topic, index) => (
        <TopicCard
          key={topic.ref}
          topic={topic}
          selected={topic === SESSION_TOPIC}
          style={pos(railLeft(index), RAIL_TOP)}
        >
          {topic.busy && <Bot size={12} />}
        </TopicCard>
      ))}
      <Toast from={UNZOOM + 0.3} to={RAIL_LOOK - 0.2} text="Conversation rouverte dans Claude" top={530} />
      <Tag side="right" until={APART}>
        Maintenant
      </Tag>
    </Chrome>
  )
  return <Compare before={before} after={after} apart={APART} />
}

// An end-to-end PR with no ticket: alone in Attente before, a topic of Mes sujets now
const E2E_TITLE = 'Bloquer master sur la suite e2e'
const E2E: Topic = { ref: 'daca#1617', rank: 6, age: '2 h', title: E2E_TITLE }
const E2E_ROW = <LinkRow kind="pr" title={E2E.ref} detail={E2E_TITLE} />

// Attente as it was: my work, the PR alone among it, then what I took part in
const LOOSE_LEFT = railLeft(1)
const CONTRIBUTIONS_LEFT = railLeft(2) + 52
// File as it is now: what came back on my PRs, then my topics, the PR among them
const MINE_LEFT = railLeft(1) + 12
const MINE_RAIL: Topic[] = [
  { ref: 'OFF-989', rank: 6, age: '4 j', column: 'In Progress' },
  E2E,
  { ref: 'OFF-1070', rank: 6, age: '1 j', column: 'Todo Weekly' },
]
const mineLeft = (index: number) => MINE_LEFT + index * 194

const PR = {
  HERO: 4.4,
  WIPE: 7.4,
  ZOOM: 10.8,
  CLICK: 13.4,
  UNZOOM: 14.6,
  RAIL: 16.8,
  APART: 19.6,
}
// On « Remettre la PR au clair », the first action of the topic
const PR_BUTTON: [number, number] = [148, 439]

function PrPicture() {
  const before = (
    <Chrome specs={tabs({ File: { count: 3 }, Attente: { on: [0, 99], count: 3 } })}>
      <div className="w-layer">
        <LooseHero topic={E2E} meta={[E2E.ref, 'Pull request', 'ci/e2e-gate']} />
      </div>
      <RailGroup label="Mon travail · 2" left={railLeft(0)} icon={UserRound} />
      <TopicCard topic={{ ref: 'api#14428', rank: null, age: '3 j' }} style={pos(railLeft(0), RAIL_TOP)} />
      <TopicCard topic={{ ...E2E, rank: null, brand: 'github' }} selected style={pos(LOOSE_LEFT, RAIL_TOP)} />
      <i className="w-divider" style={pos(CONTRIBUTIONS_LEFT - 26, RAIL_TOP - 22)} />
      <RailGroup label="Mes contributions · 1" left={CONTRIBUTIONS_LEFT} icon={MessagesSquare} />
      <TopicCard topic={{ ref: 'aura#251', rank: null, age: '1 j' }} style={pos(CONTRIBUTIONS_LEFT, RAIL_TOP)} />
      <Tag side="left" until={PR.APART}>
        Avant
      </Tag>
    </Chrome>
  )
  const actions = (
    <>
      <span className="w-button solid w-press" style={d(PR.CLICK)}>
        <BrandIcon brand="claude" size={14} />
        Remettre la PR au clair
        <ArrowUpRight size={14} />
      </span>
      <span className="w-button">
        <BrandIcon brand="claude" size={13} />
        Lancer un thread
      </span>
    </>
  )
  const after = (
    <Chrome specs={tabs({ File: { on: [0, 99], count: 4 }, Attente: { count: 2 } })}>
      <div className="w-layer">
        <TopicHero
          topic={E2E}
          meta={[E2E.ref, '2 h d’attente', '3 sur 4']}
          signal="PR ouverte"
          actions={actions}
          className="raised"
        />
        <TopicLinks className="w-out" style={d(PR.CLICK + 0.3)}>
          {E2E_ROW}
        </TopicLinks>
        <TopicLinks className="w-in" style={d(PR.CLICK + 0.3)}>
          <LinkRow kind="conversation" title="Faire avancer la PR e2e" detail={<State label="Au travail" status="busy" />} />
          {E2E_ROW}
        </TopicLinks>
      </div>
      <RailGroup label={RANKS[1].label} left={railLeft(0)} rank={1} />
      <TopicCard topic={{ ref: 'daca#1516', rank: 1, age: '16 j' }} style={pos(railLeft(0), RAIL_TOP)} />
      <RailGroup label={RANKS[6].label} left={MINE_LEFT} rank={6} />
      {MINE_RAIL.map((topic, index) => (
        <TopicCard
          key={topic.ref}
          topic={topic}
          selected={topic === E2E}
          style={pos(mineLeft(index), RAIL_TOP)}
        >
          {topic === E2E && <Bot size={12} className="w-in" style={d(PR.CLICK + 0.5)} />}
        </TopicCard>
      ))}
      <Tag side="right" until={PR.APART}>
        Maintenant
      </Tag>
    </Chrome>
  )
  return <Compare before={before} after={after} apart={PR.APART} />
}

/* The scenes of 16 November: the rail as a set of slots, a selection ring that moves between
   them, cards that slide by whole slots, and the pages without a rail (Mes PR, Journée) */

// The selection ring of the rail, on one slot between two times
function Ring({ slot, from, to = 99 }: { slot: number; from: number; to?: number }) {
  return <span className="w-ring" style={span(from, to, pos(railLeft(slot), RAIL_TOP))} />
}

// Cards sliding along the rail by whole slots, from a time on
function shift(t: number, slots: number, extra: CSSProperties = {}): CSSProperties {
  return d(t, { '--dx': `${slots * 194}px`, ...extra } as CSSProperties)
}

const START_ACTIONS = (
  <>
    <span className="w-button solid">
      <BrandIcon brand="claude" size={14} />
      Lancer un thread
      <ArrowUpRight size={14} />
    </span>
    <span className="w-button">
      <BrandIcon brand="linear" size={13} />
      Voir le ticket
    </span>
  </>
)

// The file as the pages leave it: a topic not started yet, the rail under it
const NEXT: Topic = { ref: 'OFF-1070', rank: 3, age: '1 j', title: 'Relancer les paiements en échec', column: 'Todo' }
const NEXT_RAIL: Topic[] = [
  NEXT,
  { ref: 'OFF-1048', rank: 6, age: '2 h' },
  { ref: 'OFF-1081', rank: 6, age: '2 j' },
  { ref: 'OFF-1093', rank: 6, age: '4 j' },
]
const NEXT_HERO = (
  <>
    <TopicHero topic={NEXT} meta={[NEXT.ref, '1 sur 4']} signal="Une question de Claire" actions={START_ACTIONS} />
    <TopicLinks>
      <LinkRow kind="ticket" title={NEXT.ref} detail={NEXT.title} />
    </TopicLinks>
  </>
)

function FileView({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={`w-layer ${className}`} style={style}>
      {NEXT_HERO}
      {NEXT_RAIL.map((topic, index) => (
        <TopicCard key={topic.ref} topic={topic} selected={index === 0} style={pos(railLeft(index), RAIL_TOP)} />
      ))}
    </div>
  )
}

/* À démarrer: the file without what runs already, and En cours keeping the topic opened there */

const U_A: Topic = { ref: 'daca#1516', rank: 1, age: '16 j', title: 'Découper la synchro des agendas', busy: true }
const U_C: Topic = { ref: 'OFF-1048', rank: 6, age: '2 h', title: 'Corriger l’enregistrement du fichier', busy: true }
const U_QUEUE: Topic[] = [U_A, NEXT, U_C, { ref: 'OFF-1081', rank: 6, age: '2 j' }, { ref: 'OFF-1093', rank: 6, age: '4 j' }]
const U_UNSTARTED = U_QUEUE.filter(topic => !topic.busy)
const U_ACTIVE = U_QUEUE.filter(topic => topic.busy)

const U = { BOTS: 1.8, TAB: 5.2, ACTIVE: 10.4, PICK: 12.8 }
const U_PICK: [number, number] = [railLeft(1) + 110, RAIL_TOP + 46]

const U_A_PANEL = (
  <TopicLinks>
    <LinkRow kind="conversation" title="Synchro des agendas" detail={<State label="Au travail" status="busy" />} />
    <LinkRow kind="pr" title={U_A.ref} detail="2 retours de nicolas" />
  </TopicLinks>
)

function UnstartedPicture() {
  const specs = tabs({
    File: { on: [0, U.TAB], count: U_QUEUE.length },
    'En cours': { on: [U.ACTIVE, 99], count: U_ACTIVE.length },
    'À démarrer': { on: [U.TAB, U.ACTIVE], count: U_UNSTARTED.length },
  })
  return (
    <Chrome specs={specs}>
      <div className="w-layer w-out" style={d(U.TAB + 0.1)}>
        <TopicHero topic={U_A} meta={[U_A.ref, '1 sur 5']} signal="2 retours de nicolas" />
        {U_A_PANEL}
      </div>
      <div className="w-layer w-span" style={span(U.TAB + 0.3, U.ACTIVE + 0.1)}>
        <TopicHero topic={NEXT} meta={[NEXT.ref, '1 sur 3']} signal="Une question de Claire" actions={START_ACTIONS} />
        <TopicLinks>
          <LinkRow kind="ticket" title={NEXT.ref} detail={NEXT.title} />
        </TopicLinks>
      </div>
      <div className="w-layer w-span" style={span(U.ACTIVE + 0.3, U.PICK + 0.1)}>
        <TopicHero topic={U_A} meta={[U_A.ref, '1 sur 2']} signal="2 retours de nicolas" />
        {U_A_PANEL}
      </div>
      <div className="w-layer w-in" style={d(U.PICK + 0.3)}>
        <TopicHero topic={U_C} meta={[U_C.ref, '2 sur 2']} signal="Claude au travail" />
        <TopicLinks>
          <LinkRow kind="conversation" title={SESSION_TITLE} detail={<State label="Au travail" status="busy" />} />
          {SESSION_TICKET}
        </TopicLinks>
      </div>

      {/* The file, then À démarrer: what runs already leaves, the rest closes up */}
      <div className="w-layer w-out" style={d(U.ACTIVE + 0.1)}>
        {U_QUEUE.map((topic, index) => {
          const after = U_UNSTARTED.indexOf(topic)
          return (
            <TopicCard
              key={topic.ref}
              topic={topic}
              className={after < 0 ? 'w-drop' : after !== index ? 'w-shift' : ''}
              style={shift(U.TAB + 0.2, after - index, pos(railLeft(index), RAIL_TOP))}
            >
              {topic.busy && <Bot size={12} className="w-bump" style={d(U.BOTS)} />}
            </TopicCard>
          )
        })}
        <Ring slot={0} from={0} to={U.TAB + 0.1} />
        <Ring slot={0} from={U.TAB + 0.8} />
      </div>
      {/* En cours: the topic picked there stays selected there */}
      <div className="w-layer w-in" style={d(U.ACTIVE + 0.3)}>
        {U_ACTIVE.map((topic, index) => (
          <TopicCard key={topic.ref} topic={topic} style={pos(railLeft(index), RAIL_TOP)}>
            <Bot size={12} />
          </TopicCard>
        ))}
        <Ring slot={0} from={0} to={U.PICK} />
        <Ring slot={1} from={U.PICK} />
      </div>
    </Chrome>
  )
}

/* The split: each topic of the file has one place, by what I did of it. Nothing yet: À démarrer;
   under way, conversation or not: En cours; blocked or with another reviewer: Attente */

const SPLIT_TODO: Topic = { ref: 'api#14670', rank: 2, age: '1 h', title: 'Script de reprise des fiches' }
const SPLIT_FRAME: Topic = { ref: 'OFF-986', rank: 3, age: '4 j', column: 'To frame', title: 'Cadrer le CR vocal' }
const SPLIT_HELD: Topic = { ref: 'OFF-930', rank: 3, age: '2 j', column: 'Technical review', title: 'Export des factures' }
const SPLIT_CI: Topic = { ref: 'daca#1612', rank: 6, age: '3 j', title: 'Checks de la merge queue' }

type SplitPlace = 'todo' | 'started' | 'held'
const SPLIT_QUEUE: Array<{ topic: Topic; place: SplitPlace }> = [
  { topic: SPLIT_TODO, place: 'todo' },
  { topic: SPLIT_FRAME, place: 'todo' },
  { topic: SPLIT_HELD, place: 'held' },
  { topic: SPLIT_CI, place: 'started' },
]
const SPLIT_PLACE: Record<SplitPlace, { label: string; icon: LucideIcon }> = {
  todo: { label: 'À démarrer', icon: CircleDashed },
  started: { label: 'En cours', icon: LoaderCircle },
  held: { label: 'Attente', icon: Hourglass },
}
const inPlace = (place: SplitPlace) => SPLIT_QUEUE.filter(entry => entry.place === place).map(entry => entry.topic)

const S = { TAGS: 2.4, TODO: 6.2, STARTED: 9.6, HELD: 13, FILE: 16.2 }

// Above a card of the file: where it goes
function PlaceTag({ place, slot, at }: { place: SplitPlace; slot: number; at: number }) {
  const { label, icon: Icon } = SPLIT_PLACE[place]
  return (
    <span className={`w-place ${place} w-in`} style={d(at, pos(railLeft(slot), RAIL_TOP - 28))}>
      <Icon size={11} strokeWidth={2.4} />
      {label}
    </span>
  )
}

function SplitHero({ topic, meta, signal }: { topic: Topic; meta: string; signal: string }) {
  return (
    <>
      <TopicHero topic={topic} meta={[topic.ref, meta]} signal={signal} actions={START_ACTIONS} />
      <TopicLinks>
        <LinkRow kind={topic.ref.includes('#') ? 'pr' : 'ticket'} title={topic.ref} detail={topic.title} />
      </TopicLinks>
    </>
  )
}

function SplitRail({ topics }: { topics: Topic[] }) {
  return (
    <>
      {topics.map((topic, index) => (
        <TopicCard key={topic.ref} topic={topic} style={pos(railLeft(index), RAIL_TOP)} />
      ))}
      <Ring slot={0} from={0} />
    </>
  )
}

function SplitPicture() {
  const specs = tabs({
    File: { on: [[0, S.TODO], [S.FILE, 99]], count: SPLIT_QUEUE.length },
    'À démarrer': { on: [S.TODO, S.STARTED], count: inPlace('todo').length },
    'En cours': { on: [S.STARTED, S.HELD], count: inPlace('started').length },
    Attente: { on: [S.HELD, S.FILE], count: inPlace('held').length },
  })
  return (
    <Chrome specs={specs}>
      {/* The file: every topic, each tagged with its place, then À démarrer keeps the untouched ones */}
      <div className="w-layer w-out" style={d(S.TODO + 0.1)}>
        <SplitHero topic={SPLIT_TODO} meta="1 sur 4" signal="Review demandée par nicolas" />
      </div>
      <div className="w-layer w-span" style={span(S.TODO + 0.3, S.STARTED + 0.1)}>
        <SplitHero topic={SPLIT_TODO} meta="1 sur 2" signal="Review demandée par nicolas" />
      </div>
      <div className="w-layer w-out" style={d(S.STARTED + 0.1)}>
        {SPLIT_QUEUE.map(({ topic, place }, index) => (
          <TopicCard
            key={topic.ref}
            topic={topic}
            className={place === 'todo' ? '' : 'w-drop'}
            style={d(S.TODO + 0.2, pos(railLeft(index), RAIL_TOP))}
          />
        ))}
        <Ring slot={0} from={0} />
      </div>
      <div className="w-layer w-out" style={d(S.TODO - 0.4)}>
        {SPLIT_QUEUE.map(({ place }, index) => (
          <PlaceTag key={index} place={place} slot={index} at={S.TAGS + index * 0.25} />
        ))}
      </div>

      {/* En cours: what I took up, a conversation or not */}
      <div className="w-layer w-span" style={span(S.STARTED + 0.3, S.HELD + 0.1)}>
        <SplitHero topic={SPLIT_CI} meta="1 sur 1" signal="CI en échec" />
        <SplitRail topics={inPlace('started')} />
      </div>
      {/* Attente: blocked, or with another reviewer */}
      <div className="w-layer w-span" style={span(S.HELD + 0.3, S.FILE + 0.1)}>
        <SplitHero topic={SPLIT_HELD} meta="1 sur 1" signal="Technical review" />
        <SplitRail topics={inPlace('held')} />
      </div>
      {/* The file still lists everything */}
      <div className="w-layer w-in" style={d(S.FILE + 0.3)}>
        <SplitHero topic={SPLIT_TODO} meta="1 sur 4" signal="Review demandée par nicolas" />
        <SplitRail topics={SPLIT_QUEUE.map(entry => entry.topic)} />
      </div>
    </Chrome>
  )
}

/* Figma: a tool like Linear, one task per file, gone once every comment has its answer */

const FIGMA: Topic = { ref: 'App_aidant', brand: 'figma', rank: 3, age: '2 h', title: '3 commentaires Figma' }
const FIGMA_COMMENTS = [
  { who: 'Claire', text: 'Le bouton tient sur une ligne ?' },
  { who: 'Nicolas', text: 'On garde l’icône de la v1 ?' },
  { who: 'Inès', text: 'Marge à 16 ou à 24 ici ?' },
]
const F = { ON: 1.5, CLOSE: 2.7, FILE: 3.1, OPEN: 6.6, ANSWERS: [7.8, 8.8, 9.8], LEAVE: 11.2 }
const F_SWITCH: [number, number] = [618, 371]
const F_OPEN: [number, number] = [133, 451]
const FIGMA_TOOLS = [
  { brand: 'linear', label: 'Linear', on: true },
  { brand: 'jira', label: 'Jira', on: false },
  { brand: 'figma', label: 'Figma', on: false },
] as const

function ToolsPanel() {
  return (
    <div className="w-layer w-out" style={d(F.CLOSE)}>
      <span className="w-veil" />
      <div className="w-panel">
        <span className="w-panel-eyebrow">Tes outils</span>
        <h3 className="w-panel-title">Où vit ton travail ?</h3>
        {FIGMA_TOOLS.map(tool => (
          <span key={tool.brand} className="w-tool">
            <span className="w-tool-icon">
              <BrandIcon brand={tool.brand} size={15} />
            </span>
            {tool.label}
            <span className="w-switch">
              {tool.on && <span className="w-switch-on" />}
              {tool.brand === 'figma' && <span className="w-switch-on w-fade" style={d(F.ON)} />}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

function FigmaComments() {
  return (
    <span className="w-comments">
      {FIGMA_COMMENTS.map((comment, index) => (
        <span key={comment.who} className="w-comment">
          <span className="w-avatar w-dim" style={d(F.ANSWERS[index])}>
            {comment.who[0]}
          </span>
          <span className="w-comment-text w-dim" style={d(F.ANSWERS[index])}>
            <b>{comment.who}</b>
            {comment.text}
          </span>
          <span className="w-comment-done w-fade" style={d(F.ANSWERS[index])}>
            <Check size={11} strokeWidth={3} />
          </span>
        </span>
      ))}
    </span>
  )
}

function FigmaPicture() {
  const [first, second, third] = F.ANSWERS
  const left = (
    <Ticker
      values={[
        [0, '3 commentaires'],
        [first, '2 commentaires'],
        [second, '1 commentaire'],
        [third, 'Tout est répondu'],
      ]}
    />
  )
  const open = (
    <span className="w-button solid w-press" style={d(F.OPEN)}>
      <BrandIcon brand="figma" size={14} />
      Ouvrir dans Figma
      <ArrowUpRight size={14} />
    </span>
  )
  return (
    <Chrome specs={tabs({ File: { on: [0, 99], count: [[0, 4], [F.FILE, 5], [F.LEAVE + 0.2, 4]] } })}>
      <div className="w-layer w-out" style={d(F.FILE)}>
        {NEXT_HERO}
      </div>
      <div className="w-layer w-span" style={span(F.FILE + 0.3, F.LEAVE + 0.1)}>
        <TopicHero
          topic={{ ...FIGMA, title: 'App_aidant' }}
          meta={['Figma', left, '2 h']}
          extra={<FigmaComments />}
          actions={open}
        />
        <TopicLinks>
          <LinkRow kind="figma" title="App_aidant" detail="Fichier Figma" />
        </TopicLinks>
      </div>
      <div className="w-layer w-in" style={d(F.LEAVE + 0.4)}>
        {NEXT_HERO}
      </div>

      {/* The file makes room for the task, then closes up once it is done */}
      <div className="w-layer w-shift" style={shift(F.FILE, 1)}>
        <div className="w-layer w-shift" style={shift(F.LEAVE + 0.2, -1)}>
          {NEXT_RAIL.map((topic, index) => (
            <TopicCard key={topic.ref} topic={topic} style={pos(railLeft(index), RAIL_TOP)} />
          ))}
        </div>
      </div>
      <Ring slot={0} from={0} to={F.FILE} />
      <div className="w-layer w-drop" style={d(F.LEAVE)}>
        <TopicCard topic={FIGMA} className="w-bump" style={d(F.FILE + 0.2, pos(railLeft(0), RAIL_TOP))} />
        <Ring slot={0} from={F.FILE + 0.4} />
      </div>
      <Ring slot={0} from={F.LEAVE + 0.5} />
      <Toast from={F.LEAVE + 0.3} to={14} text="Tout est répondu : la tâche part" top={530} />
      <ToolsPanel />
    </Chrome>
  )
}

/* Reviews faites: out of the file and En cours once sent, back when asked again */

const REVIEW: Topic = { ref: 'aura#247', rank: 2, age: '1 j', title: 'Brancher React Query sur l’état du réseau' }
const R = { CLICK: 1.2, SENT: 2.6, LEAVE: 4.8, LATER: 7.6, BACK: 10.2 }
const R_BUTTON: [number, number] = [145, 450]
const REVIEW_ACTIONS = (
  <>
    <span className="w-button solid w-press" style={d(R.CLICK)}>
      <BrandIcon brand="claude" size={14} />
      Reviewer dans Claude
      <ArrowUpRight size={14} />
    </span>
    <span className="w-button">
      <BrandIcon brand="github" size={13} />
      Ouvrir sur GitHub
    </span>
  </>
)
const REVIEW_PR = <LinkRow kind="pr" title={REVIEW.ref} detail={REVIEW.title} />

function ReviewsPicture() {
  const thread = (
    <Ticker
      values={[
        [0, <State key="wait" label="T’attend" />],
        [R.CLICK + 0.3, <State key="busy" label="Au travail" status="busy" />],
        [R.SENT, <State key="sent" label="Review envoyée" />],
      ]}
    />
  )
  const specs = tabs({
    File: { on: [0, 99], count: [[0, 5], [R.LEAVE, 4], [R.BACK, 5]] },
    'En cours': { count: [3, 2, R.LEAVE] },
  })
  return (
    <Chrome specs={specs}>
      <div className="w-layer w-out" style={d(R.LEAVE)}>
        <TopicHero
          topic={REVIEW}
          meta={[REVIEW.ref, 'Review demandée', '1 sur 5']}
          signal="nicolas te demande une review"
          actions={REVIEW_ACTIONS}
        />
        <TopicLinks>
          <LinkRow kind="conversation" title="Review de aura#247" detail={thread} />
          {REVIEW_PR}
        </TopicLinks>
      </div>
      <div className="w-layer w-span" style={span(R.LEAVE + 0.3, R.BACK + 0.1)}>
        {NEXT_HERO}
      </div>
      <div className="w-layer w-in" style={d(R.BACK + 0.3)}>
        <TopicHero
          topic={REVIEW}
          meta={[REVIEW.ref, 'Review redemandée', '1 sur 5']}
          signal="nicolas te la redemande"
          actions={REVIEW_ACTIONS}
        />
        <TopicLinks>{REVIEW_PR}</TopicLinks>
      </div>

      <TopicCard topic={REVIEW} className="w-drop" style={d(R.LEAVE, pos(railLeft(0), RAIL_TOP))} />
      <TopicCard topic={REVIEW} className="w-bump" style={d(R.BACK + 0.2, pos(railLeft(0), RAIL_TOP))} />
      <div className="w-layer w-shift" style={shift(R.LEAVE + 0.15, -1)}>
        <div className="w-layer w-shift" style={shift(R.BACK, 1)}>
          {NEXT_RAIL.map((topic, index) => (
            <TopicCard key={topic.ref} topic={topic} style={pos(railLeft(index + 1), RAIL_TOP)} />
          ))}
        </div>
      </div>
      <Ring slot={0} from={0} />
      <Toast from={R.SENT} to={R.LEAVE - 0.2} text="Review envoyée sur GitHub" top={530} />
      <Toast from={R.LATER} to={R.BACK - 0.3} text="Deux jours plus tard…" top={250} />
    </Chrome>
  )
}

/* The pages: a column of sections, like Mes PR and Journée in the app */

function Sheet({
  title,
  sub,
  action,
  nav,
  children,
}: {
  title: string
  sub: ReactNode
  action?: ReactNode
  // Room for the Journée tabs, drawn apart so they stay put while the page changes under them
  nav?: boolean
  children: ReactNode
}) {
  return (
    <div className="w-sheet">
      {nav && <span className="w-sheet-nav" />}
      <span className="w-sheet-head">
        <span className="w-sheet-titles">
          <b>{title}</b>
          <small>{sub}</small>
        </span>
        {action}
      </span>
      {children}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <span className="w-section">
      <span className="w-section-title">
        {title}
        {count !== undefined && <span className="w-count">{count}</span>}
      </span>
      {children}
    </span>
  )
}

type Ci = 'ok' | 'fail' | 'run' | 'none'
interface MiniPull {
  num: string
  title: string
  draft?: boolean
  ci: Ci
  status: string
  rank: Rank | null
  age: string
}

const CI_ICON: Record<Ci, LucideIcon> = { ok: CircleCheck, fail: CircleX, run: LoaderCircle, none: CircleDashed }
const MY_PULLS: Array<{ repo: string; pulls: MiniPull[] }> = [
  {
    repo: 'daca',
    pulls: [
      { num: '#1617', title: 'Bloquer master sur la suite e2e', ci: 'ok', status: 'Prêt à merger', rank: 4, age: '2 h' },
      { num: '#1622', title: 'Ranger les tâches de fond', ci: 'fail', status: 'CI en échec', rank: 6, age: '5 h' },
    ],
  },
  {
    repo: 'aura',
    pulls: [
      { num: '#251', title: 'Brancher l’état du réseau', ci: 'run', status: '1 retour de nicolas', rank: 1, age: '1 j' },
      {
        num: '#253',
        title: 'Garder la session au réveil',
        draft: true,
        ci: 'none',
        status: 'Pas encore en review',
        rank: null,
        age: '2 j',
      },
    ],
  },
  {
    repo: 'nosila',
    pulls: [
      { num: '#88', title: 'Exporter les factures en CSV', ci: 'ok', status: 'En attente de review', rank: null, age: '3 j' },
    ],
  },
]
const P = { TAB: 1.5, PAGE: 1.8, ZOOM: 6, UNZOOM: 9, CLICK: 10 }
const P_ROW: [number, number] = [440, 322]

function PullRow({ pull, delay }: { pull: MiniPull; delay: number }) {
  const Ci = CI_ICON[pull.ci]
  const Badge = pull.draft ? GitPullRequestDraft : GitPullRequest
  return (
    <span className="w-check w-pull w-in" style={d(delay)}>
      <Ci size={15} className={`w-ci ${pull.ci}`} />
      <span className={`w-pr-state${pull.draft ? ' draft' : ''}`}>
        <Badge size={11} strokeWidth={2.4} />
        {pull.draft ? 'Draft' : 'Open'}
      </span>
      <span className="w-check-main">
        <b>
          <span className="w-check-ref">{pull.num}</span>
          {pull.title}
        </b>
        <small style={pull.rank === null ? undefined : { color: rankStyle(pull.rank).light }}>{pull.status}</small>
      </span>
      <span className="w-check-side">{pull.age}</span>
    </span>
  )
}

function PullsPicture() {
  const before = MY_PULLS.map((_, index) => MY_PULLS.slice(0, index).reduce((sum, group) => sum + group.pulls.length, 0))
  const refresh = (
    <span className="w-button small">
      <RefreshCw size={12} />
      Actualiser
    </span>
  )
  return (
    <Chrome specs={tabs({ File: { on: [0, P.TAB], count: 4 }, 'Mes PR': { on: [P.TAB, 99], count: 5 } })}>
      <FileView className="w-out" style={d(P.PAGE)} />
      <div className="w-layer w-in" style={d(P.PAGE + 0.1)}>
        <Sheet title="Mes PR" sub="5 PR ouvertes, tous projets confondus · synchro de 14:02" action={refresh}>
          {MY_PULLS.map((group, index) => (
            <Section key={group.repo} title={group.repo} count={group.pulls.length}>
              {group.pulls.map((pull, row) => (
                <PullRow key={pull.num} pull={pull} delay={P.PAGE + 0.2 + 0.07 * (before[index] + row)} />
              ))}
            </Section>
          ))}
        </Sheet>
      </div>
      <Toast from={P.CLICK + 0.3} to={12.6} text="Ouverte sur GitHub" top={530} />
    </Chrome>
  )
}

/* Journée: Daily and Wrap-up under one tab, which opens the last of the two */

const J = { TAB: 1.4, PAGE: 1.7, SUB: 5, AWAY: 8, BACK: 9.8 }
const J_WRAPUP: [number, number] = [280, 101]
const DAY_PLAN = [
  { ref: 'OFF-1048', title: 'Corriger l’enregistrement du fichier' },
  { ref: 'daca#1617', title: 'Bloquer master sur la suite e2e' },
  { ref: 'OFF-1070' },
]
const DAY_DONE = [
  { ref: 'daca#1617', title: 'Bloquer master sur la suite e2e' },
  { ref: 'aura#247', title: 'Review de l’état du réseau' },
  { ref: 'OFF-1048' },
]
const DAY_NEXT = [{ ref: 'OFF-1070' }, { ref: 'OFF-1081' }]

function DayRow({ icon: Icon, tone, line, side }: {
  icon: LucideIcon
  tone?: Ci
  line: { ref: string; title?: string }
  side?: string
}) {
  return (
    <span className="w-check">
      <Icon size={15} className={`w-ci ${tone ?? ''}`} />
      <span className="w-check-line">
        <span className="w-check-ref">{line.ref}</span>
        {line.title ?? <i className="w-skel" />}
      </span>
      <span className="w-check-side">{side}</span>
    </span>
  )
}

function DayTabs({ daily, wrapup }: { daily: Range[]; wrapup: Range[] }) {
  const specs: Array<[label: string, width: number, on: Range[]]> = [
    ['Daily', 66, daily],
    ['Wrap-up', 84, wrapup],
  ]
  return (
    <span className="w-subtabs">
      {specs.map(([label, width, on]) => (
        <span key={label} className="w-tab" style={{ width }}>
          <span className="w-tab-label">{label}</span>
          {on.map(([from, to]) => (
            <span key={from} className="w-tab-on w-span" style={span(from, to)}>
              <span className="w-tab-label">{label}</span>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

const DAILY_SHEET = (
  <Sheet nav title="Daily" sub="Lundi 16 novembre · synchro de 9:02">
    <Section title="Intentions du jour">
      {DAY_PLAN.map(line => (
        <DayRow key={line.ref} icon={GripVertical} line={line} />
      ))}
    </Section>
    <Section title="Santé prod">
      <span className="w-stats">
        <span className="w-stat">
          <b>2</b>
          <small>Erreurs app</small>
        </span>
        <span className="w-stat">
          <b>4,6</b>
          <small>Avis des stores</small>
        </span>
        <span className="w-stat">
          <b>99,9 %</b>
          <small>API</small>
        </span>
      </span>
    </Section>
  </Sheet>
)

const WRAPUP_SHEET = (
  <Sheet nav title="Wrap-up" sub="Lundi 16 novembre · 3 sujets avancés">
    <Section title="Fait aujourd’hui" count={DAY_DONE.length}>
      {DAY_DONE.map(line => (
        <DayRow key={line.ref} icon={CircleCheck} tone="ok" line={line} side="17:40" />
      ))}
    </Section>
    <Section title="Pour demain">
      {DAY_NEXT.map(line => (
        <DayRow key={line.ref} icon={CircleDashed} line={line} />
      ))}
    </Section>
  </Sheet>
)

function DayPicture() {
  const specs = tabs({
    File: { on: [[0, J.TAB], [J.AWAY, J.BACK]] },
    Journée: { on: [[J.TAB, J.AWAY], [J.BACK, 99]] },
  })
  const nav = <DayTabs daily={[[0, J.SUB]]} wrapup={[[J.SUB, 99]]} />
  return (
    <Chrome specs={specs}>
      <FileView className="w-out" style={d(J.PAGE)} />
      <div className="w-layer w-span" style={span(J.PAGE + 0.1, J.SUB + 0.1)}>
        {DAILY_SHEET}
      </div>
      <div className="w-layer w-span" style={span(J.SUB + 0.2, J.AWAY + 0.1)}>
        {WRAPUP_SHEET}
      </div>
      <FileView className="w-span" style={span(J.AWAY + 0.2, J.BACK + 0.1)} />
      <div className="w-layer w-in" style={d(J.BACK + 0.2)}>
        {WRAPUP_SHEET}
      </div>
      <div className="w-layer w-span" style={span(J.PAGE + 0.1, J.AWAY + 0.1)}>
        {nav}
      </div>
      <div className="w-layer w-in" style={d(J.BACK + 0.2)}>
        {nav}
      </div>
    </Chrome>
  )
}

/* Claude: what Claude does for you, in one tab. The skills, read as a graph and kept in versions;
   the MCP servers Claude loads; the tasks Flux runs. One move at a time, each in its own light */

const CL_MS = 57000
const CL = {
  TAB: 1.4,
  PAGE: 1.7,
  FILTER: 5,
  OPEN: 6.8,
  GRAPH: 7.4,
  PAN: 11.8,
  PANNED: 12.9,
  EDIT: 13.9,
  DRAFT: 16.8,
  VALIDATE: 19.2,
  MENU: 20.6,
  PICK: 21.6,
  MCP: 24.4,
  CHECKED: 26.4,
  AUTH: 27.8,
  AUTHED: 29,
  ADD: 31,
  NAME: 31.9,
  URL: 32.8,
  ADDED: 34,
  TRASH: 36.6,
  REMOVE: 37.3,
  TASKS: 39.6,
  NEW: 42.4,
  TITLE: 43.1,
  PROMPT: 43.9,
  ALLOW: 45.9,
  CREATE: 47.6,
  RUN: 49.2,
  RAN: 50.8,
  ROW: 51.8,
  SESSION: 53,
  END: 54.2,
}

// Where the cursor goes, in the window
const CL_AT = {
  mine: [388, 201],
  skill: [400, 442],
  grab: [756, 518],
  drop: [56, 518],
  edit: [825, 140],
  validate: [844, 140],
  version: [648, 140],
  older: [640, 200],
  mcpPart: [151, 97],
  connect: [733, 298],
  add: [726, 201],
  name: [480, 149],
  url: [480, 241],
  addSave: [636, 506],
  trash: [765, 394],
  confirm: [705, 394],
  tasksPart: [323, 157],
  newTask: [727, 201],
  title: [480, 149],
  prompt: [480, 248],
  sentry: [362, 400],
  linear: [296, 400],
  create: [639, 546],
  play: [766, 346],
  row: [420, 346],
  session: [671, 278],
} satisfies Record<string, [number, number]>

// The list rows, one under the other from the toolbar down
const slotTop = (slot: number) => 228 + 48 * slot
// The graph scrolls this far left when dragged
const PAN_X = -700

const CL_TRACKS: Record<string, Array<[number, string]>> = {
  // Dragged to its end, then drawn anew when the file changes and when an old version shows
  graph: [
    [CL.PAN, 'transform: translateX(0); opacity: 1;'],
    [CL.PANNED, `transform: translateX(${PAN_X}px); opacity: 1;`],
    [CL.DRAFT, `transform: translateX(${PAN_X}px); opacity: 1;`],
    [CL.DRAFT + 0.15, `transform: translateX(${PAN_X}px); opacity: 0;`],
    [CL.DRAFT + 0.16, 'transform: translateX(0); opacity: 0;'],
    [CL.DRAFT + 0.4, 'transform: translateX(0); opacity: 1;'],
    [CL.PICK + 0.05, 'transform: translateX(0); opacity: 1;'],
    [CL.PICK + 0.2, 'transform: translateX(0); opacity: 0;'],
    [CL.PICK + 0.45, 'transform: translateX(0); opacity: 1;'],
  ],
  // The minimap follows the drag
  view: [
    [CL.PAN, 'transform: translateX(0);'],
    [CL.PANNED, 'transform: translateX(44px);'],
    [CL.DRAFT + 0.16, 'transform: translateX(44px);'],
    [CL.DRAFT + 0.5, 'transform: translateX(0);'],
  ],
  // The version and the edit button make room for « Valider la v4 », then take it back
  bar: [
    [CL.DRAFT, 'transform: translateX(0);'],
    [CL.DRAFT + 0.3, 'transform: translateX(-120px);'],
    [CL.VALIDATE + 0.15, 'transform: translateX(-120px);'],
    [CL.VALIDATE + 0.45, 'transform: translateX(0);'],
  ],
  // Datadog comes first among the calls, the others move over for it
  chips: [
    [CL.DRAFT + 0.2, 'transform: translateX(0);'],
    [CL.DRAFT + 0.5, 'transform: translateX(79px);'],
    [CL.PICK + 0.1, 'transform: translateX(79px);'],
    [CL.PICK + 0.4, 'transform: translateX(0);'],
  ],
  // The servers under Postgres move up once it is gone
  tail: [
    [CL.REMOVE + 0.25, 'transform: translateY(0);'],
    [CL.REMOVE + 0.55, 'transform: translateY(-48px);'],
  ],
  // The claude.ai connectors make room for posthog, then for nothing
  connectors: [
    [CL.ADDED + 0.25, 'transform: translateY(0);'],
    [CL.ADDED + 0.55, 'transform: translateY(48px);'],
    [CL.REMOVE + 0.25, 'transform: translateY(48px);'],
    [CL.REMOVE + 0.55, 'transform: translateY(0);'],
  ],
}

const CL_CSS = Object.entries(CL_TRACKS)
  .map(([name, steps]) => keyframes(`w-cl-${name}`, CL_MS / 1000, steps))
  .join('\n')

const move = (name: string, extra: CSSProperties = {}): CSSProperties => ({
  animation: `w-cl-${name} ${CL_MS}ms linear both`,
  ...extra,
})

// Text that types itself, a piece at a time
function Typed({ text, at, step, by = 'word' }: { text: string; at: number; step: number; by?: 'word' | 'char' }) {
  const pieces = by === 'char' ? [...text] : text.split(/(?<= )/)
  return (
    <>
      {pieces.map((piece, index) => (
        <span key={index} className="w-fade" style={d(at + index * step)}>
          {piece}
        </span>
      ))}
    </>
  )
}

// A row of pills, one of them selected at a time
function Pills({
  items,
  className = '',
  style,
}: {
  items: Array<[label: ReactNode, width: number, on: Range[]]>
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={`w-subtabs ${className}`} style={style}>
      {items.map(([label, width, on], index) => (
        <span key={index} className="w-tab" style={{ width }}>
          <span className="w-tab-label">{label}</span>
          {on.map(([from, to]) => (
            <span key={from} className="w-tab-on w-span" style={span(from, to)}>
              <span className="w-tab-label">{label}</span>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

type Part = 'Skills' | 'MCP' | 'Tâches'
const PART_WIDTH: Record<Part, number> = { Skills: 62, MCP: 54, Tâches: 70 }

function Parts({ left, top, on }: { left: number; top: number; on: Partial<Record<Part, Range[]>> }) {
  const items = (Object.keys(PART_WIDTH) as Part[]).map(
    label => [label, PART_WIDTH[label], on[label] ?? []] as [ReactNode, number, Range[]],
  )
  return <Pills items={items} style={pos(left, top)} />
}

// The top of the tab while no skill is open: its name, what the part shows, the three parts
function ClaudeTop({ hint, on }: { hint: string; on: Partial<Record<Part, Range[]>> }) {
  return (
    <>
      <span className="w-sheet-titles" style={pos(170, 84)}>
        <b>Claude</b>
        <small>{hint}</small>
      </span>
      <Parts left={170} top={140} on={on} />
    </>
  )
}

// A button the cursor presses, at a place of the window
function Press({
  at,
  left,
  top,
  className = '',
  width,
  children,
}: {
  at?: number
  left: number
  top: number
  className?: string
  width?: number
  children: ReactNode
}) {
  return (
    <span style={pos(left, top)}>
      <span className={`w-button small w-cl-button ${className}${at === undefined ? '' : ' w-press'}`} style={d(at ?? 0, { width })}>
        {children}
      </span>
    </span>
  )
}

function JobLine({
  icon,
  skill,
  name,
  badge,
  meta,
  side,
  play,
  className,
  style,
}: {
  icon: ReactNode
  skill?: string
  name: string
  badge?: string
  meta: string
  side: ReactNode
  // When the cursor presses its play button
  play?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={`w-check w-job ${className ?? ''}`} style={style}>
      {icon}
      <span className="w-check-main">
        <b>
          {skill && <span className="w-check-ref">/{skill}</span>}
          {name}
          {badge && <span className="w-cl-badge">{badge}</span>}
        </b>
        <small>{meta}</small>
      </span>
      <span className="w-check-side">{side}</span>
      <span className={`w-job-play${play === undefined ? '' : ' w-press'}`} style={play === undefined ? undefined : d(play)}>
        <Play size={10} />
      </span>
    </span>
  )
}

function Segments({ options }: { options: string[] }) {
  return (
    <span className="w-seg" style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}>
      {options.map((option, index) => (
        <span key={option} className={index === 0 ? 'on' : undefined}>
          {option}
        </span>
      ))}
    </span>
  )
}

function McpChip({ label, on }: { label: string; on?: number }) {
  return (
    <span className="w-chip">
      <i />
      {label}
      {on !== undefined && (
        <span className="w-chip-on w-in" style={d(on)}>
          <i />
          {label}
        </span>
      )}
    </span>
  )
}

/* Skills */

const SOURCE_ICON = { skill: Sparkles, command: SquareSlash, plugin: Puzzle }

// Each skill and its slot under Tous, then under Mes skills
const CL_SKILLS: Array<{
  name: string
  source: keyof typeof SOURCE_ICON
  text: string
  used: string
  all: number | null
  mine: number | null
}> = [
  { name: 'gl_commit', source: 'command', text: 'Crée des commits propres à partir des changements en cours', used: 'il y a 4 j · 149×', all: 0, mine: 0 },
  { name: 'gl_take_comment_review', source: 'command', text: 'Traite les retours de review d’une PR', used: 'il y a 4 j · 33×', all: 1, mine: 1 },
  { name: 'design-taste-frontend', source: 'skill', text: 'Le skill anti-slop des pages front', used: 'il y a 7 j · 1×', all: 2, mine: 2 },
  { name: 'gl_diagnostic_bug', source: 'command', text: 'Diagnostic d’un bug à partir de Sentry ou de Linear', used: 'il y a 7 j · 40×', all: 3, mine: 3 },
  { name: 'frontend-design:frontend-design', source: 'plugin', text: 'Une direction visuelle franche pour le front', used: 'il y a 7 j · 6×', all: 4, mine: null },
  { name: 'slack:slack-messaging', source: 'plugin', text: 'Écrire un message Slack bien formé', used: 'il y a 8 j · 4×', all: 5, mine: null },
  { name: 'gl_linear_issue', source: 'command', text: 'Exécute un ticket Linear de bout en bout', used: 'il y a 10 j · 68×', all: 6, mine: 4 },
  { name: 'gl_cadrage_mobile', source: 'command', text: 'Co-écrit un cadrage tech app', used: 'il y a 12 j · 9×', all: 7, mine: 5 },
  { name: 'gl_jump_in', source: 'command', text: 'Un document jump-in à partir d’un cadrage', used: 'il y a 15 j · 7×', all: null, mine: 6 },
  { name: 'gl_create_linear_issue', source: 'command', text: 'Rédige une tâche Linear bien structurée', used: 'il y a 18 j · 12×', all: null, mine: 7 },
]

function SkillLine({ skill, className, style }: { skill: (typeof CL_SKILLS)[number]; className: string; style: CSSProperties }) {
  const Icon = SOURCE_ICON[skill.source]
  return (
    <span className={`w-check ${className}`} style={style}>
      <Icon size={15} className="w-ci" />
      <span className="w-check-main">
        <b>
          <span className="w-check-ref">/{skill.name}</span>
        </b>
        <small>{skill.text}</small>
      </span>
      <span className="w-check-side">{skill.used}</span>
    </span>
  )
}

function SkillRows() {
  return (
    <>
      {CL_SKILLS.map(skill => {
        const line = (className: string, style: CSSProperties) => (
          <SkillLine skill={skill} className={className} style={style} />
        )
        // Only under Mes skills: they come up from below the plugins
        if (skill.all === null) {
          return (
            <span key={skill.name} className="w-cl-slot" style={pos(170, slotTop(skill.mine ?? 0))}>
              {line('w-in', d(CL.FILTER + 0.45 + 0.06 * ((skill.mine ?? 0) - 6)))}
            </span>
          )
        }
        const enter = d(CL.PAGE + 0.2 + 0.05 * skill.all)
        // A plugin's: it leaves when the filter keeps only yours
        if (skill.mine === null) {
          return (
            <span key={skill.name} className="w-cl-slot w-out" style={d(CL.FILTER + 0.1, pos(170, slotTop(skill.all)))}>
              {line('w-in', enter)}
            </span>
          )
        }
        const lift = (skill.mine - skill.all) * 48
        return (
          <span
            key={skill.name}
            className={`w-cl-slot${lift ? ' w-lift' : ''}`}
            style={d(CL.FILTER + 0.25, pos(170, slotTop(skill.all), { '--dy': `${lift}px` } as CSSProperties))}
          >
            {line('w-in', enter)}
          </span>
        )
      })}
    </>
  )
}

function SkillsList() {
  const owners: Array<[ReactNode, number, Range[]]> = [
    [<>Tous<span className="w-count">67</span></>, 52, [[0, CL.FILTER]]],
    [<>Mes skills<span className="w-count">11</span></>, 84, [[CL.FILTER, 99]]],
    [<>Extérieurs<span className="w-count">56</span></>, 84, []],
  ]
  return (
    <div className="w-layer w-span" style={span(CL.PAGE + 0.1, CL.OPEN + 0.1)}>
      <ClaudeTop hint="Tes skills Claude Code, du plus récemment lancé au plus ancien." on={{ Skills: [[0, 99]] }} />
      <span className="w-cl-search" style={pos(170, 186)}>
        <Search size={12} />
        Chercher un skill
      </span>
      <Pills items={owners} className="w-cl-seg" style={pos(292, 186)} />
      <span className="w-cl-note" style={{ top: 194, right: 170 }}>
        <Ticker
          values={[
            [0, '67 skills, du plus récemment lancé au plus ancien'],
            [CL.FILTER + 0.1, '11 skills, du plus récemment lancé au plus ancien'],
          ]}
        />
      </span>
      <SkillRows />
    </div>
  )
}

/* An open skill: its graph, its versions */

type Kind = 'mcp' | 'cli' | 'skill' | 'agent' | 'file'
const KIND: Record<Kind, [label: string, icon: LucideIcon]> = {
  mcp: ['MCP', Plug],
  cli: ['Commande', SquareTerminal],
  skill: ['Skill', Sparkles],
  agent: ['Agent', Bot],
  file: ['Fichiers', FileText],
}
interface ClCall {
  kind: Kind
  label: string
  details?: string[]
}

// /gl_linear_issue as Flux reads it: its sections become the steps, what they reach the calls
const CL_STEPS: Array<{ title: string; points: string[]; calls: ClCall[] }> = [
  {
    title: 'Setup worktree',
    points: ['Vérifier la branche courante', 'Pull latest', 'Créer le worktree', 'Confirmer'],
    calls: [
      { kind: 'cli', label: 'git', details: ['git branch', 'git pull'] },
      { kind: 'cli', label: 'wt', details: ['wt', 'wt switch'] },
    ],
  },
  {
    title: 'Avant',
    points: ['Identité Linear', 'Passer le ticket en « In Progress »', 'Tout lire'],
    calls: [{ kind: 'mcp', label: 'Linear', details: ['list_users', 'save_issue'] }],
  },
  {
    title: 'Contexte',
    points: [],
    calls: [
      { kind: 'mcp', label: 'Figma', details: ['get_design_context'] },
      { kind: 'mcp', label: 'Sentry' },
    ],
  },
  {
    title: 'Standards',
    points: ['Règles du repo', 'Voisins récents', 'Reviews passées', 'Standards déjà capturés'],
    calls: [
      { kind: 'cli', label: 'gh', details: ['gh api'] },
      { kind: 'cli', label: 'git', details: ['git log'] },
      { kind: 'agent', label: 'Sous-agent' },
      { kind: 'file', label: 'Fichiers', details: ['.ai-rules/index.md'] },
    ],
  },
  { title: 'Plan', points: [], calls: [] },
  { title: 'Exécution', points: [], calls: [] },
  {
    title: 'Test local',
    points: [
      'Lance l’environnement',
      'Ouvre l’app dans le navigateur intégré',
      'Déroule les critères de validation',
      'Corrige ce qui diverge',
      'Rends compte',
    ],
    calls: [
      { kind: 'skill', label: '/anthropic-skills:built-in-browser' },
      { kind: 'skill', label: '/run' },
    ],
  },
  {
    title: 'Finition',
    points: ['Commit + push', 'Ouvrir une PR', 'Afficher la commande cursor'],
    calls: [
      { kind: 'mcp', label: 'Linear' },
      { kind: 'cli', label: 'cursor', details: ['cursor'] },
      { kind: 'cli', label: 'gh', details: ['gh pr'] },
      { kind: 'skill', label: '/gl_commit' },
    ],
  },
]
// What the edit in Claude adds to Contexte
const CL_DATADOG: ClCall = { kind: 'mcp', label: 'Datadog', details: ['search_datadog_logs'] }
// Every call of the skill, the way the page lists them: by kind, then by name
const CL_CHIPS: Array<[Kind, string]> = [
  ['mcp', 'Figma'],
  ['mcp', 'Linear'],
  ['mcp', 'Sentry'],
  ['cli', 'cursor'],
  ['cli', 'gh'],
  ['cli', 'git'],
  ['cli', 'wt'],
  ['skill', '/anthropic-skills:built-in-browser'],
  ['skill', '/gl_commit'],
  ['skill', '/run'],
  ['agent', 'Sous-agent'],
  ['file', 'Fichiers'],
]

// The graph, in the coordinates of its box: n8n's way, left to right, the calls hanging below
const GRAPH_LEFT = 60
const GRAPH_TOP = 268
const STEP_TOP = 20
const STEP_W = 140
const EDGE_Y = 37
const stepLeft = (index: number) => 186 + 176 * index
const stepHeight = (points: number) => (points === 0 ? 34 : 40 + 14 * Math.min(points, 5))
const callHeight = (call: ClCall) => 40 + 13 * Math.min(call.details?.length ?? 0, 2)
// The first four steps build up one after the other; the rest wait off to the right
const stepAt = (index: number) => CL.GRAPH + 0.45 + 0.55 * Math.min(index, 3.5)

function callTops(index: number, calls: ClCall[]): number[] {
  let top = STEP_TOP + stepHeight(CL_STEPS[index].points.length) + 16
  return calls.map(call => {
    const at = top
    top += callHeight(call) + 8
    return at
  })
}

function CallNode({ call, left, top, className = '', style }: {
  call: ClCall
  left: number
  top: number
  className?: string
  style?: CSSProperties
}) {
  const [kind, Icon] = KIND[call.kind]
  return (
    <span className={`w-cl-call ${call.kind} ${className}`} style={{ left, top, height: callHeight(call), ...style }}>
      <span className="w-cl-call-icon">
        <Icon size={12} />
      </span>
      <span className="w-cl-node-main">
        <span className="w-cl-kind">{kind}</span>
        <b>{call.label}</b>
        {call.details?.slice(0, 2).map(detail => (
          <code key={detail}>{detail}</code>
        ))}
      </span>
    </span>
  )
}

function GraphStep({ index }: { index: number }) {
  const step = CL_STEPS[index]
  const at = stepAt(index)
  const left = stepLeft(index)
  const height = stepHeight(step.points.length)
  const previous = index === 0 ? 166 : stepLeft(index - 1) + STEP_W
  const tops = callTops(index, step.calls)
  const bottom = STEP_TOP + height
  return (
    <>
      <span className="w-cl-edge w-draw" style={d(at - 0.15, { left: previous, top: EDGE_Y, width: left - previous })} />
      <span className="w-cl-step w-in" style={d(at, { left, top: STEP_TOP, height })}>
        <span className="w-cl-step-head">
          <i>{index + 1}</i>
          {step.title}
        </span>
        {step.points.length > 0 && (
          <ol>
            {step.points.slice(0, 5).map(point => (
              <li key={point}>{point}</li>
            ))}
          </ol>
        )}
      </span>
      {tops.length > 0 && (
        <span
          className="w-cl-rail w-grow"
          style={d(at + 0.2, {
            left: left + 10,
            top: bottom,
            height: tops[tops.length - 1] + callHeight(step.calls[tops.length - 1]) / 2 - bottom,
          })}
        />
      )}
      {step.calls.map((call, row) => (
        <Fragment key={row}>
          <span
            className="w-cl-stub w-fade"
            style={d(at + 0.3 + 0.08 * row, { left: left + 10, top: tops[row] + callHeight(call) / 2 })}
          />
          <CallNode call={call} left={left + 20} top={tops[row]} className="w-in" style={d(at + 0.3 + 0.08 * row)} />
        </Fragment>
      ))}
    </>
  )
}

// The minimap: every node drawn tiny, and the part of the graph in view
const MINI = 0.063
function MiniMap() {
  const boxes: Array<[number, number, number, number]> = [[16, 6, 150, 63]]
  CL_STEPS.forEach((step, index) => {
    boxes.push([stepLeft(index), STEP_TOP, STEP_W, stepHeight(step.points.length)])
    callTops(index, step.calls).forEach((top, row) => boxes.push([stepLeft(index) + 20, top, 120, callHeight(step.calls[row])]))
  })
  return (
    <span className="w-cl-mini">
      {boxes.map(([left, top, width, height], index) => (
        <i key={index} style={{ left: 2 + left * MINI, top: 20 + top * MINI, width: width * MINI, height: height * MINI }} />
      ))}
      <span className="w-cl-view" style={move('view', { left: 1, top: 14, width: 840 * MINI, height: 292 * MINI + 10 })} />
    </span>
  )
}

function SkillGraphBox() {
  const datadogTop = callTops(2, [...CL_STEPS[2].calls, CL_DATADOG])[2]
  const sentryTop = callTops(2, CL_STEPS[2].calls)[1]
  const contexte = stepLeft(2)
  return (
    <span className="w-cl-graph w-in" style={d(CL.OPEN + 0.3, pos(GRAPH_LEFT, GRAPH_TOP))}>
      <span className="w-cl-track" style={move('graph')}>
        <span className="w-cl-trigger w-in" style={d(CL.GRAPH, { left: 16, top: 6 })}>
          <span className="w-cl-trigger-icon">
            <Zap size={13} />
          </span>
          <span className="w-cl-node-main">
            <span className="w-cl-kind">Déclencheur</span>
            <b>/gl_linear_issue</b>
            <span className="w-cl-frame">Cadre : Notes</span>
          </span>
        </span>
        {CL_STEPS.map((_, index) => (
          <GraphStep key={index} index={index} />
        ))}
        {/* The call the edit adds, there from the draft until an older version shows */}
        <span
          className="w-cl-rail w-span"
          style={span(CL.DRAFT + 0.5, CL.PICK + 0.1, {
            left: contexte + 10,
            top: sentryTop + callHeight(CL_STEPS[2].calls[1]) / 2,
            height: datadogTop + callHeight(CL_DATADOG) / 2 - sentryTop - callHeight(CL_STEPS[2].calls[1]) / 2,
          })}
        />
        <span
          className="w-cl-stub w-span"
          style={span(CL.DRAFT + 0.5, CL.PICK + 0.1, { left: contexte + 10, top: datadogTop + callHeight(CL_DATADOG) / 2 })}
        />
        <span className="w-span" style={span(CL.DRAFT + 0.5, CL.PICK + 0.1, { left: contexte + 20, top: datadogTop })}>
          <CallNode call={CL_DATADOG} left={0} top={0} />
          <span className="w-cl-halo w-glow" style={span(CL.DRAFT + 0.6, CL.DRAFT + 1.9)} />
        </span>
      </span>
      <span className="w-cl-controls">
        <i>
          <Plus size={11} />
        </i>
        <i>
          <Minus size={11} />
        </i>
        <i>
          <Scan size={10} />
        </i>
      </span>
      <MiniMap />
    </span>
  )
}

function SkillHead() {
  return (
    <>
      <span className="w-cl-head" style={pos(60, 164)}>
        <SquareSlash size={16} />
        /gl_linear_issue
      </span>
      <span className="w-cl-desc" style={pos(60, 193)}>
        Exécute un ticket Linear de bout en bout : setup d’un worktree isolé, lecture du ticket, contexte (Figma /
        Sentry), standards du repo, plan, exécution, test local et PR.
      </span>
      <span className="w-cl-facts" style={pos(60, 214)}>
        Commande · il y a 10 j · 68 lancements
        <span className="w-cl-stack">
          <span className="w-cl-pill draft w-span" style={span(CL.DRAFT + 0.2, CL.VALIDATE + 0.1)}>
            brouillon à valider
          </span>
          <span className="w-cl-pill w-in" style={d(CL.PICK + 0.3)}>
            <Lock size={10} />
            version précédente, lecture seule
          </span>
        </span>
      </span>
      <span className="w-cl-chips" style={pos(60, 238)}>
        <span className="w-cl-chip-row" style={move('chips')}>
          {CL_CHIPS.map(([kind, label]) => {
            const Icon = KIND[kind][1]
            return (
              <span key={`${kind}:${label}`} className={`w-cl-chip ${kind}`}>
                <Icon size={10} />
                {label}
              </span>
            )
          })}
        </span>
        <span className="w-cl-chip mcp first w-span" style={span(CL.DRAFT + 0.45, CL.PICK + 0.1)}>
          <Plug size={10} />
          Datadog
        </span>
      </span>
    </>
  )
}

const CL_VERSIONS = [
  'v4 · 20 nov. 2026 · actuelle',
  'v3 · 12 nov. 2026 · lecture seule',
  'v2 · 4 nov. 2026 · lecture seule',
  'v1 · 28 oct. 2026 · lecture seule',
]

function SkillBar() {
  return (
    <>
      <Press left={60} top={125} width={78}>
        <ArrowLeft size={12} />
        Skills
      </Press>
      <Pills
        items={[
          ['Graphe', 64, [[0, 99]]],
          ['Contenu', 68, []],
        ]}
        className="w-cl-seg"
        style={pos(146, 125)}
      />
      <span className="w-cl-bar" style={move('bar')}>
        <span className="w-cl-label" style={pos(506, 133)}>
          Version
        </span>
        <span style={pos(554, 125)}>
          <span className="w-cl-select w-press" style={d(CL.MENU)}>
            <Ticker
              values={[
                [0, 'v3 · 12 nov. 2026 · actuelle'],
                [CL.DRAFT, 'Brouillon · non validé'],
                [CL.VALIDATE + 0.1, CL_VERSIONS[0]],
                [CL.PICK + 0.1, CL_VERSIONS[1]],
              ]}
            />
            <ChevronDown size={12} />
          </span>
        </span>
        <Press left={750} top={125} at={CL.EDIT} width={150}>
          <PenLine size={12} />
          Éditer dans Claude
        </Press>
      </span>
      <span className="w-span" style={span(CL.DRAFT + 0.1, CL.VALIDATE + 0.1, pos(788, 125))}>
        <span className="w-button small solid w-cl-button w-press" style={d(CL.VALIDATE, { width: 112 })}>
          <BadgeCheck size={12} />
          Valider la v4
        </span>
      </span>
      <span className="w-cl-menu w-span" style={span(CL.MENU + 0.15, CL.PICK + 0.1, pos(554, 160))}>
        {CL_VERSIONS.map((version, index) => (
          <span key={version} className="w-cl-option">
            {index === 1 && <span className="w-cl-hover w-glow" style={span(CL.PICK - 0.35, CL.PICK + 0.2)} />}
            {index === 0 && <Check size={11} />}
            {version}
          </span>
        ))}
      </span>
    </>
  )
}

function SkillDetail() {
  return (
    <div className="w-layer w-span" style={span(CL.OPEN + 0.2, CL.MCP + 0.1)}>
      <Parts left={60} top={80} on={{ Skills: [[0, CL.MCP]], MCP: [[CL.MCP, 99]] }} />
      <SkillBar />
      <SkillHead />
      <SkillGraphBox />
      <span className="w-cl-path" style={pos(60, 570)}>
        ~/.claude/commands/gl_linear_issue.md
      </span>
    </div>
  )
}

// A Claude Desktop session over Flux: what was asked, what Claude did
function ClaudeCard({
  from,
  to,
  title,
  ask,
  typed,
  answer,
  answerAt,
  left,
  top,
}: {
  from: number
  to: number
  title: string
  ask: string
  typed?: number
  answer: ReactNode
  answerAt: number
  left: number
  top: number
}) {
  return (
    <div className="w-layer">
      <span className="w-cl-claude w-span" style={span(from, to, pos(left, top))}>
        <span className="w-cl-claude-head">
          <BrandIcon brand="claude" size={14} />
          <b>Claude</b>
          <small>{title}</small>
        </span>
        <span className="w-cl-ask">{typed === undefined ? ask : <Typed text={ask} at={typed} step={0.09} />}</span>
        <span className="w-cl-answer w-in" style={d(answerAt)}>
          {answer}
        </span>
      </span>
    </div>
  )
}

/* MCP */

type Health = 'ok' | 'auth' | 'failed'
const HEALTH: Record<Health, [label: string, icon: LucideIcon]> = {
  ok: ['connecté', CircleCheck],
  auth: ['à connecter', CircleAlert],
  failed: ['injoignable', CircleX],
}

function McpLine({
  name,
  meta,
  icons,
  pills,
  button = 'refresh',
  keyUntil,
  press,
  locked,
  trash,
}: {
  name: string
  meta: string
  icons: Array<[t: number, state: Health | 'busy']>
  pills: Array<[t: number, health: Health]>
  button?: 'key' | 'refresh'
  keyUntil?: number
  press?: number
  locked?: boolean
  trash?: number
}) {
  const reconnect =
    button === 'key' ? (
      keyUntil === undefined ? (
        <KeyRound size={12} />
      ) : (
        <Ticker
          values={[
            [0, <KeyRound key="key" size={12} />],
            [keyUntil, <RefreshCw key="again" size={12} />],
          ]}
        />
      )
    ) : (
      <RefreshCw size={12} />
    )
  return (
    <span className="w-check w-cl-mcp">
      <Ticker
        values={icons.map(([t, state]): [number, ReactNode] => {
          if (state === 'busy') return [t, <LoaderCircle key={t} size={15} className="w-ci spin" />]
          const Icon = HEALTH[state][1]
          return [t, <Icon key={t} size={15} className={`w-ci ${state}`} />]
        })}
      />
      <span className="w-check-main">
        <b>
          {name}
          <Ticker
            values={pills.map(([t, health]): [number, ReactNode] => [
              t,
              <span key={t} className={`w-cl-pill ${health}`}>
                {HEALTH[health][0]}
              </span>,
            ])}
          />
        </b>
        <small>{meta}</small>
      </span>
      <span className="w-cl-actions">
        <span className={`w-cl-round${press === undefined ? '' : ' w-press'}`} style={press === undefined ? undefined : d(press)}>
          {reconnect}
        </span>
        <span
          className={`w-cl-round${locked ? ' locked' : ''}${trash === undefined ? '' : ' w-press'}`}
          style={trash === undefined ? undefined : d(trash)}
        >
          <Trash2 size={12} />
        </span>
      </span>
      {trash !== undefined && (
        <span className="w-cl-armed w-span" style={span(trash + 0.05, CL.REMOVE + 0.15)}>
          <Trash2 size={12} />
          Retirer « postgres »
        </span>
      )}
    </span>
  )
}

// claude mcp list answers server by server
const checked = (index: number) => CL.MCP + 0.9 + 0.25 * index

function McpPart() {
  return (
    <div className="w-layer w-span" style={span(CL.MCP + 0.2, CL.TASKS + 0.1)}>
      <ClaudeTop
        hint="Les serveurs MCP que Claude Code charge, et leur état."
        on={{ MCP: [[0, CL.TASKS]], Tâches: [[CL.TASKS, 99]] }}
      />
      <span className="w-cl-note" style={pos(170, 194)}>
        <Ticker
          values={[
            [
              0,
              <>
                <LoaderCircle size={11} className="spin" />
                Claude vérifie chaque serveur…
              </>,
            ],
            [CL.CHECKED, 'Vérifiés à l’instant par claude mcp list'],
          ]}
        />
      </span>
      <Press left={550} top={186} width={106}>
        <RefreshCw size={11} />
        Tout vérifier
      </Press>
      <Press left={662} top={186} at={CL.ADD} className="solid" width={128}>
        <Plus size={12} />
        Ajouter un MCP
      </Press>
      <span className="w-cl-slot w-in" style={d(CL.MCP + 0.3, pos(170, slotTop(0)))}>
        <McpLine
          name="Linear"
          meta="Plugin · HTTP · https://mcp.linear.app/mcp"
          icons={[[0, 'busy'], [checked(0), 'ok']]}
          pills={[[checked(0), 'ok']]}
          locked
        />
      </span>
      <span className="w-cl-slot w-in" style={d(CL.MCP + 0.35, pos(170, slotTop(1)))}>
        <McpLine
          name="Sentry"
          meta="Utilisateur · HTTP · https://mcp.sentry.dev/mcp"
          icons={[[0, 'busy'], [checked(1), 'auth'], [CL.AUTH + 0.1, 'busy'], [CL.AUTHED, 'ok']]}
          pills={[[checked(1), 'auth'], [CL.AUTHED, 'ok']]}
          button="key"
          keyUntil={CL.AUTHED}
          press={CL.AUTH}
        />
      </span>
      <span className="w-cl-slot w-in" style={d(CL.MCP + 0.4, pos(170, slotTop(2)))}>
        <McpLine
          name="Datadog"
          meta="Utilisateur · HTTP · https://mcp.datadoghq.com/v1/mcp"
          icons={[[0, 'busy'], [checked(2), 'ok']]}
          pills={[[checked(2), 'ok']]}
        />
      </span>
      <span className="w-cl-slot w-out" style={d(CL.REMOVE + 0.15, pos(170, slotTop(3)))}>
        <span className="w-in" style={d(CL.MCP + 0.45)}>
          <McpLine
            name="Postgres"
            meta="Utilisateur · commande · uvx postgres-mcp --access-mode=restricted"
            icons={[[0, 'busy'], [checked(3), 'failed'], [CL.REMOVE, 'busy']]}
            pills={[[checked(3), 'failed']]}
            trash={CL.TRASH}
          />
        </span>
      </span>
      <span className="w-cl-slot" style={move('tail', pos(170, slotTop(4)))}>
        <span className="w-in" style={d(CL.MCP + 0.5)}>
          <McpLine
            name="Amplitude"
            meta="Utilisateur · HTTP · https://mcp.amplitude.com/mcp"
            icons={[[0, 'busy'], [checked(4), 'ok']]}
            pills={[[checked(4), 'ok']]}
          />
        </span>
      </span>
      <span className="w-cl-slot" style={move('tail', pos(170, slotTop(5)))}>
        <span className="w-in" style={d(CL.ADDED + 0.5)}>
          <McpLine
            name="Posthog"
            meta="Utilisateur · HTTP · https://mcp.posthog.com/mcp"
            icons={[[0, 'busy'], [CL.ADDED + 1.4, 'ok']]}
            pills={[[CL.ADDED + 1.4, 'ok']]}
          />
        </span>
      </span>
      <span className="w-cl-slot" style={move('connectors', pos(170, slotTop(5) + 4))}>
        <span className="w-cl-subhead w-in" style={d(CL.MCP + 0.55)}>
          Connecteurs claude.ai
        </span>
        <span className="w-in" style={d(CL.MCP + 0.6, { marginTop: 6 })}>
          <McpLine
            name="Notion"
            meta="claude.ai"
            icons={[[0, 'busy'], [checked(5), 'ok']]}
            pills={[[checked(5), 'ok']]}
            locked
          />
        </span>
      </span>
    </div>
  )
}

function McpForm() {
  return (
    <div className="w-layer w-span" style={span(CL.ADD + 0.2, CL.ADDED + 0.1)}>
      <span className="w-scrim" />
      <span className="w-job-form" style={{ top: 64 }}>
        <span className="w-job-form-head">
          <b>Ajouter un MCP</b>
          <span className="w-cl-round">
            <X size={12} />
          </span>
        </span>
        <span className="w-field">
          <small>Nom</small>
          <span className="w-input">
            <span className="w-cl-stack">
              <span className="w-cl-placeholder w-out" style={d(CL.NAME)}>
                sentry
              </span>
              <span>
                <Typed text="posthog" at={CL.NAME} step={0.06} by="char" />
              </span>
            </span>
          </span>
        </span>
        <span className="w-field">
          <small>Type</small>
          <Segments options={['HTTP', 'SSE', 'Commande']} />
          <span className="w-input">
            <span className="w-cl-stack">
              <span className="w-cl-placeholder w-out" style={d(CL.URL)}>
                https://mcp.exemple.com/mcp
              </span>
              <span>
                <Typed text="https://mcp.posthog.com/mcp" at={CL.URL} step={0.03} by="char" />
              </span>
            </span>
          </span>
          <small>Si le serveur demande une connexion, « Reconnecter » ouvrira ton navigateur.</small>
        </span>
        <span className="w-field">
          <small>Portée</small>
          <Segments options={['Tous tes projets', '~/Desktop/ouihelp seulement']} />
        </span>
        <span className="w-field">
          <small>En-têtes</small>
          <span className="w-input tall w-cl-placeholder">Authorization: Bearer …</span>
        </span>
        <span className="w-field">
          <small>Variables d’environnement</small>
          <span className="w-input tall w-cl-placeholder">API_KEY=…</span>
        </span>
        <span className="w-job-form-foot">
          <span className="w-button small">Annuler</span>
          <span className="w-button small solid w-press" style={d(CL.ADDED)}>
            Ajouter le MCP
          </span>
        </span>
      </span>
    </div>
  )
}

/* Tasks */

const TASK_MCPS: Array<[label: string, on?: number]> = [
  ['Linear', CL.ALLOW + 0.5],
  ['Sentry', CL.ALLOW],
  ['Datadog'],
  ['Amplitude'],
  ['Posthog'],
  ['Notion'],
]

function TaskForm() {
  return (
    <div className="w-layer w-span" style={span(CL.NEW + 0.2, CL.CREATE + 0.1)}>
      <span className="w-scrim" />
      <span className="w-job-form" style={{ top: 64 }}>
        <span className="w-job-form-head">
          <b>Nouvelle tâche</b>
          <span className="w-cl-switch">
            <span className="w-switch" />
            Actif
          </span>
        </span>
        <span className="w-field">
          <small>Nom</small>
          <span className="w-input">
            <span>
              <Typed text="Point Sentry du matin" at={CL.TITLE} step={0.1} />
            </span>
          </span>
        </span>
        <span className="w-field">
          <small>Action</small>
          <Segments options={['Un prompt', 'Une skill']} />
          <span className="w-input tall">
            <span>
              <Typed
                text="Liste les nouvelles erreurs Sentry de la nuit et ouvre un ticket Linear pour chacune."
                at={CL.PROMPT}
                step={0.06}
              />
            </span>
          </span>
        </span>
        <span className="w-field">
          <small>Récurrence</small>
          <Segments options={['Certains jours', 'Toutes les heures', 'À la demande']} />
          <span className="w-days">
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => (
              <span key={index} className={index < 5 ? 'on' : undefined}>
                {day}
              </span>
            ))}
            <span className="w-time">
              <Clock size={11} />
              09:30
            </span>
          </span>
        </span>
        <span className="w-field">
          <small>MCP autorisés</small>
          <span className="w-chips">
            {TASK_MCPS.map(([label, on]) => (
              <McpChip key={label} label={label} on={on} />
            ))}
          </span>
          <small>
            <Ticker
              values={[
                [0, 'Aucun coché : la tâche tourne sans MCP.'],
                [CL.ALLOW + 0.1, 'La tâche n’a accès qu’aux MCP cochés, les autres lui sont refusés.'],
              ]}
            />
          </small>
        </span>
        <span className="w-cl-pair">
          <span className="w-field">
            <small>Dossier</small>
            <span className="w-input">~/Desktop/ouihelp</span>
          </span>
          <span className="w-field">
            <small>Permissions</small>
            <Segments options={['Auto', 'Strict']} />
          </span>
        </span>
        <span className="w-job-form-foot">
          <span className="w-button small">Annuler</span>
          <span className="w-button small solid w-press" style={d(CL.CREATE)}>
            Créer la tâche
          </span>
        </span>
      </span>
    </div>
  )
}

// An existing task opened: its form, then the runs, each a Claude session
function TaskRuns() {
  return (
    <div className="w-layer w-span" style={span(CL.ROW + 0.2, CL.END - 0.2)}>
      <span className="w-scrim" />
      <span className="w-job-form" style={{ top: 130 }}>
        <span className="w-job-form-head">
          <b>Point Sentry du matin</b>
          <span className="w-cl-switch">
            <span className="w-switch" />
            Actif
          </span>
        </span>
        <span className="w-cl-skels">
          <i className="w-skel" />
          <i className="w-skel short" />
          <i className="w-skel" />
        </span>
        <span className="w-field">
          <small>Dernières exécutions</small>
          <span className="w-cl-run">
            <CircleCheck size={14} className="w-ci ok" />
            <span className="w-check-main">
              <b>aujourd’hui 10:12 · à la main · 2 min</b>
              <small>3 nouvelles erreurs Sentry, 3 tickets Linear ouverts</small>
            </span>
            <span className="w-cl-round w-press" style={d(CL.SESSION)}>
              <ExternalLink size={12} />
            </span>
          </span>
        </span>
        <span className="w-button small w-cl-start">
          <Play size={11} />
          Lancer maintenant
        </span>
        <span className="w-job-form-foot">
          <span className="w-button small">Annuler</span>
          <span className="w-button small solid">Enregistrer</span>
        </span>
      </span>
    </div>
  )
}

function TasksPart() {
  return (
    <div className="w-layer w-in" style={d(CL.TASKS + 0.2)}>
      <ClaudeTop hint="Ce que Flux lance pour toi, à l’heure dite." on={{ Tâches: [[0, 99]] }} />
      <span className="w-cl-note" style={pos(170, 194)}>
        <Ticker
          values={[
            [0, '2 tâches · prochain : Daily, demain 9:30'],
            [CL.CREATE + 0.4, '3 tâches · prochain : Point Sentry du matin, demain 9:30'],
          ]}
        />
      </span>
      <Press left={664} top={186} at={CL.NEW} className="solid" width={126}>
        <Plus size={12} />
        Nouvelle tâche
      </Press>
      <span className="w-cl-slot" style={pos(170, slotTop(0))}>
        <JobLine
          skill="gl_daily"
          name="Daily"
          badge="Flux"
          meta="Du lundi au vendredi à 9:30 · lancé par Flux, en lecture seule"
          side="demain 9:30"
          className="w-in"
          style={d(CL.TASKS + 0.3)}
          icon={<CircleCheck size={15} className="w-ci ok" />}
        />
      </span>
      <span className="w-cl-slot" style={pos(170, slotTop(1))}>
        <JobLine
          name="Revue des PR ouvertes"
          meta="Chaque vendredi à 17:00 · 2 MCP"
          side="ven. 17:00"
          className="w-in"
          style={d(CL.TASKS + 0.36)}
          icon={<CircleCheck size={15} className="w-ci ok" />}
        />
      </span>
      <span className="w-cl-slot" style={pos(170, slotTop(2))}>
        <JobLine
          name="Point Sentry du matin"
          meta="Du lundi au vendredi à 9:30 · 2 MCP"
          className="w-in"
          style={d(CL.CREATE + 0.4)}
          play={CL.RUN}
          icon={
            <Ticker
              values={[
                [0, <CircleDashed key="new" size={15} className="w-ci" />],
                [CL.RUN + 0.1, <LoaderCircle key="run" size={15} className="w-ci spin" />],
                [CL.RAN, <CircleCheck key="ok" size={15} className="w-ci ok" />],
              ]}
            />
          }
          side={
            <Ticker
              values={[
                [0, 'demain 9:30'],
                [CL.RUN + 0.1, 'En cours…'],
                [CL.RAN, 'demain 9:30'],
              ]}
            />
          }
        />
      </span>
    </div>
  )
}

function ClaudePicture() {
  const specs = tabs({ File: { on: [0, CL.TAB] }, Claude: { on: [CL.TAB, 99] } })
  return (
    <Chrome specs={specs}>
      <style>{CL_CSS}</style>
      <FileView className="w-out" style={d(CL.PAGE)} />
      <SkillsList />
      <SkillDetail />
      <ClaudeCard
        from={CL.EDIT + 0.4}
        to={CL.DRAFT - 0.3}
        left={590}
        top={292}
        title="gl_linear_issue.md"
        ask="Ajoute Datadog à l’étape Contexte : les erreurs du service."
        typed={CL.EDIT + 0.7}
        answerAt={CL.EDIT + 1.9}
        answer={
          <>
            <span>Fait, dans la section Contexte :</span>
            <span className="w-cl-diff">
              <span>## Contexte</span>
              <span className="add">+ Datadog : search_datadog_logs sur le service</span>
            </span>
          </>
        }
      />
      <McpPart />
      <McpForm />
      <TasksPart />
      <TaskForm />
      <TaskRuns />
      <ClaudeCard
        from={CL.SESSION + 0.3}
        to={CL.END - 0.2}
        left={600}
        top={330}
        title="Point Sentry du matin"
        ask="Liste les nouvelles erreurs Sentry de la nuit et ouvre un ticket Linear pour chacune."
        answerAt={CL.SESSION + 0.5}
        answer={
          <>
            <span>3 nouvelles erreurs depuis hier soir :</span>
            <span className="w-cl-diff">
              <span>OFF-1102 · TypeError sur /planning</span>
              <span>OFF-1103 · Timeout du sync agenda</span>
              <span>OFF-1104 · 500 sur l’export CSV</span>
            </span>
          </>
        }
      />
      <Toast from={CL.EDIT + 0.3} to={CL.EDIT + 1.6} text="Session ouverte dans Claude" top={430} />
      <Toast from={CL.VALIDATE + 0.3} to={CL.VALIDATE + 1.8} text="/gl_linear_issue : v4 validée" top={430} />
      <Toast from={CL.AUTHED + 0.1} to={CL.AUTHED + 1.6} text="Sentry : connecté" top={470} />
      <Toast from={CL.ADDED + 0.3} to={CL.ADDED + 1.9} text="posthog ajouté : Claude le vérifie" top={424} />
      <Toast from={CL.REMOVE + 0.4} to={CL.REMOVE + 1.8} text="Postgres retiré" top={470} />
    </Chrome>
  )
}

/* Scenes */

interface Scene {
  id: string
  rank: Rank
  ms: number
  captions: Array<[number, string]>
  cam: Cam[]
  cursor: Pt[]
  clicks: Click[]
  focus?: Focus[]
  // A before/after scene: where the split line sits over time
  split?: Split[]
  Picture: () => ReactNode
}

export const SCENES: Scene[] = [
  {
    id: 'prs',
    rank: 6,
    ms: 24500,
    captions: [
      [0.3, 'Avant : ta PR e2e n’a pas de ticket en face.'],
      [PR.HERO, 'Elle attend dans Attente, seule : ni note, ni liens, ni Claude.'],
      [PR.WIPE, 'Maintenant, elle a son sujet dans Mes sujets.'],
      [PR.ZOOM, 'PR ouverte : elle compte comme un ticket en cours.'],
      [PR.CLICK - 0.4, 'Un clic, et Claude la fait avancer.'],
      [PR.RAIL, 'Elle reste dans ta file jusqu’au merge.'],
      [PR.APART, 'Avant : seule dans Attente. Maintenant : menée jusqu’au merge.'],
    ],
    cam: [
      cam(0, WINDOW_VIEW),
      cam(PR.ZOOM, WINDOW_VIEW),
      [PR.ZOOM + 0.7, 1.5, 340, 380],
      [PR.UNZOOM, 1.5, 340, 380],
      cam(PR.UNZOOM + 0.7, WINDOW_VIEW),
      cam(PR.APART, WINDOW_VIEW),
      [PR.APART + 0.8, 1, 480, 290],
    ],
    cursor: [
      [0, 420, 540, 0],
      [PR.ZOOM + 0.6, 420, 540, 0],
      [PR.ZOOM + 0.9, 420, 540],
      [PR.CLICK - 0.6, ...PR_BUTTON],
      [PR.CLICK + 0.4, ...PR_BUTTON],
      [PR.UNZOOM + 0.2, 300, 560],
      [PR.UNZOOM + 0.6, 300, 560, 0],
    ],
    clicks: [[PR.CLICK, ...PR_BUTTON]],
    focus: [
      [2, PR.HERO - 0.2, LOOSE_LEFT - 10, 488, 204, 100, 26],
      [PR.HERO + 0.2, PR.WIPE - 0.3, 28, 293, 564, 178, 26],
      [PR.WIPE + 1.6, PR.ZOOM - 0.1, MINE_LEFT - 10, 466, 592, 122, 26],
      [PR.ZOOM + 0.8, PR.CLICK - 0.8, 30, 377, 98, 33, 10],
      [PR.UNZOOM + 0.7, PR.RAIL - 0.2, 636, 302, 296, 56, 14],
      [PR.RAIL, PR.APART - 0.4, mineLeft(1) - 10, 488, 204, 100, 26],
    ],
    split: [
      [0, 960, 0],
      [PR.WIPE - 0.1, 960, 0],
      [PR.WIPE, 960],
      [PR.WIPE + 1.4, 0],
      [PR.WIPE + 1.5, 0, 0],
    ],
    Picture: PrPicture,
  },
  {
    id: 'sessions',
    rank: 0,
    ms: 25000,
    captions: [
      [0.3, 'Avant : Claude travaille, le sujet est En cours.'],
      [HANDS_BACK - 0.2, 'Puis Claude te rend la main…'],
      [LEAVES, '…et le sujet quitte En cours, sa conversation avec.'],
      [WIPE, 'Maintenant, il reste En cours tant qu’il n’est pas clos.'],
      [ZOOM, 'Sa conversation est dans ses liens.'],
      [CLICK - 0.4, 'Un clic la rouvre dans Claude.'],
      [RAIL_LOOK, 'Tout ce que tu as lancé reste En cours, au travail ou non.'],
      [APART, 'Avant : En cours vide. Maintenant : tout y est.'],
    ],
    cam: [
      cam(0, WINDOW_VIEW),
      cam(ZOOM, WINDOW_VIEW),
      [ZOOM + 0.7, 1.5, 600, 350],
      [UNZOOM, 1.5, 600, 350],
      cam(UNZOOM + 0.7, WINDOW_VIEW),
      cam(APART, WINDOW_VIEW),
      [APART + 0.8, 1, 480, 290],
    ],
    cursor: [
      [0, 560, 560, 0],
      [ZOOM + 0.6, 560, 560, 0],
      [ZOOM + 0.9, 560, 560],
      [CLICK - 0.6, 760, 330],
      [CLICK + 0.4, 760, 330],
      [UNZOOM + 0.2, 860, 440],
      [UNZOOM + 0.6, 860, 440, 0],
    ],
    clicks: [[CLICK, 760, 330]],
    focus: [
      [2, LEAVES - 0.2, 28, 488, 204, 100, 26],
      [ZOOM + 0.7, UNZOOM - 0.1, 638, 302, 292, 56, 14],
      [RAIL_LOOK, APART - 0.4, 28, 488, 786, 100, 26],
    ],
    split: [
      [0, 960, 0],
      [WIPE - 0.1, 960, 0],
      [WIPE, 960],
      [WIPE + 1.4, 0],
      [WIPE + 1.5, 0, 0],
    ],
    Picture: SessionsPicture,
  },
  {
    id: 'unstarted',
    rank: 6,
    ms: 16500,
    captions: [
      [0.3, 'La file : tout ce qui t’attend, entamé ou pas.'],
      [U.BOTS, 'Deux sujets tournent déjà dans Claude.'],
      [U.TAB - 0.9, 'À démarrer, c’est la file sans ce que tu as entamé.'],
      [U.TAB + 1.6, 'Il reste ce que tu n’as pas encore touché.'],
      [U.ACTIVE - 0.9, 'Dans En cours, ouvre un sujet…'],
      [U.PICK + 0.3, '…il s’ouvre là, sans te renvoyer dans la file.'],
    ],
    cam: [
      cam(0, WINDOW_VIEW),
      cam(U.TAB + 0.6, WINDOW_VIEW),
      [U.TAB + 1.4, 0.84, 480, 350],
      [U.ACTIVE - 1.4, 0.84, 480, 350],
      cam(U.ACTIVE - 0.6, WINDOW_VIEW),
    ],
    cursor: [
      [0, 600, 240, 0],
      [U.TAB - 1.1, 600, 240, 0],
      [U.TAB - 0.9, 600, 240],
      [U.TAB - 0.1, TAB_X['À démarrer'], TAB_Y],
      [U.TAB + 0.5, TAB_X['À démarrer'], TAB_Y],
      [U.TAB + 1.1, 640, 200],
      [U.TAB + 1.4, 640, 200, 0],
      [U.ACTIVE - 1.1, 560, 200, 0],
      [U.ACTIVE - 0.9, 560, 200],
      [U.ACTIVE - 0.1, TAB_X['En cours'], TAB_Y],
      [U.ACTIVE + 0.6, TAB_X['En cours'], TAB_Y],
      [U.PICK - 0.1, ...U_PICK],
      [U.PICK + 0.6, ...U_PICK],
      [U.PICK + 1.2, 500, 470],
      [U.PICK + 1.5, 500, 470, 0],
    ],
    clicks: [
      [U.TAB, TAB_X['À démarrer'], TAB_Y],
      [U.ACTIVE, TAB_X['En cours'], TAB_Y],
      [U.PICK, ...U_PICK],
    ],
    focus: [
      [U.BOTS - 0.2, U.TAB - 1.1, 28, 488, 940, 100, 26],
      tabFocus('À démarrer', U.TAB - 0.9, U.TAB + 0.3),
      [U.TAB + 1.0, U.ACTIVE - 1.2, 28, 488, 592, 100, 26],
      tabFocus('En cours', U.ACTIVE - 0.9, U.ACTIVE + 0.3),
      tabFocus('En cours', U.PICK + 0.6, 16),
    ],
    Picture: UnstartedPicture,
  },
  {
    id: 'figma',
    rank: 3,
    ms: 14500,
    captions: [
      [0.3, 'Figma rejoint tes outils, au même titre que Linear.'],
      [F.FILE, 'Les commentaires qui t’attendent arrivent dans ta file.'],
      [F.FILE + 2.2, 'Une tâche par fichier, avec ses commentaires.'],
      [F.OPEN - 0.6, 'Tu réponds dans Figma…'],
      [F.LEAVE, '…et la tâche part une fois tout répondu.'],
    ],
    cam: [
      [0, 1.15, 480, 300],
      [F.CLOSE, 1.15, 480, 300],
      cam(F.CLOSE + 0.8, WINDOW_VIEW),
      cam(F.ANSWERS[0] - 1, WINDOW_VIEW),
      [F.ANSWERS[0] - 0.3, 1.25, 384, 320],
      [F.LEAVE - 0.6, 1.25, 384, 320],
      cam(F.LEAVE + 0.1, WINDOW_VIEW),
    ],
    cursor: [
      [0, 540, 250, 0],
      [0.5, 540, 250, 0],
      [0.7, 540, 250],
      [F.ON - 0.1, ...F_SWITCH],
      [F.ON + 0.5, ...F_SWITCH],
      [F.CLOSE + 0.2, 640, 430],
      [F.CLOSE + 0.5, 640, 430, 0],
      [F.OPEN - 1.1, 300, 420, 0],
      [F.OPEN - 0.9, 300, 420],
      [F.OPEN - 0.1, ...F_OPEN],
      [F.OPEN + 0.5, ...F_OPEN],
      [F.OPEN + 0.8, ...F_OPEN, 0],
    ],
    clicks: [
      [F.ON, ...F_SWITCH],
      [F.OPEN, ...F_OPEN],
    ],
    focus: [[F.FILE + 0.5, F.FILE + 2.1, 28, 488, 204, 100, 26]],
    Picture: FigmaPicture,
  },
  {
    id: 'reviews',
    rank: 2,
    ms: 14000,
    captions: [
      [0.3, 'On te demande une review : elle entre dans ta file.'],
      [R.SENT - 0.4, 'Tu la fais, tu l’envoies.'],
      [R.LEAVE, 'Elle quitte la file et En cours, son thread avec.'],
      [R.LATER, 'Plus rien ne t’attend dessus…'],
      [R.BACK, '…jusqu’à ce qu’on te la redemande.'],
    ],
    cam: [
      cam(0, WINDOW_VIEW),
      cam(R.LATER, WINDOW_VIEW),
      [R.LATER + 0.8, 0.84, 480, 350],
      [R.BACK + 1.6, 0.84, 480, 350],
      cam(R.BACK + 2.4, WINDOW_VIEW),
    ],
    cursor: [
      [0, 300, 380, 0],
      [0.3, 300, 380, 0],
      [0.5, 300, 380],
      [R.CLICK - 0.1, ...R_BUTTON],
      [R.CLICK + 0.5, ...R_BUTTON],
      [R.CLICK + 0.8, ...R_BUTTON, 0],
    ],
    clicks: [[R.CLICK, ...R_BUTTON]],
    focus: [
      tabFocus('File', R.LEAVE - 0.4, R.LEAVE + 1.8, 'En cours'),
      [R.BACK + 0.4, 13.4, 28, 488, 204, 100, 26],
    ],
    Picture: ReviewsPicture,
  },
  {
    id: 'pulls',
    rank: 1,
    ms: 13000,
    captions: [
      [0.3, 'Mes PR : toutes tes PR ouvertes, dans un onglet.'],
      [P.PAGE + 1.2, 'Tous projets confondus, rangées par repo.'],
      [P.ZOOM, 'Open ou Draft, la CI, et où en est la review.'],
      [P.CLICK - 0.6, 'Un clic, et elle s’ouvre sur GitHub.'],
    ],
    cam: [
      cam(0, WINDOW_VIEW),
      cam(P.ZOOM, WINDOW_VIEW),
      [P.ZOOM + 0.8, 1.2, 480, 300],
      [P.UNZOOM, 1.2, 480, 300],
      cam(P.UNZOOM + 0.7, WINDOW_VIEW),
    ],
    cursor: [
      [0, 560, 220, 0],
      [0.3, 560, 220, 0],
      [0.5, 560, 220],
      [P.TAB - 0.1, TAB_X['Mes PR'], TAB_Y],
      [P.TAB + 0.5, TAB_X['Mes PR'], TAB_Y],
      [P.TAB + 1, 640, 160],
      [P.TAB + 1.3, 640, 160, 0],
      [P.CLICK - 1, 560, 420, 0],
      [P.CLICK - 0.8, 560, 420],
      [P.CLICK - 0.1, ...P_ROW],
      [P.CLICK + 0.5, ...P_ROW],
      [P.CLICK + 0.8, ...P_ROW, 0],
    ],
    clicks: [
      [P.TAB, TAB_X['Mes PR'], TAB_Y],
      [P.CLICK, ...P_ROW],
    ],
    focus: [tabFocus('Mes PR', P.TAB - 0.9, P.TAB + 0.3)],
    Picture: PullsPicture,
  },
  {
    id: 'day',
    rank: 4,
    ms: 13000,
    captions: [
      [0.3, 'Daily et Wrap-up se rangent sous Journée.'],
      [J.SUB - 0.8, 'Passe de l’un à l’autre d’un clic.'],
      [J.AWAY - 0.3, 'Tu files ailleurs…'],
      [J.BACK, '…Journée te rouvre là où tu en étais.'],
    ],
    cam: [
      cam(0, WINDOW_VIEW),
      cam(J.SUB - 1.4, WINDOW_VIEW),
      [J.SUB - 0.6, 1.3, 420, 220],
      [J.SUB + 1.8, 1.3, 420, 220],
      cam(J.SUB + 2.5, WINDOW_VIEW),
    ],
    cursor: [
      [0, 600, 200, 0],
      [0.3, 600, 200, 0],
      [0.5, 600, 200],
      [J.TAB - 0.1, TAB_X['Journée'], TAB_Y],
      [J.TAB + 0.5, TAB_X['Journée'], TAB_Y],
      [J.SUB - 0.1, ...J_WRAPUP],
      [J.SUB + 0.5, ...J_WRAPUP],
      [J.AWAY - 0.1, TAB_X.File, TAB_Y],
      [J.AWAY + 0.5, TAB_X.File, TAB_Y],
      [J.BACK - 0.1, TAB_X['Journée'], TAB_Y],
      [J.BACK + 0.6, TAB_X['Journée'], TAB_Y],
      [J.BACK + 1, TAB_X['Journée'], TAB_Y, 0],
    ],
    clicks: [
      [J.TAB, TAB_X['Journée'], TAB_Y],
      [J.SUB, ...J_WRAPUP],
      [J.AWAY, TAB_X.File, TAB_Y],
      [J.BACK, TAB_X['Journée'], TAB_Y],
    ],
    focus: [[J.BACK + 0.5, 12.4, 164, 78, 164, 46, 23]],
    Picture: DayPicture,
  },
  {
    id: 'split',
    rank: 2,
    ms: 19500,
    captions: [
      [0.3, 'La file : tout ce qui t’attend, rangé par rang.'],
      [S.TAGS, 'Chaque sujet a sa place, selon ce que tu en as fait.'],
      [S.TODO - 0.9, 'À démarrer : ce que tu n’as pas encore touché.'],
      [S.STARTED - 0.9, 'En cours : ce que tu as entamé, conversation ou pas.'],
      [S.HELD - 0.9, 'Attente : bloqué, ou chez un autre relecteur.'],
      [S.FILE - 0.6, 'Et la file garde tout.'],
    ],
    cam: [
      cam(0, WINDOW_VIEW),
      cam(S.TAGS - 0.6, WINDOW_VIEW),
      [S.TAGS + 0.2, 1, 480, 440],
      [S.TODO - 1.3, 1, 480, 440],
      cam(S.TODO - 0.7, WINDOW_VIEW),
    ],
    cursor: [
      [0, 600, 240, 0],
      [S.TODO - 1.1, 600, 240, 0],
      [S.TODO - 0.9, 600, 240],
      [S.TODO - 0.1, TAB_X['À démarrer'], TAB_Y],
      [S.TODO + 0.5, TAB_X['À démarrer'], TAB_Y],
      [S.STARTED - 0.1, TAB_X['En cours'], TAB_Y],
      [S.STARTED + 0.5, TAB_X['En cours'], TAB_Y],
      [S.HELD - 0.1, TAB_X.Attente, TAB_Y],
      [S.HELD + 0.5, TAB_X.Attente, TAB_Y],
      [S.FILE - 0.1, TAB_X.File, TAB_Y],
      [S.FILE + 0.6, TAB_X.File, TAB_Y],
      [S.FILE + 1, TAB_X.File, TAB_Y, 0],
    ],
    clicks: [
      [S.TODO, TAB_X['À démarrer'], TAB_Y],
      [S.STARTED, TAB_X['En cours'], TAB_Y],
      [S.HELD, TAB_X.Attente, TAB_Y],
      [S.FILE, TAB_X.File, TAB_Y],
    ],
    focus: [
      [S.TAGS - 0.2, S.TODO - 1.1, 28, RAIL_TOP - 40, 786, 136, 26],
      tabFocus('À démarrer', S.TODO - 0.9, S.TODO + 0.3),
      [S.TODO + 0.8, S.STARTED - 1.1, 28, RAIL_TOP - 10, 398, 100, 26],
      tabFocus('En cours', S.STARTED - 0.9, S.STARTED + 0.3),
      tabFocus('Attente', S.HELD - 0.9, S.HELD + 0.3),
      tabFocus('File', S.FILE - 0.9, S.FILE + 0.3),
    ],
    Picture: SplitPicture,
  },
  {
    id: 'claude',
    rank: 5,
    ms: CL_MS,
    captions: [
      [0.3, 'L’onglet Claude : ce que Claude fait pour toi, réuni dans Flux.'],
      [2.4, 'Tes skills, du dernier lancé au plus ancien.'],
      [4.4, 'Les tiens d’un côté, ceux des plugins de l’autre.'],
      [CL.OPEN - 0.6, 'Ouvre-en un…'],
      [CL.GRAPH - 0.1, '…il se lit comme un graphe : chaque étape mène à la suivante.'],
      [9.6, 'Sous chaque étape, ce qu’elle appelle : MCP, commandes, skills, fichiers.'],
      [11.2, 'Glisse pour suivre la procédure jusqu’au bout.'],
      [13.2, 'Édite-le dans Claude, comme d’habitude…'],
      [CL.DRAFT - 0.1, '…Flux voit le brouillon : le graphe suit le fichier.'],
      [CL.VALIDATE - 0.4, 'Valide : la v4 devient la version de référence.'],
      [CL.MENU - 0.4, 'Les versions d’avant restent lisibles, figées en lecture seule.'],
      [23.6, 'Tes serveurs MCP, et l’état que claude mcp list leur donne.'],
      [CL.AUTH - 0.6, 'À connecter ? Un clic lance la connexion.'],
      [CL.ADD - 0.6, 'Ajoute un serveur : Flux passe par claude mcp add.'],
      [CL.TRASH - 0.8, 'Et retire ce qui ne sert plus, en deux clics.'],
      [CL.TASKS - 0.6, 'Les tâches que Flux lance pour toi, le daily en tête.'],
      [CL.NEW - 0.4, 'Une tâche : un prompt ou une skill, les jours, l’heure…'],
      [CL.ALLOW - 0.9, '…et les seuls MCP qu’elle a le droit d’utiliser.'],
      [CL.RUN - 0.6, 'À l’heure dite, ou d’un clic : Claude s’en charge.'],
      [CL.ROW - 0.4, 'Chaque exécution se rouvre dans Claude.'],
      [CL.END, 'Skills, MCP, tâches : ce que Claude fait pour toi, dans Flux.'],
    ],
    cam: [
      cam(0, WINDOW_VIEW),
      cam(2.2, WINDOW_VIEW),
      [2.9, 1.12, 480, 330],
      [CL.OPEN + 0.2, 1.12, 480, 330],
      [CL.OPEN + 0.8, 1.08, 480, 322],
      [9.6, 1.08, 480, 322],
      [10.2, 1.5, 590, 395],
      [11, 1.5, 590, 395],
      [11.6, 1.08, 480, 322],
      [13, 1.08, 480, 322],
      [13.6, 1.2, 560, 320],
      [23.4, 1.2, 560, 320],
      [24, 1.12, 480, 330],
      [CL.ADD + 0.3, 1.12, 480, 330],
      [CL.ADD + 0.9, 1.25, 480, 300],
      [CL.ADDED + 0.2, 1.25, 480, 300],
      [CL.ADDED + 0.8, 1.12, 480, 330],
      [CL.NEW + 0.2, 1.12, 480, 330],
      [CL.NEW + 0.8, 1.15, 480, 320],
      [CL.ALLOW - 0.9, 1.15, 480, 320],
      [CL.ALLOW - 0.3, 1.5, 400, 400],
      [CL.ALLOW + 0.9, 1.5, 400, 400],
      [CL.CREATE - 0.3, 1.15, 480, 320],
      [CL.CREATE + 0.3, 1.15, 480, 320],
      [CL.CREATE + 0.9, 1.12, 480, 330],
      [CL.ROW + 0.1, 1.12, 480, 330],
      [CL.ROW + 0.7, 1.25, 480, 300],
      [CL.SESSION + 0.1, 1.25, 480, 300],
      [CL.SESSION + 0.7, 1.15, 540, 330],
      [CL.END - 0.4, 1.15, 540, 330],
      cam(CL.END + 0.4, WINDOW_VIEW),
    ],
    cursor: [
      [0, 600, 240, 0],
      [0.4, 600, 240, 0],
      [0.6, 600, 240],
      [CL.TAB - 0.1, TAB_X['Claude'], TAB_Y],
      [CL.TAB + 0.4, TAB_X['Claude'], TAB_Y],
      [2.4, 560, 168],
      [4.3, 560, 168],
      [CL.FILTER - 0.1, ...CL_AT.mine],
      [CL.FILTER + 0.5, ...CL_AT.mine],
      [CL.OPEN - 0.1, ...CL_AT.skill],
      [CL.OPEN + 0.4, ...CL_AT.skill],
      [7.7, 900, 250],
      [7.9, 900, 250, 0],
      [CL.PAN - 0.5, ...CL_AT.grab, 0],
      [CL.PAN - 0.3, ...CL_AT.grab],
      [CL.PAN, ...CL_AT.grab],
      [CL.PANNED, ...CL_AT.drop],
      [CL.PANNED + 0.2, ...CL_AT.drop],
      [CL.EDIT - 0.1, ...CL_AT.edit],
      [CL.EDIT + 0.3, ...CL_AT.edit],
      [14.7, 880, 250],
      [18.4, 880, 250],
      [CL.VALIDATE - 0.1, ...CL_AT.validate],
      [CL.VALIDATE + 0.3, ...CL_AT.validate],
      [CL.MENU - 0.1, ...CL_AT.version],
      [CL.MENU + 0.3, ...CL_AT.version],
      [CL.PICK - 0.15, ...CL_AT.older],
      [CL.PICK + 0.3, ...CL_AT.older],
      [22.4, 720, 300],
      [23.6, 720, 300],
      [CL.MCP - 0.1, ...CL_AT.mcpPart],
      [CL.MCP + 0.4, ...CL_AT.mcpPart],
      [25.2, 560, 168],
      [27.1, 560, 168],
      [CL.AUTH - 0.1, ...CL_AT.connect],
      [CL.AUTH + 0.4, ...CL_AT.connect],
      [29.2, 620, 168],
      [30.5, 620, 168],
      [CL.ADD - 0.1, ...CL_AT.add],
      [CL.ADD + 0.3, ...CL_AT.add],
      [CL.NAME - 0.2, ...CL_AT.name],
      [CL.NAME + 0.4, ...CL_AT.name],
      [CL.URL - 0.2, ...CL_AT.url],
      [CL.URL + 0.8, ...CL_AT.url],
      [CL.ADDED - 0.1, ...CL_AT.addSave],
      [CL.ADDED + 0.3, ...CL_AT.addSave],
      [34.9, 600, 168],
      [35.9, 600, 168],
      [CL.TRASH - 0.1, ...CL_AT.trash],
      [CL.TRASH + 0.2, ...CL_AT.trash],
      [CL.REMOVE - 0.1, ...CL_AT.confirm],
      [CL.REMOVE + 0.3, ...CL_AT.confirm],
      [38.2, 560, 168],
      [38.9, 560, 168],
      [CL.TASKS - 0.1, ...CL_AT.tasksPart],
      [CL.TASKS + 0.3, ...CL_AT.tasksPart],
      [40.3, 560, 168],
      [41.6, 560, 168],
      [CL.NEW - 0.1, ...CL_AT.newTask],
      [CL.NEW + 0.3, ...CL_AT.newTask],
      [CL.TITLE - 0.2, ...CL_AT.title],
      [CL.TITLE + 0.3, ...CL_AT.title],
      [CL.PROMPT - 0.2, ...CL_AT.prompt],
      [CL.PROMPT + 0.4, ...CL_AT.prompt],
      [CL.ALLOW - 0.1, ...CL_AT.sentry],
      [CL.ALLOW + 0.2, ...CL_AT.sentry],
      [CL.ALLOW + 0.4, ...CL_AT.linear],
      [CL.ALLOW + 0.7, ...CL_AT.linear],
      [CL.CREATE - 0.1, ...CL_AT.create],
      [CL.CREATE + 0.3, ...CL_AT.create],
      [48.4, 600, 168],
      [48.7, 600, 168],
      [CL.RUN - 0.1, ...CL_AT.play],
      [CL.RUN + 0.4, ...CL_AT.play],
      [51.1, ...CL_AT.play],
      [CL.ROW - 0.1, ...CL_AT.row],
      [CL.ROW + 0.3, ...CL_AT.row],
      [CL.SESSION - 0.1, ...CL_AT.session],
      [CL.SESSION + 0.3, ...CL_AT.session],
      [CL.SESSION + 0.6, ...CL_AT.session, 0],
    ],
    clicks: [
      [CL.TAB, TAB_X['Claude'], TAB_Y],
      [CL.FILTER, ...CL_AT.mine],
      [CL.OPEN, ...CL_AT.skill],
      [CL.PAN, ...CL_AT.grab],
      [CL.EDIT, ...CL_AT.edit],
      [CL.VALIDATE, ...CL_AT.validate],
      [CL.MENU, ...CL_AT.version],
      [CL.PICK, ...CL_AT.older],
      [CL.MCP, ...CL_AT.mcpPart],
      [CL.AUTH, ...CL_AT.connect],
      [CL.ADD, ...CL_AT.add],
      [CL.NAME - 0.1, ...CL_AT.name],
      [CL.URL - 0.1, ...CL_AT.url],
      [CL.ADDED, ...CL_AT.addSave],
      [CL.TRASH, ...CL_AT.trash],
      [CL.REMOVE, ...CL_AT.confirm],
      [CL.TASKS, ...CL_AT.tasksPart],
      [CL.NEW, ...CL_AT.newTask],
      [CL.TITLE - 0.1, ...CL_AT.title],
      [CL.PROMPT - 0.1, ...CL_AT.prompt],
      [CL.ALLOW, ...CL_AT.sentry],
      [CL.ALLOW + 0.5, ...CL_AT.linear],
      [CL.CREATE, ...CL_AT.create],
      [CL.RUN, ...CL_AT.play],
      [CL.ROW, ...CL_AT.row],
      [CL.SESSION, ...CL_AT.session],
    ],
    focus: [
      tabFocus('Claude', 0.6, CL.TAB + 0.3),
      [2.9, 4.2, 688, 222, 100, 342, 14],
      [4.5, CL.FILTER + 0.5, 288, 182, 236, 38, 19],
      [9.9, 11, 432, 328, 316, 134, 14],
      [CL.DRAFT + 0.7, CL.DRAFT + 1.8, 610, 439, 136, 69, 14],
      [CL.VALIDATE - 0.4, CL.VALIDATE + 0.3, 782, 121, 124, 38, 19],
      [CL.PICK + 0.5, CL.PICK + 1.7, 270, 209, 220, 28, 14],
      [23.6, CL.MCP + 0.2, 56, 76, 198, 42, 21],
      [CL.AUTH - 0.5, CL.AUTHED + 0.8, 164, 270, 632, 56, 16],
      [CL.ADD - 0.6, CL.ADD + 0.1, 658, 182, 136, 38, 19],
      [CL.TRASH - 0.7, CL.REMOVE + 0.4, 164, 366, 632, 56, 16],
      [CL.TASKS + 0.6, CL.NEW - 0.8, 164, 222, 632, 56, 16],
      [CL.ALLOW - 0.3, CL.ALLOW + 0.9, 256, 380, 448, 88, 14],
      [CL.RUN - 0.4, CL.RAN + 0.3, 164, 318, 632, 56, 16],
      [CL.SESSION - 0.5, CL.SESSION + 0.2, 258, 249, 444, 58, 14],
    ],
    Picture: ClaudePicture,
  },
]

function Pointer() {
  return (
    <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true">
      <path
        d="M1.5 1.5v16.2l4.1-3.9 2.7 6.3 3-1.3-2.7-6.2h5.9z"
        fill="#fff"
        stroke="#0a0c12"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SceneView({ scene, root }: { scene: Scene; root: Ref<HTMLDivElement> }) {
  const total = scene.ms / 1000
  const camName = `spot-cam-${scene.id}`
  const cursorName = `spot-cursor-${scene.id}`
  const splitName = `spot-split-${scene.id}`
  const clipName = `spot-clip-${scene.id}`
  const split = scene.split ?? []
  const css = [
    split.length > 0
      ? keyframes(
          splitName,
          total,
          split.map(([t, x, shown = 1]) => [t, `transform: translateX(${x}px); opacity: ${shown};`]),
        )
      : '',
    split.length > 0
      ? keyframes(clipName, total, split.map(([t, x]) => [t, `clip-path: inset(0 0 0 ${x}px);`]))
      : '',
    keyframes(camName, total, scene.cam.map(step => [step[0], `transform: ${camTransform(step)};`])),
    scene.cursor.length > 0
      ? keyframes(
          cursorName,
          total,
          scene.cursor.map(([t, x, y, shown = 1]) => [t, `transform: translate(${x}px, ${y}px); opacity: ${shown};`]),
        )
      : '',
  ].join('\n')
  const Picture = scene.Picture
  const run = (name: string) => `${name} ${scene.ms}ms linear both`
  return (
    <div ref={root} className="spot-scene" style={tint(rankStyle(scene.rank))}>
      <style>{css}</style>
      <div className="spot-stage">
        <div
          className="spot-cam"
          style={
            {
              transform: camTransform(scene.cam[scene.cam.length - 1]),
              animation: run(camName),
              // The after window of a before/after scene clips itself on this
              '--split-clip': split.length > 0 ? run(clipName) : 'none',
            } as CSSProperties
          }
        >
          <Picture />
          {split.length > 0 && (
            <span className="spot-split" style={{ animation: run(splitName) }}>
              <span className="spot-split-knob">
                <ChevronsLeftRight size={14} strokeWidth={2.4} />
              </span>
            </span>
          )}
          {scene.focus?.map(([from, to, x, y, w, h, r]) => (
            <span
              key={from}
              className="spot-focus"
              style={span(from, to, { left: x, top: y, width: w, height: h, borderRadius: r })}
            />
          ))}
          {scene.clicks.map(([t, x, y]) => (
            <span key={t} className="spot-click" style={d(t, pos(x, y))} />
          ))}
          {scene.cursor.length > 0 && (
            <span className="spot-cursor" style={{ animation: run(cursorName) }}>
              <Pointer />
            </span>
          )}
        </div>
      </div>
      <div className="spot-captions">
        {scene.captions.map(([t, text], index) => (
          <p key={t} className="spot-beat" style={span(t, scene.captions[index + 1]?.[0] ?? total + 1)}>
            {text}
          </p>
        ))}
      </div>
    </div>
  )
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// One scene, played like a video: a click or Space pauses it, the bar seeks, it waits on its last
// frame at the end, and F gives it the whole Flux window. With reduced motion it waits to be played
export function Spot({ scene: id, full, onFull }: { scene: string; full: boolean; onFull(next: boolean): void }) {
  const scene = SCENES.find(entry => entry.id === id) ?? SCENES[0]
  const [playing, setPlaying] = useState(() => !reducedMotion())
  const [ended, setEnded] = useState(false)
  // Bumped on every seek: the scene is drawn anew, then set to the time sought
  const [take, setTake] = useState(0)
  const sought = useRef<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const time = useRef<HTMLSpanElement>(null)
  const elapsed = useRef(0)

  // The 960 by 600 window fits the frame whatever its size, fullscreen included
  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => {
      element.style.setProperty('--fit', String(Math.min(element.clientWidth / W, element.clientHeight / H)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const paint = useCallback(() => {
    if (fill.current) fill.current.style.transform = `scaleX(${Math.min(1, elapsed.current / scene.ms)})`
    if (time.current) time.current.textContent = clock(elapsed.current)
  }, [scene.ms])

  // A finished entrance is dropped by the browser and can't be sought back, so a seek draws the
  // scene anew: every animation then starts with it, and one time sets them all
  const seek = useCallback(
    (ms: number) => {
      elapsed.current = Math.max(0, Math.min(scene.ms, ms))
      sought.current = elapsed.current
      setTake(value => value + 1)
      setEnded(elapsed.current >= scene.ms)
      paint()
    },
    [paint, scene.ms],
  )

  useLayoutEffect(() => {
    if (sought.current === null) return
    for (const animation of stage.current?.getAnimations({ subtree: true }) ?? []) {
      animation.currentTime = sought.current
    }
    sought.current = null
  }, [take])

  useEffect(() => {
    if (!playing) return undefined
    let last = performance.now()
    let frame = 0
    const step = (now: number) => {
      elapsed.current = Math.min(scene.ms, elapsed.current + now - last)
      last = now
      paint()
      if (elapsed.current < scene.ms) {
        frame = requestAnimationFrame(step)
        return
      }
      setPlaying(false)
      setEnded(true)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, paint, scene.ms])

  const toggle = useCallback(() => {
    if (!ended) {
      setPlaying(value => !value)
      return
    }
    seek(0)
    setPlaying(true)
  }, [ended, seek])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      // A focused button answers Space itself
      if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        toggle()
      } else if (event.key === 'f' || event.key === 'F') onFull(!full)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, full, onFull])

  const scrub = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    seek(((event.clientX - box.left) / box.width) * scene.ms)
  }

  return (
    <div ref={root} className={`spot${playing ? '' : ' paused'}${full ? ' full' : ''}`}>
      <Stage style={rankStyle(scene.rank)} drift={playing} />
      <div className="spot-veil" aria-hidden="true" />
      {/* The whole picture pauses on click, like a video; the button below does the same from the keyboard */}
      <div className="spot-surface" onClick={toggle}>
        <SceneView key={take} scene={scene} root={stage} />
      </div>
      {ended && (
        <button type="button" className="pill glass spot-replay" onClick={toggle}>
          <RotateCcw size={15} aria-hidden="true" />
          Revoir
        </button>
      )}

      <div className="spot-controls">
        <button
          type="button"
          className="round small glass"
          aria-label={ended ? 'Revoir' : playing ? 'Pause' : 'Lecture'}
          title="Espace"
          onClick={toggle}
        >
          {ended ? (
            <RotateCcw size={14} aria-hidden="true" />
          ) : playing ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
        </button>
        <div
          className="spot-progress"
          aria-hidden="true"
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId)
            scrub(event)
          }}
          onPointerMove={event => {
            if (event.buttons === 1) scrub(event)
          }}
        >
          <span ref={fill} />
        </div>
        <span className="spot-time">
          <span ref={time}>0:00</span> / {clock(scene.ms)}
        </span>
        <button
          type="button"
          className="round small glass"
          aria-label={full ? 'Quitter le plein écran' : 'Plein écran'}
          title={full ? 'Quitter le plein écran (F)' : 'Plein écran (F)'}
          onClick={() => onFull(!full)}
        >
          {full ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}
