import { describe, expect, it } from 'vitest'
import { readSwipe, SWIPE_DISTANCE } from '../src/renderer/src/backForward'
import { back, forget, forward, go, replace, type History } from '../src/renderer/src/history'

interface Place {
  tab: string
  skill: string | null
}

const same = (a: Place, b: Place) => a.tab === b.tab && a.skill === b.skill
const start: History<Place> = { back: [], place: { tab: 'queue', skill: null }, forward: [] }

describe('history', () => {
  it('goes back and forward through the places visited', () => {
    const visited = go(go(start, { tab: 'claude' }, same), { skill: 'command:gl_daily' }, same)
    expect(visited.back.map(place => place.tab)).toEqual(['queue', 'claude'])

    const backed = back(back(visited))
    expect(backed.place).toEqual({ tab: 'queue', skill: null })
    expect(back(backed)).toBe(backed)

    const again = forward(backed)
    expect(again.place).toEqual({ tab: 'claude', skill: null })
    expect(again.forward).toEqual([{ tab: 'claude', skill: 'command:gl_daily' }])
  })

  it('drops what was ahead on a new move, and ignores a move to the same place', () => {
    const backed = back(go(start, { tab: 'daily' }, same))
    const moved = go(backed, { tab: 'pulls' }, same)
    expect(moved.forward).toEqual([])
    expect(go(moved, { tab: 'pulls' }, same)).toBe(moved)
  })

  it('changes the place without a step back on replace', () => {
    const replaced = replace(start, place => ({ tab: `${place.tab}-bis` }))
    expect(replaced.place.tab).toBe('queue-bis')
    expect(replaced.back).toEqual([])
  })

  it('forgets a removed skill on both sides', () => {
    const visited = back(go(go(start, { skill: 'skill:design' }, same), { skill: 'skill:other' }, same))
    const cleaned = forget(visited, place => place.skill === 'skill:other', same)
    expect(cleaned.forward).toEqual([])
    expect(cleaned.back).toEqual([start.place])
  })

  it('leaves no step back to the place already shown once the skill is gone', () => {
    const opened = go(go(go(start, { tab: 'claude' }, same), { skill: 'skill:design' }, same), { tab: 'daily' }, same)
    const returned = replace(back(opened), { skill: null })
    const cleaned = forget(returned, place => place.skill === 'skill:design', same)
    expect(cleaned.place).toEqual({ tab: 'claude', skill: null })
    expect(cleaned.back).toEqual([start.place])
    expect(cleaned.forward).toEqual([])
  })

  it('keeps the last fifty places', () => {
    let history = start
    for (let index = 0; index < 60; index++) history = go(history, { tab: `tab-${index}` }, same)
    expect(history.back).toHaveLength(50)
    expect(history.back[0].tab).toBe('tab-9')
  })
})

describe('readSwipe', () => {
  it('turns the page once two fingers went far enough sideways', () => {
    expect(readSwipe({ x: -SWIPE_DISTANCE, y: 0, spent: false })).toEqual({ direction: 'back', pull: 1 })
    expect(readSwipe({ x: SWIPE_DISTANCE * 2, y: 10, spent: false })).toEqual({ direction: 'forward', pull: 1 })
  })

  it('only shows the pull before that', () => {
    expect(readSwipe({ x: -SWIPE_DISTANCE / 2, y: 0, spent: false })).toEqual({ direction: null, pull: 0.5 })
  })

  it('ignores a vertical scroll and a spent gesture', () => {
    expect(readSwipe({ x: -SWIPE_DISTANCE, y: 100, spent: false }).pull).toBe(0)
    expect(readSwipe({ x: -SWIPE_DISTANCE * 2, y: 0, spent: true }).direction).toBeNull()
  })
})
