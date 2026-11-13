import { Layers } from 'lucide-react'
import type { WorkspaceInfo } from '../../shared/types'
import { useSlidingThumb } from './SlidingThumb'

// The projects toggle next to the logo: a pill slides under the chosen project
export function WorkspaceSwitch({
  workspaces,
  current,
  onPick,
  onManage,
}: {
  workspaces: WorkspaceInfo[]
  current: string | null
  onPick(id: string): void
  onManage(): void
}) {
  const { register, thumb } = useSlidingThumb(current, [workspaces])

  return (
    <nav className="tabs sliding glass lens workspace-switch" aria-label="Espace de travail">
      {thumb}
      {workspaces.map(workspace => (
        <button
          type="button"
          key={workspace.id}
          ref={register(workspace.id)}
          title={workspace.label}
          aria-current={current === workspace.id ? 'page' : undefined}
          onClick={() => onPick(workspace.id)}
        >
          {workspace.short}
        </button>
      ))}
      <button
        type="button"
        className="workspace-manage"
        aria-label="Gérer les espaces"
        title="Gérer les espaces"
        onClick={onManage}
      >
        <Layers size={13} aria-hidden="true" />
      </button>
    </nav>
  )
}
