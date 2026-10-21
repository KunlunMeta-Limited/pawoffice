import type { AgentState } from '@/types/agent'

export type OfficeActionWorkspace = {
  /** 缺省时兼容为主 Agent 空间。 */
  workspaceId?: string
  workspaceName?: string
  parentWorkspaceId?: string
  sessionId?: string
}

export type OfficeActionDeskVisit = OfficeActionWorkspace & {
  type: 'desk_visit'
  visitor: number
  host: number
  message: string
}

export type OfficeActionDeskVisitTour = OfficeActionWorkspace & {
  type: 'desk_visit_tour'
  visitor: number
  hosts: number[]
  message?: string
}

export type OfficeActionSetState = OfficeActionWorkspace & {
  type: 'set_state'
  state: AgentState
  task?: string
  /** 名册序号，从 1 开始 */
  rosterNo?: number
  agentId?: string
}

export type OfficeActionWorkspaceHandoff = {
  type: 'workspace_handoff'
  sessionId?: string
  fromWorkspaceId: string
  toWorkspaceId: string
  fromWorkspaceName?: string
  toWorkspaceName?: string
  phase: 'going' | 'talking' | 'returning' | 'complete'
  rosterNo?: number
  message?: string
}

/** 登记子 Agent 已成功生成的工作区产物；文件内容仍由 Gateway 只读校验。 */
export type OfficeActionRegisterArtifact = Required<Pick<OfficeActionWorkspace, 'workspaceId' | 'sessionId'>> & Pick<OfficeActionWorkspace, 'workspaceName' | 'parentWorkspaceId'> & {
  type: 'register_artifact'
  path: string
}

export type OfficeActionMessage =
  | OfficeActionDeskVisit
  | OfficeActionDeskVisitTour
  | OfficeActionSetState
  | OfficeActionWorkspaceHandoff
  | OfficeActionRegisterArtifact
