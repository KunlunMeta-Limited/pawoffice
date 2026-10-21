/**
 * 功能：轮询 OpenPaw Host/Action Gateway 的动作队列，并把动作转交给场景调度器。
 * 输入输出边界：输入为 `/actions` GET 返回的 JSON，输出为 Dispatcher/SceneBridge 调用。
 * 设计约束：轮询默认间隔 1000 毫秒，单次请求最多 5000 毫秒；断开时必须中止当前请求和后续定时器；未知动作不得执行。
 * 关联：`API-OFFICE-ACTION-001`、`REQ-B-OFFICE-003`、`CHG-2026-0004`。
 */
import { OFFICE_HTTP_ACTIONS_URL } from '@/config/officeMode'
import { MAIN_OFFICE_WORKSPACE_ID, officeSceneScopeId } from '@/config/officeWorkspaces'
import { INITIAL_AGENTS } from '@/scene/layout/officeLayout'
import { getOfficeSceneAgents, setAgentState } from '@/scene/officeSceneBridge'
import { submitVisitAction } from '@/services/officeActionDispatcher'
import type { OfficeActionMessage } from '@/types/officeAction'

const POLL_MS = 1000
const POLL_TIMEOUT_MS = 5000

/** Gateway 兼容的动作轮询响应：可直接返回数组或包在 `actions` 字段中。 */
type ActionPollResponse =
  | OfficeActionMessage[]
  | {
      actions?: OfficeActionMessage[]
      nextCursor?: number
      oldestCursor?: number
      gap?: boolean
      reset?: boolean
    }

type NormalizedActionPoll = {
  actions: OfficeActionMessage[]
  nextCursor: number | null
  gap: boolean
  reset: boolean
}

/**
 * 功能：按动作类型把单条 Gateway 消息分派到拜访调度器或场景状态桥。
 * 参数：`message` 为已从 Gateway 读取的动作联合类型。
 * 返回：无；未知或找不到目标智能体的消息仅记录警告并忽略。
 * 错误：不抛出场景执行错误，确保单条坏消息不终止轮询。
 * 状态：`desk_visit`/`desk_visit_tour` 进入 FIFO 调度，`set_state` 更新角色状态。
 * 并发与取消：动作按轮询返回顺序提交；取消由 `OfficeActionHttpClient.disconnect` 处理。
 * 权限：只消费 Gateway 已校验的动作，不直接访问文件或引擎。
 * 关联：`API-OFFICE-ACTION-001`、`REQ-B-OFFICE-003`。
 */
export function dispatchOfficeAction(message: OfficeActionMessage) {
  console.info('[OfficeHTTP] received', message)

  if (message.type === 'workspace_handoff') {
    // Gateway 已保存跨空间关系；总览通过 /office/workspaces 读取，不向单办公室场景注入伪动作。
    return
  }
  if (message.type === 'register_artifact') {
    // 产物登记只更新 Gateway 的只读投影，不驱动人物场景。
    return
  }
  const actionWorkspaceId = message.workspaceId || MAIN_OFFICE_WORKSPACE_ID
  const sceneScopeId = officeSceneScopeId(message.sessionId, actionWorkspaceId)

  switch (message.type) {
    case 'desk_visit':
      console.info('[OfficeHTTP] dispatch desk_visit', {
        visitor: message.visitor,
        host: message.host,
      })
      submitVisitAction(message, { workspaceId: sceneScopeId })
      return
    case 'desk_visit_tour':
      console.info('[OfficeHTTP] dispatch desk_visit_tour', {
        visitor: message.visitor,
        hosts: message.hosts,
      })
      submitVisitAction(message, { workspaceId: sceneScopeId })
      return
    case 'set_state': {
      const agents = getOfficeSceneAgents(sceneScopeId) ?? INITIAL_AGENTS
      const agent = message.agentId
        ? agents.find((a) => a.id === message.agentId)
        : message.rosterNo != null
          ? agents[message.rosterNo - 1]
          : undefined
      if (!agent) {
        console.warn('[OfficeHTTP] set_state: agent not found', message)
        return
      }
      console.info('[OfficeHTTP] dispatch set_state', {
        agentId: agent.id,
        state: message.state,
      })
      setAgentState(agent.id, message.state, message.task, sceneScopeId)
      return
    }
    default: {
      const _exhaustive: never = message
      console.warn('[OfficeHTTP] unknown message type', _exhaustive)
    }
  }
}

/** 将两种 Gateway 响应形状统一为动作数组。 */
function normalizePollResponse(data: ActionPollResponse): NormalizedActionPoll {
  if (Array.isArray(data)) return { actions: data, nextCursor: null, gap: false, reset: false }
  return {
    actions: Array.isArray(data.actions) ? data.actions : [],
    nextCursor: Number.isSafeInteger(data.nextCursor) && data.nextCursor! >= 0 ? data.nextCursor! : null,
    gap: data.gap === true,
    reset: data.reset === true,
  }
}

/**
 * 功能：维护浏览器到动作 Gateway 的定时轮询连接。
 * 状态：`connect` 开始轮询，`disconnect` 清理定时器并中止当前请求。
 * 约束：同一实例只允许一个活动轮询链；轮询失败只记录日志并在启用时继续调度。
 * 并发与取消：使用 `AbortController` 取消 fetch，避免组件卸载后仍处理动作。
 * 稳定性：前端网络边界，修改轮询地址或间隔必须建立 CHG。
 * 关联：`API-OFFICE-ACTION-001`。
 */
export class OfficeActionHttpClient {
  private timer: ReturnType<typeof setTimeout> | null = null
  private abortController: AbortController | null = null
  private shouldPoll = false
  private cursor: number | 'latest' = 'latest'
  private connectedUrl: string | null = null
  private generation = 0

  /** 连接指定动作 URL；默认使用环境配置的 `/actions` 地址。 */
  connect(url: string = OFFICE_HTTP_ACTIONS_URL) {
    if (this.connectedUrl !== url) this.cursor = 'latest'
    this.disconnect()
    this.connectedUrl = url
    this.shouldPoll = true
    void this.poll(url, this.generation)
  }

  /** 断开轮询，取消当前 fetch 并阻止后续定时器继续调度。 */
  disconnect() {
    this.generation += 1
    this.shouldPoll = false
    if (this.timer != null) clearTimeout(this.timer)
    this.timer = null
    this.abortController?.abort()
    this.abortController = null
  }

  private schedule(url: string, generation: number) {
    if (!this.shouldPoll || generation !== this.generation) return
    this.timer = setTimeout(() => void this.poll(url, generation), POLL_MS)
  }

  private async poll(url: string, generation: number) {
    if (!this.shouldPoll || generation !== this.generation) return

    const controller = new AbortController()
    this.abortController = controller
    // 半开连接若不主动超时，下一次轮询永远不会在 finally 中调度。定时器只
    // 取消本次 GET；连接仍启用时 finally 会继续安排下一轮，实现自动恢复。
    const timeout = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS)
    try {
      const pollUrl = new URL(url, window.location.href)
      pollUrl.searchParams.set('after', String(this.cursor))
      const response = await fetch(pollUrl.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })

      if (!this.shouldPoll || generation !== this.generation) return

      if (!response.ok) {
        console.warn('[OfficeHTTP] poll failed', response.status, url)
        return
      }

      const data = (await response.json()) as ActionPollResponse
      if (!this.shouldPoll || generation !== this.generation) return
      const batch = normalizePollResponse(data)
      for (const action of batch.actions) {
        dispatchOfficeAction(action)
      }
      if (batch.nextCursor !== null) this.cursor = batch.nextCursor
      if (batch.gap) {
        console.warn(batch.reset
          ? '[办公室网络] 动作网关已重启，轮询游标已重新同步'
          : '[办公室网络] 动作日志存在缺口，已从最早可用动作继续')
      }
    } catch (error) {
      if (this.shouldPoll && generation === this.generation) {
        console.warn('[OfficeHTTP] poll error', url, error)
      }
    } finally {
      clearTimeout(timeout)
      if (this.abortController === controller) this.abortController = null
      this.schedule(url, generation)
    }
  }
}
