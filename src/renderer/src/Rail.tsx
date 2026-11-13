import { Bot, MessagesSquare, UserRound, type LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { RANKS } from '../../shared/ranks'
import type { Item, Rank, TopicView } from '../../shared/types'
import { LinkIcon } from './Brand'
import { displayTitle, waitingFor } from './format'
import { looseId, menuOfItem, menuOfView, showMenu } from './navigation'
import { rankStyle, tint } from './rankStyle'

// The board column, the first to shrink when the card runs out of room
function StateTag({ state }: { state?: string }) {
  if (!state) return null
  return (
    <span className="card-state" title={`Statut : ${state}`}>
      {state}
    </span>
  )
}

interface CardProps {
  view: TopicView
  selected: boolean
  fresh: boolean
  onSelect(id: string): void
}

function Card({ view, selected, fresh, onSelect }: CardProps) {
  const element = useRef<HTMLButtonElement>(null)
  const busy = view.threads.some(thread => thread.status === 'busy')
  const ref = view.topic.links[0] ?? 'Note'
  const state = view.items.find(item => item.kind === 'ticket' && item.state)?.state

  useEffect(() => {
    if (selected) {
      element.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }, [selected])

  return (
    <button
      ref={element}
      type="button"
      className="card"
      aria-current={selected ? 'true' : undefined}
      style={tint(rankStyle(view.rank))}
      onClick={() => onSelect(view.topic.id)}
      onContextMenu={event => showMenu(event, menuOfView(view))}
    >
      {fresh && <span className="badge">Nouveau</span>}
      <span className="card-head">
        <strong>{ref}</strong>
        <StateTag state={state} />
        {busy && <Bot size={14} aria-label="Agent au travail" />}
        <span className="age">{waitingFor(view.since)}</span>
      </span>
      <span className="card-title">{view.topic.blocked ?? displayTitle(view.topic.title)}</span>
    </button>
  )
}

interface LooseCardProps {
  item: Item
  selected: boolean
  onSelect(id: string): void
}

function LooseCard({ item, selected, onSelect }: LooseCardProps) {
  const element = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (selected) {
      element.current?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' })
    }
  }, [selected])

  return (
    <button
      ref={element}
      type="button"
      className="card"
      aria-current={selected ? 'true' : undefined}
      style={tint(rankStyle(null))}
      onClick={() => onSelect(looseId(item))}
      onContextMenu={event => showMenu(event, menuOfItem(item))}
    >
      <span className="card-head">
        <strong className="card-link">
          <LinkIcon url={item.url} size={12} />
          {item.ref}
        </strong>
        <StateTag state={item.state} />
        {item.asked && <span className="age">{waitingFor(item.asked.at)}</span>}
      </span>
      <span className="card-title">{displayTitle(item.title)}</span>
    </button>
  )
}

interface GroupProps {
  label?: string
  rank?: Rank
  icon?: LucideIcon
  hint?: string
  children: ReactNode
}

function Group({ label, rank, icon, hint, children }: GroupProps) {
  const style = rank === undefined ? null : rankStyle(rank)
  const Icon = icon ?? style?.icon
  return (
    <div className="rail-group">
      {label && (
        <h2 style={style ? tint(style) : undefined} title={hint}>
          {Icon && <Icon size={13} strokeWidth={2.4} aria-hidden="true" />}
          {label}
        </h2>
      )}
      <div className="rail-cards">{children}</div>
    </div>
  )
}

export interface OwnerGroup {
  label: string
  hint: string
  icon: LucideIcon
  views: TopicView[]
  loose: Item[]
}

// Waiting splits my own work from the work of others I take part in: they do not weigh the same
export function ownerGroups(views: TopicView[], loose: Item[]): OwnerGroup[] {
  return [
    {
      label: 'Mon travail',
      hint: 'Mes PR et mes tickets, en attente de quelqu’un',
      icon: UserRound,
      views: views.filter(view => view.mine),
      loose: loose.filter(item => item.mine),
    },
    {
      label: 'Mes contributions',
      hint: 'Les PR et tickets des autres que j’ai relus ou commentés',
      icon: MessagesSquare,
      views: views.filter(view => !view.mine),
      loose: loose.filter(item => !item.mine),
    },
  ].filter(group => group.views.length + group.loose.length > 0)
}

interface RailProps {
  views: TopicView[]
  loose?: Item[]
  grouping: 'rank' | 'owner' | 'none'
  selected: string | null
  isFresh(view: TopicView): boolean
  onSelect(id: string): void
}

export function Rail({ views, loose = [], grouping, selected, isFresh, onSelect }: RailProps) {
  const track = useRef<HTMLDivElement>(null)
  const card = (view: TopicView) => (
    <Card
      key={view.topic.id}
      view={view}
      selected={view.topic.id === selected}
      fresh={isFresh(view)}
      onSelect={onSelect}
    />
  )
  const looseCard = (item: Item) => (
    <LooseCard key={item.ref} item={item} selected={looseId(item) === selected} onSelect={onSelect} />
  )
  const ranks = [...new Set(views.map(view => view.rank))].filter(
    (rank): rank is Rank => rank !== null,
  )

  return (
    <nav className="rail" aria-label="Sujets dans l'ordre du flux">
      <div
        className="rail-track"
        ref={track}
        onWheel={event => {
          if (track.current && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            track.current.scrollLeft += event.deltaY
          }
        }}
      >
        {grouping === 'rank' &&
          ranks.map(rank => (
            <Group key={rank} label={RANKS[rank].label} rank={rank}>
              {views.filter(view => view.rank === rank).map(card)}
            </Group>
          ))}
        {grouping === 'owner' &&
          ownerGroups(views, loose).map((group, index) => (
            <Fragment key={group.label}>
              {index > 0 && <span className="rail-divider" aria-hidden="true" />}
              <Group
                label={`${group.label} · ${group.views.length + group.loose.length}`}
                icon={group.icon}
                hint={group.hint}
              >
                {group.views.map(card)}
                {group.loose.map(looseCard)}
              </Group>
            </Fragment>
          ))}
        {grouping === 'none' && <Group>{views.map(card)}</Group>}
      </div>
    </nav>
  )
}
