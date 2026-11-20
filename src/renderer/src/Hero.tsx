import { ArrowUpRight, Check, Hand, Hourglass, LockOpen, MessageCircleQuestion, Pencil } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { LinkMenu } from '../../shared/links'
import { RANKS } from '../../shared/ranks'
import type { AskedLine, CommentLine, Item, ProposedAction, TopicView } from '../../shared/types'
import { BrandIcon, LinkIcon } from './Brand'
import { displayTitle, markedBlocked, refLabel, waitingFor } from './format'
import { useLayer } from './layers'
import { menuOfItem, menuOfView, showMenu } from './navigation'
import { rankStyle } from './rankStyle'
import { useDraft } from './useDraft'

const MAX_SIGNALS = 3

// My comments still waiting for an answer, each opening the comment itself
function AskedList({ lines }: { lines: AskedLine[] }) {
  if (lines.length === 0) return null
  return (
    <ul className="hero-asked">
      {lines.map(line => (
        <li key={line.url}>
          <button type="button" className="hero-asked-link" onClick={() => void window.flux.openExternal(line.url)}>
            <MessageCircleQuestion size={15} aria-hidden="true" />
            <span>
              {line.excerpt}
              <span className="hero-asked-age"> · ma question, sans réponse depuis {waitingFor(line.at)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// Figma threads waiting on my answer, each opening Figma on the comment
function CommentList({ comments }: { comments: CommentLine[] }) {
  if (comments.length === 0) return null
  return (
    <ul className="hero-asked hero-comments">
      {comments.map(comment => (
        <li key={comment.id}>
          <button type="button" className="hero-asked-link" onClick={() => void window.flux.openExternal(comment.url)}>
            <BrandIcon brand="figma" size={14} />
            <span>
              <strong>{comment.author}</strong> : {comment.excerpt}
              <span className="hero-asked-age"> · depuis {waitingFor(comment.at)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// Text being edited or selected keeps the system menu
function heroMenu(event: MouseEvent<HTMLElement>, menu: LinkMenu): void {
  const target = event.target as HTMLElement
  if (target.closest('textarea, input') || window.getSelection()?.toString()) return
  showMenu(event, menu)
}

const askedLines = (items: Item[]): AskedLine[] => items.flatMap(item => (item.asked ? [item.asked] : []))

interface HeroProps {
  view: TopicView
  position: string | null
}

export function Hero({ view, position }: HeroProps) {
  const { topic } = view
  const [error, setError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const [title, setTitle] = useDraft(topic.title, next =>
    void window.flux.updateTopic(topic.id, { title: next }),
  )
  const style = rankStyle(view.rank)
  const Icon = style.icon
  const titleField = useRef<HTMLTextAreaElement>(null)
  const pencil = useRef<HTMLButtonElement>(null)
  const blockForm = useRef<HTMLFormElement>(null)

  // The title is saved as it is typed: Enter and Escape only end the editing, back on the pencil
  const endEditing = () => {
    setEditing(false)
    setTimeout(() => pencil.current?.focus({ preventScroll: true }))
  }
  useLayer(editing, endEditing, { root: titleField })
  // The reason typed stays for the next opening
  useLayer(blocking, () => setBlocking(false), { root: blockForm })

  useEffect(() => {
    setError(null)
    setBlocking(false)
    setEditing(false)
    setReason('')
  }, [topic.id])

  const attempt = (task: Promise<unknown>) => {
    setError(null)
    task.catch((failure: Error) => setError(failure.message.replace(/^Error invoking.*?: /, '')))
  }

  const launch = (action: ProposedAction) => {
    if (action.prompt) attempt(window.flux.launchThread(topic.id, action))
    else if (action.url) attempt(window.flux.openExternal(action.url))
  }

  const [primary, ...others] = view.actions
  // A prompt opens a Claude thread; otherwise the action opens its link
  const destination = (action: ProposedAction, size: number) =>
    action.prompt ? <BrandIcon brand="claude" size={size} /> : <LinkIcon url={action.url} size={size} />

  return (
    <section className="hero" key={topic.id} onContextMenu={event => heroMenu(event, menuOfView(view))}>
      <p className="hero-rank">
        <span className="tile">
          <Icon size={15} strokeWidth={2.2} aria-hidden="true" />
        </span>
        {view.rank === null ? 'Note' : RANKS[view.rank].label}
      </p>

      <div className="hero-title">
        {editing ? (
          <textarea
            ref={titleField}
            autoFocus
            aria-label="Titre du sujet"
            rows={1}
            value={title}
            onChange={event => setTitle(event.target.value.replace(/\n/g, ' '))}
            // Renaming goes on from the end of the title
            onFocus={event => event.currentTarget.setSelectionRange(title.length, title.length)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              endEditing()
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <h1>{displayTitle(title)}</h1>
        )}
        {!editing && (
          <button
            ref={pencil}
            type="button"
            className="ghost"
            aria-label="Renommer le sujet"
            title="Renommer"
            onClick={() => setEditing(true)}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="hero-meta">
        {topic.links.slice(0, 3).map(link => (
          <span key={link}>{refLabel(link)}</span>
        ))}
        {view.since && <span>{waitingFor(view.since)} d'attente</span>}
        {position && <span>{position}</span>}
      </p>

      {topic.blocked && <p className="hero-blocked">Bloqué : {topic.blocked}</p>}
      {!topic.blocked && markedBlocked(topic.title) && (
        <p className="hero-blocked">PR marquée bloquée</p>
      )}

      {view.signals.length > 0 && (
        <ul className="hero-signals">
          {view.signals.slice(0, MAX_SIGNALS).map(signal => (
            <li key={signal.id}>{signal.detail}</li>
          ))}
          {view.signals.length > MAX_SIGNALS && (
            <li className="more">et {view.signals.length - MAX_SIGNALS} de plus</li>
          )}
        </ul>
      )}

      <CommentList comments={view.items.flatMap(item => item.comments ?? [])} />

      {view.signals.length === 0 && <AskedList lines={askedLines(view.items)} />}

      <div className="hero-actions">
        {primary && (
          <button type="button" className="pill solid" onClick={() => launch(primary)}>
            {destination(primary, 16)}
            {primary.label}
            <ArrowUpRight size={17} aria-hidden="true" />
          </button>
        )}
        {others.map(action => (
          <button
            type="button"
            className="pill glass"
            key={action.kind}
            onClick={() => launch(action)}
          >
            {destination(action, 15)}
            {action.label}
          </button>
        ))}
        {topic.blocked ? (
          <button
            type="button"
            className="round glass"
            aria-label="Débloquer"
            title="Débloquer"
            onClick={() => attempt(window.flux.updateTopic(topic.id, { blocked: undefined }))}
          >
            <LockOpen size={17} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="round glass"
            aria-label="Marquer bloqué"
            title="Marquer bloqué"
            aria-expanded={blocking}
            onClick={() => setBlocking(current => !current)}
          >
            <Hand size={17} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="round glass"
          aria-label="Clore le sujet"
          title="Clore le sujet"
          onClick={() => attempt(window.flux.closeTopic(topic.id))}
        >
          <Check size={17} aria-hidden="true" />
        </button>
      </div>

      {blocking && (
        <form
          ref={blockForm}
          className="block-form glass"
          onSubmit={event => {
            event.preventDefault()
            if (!reason.trim()) return
            attempt(window.flux.updateTopic(topic.id, { blocked: reason.trim() }))
            setBlocking(false)
            setReason('')
          }}
        >
          <input
            autoFocus
            aria-label="Raison du blocage"
            placeholder="Qu'est-ce qui bloque ?"
            value={reason}
            onChange={event => setReason(event.target.value)}
          />
          <button type="submit" className="pill solid small">
            Marquer bloqué
          </button>
        </form>
      )}

      {error && (
        <p className="hero-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

// A PR or ticket waiting on others that no topic holds yet: shown, and opened from here
export function LooseHero({ item }: { item: Item }) {
  const where = item.kind === 'pr' ? 'Ouvrir sur GitHub' : 'Ouvrir dans Linear'
  return (
    <section className="hero" key={item.ref} onContextMenu={event => heroMenu(event, menuOfItem(item))}>
      <p className="hero-rank">
        <span className="tile">
          <Hourglass size={15} strokeWidth={2.2} aria-hidden="true" />
        </span>
        En attente des autres
      </p>

      <div className="hero-title">
        <h1>{displayTitle(item.title)}</h1>
      </div>

      <p className="hero-meta">
        <span>{item.ref}</span>
        <span>{item.kind === 'pr' ? 'Pull request' : 'Ticket'}</span>
        {item.branch && <span>{item.branch}</span>}
      </p>

      <AskedList lines={askedLines([item])} />

      <div className="hero-actions">
        <button
          type="button"
          className="pill solid"
          onClick={() => void window.flux.openExternal(item.url)}
        >
          <LinkIcon url={item.url} size={16} />
          {where}
          <ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
