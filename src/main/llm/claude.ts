import { run } from '../exec'
import { BIN } from '../paths'

export interface ClaudeRequest {
  model: string
  prompt: string
  system?: string
  args?: string[]
  cwd?: string
  timeoutMs: number
}

export interface ClaudeResult {
  text: string
  costUsd: number
}

const NON_SUBSCRIPTION_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
]

interface AuthStatus {
  loggedIn?: boolean
  authMethod?: string
  apiProvider?: string
  subscriptionType?: string
}

// Claude on your session, never on an API key; enough for the CLI commands that ask no model
export function subscriptionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  NON_SUBSCRIPTION_ENV.forEach(name => delete env[name])
  return env
}

export function isMaxSession(status: AuthStatus): boolean {
  return (
    status.loggedIn === true &&
    status.authMethod === 'claude.ai' &&
    status.apiProvider === 'firstParty' &&
    status.subscriptionType === 'max'
  )
}

async function requireMaxSession(env: NodeJS.ProcessEnv): Promise<void> {
  const output = await run(BIN.claude, ['auth', 'status'], { env, timeoutMs: 15_000 })
  if (!isMaxSession(JSON.parse(output) as AuthStatus)) {
    throw new Error('Flux ne passe que par ta session Claude Max : reconnecte-la avec claude auth login')
  }
}

// The environment of a claude run on your Max session, never on an API key
export async function claudeEnv(): Promise<NodeJS.ProcessEnv> {
  const env = subscriptionEnv()
  await requireMaxSession(env)
  return env
}

export async function askClaude(request: ClaudeRequest): Promise<ClaudeResult> {
  const env = await claudeEnv()
  const output = await run(
    BIN.claude,
    [
      '-p',
      '--no-session-persistence',
      '--settings',
      '{"disableAllHooks":true}',
      '--output-format',
      'json',
      '--model',
      request.model,
      ...(request.system ? ['--system-prompt', request.system] : []),
      ...(request.args ?? []),
    ],
    { input: request.prompt, cwd: request.cwd, env, timeoutMs: request.timeoutMs },
  )
  const payload = JSON.parse(output) as {
    result?: string
    subtype?: string
    is_error?: boolean
    total_cost_usd?: number
  }
  if (payload.is_error || payload.result === undefined) {
    throw new Error(payload.result || payload.subtype || 'Réponse Claude vide')
  }
  return { text: payload.result, costUsd: payload.total_cost_usd ?? 0 }
}
