import { CircleAlert, CircleCheck, CircleDashed, CircleX, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  mcpDraftProblem,
  removable,
  SCOPE_LABEL,
  type McpBoard,
  type McpDraft,
  type McpEntry,
  type McpHealth,
  type McpTransport,
} from '../../shared/claude'
import { mcpLabel } from '../../shared/jobs'
import { DialogForm } from './Dialog'
import { waitingFor } from './format'
import { useLayer } from './layers'

const HEALTH_LABEL: Record<McpHealth, string> = {
  ok: 'connecté',
  auth: 'à connecter',
  failed: 'injoignable',
  pending: 'à approuver',
  unknown: 'inconnu',
}

const TRANSPORTS: Array<{ key: McpTransport; label: string }> = [
  { key: 'http', label: 'HTTP' },
  { key: 'sse', label: 'SSE' },
  { key: 'stdio', label: 'Commande' },
]

function HealthIcon({ status, busy }: { status: McpHealth; busy: boolean }) {
  if (busy) return <LoaderCircle size={16} className="job-icon spin" aria-label="Vérification" />
  if (status === 'ok') return <CircleCheck size={16} className="job-icon ok" aria-label="Connecté" />
  if (status === 'failed') return <CircleX size={16} className="job-icon fail" aria-label="Injoignable" />
  if (status === 'auth') return <CircleAlert size={16} className="job-icon auth" aria-label="À connecter" />
  return <CircleDashed size={16} className="job-icon" aria-label={HEALTH_LABEL[status]} />
}

function home(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

function metaOf(server: McpEntry, cwd: string): string {
  const scope = server.scope === 'local' || server.scope === 'project' ? `${SCOPE_LABEL[server.scope]} · ${home(cwd)}` : SCOPE_LABEL[server.scope]
  const parts = [scope]
  if (server.transport) parts.push(server.transport === 'stdio' ? 'commande' : server.transport.toUpperCase())
  if (server.scope !== 'claude.ai') parts.push(home(server.target))
  return parts.join(' · ')
}

// A form closed before adding opens again as it was left. In memory only: headers and variables
// may hold a token
let unsentDraft: McpDraft | null = null

function blank(): McpDraft {
  return { name: '', transport: 'http', target: '', scope: 'user', env: '', headers: '' }
}

function McpEditor({
  board,
  onClose,
  onAdded,
}: {
  board: McpBoard
  onClose(): void
  onAdded(name: string): void
}) {
  const [draft, setDraft] = useState<McpDraft>(() => unsentDraft ?? blank())
  const [restored, setRestored] = useState(unsentDraft !== null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)
  const latest = useRef(draft)
  latest.current = draft
  // Added, or let go with "Annuler": nothing to keep
  const settled = useRef(false)

  useEffect(
    () => () => {
      const left = latest.current
      unsentDraft = settled.current || JSON.stringify(left) === JSON.stringify(blank()) ? null : left
    },
    [],
  )
  const set = (patch: Partial<McpDraft>) => {
    setDraft(current => ({ ...current, ...patch }))
    setProblem(null)
  }

  useEffect(() => nameField.current?.focus(), [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const missing = mcpDraftProblem(
      draft,
      board.servers.map(server => server.name),
    )
    if (missing) {
      setProblem(missing)
      return
    }
    setSaving(true)
    try {
      await window.flux.addMcp(draft)
      settled.current = true
      onAdded(draft.name.trim())
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogForm className="job-editor" label="Ajouter un MCP" onClose={onClose} onSubmit={event => void submit(event)}>
      <header>
        <h1>Ajouter un MCP</h1>
        <button type="button" className="round glass small" aria-label="Fermer" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {restored && (
        <p className="job-kept" role="status">
          Brouillon repris.
          <button
            type="button"
            onClick={() => {
              setDraft(blank())
              setRestored(false)
            }}
          >
            Effacer
          </button>
        </p>
      )}

      <label>
        Nom
        <input
          ref={nameField}
          className="job-input"
          value={draft.name}
          spellCheck={false}
          placeholder="sentry"
          onChange={event => set({ name: event.target.value })}
        />
      </label>

      <div className="field">
        <span>Type</span>
        <div className="job-choice three" role="group" aria-label="Type">
          {TRANSPORTS.map(entry => (
            <button
              type="button"
              key={entry.key}
              className="time-preset"
              aria-pressed={draft.transport === entry.key}
              onClick={() => set({ transport: entry.key })}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <input
          className="job-input"
          value={draft.target}
          spellCheck={false}
          aria-label={draft.transport === 'stdio' ? 'Commande' : 'URL'}
          placeholder={draft.transport === 'stdio' ? 'npx -y @acme/mcp-server --flag' : 'https://mcp.exemple.com/mcp'}
          onChange={event => set({ target: event.target.value })}
        />
        <small>
          {draft.transport === 'stdio'
            ? 'La commande qui lance le serveur, avec ses arguments.'
            : 'Si le serveur demande une connexion, « Reconnecter » ouvrira ton navigateur.'}
        </small>
      </div>

      <div className="field">
        <span>Portée</span>
        <div className="job-choice" role="group" aria-label="Portée">
          <button type="button" className="time-preset" aria-pressed={draft.scope === 'user'} onClick={() => set({ scope: 'user' })}>
            Tous tes projets
          </button>
          <button type="button" className="time-preset" aria-pressed={draft.scope === 'local'} onClick={() => set({ scope: 'local' })}>
            {home(board.cwd)} seulement
          </button>
        </div>
      </div>

      {draft.transport !== 'stdio' && (
        <label>
          En-têtes
          <textarea
            className="job-input"
            rows={2}
            value={draft.headers}
            spellCheck={false}
            placeholder="Authorization: Bearer …"
            onChange={event => set({ headers: event.target.value })}
          />
        </label>
      )}

      <label>
        Variables d’environnement
        <textarea
          className="job-input"
          rows={2}
          value={draft.env}
          spellCheck={false}
          placeholder="API_KEY=…"
          onChange={event => set({ env: event.target.value })}
        />
      </label>

      {problem && (
        <p className="job-problem" role="alert">
          {problem}
        </p>
      )}

      <footer>
        <button
          type="button"
          className="pill glass small"
          onClick={() => {
            settled.current = true
            onClose()
          }}
        >
          Annuler
        </button>
        <button type="submit" className="pill solid small" disabled={saving}>
          {saving ? 'Ajout…' : 'Ajouter le MCP'}
        </button>
      </footer>
    </DialogForm>
  )
}

function McpRow({
  server,
  cwd,
  onToast,
}: {
  server: McpEntry
  cwd: string
  onToast(message: string, kind?: 'error'): void
}) {
  const [busy, setBusy] = useState<'reconnect' | 'remove' | null>(null)
  const [confirming, setConfirming] = useState(false)
  // Escape disarms before anything else closes
  useLayer(confirming, () => setConfirming(false))
  const canRemove = removable(server)

  const reconnect = async () => {
    setBusy('reconnect')
    try {
      const next = await window.flux.reconnectMcp(server.name)
      onToast(`${mcpLabel(server.name)} : ${HEALTH_LABEL[next.status]}`, next.status === 'ok' ? undefined : 'error')
    } catch (error) {
      onToast((error as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setBusy('remove')
    try {
      await window.flux.removeMcp(server.name)
      onToast(`${mcpLabel(server.name)} retiré`)
    } catch (error) {
      onToast((error as Error).message, 'error')
      setBusy(null)
      setConfirming(false)
    }
  }

  return (
    <li className={`check-row mcp-row ${server.status}`}>
      <HealthIcon status={server.status} busy={busy !== null} />
      <div className="check-main mcp-main">
        <span className="check-title">
          {mcpLabel(server.name)}
          <span className={`mcp-health ${server.status}`}>{HEALTH_LABEL[server.status]}</span>
        </span>
        <span className="check-meta" title={server.target}>
          {metaOf(server, cwd)}
        </span>
        {server.detail && <span className="check-meta mcp-detail">{server.detail}</span>}
      </div>
      <div className="mcp-actions">
        <button
          type="button"
          className="round small glass"
          aria-label={server.status === 'auth' ? `Connecter ${server.name}` : `Reconnecter ${server.name}`}
          title={server.status === 'auth' ? 'Se connecter (ouvre le navigateur)' : 'Reconnecter'}
          disabled={busy !== null}
          onClick={() => void reconnect()}
        >
          {server.status === 'auth' ? <KeyRound size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
        </button>
        {canRemove ? (
          <button
            type="button"
            className={`pill small job-delete${confirming ? ' armed' : ' glass'}`}
            aria-label={confirming ? `Confirmer le retrait de ${server.name}` : `Retirer ${server.name}`}
            title={confirming ? undefined : 'Retirer'}
            disabled={busy !== null}
            onClick={() => void remove()}
            onBlur={() => setConfirming(false)}
          >
            <Trash2 size={14} aria-hidden="true" />
            {confirming ? `Retirer « ${server.name} »` : null}
          </button>
        ) : (
          <span
            className="round small mcp-locked"
            title={server.scope === 'plugin' ? 'Vient d’un plugin : retire le plugin pour le retirer' : 'Se gère sur claude.ai'}
          >
            <Trash2 size={14} aria-hidden="true" />
          </span>
        )}
      </div>
    </li>
  )
}

export function McpPanel({
  board,
  onToast,
}: {
  board: McpBoard | null
  onToast(message: string, kind?: 'error'): void
}) {
  const [adding, setAdding] = useState(false)
  if (!board) return <p className="skill-empty">Lecture des MCP…</p>
  const configured = board.servers.filter(server => server.scope !== 'claude.ai')
  const connectors = board.servers.filter(server => server.scope === 'claude.ai')
  const check = () => void window.flux.checkMcpServers().catch(error => onToast((error as Error).message, 'error'))

  return (
    <section className="mcps">
      <div className="claude-toolbar">
        <small>
          {board.checking ? (
            <>
              <LoaderCircle size={12} className="spin" aria-hidden="true" /> Claude vérifie chaque serveur…
            </>
          ) : board.checkedAt ? (
            `Vérifiés il y a ${waitingFor(board.checkedAt)} par claude mcp list`
          ) : (
            'Pas encore vérifiés'
          )}
          {board.error && !board.checking && <span className="mcp-detail"> · {board.error}</span>}
        </small>
        <div className="daily-actions">
          <button type="button" className="pill glass small" disabled={board.checking} onClick={check}>
            <RefreshCw size={13} className={board.checking ? 'spin' : undefined} aria-hidden="true" />
            Tout vérifier
          </button>
          <button type="button" className="pill solid small" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden="true" />
            Ajouter un MCP
          </button>
        </div>
      </div>

      {board.servers.length === 0 && (
        <p className="skill-empty">{board.checking ? 'Claude liste ses serveurs…' : 'Aucun serveur MCP déclaré dans Claude Code.'}</p>
      )}
      {configured.length > 0 && (
        <ul className="checklist">
          {configured.map(server => (
            <McpRow key={server.name} server={server} cwd={board.cwd} onToast={onToast} />
          ))}
        </ul>
      )}
      {connectors.length > 0 && (
        <>
          <h3 className="claude-subhead">Connecteurs claude.ai</h3>
          <ul className="checklist">
            {connectors.map(server => (
              <McpRow key={server.name} server={server} cwd={board.cwd} onToast={onToast} />
            ))}
          </ul>
        </>
      )}

      {adding && (
        <McpEditor
          board={board}
          onClose={() => setAdding(false)}
          onAdded={name => {
            setAdding(false)
            onToast(`${name} ajouté : Claude le vérifie`)
          }}
        />
      )}
    </section>
  )
}
