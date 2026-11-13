import { useLayoutEffect, useRef, useState, type DependencyList } from 'react'

interface Box {
  left: number
  top: number
  width: number
  height: number
  // The first placement lands without sliding in from the edge
  animate: boolean
}

// The chosen tab's pill, drawn once behind the buttons of a .tabs.sliding bar, slides from one to the other
export function useSlidingThumb(current: string | null, deps: DependencyList = []) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const [box, setBox] = useState<Box | null>(null)

  useLayoutEffect(() => {
    const place = (animate: boolean) => {
      const button = current ? buttons.current.get(current) : undefined
      if (!button) return setBox(null)
      setBox(previous => ({
        left: button.offsetLeft,
        top: button.offsetTop,
        width: button.offsetWidth,
        height: button.offsetHeight,
        animate: animate && previous !== null,
      }))
    }
    place(true)
    // Fonts loading, a count changing or the window narrowing move the buttons: follow without sliding
    const observer = new ResizeObserver(() => place(false))
    buttons.current.forEach(button => observer.observe(button))
    return () => observer.disconnect()
  }, [current, ...deps])

  const register = (id: string) => (element: HTMLButtonElement | null) => {
    if (element) buttons.current.set(id, element)
    else buttons.current.delete(id)
  }

  const thumb = box && (
    <span
      className={`tabs-thumb${box.animate ? ' animate' : ''}`}
      aria-hidden="true"
      style={{
        transform: `translate(${box.left}px, ${box.top}px)`,
        width: box.width,
        height: box.height,
      }}
    />
  )

  return { register, thumb }
}
