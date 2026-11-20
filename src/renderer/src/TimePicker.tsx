import { Check, ChevronDown, Clock } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLayer } from './layers'

const MENU_CLOSE_MS = 120
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const MINUTES = Array.from({ length: 12 }, (_, step) => step * 5)
const PRESETS = ['08:30', '09:00', '09:30', '10:00']

const pad = (value: number) => String(value).padStart(2, '0')

function parse(value: string): [number, number] {
  const [hour, minute] = value.split(':').map(Number)
  return [Number.isFinite(hour) ? hour : 9, Number.isFinite(minute) ? minute : 0]
}

function Column({
  label,
  values,
  selected,
  onPick,
}: {
  label: string
  values: number[]
  selected: number
  onPick(value: number): void
}) {
  const list = useRef<HTMLDivElement>(null)
  const opened = useRef(false)

  // Keeps the chosen value in the middle: at once on opening, then gliding as it changes
  useLayoutEffect(() => {
    const current = list.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (current && list.current) {
      const top = current.offsetTop - list.current.clientHeight / 2 + current.clientHeight / 2
      list.current.scrollTo({ top, behavior: opened.current ? 'smooth' : 'instant' })
    }
    opened.current = true
  }, [selected])

  return (
    <div className="time-column">
      <span className="time-column-label">{label}</span>
      <div className="time-column-list" ref={list} role="listbox" aria-label={label}>
        {values.map(value => (
          <button
            type="button"
            role="option"
            key={value}
            aria-selected={value === selected}
            className="time-option"
            onClick={() => onPick(value)}
          >
            {pad(value)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function TimePicker({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [open, setOpen] = useState(false)
  // The menu stays mounted for the length of its closing animation
  const [mounted, setMounted] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useLayer(open, () => setOpen(false), { root })
  const [hour, minute] = parse(value)
  // A time saved off the 5-minute grid stays choosable
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), MENU_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const set = (nextHour: number, nextMinute: number) => onChange(`${pad(nextHour)}:${pad(nextMinute)}`)

  const nudge = (delta: number) => {
    const total = (((hour * 60 + minute + delta) % 1440) + 1440) % 1440
    set(Math.floor(total / 60), total % 60)
  }

  return (
    <div
      className="time-picker"
      ref={root}
    >
      <button
        type="button"
        className="time-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        onKeyDown={event => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            nudge(event.key === 'ArrowUp' ? 5 : -5)
          }
        }}
      >
        <Clock size={16} aria-hidden="true" className="input-icon" />
        <span className="time-value">{value}</span>
        <ChevronDown size={16} aria-hidden="true" className="time-chevron" />
      </button>

      {mounted && (
        <div className="time-menu" data-state={open ? 'open' : 'closed'} role="dialog" aria-label="Choisir l’heure">
          <div className="time-presets">
            {PRESETS.map(preset => (
              <button
                type="button"
                key={preset}
                className="time-preset"
                aria-pressed={preset === value}
                onClick={() => {
                  onChange(preset)
                  setOpen(false)
                }}
              >
                {preset}
              </button>
            ))}
          </div>
          <div className="time-columns">
            <Column label="Heure" values={HOURS} selected={hour} onPick={next => set(next, minute)} />
            <span className="time-colon" aria-hidden="true">:</span>
            <Column label="Minutes" values={minutes} selected={minute} onPick={next => set(hour, next)} />
          </div>
          <button type="button" className="time-done" onClick={() => setOpen(false)}>
            <Check size={14} aria-hidden="true" />
            Valider {value}
          </button>
        </div>
      )}
    </div>
  )
}
