import type { ActionKind, Item, Rank, Signal } from '../../shared/types'
import { CONFIG } from '../config'

const BOTS = new Set(CONFIG.github.bots)
const BLOCKED_TITLE = /\[(BLOCKED|DO NOT MERGE)\]/i
const DORMANT_DAYS = 30
const PENDING_QUIET_MINUTES = 30
const DAY_MS = 86_400_000

// Known team keys also match in lowercase branch names; without them, only UPPER-123 keys count
const TEAM_KEYS = CONFIG.linear.teams
const TICKET_PATTERN =
  TEAM_KEYS.length > 0
    ? new RegExp(`\\b(${TEAM_KEYS.join('|')})-(\\d{1,6})\\b`, 'gi')
    : /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g

export interface ReviewThread {
  resolved: boolean
  firstAuthor: string | null
  lastAuthor: string | null
  lastAt: string
}

export interface PullRequest {
  repo: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  updatedAt: string
  mergedAt: string | null
  headRefName: string
  reviewDecision: string | null
  mergeStateStatus: string | null
  author: string
  ci: string | null
  lastCommitAt: string
  viewerReview: { state: string; submittedAt: string | null } | null
  reviewedAt: string | null
  reviewRequested: boolean
  requestedAt: string | null
  pendingReview: { updatedAt: string; createdAt: string; comments: number } | null
  threads: ReviewThread[]
}

export type LinearNotice = {
  id: string
  kind: 'mention' | 'comment'
  author: string
  excerpt: string
  text: string
  at: string
  url: string
  waitingOnMe?: boolean
}

// A comment of mine nobody answered: awaitsReply comes from the triage, absent until it ran
export interface AskedComment {
  id: string
  excerpt: string
  text: string
  at: string
  url: string
  awaitsReply?: boolean
}

export interface Ticket {
  key: string
  title: string
  url: string
  stateName: string
  stateType: string
  assignedToMe: boolean
  updatedAt: string
  labels: string[]
  notices: LinearNotice[]
  asked?: AskedComment
  // Jira: the status is one you are working in, whatever its name
  inProgress?: boolean
  // Linear: split into sub-tickets, which carry the work
  hasSubIssues?: boolean
}

export interface RankContext {
  me: string
  now: Date
  // Repo names (as in app#12) where your PRs need no review
  noReview?: Set<string>
}

export function ticketKeys(text: string): string[] {
  const keys = new Set<string>()
  for (const match of text.matchAll(TICKET_PATTERN)) {
    keys.add(`${match[1].toUpperCase()}-${match[2]}`)
  }
  return [...keys]
}

export function prRef(repo: string, number: number): string {
  return `${repo}#${number}`
}

function ageDays(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / DAY_MS
}

function oldest(dates: string[]): string {
  return dates.reduce((a, b) => (a < b ? a : b))
}

function newest(dates: string[]): string {
  return dates.reduce((a, b) => (a > b ? a : b))
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? 's' : ''}`
}

function isHuman(login: string | null, me: string): login is string {
  return login !== null && login !== me && !BOTS.has(login)
}

// sam-lee reads « sam »; a head too short for a first name keeps the whole login (Le-Polemil)
export function shortLogin(login: string): string {
  const head = login.split('-')[0]
  return head.length >= 3 ? head : login
}

function names(logins: string[]): string {
  return [...new Set(logins.map(shortLogin))].join(', ')
}

function signal(
  ref: string,
  suffix: string,
  rank: Rank,
  detail: string,
  action: ActionKind,
  since: string,
  stamp: string = since,
  weight = 0,
): Signal {
  return { id: `${ref}:${suffix}`, rank, weight, detail, action, since, stamp }
}

function pendingReviewSignal(pr: PullRequest, ref: string, { now }: RankContext): Signal | null {
  const pending = pr.pendingReview
  if (!pending) return null
  const quietMinutes = (now.getTime() - new Date(pending.updatedAt).getTime()) / 60_000
  if (quietMinutes < PENDING_QUIET_MINUTES) return null
  return signal(
    ref,
    'pending-review',
    0,
    `${plural(pending.comments, 'commentaire')} non soumis`,
    'submit-review',
    pending.createdAt,
    pending.updatedAt,
  )
}

function mineSignals(pr: PullRequest, ref: string, { me, noReview }: RankContext): Signal[] {
  const open = pr.threads.filter(thread => !thread.resolved)
  const human = open.filter(thread => isHuman(thread.lastAuthor, me))
  if (human.length > 0) {
    const dates = human.map(thread => thread.lastAt)
    const who = names(human.map(thread => thread.lastAuthor as string))
    return [
      signal(
        ref,
        'review-comments',
        1,
        `${plural(human.length, 'retour')} de ${who}`,
        'take-comments',
        oldest(dates),
        newest(dates),
      ),
    ]
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    return [signal(ref, 'changes', 1, 'Changements demandés', 'take-comments', pr.updatedAt)]
  }
  if (pr.isDraft) return [signal(ref, 'draft', 6, 'Brouillon', 'fix-pr', pr.updatedAt)]
  if (pr.ci === 'FAILURE') return [signal(ref, 'ci', 6, 'CI en échec', 'fix-pr', pr.updatedAt)]

  // Nobody reviews in this repo: once CI is not failing, the PR is yours to merge
  if (noReview?.has(pr.repo.toLowerCase()) && pr.reviewDecision !== 'APPROVED') {
    if (pr.mergeStateStatus === 'DIRTY') {
      return [signal(ref, 'conflict', 6, 'Conflits à résoudre', 'fix-pr', pr.updatedAt)]
    }
    if (pr.mergeStateStatus === 'BEHIND') {
      return [signal(ref, 'behind', 6, 'À rebaser', 'fix-pr', pr.updatedAt)]
    }
    return [signal(ref, 'ready', 4, 'Prêt à merger, sans review', 'ship', pr.updatedAt)]
  }

  if (pr.reviewDecision === 'APPROVED' && pr.ci === 'SUCCESS') {
    if (pr.mergeStateStatus === 'CLEAN') {
      return [signal(ref, 'ready', 4, 'Prêt à merger', 'ship', pr.updatedAt)]
    }
    if (pr.mergeStateStatus === 'DIRTY') {
      return [signal(ref, 'conflict', 6, 'Conflits à résoudre', 'fix-pr', pr.updatedAt)]
    }
    if (pr.mergeStateStatus === 'BEHIND') {
      return [signal(ref, 'behind', 6, 'À rebaser', 'fix-pr', pr.updatedAt)]
    }
    return [signal(ref, 'ready', 4, 'Approuvée, mergeabilité à confirmer', 'ship', pr.updatedAt)]
  }

  const bot = open.filter(thread => thread.lastAuthor !== null && BOTS.has(thread.lastAuthor))
  if (bot.length > 0) {
    return [
      signal(ref, 'bot-comments', 6, `${plural(bot.length, 'retour')} du bot`, 'take-comments', pr.updatedAt),
    ]
  }
  return []
}

// Once I have reviewed, whatever the verdict, the PR waits on the author: replies and pushes do not
// bring it back, only the author asking me again does. A request older than my review is a leftover,
// a team one for instance, not a new ask.
function reviewedSignals(pr: PullRequest, ref: string, reviewedAt: string): Signal[] {
  const requestedAt = pr.requestedAt
  if (!pr.reviewRequested || requestedAt === null || requestedAt <= reviewedAt) return []
  return [
    signal(ref, 're-review', 2, `Review redemandée par ${names([pr.author])}`, 're-review', requestedAt),
  ]
}

function theirSignals(pr: PullRequest, ref: string, ctx: RankContext): Signal[] {
  const { me, now } = ctx
  if (pr.reviewedAt !== null) return reviewedSignals(pr, ref, pr.reviewedAt)

  // Left with a review GitHub dismissed: a push or a reply on my threads asks for a new one
  const stale = ageDays(pr.updatedAt, now) > DORMANT_DAYS
  const replies = pr.threads.filter(
    thread => !thread.resolved && thread.firstAuthor === me && isHuman(thread.lastAuthor, me),
  )
  const review = pr.viewerReview
  const pushed = review !== null && review.submittedAt !== null && pr.lastCommitAt > review.submittedAt

  if (!stale && (replies.length > 0 || pushed)) {
    const dates = replies.map(thread => thread.lastAt)
    if (pushed) dates.push(pr.lastCommitAt)
    const parts: string[] = []
    if (replies.length > 0) {
      parts.push(`${plural(replies.length, 'réponse')} de ${names(replies.map(t => t.lastAuthor as string))}`)
    }
    if (pushed) parts.push('push depuis ta review')
    return [signal(ref, 're-review', 2, parts.join(' · '), 're-review', oldest(dates), newest(dates))]
  }
  if (pr.reviewRequested) {
    const since = pr.requestedAt ?? pr.updatedAt
    return [
      signal(ref, 'review-requested', 2, `Review demandée par ${names([pr.author])}`, 'review', since, since, 1),
    ]
  }
  return []
}

export function itemFromPullRequest(pr: PullRequest, ctx: RankContext): Item {
  const ref = prRef(pr.repo, pr.number)
  const refs = [ref, ...ticketKeys(`${pr.title} ${pr.headRefName}`)]
  const base = {
    ref,
    refs,
    kind: 'pr' as const,
    title: pr.title,
    url: pr.url,
    branch: pr.headRefName,
    mine: pr.author === ctx.me,
  }
  if (pr.state !== 'OPEN') return { ...base, terminal: true, ball: 'others', signals: [] }

  const signals: Signal[] = []
  const pending = pendingReviewSignal(pr, ref, ctx)
  if (pending) signals.push(pending)

  const blocked = BLOCKED_TITLE.test(pr.title)
  const stale = ageDays(pr.updatedAt, ctx.now) > DORMANT_DAYS
  if (!blocked) {
    if (base.mine && !stale) signals.push(...mineSignals(pr, ref, ctx))
    if (!base.mine) signals.push(...theirSignals(pr, ref, ctx))
  }

  const ball = signals.length > 0 ? 'me' : blocked || stale ? 'dormant' : 'others'
  return { ...base, terminal: false, ball, signals }
}

export const CLOSED_STATE_TYPES = new Set(['completed', 'canceled', 'duplicate'])
const QUESTION_STATES = new Set(['To unblock', 'To frame', 'Technical review'])
const OWN_STATES = new Set(['Todo Today', 'In Progress', 'Personal Review'])
const BUG_LABELS = /sentry|bug/i

export function itemFromTicket(ticket: Ticket, ctx: RankContext): Item {
  const ref = ticket.key
  const base = {
    ref,
    refs: [ref],
    kind: 'ticket' as const,
    title: ticket.title,
    url: ticket.url,
    ...(ticket.stateName ? { state: ticket.stateName } : {}),
    mine: ticket.assignedToMe,
  }
  if (CLOSED_STATE_TYPES.has(ticket.stateType)) {
    return { ...base, terminal: true, ball: 'others', signals: [] }
  }

  const signals: Signal[] = []
  for (const notice of ticket.notices) {
    if (notice.waitingOnMe === false) continue
    const who = notice.author.split(/[.\s-]/)[0]
    const suffix = notice.kind === 'mention' ? 'mention' : 'comment'
    signals.push(signal(ref, `${suffix}:${notice.id}`, 3, `${who} : ${notice.excerpt}`, 'question', notice.at))
  }

  // A parent ticket follows its sub-tickets: its own state asks nothing of me
  if (ticket.assignedToMe && !ticket.hasSubIssues) {
    if (QUESTION_STATES.has(ticket.stateName)) {
      const action = ticket.stateName === 'To frame' ? 'cadrage' : 'question'
      signals.push(signal(ref, 'state-question', 3, ticket.stateName, action, ticket.updatedAt))
    } else if (/^ready to (deploy|mep)$/i.test(ticket.stateName)) {
      signals.push(signal(ref, 'state-ready', 4, 'Prêt à déployer', 'ship', ticket.updatedAt))
    } else if (OWN_STATES.has(ticket.stateName) || ticket.inProgress) {
      const action = ticket.labels.some(label => BUG_LABELS.test(label)) ? 'diagnostic' : 'ticket'
      signals.push(signal(ref, 'state-own', 6, ticket.stateName, action, ticket.updatedAt))
    } else if (ticket.stateType === 'unstarted') {
      // Assigned and not started yet: still mine, after what is already under way
      const action = ticket.labels.some(label => BUG_LABELS.test(label)) ? 'diagnostic' : 'ticket'
      signals.push(signal(ref, 'state-todo', 6, ticket.stateName, action, ticket.updatedAt, ticket.updatedAt, 1))
    }
  }

  // A backlog is parked work, neither waiting on anyone nor to pick up, and so is a parent ticket:
  // only a request brings it back, mine to someone else included
  const asked = ticket.asked && ticket.asked.awaitsReply !== false ? ticket.asked : undefined
  const parked = ticket.stateType === 'backlog' || ticket.hasSubIssues === true
  const stale = ageDays(ticket.updatedAt, ctx.now) > DORMANT_DAYS
  const ball = signals.length > 0 ? 'me' : asked ? 'others' : parked ? 'parked' : stale ? 'dormant' : 'others'
  const line = asked ? { asked: { excerpt: asked.excerpt, at: asked.at, url: asked.url } } : {}
  return { ...base, terminal: false, ball, signals, ...line }
}
