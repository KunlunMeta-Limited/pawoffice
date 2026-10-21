import type { OfficeAgentWorkspaceSummary } from '@/types/officeData'

/** 缺少 workspaceId 的旧动作始终归入主 Agent 空间。 */
export const MAIN_OFFICE_WORKSPACE_ID = 'main'
/** 总览不是 Agent，只是把当前真实存在的 Agent 空间集中展示。 */
export const OFFICE_WORKSPACE_OVERVIEW_ID = 'overview'

export type OfficeWorkspaceId = string

/** 场景动作使用会话与空间复合键；旧动作缺少 sessionId 时保持原 workspaceId 兼容。 */
export function officeSceneScopeId(sessionId: string | null | undefined, workspaceId: string) {
  return sessionId ? `${sessionId}\u0000${workspaceId}` : workspaceId
}

export const MAIN_OFFICE_WORKSPACE: OfficeAgentWorkspaceSummary = {
  id: MAIN_OFFICE_WORKSPACE_ID,
  name: '我的空间',
  kind: 'main',
  updatedAt: 0,
  agents: [],
}

/** 只接受可安全写入浏览器存储和 CSS 标识的空间编号。 */
export function isOfficeWorkspaceId(value: string | null): value is OfficeWorkspaceId {
  return value === 'mine'
    || value === MAIN_OFFICE_WORKSPACE_ID
    || value === OFFICE_WORKSPACE_OVERVIEW_ID
    || Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))
}

/** 兼容旧版本保存的 mine，避免升级后丢失主空间选择。 */
export function normalizeOfficeWorkspaceId(value: string | null): OfficeWorkspaceId {
  if (value === 'mine' || !isOfficeWorkspaceId(value)) return MAIN_OFFICE_WORKSPACE_ID
  return value
}

export function workspaceLabel(workspace: OfficeAgentWorkspaceSummary) {
  return workspace.kind === 'main' ? '我的空间' : workspace.name
}
