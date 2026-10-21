/**
 * 功能：缓存对话会话摘要，并为导航预取和 React 面板提供共享的 stale-while-refresh 快照。
 * 数据来源：`officeGatewayApi.sessions`；数据去向：对话中心最近会话列表。
 * 约束：只缓存脱敏摘要，不缓存权限、工具输入、消息正文或凭据；最多保留 Gateway 返回的条目。
 * 稳定性：前端内部公共服务；快照字段与 `OfficeResource<OfficeSessionSummary[]>` 保持一致。
 * 关联：`CHG-2026-0013`、`API-OFFICE-DATA-001`。
 */
import { useEffect, useSyncExternalStore } from 'react'
import { officeGatewayApi } from '@/services/officeGatewayApi'
import type { OfficeResource } from '@/services/useOfficeResource'
import type { OfficeSessionSummary } from '@/types/officeData'

const CACHE_TTL_MS = 3_000
const listeners = new Set<() => void>()
let updatedAt = 0
let request: Promise<OfficeSessionSummary[]> | null = null
let requestRevision = -1
let revision = 0
let snapshot: OfficeResource<OfficeSessionSummary[]> = {
  data: [],
  state: 'idle',
  error: null,
}

function sessionsEqual(left: OfficeSessionSummary[], right: OfficeSessionSummary[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((session, index) => {
    const candidate = right[index]
    return session.id === candidate.id
      && session.title === candidate.title
      && session.provider === candidate.provider
      && session.model === candidate.model
      && session.createdAt === candidate.createdAt
      && session.updatedAt === candidate.updatedAt
  })
}

function resourcesEqual(left: OfficeResource<OfficeSessionSummary[]>, right: OfficeResource<OfficeSessionSummary[]>) {
  return left.state === right.state && left.error === right.error && sessionsEqual(left.data, right.data)
}

function publish(next: OfficeResource<OfficeSessionSummary[]>) {
  if (resourcesEqual(snapshot, next)) return false
  if (sessionsEqual(snapshot.data, next.data)) next = { ...next, data: snapshot.data }
  snapshot = next
  listeners.forEach((listener) => listener())
  return true
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 功能：读取当前共享会话摘要快照。
 * 参数：无。
 * 返回：稳定的只读资源快照；没有缓存时状态为 `idle`。
 * 错误：无；最近错误保存在快照 `error` 字段。
 * 状态：只读，不触发网络请求。
 * 并发与取消：可与正在执行的预取并发读取；返回最近一次已发布快照。
 * 权限：只返回 Gateway 已脱敏的 session 摘要。
 * 关联：`CHG-2026-0013`。
 */
/** 公共读取入口：返回共享会话摘要快照。 */
export function getConversationSessionsSnapshot() {
  return snapshot
}

/**
 * 功能：加载或后台刷新会话摘要，并合并并发调用为同一个请求。
 * 参数：`force` 为 true 时忽略短 TTL；默认优先复用新鲜缓存。
 * 返回：最新会话摘要数组。
 * 错误：首次加载失败时 Promise 拒绝并发布 `error`；已有数据刷新失败时保留旧数据。
 * 状态：首次请求进入 loading；已有缓存保持 ready，实现 stale-while-refresh。
 * 并发与取消：全局同一时刻只有一个请求；导航卸载不取消共享预取。
 * 权限：只调用已登记的 `/office/sessions` Gateway API。
 * 关联：`API-OFFICE-DATA-001`、`CHG-2026-0013`。
 */
/** 公共加载入口：合并并发请求并刷新会话摘要缓存。 */
export function loadConversationSessions(force = false): Promise<OfficeSessionSummary[]> {
  if (!force && snapshot.state === 'ready' && Date.now() - updatedAt < CACHE_TTL_MS) {
    return Promise.resolve(snapshot.data)
  }
  if (request && requestRevision === revision) return request
  if (snapshot.data.length === 0) publish({ ...snapshot, state: 'loading', error: null })
  // revision 是创建、删除和显式失效的逻辑时钟。请求只允许发布到发起时的
  // revision，避免旧网络响应把已经合并到本地的新会话摘要覆盖掉。
  const loadRevision = revision
  const currentRequest = officeGatewayApi.sessions()
    .then((sessions) => {
      if (loadRevision !== revision) return sessions
      updatedAt = Date.now()
      publish({ data: sessions, state: 'ready', error: null })
      return sessions
    })
    .catch((reason: unknown) => {
      if (loadRevision !== revision) throw reason
      const error = reason instanceof Error ? reason : new Error('办公室网关请求失败')
      publish(snapshot.data.length > 0
        ? { data: snapshot.data, state: 'ready', error }
        : { data: [], state: 'error', error })
      throw error
    })
    .finally(() => {
      if (request === currentRequest) {
        request = null
        requestRevision = -1
      }
    })
  request = currentRequest
  requestRevision = loadRevision
  return currentRequest
}

/**
 * 功能：在不阻塞调用方的情况下预取会话摘要。
 * 参数：无。
 * 返回：无；错误被快照记录，调用方无需处理未捕获 Promise。
 * 错误：网关错误不会抛到事件处理器或 idle callback。
 * 状态：更新共享缓存；新鲜缓存不会重复请求。
 * 并发与取消：复用进行中的全局请求，不绑定单个组件生命周期。
 * 权限：只读取 `/office/sessions`。
 * 关联：`CHG-2026-0013`。
 */
/** 公共预取入口：后台加载会话摘要且不传播异常。 */
export function prefetchConversationSessions() {
  void loadConversationSessions().catch(() => undefined)
}

/**
 * 功能：标记会话摘要过期，并可把本地已知摘要立即合并到缓存。
 * 参数：`sessions` 为创建、删除后已知的新摘要；省略时只使 TTL 失效。
 * 返回：无。
 * 错误：无。
 * 状态：有参数时立即发布 ready 快照；下一次加载仍会向 Gateway 校准。
 * 并发与取消：不会取消进行中的请求；失效前发出的迟到响应不得覆盖创建或删除后的本地摘要。
 * 权限：只接收 UI 已获得的脱敏摘要。
 * 关联：`CHG-2026-0013`。
 */
/** 公共失效入口：使旧摘要请求不能覆盖最新本地状态。 */
export function invalidateConversationSessions(sessions?: OfficeSessionSummary[]) {
  revision += 1
  updatedAt = 0
  if (sessions) publish({ data: sessions, state: 'ready', error: null })
}

/**
 * 功能：订阅共享会话摘要，并在启用时触发非阻塞刷新。
 * 参数：`enabled` 表示当前是否显示对话中心。
 * 返回：最近缓存数据及加载/错误状态。
 * 错误：通过返回值 `error` 表达，不在 React effect 中抛出。
 * 状态：禁用时保留缓存，不回退为 idle 或空数组。
 * 并发与取消：多个组件共享一个请求；卸载只移除订阅，不中断后台会话或预取。
 * 权限：不增加 Gateway 权限。
 * 关联：`CHG-2026-0013`。
 */
/** 公共 Hook：订阅共享会话摘要并按需刷新。 */
export function useConversationSessions(enabled: boolean): OfficeResource<OfficeSessionSummary[]> {
  const value = useSyncExternalStore(subscribe, getConversationSessionsSnapshot, getConversationSessionsSnapshot)
  useEffect(() => {
    if (enabled) void loadConversationSessions().catch(() => undefined)
  }, [enabled])
  return value
}

/**
 * 功能：清空会话摘要缓存，供单元测试和本地登出使用。
 * 参数：无。
 * 返回：无。
 * 错误：无。
 * 状态：恢复空 idle 快照并使旧 TTL 失效。
 * 并发与取消：不强行取消已发出的 fetch；测试应在无活动请求时调用。
 * 权限：无外部副作用。
 * 关联：`CHG-2026-0013`。
 */
/** 公共测试入口：重置共享会话摘要缓存。 */
export function resetConversationSessionCache() {
  revision += 1
  updatedAt = 0
  request = null
  requestRevision = -1
  publish({ data: [], state: 'idle', error: null })
}
