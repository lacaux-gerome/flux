import { ArrowRight, Search as SearchIcon, StickyNote } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { AppState } from '../../shared/types'
import { LinkIcon } from './Brand'
import { refLabel } from './format'
import { searchFlux, showMenu, TAB_LABEL, type SearchResult } from './navigation'
import { useLayer } from './layers'
import { rankStyle, tint } from './rankStyle'

interface SearchProps {
  state: AppState
  onPick(result: SearchResult): void
  onClose(): void
}

function Lead({ result }: { result: SearchResult }) {
  if (result.kind === 'page') {
    return (
      <>
        <ArrowRight size={13} aria-hidden="true" />
        Page
      </>
    )
  }
  if (!result.ref) {
    return (
      <>
        <StickyNote size={13} aria-hidden="true" />
        Note
      </>
    )
  }
  return (
    <>
      <LinkIcon url={result.url ?? undefined} size={13} />
      {refLabel(result.ref)}
    </>
  )
}

// Cmd+K: every topic and waiting item of Flux, one row each, opened where it lives
export function Search({ state, onPick, onClose }: SearchProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLUListElement>(null)
  const root = useRef<HTMLDivElement>(null)
  useLayer(true, onClose, { root })
  const results = useMemo(() => searchFlux(state, query), [state, query])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(index => Math.min(Math.max(index + step, 0), Math.max(results.length - 1, 0)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const result = results[active]
      if (result) onPick(result)
    }
  }

  return (
    <div className="scrim search-scrim" onClick={onClose}>
      <div
        ref={root}
        className="search glass"
        role="dialog"
        aria-modal="true"
        aria-label="Rechercher dans Flux"
        onClick={event => event.stopPropagation()}
      >
        <label className="search-field">
          <SearchIcon size={17} aria-hidden="true" />
          <input
            autoFocus
            value={query}
            placeholder="Un sujet, une PR, un ticket, une page…"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls="search-results"
            aria-activedescendant={results[active] ? `search-${active}` : undefined}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={onKey}
          />
          <kbd>esc</kbd>
        </label>
        {results.length > 0 ? (
          <ul id="search-results" ref={list} role="listbox" className="search-results">
            {results.map((result, index) => (
              <li
                key={result.id}
                id={`search-${index}`}
                role="option"
                aria-selected={index === active}
                className="search-row"
                style={tint(rankStyle(result.rank))}
                onMouseMove={() => setActive(index)}
                onClick={() => onPick(result)}
                onContextMenu={event => result.menu && showMenu(event, result.menu)}
              >
                <span className="search-ref">
                  <Lead result={result} />
                </span>
                <span className="search-text">
                  <span className="search-title">{result.title}</span>
                  {result.detail && <span className="search-detail">{result.detail}</span>}
                </span>
                <span className="search-tab">{TAB_LABEL[result.tab]}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="search-empty">Rien ne correspond à « {query.trim()} ».</p>
        )}
        <footer className="search-hints">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> naviguer
          </span>
          <span>
            <kbd>↵</kbd> ouvrir
          </span>
          <span>clic droit : copier le lien</span>
        </footer>
      </div>
    </div>
  )
}
