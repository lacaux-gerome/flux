import type { CalendarName } from './calendars'
import type { McpBoard, McpDraft, McpEntry, SkillBoard, SkillDetail } from './claude'
import type { Job, JobBoard, JobDraft } from './jobs'
import type { LinkMenu } from './links'
import type { TrackerName } from './trackers'

export type Rank = 0 | 1 | 2 | 3 | 4 | 5 | 6
// parked: in a Linear backlog with nothing asked of me, shown nowhere until someone asks
export type Ball = 'me' | 'others' | 'agent' | 'dormant' | 'parked'
export type TopicStatus = 'open' | 'done'
// paused: open in Claude Desktop, its process stopped until you open it again
// archived: archived in Claude Desktop; closed: no process and no Desktop record
export type ThreadStatus = 'busy' | 'idle' | 'paused' | 'archived' | 'closed' | 'pending'
// Where my part of a topic stands: nothing done yet, under way, or held (blocked, or with a reviewer)
export type Stage = 'untouched' | 'started' | 'held'
export type SourceName = 'github' | 'linear' | 'jira' | 'figma' | 'agents' | 'calendar'

export type ActionKind =
  | 'submit-review'
  | 'take-comments'
  | 'review'
  | 're-review'
  | 'question'
  | 'ship'
  | 'fix-pr'
  | 'ticket'
  | 'diagnostic'
  | 'cadrage'
  | 'resume'
  | 'free'
  // Opens the Figma file: comments are answered there
  | 'figma'

export interface Signal {
  id: string
  rank: Rank
  weight: number
  detail: string
  since: string
  stamp: string
  action: ActionKind
  // What it says of my part: absent, I have not done anything on it yet
  stage?: Exclude<Stage, 'untouched'>
}

export interface Item {
  ref: string
  refs: string[]
  kind: 'pr' | 'ticket' | 'figma'
  title: string
  url: string
  branch?: string
  // Ticket: the column it sits in on the board (« In Review »)
  state?: string
  terminal: boolean
  ball: 'me' | 'others' | 'dormant' | 'parked'
  // My PR or a ticket assigned to me, as opposed to someone else's I take part in
  mine: boolean
  signals: Signal[]
  // My comment on it that nobody answered yet
  asked?: AskedLine
  // Figma: the threads waiting on my answer, newest first
  comments?: CommentLine[]
  // Someone else's PR I reviewed, with nothing asked of me since: my part is done
  reviewed?: boolean
}

// One of my open PRs, whatever its workspace, and where it stands
export interface MyPull {
  ref: string
  repo: string
  title: string
  url: string
  updatedAt: string
  isDraft: boolean
  // GitHub's check rollup: SUCCESS, FAILURE, PENDING…; null without checks
  ci: string | null
  // In the file's words: « 2 retours de nicolas », « Prêt à merger », « En attente de review »
  status: string
  // Tint of the status; null while the PR waits on others
  rank: Rank | null
}

export interface MyPulls {
  // Last answer from GitHub; null before the first
  at: string | null
  pulls: MyPull[]
  error: string | null
}

export interface CommentLine {
  // The thread, by its first comment
  id: string
  author: string
  excerpt: string
  at: string
  url: string
}

export interface AskedLine {
  excerpt: string
  at: string
  url: string
}

export interface ThreadRef {
  session: string
  name: string
  cwd: string
  startedAt: string
  // Folder under ~/.flux/threads holding the brief, when it differs from the session id
  dir?: string
  // Opened in Claude Desktop, its transcript not found yet: the session id is still unknown
  pending?: boolean
  // Claude Desktop's own id (local_…): it stays when the conversation id moves, and reopens the session
  desktop?: string
  // The title Claude Desktop gave the session
  title?: string
  // Legacy cmux tab
  workspace?: string
  closing?: boolean
}

export interface Topic {
  id: string
  title: string
  status: TopicStatus
  links: string[]
  threads: ThreadRef[]
  blocked?: string
  createdAt: string
  closedAt?: string
  body: string
}

export interface ThreadView extends ThreadRef {
  status: ThreadStatus
  // Last turn Claude Desktop recorded, else the launch
  activeAt: string
}

export interface ProposedAction {
  kind: ActionKind
  label: string
  url: string
  prompt?: string
  cwd?: string
}

export interface TopicView {
  topic: Topic
  items: Item[]
  signals: Signal[]
  threads: ThreadView[]
  rank: Rank | null
  ball: Ball
  stage: Stage
  // My own work: one of its items is mine, or a note with nothing linked
  mine: boolean
  since: string | null
  actions: ProposedAction[]
}

export interface SourceProgress {
  source: SourceName
  ok: boolean
}

// Off the network, refused (a token or a right to fix in the settings), or anything else
export type SourceFailure = 'network' | 'access' | 'other'

export interface SourceHealth {
  ok: boolean
  at: string | null
  error?: string
  failure?: SourceFailure
  // Not configured yet: the only case that asks you to connect it
  missing?: boolean
}

export interface Meeting {
  title: string
  start: string
  end: string
}

export type HealthLevel = 'ok' | 'weak' | 'alert' | 'positive' | 'unavailable'

// One figure behind a health line: an event and its users, a monitor and its state
export interface HealthItem {
  label: string
  value: string
}

export interface HealthLine {
  source: string
  level: HealthLevel
  text: string
  // Shown only when the line is an alert
  detail: string | null
  url: string | null
  // Absent from the dailies written before lines had figures
  items?: HealthItem[]
}

export type Store = 'app-store' | 'play-store'

export interface StoreReview {
  id: string
  app: string
  store: Store
  rating: number
  title: string | null
  text: string
  author: string
  date: string
  version: string | null
  url: string
}

// What the stores said, and the app and store pairs that did not answer
export interface StoreFeed {
  reviews: StoreReview[]
  failed: Array<{ app: string; store: Store }>
}

// What the daily skill wrote, once Flux checked it
export interface DailyContent {
  generatedAt: string
  intentions: string[]
  // Short titles and unblocking moves, by line id
  titles: Record<string, string>
  unblock: Record<string, string>
  health: HealthLine[]
}

// The run that asks the skill for the generated part of the daily
export interface DailyRun {
  date: string
  status: 'none' | 'running' | 'ready' | 'error'
  error?: string
  content?: DailyContent
}

export interface RefPill {
  ref: string
  url: string | null
}

interface DailyLine {
  // Topic id, or merged:<ref> for a PR no topic holds
  id: string
  topicId: string | null
  live: boolean
  title: string
  // The skill's short title, eight words at most
  short: string | null
  refs: RefPill[]
  url: string | null
}

export type YesterdayKind =
  | 'merged'
  | 'reviewed'
  | 'feedback'
  | 'submitted'
  | 'answered'
  | 'handled'
  | 'closed'
  | 'ticked'

export interface DailyYesterday extends DailyLine {
  kind: YesterdayKind
  at: string
}

export interface DailyIntention extends DailyLine {
  rank: Rank | null
  detail: string | null
  // Done since the morning: the wrap-up moves on to the queue
  done: boolean
}

export interface DailyBlocker extends DailyLine {
  reason: string
  unblock: string | null
}

export interface RankCount {
  rank: Rank
  count: number
  firstId: string
}

export interface DailySheet {
  date: string
  status: DailyRun['status']
  error?: string
  skill: 'missing' | 'ready'
  dailyTime: string
  generatedAt: string | null
  notePath: string | null
  // First day the yesterday block covers: the previous workday
  since: string
  yesterday: DailyYesterday[]
  intentions: DailyIntention[]
  intentionsEdited: boolean
  // What an intention can be picked from: the head of the queue and the work in progress
  candidates: DailyIntention[]
  blockers: DailyBlocker[]
  health: HealthLine[] | null
  // Reviews posted since the previous workday; null when no app is followed
  reviews: StoreFeed | null
  counts: RankCount[]
}

export interface MergedPr {
  ref: string
  title: string
  url: string
  mergedAt: string
}

// How a task of the day got done: merged, closed in Flux, its ask left the queue, or ticked by hand
export type WrapupOutcome = 'merged' | 'closed' | 'handled' | 'ticked'

interface WrapupLine {
  id: string
  // Null for a merged PR no topic holds
  topicId: string | null
  // Still open in Flux, so the line can select it
  live: boolean
  ref: string | null
  title: string
  detail: string | null
  url: string | null
}

export interface WrapupDone extends WrapupLine {
  outcome: WrapupOutcome
  at: string
  // Settled by the source itself, a merge or an ask that left: the box stays ticked
  locked: boolean
}

export interface WrapupFocus extends WrapupLine {
  rank: Rank | null
  since: string | null
}

export interface WrapupView {
  date: string
  // Latest reminder time reached today, and the one after it
  slot: string | null
  next: string | null
  done: WrapupDone[]
  focus: WrapupFocus[]
}

export interface WorkspaceInfo {
  id: string
  label: string
  short: string
}

export interface AppState {
  generatedAt: string
  // Product Flux currently shows; null when no workspace is configured
  workspace: string | null
  workspaces: WorkspaceInfo[]
  queue: TopicView[]
  active: TopicView[]
  waiting: TopicView[]
  dormant: TopicView[]
  loose: Item[]
  // Only the sources in use: a tool you did not choose never asks to be connected
  sources: Partial<Record<SourceName, SourceHealth>>
  meeting: { current: Meeting | null; next: Meeting | null }
  daily: DailySheet
  wrapup: WrapupView
}

// A Jira project or Linear team you follow: each one becomes a workspace you switch to
export interface TrackedProject {
  tracker: TrackerName
  // Project or team key, e.g. WEB or APP
  key: string
  name: string
  // GitHub repos (owner/name) whose PRs belong to this project
  repos: string[]
  // Subset of repos where your PRs merge without a review
  noReview: string[]
}

export interface ProjectOption {
  tracker: TrackerName
  key: string
  name: string
}

export interface ProjectOptions {
  projects: ProjectOption[]
  // Repos you recently had PRs in, owner/name
  repos: string[]
  // One line per tool that could not be listed
  errors: string[]
}

export interface Settings {
  dailyTime: string
  wrapupTimes: string[]
  captureShortcut: string
  workdayStart: number
  workdayEnd: number
  hasLinearKey: boolean
  hasCalendarUrl: boolean
  hasJiraToken: boolean
  hasFigmaToken: boolean
  // Figma teams whose recent files Flux reads for comments
  figmaTeams: string[]
  jiraEmail: string
  // Atlassian site, e.g. https://acme.atlassian.net; empty when not configured
  jiraSite: string
  // Project tools you chose, in the order you added them
  trackers: TrackerName[]
  // Calendar whose iCal link Flux reads; null when you use none
  calendar: CalendarName | null
  onboarded: boolean
  // gh login Flux reads GitHub as; null follows gh's active account
  githubAccount: string | null
  workspace: string | null
  // null until chosen in the app: the workspaces of config.json apply
  projects: TrackedProject[] | null
}

export interface SettingsPatch {
  dailyTime?: string
  wrapupTimes?: string[]
  captureShortcut?: string
  linearKey?: string
  calendarUrl?: string
  jiraEmail?: string
  jiraToken?: string
  jiraSite?: string
  figmaToken?: string
  figmaTeams?: string[]
  trackers?: TrackerName[]
  calendar?: CalendarName | 'none'
  workspace?: string
  onboarded?: boolean
  githubAccount?: string | null
  projects?: TrackedProject[]
}

export interface GithubAccounts {
  host: string
  // Logins gh is signed in with on that host, gh's active one first
  logins: string[]
  active: string | null
  profiles: Record<string, GithubProfile>
}

export interface GithubProfile {
  name: string | null
  // Data URL, so the renderer never loads remote images
  avatar: string | null
}

export interface CheckResult {
  ok: boolean
  detail: string
}

// The macOS permission for Flux notifications; unsupported when it cannot be read
export type NotificationAccess =
  | 'not-determined'
  | 'denied'
  | 'authorized'
  | 'provisional'
  | 'unsupported'

export interface FluxApi {
  getState(): Promise<AppState>
  onState(listener: (state: AppState) => void): () => void
  // Refetches every source now and resolves once the new state is out
  refreshAll(): Promise<void>
  onProgress(listener: (progress: SourceProgress) => void): () => void
  onOpenTopic(listener: (id: string) => void): () => void
  onOpenDaily(listener: () => void): () => void
  onOpenWrapup(listener: () => void): () => void
  // A flux:// link opened from outside: the one waiting at launch, then each new one
  takeLink(): Promise<string | null>
  onOpenLink(listener: (link: string) => void): () => void
  // The native right-click menu that copies a line's links
  showLinkMenu(menu: LinkMenu): Promise<void>
  // Ticks or unticks a wrap-up line: a free task closes, a closed topic reopens
  checkWrapup(id: string, done: boolean): Promise<void>
  onRefreshShortcut(listener: () => void): () => void
  refresh(): Promise<void>
  createNote(text: string): Promise<void>
  openCapture(): Promise<void>
  closeCapture(): Promise<void>
  updateTopic(
    id: string,
    patch: Partial<Pick<Topic, 'title' | 'body' | 'status' | 'blocked' | 'links'>>,
  ): Promise<void>
  closeTopic(id: string): Promise<void>
  launchThread(id: string, action: ProposedAction): Promise<void>
  focusThread(id: string, session: string): Promise<void>
  openExternal(url: string): Promise<void>
  getSettings(): Promise<Settings>
  saveSettings(patch: SettingsPatch): Promise<void>
  testNotification(): Promise<void>
  openNotificationSettings(): Promise<void>
  notificationAccess(): Promise<NotificationAccess>
  requestNotificationAccess(): Promise<NotificationAccess>
  checkGithub(): Promise<CheckResult>
  githubAccounts(): Promise<GithubAccounts>
  checkLinearKey(key: string): Promise<CheckResult>
  checkJira(site: string, email: string, token: string): Promise<CheckResult>
  checkFigma(token: string, teams: string[]): Promise<CheckResult>
  // Cached a couple of minutes unless forced
  myPulls(force?: boolean): Promise<MyPulls>
  listProjects(): Promise<ProjectOptions>
  checkCalendarUrl(url: string): Promise<CheckResult>
  runDaily(): Promise<void>
  openDaily(): Promise<void>
  // Today's intentions, in order; the wrap-up puts them first in its focus
  setIntentions(ids: string[]): Promise<void>
  // Writes the generic daily skill where the config expects it, never over an existing file
  useDailyTemplate(): Promise<CheckResult>
  // Opens a Claude Desktop session that writes the daily skill with the user
  createDailySkill(): Promise<void>
  // The Claude jobs Flux runs, with the skills and MCP servers they can use
  jobs(): Promise<JobBoard>
  onJobs(listener: (board: JobBoard) => void): () => void
  saveJob(id: string | null, draft: JobDraft): Promise<Job>
  removeJob(id: string): Promise<void>
  enableJob(id: string, enabled: boolean): Promise<void>
  // Resolves once the run has started
  runJob(id: string): Promise<void>
  // Asks Claude again which MCP servers it loads
  refreshMcps(): Promise<void>
  // Opens a run's session in Claude Desktop
  openJobRun(session: string): Promise<void>
  pickFolder(current: string): Promise<string | null>
  // Your Claude Code skills, last used first; the transcripts are read behind
  skills(): Promise<SkillBoard>
  onSkills(listener: (board: SkillBoard) => void): () => void
  // A skill's content and versions; a skill of yours seen for the first time gets its v1
  skillDetail(id: string): Promise<SkillDetail>
  skillVersion(id: string, n: number): Promise<string>
  // The file as it is becomes the next version, the one before is read only
  validateSkill(id: string): Promise<SkillDetail>
  // Opens a Claude Desktop session that edits the skill with you
  editSkill(id: string): Promise<void>
  // The last list of MCP servers; a new one is checked behind once it is old
  mcpServers(): Promise<McpBoard>
  onMcpServers(listener: (board: McpBoard) => void): () => void
  checkMcpServers(): Promise<void>
  // Signs in a server that waits for it, checks any other again
  reconnectMcp(name: string): Promise<McpEntry>
  removeMcp(name: string): Promise<void>
  addMcp(draft: McpDraft): Promise<void>
}
