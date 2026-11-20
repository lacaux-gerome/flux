import { Check, ChevronDown, RefreshCw, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLayer } from './layers'
import type { GithubAccounts } from '../../shared/types'

function Avatar({ src, login, size }: { src?: string | null; login: string; size: number }) {
  if (src) return <img className="avatar" src={src} alt="" width={size} height={size} />
  return (
    <span className="avatar placeholder" style={{ width: size, height: size }} aria-hidden="true">
      {login.slice(0, 1).toUpperCase()}
    </span>
  )
}

const MENU_CLOSE_MS = 120

// value null follows whichever account gh has active
export function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: GithubAccounts | null
  value: string | null
  onChange(value: string | null): void
}) {
  const [open, setOpen] = useState(false)
  // The menu stays mounted for the length of its closing animation
  const [mounted, setMounted] = useState(false)
  const [copied, setCopied] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useLayer(open, () => setOpen(false), { root })

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

  const host = accounts?.host ?? 'github.com'
  const loginCommand = `gh auth login --hostname ${host}`
  const shown = value ?? accounts?.active ?? null
  const profile = shown ? accounts?.profiles[shown] : undefined
  const logins = accounts?.logins ?? []
  const missing = value !== null && accounts !== null && !logins.includes(value)

  const choose = (next: string | null) => {
    onChange(next)
    setOpen(false)
  }

  const copyLogin = async () => {
    await navigator.clipboard.writeText(loginCommand)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const subtitle = (() => {
    if (missing) return 'Déconnecté de gh'
    const name = profile?.name ?? null
    if (value === null) return name ? `${name} · compte actif de gh` : 'Compte actif de gh'
    return name
  })()

  return (
    <div
      className="account-picker"
      ref={root}
    >
      <button
        type="button"
        className="account-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        {shown ? (
          <>
            <Avatar src={profile?.avatar} login={shown} size={36} />
            <span className="account-text">
              <strong>{shown}</strong>
              {subtitle && <span>{subtitle}</span>}
            </span>
          </>
        ) : (
          <span className="account-text">
            <strong>{accounts ? 'Aucun compte gh' : 'Chargement…'}</strong>
          </span>
        )}
        <ChevronDown size={16} aria-hidden="true" className="account-chevron" />
      </button>

      {mounted && (
        <div
          className="account-menu"
          data-state={open ? 'open' : 'closed'}
          role="listbox"
          aria-label="Comptes GitHub"
        >
          <p className="account-menu-title">Changer de compte</p>
          {logins.map(login => (
            <button
              key={login}
              type="button"
              role="option"
              aria-selected={value === login}
              className="account-option"
              onClick={() => choose(login)}
            >
              <Avatar src={accounts?.profiles[login]?.avatar} login={login} size={24} />
              <strong>{login}</strong>
              {accounts?.profiles[login]?.name && <span>{accounts.profiles[login].name}</span>}
              {value === login && <Check size={15} aria-hidden="true" className="account-check" />}
            </button>
          ))}
          <button
            type="button"
            role="option"
            aria-selected={value === null}
            className="account-option"
            onClick={() => choose(null)}
          >
            <RefreshCw size={16} aria-hidden="true" className="account-icon" />
            <strong>Suivre le compte actif de gh</strong>
            {value === null && <Check size={15} aria-hidden="true" className="account-check" />}
          </button>
          <hr />
          <button type="button" className="account-option" onClick={() => void copyLogin()}>
            {copied ? (
              <Check size={16} aria-hidden="true" className="account-icon" />
            ) : (
              <UserPlus size={16} aria-hidden="true" className="account-icon" />
            )}
            <strong>{copied ? 'Commande copiée' : 'Ajouter un compte'}</strong>
            <span>{loginCommand}</span>
          </button>
        </div>
      )}
    </div>
  )
}
