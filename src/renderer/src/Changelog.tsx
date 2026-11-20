import { ChevronLeft, ChevronRight, Play, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLayer } from './layers'
import { Spot } from './Spot'

interface Entry {
  id: string
  date: string
  name: string
  // What it changes, in a sentence or two, above its animation
  text: string
  scene?: string
}

// Newest first: the id of the first entry marks what was read
const ENTRIES: Entry[] = [
  {
    id: '2026-11-20-espace-claude',
    date: '20 nov.',
    name: 'Onglet Claude',
    text: 'Un onglet pour ce que Claude fait pour toi. Tes skills, du dernier lancé au plus ancien, chacun en graphe d’étapes et de MCP, avec ses versions à valider. Tes serveurs MCP et leur état, à reconnecter, ajouter ou retirer. Et les tâches que Flux lance à l’heure dite, le daily compris.',
    scene: 'claude',
  },
  {
    id: '2026-11-16-decoupage',
    date: '16 nov.',
    name: 'Nouveau découpage',
    text: 'Chaque sujet a une seule place : À démarrer tant que tu n’y as pas touché, En cours dès que tu l’entames, conversation ou pas, et Attente s’il est bloqué ou attend quelqu’un d’autre, même avec une conversation.',
    scene: 'split',
  },
  {
    id: '2026-11-16-nouveautes',
    date: '16 nov.',
    name: 'Nouveautés',
    text: 'Chaque nouveauté a sa page : ce qu’elle change, puis son animation, à voir en grand d’un clic.',
  },
  {
    id: '2026-11-16-mes-pr',
    date: '16 nov.',
    name: 'Mes PR',
    text: 'Un onglet pour toutes tes PR ouvertes, tous projets confondus : Open ou Draft, la CI, et où en est la review.',
    scene: 'pulls',
  },
  {
    id: '2026-11-16-journee',
    date: '16 nov.',
    name: 'Journée',
    text: 'Daily et Wrap-up se rangent sous un même onglet, qui rouvre le dernier des deux.',
    scene: 'day',
  },
  {
    id: '2026-11-16-reviews',
    date: '16 nov.',
    name: 'Reviews faites',
    text: 'Une review envoyée quitte la file et En cours, son thread avec, jusqu’à ce qu’on te la redemande.',
    scene: 'reviews',
  },
  {
    id: '2026-11-16-a-demarrer',
    date: '16 nov.',
    name: 'À démarrer',
    text: 'À démarrer remplace Notes : ce que tu n’as pas encore touché. Et En cours garde le sujet que tu y ouvres.',
    scene: 'unstarted',
  },
  {
    id: '2026-11-16-figma',
    date: '16 nov.',
    name: 'Figma',
    text: 'Figma rejoint tes outils : les commentaires qui t’attendent, une tâche par fichier, qui part une fois tout répondu.',
    scene: 'figma',
  },
  {
    id: '2026-11-13-prs',
    date: '13 nov.',
    name: 'PR sans ticket',
    text: 'Tes PR sans ticket, comme les e2e, restent dans Mes sujets jusqu’au merge.',
    scene: 'prs',
  },
  { id: '2026-11-13-columns', date: '13 nov.', name: 'Colonne du ticket', text: 'La colonne du ticket s’affiche sur sa carte.' },
  {
    id: '2026-11-13-todo',
    date: '13 nov.',
    name: 'Tickets à faire',
    text: 'Les tickets à faire qui te sont assignés restent dans Mes sujets, après ceux en cours.',
  },
  {
    id: '2026-11-13-parents',
    date: '13 nov.',
    name: 'Tickets parents',
    text: 'Les tickets parents sortent de Flux, sauf si on te demande quelque chose dessus.',
  },
  {
    id: '2026-11-13-sessions',
    date: '13 nov.',
    name: 'Sessions Claude',
    text: 'Les conversations Claude restent En cours et se rouvrent depuis les liens du sujet.',
    scene: 'sessions',
  },
  {
    id: '2026-11-12-workspaces',
    date: '12 nov.',
    name: 'Espaces',
    text: 'Un espace par produit, le compte GitHub au choix, et Jira en plus de Linear.',
  },
  { id: '2026-11-12-search', date: '12 nov.', name: 'Recherche', text: '⌘K cherche dans tout Flux : sujets, refs et onglets.' },
  {
    id: '2026-11-12-links',
    date: '12 nov.',
    name: 'Liens Flux',
    text: 'Clic droit : copier le lien source ou le lien Flux, qui rouvre Flux au bon endroit.',
  },
  { id: '2026-11-10-owner', date: '10 nov.', name: 'Attente en deux', text: 'Attente coupée entre mon travail et mes contributions.' },
  {
    id: '2026-11-10-stores',
    date: '10 nov.',
    name: 'Erreurs et avis',
    text: 'Les erreurs de l’app et les avis des stores arrivent dans le Daily.',
  },
  { id: '2026-11-10-daily', date: '10 nov.', name: 'Daily refait', text: 'Le Daily refait, en blocs courts.' },
  { id: '2026-11-10-intentions', date: '10 nov.', name: 'Intentions du jour', text: 'Les intentions du jour se réordonnent.' },
  { id: '2026-11-10-health', date: '10 nov.', name: 'Santé prod', text: 'La santé de la prod, d’un regard.' },
  { id: '2026-11-10-wrapup', date: '10 nov.', name: 'Wrap-up', text: 'Le Wrap-up prend la place de Dormant.' },
  { id: '2026-11-10-reviewed', date: '10 nov.', name: 'PR reviewées', text: 'Les PR que tu as reviewées se rangent en Attente.' },
  { id: '2026-11-10-refresh', date: '10 nov.', name: 'Tout actualiser', text: 'Un bouton relit tout d’un coup, ⌘R au clavier.' },
  { id: '2026-11-09-flux', date: '9 nov.', name: 'Première version', text: 'Première version de Flux.' },
]

// The entries by day, each with its place in the whole list
const DAYS = ENTRIES.reduce<Array<{ date: string; entries: Array<{ entry: Entry; index: number }> }>>(
  (days, entry, index) => {
    const last = days[days.length - 1]
    if (last?.date === entry.date) last.entries.push({ entry, index })
    else days.push({ date: entry.date, entries: [{ entry, index }] })
    return days
  },
  [],
)

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

// What came after the last visit; on a first visit, the latest day
function unreadOf(read: string | null): Set<string> {
  const unread =
    read === null
      ? ENTRIES.filter(entry => entry.date === ENTRIES[0].date)
      : ENTRIES.slice(0, Math.max(0, ENTRIES.findIndex(entry => entry.id === read)))
  return new Set(unread.map(entry => entry.id))
}

function CloseButton({ onClose }: { onClose(): void }) {
  return (
    <button type="button" className="round small glass" aria-label="Fermer" title="Fermer" onClick={onClose}>
      <X size={15} aria-hidden="true" />
    </button>
  )
}

// The names first; one opens on its page, with what it changes, its animation, and the way to
// the next one. Escape and ⌘[ step back: out of fullscreen, then to the list, then out
function ChangelogModal({ unread, onClose }: { unread: Set<string>; onClose(): void }) {
  const [open, setOpen] = useState<number | null>(null)
  const [full, setFull] = useState(false)
  const rows = useRef<Array<HTMLButtonElement | null>>([])
  const last = useRef<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const entry = open === null ? null : ENTRIES[open]

  const show = (index: number | null) => {
    if (index !== null && (index < 0 || index >= ENTRIES.length)) return
    if (index === null || !ENTRIES[index].scene) setFull(false)
    if (open !== null) last.current = open
    setOpen(index)
  }

  // Back on the list, the row of the page just left keeps the focus, and stays in view. On a page,
  // the dialog holds it while the row that had it is hidden
  useEffect(() => {
    if (open === null && last.current !== null) rows.current[last.current]?.focus()
    else if (open !== null && !(document.activeElement instanceof HTMLElement && document.activeElement.checkVisibility()))
      root.current?.focus({ preventScroll: true })
  }, [open])

  const stepBack = () => {
    if (full) setFull(false)
    else if (open !== null) show(null)
    else onClose()
  }
  useLayer(true, stepBack, { root, focus: true })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (open === null || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'ArrowLeft') show(open - 1)
      else if (event.key === 'ArrowRight') show(open + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="scrim spot-scrim" onClick={onClose}>
      <div
        ref={root}
        className={`news${entry ? ' detail' : ''}${full ? ' full' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={entry ? `Nouveautés : ${entry.name}` : 'Nouveautés'}
        tabIndex={-1}
        data-layer
        onClick={event => event.stopPropagation()}
      >
        <div className="news-list" hidden={entry !== null}>
          <header className="news-bar">
            <h2>Nouveautés</h2>
            <CloseButton onClose={onClose} />
          </header>
          <div className="news-scroll">
            {DAYS.map(day => (
              <section key={day.date} className="news-day" aria-label={day.date}>
                <h3>{day.date}</h3>
                <ul>
                  {day.entries.map(({ entry: item, index }) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        ref={element => void (rows.current[index] = element)}
                        className="news-row"
                        onClick={() => show(index)}
                      >
                        <span className="news-name">{item.name}</span>
                        {unread.has(item.id) && <span className="news-new">Nouveau</span>}
                        {item.scene && (
                          <span className="news-motion" title="Avec son animation">
                            <Play size={11} aria-hidden="true" />
                          </span>
                        )}
                        <ChevronRight size={15} className="news-go" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        {entry && open !== null && (
          <div className="news-detail" key={entry.id}>
            <header className="news-bar">
              <button type="button" className="pill glass small" onClick={() => show(null)}>
                <ChevronLeft size={15} aria-hidden="true" />
                Nouveautés
              </button>
              <div className="news-nav">
                <button
                  type="button"
                  className="round small glass"
                  aria-label="Nouveauté précédente"
                  title="Précédente (←)"
                  disabled={open === 0}
                  onClick={() => show(open - 1)}
                >
                  <ChevronLeft size={15} aria-hidden="true" />
                </button>
                <span className="news-count">
                  {open + 1} / {ENTRIES.length}
                </span>
                <button
                  type="button"
                  className="round small glass"
                  aria-label="Nouveauté suivante"
                  title="Suivante (→)"
                  disabled={open === ENTRIES.length - 1}
                  onClick={() => show(open + 1)}
                >
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
                <CloseButton onClose={onClose} />
              </div>
            </header>
            <div className="news-copy">
              <p className="news-date">{entry.date}</p>
              <h1>{entry.name}</h1>
              <p className="news-text">{entry.text}</p>
            </div>
            {entry.scene && <Spot key={entry.id} scene={entry.scene} full={full} onFull={setFull} />}
          </div>
        )}
      </div>
    </div>
  )
}

export function Changelog() {
  // What is new is read when the panel opens, before it marks everything read
  const [open, setOpen] = useState<Set<string> | null>(null)
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
          setOpen(unreadOf(read))
          saveMark(latest)
          setRead(latest)
        }}
      >
        <Sparkles size={16} aria-hidden="true" />
        {read !== latest && <span className="unread" aria-label="Nouveautés à voir" />}
      </button>
      {open && <ChangelogModal unread={open} onClose={() => setOpen(null)} />}
    </>
  )
}
