import { homedir } from 'node:os'
import { join } from 'node:path'
import { CONFIG } from './config'
import { PROFILE_DIR } from './profile'

const HOME = homedir()

export const BIN = {
  gh: '/opt/homebrew/bin/gh',
  git: '/usr/bin/git',
  osascript: '/usr/bin/osascript',
  open: '/usr/bin/open',
  claude: join(HOME, '.local/bin/claude'),
}

export const VAULT = CONFIG.paths.vault
export const TOPICS_DIR = join(VAULT, 'flux')
export const ARCHIVE_DIR = join(TOPICS_DIR, 'archive')
export const DAILY_DIR = join(VAULT, 'daily')
export const REPOS_DIR = CONFIG.paths.repos
export const DAILY_COMMAND = CONFIG.paths.dailyCommand
export const CLAUDE_PROJECTS_DIR = join(HOME, '.claude/projects')
// Claude Desktop's record of each Code session: its own id, its conversation id, its title
export const DESKTOP_SESSIONS_DIR = join(HOME, 'Library/Application Support/Claude/claude-code-sessions')

// Each profile keeps its own state: ~/.flux for Pro, ~/.flux/profiles/perso for Perso
export const STATE_DIR = PROFILE_DIR
export const SNAPSHOT_FILE = join(STATE_DIR, 'snapshot.json')
export const NOTIFY_FILE = join(STATE_DIR, 'notify.json')
export const SETTINGS_FILE = join(STATE_DIR, 'settings.json')
export const SECRETS_FILE = join(STATE_DIR, 'secrets.json')
export const TRIAGE_FILE = join(STATE_DIR, 'triage.json')
export const TRIAGE_ASKED_FILE = join(STATE_DIR, 'triage-asked.json')
// What Figma last answered: teams, files and the comments waiting on you
export const FIGMA_FILE = join(STATE_DIR, 'figma.json')
// One wrap-up journal per day, named after its date
export const WRAPUP_DIR = join(STATE_DIR, 'wrapup')
// What the daily skill wrote, one file per day
export const DAILY_STATE_DIR = join(STATE_DIR, 'daily')
export const DAILY_SKILL_DIR = join(STATE_DIR, 'daily-skill')
export const THREADS_DIR = join(STATE_DIR, 'threads')
// The Claude jobs Flux runs, their last runs, and the MCP servers Claude knows
export const JOBS_FILE = join(STATE_DIR, 'jobs.json')
