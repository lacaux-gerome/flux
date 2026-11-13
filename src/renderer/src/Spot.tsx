import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronsLeftRight,
  Hand,
  Hourglass,
  MessagesSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings as Gear,
  Sparkles,
  UserRound,
  Waves,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { RANKS } from '../../shared/ranks'
import type { Rank } from '../../shared/types'
import { BrandIcon } from './Brand'
import { rankStyle, tint } from './rankStyle'
import { Stage } from './Stage'

// The presentation of what is new. Each feature plays on a miniature of the Flux window,
// 960 by 600: what changed, where it lives, and a dive into it. A before/after scene stacks two
// windows and a split wipes from one to the other.
// Every timing below is in seconds from the start of its scene.

const W = 960
const H = 600
const LEAVE_MS = 500
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

// The window under the headline, then the window alone with room left for the captions
const GLOBAL: View = [0.62, 480, 215]

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

interface TabSpec {
  label: string
  width: number
  count?: number | [before: number, after: number, at: number]
  // Active between two times
  on?: [number, number]
}

const TAB_ORDER = ['File', 'En cours', 'Attente', 'Notes', 'Wrap-up', 'Daily']
const TAB_WIDTH: Record<string, number> = { File: 70, 'En cours': 92, Attente: 88, Notes: 70, 'Wrap-up': 92, Daily: 70 }
const TAB_COUNT: Record<string, number> = { File: 4, 'En cours': 2, Attente: 2 }

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
  const [before, after, at] = count
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
          {tab.on && (
            <span className="w-tab-on w-span" style={span(...tab.on)}>
              <TabLabel tab={tab} />
            </span>
          )}
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
        <span className="w-round" style={pos(742, 14)}>
          <RefreshCw size={13} />
        </span>
        <span className="w-round" style={pos(786, 14)}>
          <Sparkles size={13} />
        </span>
        <span className="w-note" style={pos(830, 14)}>
          Note
          <Plus size={12} />
        </span>
        <span className="w-round" style={pos(908, 14)}>
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
  // A PR no topic holds yet: its link icon in front of the ref
  loose?: boolean
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
        {topic.loose && <BrandIcon brand="github" size={11} />}
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
  actions = SESSION_ACTIONS,
  className = '',
}: {
  topic: Topic
  meta: string[]
  signal?: string
  actions?: ReactNode
  className?: string
}) {
  const rank = topic.rank ?? 6
  const Icon = rankStyle(rank).icon
  return (
    <div className={`w-focus-hero ${className}`}>
      <span className="w-hero-rank">
        <span className="w-tile">
          <Icon size={13} strokeWidth={2.2} />
        </span>
        {RANKS[rank].label}
      </span>
      <h3 className="w-focus-title">{topic.title}</h3>
      <span className="w-focus-meta">
        {meta.map(entry => (
          <span key={entry}>{entry}</span>
        ))}
      </span>
      {signal && <span className="w-signal">{signal}</span>}
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
function RailGroup({ label, left, rank, icon }: { label: string; left: number; rank?: Rank; icon?: LucideIcon }) {
  const style = rank === undefined ? undefined : rankStyle(rank)
  const Icon = icon ?? style?.icon
  return (
    <span className="w-group" style={{ ...(style ? tint(style) : {}), left: left + 3, top: RAIL_TOP - 23 }}>
      {Icon && <Icon size={11} strokeWidth={2.4} />}
      {label}
    </span>
  )
}

function LinkRow({ kind, title, detail, className = '', style }: {
  kind: 'conversation' | 'ticket' | 'pr'
  title: string
  detail: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <span className={`w-row-link ${className}`} style={style}>
      <span className={`w-kind ${kind}`}>
        <BrandIcon brand={kind === 'conversation' ? 'claude' : kind === 'pr' ? 'github' : 'linear'} size={13} />
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
      <TopicCard topic={{ ...E2E, rank: null, loose: true }} selected style={pos(LOOSE_LEFT, RAIL_TOP)} />
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

/* Scenes */

interface Scene {
  id: string
  rank: Rank
  ms: number
  kicker: string
  headline: string
  // When the headline gives way to the window
  headlineUntil: number
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
    kicker: 'PR sans ticket',
    headline: 'Tes PR sans ticket vont jusqu’au bout.',
    headlineUntil: 1.6,
    captions: [
      [1.8, 'Avant : ta PR e2e n’a pas de ticket en face.'],
      [PR.HERO, 'Elle attend dans Attente, seule : ni note, ni liens, ni Claude.'],
      [PR.WIPE, 'Maintenant, elle a son sujet dans Mes sujets.'],
      [PR.ZOOM, 'PR ouverte : elle compte comme un ticket en cours.'],
      [PR.CLICK - 0.4, 'Un clic, et Claude la fait avancer.'],
      [PR.RAIL, 'Elle reste dans ta file jusqu’au merge.'],
      [PR.APART, 'Avant : seule dans Attente. Maintenant : menée jusqu’au merge.'],
    ],
    cam: [
      cam(1.2, GLOBAL),
      cam(1.9, WINDOW_VIEW),
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
    kicker: 'Sessions Claude',
    headline: 'Tes conversations ne se perdent plus.',
    headlineUntil: 1.6,
    captions: [
      [1.8, 'Avant : Claude travaille, le sujet est En cours.'],
      [HANDS_BACK - 0.2, 'Puis Claude te rend la main…'],
      [LEAVES, '…et le sujet quitte En cours, sa conversation avec.'],
      [WIPE, 'Maintenant, il reste En cours tant qu’il n’est pas clos.'],
      [ZOOM, 'Sa conversation est dans ses liens.'],
      [CLICK - 0.4, 'Un clic la rouvre dans Claude.'],
      [RAIL_LOOK, 'Tout ce que tu as lancé reste En cours, au travail ou non.'],
      [APART, 'Avant : En cours vide. Maintenant : tout y est.'],
    ],
    cam: [
      cam(1.2, GLOBAL),
      cam(1.9, WINDOW_VIEW),
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
]

function Words({ text, delay }: { text: string; delay: number }) {
  return (
    <h1 className="spot-headline" aria-label={text}>
      {text.split(' ').map((word, index) => (
        <span key={`${word}-${index}`} style={d(delay + index * 0.08)} aria-hidden="true">
          {word}
        </span>
      ))}
    </h1>
  )
}

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

function SceneView({ scene, leaving }: { scene: Scene; leaving: boolean }) {
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
  const delay = 0.25
  const run = (name: string) => `${name} ${scene.ms}ms linear both`
  return (
    <div
      className={`spot-scene${leaving ? ' leaving' : ''}`}
      style={tint(rankStyle(scene.rank))}
      aria-hidden={leaving}
    >
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
      <header className="spot-head" style={{ '--until': `${scene.headlineUntil}s` } as CSSProperties}>
        <p className="spot-kicker" style={d(delay - 0.15)}>
          {scene.kicker}
        </p>
        <Words text={scene.headline} delay={delay} />
      </header>
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

// A scene as played: the take is bumped on every jump, so a scene played again starts over
interface Cut {
  scene: number
  take: number
}

// Plays the scenes it is given, in order, then hands back
export function Spot({ playlist, onEnd }: { playlist: string[]; onEnd(): void }) {
  const scenes = useMemo(
    () => playlist.flatMap(id => SCENES.filter(scene => scene.id === id)),
    [playlist],
  )
  const [cut, setCut] = useState<Cut>({ scene: 0, take: 0 })
  // The scene fading out keeps its element, so it holds its last frame instead of replaying
  const [leaving, setLeaving] = useState<Cut | null>(null)
  const [playing, setPlaying] = useState(true)
  const scene = cut.scene
  const root = useRef<HTMLDivElement>(null)
  const elapsed = useRef(0)
  const fills = useRef<Array<HTMLSpanElement | null>>([])

  // The 960 by 600 window fits the frame whatever its size
  useEffect(() => {
    const element = root.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => {
      element.style.setProperty('--fit', String(Math.min(element.clientWidth / W, element.clientHeight / H)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const paint = useCallback((index: number, ratio: number) => {
    fills.current.forEach((fill, position) => {
      if (!fill) return
      const value = position < index ? 1 : position > index ? 0 : ratio
      fill.style.transform = `scaleX(${value})`
    })
  }, [])

  const go = useCallback(
    (index: number) => {
      if (index >= scenes.length) {
        onEnd()
        return
      }
      const target = Math.max(0, index)
      setLeaving(current => (target === cut.scene ? current : cut))
      setCut({ scene: target, take: cut.take + 1 })
      elapsed.current = 0
      paint(target, 0)
    },
    [cut, onEnd, paint, scenes.length],
  )

  useEffect(() => {
    if (leaving === null) return undefined
    const timer = setTimeout(() => setLeaving(null), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [leaving])

  useEffect(() => {
    if (!playing) return undefined
    let last = performance.now()
    let frame = 0
    const step = (now: number) => {
      elapsed.current += now - last
      last = now
      const ms = scenes[scene].ms
      paint(scene, Math.min(1, elapsed.current / ms))
      if (elapsed.current >= ms) go(scene + 1)
      else frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, scene, go, paint, scenes])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A focused button answers Space itself
      if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        event.preventDefault()
        setPlaying(value => !value)
      } else if (event.key === 'ArrowRight') go(scene + 1)
      else if (event.key === 'ArrowLeft') go(elapsed.current > 1200 ? scene : scene - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [scene, go])

  const current = scenes[scene]
  return (
    <div ref={root} className={`spot${playing ? '' : ' paused'}`}>
      <Stage style={rankStyle(current.rank)} drift={playing} />
      <div className="spot-veil" aria-hidden="true" />
      {/* The whole picture pauses on click, like a video; the button below does the same from the keyboard */}
      <div className="spot-surface" onClick={() => setPlaying(value => !value)}>
        {(leaving ? [leaving, cut] : [cut]).map(item => (
          <SceneView key={`${item.scene}-${item.take}`} scene={scenes[item.scene]} leaving={item !== cut} />
        ))}
      </div>

      <div className="spot-controls">
        <button
          type="button"
          className="round small glass"
          aria-label={playing ? 'Pause' : 'Lecture'}
          title="Espace"
          onClick={() => setPlaying(value => !value)}
        >
          {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <div className="spot-segments">
          {scenes.map((entry, index) => (
            <button
              type="button"
              key={entry.id}
              aria-label={`${entry.kicker} : ${entry.headline}`}
              aria-current={index === scene ? 'step' : undefined}
              onClick={() => go(index)}
            >
              <span ref={element => void (fills.current[index] = element)} />
            </button>
          ))}
        </div>
        <button type="button" className="pill glass small" onClick={onEnd}>
          Passer
        </button>
      </div>
    </div>
  )
}
