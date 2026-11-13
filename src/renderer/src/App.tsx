import {
  CalendarClock,
  CloudOff,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  Search as SearchIcon,
  Settings,
  TriangleAlert,
  Waves,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseFluxLink } from '../../shared/links'
import type { JobBoard } from '../../shared/jobs'
import type { AppState, MyPulls, Settings as FluxSettings, SourceName } from '../../shared/types'
import { Boot, type BootProgress } from './Boot'
import { BrandIcon } from './Brand'
import { Changelog } from './Changelog'
import { DailyView } from './DailyView'
import { clock, until } from './format'
import { Hero, LooseHero } from './Hero'
import { Inspector } from './Inspector'
import { ClaudeSpace, type ClaudePart } from './ClaudeSpace'
import { Onboarding } from './Onboarding'
import {
  allViews,
  listOf,
  looseId,
  resolveRoute,
  tabFor,
  type ListTab,
  type SearchResult,
  type SheetTab,
  type Tab,
} from './navigation'
import { PullsView } from './PullsView'
import { ownerGroups, Rail } from './Rail'
import { rankStyle, type RankStyle } from './rankStyle'
import { Search } from './Search'
import { useSlidingThumb } from './SlidingThumb'
import { SettingsPanel } from './SettingsPanel'
import { Toast, type ToastMessage } from './Toast'
import { Stage } from './Stage'
import { readMark, saveMark } from './storage'
import { useSeen } from './useSeen'
import { WorkspaceSwitch } from './WorkspaceSwitch'
import { WrapupView } from './WrapupView'


const DAILY_READ_KEY = 'flux.dailyRead'
const WRAPUP_READ_KEY = 'flux.wrapupRead'
const CLAUDE_PART_KEY = 'flux.claudePart'
// The loading scene plays at least this long, then dissolves into the app
const BOOT_MIN_MS = 1800
const BOOT_EXIT_MS = 900

const SOURCE_LABEL: Record<SourceName, string> = {
  github: 'GitHub',
  linear: 'Linear',
  jira: 'Jira',
  figma: 'Figma',
  agents: 'Agents',
  calendar: 'Agenda',
}

function isSheet(tab: Tab): tab is SheetTab {
  return tab === 'pulls' || tab === 'claude' || tab === 'wrapup' || tab === 'daily'
}

type DayTab = 'daily' | 'wrapup'
const isDay = (tab: Tab): tab is DayTab => tab === 'daily' || tab === 'wrapup'

// Daily and wrap-up share one tab of the bar, each a page of its own
function DayTabs({
  tab,
  unread,
  onPick,
}: {
  tab: DayTab
  unread: Record<DayTab, boolean>
  onPick(tab: DayTab): void
}) {
  const entries: Array<{ key: DayTab; label: string; hint: string }> = [
    { key: 'daily', label: 'Daily', hint: 'Nouveau daily' },
    { key: 'wrapup', label: 'Wrap-up', hint: 'Wrap-up à faire' },
  ]
  return (
    <nav className="tabs glass day-tabs" aria-label="Journée">
      {entries.map(entry => (
        <button
          type="button"
          key={entry.key}
          aria-current={tab === entry.key ? 'page' : undefined}
          onClick={() => onPick(entry.key)}
        >
          {entry.label}
          {unread[entry.key] && <span className="unread" aria-label={entry.hint} />}
        </button>
      ))}
    </nav>
  )
}

function emptyTitle(tab: ListTab, looseCount: number): string {
  if (tab === 'queue') return "Rien ne t'attend."
  if (tab === 'unstarted') return 'Rien à démarrer : le reste est en cours ou en attente.'
  if (tab === 'waiting' && looseCount > 0) return 'Ces sujets attendent les autres.'
  return 'Rien ici pour le moment.'
}

// The part of the Claude space left open last time
function storedClaudePart(): ClaudePart {
  const part = readMark(CLAUDE_PART_KEY)
  return part === 'mcp' || part === 'tasks' ? part : 'skills'
}

// The main views bar: the chosen view's pill slides like the projects toggle's. Daily and wrap-up share one tab
function ViewTabs({
  tabs,
  current,
  unread,
  onPick,
}: {
  tabs: Array<{ key: Tab; label: string; count: number }>
  current: Tab
  unread: { daily: boolean; wrapup: boolean }
  onPick(key: Tab): void
}) {
  const active = isDay(current) ? 'daily' : current
  const { register, thumb } = useSlidingThumb(active, [tabs.map(entry => entry.key).join()])
  return (
    <nav className="tabs sliding glass lens" aria-label="Vues">
      {thumb}
      {tabs.map(entry => (
        <button
          type="button"
          key={entry.key}
          ref={register(entry.key)}
          aria-current={active === entry.key ? 'page' : undefined}
          onClick={() => onPick(entry.key)}
        >
          {entry.key === 'claude' && <BrandIcon brand="claude" size={14} />}
          {entry.label}
          {entry.count > 0 && <span className="count">{entry.count}</span>}
          {entry.key === 'daily' && (unread.daily || unread.wrapup) && (
            <span className="unread" aria-label={unread.daily ? 'Nouveau daily' : 'Wrap-up à faire'} />
          )}
        </button>
      ))}
    </nav>
  )
}

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [tab, setTab] = useState<Tab>('queue')
  const [selected, setSelected] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Which page the settings window opens on: the selector's button goes straight to Espaces
  const [settingsView, setSettingsView] = useState<'main' | 'workspaces'>('main')
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const showToast = (text: string, tone: ToastMessage['tone'] = 'ok') =>
    setToast({ id: Date.now(), text, tone })
  const [readDate, setReadDate] = useState(() => readMark(DAILY_READ_KEY))
  const [readSlot, setReadSlot] = useState(() => readMark(WRAPUP_READ_KEY))
  const [onboarding, setOnboarding] = useState(false)
  const [sceneTint, setSceneTint] = useState<RankStyle | null>(null)
  const [settings, setSettings] = useState<FluxSettings | null>(null)
  const [progress, setProgress] = useState<BootProgress>({})
  const [boot, setBoot] = useState<'playing' | 'leaving' | 'done'>('playing')
  const [refreshing, setRefreshing] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  // A flux:// link waits for the first state before it can land
  const [link, setLink] = useState<string | null>(null)
  const bootStart = useRef(performance.now())
  // The day tab reopens on the page you left it on
  const [day, setDay] = useState<DayTab>('daily')
  const [pulls, setPulls] = useState<MyPulls | null>(null)
  const [pullsLoading, setPullsLoading] = useState(false)
  const [jobs, setJobs] = useState<JobBoard | null>(null)
  const [claudePart, setClaudePart] = useState<ClaudePart>(storedClaudePart)

  // GitHub answers from a cache of a couple of minutes unless forced
  const loadPulls = (force: boolean) => {
    setPullsLoading(true)
    window.flux
      .myPulls(force)
      .then(setPulls)
      .catch(error => setPulls(current => ({ at: current?.at ?? null, pulls: current?.pulls ?? [], error: (error as Error).message })))
      .finally(() => setPullsLoading(false))
  }

  // Refetches every source, calendar included; the button and ⌘R share it
  const refreshAll = () => {
    if (refreshing) return
    setRefreshing(true)
    loadPulls(true)
    window.flux
      .refreshAll()
      .catch(error => showToast(`Actualisation impossible : ${(error as Error).message}`, 'error'))
      .finally(() => setRefreshing(false))
  }

  useEffect(() => window.flux.onRefreshShortcut(refreshAll))

  // Chosen workspace until the main process confirms it with a new state
  const [switching, setSwitching] = useState<string | null>(null)

  const switchWorkspace = (id: string) => {
    if (id === (switching ?? state?.workspace)) return
    setSwitching(id)
    setSelected(null)
    window.flux.saveSettings({ workspace: id }).catch(error => {
      setSwitching(null)
      showToast(`Changement d’espace impossible : ${(error as Error).message}`, 'error')
    })
  }

  useEffect(() => {
    if (switching && state?.workspace === switching) setSwitching(null)
  }, [state?.workspace])

  useEffect(() => {
    void window.flux.getSettings().then(loaded => {
      setSettings(loaded)
      setOnboarding(!loaded.onboarded)
    })
  }, [])

  useEffect(() => {
    void window.flux.getState().then(initial => {
      // A window opened after the first sync has nothing to wait for
      if (initial) setBoot('done')
      setState(current => current ?? initial)
    })
    const stopState = window.flux.onState(setState)
    const stopProgress = window.flux.onProgress(({ source, ok }) =>
      setProgress(current => ({ ...current, [source]: ok })),
    )
    return () => {
      stopState()
      stopProgress()
    }
  }, [])

  useEffect(() => {
    if (!state || boot !== 'playing') return undefined
    const wait = Math.max(0, BOOT_MIN_MS - (performance.now() - bootStart.current))
    const timer = setTimeout(() => setBoot('leaving'), wait)
    return () => clearTimeout(timer)
  }, [state, boot])

  useEffect(() => {
    if (boot !== 'leaving') return undefined
    const timer = setTimeout(() => setBoot('done'), BOOT_EXIT_MS)
    return () => clearTimeout(timer)
  }, [boot])

  useEffect(
    () =>
      window.flux.onOpenTopic(id => {
        setSelected(id)
        setSettingsOpen(false)
      }),
    [],
  )

  useEffect(() => {
    const stop = window.flux.onOpenLink(setLink)
    void window.flux.takeLink().then(waiting => waiting && setLink(waiting))
    return stop
  }, [])

  useEffect(() => {
    if (!link || !state) return
    setLink(null)
    const route = parseFluxLink(link)
    const target = route ? resolveRoute(state, route) : null
    if (!target) {
      showToast(
        route && route.kind !== 'tab' ? `Plus dans Flux : ${route.kind === 'ref' ? route.ref : route.id}` : 'Lien Flux inconnu',
        'error',
      )
      return
    }
    setSettingsOpen(false)
    setSearchOpen(false)
    setTab(target.tab)
    setSelected(target.selected)
  }, [link, state])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(open => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => window.flux.onOpenDaily(() => setTab('daily')), [])

  // Jobs come from Flux itself: read once, then each change as it happens
  useEffect(() => {
    void window.flux.jobs().then(setJobs)
    return window.flux.onJobs(setJobs)
  }, [])

  // Opening the tasks reads the skills, the MCP servers and the daily again
  useEffect(() => {
    if (tab === 'claude' && claudePart === 'tasks') void window.flux.jobs().then(setJobs)
  }, [tab, claudePart])
  useEffect(
    () =>
      window.flux.onOpenWrapup(() => {
        setTab('wrapup')
        setSettingsOpen(false)
      }),
    [],
  )

  useEffect(() => {
    if (!state || !selected) return
    const owner = tabFor(state, selected, tab)
    if (owner && owner !== tab) setTab(owner)
  }, [selected, state === null])

  // Each sync asks again, so the count in the bar stays current
  useEffect(() => {
    if (state) loadPulls(false)
  }, [state?.generatedAt])

  useEffect(() => {
    if (isDay(tab)) setDay(tab)
  }, [tab])

  useEffect(() => {
    if (tab === 'daily' && state?.daily.status === 'ready') {
      saveMark(DAILY_READ_KEY, state.daily.date)
      setReadDate(state.daily.date)
    }
  }, [tab, state?.daily.status, state?.daily.date])

  const wrapupMark = state?.wrapup.slot ? `${state.wrapup.date} ${state.wrapup.slot}` : null
  useEffect(() => {
    if (tab === 'wrapup' && wrapupMark) {
      saveMark(WRAPUP_READ_KEY, wrapupMark)
      setReadSlot(wrapupMark)
    }
  }, [tab, wrapupMark])

  const views = useMemo(() => (state ? allViews(state) : []), [state])
  const sheet = isSheet(tab)
  const listTab: ListTab = isSheet(tab) ? 'queue' : tab
  const list = useMemo(() => (state ? listOf(state, listTab) : []), [state, listTab])
  const current =
    (!sheet && list.find(view => view.topic.id === selected)) ||
    (!sheet ? views.find(view => view.topic.id === selected) : undefined) ||
    list[0]
  const looseItem =
    tab === 'waiting' ? state?.loose.find(item => looseId(item) === selected) : undefined
  const currentId = looseItem ? looseId(looseItem) : (current?.topic.id ?? null)
  const isFresh = useSeen(state?.queue ?? [], sheet ? null : currentId)
  const focusRank = looseItem ? null : (current?.rank ?? null)
  const style = useMemo(() => rankStyle(focusRank), [focusRank])
  // Arrow keys walk the rail in order, loose items included
  const order = useMemo(
    () =>
      tab === 'waiting'
        ? ownerGroups(list, state?.loose ?? []).flatMap(group => [
            ...group.views.map(view => view.topic.id),
            ...group.loose.map(looseId),
          ])
        : list.map(view => view.topic.id),
    [list, tab, state?.loose],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA'].includes(target.tagName) || sheet || settingsOpen || searchOpen) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const index = order.indexOf(currentId ?? '')
      const next = order[index + (event.key === 'ArrowRight' ? 1 : -1)]
      if (next) {
        event.preventDefault()
        setSelected(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, currentId, sheet, settingsOpen, searchOpen])

  // Same slot in both trees, so the scene keeps playing while the app appears underneath
  const bootScene =
    boot === 'done' ? null : (
      <Boot leaving={boot === 'leaving'} progress={progress} settings={settings} />
    )

  if (onboarding) {
    return (
      <div className="app">
        <Stage style={sceneTint ?? style} drift />
        <div className="veil" aria-hidden="true" />
        <Onboarding
          onTint={setSceneTint}
          onDone={() => {
            setOnboarding(false)
            setSceneTint(null)
            void window.flux.refresh()
          }}
        />
      </div>
    )
  }

  if (!state || settings === null) {
    return (
      <>
        {null}
        {bootScene}
      </>
    )
  }

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'queue', label: 'File', count: state.queue.length },
    { key: 'active', label: 'En cours', count: state.active.length },
    {
      key: 'waiting',
      label: 'Attente',
      count: listOf(state, 'waiting').length + state.loose.length,
    },
    { key: 'unstarted', label: 'À démarrer', count: listOf(state, 'unstarted').length },
    { key: 'pulls', label: 'Mes PR', count: pulls?.pulls.length ?? 0 },
    // Daily and wrap-up, under one tab
    { key: 'daily', label: 'Journée', count: 0 },
    { key: 'claude', label: 'Claude', count: 0 },
  ]
  const failing = (Object.keys(state.sources) as SourceName[]).filter(
    name => !state.sources[name]?.ok,
  )
  // Before its first answer a source is just loading: only an unconfigured one asks to connect
  const toConnect = failing.filter(name => state.sources[name]?.missing)
  const broken = failing.filter(name => state.sources[name]?.error && !state.sources[name]?.missing)
  // Offline only when the network is: a refused token or a missing right is fixed in the settings
  const offline = broken.filter(name => state.sources[name]?.failure === 'network')
  const toReconnect = broken.filter(name => state.sources[name]?.failure === 'access')
  const erring = broken.filter(name => !offline.includes(name) && !toReconnect.includes(name))
  // The title gives way to the time when the bar runs short
  const meeting = state.meeting.current
    ? { title: state.meeting.current.title, when: 'en cours' }
    : state.meeting.next
      ? { title: state.meeting.next.title, when: until(state.meeting.next.start) }
      : null
  const offlineLabel = offline.map(name => SOURCE_LABEL[name]).join(', ')
  const failures = (names: SourceName[]) =>
    names.map(name => `${SOURCE_LABEL[name]} : ${state.sources[name]?.error ?? ''}`).join('\n')
  const connectLabel = toConnect.map(name => SOURCE_LABEL[name]).join(', ')
  const unreadDaily = state.daily.status === 'ready' && readDate !== state.daily.date
  const unreadWrapup = wrapupMark !== null && readSlot !== wrapupMark
  const dayTabs = isDay(tab) ? (
    <DayTabs tab={tab} unread={{ daily: unreadDaily, wrapup: unreadWrapup }} onPick={setTab} />
  ) : null
  const index = list.findIndex(view => view.topic.id === currentId)
  const position = (tab === 'queue' || tab === 'unstarted') && index >= 0 ? `${index + 1} sur ${list.length}` : null
  const openTopic = (id: string) => {
    setSelected(id)
    setTab(tabFor(state, id) ?? 'queue')
  }
  const pick = (result: SearchResult) => {
    setSearchOpen(false)
    setSettingsOpen(false)
    setTab(result.tab)
    setSelected(result.kind === 'page' ? null : result.id)
  }
  // A dated line at the end of the topic's note
  const addNote = (id: string, text: string) => {
    const topic = views.find(view => view.topic.id === id)?.topic
    if (!topic) return
    const stamp = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    const head = topic.body.trim() ? `${topic.body.trimEnd()}\n\n` : ''
    void window.flux.updateTopic(id, { body: `${head}**${stamp}** — ${text}\n` })
  }

  return (
    <>
      <div className={`app${boot === 'playing' ? ' booting' : ''}`}>
        <Stage style={style} />
        <div className="veil" aria-hidden="true" />

        <header className="topbar">
          <div className="brand">
            <span className="brand-mark glass">
              <Waves size={16} strokeWidth={2.4} aria-hidden="true" />
            </span>
            <span className="brand-name">Flux</span>
            {state.workspaces.length > 1 && (
              <WorkspaceSwitch
                workspaces={state.workspaces}
                current={switching ?? state.workspace}
                onPick={switchWorkspace}
                onManage={() => {
                  setSettingsView('workspaces')
                  setSettingsOpen(true)
                }}
              />
            )}
          </div>

          <ViewTabs
            tabs={tabs}
            current={tab}
            unread={{ daily: unreadDaily, wrapup: unreadWrapup }}
            onPick={key => {
              setTab(key === 'daily' ? day : key)
              setSelected(null)
              setSettingsOpen(false)
            }}
          />

          <div className="topbar-end">
            {meeting && (
              <span className="chip glass meeting" title={`${meeting.title} ${meeting.when}`}>
                <CalendarClock size={14} aria-hidden="true" />
                <span className="chip-text">{meeting.title}</span>
                <span className="chip-when">{meeting.when}</span>
              </span>
            )}
            {offline.length > 0 && (
              <span className="chip glass warn compact" title={`Hors ligne : ${offlineLabel}`}>
                <CloudOff size={14} aria-hidden="true" />
                <span className="chip-text">Hors ligne</span>
              </span>
            )}
            {toReconnect.length > 0 && (
              <button
                type="button"
                className="chip glass warn compact"
                title={`${failures(toReconnect)}\nOuvrir les réglages`}
                onClick={() => {
                  setSettingsView('main')
                  setSettingsOpen(true)
                }}
              >
                <KeyRound size={14} aria-hidden="true" />
                <span className="chip-text">
                  {toReconnect.length === 1 ? `${SOURCE_LABEL[toReconnect[0]]} à reconnecter` : 'À reconnecter'}
                </span>
              </button>
            )}
            {erring.length > 0 && (
              <span className="chip glass warn compact" title={failures(erring)}>
                <TriangleAlert size={14} aria-hidden="true" />
                <span className="chip-text">En erreur</span>
              </span>
            )}
            {toConnect.length > 0 && (
              <button
                type="button"
                className="chip glass compact"
                title={`Connecter ${connectLabel}`}
                onClick={() => {
                  setSettingsView('main')
                  setSettingsOpen(true)
                }}
              >
                <Plug size={14} aria-hidden="true" />
                <span className="chip-text">Connecter</span>
              </button>
            )}
            <button
              type="button"
              className="round glass"
              aria-label="Rechercher"
              title="Rechercher · ⌘K"
              onClick={() => setSearchOpen(true)}
            >
              <SearchIcon size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="round glass refresh"
              aria-label="Tout actualiser"
              aria-busy={refreshing}
              disabled={refreshing}
              title={
                refreshing
                  ? 'Actualisation…'
                  : `Tout actualiser (⌘R) · synchro de ${clock(state.generatedAt)}`
              }
              onClick={refreshAll}
            >
              <RefreshCw size={17} className={refreshing ? 'spin' : undefined} aria-hidden="true" />
            </button>
            <Changelog />
            <button type="button" className="pill glass" onClick={() => void window.flux.openCapture()}>
              Note
              <Plus size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="round glass"
              aria-label="Réglages"
              title="Réglages"
              onClick={() => {
                setSettingsView('main')
                setSettingsOpen(open => !open)
              }}
            >
              <Settings size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        {tab === 'daily' ? (
          <DailyView daily={state.daily} onOpen={openTopic} onNote={addNote} nav={dayTabs} />
        ) : tab === 'wrapup' ? (
          <WrapupView wrapup={state.wrapup} onOpen={openTopic} nav={dayTabs} />
        ) : tab === 'pulls' ? (
          <PullsView board={pulls} loading={pullsLoading} onRefresh={() => loadPulls(true)} />
        ) : tab === 'claude' ? (
          <ClaudeSpace
            jobs={jobs}
            daily={state.daily}
            part={claudePart}
            onPart={part => {
              setClaudePart(part)
              saveMark(CLAUDE_PART_KEY, part)
            }}
            onOpenDay={setTab}
            onToast={(message, kind) => showToast(message, kind === 'error' ? 'error' : 'ok')}
          />
        ) : (
          <>
            <main className="focus">
              {looseItem ? (
                <LooseHero key={currentId} item={looseItem} />
              ) : current ? (
                <>
                  <Hero key={current.topic.id} view={current} position={position} />
                  <Inspector key={`note-${current.topic.id}`} view={current} />
                </>
              ) : (
                <section className="hero">
                  <h1 className="hero-empty">{emptyTitle(listTab, state.loose.length)}</h1>
                  {listTab === 'queue' && (
                    <div className="hero-actions">
                      <button type="button" className="pill solid" onClick={() => void window.flux.openCapture()}>
                        Écrire une note
                        <Plus size={17} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </section>
              )}
            </main>
            <Rail
              views={list}
              loose={tab === 'waiting' ? state.loose : undefined}
              grouping={tab === 'queue' || tab === 'unstarted' ? 'rank' : tab === 'waiting' ? 'owner' : 'none'}
              selected={currentId}
              isFresh={isFresh}
              onSelect={setSelected}
            />
          </>
        )}

        {searchOpen && <Search state={state} onPick={pick} onClose={() => setSearchOpen(false)} />}

        {settingsOpen && (
          <SettingsPanel
            onClose={() => setSettingsOpen(false)}
            onReplay={() => {
              setSettingsOpen(false)
              setOnboarding(true)
            }}
            onSaved={() => {
              setSettingsOpen(false)
              showToast('Réglages enregistrés')
            }}
            onError={message => showToast(message, 'error')}
            initialView={settingsView}
          />
        )}

        {toast && <Toast key={toast.id} toast={toast} onDone={() => setToast(null)} />}

        <svg className="filters" aria-hidden="true">
          <filter id="lens" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.02" numOctaves="2" seed="7" result="noise" />
            <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
            <feDisplacementMap in="SourceGraphic" in2="soft" scale="26" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
      </div>
      {bootScene}
    </>
  )
}
