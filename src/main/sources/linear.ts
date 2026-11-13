import type { CompletedTicket } from '../engine/daily'
import { CLOSED_STATE_TYPES, type AskedComment, type LinearNotice, type Ticket } from '../engine/rank'

const ENDPOINT = 'https://api.linear.app/graphql'
const MENTION_TYPES = new Set(['issueCommentMention', 'issueMention'])
const COMMENT_TYPES = new Set(['issueNewComment'])
const AUTOMATED_BODY = /^\s*🗄️?\s*Archived in Sentry/u
const EXCERPT_LENGTH = 110
const TRIAGE_TEXT_LENGTH = 1_500
// My comments older than this no longer wait on anyone
const ASKED_WINDOW = '-P14D'
const ASKED_COUNT = 50

const ISSUE_FIELDS = `
  identifier title url updatedAt
  state { name type }
  assignee { isMe }
  labels { nodes { name } }
  children(first: 1) { nodes { id } }
`

interface RawIssue {
  identifier: string
  title: string
  url: string
  updatedAt: string
  state: { name: string; type: string }
  assignee: { isMe: boolean } | null
  labels: { nodes: Array<{ name: string }> }
  children?: { nodes: Array<{ id: string }> }
}

interface RawComment {
  id: string
  body: string
  url: string
  createdAt: string
}

export interface RawNotification {
  id: string
  type: string
  readAt: string | null
  snoozedUntilAt: string | null
  archivedAt: string | null
  createdAt: string
  url?: string
  subtitle?: string
  actor?: { displayName: string; name: string } | null
  botActor?: { name: string | null } | null
  issue?: RawIssue | null
  comment?: RawComment | null
}

function ticketFromIssue(issue: RawIssue): Ticket {
  return {
    key: issue.identifier,
    title: issue.title,
    url: issue.url,
    stateName: issue.state.name,
    stateType: issue.state.type,
    assignedToMe: issue.assignee?.isMe ?? false,
    updatedAt: issue.updatedAt,
    labels: issue.labels.nodes.map(label => label.name),
    notices: [],
    hasSubIssues: (issue.children?.nodes.length ?? 0) > 0,
  }
}

function excerpt(text: string): string {
  const flat = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat
}

export function noticeFromNotification(raw: RawNotification, now: Date): LinearNotice | null {
  if (raw.readAt || raw.archivedAt) return null
  if (raw.snoozedUntilAt && new Date(raw.snoozedUntilAt) > now) return null
  const issue = raw.issue
  if (!issue || CLOSED_STATE_TYPES.has(issue.state.type)) return null
  const mention = MENTION_TYPES.has(raw.type)
  if (!mention && !COMMENT_TYPES.has(raw.type)) return null
  if (raw.botActor || !raw.actor) return null
  if (!mention && !issue.assignee?.isMe) return null
  const body = raw.comment?.body ?? raw.subtitle ?? ''
  if (AUTOMATED_BODY.test(body)) return null
  return {
    id: raw.comment?.id ?? raw.id,
    kind: mention ? 'mention' : 'comment',
    author: raw.actor.displayName || raw.actor.name,
    excerpt: excerpt(body),
    text: body.slice(0, TRIAGE_TEXT_LENGTH),
    at: raw.comment?.createdAt ?? raw.createdAt,
    url: raw.comment?.url ?? raw.url ?? issue.url,
  }
}

export interface RawOwnComment {
  id: string
  body: string
  url: string
  createdAt: string
  resolvedAt: string | null
  parent: { resolvedAt: string | null } | null
  issue:
    | (RawIssue & { comments: { nodes: Array<{ createdAt: string; user: { isMe: boolean } | null }> } })
    | null
}

// My latest comment per open ticket, when no one else wrote on the ticket since and its thread is open
export function askedComments(comments: RawOwnComment[]): Array<{ issue: RawIssue; asked: AskedComment }> {
  const latest = new Map<string, RawOwnComment>()
  for (const comment of comments) {
    const key = comment.issue?.identifier
    const previous = key ? latest.get(key) : undefined
    if (key && (!previous || previous.createdAt < comment.createdAt)) latest.set(key, comment)
  }
  return [...latest.values()].flatMap(comment => {
    const issue = comment.issue
    if (!issue || CLOSED_STATE_TYPES.has(issue.state.type)) return []
    if (comment.resolvedAt || comment.parent?.resolvedAt || AUTOMATED_BODY.test(comment.body)) return []
    const answered = issue.comments.nodes.some(
      other => other.user !== null && !other.user.isMe && other.createdAt > comment.createdAt,
    )
    if (answered) return []
    const asked: AskedComment = {
      id: comment.id,
      excerpt: excerpt(comment.body),
      text: comment.body.slice(0, TRIAGE_TEXT_LENGTH),
      at: comment.createdAt,
      url: comment.url,
    }
    return [{ issue, asked }]
  })
}

export function mergeTickets(
  assigned: RawIssue[],
  linked: RawIssue[],
  notifications: RawNotification[],
  now: Date,
  own: RawOwnComment[] = [],
): Ticket[] {
  const tickets = new Map<string, Ticket>()
  for (const issue of [...assigned, ...linked]) {
    tickets.set(issue.identifier, ticketFromIssue(issue))
  }
  for (const notification of notifications) {
    const notice = noticeFromNotification(notification, now)
    const issue = notification.issue
    if (!notice || !issue) continue
    const ticket = tickets.get(issue.identifier) ?? ticketFromIssue(issue)
    if (!ticket.notices.some(existing => existing.id === notice.id)) ticket.notices.push(notice)
    tickets.set(issue.identifier, ticket)
  }
  for (const { issue, asked } of askedComments(own)) {
    const ticket = tickets.get(issue.identifier) ?? ticketFromIssue(issue)
    tickets.set(issue.identifier, { ...ticket, asked })
  }
  return [...tickets.values()]
}

export function linkedFilter(keys: string[]): unknown {
  const identifiers = keys.filter(key => /^[A-Z]+-\d+$/.test(key))
  return identifiers.length > 0 ? { id: { in: identifiers } } : null
}

async function linearQuery<T>(apiKey: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Linear ${response.status}`)
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (!payload.data) throw new Error(payload.errors?.[0]?.message ?? 'Réponse Linear vide')
  return payload.data
}

export async function fetchLinear(apiKey: string, keys: string[]): Promise<Ticket[]> {
  const filter = linkedFilter(keys)
  const query = `query($filter: IssueFilter, $withLinked: Boolean!) {
    viewer {
      assignedIssues(first: 100, filter: { state: { type: { nin: ${JSON.stringify([...CLOSED_STATE_TYPES])} } } }) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
    linked: issues(first: 100, filter: $filter) @include(if: $withLinked) {
      nodes { ${ISSUE_FIELDS} }
    }
    notifications(first: 100) {
      nodes {
        id type readAt snoozedUntilAt archivedAt createdAt
        ... on IssueNotification {
          url subtitle
          actor { displayName name }
          botActor { name }
          issue { ${ISSUE_FIELDS} }
          comment { id body url createdAt }
        }
      }
    }
  }`
  const [data, own] = await Promise.all([
    linearQuery<{
      viewer: { assignedIssues: { nodes: RawIssue[] } }
      linked?: { nodes: RawIssue[] }
      notifications: { nodes: RawNotification[] }
    }>(apiKey, query, { filter, withLinked: filter !== null }),
    fetchOwnComments(apiKey),
  ])
  const requested = new Set(keys)
  return mergeTickets(
    data.viewer.assignedIssues.nodes,
    (data.linked?.nodes ?? []).filter(issue => requested.has(issue.identifier)),
    data.notifications.nodes,
    new Date(),
    own,
  )
}

// Apart from the main query: the tickets still load when this one fails
async function fetchOwnComments(apiKey: string): Promise<RawOwnComment[]> {
  try {
    const data = await linearQuery<{ comments: { nodes: RawOwnComment[] } }>(
      apiKey,
      `query($since: DateTimeOrDuration!) {
        comments(first: ${ASKED_COUNT}, filter: { user: { isMe: { eq: true } }, createdAt: { gte: $since } }) {
          nodes {
            id body url createdAt resolvedAt
            parent { resolvedAt }
            issue {
              ${ISSUE_FIELDS}
              comments(first: 50, filter: { createdAt: { gte: $since } }) { nodes { createdAt user { isMe } } }
            }
          }
        }
      }`,
      { since: ASKED_WINDOW },
    )
    return data.comments.nodes
  } catch (error) {
    console.error('Commentaires Linear indisponibles', error)
    return []
  }
}

// My tickets completed since a date, for a daily Flux kept no journal of
export async function fetchCompleted(apiKey: string, since: string): Promise<CompletedTicket[]> {
  const data = await linearQuery<{
    viewer: { assignedIssues: { nodes: Array<{ identifier: string; title: string; url: string; completedAt: string | null }> } }
  }>(
    apiKey,
    `query($since: DateTimeOrDuration!) {
      viewer {
        assignedIssues(first: 50, filter: { completedAt: { gte: $since } }) {
          nodes { identifier title url completedAt }
        }
      }
    }`,
    { since },
  )
  return data.viewer.assignedIssues.nodes.flatMap(issue =>
    issue.completedAt
      ? [{ key: issue.identifier, title: issue.title, url: issue.url, completedAt: issue.completedAt }]
      : [],
  )
}

// Teams you belong to, for picking the ones you work on
export async function listLinearTeams(apiKey: string): Promise<Array<{ key: string; name: string }>> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'query { teams(first: 100) { nodes { key name } } }' }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`Linear ${response.status}`)
  const payload = (await response.json()) as {
    data?: { teams: { nodes: Array<{ key: string; name: string }> } }
    errors?: Array<{ message: string }>
  }
  if (!payload.data) throw new Error(payload.errors?.[0]?.message ?? 'Réponse Linear vide')
  return payload.data.teams.nodes
}
