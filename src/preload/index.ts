import { contextBridge, ipcRenderer } from 'electron'
import type { McpBoard, SkillBoard } from '../shared/claude'
import type { JobBoard } from '../shared/jobs'
import type { AppState, FluxApi, SourceProgress } from '../shared/types'

const api: FluxApi = {
  getState: () => ipcRenderer.invoke('flux:get-state'),
  refreshAll: () => ipcRenderer.invoke('flux:refresh-all'),
  onState(listener) {
    const handler = (_event: unknown, state: AppState) => listener(state)
    ipcRenderer.on('flux:state', handler)
    return () => ipcRenderer.removeListener('flux:state', handler)
  },
  onProgress(listener) {
    const handler = (_event: unknown, progress: SourceProgress) => listener(progress)
    ipcRenderer.on('flux:progress', handler)
    return () => ipcRenderer.removeListener('flux:progress', handler)
  },
  onOpenTopic(listener) {
    const handler = (_event: unknown, id: string) => listener(id)
    ipcRenderer.on('flux:open-topic', handler)
    return () => ipcRenderer.removeListener('flux:open-topic', handler)
  },
  onOpenDaily(listener) {
    const handler = () => listener()
    ipcRenderer.on('flux:open-daily-view', handler)
    return () => ipcRenderer.removeListener('flux:open-daily-view', handler)
  },
  onOpenWrapup(listener) {
    const handler = () => listener()
    ipcRenderer.on('flux:open-wrapup-view', handler)
    return () => ipcRenderer.removeListener('flux:open-wrapup-view', handler)
  },
  takeLink: () => ipcRenderer.invoke('flux:take-link'),
  onOpenLink(listener) {
    const handler = (_event: unknown, link: string) => listener(link)
    ipcRenderer.on('flux:open-link', handler)
    return () => ipcRenderer.removeListener('flux:open-link', handler)
  },
  showLinkMenu: menu => ipcRenderer.invoke('flux:link-menu', menu),
  checkWrapup: (id, done) => ipcRenderer.invoke('flux:check-wrapup', id, done),
  onRefreshShortcut(listener) {
    const handler = () => listener()
    ipcRenderer.on('flux:refresh-shortcut', handler)
    return () => ipcRenderer.removeListener('flux:refresh-shortcut', handler)
  },
  refresh: () => ipcRenderer.invoke('flux:refresh'),
  createNote: text => ipcRenderer.invoke('flux:create-note', text),
  openCapture: () => ipcRenderer.invoke('flux:open-capture'),
  closeCapture: () => ipcRenderer.invoke('flux:close-capture'),
  updateTopic: (id, patch) => ipcRenderer.invoke('flux:update-topic', id, patch),
  closeTopic: id => ipcRenderer.invoke('flux:close-topic', id),
  launchThread: (id, action) => ipcRenderer.invoke('flux:launch-thread', id, action),
  focusThread: (id, session) => ipcRenderer.invoke('flux:focus-thread', id, session),
  openExternal: url => ipcRenderer.invoke('flux:open-external', url),
  getSettings: () => ipcRenderer.invoke('flux:get-settings'),
  saveSettings: patch => ipcRenderer.invoke('flux:save-settings', patch),
  profiles: () => ipcRenderer.invoke('flux:profiles'),
  setProfiles: patch => ipcRenderer.invoke('flux:set-profiles', patch),
  testNotification: () => ipcRenderer.invoke('flux:test-notification'),
  openNotificationSettings: () => ipcRenderer.invoke('flux:open-notification-settings'),
  notificationAccess: () => ipcRenderer.invoke('flux:notification-access'),
  requestNotificationAccess: () => ipcRenderer.invoke('flux:request-notification-access'),
  checkGithub: () => ipcRenderer.invoke('flux:check-github'),
  githubAccounts: () => ipcRenderer.invoke('flux:github-accounts'),
  checkLinearKey: key => ipcRenderer.invoke('flux:check-linear-key', key),
  checkJira: (site, email, token) => ipcRenderer.invoke('flux:check-jira', site, email, token),
  checkFigma: (token, teams) => ipcRenderer.invoke('flux:check-figma', token, teams),
  myPulls: force => ipcRenderer.invoke('flux:my-pulls', force === true),
  listProjects: () => ipcRenderer.invoke('flux:list-projects'),
  checkCalendarUrl: url => ipcRenderer.invoke('flux:check-calendar-url', url),
  runDaily: () => ipcRenderer.invoke('flux:run-daily'),
  openDaily: () => ipcRenderer.invoke('flux:open-daily'),
  setIntentions: ids => ipcRenderer.invoke('flux:set-intentions', ids),
  useDailyTemplate: () => ipcRenderer.invoke('flux:use-daily-template'),
  createDailySkill: () => ipcRenderer.invoke('flux:create-daily-skill'),
  jobs: () => ipcRenderer.invoke('flux:jobs'),
  onJobs(listener) {
    const handler = (_event: unknown, board: JobBoard) => listener(board)
    ipcRenderer.on('flux:jobs-board', handler)
    return () => ipcRenderer.removeListener('flux:jobs-board', handler)
  },
  saveJob: (id, draft) => ipcRenderer.invoke('flux:save-job', id, draft),
  removeJob: id => ipcRenderer.invoke('flux:remove-job', id),
  enableJob: (id, enabled) => ipcRenderer.invoke('flux:enable-job', id, enabled),
  runJob: id => ipcRenderer.invoke('flux:run-job', id),
  refreshMcps: () => ipcRenderer.invoke('flux:refresh-mcps'),
  openJobRun: session => ipcRenderer.invoke('flux:open-job-run', session),
  pickFolder: current => ipcRenderer.invoke('flux:pick-folder', current),
  skills: () => ipcRenderer.invoke('flux:skills'),
  onSkills(listener) {
    const handler = (_event: unknown, board: SkillBoard) => listener(board)
    ipcRenderer.on('flux:skills-board', handler)
    return () => ipcRenderer.removeListener('flux:skills-board', handler)
  },
  skillDetail: id => ipcRenderer.invoke('flux:skill-detail', id),
  skillVersion: (id, n) => ipcRenderer.invoke('flux:skill-version', id, n),
  validateSkill: id => ipcRenderer.invoke('flux:validate-skill', id),
  editSkill: id => ipcRenderer.invoke('flux:edit-skill', id),
  mcpServers: () => ipcRenderer.invoke('flux:mcp-servers'),
  onMcpServers(listener) {
    const handler = (_event: unknown, board: McpBoard) => listener(board)
    ipcRenderer.on('flux:mcp-board', handler)
    return () => ipcRenderer.removeListener('flux:mcp-board', handler)
  },
  checkMcpServers: () => ipcRenderer.invoke('flux:check-mcp-servers'),
  reconnectMcp: name => ipcRenderer.invoke('flux:reconnect-mcp', name),
  removeMcp: name => ipcRenderer.invoke('flux:remove-mcp', name),
  addMcp: draft => ipcRenderer.invoke('flux:add-mcp', draft),
}

contextBridge.exposeInMainWorld('flux', api)
