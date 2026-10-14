/**
 * 功能：把 Gateway 拉取的拜访动作转换为按 Agent 空间隔离的 OfficeScene 串行任务。
 * 输入输出边界：输入为 `/actions` 的拜访消息，输出为对应 workspaceId 的 SceneBridge 调用。
 * 设计约束：每个空间独立维护 FIFO、执行锁和统计；不同空间可并行，同一空间始终串行。
 * 关联：`API-OFFICE-ACTION-001`、`REQ-B-OFFICE-003`、`CHG-2026-0004`。
 */
import { OFFICE_DISPATCH_MODE, type OfficeDispatchMode } from '@/config/officeMode'
import {
  getOfficeSceneAgents,
  isOfficeSceneReady,
  requestDeskVisit,
  requestDeskVisitTour,
} from '@/scene/officeSceneBridge'
import type { Agent } from '@/types/agent'
import type { OfficeActionDeskVisit, OfficeActionDeskVisitTour } from '@/types/officeAction'

export type VisitActionMessage = OfficeActionDeskVisit | OfficeActionDeskVisitTour

type QueuedVisit = {
  message: VisitActionMessage
  messageFn?: (hostRosterNo: number, hostName: string) => string
}

type DispatchState = {
  visitQueue: QueuedVisit[]
  dispatchLocked: boolean
  activeVisitorNo: number | null
  activeTargetRosterNos: Set<number>
  wasMissionBusy: boolean
  skippedCount: number
  invalidCount: number
  completedCount: number
}

const ROSTER_MIN = 1
const ROSTER_MAX = 6
const dispatchStates = new Map<string, DispatchState>()

function stateFor(workspaceId: string) {
  let state = dispatchStates.get(workspaceId)
  if (!state) {
    state = {
      visitQueue: [],
      dispatchLocked: false,
      activeVisitorNo: null,
      activeTargetRosterNos: new Set(),
      wasMissionBusy: false,
      skippedCount: 0,
      invalidCount: 0,
      completedCount: 0,
    }
    dispatchStates.set(workspaceId, state)
  }
  return state
}

function hasActiveVisitMission(agents: Agent[]): boolean {
  return agents.some((agent) => agent.mission?.kind === 'desk_visit')
}

function isDispatchBusy(state: DispatchState, agents: Agent[]): boolean {
  return state.dispatchLocked || hasActiveVisitMission(agents)
}

function visitTargets(message: VisitActionMessage): number[] {
  return message.type === 'desk_visit' ? [message.host] : message.hosts
}

function normalizeVisitMessage(message: VisitActionMessage): VisitActionMessage | null {
  if (message.type === 'desk_visit') {
    if (message.visitor < ROSTER_MIN || message.visitor > ROSTER_MAX
      || message.host < ROSTER_MIN || message.host > ROSTER_MAX
      || message.visitor === message.host) return null
    return message
  }

  const hosts = message.hosts.filter((host) => host >= ROSTER_MIN && host <= ROSTER_MAX && host !== message.visitor)
  if (message.visitor < ROSTER_MIN || message.visitor > ROSTER_MAX || hosts.length === 0) return null
  return { ...message, hosts }
}

function executeVisit(
  workspaceId: string,
  state: DispatchState,
  message: VisitActionMessage,
  messageFn?: (hostRosterNo: number, hostName: string) => string,
) {
  state.dispatchLocked = true
  state.activeVisitorNo = message.visitor
  state.activeTargetRosterNos.clear()
  visitTargets(message).forEach((host) => state.activeTargetRosterNos.add(host))

  if (message.type === 'desk_visit') {
    requestDeskVisit(message.visitor, message.host, message.message, workspaceId)
  } else {
    requestDeskVisitTour(
      message.visitor,
      message.hosts,
      messageFn ?? (message.message ? () => message.message! : undefined),
      workspaceId,
    )
  }
}

function tryDrainQueue(workspaceId: string, currentAgents?: Agent[]) {
  if (OFFICE_DISPATCH_MODE === 'skip') return
  const state = stateFor(workspaceId)
  const agents = currentAgents ?? getOfficeSceneAgents(workspaceId) ?? []
  if (isDispatchBusy(state, agents)) return

  while (state.visitQueue.length > 0) {
    const queued = state.visitQueue.shift()!
    const normalized = normalizeVisitMessage(queued.message)
    if (!normalized) {
      state.invalidCount += 1
      console.warn('[OfficeDispatch] invalid visit command, skipped', queued.message, { workspaceId })
      continue
    }
    console.info('[OfficeDispatch] executing', normalized, { workspaceId, remaining: state.visitQueue.length, completed: state.completedCount })
    executeVisit(workspaceId, state, normalized, queued.messageFn)
    return
  }
}

/** 提交一条拜访动作；不同 workspaceId 使用不同队列和执行锁。 */
export function submitVisitAction(
  message: VisitActionMessage,
  options?: {
    messageFn?: (hostRosterNo: number, hostName: string) => string
    workspaceId?: string
  },
) {
  const workspaceId = options?.workspaceId || message.workspaceId || 'main'
  const state = stateFor(workspaceId)
  const normalized = normalizeVisitMessage(message)
  if (!normalized) {
    state.invalidCount += 1
    console.warn('[OfficeDispatch] invalid visit command, rejected', message, { workspaceId })
    return
  }

  if (!isOfficeSceneReady(workspaceId)) {
    if (normalized.type === 'desk_visit') {
      requestDeskVisit(normalized.visitor, normalized.host, normalized.message, workspaceId)
    } else {
      requestDeskVisitTour(normalized.visitor, normalized.hosts, options?.messageFn, workspaceId)
    }
    return
  }

  const agents = getOfficeSceneAgents(workspaceId) ?? []
  const busy = isDispatchBusy(state, agents)
  if (OFFICE_DISPATCH_MODE === 'queue'
    && busy
    && state.visitQueue.length === 0
    && state.activeVisitorNo === normalized.visitor
    && !visitTargets(normalized).some((host) => state.activeTargetRosterNos.has(host))) {
    if (normalized.type === 'desk_visit') {
      requestDeskVisit(normalized.visitor, normalized.host, normalized.message, workspaceId)
    } else {
      requestDeskVisitTour(normalized.visitor, normalized.hosts, options?.messageFn, workspaceId)
    }
    visitTargets(normalized).forEach((host) => state.activeTargetRosterNos.add(host))
    console.info('[OfficeDispatch] appended to active visit mission', normalized, { workspaceId })
    return
  }

  if (OFFICE_DISPATCH_MODE === 'skip') {
    if (busy) {
      state.skippedCount += 1
      console.info('[OfficeDispatch] skip: dropped (busy)', normalized, { workspaceId, skippedCount: state.skippedCount })
      return
    }
    executeVisit(workspaceId, state, normalized, options?.messageFn)
    return
  }

  if (OFFICE_DISPATCH_MODE === 'hybrid' && busy) {
    state.skippedCount += 1
    console.info('[OfficeDispatch] hybrid: dropped (busy)', normalized, { workspaceId, skippedCount: state.skippedCount })
    return
  }

  state.visitQueue.push({ message: normalized, messageFn: options?.messageFn })
  console.info('[OfficeDispatch] queue: enqueued', normalized, { workspaceId, depth: state.visitQueue.length, mode: OFFICE_DISPATCH_MODE })
  if (!busy) tryDrainQueue(workspaceId)
}

/** 由对应空间的场景帧回报 mission 状态并消费该空间的下一条 FIFO。 */
export function notifyVisitMissionActivity(agents: Agent[], workspaceId = 'main') {
  const state = stateFor(workspaceId)
  const busy = hasActiveVisitMission(agents)
  if (state.wasMissionBusy && !busy) {
    state.dispatchLocked = false
    state.activeVisitorNo = null
    state.activeTargetRosterNos.clear()
    state.completedCount += 1
    console.info('[OfficeDispatch] mission completed', { workspaceId, completed: state.completedCount, pending: state.visitQueue.length })
    tryDrainQueue(workspaceId, agents)
  } else if (!busy && state.visitQueue.length > 0 && state.dispatchLocked
    && (OFFICE_DISPATCH_MODE === 'queue' || OFFICE_DISPATCH_MODE === 'hybrid')) {
    state.dispatchLocked = false
    state.activeVisitorNo = null
    state.activeTargetRosterNos.clear()
    tryDrainQueue(workspaceId, agents)
  }
  if (busy) state.dispatchLocked = true
  state.wasMissionBusy = busy
}

/** 返回指定空间的拜访调度统计。 */
export function getDispatchStats(workspaceId = 'main'): {
  mode: OfficeDispatchMode
  queueDepth: number
  executing: boolean
  skippedCount: number
  invalidCount: number
  completedCount: number
} {
  const state = stateFor(workspaceId)
  return {
    mode: OFFICE_DISPATCH_MODE,
    queueDepth: state.visitQueue.length,
    executing: isDispatchBusy(state, getOfficeSceneAgents(workspaceId) ?? []),
    skippedCount: state.skippedCount,
    invalidCount: state.invalidCount,
    completedCount: state.completedCount,
  }
}

/** 判断指定空间的名册角色是否参与当前或待执行拜访。 */
export function isVisitParticipantPending(rosterNo: number, workspaceId = 'main'): boolean {
  const state = stateFor(workspaceId)
  if (state.activeVisitorNo === rosterNo || state.activeTargetRosterNos.has(rosterNo)) return true
  return state.visitQueue.some(({ message }) => message.visitor === rosterNo || visitTargets(message).includes(rosterNo))
}

/** 判断指定空间的角色是否正在执行或等待发起下一段交接。 */
export function isVisitVisitorPending(rosterNo: number, workspaceId = 'main'): boolean {
  const state = stateFor(workspaceId)
  if (state.activeVisitorNo === rosterNo) return true
  return state.visitQueue.some(({ message }) => message.visitor === rosterNo)
}

/** 清理调度内存；测试和热重载使用。 */
export function resetOfficeActionDispatcher(workspaceId?: string) {
  if (workspaceId) dispatchStates.delete(workspaceId)
  else dispatchStates.clear()
}

/** 将机器调度模式转换为面向用户的中文标签。 */
export function dispatchModeLabel(mode: OfficeDispatchMode): string {
  if (mode === 'queue') return '队列（不丢）'
  if (mode === 'skip') return '省略（繁忙丢弃）'
  return '混合（繁忙丢/空闲串行）'
}
