import { canonical } from '@pawoffice/protocol'
import type { OfficeSnapshot } from '@pawoffice/protocol/office-integration'
import { OFFICE_ROSTER } from '@pawoffice/scene-office/core/roster'
import { maxRelayEventBytes, maxRelayTeams } from '@pawoffice/protocol/relay'

function assertResultHistory(previous: OfficeSnapshot, next: OfficeSnapshot) {
  for (const conversation of next.conversations) {
    const old = previous.conversations.find(item => item.id === conversation.id)
    if (!old) continue
    const priorDeliveries = new Map(old.whiteboard.deliveries.map(delivery => [delivery.id, delivery]))
    for (const delivery of conversation.whiteboard.deliveries) {
      const prior = priorDeliveries.get(delivery.id)
      if (prior && (prior.sequence !== delivery.sequence || prior.createdAt !== delivery.createdAt || prior.turnId !== delivery.turnId
        || (prior.result && delivery.result && canonical(prior.result) !== canonical(delivery.result)))) {
        throw new OfficeStateFault(409, 'RESULT_HISTORY_CONFLICT', '已交付的历史记录不能覆盖，请使用新的交付 id')
      }
    }
    const artifacts = (board: typeof conversation.whiteboard) => [board.result, ...board.deliveries.flatMap(delivery => delivery.result ? [delivery.result] : [])].flatMap(result => result.artifacts)
    const revisions = new Map(artifacts(old.whiteboard).filter(artifact => artifact.versionId).map(artifact => [JSON.stringify([artifact.id, artifact.versionId]), artifact]))
    for (const artifact of artifacts(conversation.whiteboard)) {
      if (!artifact.versionId) continue
      const prior = revisions.get(JSON.stringify([artifact.id, artifact.versionId]))
      if (prior && (prior.content !== artifact.content || prior.mimeType !== artifact.mimeType || prior.sha256 !== artifact.sha256
        || (!artifact.sha256 && prior.url !== artifact.url))) {
        throw new OfficeStateFault(409, 'RESULT_HISTORY_CONFLICT', '产物版本内容不可覆盖，请使用新的 versionId')
      }
    }
  }
}

export class OfficeStateFault extends Error {
  constructor(readonly code: number, readonly reasonCode: string, message: string) { super(message) }
}

/** Latest business state only. No animation history or offline command queue. */
export class OfficeState {
  private snapshots = new Map<string, OfficeSnapshot>()
  constructor(private readonly maxBytes = 8 * 1024 * 1024) {}
  list() { return structuredClone([...this.snapshots.values()]) }
  get(id: string) { const snapshot = this.snapshots.get(id); return snapshot && structuredClone(snapshot) }
  apply(snapshots: OfficeSnapshot[], requireExisting = false) {
    const next = new Map(this.snapshots), accepted: OfficeSnapshot[] = [], results: { teamId: string; seq: number; status: 'cached' | 'ignored'; reasonCode?: 'STALE_SEQ' | 'DUPLICATE_SEQ' }[] = []
    const actors = new Set(OFFICE_ROSTER.map(actor => actor.id))
    for (const snapshot of snapshots) {
      if (Buffer.byteLength(JSON.stringify(snapshot)) > maxRelayEventBytes - 1024) throw new OfficeStateFault(413, 'MESSAGE_TOO_LARGE', '补齐默认字段后的办公室快照过大')
      const id = snapshot.workspace.id, previous = next.get(id)
      if (requireExisting && !previous) throw new OfficeStateFault(404, 'OFFICE_NOT_INITIALIZED', '办公室未初始化')
      if (snapshot.conversations.some(conversation => conversation.employees.some(employee => employee.sceneActorId && !actors.has(employee.sceneActorId)))) throw new OfficeStateFault(422, 'INVALID_BINDING', '绑定了不存在的场景人物')
      if (previous && snapshot.seq <= previous.seq) {
        if (snapshot.seq === previous.seq && canonical(snapshot) !== canonical(previous)) throw new OfficeStateFault(409, 'SEQ_CONFLICT', '相同 seq 不能对应不同快照')
        results.push({ teamId: id, seq: previous.seq, status: 'ignored', reasonCode: snapshot.seq === previous.seq ? 'DUPLICATE_SEQ' : 'STALE_SEQ' })
        continue
      }
      if (previous) assertResultHistory(previous, snapshot)
      next.set(id, structuredClone(snapshot)); accepted.push(snapshot); results.push({ teamId: id, seq: snapshot.seq, status: 'cached' })
    }
    if (next.size > maxRelayTeams) throw new OfficeStateFault(422, 'OFFICE_LIMIT', `最多支持 ${maxRelayTeams} 个办公室`)
    if (Buffer.byteLength(JSON.stringify([...next.values()])) > this.maxBytes) throw new OfficeStateFault(503, 'CACHE_FULL', '办公室快照缓存已满')
    this.snapshots = next
    return { accepted, results }
  }
}
