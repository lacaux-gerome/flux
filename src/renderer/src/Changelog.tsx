import { Play, RotateCcw, Sparkles, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import { Spot } from './Spot'

// Newest first, one line each: the id of the first entry marks what was read
const ENTRIES: Array<{ id: string; date: string; text: string; scene?: string }> = [
  { id: '2026-11-13-prs', date: '13 nov.', text: 'Tes PR sans ticket, comme les e2e, restent dans Mes sujets jusqu’au merge' },
  { id: '2026-11-13-columns', date: '13 nov.', text: 'La colonne du ticket s’affiche sur sa carte' },
  { id: '2026-11-13-todo', date: '13 nov.', text: 'Les tickets à faire qui te sont assignés restent dans Mes sujets, après ceux en cours' },
  { id: '2026-11-13-parents', date: '13 nov.', text: 'Les tickets parents sortent de Flux, sauf si on te demande quelque chose dessus' },
  {
    id: '2026-11-13-sessions',
    date: '13 nov.',
    text: 'Les conversations Claude restent En cours et se rouvrent depuis les liens du sujet',
    scene: 'sessions',
  },
  { id: '2026-11-12-profiles', date: '12 nov.', text: 'Profils Pro et Perso, chacun avec ses réglages' },
  { id: '2026-11-12-workspaces', date: '12 nov.', text: 'Espaces par produit, compte GitHub au choix, Jira en plus de Linear' },
  { id: '2026-11-12-search', date: '12 nov.', text: 'Recherche ⌘K dans tout Flux' },
  { id: '2026-11-12-links', date: '12 nov.', text: 'Clic droit : copier le lien source ou le lien Flux, qui rouvre Flux au bon endroit' },
  { id: '2026-11-10-owner', date: '10 nov.', text: 'Attente coupée entre mon travail et mes contributions' },
  { id: '2026-11-10-stores', date: '10 nov.', text: 'Erreurs app et avis des stores dans le Daily' },
  { id: '2026-11-10-daily', date: '10 nov.', text: 'Daily refait, en blocs courts' },
  { id: '2026-11-10-intentions', date: '10 nov.', text: 'Intentions du jour réordonnables' },
  { id: '2026-11-10-health', date: '10 nov.', text: 'Santé prod d’un regard' },
  { id: '2026-11-10-wrapup', date: '10 nov.', text: 'Wrap-up à la place de Dormant' },
  { id: '2026-11-10-reviewed', date: '10 nov.', text: 'PR reviewées rangées en Attente' },
  { id: '2026-11-10-refresh', date: '10 nov.', text: 'Bouton Tout actualiser' },
  { id: '2026-11-09-flux', date: '9 nov.', text: 'Première version' },
]

const READ_KEY = 'flux.changelogRead'

function readMark(): string | null {
  try {
    return localStorage.getItem(READ_KEY)
  } catch {
    return null
  }
}

function saveMark(id: string): void {
  try {
    localStorage.setItem(READ_KEY, id)
  } catch {
    return
  }
}

// The scenes of what was not read yet, else the latest one
function freshScenes(read: string | null): string[] {
  const unread = read === null ? ENTRIES : ENTRIES.slice(0, Math.max(0, ENTRIES.findIndex(entry => entry.id === read)))
  const scenes = [...new Set(unread.flatMap(entry => (entry.scene ? [entry.scene] : [])))]
  return scenes.length > 0 ? scenes : ENTRIES.flatMap(entry => (entry.scene ? [entry.scene] : [])).slice(0, 1)
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type View = { kind: 'spot'; playlist: string[]; take: number } | { kind: 'list' }

function ChangelogModal({ fresh, onClose }: { fresh: string[]; onClose(): void }) {
  // With reduced motion nothing plays by itself: the list opens, and a scene plays when asked
  const [view, setView] = useState<View>(() =>
    reducedMotion() || fresh.length === 0 ? { kind: 'list' } : { kind: 'spot', playlist: fresh, take: 0 },
  )
  const play = (playlist: string[]) =>
    setView(current => ({ kind: 'spot', playlist, take: current.kind === 'spot' ? current.take + 1 : 0 }))

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="scrim spot-scrim" onClick={onClose}>
      <div
        className="spot-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Nouveautés"
        onClick={event => event.stopPropagation()}
      >
        <header className="spot-modal-head">
          <h2>Nouveautés</h2>
          <button type="button" className="round small glass" aria-label="Fermer" title="Échap" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        {view.kind === 'spot' ? (
          <Spot key={view.take} playlist={view.playlist} onEnd={() => setView({ kind: 'list' })} />
        ) : (
          <div className="spot-list">
            <ul>
              {ENTRIES.map((entry, index) => {
                const scene = entry.scene
                return (
                  <li key={entry.id} style={{ '--n': index } as CSSProperties}>
                    <span className="spot-list-date">{entry.date}</span>
                    <span className="spot-list-text">{entry.text}</span>
                    {scene && (
                      <button
                        type="button"
                        className="round small glass"
                        aria-label={`Voir : ${entry.text}`}
                        title="Voir la scène"
                        onClick={() => play([scene])}
                      >
                        <Play size={13} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
            {fresh.length > 0 && (
              <button type="button" className="pill glass small" onClick={() => play(fresh)}>
                <RotateCcw size={14} aria-hidden="true" />
                Revoir la présentation
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function Changelog() {
  // The scenes to play are chosen when the panel opens, before it marks everything read
  const [open, setOpen] = useState<string[] | null>(null)
  const [read, setRead] = useState(readMark)
  const latest = ENTRIES[0].id

  return (
    <>
      <button
        type="button"
        className="round glass changelog"
        aria-label="Nouveautés"
        title="Nouveautés"
        onClick={() => {
          setOpen(freshScenes(read))
          saveMark(latest)
          setRead(latest)
        }}
      >
        <Sparkles size={16} aria-hidden="true" />
        {read !== latest && <span className="unread" aria-label="Nouveautés à voir" />}
      </button>
      {open && <ChangelogModal fresh={open} onClose={() => setOpen(null)} />}
    </>
  )
}
