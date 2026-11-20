// flux:// links open Flux on a topic or a page, from anywhere a link can be clicked

export const FLUX_SCHEME = 'flux'

export type RouteTab = 'queue' | 'unstarted' | 'active' | 'waiting' | 'pulls' | 'claude' | 'wrapup' | 'daily'

export type FluxRoute =
  | { kind: 'topic'; id: string }
  | { kind: 'ref'; ref: string }
  | { kind: 'tab'; tab: RouteTab }

// The tab as the link spells it: the label the user reads, without accents or spaces
const TAB_SLUG: Record<RouteTab, string> = {
  queue: 'file',
  unstarted: 'a-demarrer',
  active: 'en-cours',
  waiting: 'attente',
  pulls: 'mes-pr',
  claude: 'claude',
  wrapup: 'wrap-up',
  daily: 'daily',
}

const SLUG_TAB = new Map<string, RouteTab>(
  (Object.entries(TAB_SLUG) as Array<[RouteTab, string]>).flatMap(([tab, slug]) => [
    [slug, tab],
    [tab, tab],
  ]),
)

export function fluxLink(route: FluxRoute): string {
  if (route.kind === 'tab') return `${FLUX_SCHEME}://${TAB_SLUG[route.tab]}`
  const value = route.kind === 'topic' ? route.id : route.ref
  return `${FLUX_SCHEME}://${route.kind}/${encodeURIComponent(value)}`
}

export function parseFluxLink(link: string): FluxRoute | null {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return null
  }
  if (url.protocol !== `${FLUX_SCHEME}:`) return null
  const name = url.hostname.toLowerCase()
  const value = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''))
  if ((name === 'topic' || name === 'ref') && value) {
    return name === 'topic' ? { kind: 'topic', id: value } : { kind: 'ref', ref: value }
  }
  const tab = SLUG_TAB.get(name)
  return tab && !value ? { kind: 'tab', tab } : null
}

const SOURCES: Array<[string, (host: string) => boolean]> = [
  ['GitHub', host => host === 'github.com' || host.endsWith('.ghe.com') || host.startsWith('github.')],
  ['Linear', host => host === 'linear.app'],
  ['Slack', host => host === 'slack.com' || host.endsWith('.slack.com')],
  ['Jira', host => host.endsWith('.atlassian.net') || host.startsWith('jira.')],
  ['Sentry', host => host === 'sentry.io' || host.endsWith('.sentry.io')],
  ['Datadog', host => host.endsWith('datadoghq.com') || host.endsWith('datadoghq.eu')],
  ['Notion', host => host.endsWith('notion.so') || host.endsWith('notion.site')],
  ['Figma', host => host.endsWith('figma.com')],
  ['App Store', host => host === 'apps.apple.com'],
  ['Google Play', host => host === 'play.google.com'],
]

// The tool a link belongs to, as a menu names it; an unknown site goes by its host
export function sourceName(link: string): string | null {
  try {
    const url = new URL(link)
    if (!/^https?:$/.test(url.protocol)) return null
    const host = url.hostname.toLowerCase()
    return SOURCES.find(([, matches]) => matches(host))?.[0] ?? host.replace(/^www\./, '')
  } catch {
    return null
  }
}

// What a right click offers: each source of the line, then the line in Flux
export interface LinkMenu {
  sources: Array<{ ref: string | null; url: string }>
  flux: string | null
}

export interface LinkMenuEntry {
  label: string
  copy: string
}

export function linkMenuEntries(menu: LinkMenu): LinkMenuEntry[] {
  const sources = menu.sources.flatMap(source => {
    const name = sourceName(source.url)
    return name ? [{ ...source, name }] : []
  })
  // The ref tells two links of the same tool apart
  const many = (name: string) => sources.filter(source => source.name === name).length > 1
  const entries = sources.map(source => ({
    label: `Copier le lien ${source.name}${source.ref && many(source.name) ? ` · ${source.ref}` : ''}`,
    copy: source.url,
  }))
  const flux = menu.flux && parseFluxLink(menu.flux) ? [{ label: 'Copier le lien dans Flux', copy: menu.flux }] : []
  const seen = new Set<string>()
  return [...entries, ...flux].filter(entry => !seen.has(entry.copy) && seen.add(entry.copy))
}
