import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useLayer } from './layers'
import { matchSkills, type SkillOption } from '../../shared/jobs'

const MENU_CLOSE_MS = 100

const bare = (value: string) => value.trim().replace(/^\//, '')

// A field that takes any skill name, with a filtered list of the known ones under it
export function SkillPicker({
  value,
  skills,
  onChange,
}: {
  value: string
  skills: SkillOption[]
  onChange(value: string): void
}) {
  const [open, setOpen] = useState(false)
  // The menu stays mounted for the length of its closing animation
  const [mounted, setMounted] = useState(false)
  // What was typed since the menu opened: a skill already chosen leaves the whole list
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  // Escape closes the menu, not the form around it
  useLayer(open, () => setOpen(false), { root })
  const id = useId()
  const shown = matchSkills(skills, query)
  const optionId = (index: number) => `${id}-option-${index}`

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

  useEffect(() => {
    if (open) list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [active, open, mounted])

  const show = () => {
    if (open) return
    setQuery('')
    setActive(Math.max(0, skills.findIndex(skill => skill.name === bare(value))))
    setOpen(true)
  }

  const choose = (skill: SkillOption) => {
    onChange(skill.name)
    setOpen(false)
  }

  return (
    <div className="skill-picker" ref={root}>
      <input
        className="job-input"
        role="combobox"
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="Chercher un skill"
        aria-label="Skill"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={mounted ? `${id}-list` : undefined}
        aria-activedescendant={open && shown[active] ? optionId(active) : undefined}
        onClick={show}
        onChange={event => {
          onChange(event.target.value)
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (!open) show()
            else setActive(current => Math.min(Math.max(current + (event.key === 'ArrowDown' ? 1 : -1), 0), shown.length - 1))
          } else if (event.key === 'Enter' && open && shown[active]) {
            event.preventDefault()
            choose(shown[active])
          } else if (event.key === 'Tab') {
            setOpen(false)
          }
        }}
      />
      <ChevronDown size={16} aria-hidden="true" className="skill-picker-chevron" />

      {mounted && (
        <div className="skill-picker-menu" data-state={open ? 'open' : 'closed'}>
          {shown.length === 0 ? (
            <p className="skill-picker-empty">Aucun skill ne correspond</p>
          ) : (
            <ul id={`${id}-list`} ref={list} role="listbox" aria-label="Skills">
              {shown.map((skill, index) => (
                <li
                  key={skill.name}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active ? '' : undefined}
                  className="skill-picker-option"
                  title={skill.description || undefined}
                  // Keeps the focus in the field
                  onMouseDown={event => event.preventDefault()}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(skill)}
                >
                  <span className="skill-picker-name">
                    <span>/{skill.name}</span>
                    {skill.name === bare(value) && <Check size={14} aria-hidden="true" />}
                  </span>
                  {skill.description && <span className="skill-picker-desc">{skill.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
