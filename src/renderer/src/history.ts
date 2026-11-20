import { useState } from 'react'

// How far back Flux remembers
const KEPT = 50

export interface History<T> {
  back: T[]
  place: T
  forward: T[]
}

type Patch<T> = Partial<T> | ((place: T) => Partial<T>)

const apply = <T>(place: T, patch: Patch<T>): T => ({
  ...place,
  ...(typeof patch === 'function' ? patch(place) : patch),
})

// A move to somewhere new: the place left goes on the back stack, what was ahead is dropped
export function go<T>(history: History<T>, patch: Patch<T>, same: (a: T, b: T) => boolean): History<T> {
  const place = apply(history.place, patch)
  if (same(place, history.place)) return history
  return { back: [...history.back, history.place].slice(-KEPT), place, forward: [] }
}

// A change that is not a move (a correction, walking the list with the arrows): nothing to come back to
export function replace<T>(history: History<T>, patch: Patch<T>): History<T> {
  return { ...history, place: apply(history.place, patch) }
}

// A place that is gone, a skill removed, is not come back to; nor, once it is out, the place on
// either side of it that is the same as the one beside it
export function forget<T>(history: History<T>, gone: (place: T) => boolean, same: (a: T, b: T) => boolean): History<T> {
  const kept = [...history.back, history.place, ...history.forward].filter(
    place => place === history.place || !gone(place),
  )
  const at = kept.indexOf(history.place)
  const distinct = (places: T[], beside: T) => places.filter((place, index) => !same(place, places[index + 1] ?? beside))
  const back = distinct(kept.slice(0, at), history.place)
  const forward = distinct(kept.slice(at + 1).reverse(), history.place).reverse()
  return { back, place: history.place, forward }
}

export function back<T>(history: History<T>): History<T> {
  const previous = history.back.at(-1)
  if (previous === undefined) return history
  return { back: history.back.slice(0, -1), place: previous, forward: [history.place, ...history.forward] }
}

export function forward<T>(history: History<T>): History<T> {
  const next = history.forward[0]
  if (next === undefined) return history
  return { back: [...history.back, history.place], place: next, forward: history.forward.slice(1) }
}

// The places Flux went through, so that ⌘[, the mouse's back button and the trackpad come back
export function useHistory<T>(initial: () => T, same: (a: T, b: T) => boolean) {
  const [history, setHistory] = useState<History<T>>(() => ({ back: [], place: initial(), forward: [] }))
  return {
    place: history.place,
    canBack: history.back.length > 0,
    canForward: history.forward.length > 0,
    go: (patch: Patch<T>) => setHistory(current => go(current, patch, same)),
    replace: (patch: Patch<T>) => setHistory(current => replace(current, patch)),
    forget: (gone: (place: T) => boolean) => setHistory(current => forget(current, gone, same)),
    back: () => setHistory(back),
    forward: () => setHistory(forward),
  }
}
