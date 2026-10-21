/**
 * 功能：为非场景模块提供按 Agent 空间隔离的 OfficeScene 绑定、实时动作和状态桥接。
 * 输入输出边界：输入为 Gateway/Dispatcher 动作，输出为对应 workspaceId 的场景方法调用。
 * 设计约束：瞬时拜访只在场景实时可见时播放；未挂载时只合并角色最新状态，禁止迟到补播。
 * 关联：`API-OFFICE-ACTION-001`、`REQ-B-OFFICE-003`、`CHG-2026-0019`。
 */
import type { OfficeScene } from '@/scene/OfficeScene'
import type { VisitActionMessage } from '@/services/officeActionDispatcher'
import type { Agent, AgentState } from '@/types/agent'

type PendingSetState = {
  agentId: string
  state: AgentState
  task?: string
}

type WorkspaceBridge = {
  scene: OfficeScene | null
  latestStates: Map<string, PendingSetState>
}

const bridges = new Map<string, WorkspaceBridge>()
let visualPaused = false

function bridgeFor(workspaceId: string) {
  let bridge = bridges.get(workspaceId)
  if (!bridge) {
    bridge = { scene: null, latestStates: new Map() }
    bridges.set(workspaceId, bridge)
  }
  return bridge
}

function applyLatestStates(bridge: WorkspaceBridge) {
  if (!bridge.scene) return
  for (const latest of bridge.latestStates.values()) {
    bridge.scene.setAgentState(latest.agentId, latest.state, latest.task)
  }
  bridge.latestStates.clear()
}

/** 绑定或解除指定 Agent 空间的完整办公室场景。 */
export function bindOfficeScene(instance: OfficeScene | null, workspaceId = 'main', owner?: OfficeScene) {
  const bridge = bridgeFor(workspaceId)
  if (!instance) {
    if (owner && bridge.scene !== owner) return
    bridge.scene = null
    return
  }

  bridge.scene = instance
  instance.setVisualPaused(visualPaused)
  applyLatestStates(bridge)
}

/** 返回指定空间当前场景的人物快照；场景未挂载时返回 undefined。 */
export function getOfficeSceneAgents(workspaceId = 'main'): Agent[] | undefined {
  return bridges.get(workspaceId)?.scene?.getAgents()
}

/** 切换所有已挂载办公室的纯视觉暂停，不改写角色业务状态。 */
export function setOfficeScenePaused(paused: boolean) {
  visualPaused = paused
  for (const bridge of bridges.values()) {
    bridge.scene?.setVisualPaused(paused)
    if (!paused) applyLatestStates(bridge)
  }
}

/** 请求指定空间中的一个角色拜访另一个角色。 */
export function requestDeskVisit(
  visitorRosterNo: number,
  hostRosterNo: number,
  message: string,
  workspaceId = 'main',
) {
  const bridge = bridgeFor(workspaceId)
  if (!bridge.scene || visualPaused) {
    console.info('[OfficeHTTP] scene unavailable, skipped expired desk_visit', { workspaceId, visitor: visitorRosterNo, host: hostRosterNo })
    return
  }
  bridge.scene.requestDeskVisit(visitorRosterNo, hostRosterNo, message)
}

/** 请求指定空间中的角色按顺序访问多个目标。 */
export function requestDeskVisitTour(
  visitorRosterNo: number,
  hostRosterNos: number[],
  messageFn?: (hostRosterNo: number, hostName: string) => string,
  workspaceId = 'main',
) {
  const bridge = bridgeFor(workspaceId)
  if (!bridge.scene || visualPaused) {
    console.info('[OfficeHTTP] scene unavailable, skipped expired desk_visit_tour', { workspaceId, visitor: visitorRosterNo, hosts: hostRosterNos })
    return
  }
  bridge.scene.requestDeskVisitTour(visitorRosterNo, hostRosterNos, messageFn)
}

/** 返回指定空间是否已绑定可执行动作的完整办公室。 */
export function isOfficeSceneReady(workspaceId = 'main') {
  return bridges.get(workspaceId)?.scene != null
}

/** 设置指定 Agent 空间中人物的状态。 */
export function setAgentState(agentId: string, state: AgentState, task?: string, workspaceId = 'main') {
  const bridge = bridgeFor(workspaceId)
  if (!bridge.scene) {
    bridge.latestStates.set(agentId, { agentId, state, task })
    console.info('[OfficeHTTP] scene unavailable, merged latest set_state', { workspaceId, agentId, state })
    return
  }
  bridge.scene.setAgentState(agentId, state, task)
}

/** 测试与热重载清理入口；不影响 Gateway 中保存的空间快照。 */
export function resetOfficeSceneBridges() {
  bridges.clear()
  visualPaused = false
}

export type { VisitActionMessage }
