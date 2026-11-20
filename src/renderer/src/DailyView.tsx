import { GripVertical, PenLine, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { countLabel, stars, STORE_LABEL, YESTERDAY_LABEL } from '../../shared/dailyLabels'
import { DAILY_TEMPLATE } from '../../shared/dailyTemplate'
import { RANKS } from '../../shared/ranks'
import type {
  DailyBlocker,
  DailyIntention,
  DailySheet,
  DailyYesterday,
  HealthLevel,
  HealthLine,
  RefPill,
  StoreReview,
} from '../../shared/types'
import { BrandIcon, LinkIcon } from './Brand'
import { clock, displayTitle, refLabel } from './format'
import { useLayer } from './layers'
import { menuOfLine, showMenu } from './navigation'
import { rankStyle } from './rankStyle'

const YESTERDAY_SHOWN = 6
const MAX_INTENTIONS = 5

const HEALTH_LABEL: Record<HealthLevel, string> = {
  alert: 'Alerte',
  weak: 'Signal faible',
  positive: 'Bonne nouvelle',
  ok: 'RAS',
  unavailable: 'Non consulté',
}

type Line = DailyYesterday | DailyIntention | DailyBlocker

interface LineActions {
  onOpen(topicId: string): void
  onNote(topicId: string, text: string): void
}

function dayOf(iso: string): string {
  const date = new Date(iso)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function weekday(date: string, style: 'long' | 'short'): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('fr-FR', { weekday: style })
}

// « Hier » the day after, « Depuis vendredi » on a Monday
function sinceHeading(sheet: DailySheet): string {
  const [year, month, day] = sheet.date.split('-').map(Number)
  const yesterday = dayOf(new Date(year, month - 1, day - 1).toISOString())
  return sheet.since === yesterday ? 'Hier' : `Depuis ${weekday(sheet.since, 'long')}`
}

function whenDone(at: string, today: string): string {
  const day = dayOf(at)
  if (day === today) return clock(at)
  return `${weekday(day, 'short')} ${clock(at)}`
}

function titleOf(line: Line): string {
  return line.short ?? displayTitle(line.title)
}

function open(line: Line, onOpen: (topicId: string) => void): void {
  if (line.live && line.topicId) onOpen(line.topicId)
  else if (line.url) void window.flux.openExternal(line.url)
}

function Pills({ refs }: { refs: RefPill[] }) {
  if (refs.length === 0) return null
  return (
    <span className="ref-pills">
      {refs.map(pill =>
        pill.url ? (
          <button
            type="button"
            key={pill.ref}
            className="ref-pill"
            title={pill.url}
            onClick={event => {
              event.stopPropagation()
              void window.flux.openExternal(pill.url as string)
            }}
          >
            <LinkIcon url={pill.url} size={11} />
            {refLabel(pill.ref)}
          </button>
        ) : (
          <span key={pill.ref} className="ref-pill">
            {refLabel(pill.ref)}
          </span>
        ),
      )}
    </span>
  )
}

// A dated line appended to the topic's note, without leaving the daily
function NoteButton({ line, onNote }: { line: Line; onNote: LineActions['onNote'] }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  if (!line.live || !line.topicId) return <span />
  const topicId = line.topicId
  if (!editing) {
    return (
      <button
        type="button"
        className="round small daily-tool"
        aria-label="Ajouter une note au sujet"
        title="Ajouter une note au sujet"
        onClick={() => setEditing(true)}
      >
        <PenLine size={14} aria-hidden="true" />
      </button>
    )
  }
  // What is typed stays until it is added
  const close = () => setEditing(false)
  return (
    <input
      className="daily-note"
      autoFocus
      value={text}
      placeholder="Note datée, Entrée pour ajouter"
      onChange={event => setText(event.target.value)}
      onBlur={close}
      onKeyDown={event => {
        if (event.key === 'Escape') close()
        if (event.key === 'Enter' && text.trim()) {
          onNote(topicId, text.trim())
          setText('')
          close()
        }
      }}
    />
  )
}

// The title opens the topic; the pills beside it open their own link
function LineMain({ line, meta, onOpen }: { line: Line; meta?: string | null; onOpen(): void }) {
  const openable = line.live || line.url !== null
  return (
    <div className="daily-main" onContextMenu={event => showMenu(event, menuOfLine(line))}>
      <span className="daily-title">
        <button type="button" className="daily-open" disabled={!openable} onClick={onOpen}>
          {titleOf(line)}
        </button>
        <Pills refs={line.refs} />
      </span>
      {meta && <span className="daily-meta">{meta}</span>}
    </div>
  )
}

function Yesterday({ sheet, actions }: { sheet: DailySheet; actions: LineActions }) {
  const [all, setAll] = useState(false)
  const lines = sheet.yesterday
  const shown = all ? lines : lines.slice(0, YESTERDAY_SHOWN)
  return (
    <section className="daily-section" aria-labelledby="daily-yesterday">
      <h2 id="daily-yesterday">
        {sinceHeading(sheet)}
        {lines.length > 0 && <span className="count">{lines.length}</span>}
      </h2>
      {lines.length === 0 ? (
        <p className="daily-empty">RAS</p>
      ) : (
        <ul className="daily-list">
          {shown.map(line => (
            <li key={line.id} className="daily-row">
              <span className={`daily-kind kind-${line.kind}`}>{YESTERDAY_LABEL[line.kind]}</span>
              <LineMain line={line} onOpen={() => open(line, actions.onOpen)} />
              <span className="daily-side">{whenDone(line.at, sheet.date)}</span>
              <NoteButton line={line} onNote={actions.onNote} />
            </li>
          ))}
        </ul>
      )}
      {lines.length > YESTERDAY_SHOWN && (
        <button type="button" className="daily-more" onClick={() => setAll(value => !value)}>
          {all ? 'Réduire' : `+ ${lines.length - YESTERDAY_SHOWN} ${lines.length - YESTERDAY_SHOWN > 1 ? 'autres' : 'autre'}`}
        </button>
      )}
    </section>
  )
}

function intentionsHint(sheet: DailySheet): string {
  if (sheet.intentionsEdited) return 'Ordre choisi à la main'
  if (sheet.generatedAt) return 'Proposées par le daily'
  return 'Tête de file, en attendant le daily'
}

function move(ids: string[], from: number, to: number): string[] {
  const next = [...ids]
  const [id] = next.splice(from, 1)
  next.splice(to, 0, id)
  return next
}

function Today({ sheet, actions }: { sheet: DailySheet; actions: LineActions }) {
  // The list answers at once; the state pushed back by the main process takes over
  const [order, setOrder] = useState<string[] | null>(null)
  const [picking, setPicking] = useState(false)
  const pick = useRef<HTMLDivElement>(null)
  const dragged = useRef<number | null>(null)
  useEffect(() => setOrder(null), [sheet.intentions])
  useLayer(picking, () => setPicking(false), { root: pick })
  useEffect(() => {
    if (!picking) return undefined
    const close = (event: MouseEvent) => {
      if (!pick.current?.contains(event.target as Node)) setPicking(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [picking])

  const byId = new Map([...sheet.intentions, ...sheet.candidates].map(line => [line.id, line]))
  const ids = order ?? sheet.intentions.map(line => line.id)
  const lines = ids.flatMap(id => byId.get(id) ?? [])
  const save = (next: string[]) => {
    setOrder(next)
    void window.flux.setIntentions(next).catch(() => setOrder(null))
  }
  const onKey = (event: KeyboardEvent, index: number) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    const target = index + (event.key === 'ArrowUp' ? -1 : 1)
    if (target < 0 || target >= ids.length) return
    event.preventDefault()
    save(move(ids, index, target))
    const rows = (event.currentTarget.parentElement as HTMLElement).children
    requestAnimationFrame(() => (rows[target] as HTMLElement | undefined)?.focus())
  }
  const candidates = sheet.candidates.filter(line => !ids.includes(line.id))

  return (
    <section className="daily-section" aria-labelledby="daily-today">
      <h2 id="daily-today">
        Aujourd’hui
        <span className="daily-hint">{intentionsHint(sheet)}</span>
      </h2>
      {lines.length === 0 ? (
        <p className="daily-empty">Rien de prévu. Ajoute un sujet de la file.</p>
      ) : (
        <ol className="daily-list">
          {lines.map((line, index) => (
            <li
              key={line.id}
              className={`daily-row intention${line.done ? ' done' : ''}`}
              tabIndex={0}
              draggable
              title="Glisser, ou Alt + ↑ / ↓, pour changer l’ordre"
              onKeyDown={event => onKey(event, index)}
              onDragStart={() => (dragged.current = index)}
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault()
                const from = dragged.current
                dragged.current = null
                if (from !== null && from !== index) save(move(ids, from, index))
              }}
            >
              <span className="daily-rank" style={{ color: rankStyle(line.rank).light }}>
                <GripVertical size={13} className="daily-grip" aria-hidden="true" />
                {index + 1}
              </span>
              <LineMain
                line={line}
                meta={[line.rank === null ? null : RANKS[line.rank].label, line.detail]
                  .filter(Boolean)
                  .join(' · ')}
                onOpen={() => open(line, actions.onOpen)}
              />
              <button
                type="button"
                className="round small daily-tool"
                aria-label="Retirer des intentions"
                title="Retirer des intentions"
                onClick={() => save(ids.filter(id => id !== line.id))}
              >
                <X size={14} aria-hidden="true" />
              </button>
              <NoteButton line={line} onNote={actions.onNote} />
            </li>
          ))}
        </ol>
      )}
      {ids.length < MAX_INTENTIONS && candidates.length > 0 && (
        <div className="daily-pick" ref={pick}>
          <button
            type="button"
            className="daily-more"
            aria-expanded={picking}
            onClick={() => setPicking(value => !value)}
          >
            <Plus size={13} aria-hidden="true" />
            Ajouter
          </button>
          {picking && (
            <ul className="daily-candidates">
              {candidates.map(line => (
                <li key={line.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicking(false)
                      save([...ids, line.id])
                    }}
                  >
                    <span style={{ color: rankStyle(line.rank).light }}>
                      {line.rank === null ? 'En cours' : RANKS[line.rank].label}
                    </span>
                    {titleOf(line)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function Blockers({ sheet, actions }: { sheet: DailySheet; actions: LineActions }) {
  return (
    <section className="daily-section" aria-labelledby="daily-blockers">
      <h2 id="daily-blockers">
        Bloquants
        {sheet.blockers.length > 0 && <span className="count">{sheet.blockers.length}</span>}
      </h2>
      {sheet.blockers.length === 0 ? (
        <p className="daily-empty">RAS</p>
      ) : (
        <ul className="daily-list">
          {sheet.blockers.map(line => (
            <li key={line.id} className="daily-row blocker">
              <span className="daily-kind kind-blocked">Bloqué</span>
              <LineMain
                line={line}
                meta={[line.reason, line.unblock && `pour avancer : ${line.unblock}`]
                  .filter(Boolean)
                  .join(' · ')}
                onOpen={() => open(line, actions.onOpen)}
              />
              <span />
              <NoteButton line={line} onNote={actions.onNote} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function HealthRow({ line }: { line: HealthLine }) {
  const unavailable = line.level === 'unavailable'
  return (
    <li className={`health-row level-${line.level}`}>
      <span className="health-dot" title={HEALTH_LABEL[line.level]} aria-label={HEALTH_LABEL[line.level]} />
      <span className="health-text">
        <strong>{line.source}</strong>
        {unavailable ? 'non consulté' : line.text}
        {line.detail && <span className="health-detail">{line.detail}</span>}
        {line.items && line.items.length > 0 && (
          <span className="health-items">
            {line.items.map(item => (
              <span key={item.label} className="health-item">
                <span className="health-item-label">{item.label}</span>
                <span className="health-item-value">{item.value}</span>
              </span>
            ))}
          </span>
        )}
      </span>
      {line.url && (
        <button
          type="button"
          className="ref-pill"
          onClick={() => void window.flux.openExternal(line.url as string)}
        >
          <LinkIcon url={line.url} size={11} />
          Voir
        </button>
      )}
    </li>
  )
}

// No skill yet: the native blocks work, the generated part waits for one
function SkillSetup() {
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="daily-setup">
      <p>
        La santé prod et les intentions proposées viennent d’un skill daily, que Flux lance chaque
        matin en lecture seule. Il n’y en a pas encore.
      </p>
      <details>
        <summary>Voir le modèle générique</summary>
        <pre>{DAILY_TEMPLATE}</pre>
      </details>
      <div className="daily-setup-actions">
        <button
          type="button"
          className="pill glass small"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void window.flux
              .useDailyTemplate()
              .then(answer => setResult(answer.detail))
              .finally(() => setBusy(false))
          }}
        >
          Utiliser le modèle
        </button>
        <button type="button" className="pill glass small" onClick={() => void window.flux.createDailySkill()}>
          <BrandIcon brand="claude" size={13} />
          Écrire le mien avec Claude
        </button>
      </div>
      {result && <p className="daily-hint">{result}</p>}
    </div>
  )
}

function Health({ sheet }: { sheet: DailySheet }) {
  const running = sheet.status === 'running'
  let body
  if (sheet.skill === 'missing') body = <SkillSetup />
  else if (sheet.health && sheet.health.length > 0) {
    body = (
      <ul className="health-list">
        {sheet.health.map(line => (
          <HealthRow key={line.source} line={line} />
        ))}
      </ul>
    )
  } else if (sheet.health) body = <p className="daily-empty">RAS</p>
  else if (running) body = <p className="daily-empty">Le daily se prépare…</p>
  else {
    body = (
      <p className="daily-empty">
        {sheet.status === 'error' ? 'Pas de daily aujourd’hui.' : `Prévu à ${sheet.dailyTime}.`}{' '}
        <button type="button" className="daily-more inline" onClick={() => void window.flux.runDaily()}>
          Lancer maintenant
        </button>
      </p>
    )
  }
  return (
    <section className="daily-section" aria-labelledby="daily-health">
      <h2 id="daily-health">
        Santé prod
        {running && sheet.health && <span className="daily-hint">Mise à jour…</span>}
      </h2>
      {sheet.status === 'error' && <p className="daily-error">Le daily a échoué : {sheet.error}</p>}
      {body}
    </section>
  )
}

function reviewDay(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
}

function ReviewRow({ review }: { review: StoreReview }) {
  return (
    <li className={`review-row${review.rating <= 2 ? ' low' : ''}`}>
      <span className="review-stars" aria-label={`${review.rating} sur 5`}>
        {stars(review.rating)}
      </span>
      <span className="review-main">
        <span className="review-meta">
          <strong>{review.app}</strong>
          {STORE_LABEL[review.store]} · {reviewDay(review.date)}
          {review.version && ` · ${review.version}`}
        </span>
        <span className="review-text">
          {review.title && <strong>{review.title} — </strong>}
          {review.text}
        </span>
      </span>
      <button type="button" className="ref-pill" onClick={() => void window.flux.openExternal(review.url)}>
        <LinkIcon url={review.url} size={11} />
        Voir
      </button>
    </li>
  )
}

// Only new reviews show: the section stays away on a day without any
function Reviews({ sheet }: { sheet: DailySheet }) {
  const feed = sheet.reviews
  if (!feed || (feed.reviews.length === 0 && feed.failed.length === 0)) return null
  return (
    <section className="daily-section" aria-labelledby="daily-reviews">
      <h2 id="daily-reviews">Retours stores</h2>
      {feed.reviews.length > 0 && (
        <ul className="review-list">
          {feed.reviews.map(review => (
            <ReviewRow key={review.id} review={review} />
          ))}
        </ul>
      )}
      {feed.failed.map(miss => (
        <p key={`${miss.app}-${miss.store}`} className="daily-hint">
          {STORE_LABEL[miss.store]} injoignable pour {miss.app}
        </p>
      ))}
    </section>
  )
}

function Counts({ sheet, onOpen }: { sheet: DailySheet; onOpen(topicId: string): void }) {
  if (sheet.counts.length === 0) return <footer className="daily-counts">File vide</footer>
  return (
    <footer className="daily-counts">
      {sheet.counts.map(count => (
        <button
          type="button"
          key={count.rank}
          style={{ color: rankStyle(count.rank).light }}
          onClick={() => onOpen(count.firstId)}
        >
          {countLabel(count.rank, count.count)}
        </button>
      ))}
    </footer>
  )
}

function subtitle(sheet: DailySheet): string {
  const [year, month, day] = sheet.date.split('-').map(Number)
  const date = new Date(year, month - 1, day).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const stamp = sheet.status === 'running' ? 'génération en cours' : sheet.generatedAt ? `généré à ${clock(sheet.generatedAt)}` : null
  return [date.charAt(0).toUpperCase() + date.slice(1), stamp].filter(Boolean).join(' · ')
}

export function DailyView({
  daily,
  onOpen,
  onNote,
  nav,
}: { daily: DailySheet; nav?: ReactNode } & LineActions) {
  const actions = { onOpen, onNote }
  return (
    <main className="page">
      <div className="page-column daily">
        {nav}
        <header className="daily-head">
          <div>
            <h1>Daily</h1>
            <p>{subtitle(daily)}</p>
          </div>
          <div className="daily-actions">
            {daily.skill === 'ready' && (
              <button
                type="button"
                className="pill glass small"
                disabled={daily.status === 'running'}
                onClick={() => void window.flux.runDaily()}
              >
                <RefreshCw size={14} className={daily.status === 'running' ? 'spin' : undefined} aria-hidden="true" />
                {daily.generatedAt ? 'Relancer' : 'Lancer le daily'}
              </button>
            )}
            {daily.notePath && (
              <button type="button" className="pill glass small" onClick={() => void window.flux.openDaily()}>
                <BrandIcon brand="obsidian" size={14} />
                Obsidian
              </button>
            )}
          </div>
        </header>
        <Yesterday sheet={daily} actions={actions} />
        <Today sheet={daily} actions={actions} />
        <Blockers sheet={daily} actions={actions} />
        <Health sheet={daily} />
        <Reviews sheet={daily} />
        <Counts sheet={daily} onOpen={onOpen} />
      </div>
    </main>
  )
}
