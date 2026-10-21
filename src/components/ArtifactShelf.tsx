import { useSyncExternalStore } from 'react'
import {
  getArtifactShelfSnapshot,
  openArtifactShelf,
  subscribeArtifactShelf,
} from '@/services/artifactShelfStore'

type ArtifactShelfProps = {
  variant?: 'wall' | 'inline' | 'mini'
  owner?: string
  workspaceId?: string
}

/** 场景内产物家具；数据和打开行为由当前对话产物控制器提供。 */
export function ArtifactShelf({ variant = 'wall', owner, workspaceId = 'main' }: ArtifactShelfProps) {
  const shelf = useSyncExternalStore(
    (listener) => subscribeArtifactShelf(listener, workspaceId),
    () => getArtifactShelfSnapshot(workspaceId),
    () => getArtifactShelfSnapshot(workspaceId),
  )
  const label = owner ? `${owner}的产物货架` : '产物货架'
  return <button
    type="button"
    className={`artifact-shelf-trigger artifact-shelf-${variant}`}
    aria-label={`打开${label}，共 ${shelf.count} 项产物`}
    disabled={!shelf.available}
    onClick={() => openArtifactShelf(workspaceId)}
  >
    <span className="artifact-shelf-sign">产物</span>
    <span className="artifact-shelf-body" aria-hidden="true"><i /><i /><i /><i /><i /></span>
    <span className={`artifact-shelf-light${shelf.pending ? ' is-working' : shelf.count ? ' has-output' : ''}`} aria-hidden="true" />
    <span className="artifact-shelf-count">{shelf.count}</span>
  </button>
}
