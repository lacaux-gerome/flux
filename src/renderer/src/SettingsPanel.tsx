import {
  AtSign,
  BellRing,
  CalendarDays,
  Check,
  CircleAlert,
  Globe,
  Keyboard,
  KeyRound,
  Layers,
  Settings2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { AccountPicker } from './AccountPicker'
import { WorkspacesView } from './WorkspacesView'
import { TimePicker } from './TimePicker'
import { AddCalendarMenu, AddTrackerMenu, TrackerBadge, TRACKER_HINT, trackerInfo } from './Trackers'
import { figmaTeamIds } from '../../shared/figma'
import { calendarInfo } from '../../shared/calendars'
import { projectTrackers, type TrackerName } from '../../shared/trackers'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLayer } from './layers'
import type { GithubAccounts, NotificationAccess, Settings, SettingsPatch } from '../../shared/types'

function InputShell({ icon: Icon, stored, children }: { icon: LucideIcon; stored?: boolean; children: ReactNode }) {
  return (
    <span className="input-shell">
      <Icon size={16} aria-hidden="true" className="input-icon" />
      {children}
      {stored && (
        <span className="input-stored">
          <Check size={12} aria-hidden="true" />
          Enregistrée
        </span>
      )}
    </span>
  )
}

// Kept across openings so profile pictures show at once when the panel comes back
let lastAccounts: GithubAccounts | null = null
// What was changed and not saved when the window closed, given back when it opens again. Kept in
// memory only: it may hold a token
let unsaved: { patch: SettingsPatch; teamsText: string | null } | null = null

const ACCESS_LABEL: Record<NotificationAccess, string> = {
  authorized: 'Autorisées par macOS',
  provisional: 'Autorisées par macOS, en mode discret',
  denied: 'Bloquées par macOS : active Flux dans les réglages',
  'not-determined': 'Pas encore autorisées',
  unsupported: 'Autorisation illisible, envoie un essai pour vérifier',
}

type TextKey = Exclude<
  keyof SettingsPatch,
  | 'onboarded'
  | 'githubAccount'
  | 'workspace'
  | 'trackers'
  | 'calendar'
  | 'projects'
  | 'wrapupTimes'
  | 'figmaTeams'
>

export function SettingsPanel({
  onClose,
  onReplay,
  onSaved,
  onError,
  initialView = 'main',
}: {
  onClose(): void
  onReplay(): void
  onSaved(): void
  onError(message: string): void
  // The selector's button opens the window straight on its Espaces page
  initialView?: 'main' | 'workspaces'
}) {
  const [view, setView] = useState(initialView)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [patch, setPatch] = useState<SettingsPatch>(() => unsaved?.patch ?? {})
  const [restored, setRestored] = useState(unsaved !== null)
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState<GithubAccounts | null>(lastAccounts)
  const [access, setAccess] = useState<NotificationAccess | null>(null)
  // The teams field as typed; saved as the team ids it holds
  const [teamsText, setTeamsText] = useState<string | null>(() => unsaved?.teamsText ?? null)
  const form = useRef<HTMLFormElement>(null)
  const saved = useRef(false)
  const latest = useRef({ patch, teamsText })
  latest.current = { patch, teamsText }

  const backToMain = () => {
    setView('main')
    // The summary line shows what the page just saved
    void window.flux.getSettings().then(setSettings)
  }
  useLayer(true, onClose, {
    root: form,
    // Back from Espaces to the settings, when they are where it was opened from
    back: () => {
      if (view !== 'workspaces' || initialView !== 'main') return false
      backToMain()
      return true
    },
  })

  useEffect(
    () => () => {
      const { patch: left, teamsText: text } = latest.current
      unsaved = saved.current || (Object.keys(left).length === 0 && text === null) ? null : { patch: left, teamsText: text }
    },
    [],
  )

  useEffect(() => {
    // Back from System Settings, the window regains focus: read the permission again
    const refresh = () => void window.flux.notificationAccess().then(setAccess)
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    void window.flux.getSettings().then(setSettings)
    void window.flux
      .githubAccounts()
      .then(fresh => {
        lastAccounts = fresh
        setAccounts(fresh)
      })
      .catch(() => {
        if (!lastAccounts) setAccounts({ host: 'github.com', logins: [], active: null, profiles: {} })
      })
  }, [])

  // The window answers the keyboard as soon as it shows, wherever it was opened from
  useEffect(() => {
    if (settings && !form.current?.contains(document.activeElement)) form.current?.focus({ preventScroll: true })
  }, [settings === null, view])

  if (!settings) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await window.flux.saveSettings(patch)
      saved.current = true
      onSaved()
    } catch (error) {
      setSaving(false)
      onError(`Réglages non enregistrés : ${(error as Error).message}`)
    }
  }

  const chosenAccount =
    patch.githubAccount !== undefined ? patch.githubAccount : settings.githubAccount

  const trackers = patch.trackers ?? settings.trackers
  const chosenCalendar = patch.calendar ?? settings.calendar
  const calendar = chosenCalendar === 'none' ? null : chosenCalendar
  const setTrackers = (next: TrackerName[]) => setPatch(current => ({ ...current, trackers: next }))

  const withProjects = projectTrackers(trackers).length > 0

  const field = (key: TextKey) => ({
    value: patch[key] ?? '',
    onChange: (event: { target: { value: string } }) => {
      setPatch(current => ({ ...current, [key]: event.target.value }))
    },
  })

  return (
    <div className="scrim" onClick={onClose}>
    <form
      ref={form}
      className="settings glass-dark"
      role="dialog"
      aria-modal="true"
      aria-label="Réglages"
      tabIndex={-1}
      data-layer
      onSubmit={submit}
      onClick={event => event.stopPropagation()}
    >
      {view === 'workspaces' ? (
        <WorkspacesView
          onBack={initialView === 'main' ? backToMain : undefined}
          onClose={onClose}
          onError={onError}
        />
      ) : (
      <>
      <header>
        <h1>Réglages</h1>
        <button type="button" className="round glass small" aria-label="Fermer" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {restored && (
        <p className="job-kept" role="status">
          Modifications non enregistrées reprises.
          <button
            type="button"
            onClick={() => {
              setPatch({})
              setTeamsText(null)
              setRestored(false)
            }}
          >
            Effacer
          </button>
        </p>
      )}

      <div className="field">
        <span>Compte GitHub</span>
        <AccountPicker
          accounts={accounts}
          value={chosenAccount}
          onChange={githubAccount => {
            setPatch(current => ({ ...current, githubAccount }))
          }}
        />
        <small>Flux lit GitHub avec ce compte, sans changer celui de ton terminal.</small>
      </div>

      <section className="field trackers">
        <span>Outils</span>
        {trackers.length === 0 && (
          <small>Aucun outil : Flux ne suit que tes PR GitHub et tes notes.</small>
        )}
        {trackers.map(name => (
          <div className="tracker-card" key={name}>
            <header>
              <TrackerBadge name={name} />
              <span className="tracker-name">
                <strong>{trackerInfo(name).label}</strong>
                <small>{TRACKER_HINT[name]}</small>
              </span>
              <button
                type="button"
                className="round glass small"
                aria-label={`Retirer ${trackerInfo(name).label}`}
                title="Retirer"
                onClick={() => setTrackers(trackers.filter(entry => entry !== name))}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </header>

            {name === 'jira' && (
              <>
                <InputShell icon={Globe}>
                  <input
                    type="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://entreprise.atlassian.net"
                    value={patch.jiraSite ?? settings.jiraSite}
                    onChange={field('jiraSite').onChange}
                  />
                </InputShell>
                <InputShell icon={AtSign}>
                  <input
                    type="email"
                    autoComplete="off"
                    placeholder="prenom.nom@entreprise.fr"
                    value={patch.jiraEmail ?? settings.jiraEmail}
                    onChange={field('jiraEmail').onChange}
                  />
                </InputShell>
                <InputShell icon={KeyRound} stored={settings.hasJiraToken && !patch.jiraToken}>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={settings.hasJiraToken ? 'Remplacer le jeton' : 'Jeton API'}
                    {...field('jiraToken')}
                  />
                </InputShell>
                <small>Jeton : id.atlassian.com → Sécurité → Jetons d’API.</small>
              </>
            )}

            {name === 'linear' && (
              <>
                <InputShell icon={KeyRound} stored={settings.hasLinearKey && !patch.linearKey}>
                  <input
                    type="password"
                    autoComplete="off"
                    placeholder={settings.hasLinearKey ? 'Remplacer la clef' : 'lin_api_…'}
                    {...field('linearKey')}
                  />
                </InputShell>
                <small>Linear → Settings → Security &amp; access → Personal API keys.</small>
              </>
            )}

            {name === 'figma' && (
              <>
                <InputShell icon={Users}>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Équipes Figma"
                    placeholder="https://www.figma.com/files/team/…"
                    value={teamsText ?? (patch.figmaTeams ?? settings.figmaTeams).join(', ')}
                    onChange={event => {
                      const text = event.target.value
                      setTeamsText(text)
                      setPatch(current => ({ ...current, figmaTeams: figmaTeamIds(text) }))
                    }}
                  />
                </InputShell>
                <InputShell icon={KeyRound} stored={settings.hasFigmaToken && !patch.figmaToken}>
                  <input
                    type="password"
                    autoComplete="off"
                    aria-label="Jeton Figma"
                    placeholder={settings.hasFigmaToken ? 'Remplacer le jeton' : 'Jeton d’accès personnel'}
                    {...field('figmaToken')}
                  />
                </InputShell>
                <small>
                  Équipe : colle le lien de sa page dans Figma. Jeton : Figma → Settings → Security → Personal
                  access tokens, en lecture sur les commentaires, les projets et ton profil.
                </small>
              </>
            )}
          </div>
        ))}
        <AddTrackerMenu chosen={trackers} onAdd={name => setTrackers([...trackers, name])} />
      </section>

      <div className="field">
        <span>Espaces</span>
        <div className="workspaces-summary">
          <Layers size={15} aria-hidden="true" />
          <span>
            {(settings.projects ?? []).length > 0
              ? (settings.projects ?? []).map(project => project.key).join(', ')
              : withProjects
                ? 'Aucun projet suivi'
                : 'Connecte Jira ou Linear pour suivre des projets'}
          </span>
          <button
            type="button"
            className="pill glass small"
            disabled={!withProjects}
            onClick={() => setView('workspaces')}
          >
            Gérer
          </button>
        </div>
        <small>Chaque projet suivi devient un espace, avec sa file et ses PR.</small>
      </div>

      <section className="field trackers">
        <span>Agenda</span>
        {calendar ? (
          <div className="tracker-card">
            <header>
              <TrackerBadge name={calendar} />
              <span className="tracker-name">
                <strong>{calendarInfo(calendar).label}</strong>
                <small>Flux se tait pendant tes réunions et affiche la suivante</small>
              </span>
              <button
                type="button"
                className="round glass small"
                aria-label={`Retirer ${calendarInfo(calendar).label}`}
                title="Retirer"
                onClick={() => setPatch(current => ({ ...current, calendar: 'none' }))}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </header>
            <InputShell icon={CalendarDays} stored={settings.hasCalendarUrl && !patch.calendarUrl}>
              <input
                type="password"
                autoComplete="off"
                placeholder={
                  settings.hasCalendarUrl ? 'Remplacer le lien iCal' : calendarInfo(calendar).placeholder
                }
                {...field('calendarUrl')}
              />
            </InputShell>
            <small>{calendarInfo(calendar).help}</small>
          </div>
        ) : (
          <>
            <small>Aucun agenda : Flux ne connaît pas tes réunions.</small>
            <AddCalendarMenu onAdd={name => setPatch(current => ({ ...current, calendar: name }))} />
          </>
        )}
      </section>

      <div className="settings-row">
        <div className="field">
          <span>Heure du daily</span>
          <TimePicker
            value={patch.dailyTime ?? settings.dailyTime}
            onChange={dailyTime => setPatch(current => ({ ...current, dailyTime }))}
          />
        </div>

        <label>
          Raccourci de capture
          <InputShell icon={Keyboard}>
            <input
              value={patch.captureShortcut ?? settings.captureShortcut}
              onChange={field('captureShortcut').onChange}
            />
          </InputShell>
        </label>
      </div>

      <section className="settings-notifications">
        <span className="label-title">
          <BellRing size={13} aria-hidden="true" />
          Notifications
        </span>
        <p className={`access ${access === 'authorized' || access === 'provisional' ? 'ok' : 'warn'}`}>
          {access === 'authorized' || access === 'provisional' ? (
            <Check size={14} aria-hidden="true" />
          ) : (
            <CircleAlert size={14} aria-hidden="true" />
          )}
          {ACCESS_LABEL[access ?? 'unsupported']}
        </p>
        <div className="settings-row">
          {access === 'not-determined' && (
            <button
              type="button"
              className="pill glass small"
              onClick={() => void window.flux.requestNotificationAccess().then(setAccess)}
            >
              Autoriser
            </button>
          )}
          <button
            type="button"
            className="pill glass small"
            onClick={() => void window.flux.testNotification()}
          >
            Envoyer un essai
          </button>
          <button
            type="button"
            className="pill glass small"
            onClick={() => void window.flux.openNotificationSettings()}
          >
            <Settings2 size={14} aria-hidden="true" />
            Réglages macOS
          </button>
        </div>
      </section>

      <footer>
        <button type="button" className="pill glass small notify-test" onClick={onReplay}>
          Revoir l’accueil
        </button>
        <button type="submit" className="pill solid small" disabled={saving}>
          Enregistrer
        </button>
      </footer>
      </>
      )}
    </form>
    </div>
  )
}
