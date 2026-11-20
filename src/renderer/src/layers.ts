import { useEffect, useRef, type RefObject } from 'react'

interface Layer {
  close(): void
  // A layer with pages of its own goes back a page; false once on its first page
  back(): boolean
}

// What is drawn over the page, the last opened on top
const layers: Layer[] = []

export const hasLayer = () => layers.length > 0

// Escape closes the topmost layer only: a menu open in a dialog closes before the dialog
export function closeTopLayer(): boolean {
  const top = layers.at(-1)
  if (!top) return false
  top.close()
  return true
}

// Back from a layer: its previous page if it has one, else the layer closes
export function backInTopLayer(): boolean {
  const top = layers.at(-1)
  if (!top) return false
  if (!top.back()) top.close()
  return true
}

// What had the focus before the last move of it: a field focused on opening already took it from
// the opener by the time the layer is pushed
let leftByFocus: HTMLElement | null = null

if (typeof window !== 'undefined') {
  window.addEventListener(
    'focusin',
    event => void (leftByFocus = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null),
    true,
  )
  // Capture: the layer stack answers before any field or button does
  window.addEventListener(
    'keydown',
    event => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return
      if (!closeTopLayer()) return
      event.preventDefault()
      event.stopPropagation()
    },
    true,
  )
}

// A surface over the page while `open`. A dialog (`focus`) takes the focus when nothing in it has
// it yet; closing gives the focus back to what had it before, unless it already went on elsewhere
export function useLayer(
  open: boolean,
  close: () => void,
  options: { back?: () => boolean; root?: RefObject<HTMLElement | null>; focus?: boolean } = {},
): void {
  const latest = useRef({ close, ...options })
  latest.current = { close, ...options }

  useEffect(() => {
    if (!open) return undefined
    const root = latest.current.root?.current
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const opener = focused && root?.contains(focused) ? leftByFocus : focused
    if (latest.current.focus && root && !root.contains(document.activeElement)) root.focus({ preventScroll: true })
    const layer: Layer = {
      close: () => latest.current.close(),
      back: () => latest.current.back?.() ?? false,
    }
    layers.push(layer)
    return () => {
      const index = layers.indexOf(layer)
      if (index >= 0) layers.splice(index, 1)
      // Once the layer is gone from the page, wherever the focus fell
      setTimeout(() => {
        const focused = document.activeElement
        const root = latest.current.root?.current
        const lost = !focused || focused === document.body || !focused.isConnected || (root?.contains(focused) ?? false)
        if (lost && opener?.isConnected) opener.focus({ preventScroll: true })
      })
    }
  }, [open])
}
