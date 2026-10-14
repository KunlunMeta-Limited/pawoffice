/**
 * 功能：提供 AI Office 面板访问 Gateway `/office/*` 和 `/actions` 的类型化 API。
 * 输入输出边界：输入为 UI 资源请求、动作和用户表单，输出为 JSON 数据或可取消的 Promise。
 * 设计约束：所有请求统一使用 `OFFICE_API_ORIGIN`；取消通过 `AbortSignal` 传播；Gateway 错误转换为异常。
 * 禁止事项：不得在组件内重复拼接路由、绕过 Gateway 直接读取 OpenPaw home 或发送未登记动作。
 * 关联：`API-OFFICE-GATEWAY-001`、`REQ-B-OFFICE-005`、`CHG-2026-0004`。
 */
import { OFFICE_HTTP_ACTIONS_URL } from '@/config/officeMode'
import type {
  OfficeAgentSummary,
  OfficeAgentWorkspaceSummary,
  OfficeConversationArtifact,
  OfficeConversationMessage,
  OfficeConversationPromptResult,
  OfficeConversationRequest,
  OfficeConversationResult,
  OfficeConversationStatus,
  OfficeFileContent,
  OfficePermissionSummary,
  OfficeNotification,
  OfficeSkillContent,
  OfficeTaskCreateRequest,
  OfficeFileSummary,
  OfficeSessionSummary,
  OfficeSkillSummary,
  OfficeTaskSummary,
  OfficeWorkspaceSummary,
} from '@/types/officeData'
import type { OfficeActionMessage } from '@/types/officeAction'

/** 根据动作 URL 提取 Gateway origin；配置非法时回退到本地默认地址。 */
function resolveOrigin() {
  try {
    return new URL(OFFICE_HTTP_ACTIONS_URL).origin
  } catch {
    return 'http://localhost:8765'
  }
}

/**
 * 功能：提供所有 Office Gateway 请求共享的 HTTP origin。
 * 字段语义：只包含 scheme、host 和 port，不包含资源路径。
 * 数据来源：`VITE_OFFICE_HTTP_ACTIONS_URL`，非法配置回退到本地默认地址。
 * 数据去向：本模块所有 Gateway fetch 请求。
 * 约束：不得携带凭据、userinfo、query 或 fragment。
 * 稳定性：前端内部公共配置常量。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
/** 所有 Office Gateway 请求共享的模块内部 origin。 */
const OFFICE_API_ORIGIN = resolveOrigin()

/**
 * 功能：标识 Gateway 请求由前端内部超时终止，而不是调用方主动取消。
 * 参数：构造函数无参数，使用稳定中文提示。
 * 返回：可通过 `instanceof` 识别的 Error 子类。
 * 错误：本类型本身不发起请求；由 `fetchWithTimeout` 在内部超时时抛出。
 * 状态：无外部状态。
 * 并发与取消：用于区分内部 12 秒超时和调用方 `AbortSignal` 取消。
 * 权限：不包含请求内容、凭据或上游原始错误。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export class OfficeGatewayTimeoutError extends Error {
  constructor() {
    super('办公室网关请求超时，正在核对会话状态')
    this.name = 'OfficeGatewayTimeoutError'
  }
}

/**
 * 功能：保留 Gateway 非 2xx 响应的 HTTP 状态和脱敏错误正文。
 * 参数：`status` 为响应状态码，`message` 为 Gateway 已过滤的错误说明。
 * 返回：可通过 `instanceof` 和 `status` 区分 409 接管、429 容量和其它拒绝。
 * 错误：本类型不包含 Provider 原始响应、请求正文或凭据。
 * 状态：无外部状态。
 * 并发与取消：不改变取消语义；调用方仍需单独处理 AbortError 和超时。
 * 权限：只允许浏览器已获准读取的状态码和短错误信息。
 * 关联：`CHG-2026-0014`、`BLK-16`。
 */
export class OfficeGatewayHttpError extends Error {
  readonly status: number
  readonly code?: string
  readonly retryable?: boolean

  constructor(status: number, message: string, code?: string, retryable?: boolean) {
    super(message)
    this.name = 'OfficeGatewayHttpError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

/** 发起带统一超时和取消传播的 Gateway 请求，避免网络半开时面板永久加载。 */
async function fetchWithTimeout(resource: string, init: RequestInit, signal?: AbortSignal, timeoutMs = 12000) {
  const controller = new AbortController()
  // timedOut 只由内部定时器设置，用于把内部超时与调用方主动 abort 分开；finally
  // 始终清理定时器和外部监听器，防止多会话长期运行时积累监听器。
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abort, { once: true })
  try {
    return await fetch(`${OFFICE_API_ORIGIN}${resource}`, { ...init, signal: controller.signal })
  } catch (error) {
    if (timedOut && !signal?.aborted && error instanceof DOMException && error.name === 'AbortError') {
      throw new OfficeGatewayTimeoutError()
    }
    throw error
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

/** 发起只读 JSON 请求，并将非 2xx 响应转换为中文异常。 */
async function request<T>(resource: string, signal?: AbortSignal): Promise<T> {
  const response = await fetchWithTimeout(resource, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  }, signal)
  if (!response.ok) throw new OfficeGatewayHttpError(response.status, `办公室网关请求失败（${response.status}）`)
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** 发起 JSON POST 请求；请求体由调用方提供，响应按泛型解析。 */
async function requestJson<T>(resource: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetchWithTimeout(resource, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, signal)
  if (!response.ok) {
    let detail = ''
    let code: string | undefined
    let retryable: boolean | undefined
    try {
      const body = await response.json()
      detail = String(body?.error || '')
      if (typeof body?.code === 'string') code = body.code
      if (typeof body?.retryable === 'boolean') retryable = body.retryable
    } catch { /* Gateway 错误正文不是 JSON 时使用状态码。 */ }
    throw new OfficeGatewayHttpError(response.status, detail || `办公室网关请求失败（${response.status}）`, code, retryable)
  }
  // 删除、停止等成功响应允许 204；此时禁止调用 response.json()，对应泛型调用方
  // 必须把返回类型声明为 unknown 或 void，并且不能依赖响应正文。
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** 使用同一幂等键发送消息；只有接收确认超时才重试一次，明确 HTTP 拒绝不重试。 */
async function sendConversationMessage(sessionId: string, text: string, requestID: string, signal?: AbortSignal) {
  const resource = `/office/conversations/${encodeURIComponent(sessionId)}/messages`
  const body = { requestID, parts: [{ type: 'text', text }] }
  try {
    return await requestJson<OfficeConversationPromptResult>(resource, body, signal)
  } catch (error) {
    if (!(error instanceof OfficeGatewayTimeoutError) || signal?.aborted) throw error
    return requestJson<OfficeConversationPromptResult>(resource, body, signal)
  }
}

function createConversationRequestId() {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `office-create-${random}`.slice(0, 128)
}

/** 创建请求使用同一 requestID 重试一次，避免接收确认丢失后重复创建 session。 */
async function createConversation(body: OfficeConversationRequest, signal?: AbortSignal) {
  const payload = { ...body, requestID: body.requestID || createConversationRequestId() }
  try {
    return await requestJson<OfficeConversationResult>('/office/conversations', payload, signal)
  } catch (error) {
    if (!(error instanceof OfficeGatewayTimeoutError) || signal?.aborted) throw error
    return requestJson<OfficeConversationResult>('/office/conversations', payload, signal)
  }
}

/**
 * 功能：集中登记 Office Gateway 的资源查询、会话、审批、任务和通知操作。
 * 字段语义：每个字段对应一个已登记路由，参数与返回类型由字段签名冻结。
 * 数据来源：浏览器调用参数；数据去向：Gateway 路由及其对应的 OpenPaw Host。
 * 错误：非 2xx、网络错误和内部超时均以异常返回；不会把原始 Provider 错误透传给 UI。
 * 约束：路由、方法、状态码和字段必须与 `contracts/office-action-v1.schema.json` 及设计基线一致。
 * 并发与取消：所有方法接受可选 `AbortSignal`；请求取消不得改变场景或引擎状态。
 * 权限：Gateway 负责鉴权、文件根边界和敏感数据过滤，前端只展示返回摘要。
 * 关联：`API-OFFICE-GATEWAY-001`、`REQ-B-OFFICE-005`。
 */
export const officeGatewayApi = {
  /** 返回浏览器连接的 Gateway SSE 地址；Host 鉴权由 Gateway 统一处理。 */
  conversationEventsUrl: () => `${OFFICE_API_ORIGIN}/office/events`,
  /** 查询持久化会话摘要。 */
  sessions: (signal?: AbortSignal) => request<OfficeSessionSummary[]>('/office/sessions', signal),
  /** 查询可用技能文件摘要。 */
  skills: (signal?: AbortSignal) => request<OfficeSkillSummary[]>('/office/skills', signal),
  /** 查询工作区文件树摘要。 */
  files: (signal?: AbortSignal) => request<OfficeFileSummary[]>('/office/files', signal),
  /** 查询当前工作区根目录。 */
  workspace: (signal?: AbortSignal) => request<OfficeWorkspaceSummary>('/office/workspace', signal),
  /** 查询任务元数据列表。 */
  tasks: (signal?: AbortSignal) => request<OfficeTaskSummary[]>('/office/tasks', signal),
  /** 查询 Office 名册和当前状态。 */
  agents: (signal?: AbortSignal) => request<OfficeAgentSummary[]>('/office/agents', signal),
  /** 返回当前真实登记的主 Agent/子 Agent 完整办公室空间。 */
  agentWorkspaces: (sessionId?: string | null, signal?: AbortSignal) => request<OfficeAgentWorkspaceSummary[]>(`/office/workspaces${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`, signal),
  /** 将场景控制动作送入网关队列；仅更新办公室人物投影，不取消引擎回合。 */
  enqueueActions: (actions: OfficeActionMessage | OfficeActionMessage[], signal?: AbortSignal) => requestJson<{ accepted: number; queued: number }>('/actions', actions, signal),
  /** 读取工作区内的普通文件正文；网关负责越界、符号链接和大小限制。 */
  fileContent: (path: string, signal?: AbortSignal) => request<OfficeFileContent>(`/office/file?path=${encodeURIComponent(path)}`, signal),
  /** 重建指定会话中成功文件工具产生的工作区产物。 */
  conversationArtifacts: (sessionId: string, workspaceIdOrSignal?: string | AbortSignal | null, signal?: AbortSignal) => {
    const workspaceId = typeof workspaceIdOrSignal === 'string' ? workspaceIdOrSignal : null
    const requestSignal = typeof workspaceIdOrSignal === 'string' || workspaceIdOrSignal == null ? signal : workspaceIdOrSignal
    return request<OfficeConversationArtifact[]>(`/office/conversations/${encodeURIComponent(sessionId)}/artifacts${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''}`, requestSignal)
  },
  /** 返回受控图片产物的读取地址；Gateway 仍会执行工作区和 MIME 白名单校验。 */
  artifactImageUrl: (path: string) => `${OFFICE_API_ORIGIN}/office/artifact-image?path=${encodeURIComponent(path)}`,
  /** 创建命名会话；动作由 engine-host 投影到当前任务对应的办公室角色。 */
  createConversation,
  /** 向指定会话追加文本回合；确认超时使用同一 requestID 重试一次，活动回合由网关转换为 409。 */
  sendConversationMessage,
  /** 停止指定会话当前回合；会同时唤醒审批等待并清理人物活动状态。 */
  abortConversation: (sessionId: string, signal?: AbortSignal) => requestJson<unknown>(`/office/conversations/${encodeURIComponent(sessionId)}/abort`, {}, signal),
  /** 查询会话当前是否排队或执行；终态由正文中的持久 turn marker 表达。 */
  conversationStatus: (sessionId: string, signal?: AbortSignal) => request<Record<string, OfficeConversationStatus>>(`/office/conversations/${encodeURIComponent(sessionId)}/status`, signal),
  /** 一次读取全部活动会话状态，供多会话恢复和共享轮询协调器使用。 */
  conversationStatuses: (signal?: AbortSignal) => request<Record<string, OfficeConversationStatus>>('/office/conversations/status', signal),
  /** 读取指定会话的 OpenCode 消息记录，用于对话中心正文展示。 */
  conversationMessages: (sessionId: string, signal?: AbortSignal) => request<OfficeConversationMessage[]>(`/office/conversations/${encodeURIComponent(sessionId)}/messages`, signal),
  /** 创建一个任务元数据文件；任务执行由 Gateway/Host 负责。 */
  createTask: (body: OfficeTaskCreateRequest, signal?: AbortSignal) => requestJson<OfficeTaskSummary>('/office/tasks', body, signal),
  /** 取消正在排队或执行中的任务，并终止其绑定的 engine-host 回合。 */
  cancelTask: (taskId: string, signal?: AbortSignal) => requestJson<OfficeTaskSummary>(`/office/tasks/${encodeURIComponent(taskId)}/cancel`, {}, signal),
  /** 重新执行失败或已取消任务，返回新建的任务摘要。 */
  retryTask: (taskId: string, signal?: AbortSignal) => requestJson<OfficeTaskSummary>(`/office/tasks/${encodeURIComponent(taskId)}/retry`, {}, signal),
  /** 删除已完成、失败或取消的任务；关联执行对话和产物继续保留。 */
  deleteTask: async (taskId: string, signal?: AbortSignal) => {
    const response = await fetchWithTimeout(`/office/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE', headers: { Accept: 'application/json' } }, signal)
    if (!response.ok) {
      let detail = ''
      try { detail = String((await response.json())?.error || '') } catch { /* 非 JSON 错误使用状态码。 */ }
      throw new OfficeGatewayHttpError(response.status, detail || `办公室网关请求失败（${response.status}）`)
    }
  },
  /** 删除非活动会话及其持久化 JSONL；活动会话由 host 拒绝。 */
  deleteConversation: async (sessionId: string, signal?: AbortSignal) => {
    const response = await fetchWithTimeout(`/office/conversations/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers: { Accept: 'application/json' } }, signal)
    if (!response.ok) {
      let detail = ''
      try { detail = String((await response.json())?.error || '') } catch { /* 非 JSON 错误使用状态码。 */ }
      throw new OfficeGatewayHttpError(response.status, detail || `办公室网关请求失败（${response.status}）`)
    }
  },
  /** 查询当前 session 的待审批权限摘要。 */
  permissions: (signal?: AbortSignal) => request<OfficePermissionSummary[]>('/office/permissions', signal),
  /** 回复单条待审批权限；always 与 once 均只作用于当前请求。 */
  replyPermission: (id: string, reply: 'once' | 'always' | 'reject', signal?: AbortSignal) => requestJson<unknown>(`/office/permissions/${encodeURIComponent(id)}/reply`, { reply }, signal),
  /** 读取指定技能正文；路径边界由 Gateway 校验。 */
  skillContent: (path: string, signal?: AbortSignal) => request<OfficeSkillContent>(`/office/skill?path=${encodeURIComponent(path)}`, signal),
  /** 查询网关进程内通知列表。 */
  notifications: (signal?: AbortSignal) => request<OfficeNotification[]>('/office/notifications', signal),
  /** 创建一条网关进程内通知，供联调或自动化任务回报结果。 */
  createNotification: (body: Pick<OfficeNotification, 'title' | 'body' | 'level'>, signal?: AbortSignal) => requestJson<OfficeNotification>('/office/notifications', body, signal),
  /** 将指定通知标记为已读。 */
  markNotificationRead: (id: string, signal?: AbortSignal) => requestJson<OfficeNotification>(`/office/notifications/${encodeURIComponent(id)}/read`, {}, signal),
}
