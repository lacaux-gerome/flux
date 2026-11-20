import { Waves } from 'lucide-react'
import { useEffect, useState } from 'react'

// How often the wave flows across the logo tile
const WAVE_EVERY_MS = 30_000

// The Flux tile: now and then its wave flows out to the right and back in from the left.
// Only while Flux is on screen and focused, never when the system asks for reduced motion
export function BrandMark() {
  const [waving, setWaving] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const timer = window.setInterval(() => {
      if (reduced.matches || document.hidden || !document.hasFocus()) return
      setWaving(true)
    }, WAVE_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span className="brand-mark glass">
      <Waves
        className={waving ? 'brand-wave waving' : 'brand-wave'}
        size={16}
        strokeWidth={2.4}
        aria-hidden="true"
        onAnimationEnd={event => {
          if (event.animationName === 'brand-wave-in') setWaving(false)
        }}
      />
    </span>
  )
}
