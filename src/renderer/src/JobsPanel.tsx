import {
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleX,
  ExternalLink,
  FolderOpen,
  ListChecks,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import {
  describeSchedule,
  draftProblem,
  mcpLabel,
  parseTime,
  serversFor,
  WEEK_ORDER,
  WEEKDAYS,
  whenLabel,
  type DailyTask,
  type JobBoard,
  type JobDraft,
  type JobRepeat,
  type JobRun,
  type JobView,
  type WrapupTask,
  type McpServer,
} from '../../shared/jobs'
import type { DailySheet } from '../../shared/types'
import { waitingFor } from './format'
import { SkillPicker } from './SkillPicker'
import { readMark, saveMark } from './storage'
import { DialogForm } from './Dialog'
import { useLayer } from './layers'
import { TimePicker } from './TimePicker'

const DAY_LETTER = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
const DAY_NAME = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']
const MINUTES = [0, 15, 30, 45]
const REPEATS: Array<{ key: JobRepeat; label: string }> = [
  { key: 'daily', label: 'Certains jours' },
  { key: 'hourly', label: 'Toutes les heures' },
  { key: 'manual', label: 'À la demande' },
]
const MCP_STATUS: Record<McpServer['status'] | 'gone', string> = {
  ok: 'connecté',
  auth: 'à connecter',
  failed: 'injoignable',
  gone: 'plus déclaré',
}

const pad = (value: number) => String(value).padStart(2, '0')
const running = (view: JobView) => view.runs[0]?.status === 'running'

function blank(cwd: string): JobDraft {
  return {
    name: '',
    enabled: true,
    schedule: { repeat: 'daily', days: WEEKDAYS, time: '09:00' },
    skill: null,
    prompt: '',
    mcps: [],
    cwd,
    permission: 'auto',
  }
}

function jobDraftOf(view: JobView): JobDraft {
  const { id: _id, createdAt: _createdAt, ...draft } = view.job
  return draft
}

interface EditorState {
  form: JobDraft
  mode: 'prompt' | 'skill'
  skill: string
}

// What the form held when it was left, until the task is saved or the draft dropped
interface KeptDraft extends EditorState {
  auto: string[]
  at: string
}

const draftKey = (id: string | null) => `flux.jobDraft.${id ?? 'new'}`

function keptDraft(key: string): KeptDraft | null {
  const raw = readMark(key)
  if (!raw) return null
  try {
    const kept = JSON.parse(raw) as KeptDraft
    return kept.form && typeof kept.at === 'string' ? kept : null
  } catch {
    return null
  }
}

function RunIcon({ run, paused }: { run: JobRun | undefined; paused?: boolean }) {
  if (run?.status === 'running') return <LoaderCircle size={16} className="job-icon spin" aria-label="En cours" />
  if (paused) return <CirclePause size={16} className="job-icon" aria-label="En pause" />
  if (run?.status === 'ok') return <CircleCheck size={16} className="job-icon ok" aria-label="Dernière exécution réussie" />
  if (run?.status === 'failed') return <CircleX size={16} className="job-icon fail" aria-label="Dernière exécution en échec" />
  return <CircleDashed size={16} className="job-icon" aria-label={run ? 'Interrompue' : 'Jamais lancé'} />
}

function sideOf(view: JobView, now: Date): string {
  if (running(view)) return 'En cours…'
  if (!view.job.enabled) return 'En pause'
  if (view.next) return whenLabel(new Date(view.next), now)
  return 'À la demande'
}

function metaOf(view: JobView): string {
  const count = view.job.mcps.length
  const parts = [describeSchedule(view.job.schedule), count === 0 ? 'sans MCP' : `${count} MCP`]
  const last = view.runs[0]
  if (last?.status === 'failed' && last.summary) parts.push(`Échec : ${last.summary}`)
  return parts.join(' · ')
}

function subtitle(board: JobBoard | null, now: Date): string {
  if (!board) return 'Lecture des tâches…'
  // The daily and the wrap-up count: they are tasks too, only Flux's own
  const total = board.jobs.length + (board.daily ? 1 : 0) + (board.wrapup.times.length > 0 ? 1 : 0)
  if (total === 0) return 'Aucune tâche pour l’instant.'
  const count = `${total} tâche${total > 1 ? 's' : ''}`
  const next = [
    ...board.jobs.flatMap(view => (view.next ? [{ name: view.job.name, at: view.next }] : [])),
    ...(board.daily?.next ? [{ name: 'Daily', at: board.daily.next }] : []),
    ...(board.wrapup.next ? [{ name: 'Wrap-up', at: board.wrapup.next }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at))[0]
  if (!next) return count
  const at = new Date(next.at)
  return `${count} · prochain : ${next.name}, ${at <= now ? 'dû maintenant' : whenLabel(at, now)}`
}

function duration(run: JobRun): string {
  if (!run.endedAt) return ''
  const minutes = Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 60_000)
  return minutes < 1 ? 'moins d’une minute' : `${minutes} min`
}

function Runs({ runs, now }: { runs: JobRun[]; now: Date }) {
  if (runs.length === 0) return <small>Pas encore lancé.</small>
  return (
    <ul className="job-runs">
      {runs.map(run => (
        <li key={run.session} className="job-run">
          <RunIcon run={run} />
          <div className="job-run-main">
            <span className="job-run-when">
              {whenLabel(new Date(run.startedAt), now)}
              {run.trigger === 'manual' ? ' · à la main' : ''}
              {run.status === 'interrupted' ? ' · interrompu' : run.endedAt ? ` · ${duration(run)}` : ''}
            </span>
            {run.summary && <span className="job-run-summary">{run.summary}</span>}
          </div>
          <button
            type="button"
            className="round small glass"
            aria-label="Ouvrir dans Claude"
            title="Ouvrir dans Claude"
            onClick={() => void window.flux.openJobRun(run.session)}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function JobEditor({
  board,
  view,
  onClose,
  onSaved,
  onError,
}: {
  board: JobBoard
  view: JobView | null
  onClose(): void
  onSaved(message: string): void
  onError(message: string): void
}) {
  const key = draftKey(view?.job.id ?? null)
  const [start] = useState(() => {
    const initial: EditorState = view
      ? { form: jobDraftOf(view), mode: view.job.skill ? 'skill' : 'prompt', skill: view.job.skill ?? '' }
      : { form: blank(board.defaultCwd), mode: 'prompt', skill: '' }
    return { initial, kept: keptDraft(key) }
  })
  const [form, setForm] = useState<JobDraft>(start.kept?.form ?? start.initial.form)
  const [mode, setMode] = useState<'prompt' | 'skill'>(start.kept?.mode ?? start.initial.mode)
  const [skill, setSkill] = useState(start.kept?.skill ?? start.initial.skill)
  // The servers ticked for the chosen skill, not by hand: another skill takes them back
  const [auto, setAuto] = useState<string[]>(start.kept?.auto ?? [])
  const [keptAt, setKeptAt] = useState(start.kept?.at ?? null)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Escape disarms before it closes the editor
  useLayer(confirming, () => setConfirming(false))
  const nameField = useRef<HTMLInputElement>(null)
  const now = new Date()
  const draft: JobDraft = { ...form, skill: mode === 'skill' ? skill : null }
  const snapshot = JSON.stringify({ form, mode, skill })
  const dirty = snapshot !== JSON.stringify(start.initial)
  const set = (patch: Partial<JobDraft>) => {
    setForm(current => ({ ...current, ...patch }))
    setProblem(null)
  }
  const setSchedule = (patch: Partial<JobDraft['schedule']>) => set({ schedule: { ...form.schedule, ...patch } })
  const chosenSkill = board.skills.find(entry => entry.name === skill.replace(/^\//, ''))

  // Every change is kept until the task is saved or the draft dropped: closing loses nothing
  useEffect(() => {
    const kept: KeptDraft = { form, mode, skill, auto, at: new Date().toISOString() }
    saveMark(key, dirty ? JSON.stringify(kept) : null)
  }, [snapshot, auto])

  const pickSkill = (next: string) => {
    setSkill(next)
    setProblem(null)
    const found = board.skills.find(entry => entry.name === next.trim().replace(/^\//, ''))
    const kept = form.mcps.filter(name => !auto.includes(name))
    const wanted = found ? serversFor(found.services, board.mcps).filter(name => !kept.includes(name)) : []
    setForm(current => ({ ...current, mcps: [...kept, ...wanted] }))
    setAuto(wanted)
  }

  const drop = () => {
    saveMark(key, null)
    setForm(start.initial.form)
    setMode(start.initial.mode)
    setSkill(start.initial.skill)
    setAuto([])
    setKeptAt(null)
    setProblem(null)
  }

  const cancel = () => {
    saveMark(key, null)
    onClose()
  }
  // A server the job names but Claude no longer declares stays listed, to be unticked
  const servers: Array<{ name: string; status: McpServer['status'] | 'gone' }> = [
    ...board.mcps,
    ...form.mcps.filter(name => !board.mcps.some(server => server.name === name)).map(name => ({ name, status: 'gone' as const })),
  ]
  const live = view ? board.jobs.find(entry => entry.job.id === view.job.id) ?? view : null

  useEffect(() => {
    if (!view) nameField.current?.focus()
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const missing = draftProblem(draft)
    if (missing) {
      setProblem(missing)
      return
    }
    setSaving(true)
    try {
      await window.flux.saveJob(view?.job.id ?? null, draft)
      saveMark(key, null)
      onSaved(view ? 'Tâche enregistrée' : 'Tâche créée')
    } catch (error) {
      setProblem((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!view) return
    if (!confirming) {
      setConfirming(true)
      return
    }
    try {
      await window.flux.removeJob(view.job.id)
      saveMark(key, null)
      onSaved(`${view.job.name} supprimé`)
    } catch (error) {
      onError((error as Error).message)
    }
  }

  return (
    <DialogForm className="job-editor" label={view ? `Modifier ${view.job.name}` : 'Nouvelle tâche'} onClose={onClose} onSubmit={event => void submit(event)}>
      <header>
        <h1>{view ? view.job.name : 'Nouvelle tâche'}</h1>
        <div className="job-editor-head">
          <label className="job-switch" title={form.enabled ? 'Mettre en pause' : 'Réactiver'}>
            <input
              type="checkbox"
              role="switch"
              checked={form.enabled}
              onChange={event => set({ enabled: event.target.checked })}
            />
            {form.enabled ? 'Actif' : 'En pause'}
          </label>
          <button type="button" className="round glass small" aria-label="Fermer" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      {keptAt && dirty && (
        <p className="job-kept" role="status">
          Brouillon repris, laissé il y a {waitingFor(keptAt)}.
          <button type="button" onClick={drop}>
            Effacer
          </button>
        </p>
      )}

      <label>
        Nom
        <input
          ref={nameField}
          className="job-input"
          value={form.name}
          placeholder="Revue du matin"
          onChange={event => set({ name: event.target.value })}
        />
      </label>

      <div className="field">
        <span>Action</span>
        <div className="job-choice" role="group" aria-label="Action">
          <button type="button" className="time-preset" aria-pressed={mode === 'prompt'} onClick={() => setMode('prompt')}>
            Un prompt
          </button>
          <button type="button" className="time-preset" aria-pressed={mode === 'skill'} onClick={() => setMode('skill')}>
            Une skill
          </button>
        </div>
        {mode === 'skill' && (
          <>
            <SkillPicker value={skill} skills={board.skills} onChange={pickSkill} />
            {chosenSkill?.description && <small>{chosenSkill.description}</small>}
          </>
        )}
        <textarea
          className="job-input"
          rows={mode === 'skill' ? 2 : 5}
          value={form.prompt}
          aria-label={mode === 'skill' ? 'Arguments de la skill' : 'Prompt'}
          placeholder={
            mode === 'skill' ? 'Arguments, si la skill en prend' : 'Fais le point sur mes PR ouvertes et poste-le dans Slack…'
          }
          onChange={event => set({ prompt: event.target.value })}
        />
        <small>Chaque exécution part de zéro : le prompt doit se suffire à lui-même.</small>
      </div>

      <div className="field">
        <span>Récurrence</span>
        <div className="job-choice three" role="group" aria-label="Récurrence">
          {REPEATS.map(entry => (
            <button
              type="button"
              key={entry.key}
              className="time-preset"
              aria-pressed={form.schedule.repeat === entry.key}
              onClick={() => setSchedule({ repeat: entry.key })}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {form.schedule.repeat === 'daily' && (
          <div className="job-when">
            <div className="job-days" role="group" aria-label="Jours">
              {WEEK_ORDER.map(day => (
                <button
                  type="button"
                  key={day}
                  className="time-preset"
                  title={DAY_NAME[day]}
                  aria-label={DAY_NAME[day]}
                  aria-pressed={form.schedule.days.includes(day)}
                  onClick={() =>
                    setSchedule({
                      days: form.schedule.days.includes(day)
                        ? form.schedule.days.filter(entry => entry !== day)
                        : [...form.schedule.days, day],
                    })
                  }
                >
                  {DAY_LETTER[day]}
                </button>
              ))}
            </div>
            <TimePicker value={form.schedule.time} onChange={time => setSchedule({ time })} />
          </div>
        )}
        {form.schedule.repeat === 'hourly' && (
          <div className="job-choice four" role="group" aria-label="Minute">
            {MINUTES.map(minute => (
              <button
                type="button"
                key={minute}
                className="time-preset"
                aria-pressed={parseTime(form.schedule.time)[1] === minute}
                onClick={() => setSchedule({ time: `00:${pad(minute)}` })}
              >
                :{pad(minute)}
              </button>
            ))}
          </div>
        )}
        <small>
          {form.schedule.repeat === 'manual'
            ? 'Seulement quand tu le lances, d’ici ou de la liste.'
            : `${describeSchedule(form.schedule)}. Flux doit être ouvert ; un passage manqué de moins de 12 h part à l’ouverture.`}
        </small>
      </div>

      <div className="field">
        <span className="job-field-head">
          MCP autorisés
          <button
            type="button"
            className="round glass small"
            aria-label="Relire les MCP"
            title="Relire les MCP"
            disabled={board.mcpsLoading}
            onClick={() => void window.flux.refreshMcps().catch(error => onError((error as Error).message))}
          >
            <RefreshCw size={13} className={board.mcpsLoading ? 'spin' : undefined} aria-hidden="true" />
          </button>
        </span>
        {servers.length === 0 ? (
          <small>{board.mcpsLoading ? 'Lecture des MCP de Claude…' : 'Aucun MCP déclaré dans Claude.'}</small>
        ) : (
          <div className="job-mcps" role="group" aria-label="MCP autorisés">
            {servers.map(server => (
              <button
                type="button"
                key={server.name}
                className={`job-mcp ${server.status}`}
                aria-pressed={form.mcps.includes(server.name)}
                title={`${server.name} · ${MCP_STATUS[server.status]}`}
                onClick={() => {
                  set({
                    mcps: form.mcps.includes(server.name)
                      ? form.mcps.filter(name => name !== server.name)
                      : [...form.mcps, server.name],
                  })
                  setAuto(current => current.filter(name => name !== server.name))
                }}
              >
                <span className="job-mcp-dot" aria-hidden="true" />
                {mcpLabel(server.name)}
              </button>
            ))}
          </div>
        )}
        <small>
          {form.mcps.length === 0
            ? 'Aucun coché : la tâche tourne sans MCP.'
            : mode === 'skill' && auto.length > 0
              ? `${auto.map(mcpLabel).join(', ')} : coché${auto.length > 1 ? 's' : ''} parce que /${skill.trim().replace(/^\//, '')} s’en sert. Les MCP non cochés sont refusés.`
              : 'La tâche n’a accès qu’aux MCP cochés, les autres lui sont refusés.'}
        </small>
      </div>

      <div className="settings-row job-row-fields">
        <div className="field">
          <span>Dossier</span>
          <div className="job-folder">
            <input
              className="job-input"
              value={form.cwd}
              spellCheck={false}
              aria-label="Dossier"
              onChange={event => set({ cwd: event.target.value })}
            />
            <button
              type="button"
              className="round glass small"
              aria-label="Choisir le dossier"
              title="Choisir le dossier"
              onClick={() =>
                void window.flux.pickFolder(form.cwd).then(folder => folder && set({ cwd: folder }))
              }
            >
              <FolderOpen size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="field">
          <span>Permissions</span>
          <div className="job-choice" role="group" aria-label="Permissions">
            <button
              type="button"
              className="time-preset"
              aria-pressed={form.permission === 'auto'}
              title="Le mode auto de Claude juge chaque action"
              onClick={() => set({ permission: 'auto' })}
            >
              Auto
            </button>
            <button
              type="button"
              className="time-preset"
              aria-pressed={form.permission === 'strict'}
              title="Seulement ce que tes réglages Claude autorisent déjà"
              onClick={() => set({ permission: 'strict' })}
            >
              Strict
            </button>
          </div>
        </div>
      </div>

      {live && (
        <section className="field job-history">
          <span className="job-field-head">
            Dernières exécutions
            <button
              type="button"
              className="pill glass small"
              disabled={running(live)}
              onClick={() =>
                void window.flux.runJob(live.job.id).catch(error => onError((error as Error).message))
              }
            >
              <Play size={13} aria-hidden="true" />
              Lancer maintenant
            </button>
          </span>
          <Runs runs={live.runs} now={now} />
        </section>
      )}

      {problem && (
        <p className="job-problem" role="alert">
          {problem}
        </p>
      )}

      <footer>
        {view && (
          <button
            type="button"
            className={`pill small job-delete${confirming ? ' armed' : ' glass'}`}
            onClick={() => void remove()}
            onBlur={() => setConfirming(false)}
          >
            <Trash2 size={14} aria-hidden="true" />
            {confirming ? `Supprimer « ${view.job.name} »` : 'Supprimer'}
          </button>
        )}
        <button type="button" className="pill glass small" onClick={cancel}>
          Annuler
        </button>
        <button type="submit" className="pill solid small" disabled={saving}>
          {view ? 'Enregistrer' : 'Créer la tâche'}
        </button>
      </footer>
    </DialogForm>
  )
}

function DailyRow({
  task,
  sheet,
  now,
  onOpenSkill,
  onOpenDay,
  onToast,
}: {
  task: DailyTask
  sheet: DailySheet
  now: Date
  onOpenSkill(name: string): void
  onOpenDay(): void
  onToast(message: string, kind?: 'error'): void
}) {
  const [editing, setEditing] = useState(false)
  const running = sheet.status === 'running'
  const wroteToday = task.runs[0]?.date === sheet.date
  const icon = running ? (
    <LoaderCircle size={16} className="job-icon spin" aria-label="En cours" />
  ) : sheet.status === 'error' ? (
    <CircleX size={16} className="job-icon fail" aria-label="Dernière exécution en échec" />
  ) : wroteToday ? (
    <CircleCheck size={16} className="job-icon ok" aria-label="Écrit aujourd’hui" />
  ) : (
    <CircleDashed size={16} className="job-icon" aria-label="Pas encore écrit aujourd’hui" />
  )
  const schedule = describeSchedule({ repeat: 'daily', days: WEEKDAYS, time: task.time })
  const meta = !task.exists
    ? `Commande introuvable : ${task.file}`
    : sheet.status === 'error' && sheet.error
      ? `${schedule} · Échec : ${sheet.error}`
      : `${schedule} · lancé par Flux, en lecture seule`
  const side = running
    ? 'En cours…'
    : task.next && Date.parse(task.next) <= now.getTime() + 60_000
      ? 'dû, au prochain rafraîchissement'
      : task.next
        ? whenLabel(new Date(task.next), now)
        : ''
  const run = () => void window.flux.runDaily().catch(error => onToast((error as Error).message, 'error'))

  return (
    <li className="check-row job-row daily-task">
      {icon}
      <button type="button" className="check-main" title="Régler le daily" onClick={() => setEditing(true)}>
        <span className="check-title">
          <span className="check-ref">/{task.skill}</span>
          Daily
          <span className="job-badge">Flux</span>
        </span>
        <span className="check-meta">{meta}</span>
      </button>
      <span className="check-side">{side}</span>
      <button
        type="button"
        className="round small glass"
        aria-label="Lancer le daily maintenant"
        title="Lancer maintenant"
        disabled={running || !task.exists}
        onClick={run}
      >
        <Play size={13} aria-hidden="true" />
      </button>
      {editing && (
        <DailyEditor
          task={task}
          now={now}
          onClose={() => setEditing(false)}
          onOpenSkill={() => {
            setEditing(false)
            onOpenSkill(task.skill)
          }}
          onOpenDay={() => {
            setEditing(false)
            onOpenDay()
          }}
          onToast={onToast}
        />
      )}
    </li>
  )
}

function DailyEditor({
  task,
  now,
  onClose,
  onOpenSkill,
  onOpenDay,
  onToast,
}: {
  task: DailyTask
  now: Date
  onClose(): void
  onOpenSkill(): void
  onOpenDay(): void
  onToast(message: string, kind?: 'error'): void
}) {
  const [time, setTime] = useState(task.time)
  const [saving, setSaving] = useState(false)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await window.flux.saveSettings({ dailyTime: time })
      onToast(`Daily à ${time}`)
      onClose()
    } catch (error) {
      onToast((error as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogForm className="job-editor" label="Daily" onClose={onClose} onSubmit={event => void save(event)}>
      <header>
        <h1>Daily</h1>
        <button type="button" className="round glass small" aria-label="Fermer" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <p className="job-note">
        Flux lance lui-même <code>/{task.skill}</code> chaque jour ouvré, en lecture seule, et affiche le résultat dans
        Journée. Ce n’est pas une tâche comme les autres : l’heure vit dans les réglages, la commande dans{' '}
        <code>paths.dailyCommand</code>.
      </p>
      <div className="field">
        <span>Heure</span>
        <div className="job-when">
          <TimePicker value={time} onChange={setTime} />
        </div>
        <small>Du lundi au vendredi. Flux doit être ouvert, et GitHub joignable.</small>
      </div>
      <section className="field job-history">
        <span className="job-field-head">Derniers daily</span>
        {task.runs.length === 0 ? (
          <small>Aucun encore.</small>
        ) : (
          <ul className="job-runs">
            {task.runs.map(entry => (
              <li key={entry.date} className="job-run">
                <CircleCheck size={16} className="job-icon ok" aria-hidden="true" />
                <div className="job-run-main">
                  <span className="job-run-when">
                    {entry.at ? whenLabel(new Date(entry.at), now) : entry.date}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <footer>
        <button type="button" className="pill glass small" onClick={onOpenSkill}>
          Voir le skill
        </button>
        <button type="button" className="pill glass small" onClick={onOpenDay}>
          Ouvrir Journée
        </button>
        <button type="submit" className="pill solid small" disabled={saving || time === task.time}>
          Enregistrer
        </button>
      </footer>
    </DialogForm>
  )
}

// 11:00, 14:30 et 16:30, as one says the reminders
function timeList(times: string[]): string {
  const clocks = times.map(time => time.replace(/^0(?=\d)/, ''))
  return clocks.length > 1 ? `${clocks.slice(0, -1).join(', ')} et ${clocks.at(-1)}` : (clocks[0] ?? '')
}

// A new reminder lands an hour after the last one
function nextTime(times: string[]): string {
  const last = [...times].sort().at(-1)
  if (!last) return '11:00'
  const hours = Math.min(Number(last.slice(0, 2)) + 1, 23)
  return `${String(hours).padStart(2, '0')}${last.slice(2)}`
}

function WrapupRow({
  task,
  now,
  onOpenWrapup,
  onToast,
}: {
  task: WrapupTask
  now: Date
  onOpenWrapup(): void
  onToast(message: string, kind?: 'error'): void
}) {
  const [editing, setEditing] = useState(false)
  const meta =
    task.times.length === 0
      ? 'Aucune relance pour l’instant'
      : `Du lundi au vendredi à ${timeList(task.times)} · notification de Flux`

  return (
    <li className="check-row job-row">
      <ListChecks size={16} className="job-icon" aria-hidden="true" />
      <button type="button" className="check-main" title="Régler les relances" onClick={() => setEditing(true)}>
        <span className="check-title">
          <span className="check-ref">flux_wrapup</span>
          Wrap-up
          <span className="job-badge">Flux</span>
        </span>
        <span className="check-meta">{meta}</span>
      </button>
      <span className="check-side">{task.next ? whenLabel(new Date(task.next), now) : ''}</span>
      <button
        type="button"
        className="round small glass"
        aria-label="Ouvrir le wrap-up"
        title="Ouvrir le wrap-up"
        onClick={onOpenWrapup}
      >
        <ExternalLink size={13} aria-hidden="true" />
      </button>
      {editing && (
        <WrapupEditor
          task={task}
          onClose={() => setEditing(false)}
          onOpenWrapup={() => {
            setEditing(false)
            onOpenWrapup()
          }}
          onToast={onToast}
        />
      )}
    </li>
  )
}

function WrapupEditor({
  task,
  onClose,
  onOpenWrapup,
  onToast,
}: {
  task: WrapupTask
  onClose(): void
  onOpenWrapup(): void
  onToast(message: string, kind?: 'error'): void
}) {
  const [times, setTimes] = useState(task.times)
  const [saving, setSaving] = useState(false)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await window.flux.saveSettings({ wrapupTimes: times })
      onToast(times.length === 0 ? 'Plus de relance du wrap-up' : `Wrap-up à ${timeList([...times].sort())}`)
      onClose()
    } catch (error) {
      onToast((error as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogForm className="job-editor" label="Wrap-up" onClose={onClose} onSubmit={event => void save(event)}>
      <header>
        <h1>Wrap-up</h1>
        <button type="button" className="round glass small" aria-label="Fermer" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <p className="job-note">
        Les jours ouvrés, une notification t’invite à cocher ce qui est fait et à choisir la suite. Pendant une
        réunion, elle attend la fin. Ce n’est pas une session Claude : Flux s’en charge seul.
      </p>
      <div className="field">
        <span>Relances</span>
        <div className="settings-times">
          {times.map((time, index) => (
            <span className="time-slot" key={index}>
              <TimePicker
                value={time}
                onChange={value => setTimes(times.map((entry, position) => (position === index ? value : entry)))}
              />
              <button
                type="button"
                className="round glass small"
                aria-label={`Retirer la relance de ${time}`}
                onClick={() => setTimes(times.filter((_, position) => position !== index))}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
          {times.length < 6 && (
            <button type="button" className="pill glass small" onClick={() => setTimes([...times, nextTime(times)])}>
              <Plus size={14} aria-hidden="true" />
              Ajouter
            </button>
          )}
        </div>
        <small>Du lundi au vendredi. Flux doit être ouvert.</small>
      </div>
      <footer>
        <button type="button" className="pill glass small" onClick={onOpenWrapup}>
          Ouvrir le wrap-up
        </button>
        <button
          type="submit"
          className="pill solid small"
          disabled={saving || times.join() === task.times.join()}
        >
          Enregistrer
        </button>
      </footer>
    </DialogForm>
  )
}

export function JobsPanel({
  board,
  daily,
  onOpenSkill,
  onOpenDay,
  onToast,
}: {
  board: JobBoard | null
  daily: DailySheet
  onOpenSkill(name: string): void
  onOpenDay(page: 'daily' | 'wrapup'): void
  onToast(message: string, kind?: 'error'): void
}) {
  // null: closed; 'new': a blank task; else the id of the task edited
  const [editing, setEditing] = useState<string | null>(null)
  const now = new Date()
  const edited = editing && editing !== 'new' ? board?.jobs.find(view => view.job.id === editing) ?? null : null
  const run = (id: string) => void window.flux.runJob(id).catch(error => onToast((error as Error).message, 'error'))

  return (
    <section className="jobs">
      <div className="claude-toolbar">
        <small>{subtitle(board, now)}</small>
        <div className="daily-actions">
          <button type="button" className="pill solid small" disabled={!board} onClick={() => setEditing('new')}>
            <Plus size={15} aria-hidden="true" />
            Nouvelle tâche
          </button>
        </div>
      </div>

      {board && (
        <ul className="checklist">
          {board.daily && (
            <DailyRow
              task={board.daily}
              sheet={daily}
              now={now}
              onOpenSkill={onOpenSkill}
              onOpenDay={() => onOpenDay('daily')}
              onToast={onToast}
            />
          )}
          <WrapupRow task={board.wrapup} now={now} onOpenWrapup={() => onOpenDay('wrapup')} onToast={onToast} />
          {board.jobs.map(view => (
            <li key={view.job.id} className={`check-row job-row${view.job.enabled ? '' : ' paused'}`}>
              <RunIcon run={view.runs[0]} paused={!view.job.enabled && !running(view)} />
              <button type="button" className="check-main" title="Modifier" onClick={() => setEditing(view.job.id)}>
                <span className="check-title">
                  {view.job.skill && <span className="check-ref">/{view.job.skill}</span>}
                  {view.job.name}
                </span>
                <span className="check-meta">{metaOf(view)}</span>
              </button>
              <span className="check-side">{sideOf(view, now)}</span>
              <button
                type="button"
                className="round small glass"
                aria-label={`Lancer ${view.job.name} maintenant`}
                title="Lancer maintenant"
                disabled={running(view)}
                onClick={() => run(view.job.id)}
              >
                <Play size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {board && board.jobs.length === 0 && (
        <section className="job-empty">
          <p>
            Un prompt ou une skill, l’heure à laquelle le lancer, et les MCP qu’il peut utiliser. Chaque exécution est une
            session Claude que tu rouvres d’un clic.
          </p>
          <button type="button" className="pill glass small" onClick={() => setEditing('new')}>
            <Plus size={15} aria-hidden="true" />
            Créer une tâche
          </button>
        </section>
      )}

      {board && editing && (editing === 'new' || edited) && (
        <JobEditor
          key={editing}
          board={board}
          view={edited}
          onClose={() => setEditing(null)}
          onSaved={message => {
            setEditing(null)
            onToast(message)
          }}
          onError={message => onToast(message, 'error')}
        />
      )}
    </section>
  )
}
