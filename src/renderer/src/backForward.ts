import { useEffect, useRef, type RefObject } from 'react'
import { backInTopLayer, hasLayer } from './layers'

export type Direction = 'back' | 'forward'

// A trackpad swipe is a run of wheel events: a pause this long ends it
const GESTURE_GAP_MS = 220
// How far two fingers travel sideways before the page turns
export const SWIPE_DISTANCE = 150
// The trackpad and the system's own swipe can both report one gesture
const REPEAT_MS = 450

export interface Swipe {
  x: number
  y: number
  // The gesture scrolled something sideways, or already turned the page
  spent: boolean
}

// Where a sideways swipe stands: the page to turn to once it went far enough, and how far along it is
export function readSwipe(swipe: Swipe): { direction: Direction | null; pull: number } {
  if (swipe.spent || Math.abs(swipe.x) < 2 * Math.abs(swipe.y)) return { direction: null, pull: 0 }
  // Fingers moving right scroll left: that is going back
  const direction: Direction = swipe.x < 0 ? 'back' : 'forward'
  const pull = Math.min(1, Math.abs(swipe.x) / SWIPE_DISTANCE)
  return { direction: pull >= 1 ? direction : null, pull }
}

// Whether something under the pointer would scroll sideways in this direction
function scrollsSideways(target: EventTarget | null, deltaX: number): boolean {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.scrollWidth <= node.clientWidth + 1) continue
    const overflow = getComputedStyle(node).overflowX
    if (overflow !== 'auto' && overflow !== 'scroll') continue
    const room = deltaX < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1
    if (room) return true
  }
  return false
}

// ⌘[ and ⌘], the mouse's side buttons, a two-finger swipe and the system's own swipe all go back or
// forward: an open layer first, then the history. `edge` shows how far a swipe got
export function useBackForward({
  back,
  forward,
  can,
  edge,
}: {
  back(): void
  forward(): void
  can(direction: Direction): boolean
  edge: RefObject<HTMLElement | null>
}): void {
  const latest = useRef({ back, forward, can })
  latest.current = { back, forward, can }

  useEffect(() => {
    let last = 0
    const navigate = (direction: Direction) => {
      const now = performance.now()
      if (now - last < REPEAT_MS) return
      last = now
      if (direction === 'back' && backInTopLayer()) return
      if (hasLayer()) return
      if (direction === 'back') latest.current.back()
      else latest.current.forward()
    }

    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
      if (event.key !== '[' && event.key !== ']') return
      event.preventDefault()
      navigate(event.key === '[' ? 'back' : 'forward')
    }

    // Buttons 3 and 4 are the mouse's back and forward
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault()
    }
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      navigate(event.button === 3 ? 'back' : 'forward')
    }

    let swipe: Swipe = { x: 0, y: 0, spent: false }
    let quiet: ReturnType<typeof setTimeout> | undefined
    const show = (direction: Direction | null, pull: number) => {
      const element = edge.current
      if (!element) return
      element.dataset.side = direction === 'forward' ? 'right' : 'left'
      element.style.setProperty('--pull', String(pull))
    }
    const settle = () => {
      swipe = { x: 0, y: 0, spent: false }
      show(null, 0)
    }
    const onWheel = (event: WheelEvent) => {
      // A pinch zooms, and a part of the page that pans on its own keeps the gesture
      if (event.ctrlKey || event.defaultPrevented) return
      clearTimeout(quiet)
      quiet = setTimeout(settle, GESTURE_GAP_MS)
      if (swipe.spent) return
      if (event.deltaX !== 0 && scrollsSideways(event.target, event.deltaX)) {
        swipe = { ...swipe, spent: true }
        show(null, 0)
        return
      }
      swipe = { x: swipe.x + event.deltaX, y: swipe.y + event.deltaY, spent: false }
      const heading = swipe.x < 0 ? 'back' : 'forward'
      if (!latest.current.can(heading) && !(heading === 'back' && hasLayer())) return
      const { direction, pull } = readSwipe(swipe)
      if (direction) {
        swipe = { ...swipe, spent: true }
        show(null, 0)
        navigate(direction)
        return
      }
      show(pull > 0.15 ? heading : null, pull > 0.15 ? pull : 0)
    }

    const stopSystem = window.flux.onNavigate(navigate)
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      stopSystem()
      clearTimeout(quiet)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('wheel', onWheel)
    }
  }, [])
}
