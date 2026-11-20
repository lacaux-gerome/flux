import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLayer } from './layers'
import { CALENDARS, type CalendarName } from '../../shared/calendars'
import { TRACKERS, type TrackerInfo, type TrackerName } from '../../shared/trackers'

const MENU_CLOSE_MS = 120

type BadgeName = TrackerName | CalendarName

// Brand colours only: the initials stand in for logos the app does not ship
const BADGE: Record<BadgeName, { background: string; color: string; initial: string }> = {
  jira: { background: '#2684ff', color: '#ffffff', initial: 'J' },
  linear: { background: '#5e6ad2', color: '#ffffff', initial: 'L' },
  trello: { background: '#0c66e4', color: '#ffffff', initial: 'T' },
  notion: { background: '#f4f5f7', color: '#0a0c12', initial: 'N' },
  outlook: { background: '#5b5fc7', color: '#ffffff', initial: 'T' },
  google: { background: '#1a73e8', color: '#ffffff', initial: 'G' },
  apple: { background: '#f4f5f7', color: '#0a0c12', initial: 'i' },
  figma: { background: '#1e1e1e', color: '#ffffff', initial: 'F' },
}

export const TRACKER_HINT: Record<TrackerName, string> = {
  jira: 'Tickets assignés et tickets cités par tes sujets',
  linear: 'Tickets assignés, mentions et commentaires',
  figma: 'Commentaires qui t’attendent, une tâche par fichier',
  trello: 'Cartes qui te sont assignées',
  notion: 'Tâches de tes bases Notion',
}

export function trackerInfo(name: TrackerName): TrackerInfo {
  return TRACKERS.find(tracker => tracker.id === name)!
}

export function TrackerBadge({ name, size = 28 }: { name: BadgeName; size?: number }) {
  const badge = BADGE[name]
  return (
    <span
      className="tracker-badge"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: badge.background,
        color: badge.color,
        fontSize: size * 0.48,
      }}
    >
      {badge.initial}
    </span>
  )
}

interface MenuEntry<Name extends BadgeName> {
  id: Name
  label: string
  hint: string
  soon?: boolean
}

function AddMenu<Name extends BadgeName>({
  label,
  entries,
  onAdd,
}: {
  label: string
  entries: Array<MenuEntry<Name>>
  onAdd(name: Name): void
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useLayer(open, () => setOpen(false), { root })

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), MENU_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (entries.length === 0) return null

  return (
    <div
      className="tracker-add"
      ref={root}
    >
      <button
        type="button"
        className="tracker-add-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <Plus size={16} aria-hidden="true" />
        {label}
      </button>
      {mounted && (
        <div className="account-menu tracker-menu" data-state={open ? 'open' : 'closed'} role="menu">
          {entries.map(entry => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              className="account-option"
              disabled={entry.soon}
              onClick={() => {
                onAdd(entry.id)
                setOpen(false)
              }}
            >
              <TrackerBadge name={entry.id} size={24} />
              <strong>{entry.label}</strong>
              <span className="tracker-hint">{entry.soon ? 'Bientôt' : entry.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AddTrackerMenu({
  chosen,
  onAdd,
}: {
  chosen: TrackerName[]
  onAdd(name: TrackerName): void
}) {
  const entries = TRACKERS.filter(tracker => !chosen.includes(tracker.id)).map(tracker => ({
    ...tracker,
    hint: TRACKER_HINT[tracker.id],
  }))
  return <AddMenu label="Ajouter un outil" entries={entries} onAdd={onAdd} />
}

export function AddCalendarMenu({ onAdd }: { onAdd(name: CalendarName): void }) {
  return <AddMenu label="Ajouter un agenda" entries={CALENDARS} onAdd={onAdd} />
}
