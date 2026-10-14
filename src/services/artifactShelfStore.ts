export type ArtifactShelfSnapshot = {
  count: number
  pending: boolean
  available: boolean
}

const EMPTY_SNAPSHOT: ArtifactShelfSnapshot = { count: 0, pending: false, available: false }
const snapshots = new Map<string, ArtifactShelfSnapshot>()
const snapshotPublishers = new Map<string, Map<symbol, ArtifactShelfSnapshot>>()
const listeners = new Map<string, Set<() => void>>()
type ArtifactShelfOpener = {
  open: () => void
  isActive: () => boolean
}

const openHandlers = new Map<string, Set<ArtifactShelfOpener>>()
const legacySnapshotSource = Symbol('legacy-artifact-shelf')

function publishAggregatedSnapshot(workspaceId: string) {
  const publishers = snapshotPublishers.get(workspaceId)
  const values = publishers ? [...publishers.values()] : []
  const next = values.length > 0 ? {
    count: Math.max(...values.map((item) => item.count)),
    pending: values.some((item) => item.pending),
    available: values.some((item) => item.available),
  } : EMPTY_SNAPSHOT
  const current = snapshots.get(workspaceId) || EMPTY_SNAPSHOT
  if (current.count === next.count && current.pending === next.pending && current.available === next.available) return
  if (values.length > 0) snapshots.set(workspaceId, next)
  else snapshots.delete(workspaceId)
  listeners.get(workspaceId)?.forEach((listener) => listener())
}

/** 发布当前会话产物摘要，供办公室家具和多空间视图复用。 */
export function setArtifactShelfSnapshot(next: ArtifactShelfSnapshot, workspaceId = 'main', source = legacySnapshotSource) {
  const publishers = snapshotPublishers.get(workspaceId) ?? new Map<symbol, ArtifactShelfSnapshot>()
  publishers.set(source, next)
  snapshotPublishers.set(workspaceId, publishers)
  publishAggregatedSnapshot(workspaceId)
}

/** 移除单个 Dock 发布的摘要；其它仍存活实例继续维持货架状态。 */
export function removeArtifactShelfSnapshot(workspaceId = 'main', source = legacySnapshotSource) {
  const publishers = snapshotPublishers.get(workspaceId)
  if (!publishers) return
  publishers.delete(source)
  if (publishers.size === 0) snapshotPublishers.delete(workspaceId)
  publishAggregatedSnapshot(workspaceId)
}

export function getArtifactShelfSnapshot(workspaceId = 'main') {
  return snapshots.get(workspaceId) || EMPTY_SNAPSHOT
}

export function subscribeArtifactShelf(listener: () => void, workspaceId = 'main') {
  const workspaceListeners = listeners.get(workspaceId) || new Set<() => void>()
  workspaceListeners.add(listener)
  listeners.set(workspaceId, workspaceListeners)
  return () => {
    workspaceListeners.delete(listener)
    if (workspaceListeners.size === 0) listeners.delete(workspaceId)
  }
}

/** 登记唯一产物清单打开器；组件卸载时只清理自身登记。 */
export function registerArtifactShelfOpener(handler: () => void, workspaceId = 'main', isActive: () => boolean = () => true) {
  const workspaceHandlers = openHandlers.get(workspaceId) ?? new Set<ArtifactShelfOpener>()
  const entry = { open: handler, isActive }
  workspaceHandlers.add(entry)
  openHandlers.set(workspaceId, workspaceHandlers)
  return () => {
    workspaceHandlers.delete(entry)
    if (workspaceHandlers.size === 0) openHandlers.delete(workspaceId)
  }
}

export function openArtifactShelf(workspaceId = 'main') {
  const handlers = openHandlers.get(workspaceId)
  const active = handlers ? [...handlers].reverse().find((entry) => entry.isActive()) : undefined
  active?.open()
}
