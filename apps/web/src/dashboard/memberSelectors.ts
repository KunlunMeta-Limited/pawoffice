import type { DashboardSnapshot, DashboardTask } from '@pawoffice/protocol/dashboard'
import { maxOfficeMembers } from '@pawoffice/protocol/dashboard'

export type MemberRosterActor = { id: string; name: string }

/** Keep the room's six characters visible; business bindings only supply identity and presence. */
export function memberRoster(dashboard: DashboardSnapshot | null, actors: readonly MemberRosterActor[], preferredEmployeeId = '') {
  return actors.slice(0, maxOfficeMembers).map(actor => ({ ...actor,
    employee: employeeForActor(dashboard, actor.id, preferredEmployeeId),
    active: dashboard?.employees.some(employee => employee.sceneActorId === actor.id && employee.online === true) ?? false,
  }))
}

const rank: Record<DashboardTask['status'], number> = { running: 0, blocked: 1, queued: 2, failed: 3, completed: 4 }
export const memberTaskStatuses: Record<DashboardTask['status'], string> = { running: '进行中', blocked: '待处理', queued: '待开始', failed: '失败', completed: '已完成' }

export function memberOverview(dashboard: DashboardSnapshot, employeeId: string) {
  const tasks = dashboard.tasks.filter(task => task.assigneeId === employeeId)
    .sort((a, b) => rank[a.status] - rank[b.status] || Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  const taskIds = new Set(tasks.map(task => task.id))
  const events = dashboard.events.filter(event => event.employeeId === employeeId || event.fromEmployeeId === employeeId || (!event.employeeId && !!event.taskId && taskIds.has(event.taskId)))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
  return { tasks, events, currentTask: tasks[0], total: tasks.length,
    running: tasks.filter(task => task.status === 'running').length,
    completed: tasks.filter(task => task.status === 'completed').length }
}

export function employeeForActor(dashboard: DashboardSnapshot | null, actorId: string, preferredId = '') {
  const employees = dashboard?.employees.filter(employee => employee.sceneActorId === actorId) ?? []
  return employees.find(employee => employee.id === preferredId) ?? employees[0]
}

export function memberProgress(task: DashboardTask): number {
  if (task.status === 'completed') return 100
  return Math.max(0, Math.min(99, task.progress ?? 0))
}

export function memberTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
