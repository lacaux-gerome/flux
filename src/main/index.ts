import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  shell,
  Tray,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron'
import type { McpDraft } from '../shared/claude'
import { nextWrapup, type JobDraft } from '../shared/jobs'
import { FLUX_SCHEME, fluxLink, linkMenuEntries, parseFluxLink, type LinkMenu } from '../shared/links'
import type { AppState, ProjectOptions, ProposedAction, SettingsPatch, Topic } from '../shared/types'
import { McpManager } from './claude/mcp'
import { SkillLibrary } from './claude/skills'
import { TranscriptUsage } from './claude/usage'
import { SkillVersions } from './claude/versions'
import { CONFIG } from './config'
import { run } from './exec'
import { Flux } from './engine/poller'
import { listMcpServers, listSkills } from './jobs/catalog'
import { JobScheduler, launchClaude } from './jobs/scheduler'
import { subscriptionEnv } from './llm/claude'
import { Daily, dailyTask, localDate } from './llm/daily'
import { createDailySkill, useDailyTemplate } from './llm/dailySkillBrief'
import { Triage } from './llm/triage'
import { notificationAccess, requestNotificationAccess } from './notificationAccess'
import { checkCalendarUrl, checkFigma, checkGithub, checkJira, checkLinearKey, normalizeJiraSite } from './onboarding'
import {
  ARCHIVE_DIR,
  BIN,
  CLAUDE_PROJECTS_DIR,
  DAILY_DIR,
  FIGMA_FILE,
  JOBS_FILE,
  MCP_FILE,
  REPOS_DIR,
  SKILL_USAGE_FILE,
  SKILL_VERSIONS_DIR,
  THREADS_DIR,
  TOPICS_DIR,
} from './paths'
import { fetchCalendar } from './sources/calendar'
import { fetchMyPulls, GITHUB_HOST, listGithubAccounts, listRecentRepos } from './sources/github'
import { PullBoard } from './engine/pulls'
import { FigmaScanner } from './sources/figma'
import { fetchJira, listJiraProjects } from './sources/jira'
import { fetchCompleted, fetchLinear, listLinearTeams } from './sources/linear'
import { fetchStoreReviews } from './sources/stores'
import { SettingsStore } from './store/settings'
import { noteFromText, TopicStore } from './store/topics'
import { closeThreads } from './threads/close'
import { adoptThreads, newSessionUrl, openInDesktop, resumeUrl } from './threads/desktop'
import { goToThread, launchThread } from './threads/launch'
import { desktopOf } from './threads/sessions'
import { noReviewRepos } from './workspaces'

const THREAD_SETTLE_MS = 6_000

let mainWindow: BrowserWindow | null = null
let captureWindow: BrowserWindow | null = null
let tray: Tray | null = null
let flux: Flux
let settings: SettingsStore
let daily: Daily
let jobs: JobScheduler
let skills: SkillLibrary
let mcps: McpManager
const liveNotifications = new Set<Notification>()
// A flux:// link waits here until the window can take it
let pendingLink: string | null = null
const linkReady = new WeakSet<WebContents>()

function pageUrl(hash = ''): { url?: string; file?: string } {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return { url: `${dev}${hash}` }
  return { file: join(__dirname, '../renderer/index.html') }
}

function load(window: BrowserWindow, hash = ''): void {
  const { url, file } = pageUrl(hash)
  if (url) void window.loadURL(url)
  else if (file) void window.loadFile(file, { hash: hash.replace('#', '') })
}

function openMain(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return mainWindow
  }
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 25 },
    backgroundColor: '#070912',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })
  window.once('ready-to-show', () => window.show())
  // ⌘R refreshes Flux's sources instead of reloading the window
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.meta && !input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault()
      window.webContents.send('flux:refresh-shortcut')
    }
  })
  // The system's swipe between pages, when the trackpad is set for it
  window.on('swipe', (_event, direction) => {
    if (direction === 'right') window.webContents.send('flux:navigate', 'back')
    if (direction === 'left') window.webContents.send('flux:navigate', 'forward')
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  window.webContents.on('did-start-loading', () => linkReady.delete(window.webContents))
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  load(window)
  mainWindow = window
  return window
}

function openCapture(): void {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.show()
    captureWindow.focus()
    return
  }
  const window = new BrowserWindow({
    width: 560,
    height: 190,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    vibrancy: 'hud',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })
  window.on('blur', () => window.close())
  window.on('closed', () => {
    if (captureWindow === window) captureWindow = null
  })
  load(window, '#capture')
  captureWindow = window
}

// A window just opened is still loading: the message waits for it
function sendToMain(channel: string, ...args: unknown[]): void {
  const window = openMain()
  const send = () => window.webContents.send(channel, ...args)
  if (window.webContents.isLoading()) window.webContents.once('did-finish-load', send)
  else send()
}

function showTopic(id: string): void {
  sendToMain('flux:open-topic', id)
}

function showWrapup(): void {
  sendToMain('flux:open-wrapup-view')
}

// Sent at once to a window already listening, otherwise kept until it asks
function openLink(link: string): void {
  if (!parseFluxLink(link)) return
  if (!app.isReady()) {
    pendingLink = link
    return
  }
  const window = openMain()
  if (linkReady.has(window.webContents)) window.webContents.send('flux:open-link', link)
  else pendingLink = link
}

function showLinkMenu(sender: WebContents, menu: LinkMenu): void {
  const entries = linkMenuEntries(menu)
  if (entries.length === 0) return
  const item = (entry: { label: string; copy: string }): MenuItemConstructorOptions => ({
    label: entry.label,
    click: () => clipboard.writeText(entry.copy),
  })
  const sources = entries.filter(entry => !entry.copy.startsWith(`${FLUX_SCHEME}:`))
  const flux = entries.filter(entry => entry.copy.startsWith(`${FLUX_SCHEME}:`))
  const template: MenuItemConstructorOptions[] = [
    ...sources.map(item),
    ...(sources.length > 0 && flux.length > 0 ? [{ type: 'separator' as const }] : []),
    ...flux.map(item),
  ]
  Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(sender) ?? undefined })
}

function trayLabel(state: AppState): string {
  const head = state.queue[0]
  if (!head) return '✓'
  const ref = head.topic.links[0] ?? head.topic.title
  const short = ref.length > 24 ? `${ref.slice(0, 23)}…` : ref
  return `▶ ${state.queue.length}  ${short}`
}

function buildTray(): void {
  tray = new Tray(nativeImage.createEmpty())
  tray.setTitle('Flux')
  tray.setToolTip('Flux')
  tray.on('click', () => {
    const head = flux.current()?.queue[0]
    if (head) showTopic(head.topic.id)
    else openMain()
  })
  tray.on('right-click', () => {
    tray?.popUpContextMenu(
      Menu.buildFromTemplate([
        { label: 'Ouvrir Flux', click: () => openMain() },
        { label: 'Wrap-up', click: () => showWrapup() },
        { label: 'Nouvelle note', click: () => openCapture() },
        { label: 'Rafraîchir', click: () => void flux.refresh() },
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ]),
    )
  })
}

function registerCapture(): void {
  globalShortcut.unregisterAll()
  const accelerator = settings.values.captureShortcut
  if (accelerator) globalShortcut.register(accelerator, openCapture)
}

// macOS drops notifications silently when the person refused them for this bundle id
function bundleId(): string | null {
  if (!app.isPackaged) return null
  const plist = readFileSync(join(process.resourcesPath, '..', 'Info.plist'), 'utf8')
  return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? null
}

function openNotificationSettings(): Promise<void> {
  const id = bundleId()
  const pane = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
  return shell.openExternal(id ? `${pane}?id=${encodeURIComponent(id)}` : pane)
}

function notify(title: string, body: string, onClick: () => void): void {
  console.log(`${new Date().toISOString()} notification : ${title} | ${body}`)
  const notification = new Notification({ title, body, silent: false })
  liveNotifications.add(notification)
  notification.on('failed', (_event, error) => {
    liveNotifications.delete(notification)
    console.error(`Notification refusée par macOS : ${error}`)
  })
  notification.on('click', () => {
    liveNotifications.delete(notification)
    onClick()
  })
  notification.on('close', () => liveNotifications.delete(notification))
  notification.show()
}

function notifyDaily(): void {
  notify('Daily prêt', 'Le récap du jour t’attend dans Flux.', () => sendToMain('flux:open-daily-view'))
}

function requireTopic(id: string): Topic {
  const topic = flux.topic(id)
  if (!topic) throw new Error(`Sujet introuvable : ${id}`)
  return topic
}

// What the projects picker offers: every Jira project and Linear team you can see, and your repos
async function listProjects(): Promise<ProjectOptions> {
  const errors: string[] = []
  const settled = async <T>(label: string, task: Promise<T>, fallback: T): Promise<T> =>
    task.catch(error => {
      errors.push(`${label} : ${(error as Error).message}`)
      return fallback
    })
  const token = settings.secret('jiraToken')
  const email = settings.values.jiraEmail
  const site = settings.jiraSite()
  const linearKey = settings.secret('linearKey')
  const [jira, linear, recent] = await Promise.all([
    settings.uses('jira') && token && email && site
      ? settled('Jira', listJiraProjects({ site, email, token }), [])
      : [],
    settings.uses('linear') && linearKey ? settled('Linear', listLinearTeams(linearKey), []) : [],
    settled('GitHub', listRecentRepos(settings.values.githubAccount), []),
  ])
  // Repos already attached stay listed even without a recent PR
  const attached = (settings.values.projects ?? []).flatMap(project => project.repos)
  return {
    projects: [
      ...jira.map(project => ({ tracker: 'jira' as const, ...project })),
      ...linear.map(team => ({ tracker: 'linear' as const, ...team })),
    ],
    repos: [...new Set([...recent, ...attached])],
    errors,
  }
}

const pulls = new PullBoard(fetchMyPulls, noReviewRepos)

function registerIpc(): void {
  ipcMain.handle('flux:my-pulls', (_event, force: boolean) => pulls.get(settings.values.githubAccount, force))
  ipcMain.handle('flux:get-state', () => flux.current())
  ipcMain.handle('flux:refresh', () => flux.refresh())
  ipcMain.handle('flux:refresh-all', () => flux.refreshAll())
  ipcMain.handle('flux:create-note', async (_event, text: string) => {
    if (text.trim()) await flux.addTopic(noteFromText(text, new Date()))
    captureWindow?.close()
  })
  ipcMain.handle('flux:open-capture', () => openCapture())
  ipcMain.handle('flux:close-capture', () => captureWindow?.close())
  ipcMain.handle('flux:update-topic', async (_event, id: string, patch: Partial<Topic>) => {
    const topic = requireTopic(id)
    Object.assign(topic, patch)
    await flux.saveTopic(topic)
  })
  ipcMain.handle('flux:close-topic', (_event, id: string) => flux.closeTopic(id))
  ipcMain.handle('flux:check-wrapup', (_event, id: string, done: boolean) =>
    flux.checkWrapup(id, done),
  )
  ipcMain.handle('flux:launch-thread', async (_event, id: string, action: ProposedAction) => {
    const view = flux.view(id)
    if (!view) throw new Error(`Sujet introuvable : ${id}`)
    const topic = requireTopic(id)
    topic.threads.push(await launchThread(view, action))
    await flux.saveTopic(topic)
    setTimeout(() => void flux.refresh(), THREAD_SETTLE_MS)
  })
  ipcMain.handle('flux:focus-thread', async (_event, id: string, session: string) => {
    const topic = requireTopic(id)
    await flux.adoptThreads()
    // The renderer names a thread by its Desktop id when it has one: the conversation id may have moved
    const thread = topic.threads.find(
      entry => entry.desktop === session || entry.session === session || entry.dir === session,
    )
    if (!thread) throw new Error(`Thread introuvable : ${session}`)
    const alive = flux.liveSessions().some(entry => entry.session === thread.session)
    const archived = desktopOf(thread, flux.desktopSessions())?.archived ?? false
    const workspace = await goToThread(thread, alive, archived)
    if (workspace !== thread.workspace) {
      thread.workspace = workspace
      await flux.saveTopic(topic)
    }
    setTimeout(() => void flux.refresh(), THREAD_SETTLE_MS)
  })
  ipcMain.handle('flux:take-link', event => {
    linkReady.add(event.sender)
    const link = pendingLink
    pendingLink = null
    return link
  })
  ipcMain.handle('flux:link-menu', (event, menu: LinkMenu) => showLinkMenu(event.sender, menu))
  ipcMain.handle('flux:open-external', (_event, url: string) => {
    if (/^https?:/i.test(url)) return shell.openExternal(url)
    return undefined
  })
  ipcMain.handle('flux:get-settings', () => settings.public())
  ipcMain.handle('flux:save-settings', async (_event, patch: SettingsPatch) => {
    settings.apply(
      patch.jiraSite === undefined ? patch : { ...patch, jiraSite: normalizeJiraSite(patch.jiraSite) },
    )
    // Switching or editing workspaces only redraws from the cache; a new workspace is fetched
    // by the next tick, which reads any workspace it has no data for yet
    if (Object.keys(patch).every(key => key === 'workspace' || key === 'projects')) {
      if (patch.projects !== undefined) flux.forgetOtherWorkspaces()
      void flux.switchWorkspace()
      return
    }
    registerCapture()
    // The daily and the wrap-up show among the tasks, with the times just saved
    if (patch.dailyTime !== undefined || patch.wrapupTimes !== undefined) {
      void jobs.snapshot().then(board => broadcast('flux:jobs-board', board))
    }
    // The panel closes as soon as settings are written; sources reload in the background
    void flux.reloadSources()
  })
  ipcMain.handle('flux:test-notification', () => {
    notify('Flux', 'Les notifications arrivent bien.', () => openMain())
  })
  ipcMain.handle('flux:open-notification-settings', () => openNotificationSettings())
  ipcMain.handle('flux:notification-access', () => notificationAccess())
  ipcMain.handle('flux:request-notification-access', () => requestNotificationAccess())
  ipcMain.handle('flux:check-github', () => checkGithub(settings.values.githubAccount))
  ipcMain.handle('flux:github-accounts', async () => ({
    host: GITHUB_HOST,
    ...(await listGithubAccounts()),
  }))
  ipcMain.handle('flux:check-linear-key', (_event, key: string) => checkLinearKey(key))
  ipcMain.handle('flux:check-jira', (_event, site: string, email: string, token: string) =>
    checkJira(site, email, token),
  )
  ipcMain.handle('flux:check-figma', (_event, token: string, teams: string[]) => checkFigma(token, teams))
  ipcMain.handle('flux:list-projects', () => listProjects())
  ipcMain.handle('flux:check-calendar-url', (_event, url: string) => checkCalendarUrl(url))
  ipcMain.handle('flux:run-daily', () => daily.run(new Date(), flux.current()))
  ipcMain.handle('flux:open-daily', () => {
    const path = join(DAILY_DIR, `${localDate(new Date())}.md`)
    if (!existsSync(path)) return undefined
    return shell.openExternal(`obsidian://open?path=${encodeURIComponent(path)}`)
  })
  ipcMain.handle('flux:set-intentions', (_event, ids: string[]) => flux.setIntentions(ids))
  ipcMain.handle('flux:use-daily-template', async () => {
    const result = await useDailyTemplate()
    if (result.ok) await flux.refresh()
    return result
  })
  ipcMain.handle('flux:create-daily-skill', () => createDailySkill())
  ipcMain.handle('flux:jobs', () => jobs.snapshot())
  ipcMain.handle('flux:save-job', (_event, id: string | null, draft: JobDraft) => jobs.save(id, draft))
  ipcMain.handle('flux:remove-job', (_event, id: string) => jobs.remove(id))
  ipcMain.handle('flux:enable-job', (_event, id: string, enabled: boolean) => jobs.setEnabled(id, enabled))
  ipcMain.handle('flux:run-job', (_event, id: string) => jobs.runNow(id))
  ipcMain.handle('flux:refresh-mcps', () => jobs.refreshMcps(true))
  ipcMain.handle('flux:open-job-run', (_event, session: string) => openInDesktop(resumeUrl(session)))
  ipcMain.handle('flux:skills', () => skills.list())
  ipcMain.handle('flux:skill-detail', (_event, id: string) => skills.detail(id))
  ipcMain.handle('flux:skill-version', (_event, id: string, n: number) => skills.version(id, n))
  ipcMain.handle('flux:validate-skill', (_event, id: string) => skills.validate(id))
  ipcMain.handle('flux:edit-skill', (_event, id: string) => skills.edit(id))
  ipcMain.handle('flux:remove-skill', (_event, id: string) => skills.remove(id))
  ipcMain.handle('flux:mcp-servers', () => mcps.snapshot())
  ipcMain.handle('flux:check-mcp-servers', () => mcps.refresh())
  ipcMain.handle('flux:reconnect-mcp', (_event, name: string) => mcps.reconnect(name))
  ipcMain.handle('flux:remove-mcp', (_event, name: string) => mcps.remove(name))
  ipcMain.handle('flux:add-mcp', (_event, draft: McpDraft) => mcps.add(draft))
  ipcMain.handle('flux:pick-folder', async (event, current: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      defaultPath: current || REPOS_DIR,
      properties: ['openDirectory' as const, 'createDirectory' as const],
    }
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
}

const defaultCwd = () => (existsSync(REPOS_DIR) ? REPOS_DIR : homedir())

function startJobs(): JobScheduler {
  return new JobScheduler(JOBS_FILE, {
    launch: launchClaude,
    listMcps: listMcpServers,
    listSkills: () => listSkills(),
    daily: () => dailyTask(new Date(), settings.values.dailyTime, settings.values.workdayEnd),
    wrapup: () => {
      const times = settings.values.wrapupTimes
      return { times, next: nextWrapup(times, new Date())?.toISOString() ?? null }
    },
    defaultCwd: defaultCwd(),
    onChange(board) {
      broadcast('flux:jobs-board', board)
    },
    onFinish(job, run) {
      const title = run.status === 'ok' ? `${job.name} est terminé` : `${job.name} a échoué`
      notify(title, run.summary ?? '', () => openLink(fluxLink({ kind: 'tab', tab: 'claude' })))
    },
  })
}

// The Claude space: the skills and their versions, the MCP servers through the claude CLI
function startClaudeSpace(): void {
  skills = new SkillLibrary({
    home: homedir(),
    versions: new SkillVersions(SKILL_VERSIONS_DIR),
    transcripts: new TranscriptUsage(CLAUDE_PROJECTS_DIR, SKILL_USAGE_FILE),
    openSession: (prompt, folders) => openInDesktop(newSessionUrl(prompt, folders)),
    trash: path => shell.trashItem(path),
    onChange: board => broadcast('flux:skills-board', board),
  })
  mcps = new McpManager({
    home: homedir(),
    cwd: defaultCwd(),
    file: MCP_FILE,
    claude: (args, options) => run(BIN.claude, args, { ...options, env: subscriptionEnv() }),
    connectors: () => jobs.board().mcps,
    refreshConnectors: () => jobs.refreshMcps(true),
    onChange: board => broadcast('flux:mcp-board', board),
  })
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  // Before ready: a link that launches Flux arrives first
  app.on('open-url', (event, url) => {
    event.preventDefault()
    openLink(url)
  })
  await app.whenReady()
  settings = new SettingsStore()
  const triage = new Triage()
  const figma = new FigmaScanner(FIGMA_FILE)
  daily = new Daily(
    state => flux.setDaily(state),
    () => notifyDaily(),
  )
  const store = new TopicStore(TOPICS_DIR, ARCHIVE_DIR)
  flux = new Flux(store, settings, {
    onState(state) {
      tray?.setTitle(trayLabel(state))
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('flux:state', state)
      }
    },
    onProgress(progress) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('flux:progress', progress)
      }
    },
    onNotify: ({ title, body, topicId }) => notify(title, body, () => showTopic(topicId)),
    onWrapup: ({ title, body }) => notify(title, body, () => showWrapup()),
    fetchTickets: async keys => {
      const key = settings.secret('linearKey')
      if (!key || !settings.uses('linear')) return null
      const tickets = await fetchLinear(key, keys)
      await triage.apply(tickets)
      return tickets
    },
    fetchCompleted: async since => {
      const key = settings.secret('linearKey')
      return key ? fetchCompleted(key, since) : []
    },
    fetchReviews: async () => (CONFIG.daily.stores.apps.length > 0 ? fetchStoreReviews(CONFIG.daily.stores) : null),
    fetchFigma: async followed => {
      const access = settings.figma()
      return access ? figma.step(access.token, access.teams, followed, new Date()) : null
    },
    fetchJira: async (keys, projects) => {
      const token = settings.secret('jiraToken')
      const email = settings.values.jiraEmail
      const site = settings.jiraSite()
      if (!settings.uses('jira') || !site || !email || !token) return null
      // Without workspaces, every project you are assigned in counts
      return fetchJira({ site, email, token }, projects, keys)
    },
    fetchMeetings: async () => {
      const url = settings.secret('calendarUrl')
      return url && settings.calendar() ? fetchCalendar(url) : null
    },
    closeThreads: topic => closeThreads(topic, flux.liveSessions()),
    adoptThreads: topics => adoptThreads(topics, THREADS_DIR),
    onTick: (now, state) => {
      const { dailyTime, workdayEnd } = settings.values
      daily.maybeRun(now, state, dailyTime, workdayEnd)
    },
  })

  daily.sync(new Date())
  jobs = startJobs()
  startClaudeSpace()
  registerIpc()
  // Warm the account list so the settings panel opens with profile pictures already there
  void listGithubAccounts().catch(() => undefined)
  buildTray()
  registerCapture()
  openMain()
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true })
    app.setAsDefaultProtocolClient(FLUX_SCHEME)
  }
  powerMonitor.on('resume', () => {
    void flux.refresh()
    void jobs.tick()
  })
  app.on('second-instance', (_event, argv) => {
    const link = argv.find(arg => arg.startsWith(`${FLUX_SCHEME}://`))
    if (link) openLink(link)
    else openMain()
  })
  app.on('activate', () => openMain())
  app.on('window-all-closed', () => undefined)
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    flux.stop()
    jobs.stop()
  })
  void jobs.start().catch(error => console.error(error))
  await flux.start()
}

main().catch(error => {
  console.error(error)
  app.exit(1)
})
