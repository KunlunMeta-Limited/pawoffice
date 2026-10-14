import type { Agent } from '@/types/agent'
import { INITIAL_AGENTS } from '@/scene/layout/officeLayout'

let agents: Agent[] = INITIAL_AGENTS.map((a) => ({ ...a }))
let statusSnapshot: Agent[] = agents
let statusSignature = ''
const statusListeners = new Set<() => void>()

export function getOfficeAgents(): Agent[] {
  return agents
}

/** 返回仅在人物状态或任务文本变化时更新的稳定快照，供 React 面板订阅。 */
export function getOfficeAgentStatusSnapshot(): Agent[] {
  return statusSnapshot
}

/** 订阅人物状态变化；位置逐帧变化不会触发 React 重渲染。 */
export function subscribeOfficeAgents(listener: () => void) {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function setOfficeAgents(nextAgents: Agent[]) {
  agents = nextAgents
  const nextSignature = nextAgents
    .map((agent) => {
      const mission = agent.mission
      const missionKey = mission
        ? `${mission.phase}:${mission.hostAgentId}:${mission.queue.map((stop) => stop.hostAgentId).join(',')}`
        : ''
      return `${agent.id}:${agent.state}:${agent.currentTask ?? ''}:${missionKey}`
    })
    .join('|')
  if (nextSignature === statusSignature) return
  statusSignature = nextSignature
  statusSnapshot = nextAgents.map((agent) => ({ ...agent }))
  statusListeners.forEach((listener) => listener())
}
