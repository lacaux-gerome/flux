import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  askedComments,
  fetchLinear,
  linkedFilter,
  mergeTickets,
  noticeFromNotification,
  type RawNotification,
  type RawOwnComment,
} from '../src/main/sources/linear'

const NOW = new Date('2026-11-06T12:00:00Z')

const issue = (overrides: Record<string, unknown> = {}) => ({
  identifier: 'WEB-3434',
  title: 'Volume saturé',
  url: 'https://linear.app/acme/issue/WEB-3434',
  updatedAt: '2026-11-05T17:25:29Z',
  state: { name: 'Backlog', type: 'backlog' },
  assignee: { isMe: true },
  labels: { nodes: [] },
  ...overrides,
})

const notification = (overrides: Partial<RawNotification> = {}): RawNotification => ({
  id: 'n1',
  type: 'issueCommentMention',
  readAt: null,
  snoozedUntilAt: null,
  archivedAt: null,
  createdAt: '2026-11-05T17:25:30Z',
  subtitle: 'camille.martin mentioned you: @alex où en est ce ticket ?',
  actor: { displayName: 'camille.martin', name: 'Camille' },
  botActor: null,
  issue: issue(),
  comment: {
    id: 'c1',
    body: '@alex où en est ce ticket ? Passation prévue ?',
    url: 'https://linear.app/acme/issue/WEB-3434#comment-1',
    createdAt: '2026-11-05T17:25:30Z',
  },
  ...overrides,
})

describe('filtrage de l’inbox Linear', () => {
  it('garde une mention, même sur un ticket qui n’est pas à moi', () => {
    const notice = noticeFromNotification(
      notification({ issue: issue({ assignee: { isMe: false } }) }),
      NOW,
    )
    expect(notice).toMatchObject({ kind: 'mention', author: 'camille.martin', id: 'c1' })
  })

  it('garde un commentaire humain sur mon ticket ouvert', () => {
    expect(noticeFromNotification(notification({ type: 'issueNewComment' }), NOW)?.kind).toBe(
      'comment',
    )
  })

  it('écarte un commentaire sur le ticket de quelqu’un d’autre', () => {
    expect(
      noticeFromNotification(
        notification({ type: 'issueNewComment', issue: issue({ assignee: { isMe: false } }) }),
        NOW,
      ),
    ).toBeNull()
  })

  it.each([
    'issueStatusChanged',
    'triageResponsibilityIssueAddedToTriage',
    'feedSummaryGenerated',
    'issueUnassignedFromYou',
    'projectUpdatePrompt',
  ])('écarte le bruit %s', type => {
    expect(noticeFromNotification(notification({ type }), NOW)).toBeNull()
  })

  it('écarte les commentaires automatiques Sentry', () => {
    const comment = {
      id: 'c2',
      body: '🗄️ Archived in Sentry Status: archived until condition met',
      url: 'https://linear.test',
      createdAt: '2026-11-06T09:59:22Z',
    }
    expect(
      noticeFromNotification(notification({ type: 'issueNewComment', comment }), NOW),
    ).toBeNull()
  })

  it('écarte un bot, un ticket fermé, une notification lue ou reportée', () => {
    expect(noticeFromNotification(notification({ botActor: { name: 'Sentry' } }), NOW)).toBeNull()
    expect(
      noticeFromNotification(
        notification({ issue: issue({ state: { name: 'Done', type: 'completed' } }) }),
        NOW,
      ),
    ).toBeNull()
    expect(noticeFromNotification(notification({ readAt: '2026-11-06T08:00:00Z' }), NOW)).toBeNull()
    expect(
      noticeFromNotification(notification({ snoozedUntilAt: '2026-11-07T08:00:00Z' }), NOW),
    ).toBeNull()
  })

  it('rattache les remarques au ticket, sans doublon', () => {
    const tickets = mergeTickets(
      [issue()],
      [],
      [notification(), notification({ id: 'n2' }), notification({ type: 'issueStatusChanged' })],
      NOW,
    )
    expect(tickets).toHaveLength(1)
    expect(tickets[0].notices).toHaveLength(1)
  })
})

describe('tickets parents', () => {
  it('repère un ticket découpé en sous-tickets, d’où qu’il vienne', () => {
    const parent = issue({ identifier: 'APP-2', state: { name: 'In Progress', type: 'started' }, children: { nodes: [{ id: 'x' }] } })
    const tickets = mergeTickets([parent, issue({ identifier: 'APP-3', children: { nodes: [] } }), issue()], [], [], NOW)
    expect(tickets.map(ticket => [ticket.key, ticket.hasSubIssues])).toEqual([
      ['APP-2', true],
      ['APP-3', false],
      ['WEB-3434', false],
    ])
  })
})

describe('tickets liés aux sujets', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('filtre sur les identifiants Linear, sans les PR', () => {
    expect(linkedFilter(['APP-982', 'mobile#1592', 'WEB-3434'])).toEqual({
      id: { in: ['APP-982', 'WEB-3434'] },
    })
    expect(linkedFilter(['mobile#1592'])).toBeNull()
  })

  it('ignore un ticket qu’aucun sujet ne référence, même si Linear le renvoie', async () => {
    const data = {
      viewer: { assignedIssues: { nodes: [] } },
      linked: {
        nodes: [
          issue({ identifier: 'APP-982', assignee: { isMe: false } }),
          issue({ identifier: 'ACC-5435', assignee: { isMe: false } }),
        ],
      },
      notifications: { nodes: [] },
    }
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) =>
      init.body.includes('isMe: { eq: true }')
        ? new Response('indisponible', { status: 500 })
        : new Response(JSON.stringify({ data })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const tickets = await fetchLinear('clef', ['APP-982'])
    expect(tickets.map(ticket => ticket.key)).toEqual(['APP-982'])
  })
})

describe('mes commentaires sans réponse', () => {
  const reply = (createdAt: string, isMe = false) => ({ createdAt, user: { isMe } })
  const own = (overrides: Partial<RawOwnComment> = {}, replies: Array<ReturnType<typeof reply> | { createdAt: string; user: null }> = []): RawOwnComment => ({
    id: 'm1',
    body: '@camille tu peux valider le **design** avant jeudi ? https://figma.test/x',
    url: 'https://linear.app/acme/issue/WEB-3434#comment-m1',
    createdAt: '2026-11-05T10:00:00Z',
    resolvedAt: null,
    parent: null,
    issue: { ...issue({ assignee: { isMe: false } }), comments: { nodes: [reply('2026-11-05T10:00:00Z', true), ...replies] } },
    ...overrides,
  })

  it('garde mon dernier commentaire par ticket tant que personne n’a répondu', () => {
    const asked = askedComments([
      own({ id: 'vieux', createdAt: '2026-11-04T09:00:00Z' }),
      own({}, [reply('2026-11-05T11:00:00Z', true), { createdAt: '2026-11-05T12:00:00Z', user: null }]),
    ])
    expect(asked).toHaveLength(1)
    expect(asked[0].asked).toMatchObject({
      id: 'm1',
      excerpt: '@camille tu peux valider le design avant jeudi ?',
      at: '2026-11-05T10:00:00Z',
      url: 'https://linear.app/acme/issue/WEB-3434#comment-m1',
    })
  })

  it('écarte un commentaire auquel quelqu’un a répondu, un fil résolu ou un ticket fermé', () => {
    expect(askedComments([own({}, [reply('2026-11-05T15:00:00Z')])])).toEqual([])
    expect(askedComments([own({ resolvedAt: '2026-11-05T16:00:00Z' })])).toEqual([])
    expect(askedComments([own({ parent: { resolvedAt: '2026-11-05T16:00:00Z' } })])).toEqual([])
    const closed = own()
    closed.issue!.state = { name: 'Done', type: 'completed' }
    expect(askedComments([closed, own({ id: 'projet', issue: null })])).toEqual([])
  })

  it('ajoute le ticket commenté, ou complète celui qui m’est déjà assigné', () => {
    const tickets = mergeTickets([issue({ identifier: 'APP-1' })], [], [], NOW, [
      own(),
      own({ id: 'm2', issue: { ...issue({ identifier: 'APP-1' }), comments: { nodes: [] } } }),
    ])
    expect(tickets.map(ticket => [ticket.key, ticket.assignedToMe, ticket.asked?.id])).toEqual([
      ['APP-1', true, 'm2'],
      ['WEB-3434', false, 'm1'],
    ])
  })
})
