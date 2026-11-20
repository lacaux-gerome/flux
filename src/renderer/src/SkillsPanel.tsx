import { ArrowLeft, BadgeCheck, LoaderCircle, Lock, PenLine, Puzzle, Search, Sparkles, SquareSlash, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { SkillBoard, SkillDetail, SkillEntry, SkillSource } from '../../shared/claude'
import { skillGraph } from '../../shared/skillGraph'
import { ConfirmDialog } from './ConfirmDialog'
import { waitingFor } from './format'
import { Prose } from './Markdown'
import { CallIcon, SkillGraph } from './SkillGraph'
import { readMark, saveMark } from './storage'

// While a skill is open, Flux looks again now and then for the edits made in Claude
const DETAIL_POLL_MS = 4000

const SOURCE_LABEL: Record<SkillSource, string> = {
  skill: 'Skill',
  command: 'Commande',
  plugin: 'Plugin',
}

function SourceIcon({ source }: { source: SkillSource }) {
  if (source === 'plugin') return <Puzzle size={16} className="skill-icon" aria-label="Skill de plugin" />
  if (source === 'command') return <SquareSlash size={16} className="skill-icon" aria-label="Commande" />
  return <Sparkles size={16} className="skill-icon" aria-label="Skill" />
}

function lastUse(skill: SkillEntry): string {
  if (!skill.lastUsedAt) return 'jamais lancé'
  const ago = waitingFor(skill.lastUsedAt)
  return ago === '0 j' ? 'aujourd’hui' : `il y a ${ago}`
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

// Yours live in ~/.claude/skills and ~/.claude/commands; the others come with a plugin
type Owner = 'all' | 'mine' | 'plugin'

const OWNERS: Array<{ key: Owner; label: string; hint?: string }> = [
  { key: 'all', label: 'Tous' },
  { key: 'mine', label: 'Mes skills', hint: 'Dans ~/.claude/skills et ~/.claude/commands' },
  { key: 'plugin', label: 'Plugins', hint: 'Venus avec un plugin' },
]

const OWNER_KEY = 'flux.skillOwner'

const ownedBy = (skill: SkillEntry, owner: Owner) =>
  owner === 'all' || (owner === 'plugin') === (skill.source === 'plugin')

function storedOwner(): Owner {
  const owner = readMark(OWNER_KEY)
  return owner === 'mine' || owner === 'plugin' ? owner : 'all'
}

// 'draft' is the file as Claude loads it; a number is a validated version
type Pick = 'draft' | number

function SkillDetailView({
  id,
  onBack,
  onRemoved,
  onToast,
}: {
  id: string
  onBack(): void
  onRemoved(): void
  onToast(message: string, kind?: 'error'): void
}) {
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [pick, setPick] = useState<Pick | null>(null)
  const [frozen, setFrozen] = useState<Record<number, string>>({})
  const [view, setView] = useState<'graph' | 'text'>('graph')
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    let alive = true
    const load = () =>
      window.flux
        .skillDetail(id)
        .then(next => alive && setDetail(next))
        .catch(error => alive && onToast((error as Error).message, 'error'))
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, DETAIL_POLL_MS)
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [id])

  const current = detail?.versions.at(-1)?.n ?? null
  // What shows when nothing is picked: the draft if there is one, else the current version
  const shown: Pick = pick ?? (detail?.draft || current === null ? 'draft' : current)
  // The file Claude loads: the draft, or the current version when nothing changed since
  const live = shown === 'draft' || (shown === current && !detail?.draft)
  const content = live ? (detail?.content ?? null) : (frozen[shown as number] ?? null)

  useEffect(() => {
    if (live || typeof shown !== 'number' || frozen[shown] !== undefined) return
    void window.flux
      .skillVersion(id, shown)
      .then(text => setFrozen(known => ({ ...known, [shown]: text })))
      .catch(error => onToast((error as Error).message, 'error'))
  }, [id, shown, live])

  const name = detail?.skill.name
  const graph = useMemo(() => (content === null ? null : skillGraph(content, name)), [content, name])

  if (!detail) {
    return (
      <section className="skill-detail">
        <button type="button" className="pill glass small" onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
          Skills
        </button>
        <p className="skill-empty">Lecture du skill…</p>
      </section>
    )
  }

  const { skill } = detail
  const readOnly = !skill.editable || !live
  const validate = async () => {
    setBusy(true)
    try {
      const next = await window.flux.validateSkill(skill.id)
      setDetail(next)
      setPick(null)
      onToast(`/${skill.name} : v${next.versions.at(-1)?.n} validée`)
    } catch (error) {
      onToast((error as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const edit = () =>
    void window.flux
      .editSkill(skill.id)
      .then(() => onToast('Session ouverte dans Claude'))
      .catch(error => onToast((error as Error).message, 'error'))
  // A skill is its folder, a command its file
  const trashed = skill.source === 'skill' ? skill.file.replace(/\/SKILL\.md$/, '') : skill.file
  const remove = async () => {
    setBusy(true)
    try {
      await window.flux.removeSkill(skill.id)
      onToast(`/${skill.name} mis à la corbeille`)
      onRemoved()
    } catch (error) {
      onToast((error as Error).message, 'error')
      setBusy(false)
      setRemoving(false)
    }
  }

  return (
    <section className="skill-detail">
      <div className="skill-detail-bar">
        <div className="skill-actions">
          <button type="button" className="pill glass small" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden="true" />
            Skills
          </button>
          <nav className="tabs glass day-tabs skill-views" aria-label="Vue du skill">
            <button type="button" aria-current={view === 'graph' ? 'page' : undefined} onClick={() => setView('graph')}>
              Graphe
            </button>
            <button type="button" aria-current={view === 'text' ? 'page' : undefined} onClick={() => setView('text')}>
              Contenu
            </button>
          </nav>
        </div>
        <div className="skill-actions">
          {skill.editable && (
            <label className="skill-version">
              <span>Version</span>
              <select
                value={String(shown)}
                onChange={event => setPick(event.target.value === 'draft' ? 'draft' : Number(event.target.value))}
              >
                {detail.draft && <option value="draft">Brouillon · non validé</option>}
                {[...detail.versions].reverse().map(version => (
                  <option key={version.n} value={version.n}>
                    v{version.n} · {day(version.at)}
                    {version.n === current ? (detail.draft ? ' · validée' : ' · actuelle') : ' · lecture seule'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {skill.editable && (
            <button type="button" className="pill glass small" onClick={edit} title="Ouvre une session Claude Desktop sur ce skill">
              <PenLine size={14} aria-hidden="true" />
              Éditer dans Claude
            </button>
          )}
          {skill.editable && detail.draft && (
            <button type="button" className="pill solid small" disabled={busy} onClick={() => void validate()}>
              <BadgeCheck size={14} aria-hidden="true" />
              Valider la v{(current ?? 0) + 1}
            </button>
          )}
          {skill.editable && (
            <button
              type="button"
              className="round small glass skill-remove"
              aria-label="Supprimer le skill"
              title="Supprimer le skill"
              disabled={busy}
              onClick={() => setRemoving(true)}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          title={`Supprimer /${skill.name} ?`}
          action="Mettre à la corbeille"
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(false)}
        >
          <p>
            {skill.source === 'skill' ? 'Son dossier part' : 'Son fichier part'} à la corbeille du Mac, d’où tu peux le
            récupérer. Claude Code ne le chargera plus.
          </p>
          <code>{trashed}</code>
        </ConfirmDialog>
      )}

      <header className="skill-head">
        <h2>
          <SourceIcon source={skill.source} />/{skill.name}
        </h2>
        <p>{skill.description}</p>
        <p className="skill-facts">
          {SOURCE_LABEL[skill.source]}
          {skill.plugin ? ` · ${skill.plugin}` : ''} · {lastUse(skill)}
          {skill.uses > 0 ? ` · ${skill.uses} lancement${skill.uses > 1 ? 's' : ''}` : ''}
          {readOnly && (
            <span className="skill-lock">
              <Lock size={12} aria-hidden="true" />
              {!skill.editable
                ? 'mis à jour avec son plugin'
                : shown === current
                  ? 'dernière version validée, le fichier a changé depuis'
                  : 'version précédente, lecture seule'}
            </span>
          )}
          {!readOnly && shown === 'draft' && detail.draft && <span className="skill-draft">brouillon à valider</span>}
        </p>
        {graph && graph.calls.length > 0 && (
          <ul className="skill-calls" aria-label="Appels extérieurs">
            {graph.calls.map(call => (
              <li key={`${call.kind}:${call.label}`} className={`skill-call ${call.kind}`} title={call.details.join('\n')}>
                <CallIcon kind={call.kind} size={12} />
                {call.label}
              </li>
            ))}
          </ul>
        )}
      </header>

      {content === null || !graph ? (
        <p className="skill-empty">Lecture de la version…</p>
      ) : view === 'graph' ? (
        <SkillGraph key={`${skill.id}:${shown}`} name={skill.name} graph={graph} />
      ) : (
        <Prose source={content.replace(/^---\n[\s\S]*?\n---\n?/, '')} className="prose skill-prose" />
      )}
      <small className="skill-path">{skill.file}</small>
    </section>
  )
}

export function SkillsPanel({
  board,
  openId,
  onOpen,
  onRemoved,
  onToast,
}: {
  board: SkillBoard | null
  openId: string | null
  onOpen(id: string | null): void
  onRemoved(id: string): void
  onToast(message: string, kind?: 'error'): void
}) {
  const [query, setQuery] = useState('')
  const [owner, setOwner] = useState<Owner>(storedOwner)
  if (openId) {
    return (
      <SkillDetailView
        key={openId}
        id={openId}
        onBack={() => onOpen(null)}
        onRemoved={() => onRemoved(openId)}
        onToast={onToast}
      />
    )
  }
  if (!board) return <p className="skill-empty">Lecture des skills…</p>

  const needle = query.trim().toLowerCase()
  const owned = board.skills.filter(skill => ownedBy(skill, owner))
  const shown = needle
    ? owned.filter(skill => `${skill.name} ${skill.description}`.toLowerCase().includes(needle))
    : owned

  return (
    <section className="skills">
      <div className="claude-toolbar">
        <label className="skill-search glass">
          <Search size={14} aria-hidden="true" />
          <input
            value={query}
            placeholder="Chercher un skill"
            aria-label="Chercher un skill"
            spellCheck={false}
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <div className="skill-owners" role="group" aria-label="Provenance des skills">
          {OWNERS.map(entry => (
            <button
              type="button"
              key={entry.key}
              title={entry.hint}
              aria-pressed={owner === entry.key}
              onClick={() => {
                setOwner(entry.key)
                saveMark(OWNER_KEY, entry.key)
              }}
            >
              {entry.label}
              <span className="count">{board.skills.filter(skill => ownedBy(skill, entry.key)).length}</span>
            </button>
          ))}
        </div>
        {board.scanning && (
          <small className="skill-scan">
            <LoaderCircle size={12} className="spin" aria-hidden="true" /> lecture des transcripts
          </small>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="skill-empty">Aucun skill ne correspond.</p>
      ) : (
        <ul className="checklist">
          {shown.map(skill => (
            <li key={skill.id} className="check-row skill-row">
              <SourceIcon source={skill.source} />
              <button type="button" className="check-main" onClick={() => onOpen(skill.id)}>
                <span className="check-title">
                  <span className="check-ref">/{skill.name}</span>
                </span>
                <span className="check-meta">{skill.description || SOURCE_LABEL[skill.source]}</span>
              </button>
              <span className="check-side" title={skill.lastUsedAt ? new Date(skill.lastUsedAt).toLocaleString('fr-FR') : undefined}>
                {lastUse(skill)}
                {skill.uses > 0 ? ` · ${skill.uses}×` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
