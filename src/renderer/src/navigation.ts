import { fluxLink, type FluxRoute, type LinkMenu } from '../../shared/links'
import type { AppState, Item, Rank, RefPill, TopicView } from '../../shared/types'
import { displayTitle } from './format'

export type ListTab = 'queue' | 'unstarted' | 'active' | 'waiting'
export type SheetTab = 'pulls' | 'jobs' | 'wrapup' | 'daily'
export type Tab = ListTab | SheetTab

export const TAB_LABEL: Record<Tab, string> = {
  queue: 'File',
  unstarted: 'À démarrer',
  active: 'En cours',
  waiting: 'Attente',
  pulls: 'Mes PR',
  jobs: 'Planifiés',
  wrapup: 'Wrap-up',
  daily: 'Daily',
}

// The order a topic's home tab is looked for: À démarrer only lists part of the file
const LIST_TABS: ListTab[] = ['queue', 'active', 'waiting', 'unstarted']
const SEARCH_TABS: ListTab[] = ['queue', 'active', 'waiting']

export const looseId = (item: Item) => `loose:${item.ref}`

export function allViews(state: AppState): TopicView[] {
  return [...state.queue, ...state.active, ...state.waiting, ...state.dormant]
}

// À démarrer is the file without what I already took up: started, it is En cours; blocked or with a
// reviewer, it waits. Waiting puts my own work before the work of others; dormant topics close each half
export function listOf(state: AppState, tab: ListTab): TopicView[] {
  if (tab === 'unstarted') return state.queue.filter(view => view.stage === 'untouched')
  if (tab !== 'waiting') return state[tab]
  const views = [...state.queue.filter(view => view.stage === 'held'), ...state.waiting, ...state.dormant]
  return [...views.filter(view => view.mine), ...views.filter(view => !view.mine)]
}

// A topic sits in several lists, En cours above all: the tab you are on keeps it when it lists it
export function tabFor(state: AppState, id: string, current?: Tab): ListTab | null {
  if (state.loose.some(item => looseId(item) === id)) return 'waiting'
  const holds = (tab: ListTab) => listOf(state, tab).some(view => view.topic.id === id)
  const here = LIST_TABS.find(tab => tab === current)
  if (here && holds(here)) return here
  return LIST_TABS.find(holds) ?? null
}

const sameRef = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

// Where a flux:// link lands: a tab, and the topic or waiting item to select in it
export function resolveRoute(
  state: AppState,
  route: FluxRoute,
): { tab: Tab; selected: string | null } | null {
  if (route.kind === 'tab') return { tab: route.tab, selected: null }
  const views = allViews(state)
  const view =
    route.kind === 'topic'
      ? views.find(candidate => candidate.topic.id === route.id)
      : views.find(candidate => candidate.topic.links.some(link => sameRef(link, route.ref)))
  if (view) {
    const tab = tabFor(state, view.topic.id)
    return tab ? { tab, selected: view.topic.id } : null
  }
  if (route.kind === 'topic') return null
  const item = state.loose.find(candidate => candidate.refs.some(ref => sameRef(ref, route.ref)))
  return item ? { tab: 'waiting', selected: looseId(item) } : null
}

// A topic links by its first ref, readable and kept when the topic is made anew; a note by its id
export function routeOfView(view: TopicView): FluxRoute {
  const ref = view.topic.links[0]
  return ref ? { kind: 'ref', ref } : { kind: 'topic', id: view.topic.id }
}

export function menuOfView(view: TopicView): LinkMenu {
  return {
    sources: view.items.map(item => ({ ref: item.ref, url: item.url })),
    flux: fluxLink(routeOfView(view)),
  }
}

export function menuOfItem(item: Item): LinkMenu {
  return { sources: [{ ref: item.ref, url: item.url }], flux: fluxLink({ kind: 'ref', ref: item.ref }) }
}

// A daily or wrap-up line: its refs, and Flux only while the topic is still open
export function menuOfLine(line: {
  live: boolean
  topicId: string | null
  refs?: RefPill[]
  ref?: string | null
  url: string | null
}): LinkMenu {
  const pills = line.refs ?? (line.ref ? [{ ref: line.ref, url: line.url }] : [])
  const sources: LinkMenu['sources'] = pills.flatMap(pill => (pill.url ? [{ ref: pill.ref, url: pill.url }] : []))
  if (sources.length === 0 && line.url) sources.push({ ref: line.ref ?? null, url: line.url })
  const first = pills[0]?.ref
  const flux =
    line.live && line.topicId
      ? fluxLink(first ? { kind: 'ref', ref: first } : { kind: 'topic', id: line.topicId })
      : null
  return { sources, flux }
}

export function showMenu(event: { preventDefault(): void }, menu: LinkMenu): void {
  event.preventDefault()
  void window.flux.showLinkMenu(menu)
}

export interface SearchResult {
  id: string
  kind: 'topic' | 'loose' | 'page'
  ref: string | null
  title: string
  detail: string | null
  url: string | null
  tab: Tab
  rank: Rank | null
  menu: LinkMenu | null
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

interface Candidate {
  result: SearchResult
  refs: string[]
  main: string
  extra: string
}

function candidates(state: AppState): Candidate[] {
  const list: Candidate[] = []
  // A topic in progress is also in the file or in waiting: it shows once, under its first tab
  const seen = new Set<string>()
  for (const tab of SEARCH_TABS) {
    for (const view of listOf(state, tab)) {
      if (seen.has(view.topic.id)) continue
      seen.add(view.topic.id)
      const lead = view.signals[0]?.detail ?? view.topic.blocked ?? view.items.find(item => item.asked)?.asked?.excerpt
      list.push({
        result: {
          id: view.topic.id,
          kind: 'topic',
          ref: view.topic.links[0] ?? null,
          title: displayTitle(view.topic.title),
          detail: lead ?? null,
          url: view.items[0]?.url ?? null,
          tab,
          rank: view.rank,
          menu: menuOfView(view),
        },
        refs: view.topic.links,
        main: [view.topic.title, ...view.topic.links, lead ?? ''].join(' '),
        extra: view.topic.body,
      })
    }
    if (tab === 'waiting') {
      for (const item of state.loose) {
        list.push({
          result: {
            id: looseId(item),
            kind: 'loose',
            ref: item.ref,
            title: displayTitle(item.title),
            detail: item.asked?.excerpt ?? null,
            url: item.url,
            tab,
            rank: null,
            menu: menuOfItem(item),
          },
          refs: item.refs,
          main: [item.title, ...item.refs, item.asked?.excerpt ?? ''].join(' '),
          extra: '',
        })
      }
    }
  }
  return list
}

const PAGES = (Object.keys(TAB_LABEL) as Tab[]).map(tab => ({ tab, label: TAB_LABEL[tab] }))

// Every word of the query must appear; a ref, then a title that starts with the query come first
export function searchFlux(state: AppState, query: string, limit = 40): SearchResult[] {
  const folded = fold(query.trim())
  const all = candidates(state)
  if (!folded) return all.slice(0, limit).map(candidate => candidate.result)
  const words = folded.split(/\s+/)
  const compact = folded.replace(/\s+/g, '')
  const scored = all.flatMap((candidate, order) => {
    const main = fold(candidate.main)
    const everything = `${main} ${fold(candidate.extra)}`
    if (!words.every(word => everything.includes(word))) return []
    const title = fold(candidate.result.title)
    const score = candidate.refs.some(ref => fold(ref).startsWith(compact))
      ? 0
      : title.startsWith(folded)
        ? 1
        : words.every(word => title.split(/[^a-z0-9#-]+/).some(part => part.startsWith(word)))
          ? 2
          : words.every(word => main.includes(word))
            ? 3
            : 4
    return [{ result: candidate.result, score, order }]
  })
  scored.sort((a, b) => a.score - b.score || a.order - b.order)
  const pages = PAGES.filter(page => fold(page.label).startsWith(folded)).map(page => ({
    id: `page:${page.tab}`,
    kind: 'page' as const,
    ref: null,
    title: page.label,
    detail: null,
    url: null,
    tab: page.tab,
    rank: null,
    menu: { sources: [], flux: fluxLink({ kind: 'tab', tab: page.tab }) },
  }))
  return [...pages, ...scored.map(entry => entry.result)].slice(0, limit)
}
