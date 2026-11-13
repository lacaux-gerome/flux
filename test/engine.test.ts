import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizePullRequest, type RawPullRequest } from '../src/main/sources/github'
import {
  itemFromPullRequest,
  itemFromTicket,
  ticketKeys,
  type PullRequest,
  type Ticket,
} from '../src/main/engine/rank'
import { compareViews, reconcile } from '../src/main/engine/ball'
import { decide, EMPTY_NOTIFY_STATE, type NotifyContext } from '../src/main/engine/notify'
import type { Item, Topic, TopicView } from '../src/shared/types'
import { noteFromText, parseTopic, serializeTopic } from '../src/main/store/topics'

const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures/prs.json'), 'utf8')) as {
  data: { search: { nodes: RawPullRequest[] } }
}
const NOW = new Date('2026-11-06T12:40:00+01:00')
const ME = 'alex'
const context = { me: ME, now: NOW }
const prs = raw.data.search.nodes.map(node => normalizePullRequest(node, ME))
const items = prs.map(pr => itemFromPullRequest(pr, context))
const byRef = new Map(items.map(item => [item.ref, item]))
const rankOf = (ref: string) => byRef.get(ref)?.signals[0]?.rank

function pr(overrides: Partial<PullRequest>): PullRequest {
  return {
    repo: 'mobile',
    number: 1,
    title: 'Sujet',
    url: 'https://example.test/1',
    state: 'OPEN',
    isDraft: false,
    updatedAt: '2026-11-06T09:00:00Z',
    mergedAt: null,
    headRefName: 'feature/app-1',
    reviewDecision: 'REVIEW_REQUIRED',
    mergeStateStatus: 'CLEAN',
    author: ME,
    ci: 'SUCCESS',
    lastCommitAt: '2026-11-06T08:00:00Z',
    viewerReview: null,
    reviewedAt: null,
    reviewRequested: false,
    requestedAt: null,
    pendingReview: null,
    threads: [],
    ...overrides,
  }
}

describe('file sur les données réelles du 06/11', () => {
  it('met la review oubliée au rang 0, même sur une PR bloquée', () => {
    expect(rankOf('family#221')).toBe(0)
    expect(byRef.get('family#221')?.signals[0].detail).toContain('2 commentaires non soumis')
  })

  it('compte les retours humains au rang 1', () => {
    expect(rankOf('mobile#1592')).toBe(1)
    expect(rankOf('mobile#1596')).toBe(1)
    expect(rankOf('mobile#1595')).toBe(1)
    expect(rankOf('mobile#1516')).toBe(1)
    expect(byRef.get('mobile#1592')?.signals[0].detail).toBe('2 retours de sam')
  })

  it("ne prend pas un retour de bot pour un humain", () => {
    expect(rankOf('mobile#1591')).toBe(4)
    expect(byRef.get('api#14297')?.signals.some(signal => signal.rank === 1)).toBe(false)
  })

  it('range en attente les PR que j’ai déjà reviewées, malgré les réponses de l’auteur', () => {
    // web#6967 is hb#6967: commented on 05/11, then four replies from its author on my threads
    for (const ref of ['web#6966', 'web#6967']) {
      expect(byRef.get(ref)?.signals).toEqual([])
      expect(byRef.get(ref)?.ball).toBe('others')
    }
  })

  it('garde en review une PR que je n’ai pas encore reviewée', () => {
    expect(byRef.get('web#6983')?.signals[0]).toMatchObject({ rank: 2, action: 'review' })
  })

  it('garde une demande de review explicite même ancienne', () => {
    expect(rankOf('mobile#1553')).toBe(2)
  })

  it('range les zombies en dormant', () => {
    for (const ref of ['mobile#1224', 'mobile#1332', 'mobile#1444', 'admin#1028', 'mobile#1230']) {
      expect(byRef.get(ref)?.ball).toBe('dormant')
    }
    expect(byRef.get('family#220')?.ball).toBe('dormant')
  })

  it("laisse aux autres ce qui ne m'attend pas", () => {
    expect(byRef.get('web#6961')?.ball).toBe('others')
  })
})

describe('règles unitaires', () => {
  it('rend à moi une PR sans review nécessaire, prête à merger', () => {
    const mine = pr({ author: ME, repo: 'app', reviewDecision: null, ci: 'SUCCESS', mergeStateStatus: 'BLOCKED' })
    const item = itemFromPullRequest(mine, { ...context, noReview: new Set(['app']) })
    expect(item.ball).toBe('me')
    expect(item.signals[0]).toMatchObject({ rank: 4, action: 'ship' })
    expect(itemFromPullRequest(mine, context).ball).toBe('others')
  })

  it('garde un brouillon en brouillon, même sans review', () => {
    const draft = pr({ author: ME, repo: 'app', isDraft: true })
    const item = itemFromPullRequest(draft, { ...context, noReview: new Set(['app']) })
    expect(item.signals[0]).toMatchObject({ rank: 6, detail: 'Brouillon' })
  })

  it('garde dans mes sujets ma PR ouverte sans ticket, jusqu’à son merge', () => {
    const e2e = { title: 'ci(e2e): réutiliser le build', headRefName: 'ci/e2e-build-cache' }
    const item = itemFromPullRequest(pr(e2e), context)
    expect(item).toMatchObject({ ball: 'me', refs: ['mobile#1'] })
    expect(item.signals).toEqual([expect.objectContaining({ rank: 6, detail: 'PR ouverte', action: 'fix-pr' })])
    const created = reconcile([], [item], [], NOW).created
    expect(created.map(topic => topic.links)).toEqual([['mobile#1']])

    // Something to do on it takes over, a ticket keeps its own place, and only my PRs count
    expect(itemFromPullRequest(pr({ ...e2e, ci: 'FAILURE' }), context).signals.map(s => s.detail)).toEqual(['CI en échec'])
    expect(itemFromPullRequest(pr({ ...e2e, headRefName: 'feature/app-12-e2e' }), context).ball).toBe('others')
    expect(itemFromPullRequest(pr({ ...e2e, author: 'sam' }), context).signals).toEqual([])
    // Left aside for long, it goes to the wrap-up like any other
    expect(itemFromPullRequest(pr({ ...e2e, updatedAt: '2026-10-01T09:00:00Z' }), context).ball).toBe('dormant')
    expect(itemFromPullRequest(pr({ ...e2e, state: 'MERGED' }), context).terminal).toBe(true)
  })

  it("n'alerte pas sur une review en cours de rédaction", () => {
    const item = itemFromPullRequest(
      pr({
        author: 'sam-lee',
        pendingReview: {
          createdAt: '2026-11-06T11:00:00Z',
          updatedAt: '2026-11-06T11:30:00Z',
          comments: 1,
        },
      }),
      context,
    )
    expect(item.signals).toEqual([])
  })

  it('demande confirmation quand GitHub ne sait pas encore si la PR est mergeable', () => {
    const item = itemFromPullRequest(
      pr({ reviewDecision: 'APPROVED', mergeStateStatus: 'UNKNOWN' }),
      context,
    )
    expect(item.signals[0]).toMatchObject({ rank: 4, detail: 'Approuvée, mergeabilité à confirmer' })
  })

  it('extrait les clefs de ticket du titre et de la branche', () => {
    expect(ticketKeys('fix (SYN-255, ops-125) UTF-8 feature/app-978')).toEqual([
      'SYN-255',
      'OPS-125',
      'APP-978',
    ])
  })
})

describe('PR que j’ai déjà reviewée', () => {
  const REVIEWED_AT = '2026-11-05T10:00:00Z'
  const reviewed = (state: string, overrides: Partial<PullRequest> = {}) =>
    itemFromPullRequest(
      pr({
        author: 'sam-lee',
        viewerReview: { state, submittedAt: REVIEWED_AT },
        reviewedAt: REVIEWED_AT,
        ...overrides,
      }),
      context,
    )
  const reply = { resolved: false, firstAuthor: ME, lastAuthor: 'sam-lee', lastAt: '2026-11-05T11:00:00Z' }

  it.each(['COMMENTED', 'CHANGES_REQUESTED', 'APPROVED'])(
    'passe en attente après une review %s, malgré les réponses et les pushes',
    state => {
      const item = reviewed(state, { threads: [reply], lastCommitAt: '2026-11-06T08:00:00Z' })
      expect(item.signals).toEqual([])
      expect(item.ball).toBe('others')
    },
  )

  it("revient quand l'auteur redemande ma review", () => {
    const item = reviewed('COMMENTED', {
      threads: [reply],
      reviewRequested: true,
      requestedAt: '2026-11-06T09:30:00Z',
    })
    expect(item.signals).toHaveLength(1)
    expect(item.signals[0]).toMatchObject({
      rank: 2,
      action: 're-review',
      detail: 'Review redemandée par sam',
      since: '2026-11-06T09:30:00Z',
    })
  })

  it('passe une review redemandée avant une première demande', () => {
    const again = reviewed('APPROVED', { reviewRequested: true, requestedAt: '2026-11-06T09:30:00Z' })
    const first = itemFromPullRequest(
      pr({ author: 'sam-lee', reviewRequested: true, requestedAt: '2026-11-06T09:30:00Z' }),
      context,
    )
    expect(first.signals[0].action).toBe('review')
    expect(again.signals[0].weight).toBeLessThan(first.signals[0].weight)
  })

  it('ignore une demande qui précède ma review', () => {
    const old = { reviewRequested: true, requestedAt: '2026-11-04T09:00:00Z' }
    expect(reviewed('COMMENTED', old).signals).toEqual([])
    expect(reviewed('APPROVED', { reviewRequested: true, requestedAt: null }).signals).toEqual([])
  })

  it('garde un commentaire non soumis à soumettre', () => {
    const item = reviewed('APPROVED', {
      pendingReview: { createdAt: '2026-11-06T08:00:00Z', updatedAt: '2026-11-06T09:00:00Z', comments: 1 },
    })
    expect(item.signals.map(signal => signal.rank)).toEqual([0])
  })

  it('repasse en review quand GitHub rejette mon approbation au push', () => {
    const item = itemFromPullRequest(
      pr({
        author: 'sam-lee',
        viewerReview: { state: 'DISMISSED', submittedAt: REVIEWED_AT },
        lastCommitAt: '2026-11-06T08:00:00Z',
      }),
      context,
    )
    expect(item.signals[0]).toMatchObject({ rank: 2, detail: 'push depuis ta review' })
  })

  it('lit ma review dans les données réelles', () => {
    const reviewedOf = (number: number) => prs.find(entry => entry.number === number)?.reviewedAt
    expect(reviewedOf(1568)).toBe('2026-11-06T09:53:44Z')
    expect(reviewedOf(6967)).toBe('2026-11-05T14:57:17Z')
    expect(reviewedOf(6983)).toBeNull()
  })

  it("ramène hb#6967 dans la file quand l'auteur redemande ma review", () => {
    const node = raw.data.search.nodes.find(entry => entry.number === 6967)
    if (!node) throw new Error('web#6967 absent des fixtures')
    const request = { createdAt: '2026-11-06T09:00:00Z', requestedReviewer: { login: ME } }
    const again = normalizePullRequest(
      {
        ...node,
        viewerLatestReviewRequest: { id: 'RR_again' },
        timelineItems: { nodes: [...node.timelineItems.nodes, request] },
      },
      ME,
    )
    expect(itemFromPullRequest(again, context).signals).toEqual([
      expect.objectContaining({ rank: 2, action: 're-review', since: '2026-11-06T09:00:00Z' }),
    ])
  })
})

describe('review lue depuis GitHub', () => {
  const node = raw.data.search.nodes[0]
  const reviewedAtOf = (overrides: Partial<RawPullRequest>) =>
    normalizePullRequest({ ...node, ...overrides }, ME).reviewedAt
  const latest = (state: string) => ({ state, submittedAt: '2026-11-06T10:00:00Z' })
  const opinion = (login: string, state: string) => ({
    nodes: [{ author: { login }, state, submittedAt: '2026-11-05T10:00:00Z' }],
  })
  const none = { nodes: [] }

  it('compte un simple commentaire comme une review', () => {
    expect(
      reviewedAtOf({ viewerLatestReview: latest('COMMENTED'), latestOpinionatedReviews: none }),
    ).toBe('2026-11-06T10:00:00Z')
  })

  it('date la review de ma dernière soumission, après une approbation ou des changements demandés', () => {
    for (const state of ['APPROVED', 'CHANGES_REQUESTED']) {
      expect(
        reviewedAtOf({ viewerLatestReview: latest('COMMENTED'), latestOpinionatedReviews: opinion(ME, state) }),
      ).toBe('2026-11-06T10:00:00Z')
    }
  })

  it('ne compte plus une review que GitHub a rejetée', () => {
    expect(
      reviewedAtOf({ viewerLatestReview: latest('DISMISSED'), latestOpinionatedReviews: none }),
    ).toBeNull()
    expect(
      reviewedAtOf({
        viewerLatestReview: latest('COMMENTED'),
        latestOpinionatedReviews: opinion(ME, 'DISMISSED'),
      }),
    ).toBeNull()
  })

  it("ne compte pas la review d'un autre", () => {
    expect(
      reviewedAtOf({ viewerLatestReview: null, latestOpinionatedReviews: opinion('sam-lee', 'APPROVED') }),
    ).toBeNull()
  })
})

const ticket = (overrides: Partial<Ticket>): Ticket => ({
  key: 'APP-1',
  title: 'Ticket',
  url: 'https://linear.test/APP-1',
  stateName: 'Backlog',
  stateType: 'backlog',
  assignedToMe: true,
  updatedAt: '2026-11-05T09:00:00Z',
  labels: [],
  notices: [],
  ...overrides,
})

describe('tickets', () => {
  it('fait remonter une mention au rang 3', () => {
    const item = itemFromTicket(
      ticket({
        notices: [
          {
            id: 'a',
            kind: 'mention',
            author: 'camille.martin',
            excerpt: 'où en est ce ticket ?',
            text: 'où en est ce ticket ?',
            at: '2026-11-05T17:25:00Z',
            url: 'https://linear.test/c',
          },
        ],
      }),
      context,
    )
    expect(item.signals[0]).toMatchObject({ rank: 3, detail: 'camille : où en est ce ticket ?' })
  })

  it('écarte un commentaire qualifié comme ne m’attendant pas', () => {
    const item = itemFromTicket(
      ticket({
        notices: [
          {
            id: 'a',
            kind: 'comment',
            author: 'taylor.kim',
            excerpt: 'archivé',
            text: 'archivé',
            at: '2026-11-05T17:25:00Z',
            url: 'https://linear.test/c',
            waitingOnMe: false,
          },
        ],
      }),
      context,
    )
    expect(item.signals).toEqual([])
  })

  it('classe les états de ticket', () => {
    const rank = (stateName: string) =>
      itemFromTicket(ticket({ stateName }), context).signals[0]?.rank
    expect(rank('To frame')).toBe(3)
    expect(rank('Ready to deploy')).toBe(4)
    expect(rank('Personal Review')).toBe(6)
    expect(rank('Backlog')).toBeUndefined()
  })

  it('range un backlog sans demande hors de l’attente, et le ramène sur une demande', () => {
    const mention = {
      id: 'a',
      kind: 'mention' as const,
      author: 'camille.martin',
      excerpt: 'tu peux regarder ?',
      text: 'tu peux regarder ?',
      at: '2026-11-05T17:25:00Z',
      url: 'https://linear.test/c',
    }
    const ball = (overrides: Partial<Ticket>) => itemFromTicket(ticket(overrides), context).ball
    expect(ball({ stateName: 'Backlog' })).toBe('parked')
    expect(ball({ stateName: 'Icebox', assignedToMe: false })).toBe('parked')
    expect(ball({ stateName: 'Backlog', notices: [{ ...mention, kind: 'comment', waitingOnMe: false }] })).toBe('parked')
    expect(ball({ stateName: 'Backlog', notices: [mention] })).toBe('me')
    expect(ball({ stateName: 'To frame' })).toBe('me')
    expect(ball({ stateName: 'Todo Weekly', stateType: 'unstarted', assignedToMe: false })).toBe('others')
  })

  it('garde dans ma file un ticket à faire qui m’est assigné, après ceux en cours', () => {
    const todo = itemFromTicket(ticket({ stateName: 'Todo Weekly', stateType: 'unstarted' }), context)
    expect(todo.ball).toBe('me')
    expect(todo.signals[0]).toMatchObject({ rank: 6, weight: 1, detail: 'Todo Weekly' })
    const started = itemFromTicket(ticket({ stateName: 'In Progress', stateType: 'started' }), context)
    expect(started.signals[0].weight).toBeLessThan(todo.signals[0].weight)
    expect(todo.state).toBe('Todo Weekly')
  })

  it('garde en attente un ticket où ma question attend une réponse, backlog compris', () => {
    const asked = { id: 'm1', excerpt: 'Tu valides ?', text: 'Tu valides ?', at: '2026-11-05T10:00:00Z', url: 'https://linear.test/m1' }
    const waiting = itemFromTicket(ticket({ stateName: 'Backlog', assignedToMe: false, asked }), context)
    expect(waiting).toMatchObject({ ball: 'others', mine: false, asked: { excerpt: 'Tu valides ?', url: 'https://linear.test/m1' } })
    const done = itemFromTicket(ticket({ stateName: 'Backlog', asked: { ...asked, awaitsReply: false } }), context)
    expect([done.ball, done.asked]).toEqual(['parked', undefined])
    const view = reconcile([topic({ links: ['APP-1'] })], [waiting], [], NOW).views[0]
    expect([view.ball, view.since]).toEqual(['others', '2026-11-05T10:00:00Z'])
  })

  it('propose le diagnostic sur un ticket de bug', () => {
    const item = itemFromTicket(ticket({ stateName: 'In Progress', labels: ['Vrai bug'] }), context)
    expect(item.signals[0].action).toBe('diagnostic')
  })
})

const topic = (overrides: Partial<Topic>): Topic => ({
  id: 't1',
  title: 'Sujet',
  status: 'open',
  links: [],
  threads: [],
  createdAt: '2026-11-01T09:00:00Z',
  body: '',
  ...overrides,
})

const ticketItem = (overrides: Partial<Item> = {}): Item =>
  ({ ...itemFromTicket(ticket({ stateName: 'In Progress' }), context), ...overrides })

describe('rapprochement sujets / signaux', () => {
  it('fusionne une PR et son ticket dans un seul sujet', () => {
    const prItem = itemFromPullRequest(
      pr({ title: 'feat (APP-1)', isDraft: true, headRefName: 'feature/app-1' }),
      context,
    )
    const result = reconcile([], [prItem, ticketItem()], [], NOW)
    expect(result.created).toHaveLength(1)
    expect(result.created[0].links).toEqual(['mobile#1', 'APP-1'])
    expect(result.views[0].items).toHaveLength(2)
  })

  it('sépare mon travail de celui des autres auquel je participe', () => {
    const theirs = itemFromPullRequest(pr({ number: 2, author: 'sam-lee', headRefName: 'feature/app-9' }), context)
    const assigned = ticketItem()
    const other = itemFromTicket(ticket({ key: 'APP-2', assignedToMe: false }), context)
    expect([itemFromPullRequest(pr({}), context).mine, theirs.mine, assigned.mine, other.mine]).toEqual([
      true,
      false,
      true,
      false,
    ])
    const result = reconcile(
      [
        topic({ id: 'review', links: ['mobile#2'] }),
        topic({ id: 'mixte', links: ['mobile#2', 'APP-1'] }),
        topic({ id: 'note' }),
      ],
      [theirs, assigned],
      [],
      NOW,
    )
    expect(result.views.map(view => [view.topic.id, view.mine])).toEqual([
      ['review', false],
      ['mixte', true],
      ['note', true],
    ])
  })

  it('cache un sujet dont tous les liens dorment en backlog', () => {
    const parked = itemFromTicket(ticket({ stateName: 'Backlog' }), context)
    const review = itemFromPullRequest(pr({ number: 3, author: 'sam-lee', headRefName: 'feature/export' }), context)
    const result = reconcile(
      [topic({ id: 'seul', links: ['APP-1'] }), topic({ id: 'avec-pr', links: ['mobile#3', 'APP-1'] })],
      [parked, review],
      [],
      NOW,
    )
    expect(result.views.map(view => [view.topic.id, view.ball])).toEqual([
      ['seul', 'parked'],
      ['avec-pr', 'others'],
    ])
  })

  it('range un ticket parent hors de Flux, même en cours, sauf si on me demande quelque chose', () => {
    const parent = (overrides: Partial<Ticket> = {}) =>
      itemFromTicket(ticket({ stateName: 'In Progress', stateType: 'started', hasSubIssues: true, ...overrides }), context)
    expect(parent()).toMatchObject({ ball: 'parked', signals: [] })
    expect(parent({ stateName: 'To frame', stateType: 'unstarted' }).ball).toBe('parked')
    const mention = { id: 'p', kind: 'mention' as const, author: 'camille.martin', excerpt: 'on découpe comment ?', text: 'on découpe comment ?', at: '2026-11-05T17:25:00Z', url: 'https://linear.test/p' }
    expect(parent({ notices: [mention] }).ball).toBe('me')
    const asked = { id: 'q', excerpt: 'Tu valides le séquencement ?', text: 'Tu valides le séquencement ?', at: '2026-11-05T10:00:00Z', url: 'https://linear.test/q' }
    expect(parent({ asked }).ball).toBe('others')
    expect(itemFromTicket(ticket({ stateName: 'In Progress', stateType: 'started' }), context).ball).toBe('me')
  })

  it('ne crée pas de sujet pour ce qui attend les autres', () => {
    const item = itemFromPullRequest(pr({ author: 'sam-lee' }), context)
    expect(reconcile([], [item], [], NOW).created).toEqual([])
  })

  it('ferme un sujet dont tous les liens sont terminés', () => {
    const merged = itemFromPullRequest(pr({ state: 'MERGED' }), context)
    const done = itemFromTicket(ticket({ stateType: 'completed' }), context)
    const result = reconcile(
      [topic({ links: ['mobile#1', 'APP-1'] })],
      [merged, done],
      [],
      NOW,
    )
    expect(result.closed).toEqual(['t1'])
  })

  it('garde ouvert tant qu’un lien est encore vivant ou inconnu', () => {
    const merged = itemFromPullRequest(pr({ state: 'MERGED' }), context)
    const result = reconcile([topic({ links: ['mobile#1', 'APP-1'] })], [merged], [], NOW)
    expect(result.closed).toEqual([])
  })

  it('ne ferme jamais une note sans lien', () => {
    const result = reconcile([topic({ links: [] })], [], [], NOW)
    expect(result.closed).toEqual([])
    expect(result.views[0].signals[0]).toMatchObject({ rank: 6, detail: 'Tâche' })
  })

  it('sort de la file un sujet sur lequel un agent travaille', () => {
    const thread = { session: 's1', name: 'x', cwd: '/', startedAt: '2026-11-06T10:00:00Z' }
    const result = reconcile(
      [topic({ links: ['APP-1'], threads: [thread] })],
      [ticketItem()],
      [{ session: 's1', status: 'busy' }],
      NOW,
    )
    expect(result.views[0].ball).toBe('agent')
  })

  it('remonte un thread inactif sans autre signal au rang 5', () => {
    const thread = { session: 's1', name: 'x', cwd: '/', startedAt: '2026-11-06T10:00:00Z' }
    const result = reconcile(
      [topic({ threads: [thread] })],
      [],
      [{ session: 's1', status: 'idle' }],
      NOW,
    )
    expect(result.views[0].rank).toBe(5)
  })

  it('montre un thread Desktop pas encore envoyé comme en attente, sans signal', () => {
    const thread = {
      session: 'd1',
      dir: 'd1',
      name: 'x',
      cwd: '/',
      startedAt: '2026-11-06T10:00:00Z',
      pending: true,
    }
    const result = reconcile([topic({ threads: [thread] })], [], [], NOW)
    expect(result.views[0].threads[0].status).toBe('pending')
    expect(result.views[0].signals.some(signal => signal.id.startsWith('thread:'))).toBe(false)
  })

  it('tient un sujet bloqué hors de la file', () => {
    const result = reconcile(
      [topic({ links: ['APP-1'], blocked: 'attend Sam' })],
      [ticketItem()],
      [],
      NOW,
    )
    expect(result.views[0].ball).toBe('others')
  })

  it('ne recrée pas un sujet clos à la main sans activité nouvelle', () => {
    const done = topic({ status: 'done', links: ['APP-1'], closedAt: '2026-11-06T11:00:00Z' })
    const result = reconcile([done], [ticketItem()], [], NOW)
    expect(result.created).toEqual([])
    expect(result.reopened).toEqual([])
  })

  it('rouvre un sujet clos quand une activité nouvelle arrive', () => {
    const done = topic({ status: 'done', links: ['APP-1'], closedAt: '2026-11-04T11:00:00Z' })
    const result = reconcile([done], [ticketItem()], [], NOW)
    expect(result.reopened).toEqual(['t1'])
  })

  it('trie la file par rang, poids puis ancienneté', () => {
    const result = reconcile([], items, [], NOW)
    const queue = result.views.filter(view => view.ball === 'me').sort(compareViews)
    expect(queue[0].topic.links).toContain('family#221')
    const ranks = queue.map(view => view.rank ?? 9)
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })
})

const view = (id: string, signalId: string, stamp: string, rank: 1 | 4 = 1): TopicView => ({
  topic: topic({ id, title: id }),
  items: [],
  signals: [{ id: signalId, rank, weight: 0, detail: 'détail', since: stamp, stamp, action: 'review' }],
  threads: [],
  rank,
  ball: 'me',
  mine: true,
  since: stamp,
  actions: [],
})

const during = (iso: string, meeting: NotifyContext['meeting'] = null): NotifyContext => ({
  now: new Date(iso),
  meeting,
  workdayStart: 9,
  workdayEnd: 19,
})

describe('notifications', () => {
  const ready = { ...EMPTY_NOTIFY_STATE, initialized: true }

  it('résume la file au premier lancement au lieu de tout envoyer', () => {
    const { notifications, state } = decide(
      EMPTY_NOTIFY_STATE,
      [view('a', 'a:1', '2026-11-06T09:00:00Z'), view('b', 'b:1', '2026-11-06T09:00:00Z')],
      during('2026-11-06T11:00:00+01:00'),
    )
    expect(notifications).toHaveLength(1)
    expect(notifications[0].title).toBe("2 sujets t'attendent")
    expect(state.seen['b:1']).toBeDefined()
  })

  it('notifie un nouveau signal de rang 0 à 3', () => {
    const { notifications } = decide(
      ready,
      [view('a', 'a:1', '2026-11-06T09:00:00Z')],
      during('2026-11-06T11:00:00+01:00'),
    )
    expect(notifications[0].topicId).toBe('a')
  })

  it('ne notifie pas un nouveau signal de rang 4', () => {
    const { notifications } = decide(
      ready,
      [view('a', 'a:1', '2026-11-06T09:00:00Z', 4)],
      during('2026-11-06T11:00:00+01:00'),
    )
    expect(notifications).toEqual([])
  })

  it('renotifie quand un signal connu évolue', () => {
    const first = decide(
      ready,
      [view('a', 'a:1', '2026-11-06T09:00:00Z')],
      during('2026-11-06T11:00:00+01:00'),
    )
    const second = decide(
      first.state,
      [view('a', 'a:1', '2026-11-06T10:30:00Z')],
      during('2026-11-06T11:30:00+01:00'),
    )
    expect(second.notifications).toHaveLength(1)
  })

  it('ne renotifie pas un signal ancien resté dans la file', () => {
    const queue = [view('a', 'a:1', '2026-09-01T09:00:00Z')]
    const first = decide(ready, queue, during('2026-11-06T11:00:00+01:00'))
    expect(first.notifications).toHaveLength(1)
    const next = decide(first.state, queue, during('2026-11-06T11:01:00+01:00'))
    expect(next.notifications).toEqual([])
  })

  it('oublie après 30 jours un signal sorti de la file', () => {
    const first = decide(ready, [view('a', 'a:1', '2026-09-01T09:00:00Z')], during('2026-11-06T11:00:00+01:00'))
    const gone = decide(first.state, [], during('2026-11-06T11:01:00+01:00'))
    expect(gone.state.seen['a:1']).toBeUndefined()
  })

  it('garde tout pendant une réunion puis groupe à la fin', () => {
    const queue = [view('a', 'a:1', '2026-11-06T09:00:00Z'), view('b', 'b:1', '2026-11-06T09:30:00Z')]
    const meeting = { title: 'Point', start: '2026-11-06T09:30:00Z', end: '2026-11-06T10:30:00Z' }
    const held = decide(ready, queue, during('2026-11-06T11:00:00+01:00', meeting))
    expect(held.notifications).toEqual([])
    const after = decide(held.state, queue, during('2026-11-06T11:31:00+01:00'))
    expect(after.notifications).toHaveLength(1)
    expect(after.notifications[0].title).toBe('2 nouveaux sujets à débloquer')
  })

  it('reste silencieux la nuit et le week-end', () => {
    const queue = [view('a', 'a:1', '2026-11-06T09:00:00Z')]
    expect(decide(ready, queue, during('2026-11-06T21:00:00+01:00')).notifications).toEqual([])
    expect(decide(ready, queue, during('2026-11-07T11:00:00+01:00')).notifications).toEqual([])
  })

  it('relance une tête de file inchangée après 2 h, pas avant', () => {
    const queue = [view('a', 'a:1', '2026-11-06T09:00:00Z')]
    const first = decide(ready, queue, during('2026-11-06T10:00:00+01:00'))
    const early = decide(first.state, queue, during('2026-11-06T11:30:00+01:00'))
    expect(early.notifications).toEqual([])
    const late = decide(early.state, queue, during('2026-11-06T12:01:00+01:00'))
    expect(late.notifications[0].title).toContain('Toujours en tête')
    const again = decide(late.state, queue, during('2026-11-06T12:30:00+01:00'))
    expect(again.notifications).toEqual([])
  })
})

describe('fichiers sujet', () => {
  it('relit à l’identique ce qu’il écrit', () => {
    const original = topic({
      title: 'Review: web#6983 — écran',
      links: ['web#6983', 'APP-1005'],
      threads: [{ session: 'uuid', name: 'hb', cwd: '/tmp', startedAt: '2026-11-06T14:02:00Z' }],
      body: 'Note libre\n\n---\n\nAvec un séparateur.',
    })
    expect(parseTopic(serializeTopic(original), 'x')).toEqual(original)
  })

  it('accepte une note écrite à la main dans Obsidian', () => {
    const parsed = parseTopic('---\ntitle: Relancer Sam\nstatus: open\n---\nCorps', 'fichier')
    expect(parsed).toMatchObject({ id: 'fichier', title: 'Relancer Sam', links: [], body: 'Corps' })
  })

  it('ignore un fichier sans en-tête', () => {
    expect(parseTopic('juste du texte', 'x')).toBeNull()
  })

  it('tire le titre et le corps de la capture', () => {
    const note = noteFromText('Relancer Sam sur l’écran\nIl attend la spec', NOW)
    expect(note).toMatchObject({
      title: 'Relancer Sam sur l’écran',
      body: 'Il attend la spec',
      status: 'inbox',
    })
    expect(note.id).toMatch(/relancer-sam-sur-l-ecran$/)
  })
})

describe('noms courts des logins', () => {
  it('garde le prénom, ou tout le login quand le début est trop court', async () => {
    const { shortLogin } = await import('../src/main/engine/rank')
    expect(shortLogin('sam-lee')).toBe('sam')
    expect(shortLogin('Le-Polemil')).toBe('Le-Polemil')
    expect(shortLogin('fredericJeanJvs')).toBe('fredericJeanJvs')
  })
})
