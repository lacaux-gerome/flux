import { useEffect, useState } from 'react'
import type { McpBoard, SkillBoard } from '../../shared/claude'
import type { JobBoard } from '../../shared/jobs'
import type { DailySheet } from '../../shared/types'
import { JobsPanel } from './JobsPanel'
import { McpPanel } from './McpPanel'
import { SkillsPanel } from './SkillsPanel'

export type ClaudePart = 'skills' | 'mcp' | 'tasks'

const PARTS: Array<{ key: ClaudePart; label: string }> = [
  { key: 'skills', label: 'Skills' },
  { key: 'mcp', label: 'MCP' },
  { key: 'tasks', label: 'Tâches' },
]

// Skills, MCP servers and scheduled tasks: what Claude does for you, in one place
export function ClaudeSpace({
  jobs,
  daily,
  part,
  onPart,
  onOpenDay,
  onToast,
}: {
  jobs: JobBoard | null
  daily: DailySheet
  part: ClaudePart
  onPart(part: ClaudePart): void
  onOpenDay(): void
  onToast(message: string, kind?: 'error'): void
}) {
  const [skills, setSkills] = useState<SkillBoard | null>(null)
  const [mcps, setMcps] = useState<McpBoard | null>(null)
  const [openSkill, setOpenSkill] = useState<string | null>(null)
  const fail = (error: unknown) => onToast((error as Error).message, 'error')

  useEffect(() => window.flux.onSkills(setSkills), [])
  useEffect(() => window.flux.onMcpServers(setMcps), [])
  // Each part reads again when it opens: the skills from disk, the servers once their list is old
  useEffect(() => {
    if (part === 'skills') void window.flux.skills().then(setSkills).catch(fail)
    if (part === 'mcp') void window.flux.mcpServers().then(setMcps).catch(fail)
  }, [part])

  // An open skill takes the room its graph needs
  const wide = part === 'skills' && openSkill !== null

  return (
    <main className="page">
      <div className={`page-column claude-space${wide ? ' wide' : ''}`}>
        <nav className="tabs glass day-tabs" aria-label="Parties de Claude">
          {PARTS.map(entry => (
            <button
              type="button"
              key={entry.key}
              aria-current={part === entry.key ? 'page' : undefined}
              onClick={() => {
                onPart(entry.key)
                if (entry.key === 'skills') setOpenSkill(null)
              }}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        {part === 'skills' ? (
          <SkillsPanel board={skills} openId={openSkill} onOpen={setOpenSkill} onToast={onToast} />
        ) : part === 'mcp' ? (
          <McpPanel board={mcps} onToast={onToast} />
        ) : (
          <JobsPanel
            board={jobs}
            daily={daily}
            onOpenSkill={name => {
              const found = skills?.skills.find(skill => skill.name === name)
              setOpenSkill(found?.id ?? `command:${name}`)
              onPart('skills')
            }}
            onOpenDay={onOpenDay}
            onToast={onToast}
          />
        )}
      </div>
    </main>
  )
}
