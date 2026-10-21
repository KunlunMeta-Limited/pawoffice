/**
 * 功能：协调多个 Office 会话的独立发送、恢复、轮询和停止生命周期。
 * 数据来源：`officeGatewayApi` 的目标 session 路由；数据去向：`conversationViewStore`。
 * 并发与取消：每个 session 最多一个活动监视器，不同 session 可并行；切换 UI 不会取消后台回合。
 * 权限：只处理文本消息和脱敏活动摘要，不缓存工具参数、结果或内部推理。
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { officeGatewayApi, OfficeGatewayHttpError, OfficeGatewayTimeoutError } from '@/services/officeGatewayApi'
import {
  appendConversationMessage,
  appendPersistentConversationNotice,
  beginConversationTurn,
  bindConversationTurnIdentity,
  EMPTY_CONVERSATION_VIEW,
  getConversationSnapshot,
  getConversationView,
  rememberConversationMessages,
  subscribeConversationView,
  upsertStreamedAssistantMessage,
  updateConversationView,
  type ConversationViewState,
} from '@/services/conversationViewStore'
import {
  isConversationEventStreamConnected,
  resetConversationEventStream,
  subscribeConversationEvents,
  type OfficeConversationStreamEvent,
} from '@/services/conversationEventStream'
import type { OfficeConversationMessage, OfficeConversationStatus } from '@/types/officeData'

type SessionRuntime = {
  loadPromise?: Promise<void>
  monitorPromise?: Promise<void>
  monitorController?: AbortController
  monitorGeneration?: number
  monitorIdentity?: MonitorIdentity
  abortRequestedGeneration?: number
  streamGeneration?: number
  streamUnsubscribe?: () => void
}

type MonitorIdentity = {
  sessionId: string
  generation: number
  turnID: string | null
  userMessageID: string | null
  boundaryMessageID: string | null
}

const runtimes = new Map<string, SessionRuntime>()
let optimisticSequence = 0
let activeRecoveryPromise: Promise<void> | null = null
let activeRecoveryCompleted = false
let statusSnapshot: Record<string, OfficeConversationStatus> = {}
let statusSnapshotExpiresAt = 0
let statusSnapshotPromise: Promise<Record<string, OfficeConversationStatus>> | null = null
let statusSnapshotRevision = 0
const STATUS_SNAPSHOT_TTL_MS = 200
const streamMessageInfo = new Map<string, OfficeConversationMessage['info']>()
const streamParts = new Map<string, { sessionId: string; messageId: string; text: string }>()

function runtimeFor(sessionId: string) {
  const runtime = runtimes.get(sessionId) ?? {}
  runtimes.set(sessionId, runtime)
  return runtime
}

function streamKey(sessionId: string, id: string) {
  return `${sessionId}\u0000${id}`
}

function clearStreamBuffers(sessionId: string) {
  const prefix = `${sessionId}\u0000`
  for (const key of [...streamMessageInfo.keys()]) if (key.startsWith(prefix)) streamMessageInfo.delete(key)
  for (const key of [...streamParts.keys()]) if (key.startsWith(prefix)) streamParts.delete(key)
}

function publishStreamPart(identity: MonitorIdentity, partId: string) {
  const part = streamParts.get(streamKey(identity.sessionId, partId))
  if (!part || part.sessionId !== identity.sessionId) return
  const info = streamMessageInfo.get(streamKey(identity.sessionId, part.messageId)) ?? {
    id: part.messageId,
    sessionID: identity.sessionId,
    role: 'assistant',
    time: { created: Date.now() },
  }
  upsertStreamedAssistantMessage(identity.sessionId, {
    info,
    parts: [{ id: partId, messageID: part.messageId, sessionID: identity.sessionId, type: 'text', text: part.text }],
  }, identity.generation)
}

function reconcileStream(identity: MonitorIdentity) {
  void officeGatewayApi.conversationMessages(identity.sessionId).then((messages) => {
    if (getConversationView(identity.sessionId)?.generation === identity.generation) {
      rememberConversationMessages(identity.sessionId, messages, identity.generation)
    }
  }).catch(() => undefined)
}

function handleStreamEvent(identity: MonitorIdentity, event: OfficeConversationStreamEvent) {
  if (!monitorStillCurrent(identity)) return
  const properties = event.properties
  if (event.type === 'message.updated') {
    const info = properties.info
    if (info && typeof info === 'object' && !Array.isArray(info)) {
      const record = info as Record<string, unknown>
      if (record.role === 'assistant' && typeof record.id === 'string') {
        streamMessageInfo.set(streamKey(identity.sessionId, record.id), record as OfficeConversationMessage['info'])
      }
    }
    return
  }
  if (event.type === 'message.part.updated') {
    const part = properties.part
    if (part && typeof part === 'object' && !Array.isArray(part)) {
      const record = part as Record<string, unknown>
      if (record.type === 'text' && typeof record.id === 'string' && typeof record.messageID === 'string' && typeof record.text === 'string') {
        streamParts.set(streamKey(identity.sessionId, record.id), { sessionId: identity.sessionId, messageId: record.messageID, text: record.text })
        publishStreamPart(identity, record.id)
      }
    }
    return
  }
  if (event.type === 'message.part.delta') {
    if (typeof properties.partID === 'string' && typeof properties.messageID === 'string' && typeof properties.delta === 'string') {
      const key = streamKey(identity.sessionId, properties.partID)
      const current = streamParts.get(key) ?? { sessionId: identity.sessionId, messageId: properties.messageID, text: '' }
      current.text += properties.delta
      streamParts.set(key, current)
      publishStreamPart(identity, properties.partID)
    }
    return
  }
  if (event.type === 'session.status') {
    const status = properties.status
    if (status && typeof status === 'object' && !Array.isArray(status)) {
      const type = (status as Record<string, unknown>).type
      updateConversationView(identity.sessionId, {
        pending: true,
        phase: 'loading',
        turnStatus: type === 'queued' ? 'queued' : type === 'busy' ? 'busy' : null,
        queuePosition: null,
      }, identity.generation)
    }
    return
  }
  if (event.type === 'session.idle' || event.type === 'stream.gap') reconcileStream(identity)
}

function attachConversationStream(identity: MonitorIdentity) {
  const runtime = runtimeFor(identity.sessionId)
  if (runtime.streamUnsubscribe && runtime.streamGeneration === identity.generation) return
  runtime.streamUnsubscribe?.()
  runtime.streamGeneration = identity.generation
  runtime.streamUnsubscribe = subscribeConversationEvents(identity.sessionId, (event) => handleStreamEvent(identity, event))
}

function detachConversationStream(sessionId: string, generation: number) {
  const runtime = runtimes.get(sessionId)
  if (!runtime || runtime.streamGeneration !== generation) return
  runtime.streamUnsubscribe?.()
  runtime.streamUnsubscribe = undefined
  runtime.streamGeneration = undefined
  clearStreamBuffers(sessionId)
}

function monitorStillCurrent(identity: MonitorIdentity) {
  const state = getConversationView(identity.sessionId)
  const runtime = runtimes.get(identity.sessionId)
  return Boolean(state?.pending
    && state.generation === identity.generation
    && runtime?.monitorIdentity === identity)
}

function visibleAssistantText(message: OfficeConversationMessage) {
  return message.info?.role === 'assistant'
    && (message.parts || []).some((part) => part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0)
}

function terminalTurnMessage(message: OfficeConversationMessage) {
  return message.info?.role === 'system'
    && ['completed', 'error', 'cancelled'].includes(message.info?.kind || '')
}

function messageId(message: OfficeConversationMessage) {
  return typeof message.info?.id === 'string' ? message.info.id : null
}

function lastMessageId(messages: OfficeConversationMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const id = messageId(messages[index])
    if (id && !id.startsWith('local-')) return id
  }
  return null
}

function boundaryBeforeLatestUser(messages: OfficeConversationMessage[]) {
  // 边界固定在最新用户消息之前，监视器只允许用边界后的 assistant 或 system
  // 终态闭合当前回合，避免历史回复被误判为新回合已经完成。
  let latestUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].info?.role === 'user') {
      latestUserIndex = index
      break
    }
  }
  if (latestUserIndex < 0) return lastMessageId(messages)
  return lastMessageId(messages.slice(0, latestUserIndex))
}

function currentTurnMessages(messages: OfficeConversationMessage[], identity: MonitorIdentity) {
  if (identity.userMessageID) {
    const userIndex = messages.findIndex((message) => messageId(message) === identity.userMessageID)
    if (userIndex >= 0) {
      let end = userIndex + 1
      while (end < messages.length && messages[end].info?.role !== 'user') end += 1
      return messages.slice(userIndex, end)
    }
  }
  if (identity.boundaryMessageID) {
    const boundaryIndex = messages.findIndex((message) => messageId(message) === identity.boundaryMessageID)
    return boundaryIndex >= 0 ? messages.slice(boundaryIndex + 1) : []
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].info?.role === 'user') return messages.slice(index)
  }
  return []
}

function terminalForIdentity(messages: OfficeConversationMessage[], identity: MonitorIdentity) {
  return messages.find((message) => terminalTurnMessage(message)
    && (!identity.turnID || message.info?.turnID === identity.turnID))
}

function adoptStatusIdentity(sessionId: string, identity: MonitorIdentity, status?: { turnID?: string; userMessageID?: string }) {
  const nextTurnID = typeof status?.turnID === 'string' ? status.turnID : identity.turnID
  const nextUserMessageID = typeof status?.userMessageID === 'string' ? status.userMessageID : identity.userMessageID
  if (nextTurnID === identity.turnID && nextUserMessageID === identity.userMessageID) return
  identity.turnID = nextTurnID
  identity.userMessageID = nextUserMessageID
  bindConversationTurnIdentity(sessionId, {
    generation: identity.generation,
    turnID: nextTurnID,
    userMessageID: nextUserMessageID,
  })
}

function optimisticUserMessage(sessionId: string, text: string): OfficeConversationMessage {
  optimisticSequence += 1
  return {
    info: {
      id: `local-${sessionId}-${Date.now()}-${optimisticSequence}`,
      role: 'user',
      time: { created: Date.now() },
    },
    parts: [{ type: 'text', text }],
  }
}

function conversationRequestId(generation: number) {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${optimisticSequence.toString(36)}`
  return `office-${generation}-${random}`.slice(0, 128)
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('请求已取消', 'AbortError'))
      return
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    const finish = () => { cleanup(); resolve() }
    const timer = window.setTimeout(finish, ms)
    const abort = () => {
      window.clearTimeout(timer)
      cleanup()
      reject(new DOMException('请求已取消', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function waitForSharedStatus<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new DOMException('请求已取消', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('请求已取消', 'AbortError')) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => { cleanup(); resolve(value) },
      (error) => { cleanup(); reject(error) },
    )
  })
}

async function conversationStatuses(force = false, signal?: AbortSignal) {
  if (!force && Date.now() < statusSnapshotExpiresAt) return waitForSharedStatus(Promise.resolve(statusSnapshot), signal)
  if (!statusSnapshotPromise) {
    const requestRevision = statusSnapshotRevision
    const request = officeGatewayApi.conversationStatuses().then((statuses) => {
      if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) {
        throw new Error('批量会话状态接口返回格式无效')
      }
      if (requestRevision === statusSnapshotRevision) {
        statusSnapshot = statuses
        statusSnapshotExpiresAt = Date.now() + STATUS_SNAPSHOT_TTL_MS
      }
      return statuses
    }).finally(() => {
      if (statusSnapshotPromise === request) statusSnapshotPromise = null
    })
    statusSnapshotPromise = request
  }
  return waitForSharedStatus(statusSnapshotPromise, signal)
}

async function conversationStatus(sessionId: string, signal?: AbortSignal) {
  try {
    return (await conversationStatuses(false, signal))[sessionId]
  } catch {
    // 兼容尚未提供批量路由的旧 Gateway；当前 Gateway 正常路径不会触发逐会话回退。
    return (await officeGatewayApi.conversationStatus(sessionId, signal))[sessionId]
  }
}

async function monitorConversation(
  identity: MonitorIdentity,
  controller: AbortController,
  admissionUncertain = false,
) {
  const { sessionId, generation } = identity
  // 100ms 启动宽限用于容纳 POST 接收后状态登记的短窗口；状态转 idle 后继续
  // 对账 3 秒，等待正文和终态投影可见。120 秒只切换为 timeout 提示，监视器
  // 仍继续运行，不能把慢 Provider 误判为失败或永久解锁同一 session。
  const startedAt = Date.now()
  const startupGraceMs = 100
  const idleReconcileMs = 3_000
  const maxWaitMs = 120_000
  let observedActive = false
  let idleObservedAt: number | null = null
  let lastMessages: OfficeConversationMessage[] = getConversationView(sessionId)?.messages ?? []
  let lastMessageRead = 0
  let consecutiveFailures = 0
  let lastStatusActive: boolean | null = null

  for (;;) {
    const signal = controller.signal
    const current = getConversationView(sessionId)
    if (!current || current.generation !== generation || !current.pending) return

    try {
      const sessionStatus = await conversationStatus(sessionId, signal)
      if (!monitorStillCurrent(identity)) return
      const active = Boolean(sessionStatus)
      const activity = sessionStatus?.activity
      if (sessionStatus) adoptStatusIdentity(sessionId, identity, sessionStatus)
      lastStatusActive = active
      observedActive ||= active
      consecutiveFailures = 0
      const latestBeforeStatusPublish = getConversationView(sessionId)
      const abortRequested = runtimeFor(sessionId).abortRequestedGeneration === generation
      updateConversationView(sessionId, {
        pending: true,
        phase: abortRequested || latestBeforeStatusPublish?.phase === 'stopped'
          ? 'stopped'
          : latestBeforeStatusPublish?.phase === 'timeout' ? 'timeout' : 'loading',
        activeTool: activity?.tool ?? null,
        activityTask: activity?.task ?? null,
        turnStatus: sessionStatus?.type === 'queued' ? 'queued' : active ? 'busy' : null,
        queuePosition: sessionStatus?.type === 'queued' && Number.isFinite(sessionStatus.queuePosition) ? sessionStatus.queuePosition! : null,
        error: null,
      }, generation)
      if (active) idleObservedAt = null
      else if (idleObservedAt === null && (observedActive || Date.now() - startedAt >= startupGraceMs)) idleObservedAt = Date.now()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      consecutiveFailures += 1
      if (consecutiveFailures >= 4) {
        updateConversationView(sessionId, {
          error: '暂时无法读取回合状态，正在重试；仍可停止当前会话',
        }, generation)
      }
    }

    // 真实消息与本地乐观消息按 ID/正文合并，因此活动期间也可尽早读取可见回复。
    if (Date.now() - lastMessageRead >= (isConversationEventStreamConnected() ? 1200 : 250)) {
      lastMessageRead = Date.now()
      try {
        const nextMessages = await officeGatewayApi.conversationMessages(sessionId, controller.signal)
        if (!monitorStillCurrent(identity)) return
        if (Array.isArray(nextMessages)) {
          lastMessages = nextMessages
          rememberConversationMessages(sessionId, nextMessages, generation)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
      }
    }

    const turnMessages = currentTurnMessages(lastMessages, identity)
    const assistantReady = turnMessages.some(visibleAssistantText)
    const terminal = terminalForIdentity(turnMessages, identity)
    const latestView = getConversationView(sessionId)
    if (!latestView || latestView.generation !== generation || !latestView.pending) return

    // 持久 terminal marker 已与目标 turnID 绑定时可独立于 status 收敛；普通 assistant
    // 仍要求活动后转 idle，防止历史正文或分裂快照错误关闭当前 generation。
    if (terminal || ((observedActive || admissionUncertain) && (idleObservedAt !== null || lastStatusActive === false) && assistantReady)) {
      const terminalKind = terminal?.info?.kind
      if (terminalKind === 'completed') {
        try {
          const finalMessages = await officeGatewayApi.conversationMessages(sessionId, controller.signal)
          const currentBeforeFinal = getConversationView(sessionId)
          if (!currentBeforeFinal || currentBeforeFinal.generation !== generation || !currentBeforeFinal.pending) return
          if (Array.isArray(finalMessages)) {
            lastMessages = finalMessages
            rememberConversationMessages(sessionId, finalMessages, generation)
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error
        }
      }
      updateConversationView(sessionId, {
        messages: lastMessages,
        pending: false,
        phase: terminalKind === 'error' ? 'error' : terminalKind === 'cancelled' ? 'stopped' : 'ready',
        messagesState: 'ready',
        activeTool: null,
        activityTask: null,
        turnStatus: null,
        queuePosition: null,
        error: null,
        activeTurnID: null,
        activeUserMessageID: null,
        optimisticUserMessageID: null,
        boundaryMessageID: null,
      }, generation)
      return
    }

    if (idleObservedAt !== null && Date.now() - idleObservedAt >= idleReconcileMs) {
      if (runtimeFor(sessionId).abortRequestedGeneration === generation) {
        appendPersistentConversationNotice(sessionId, 'cancelled', '本轮已停止。', generation)
        updateConversationView(sessionId, {
          pending: false,
          phase: 'stopped',
          activeTool: null,
          activityTask: null,
          turnStatus: null,
          queuePosition: null,
          error: null,
          activeTurnID: null,
          activeUserMessageID: null,
          optimisticUserMessageID: null,
          boundaryMessageID: null,
        }, generation)
        return
      }
      if (admissionUncertain && !observedActive) {
        appendPersistentConversationNotice(sessionId, 'error', '发送确认超时，Host 未报告活动回合；本次消息可能未进入执行，请重新发送。', generation)
        updateConversationView(sessionId, {
          pending: false,
          phase: 'error',
          activeTool: null,
          activityTask: null,
          turnStatus: null,
          queuePosition: null,
          error: null,
          activeTurnID: null,
          activeUserMessageID: null,
          optimisticUserMessageID: null,
          boundaryMessageID: null,
        }, generation)
        return
      }
    }

    if (Date.now() - startedAt >= maxWaitMs && current.phase !== 'timeout') {
      updateConversationView(sessionId, {
        pending: true,
        phase: 'timeout',
        activeTool: null,
        activityTask: null,
        turnStatus: null,
        queuePosition: null,
        error: null,
      }, generation)
    }
    await delay(Date.now() - startedAt >= maxWaitMs ? 1000 : 250, controller.signal)
  }
}

function startMonitor(identity: MonitorIdentity, admissionUncertain = false) {
  const { sessionId, generation } = identity
  const runtime = runtimeFor(sessionId)
  // 同一 session 和 generation 复用唯一 monitor；开始新 generation 时取消旧读取，
  // 再由 conversationViewStore 的 generation 检查阻止迟到结果覆盖新回合。
  if (runtime.monitorPromise && runtime.monitorGeneration === generation) return runtime.monitorPromise
  attachConversationStream(identity)
  runtime.monitorController?.abort()
  const controller = new AbortController()
  runtime.monitorController = controller
  runtime.monitorGeneration = generation
  runtime.monitorIdentity = identity
  const monitorPromise = monitorConversation(identity, controller, admissionUncertain)
    .catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      const latest = getConversationView(sessionId)
      if (latest?.generation === generation && latest.pending) {
        appendPersistentConversationNotice(
          sessionId,
          'error',
          '本轮对话状态监视失败，未能确认完整回复，请重新发送。',
          generation,
        )
      }
      updateConversationView(sessionId, {
        pending: false,
        phase: 'error',
        activeTool: null,
        activityTask: null,
        turnStatus: null,
        queuePosition: null,
        error: error instanceof Error ? error.message : '会话状态读取失败',
      }, generation)
    })
    .finally(() => {
      const latest = runtimes.get(sessionId)
      if (latest?.monitorPromise === monitorPromise) {
        latest.monitorPromise = undefined
        latest.monitorController = undefined
        latest.monitorGeneration = undefined
        latest.monitorIdentity = undefined
        if (!getConversationView(sessionId)?.pending) latest.abortRequestedGeneration = undefined
      }
      if (!getConversationView(sessionId)?.pending) detachConversationStream(sessionId, generation)
    })
  runtime.monitorPromise = monitorPromise
  return monitorPromise
}

/**
 * 功能：读取一个 session 的正文和活动状态，并在发现活动回合时恢复后台监视。
 * 参数：`sessionId` 为目标会话编号。
 * 返回：加载完成 Promise；重复调用共享同一请求。
 * 错误：正文读取失败进入正文 error；状态读取失败保留现有数据并允许后台重试。
 * 状态：空闲会话加载正文；活动会话恢复 pending、排队/运行状态和唯一监视器。
 * 并发与取消：不绑定组件生命周期，切换页面不会终止正在运行的会话。
 * 权限：只调用目标 session 的 Gateway 状态和消息接口。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export function ensureConversationLoaded(sessionId: string, restoredStatus?: OfficeConversationStatus) {
  const runtime = runtimeFor(sessionId)
  if (runtime.loadPromise) return runtime.loadPromise
  const current = getConversationView(sessionId)
  if (!current) updateConversationView(sessionId, { messagesState: 'loading' })
  const initial = getConversationView(sessionId) ?? EMPTY_CONVERSATION_VIEW
  const loadGeneration = initial.generation

  // 已活动的回合只能由唯一 monitor 读取状态，避免重新选中时的迟到 busy 响应覆盖已完成结果。
  if (initial.pending) {
    const identity = runtime.monitorIdentity ?? {
      sessionId,
      generation: initial.generation,
      turnID: initial.activeTurnID,
      userMessageID: initial.activeUserMessageID,
      boundaryMessageID: initial.boundaryMessageID ?? boundaryBeforeLatestUser(initial.messages),
    }
    const loadPromise = Promise.resolve(startMonitor(identity)).finally(() => {
      const latest = runtimes.get(sessionId)
      if (latest?.loadPromise === loadPromise) latest.loadPromise = undefined
    })
    runtime.loadPromise = loadPromise
    return loadPromise
  }

  // 正文和状态并行读取以缩短冷进入等待；两条路径都绑定 loadGeneration，活动
  // 回合恢复或新发送发生后，旧读取不能覆盖最新 pending 和正文。
  const messagesPromise = officeGatewayApi.conversationMessages(sessionId).then((messages) => {
    if (Array.isArray(messages)) {
      rememberConversationMessages(sessionId, messages, loadGeneration)
      return messages
    }
    return initial.messages
  }).catch(() => {
    const latest = getConversationView(sessionId) ?? EMPTY_CONVERSATION_VIEW
    if (latest.generation === loadGeneration && !latest.pending) {
      // Host/Gateway 离线时，本地持久化的入场前失败消息仍是当前浏览器可用事实。
      // 已有本地正文应继续显示，只在完全没有可展示内容时进入读取错误空态。
      updateConversationView(sessionId, {
        messagesState: latest.messages.length > 0 ? 'ready' : 'error',
      }, loadGeneration)
    }
    return initial.messages
  })

  const loadPromise = (async () => {
    const beforeStatus = getConversationView(sessionId) ?? EMPTY_CONVERSATION_VIEW
    if (beforeStatus.generation !== loadGeneration) return
    const sessionStatus = restoredStatus ?? await conversationStatus(sessionId)
    const latest = getConversationView(sessionId) ?? EMPTY_CONVERSATION_VIEW
    if (latest.generation !== loadGeneration) return
    if (sessionStatus) {
      const activity = sessionStatus?.activity
      const generation = latest.generation || beginConversationTurn(sessionId)
      updateConversationView(sessionId, {
        pending: true,
        phase: 'loading',
        messagesState: 'ready',
        activeTool: activity?.tool ?? null,
        activityTask: activity?.task ?? null,
        turnStatus: sessionStatus?.type === 'queued' ? 'queued' : 'busy',
        queuePosition: sessionStatus?.type === 'queued' && Number.isFinite(sessionStatus?.queuePosition) ? sessionStatus?.queuePosition ?? null : null,
        error: null,
        activeTurnID: sessionStatus?.turnID ?? latest.activeTurnID,
        activeUserMessageID: sessionStatus?.userMessageID ?? latest.activeUserMessageID,
        boundaryMessageID: latest.boundaryMessageID ?? boundaryBeforeLatestUser(initial.messages),
      }, generation)
      void startMonitor({
        sessionId,
        generation,
        turnID: sessionStatus?.turnID ?? latest.activeTurnID,
        userMessageID: sessionStatus?.userMessageID ?? latest.activeUserMessageID,
        boundaryMessageID: latest.boundaryMessageID ?? boundaryBeforeLatestUser(initial.messages),
      })
    } else {
      await messagesPromise
      const afterMessages = getConversationView(sessionId) ?? EMPTY_CONVERSATION_VIEW
      if (afterMessages.generation !== loadGeneration || afterMessages.pending) return
      updateConversationView(sessionId, {
        pending: false,
        phase: afterMessages.phase === 'ready' ? 'ready' : 'idle',
        activeTool: null,
        activityTask: null,
        turnStatus: null,
        queuePosition: null,
      })
    }
  })().catch(() => {
    const latest = getConversationView(sessionId) ?? EMPTY_CONVERSATION_VIEW
    if (latest.pending) updateConversationView(sessionId, { error: '暂时无法读取回合状态，正在重试；仍可停止当前会话' })
  }).finally(() => {
    const latest = runtimes.get(sessionId)
    if (latest?.loadPromise === loadPromise) latest.loadPromise = undefined
  })
  runtime.loadPromise = loadPromise
  void messagesPromise
  return loadPromise
}

/**
 * 功能：从会话摘要批量恢复所有 queued/busy 会话，而不依赖当前 UI 选中项。
 * 参数：可选 session 编号数组；省略时先读取 Gateway 会话摘要。
 * 返回：所有会话完成一次加载/恢复尝试后的 Promise。
 * 错误：单 session 故障被隔离，其余会话继续恢复；摘要读取失败时 Promise 拒绝。
 * 状态：活动会话建立独立 generation 和 monitor，空闲会话只预热正文缓存。
 * 并发与取消：全局复用一个批量恢复 Promise，重复调用不会创建重复 monitor。
 * 权限：只读取脱敏会话摘要、状态和正文。
 * 关联：`CHG-2026-0014`、`BLK-01`、`BLK-07`。
 */
export function restoreActiveConversations(sessionIds?: string[]) {
  if (activeRecoveryCompleted && sessionIds === undefined) return Promise.resolve()
  if (activeRecoveryPromise) return activeRecoveryPromise
  const recovery = (async () => {
    try {
      const statuses = await conversationStatuses(true)
      const ids = sessionIds ? sessionIds.filter((sessionId) => statuses[sessionId]) : Object.keys(statuses)
      await Promise.allSettled(ids.map((sessionId) => ensureConversationLoaded(sessionId, statuses[sessionId])))
    } catch {
      // 旧 Gateway 没有批量状态接口时保留兼容恢复；新版正常路径不会为 50 个空闲
      // 会话逐一加载正文。
      const ids = sessionIds ?? (await officeGatewayApi.sessions()).map((session) => session.id)
      await Promise.allSettled(ids.map((sessionId) => ensureConversationLoaded(sessionId)))
    }
    if (sessionIds === undefined) activeRecoveryCompleted = true
  })().finally(() => {
    if (activeRecoveryPromise === recovery) activeRecoveryPromise = null
  })
  activeRecoveryPromise = recovery
  return recovery
}

/**
 * 功能：向指定 session 发送一轮文本并在后台等待该 session 的最终消息。
 * 参数：`sessionId` 为目标会话；`text` 为用户文本。
 * 返回：回合完成、失败、停止或超时后的 Promise。
 * 错误：同一 session 已活动或 Gateway 拒绝时更新该 session 错误并抛出。
 * 状态：先追加乐观 user，再按接收结果进入 monitor、timeout 协调或本地失败正文。
 * 并发与取消：同一 session 只允许一个 pending；不同 session 可独立并发。
 * 权限：只发送用户提供的文本；错误正文必须脱敏。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export async function sendConversationTurn(sessionId: string, text: string) {
  const content = text.trim()
  if (!content) throw new Error('请输入消息')
  const before = getConversationView(sessionId) ?? EMPTY_CONVERSATION_VIEW
  if (before.pending) throw new Error('当前会话仍在处理中')
  const boundaryMessageId = lastMessageId(before.messages)
  const generation = beginConversationTurn(sessionId)
  const optimistic = optimisticUserMessage(sessionId, content)
  appendConversationMessage(sessionId, optimistic, generation)
  bindConversationTurnIdentity(sessionId, {
    generation,
    optimisticUserMessageID: String(optimistic.info?.id || ''),
    boundaryMessageID: boundaryMessageId,
  })
  const identity: MonitorIdentity = {
    sessionId,
    generation,
    turnID: null,
    userMessageID: null,
    boundaryMessageID: boundaryMessageId,
  }
  attachConversationStream(identity)
  const requestID = conversationRequestId(generation)
  try {
    const accepted = await officeGatewayApi.sendConversationMessage(sessionId, content, requestID)
    if (typeof accepted.turnID === 'string') adoptStatusIdentity(sessionId, identity, accepted)
    await startMonitor(identity)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    // 内部 HTTP 超时表示接收结果不确定，必须继续查询 Host；明确的 409/429/503
    // 则表示请求未入场，直接生成浏览器本地 system notice 并解除输入锁。
    if (error instanceof OfficeGatewayTimeoutError) {
      updateConversationView(sessionId, {
        pending: true,
        phase: 'timeout',
        activeTool: null,
        activityTask: null,
        turnStatus: null,
        queuePosition: null,
        error: null,
      }, generation)
      await startMonitor(identity, true)
      return
    }
    if (error instanceof OfficeGatewayHttpError
      && error.status === 409
      && (error.code === 'active_turn' || error.code == null)) {
      // 409 表示 Host 已有活动回合。先接管真实 turn/user 身份并继续 monitor，
      // 不把本地重试写成永久失败，也不重复提交 Provider。
      try {
        const sessionStatus = await conversationStatus(sessionId)
        if (sessionStatus && (sessionStatus.turnID || sessionStatus.userMessageID)) {
          adoptStatusIdentity(sessionId, identity, sessionStatus)
          updateConversationView(sessionId, {
            pending: true,
            phase: 'loading',
            activeTool: sessionStatus.activity?.tool ?? null,
            activityTask: sessionStatus.activity?.task ?? null,
            turnStatus: sessionStatus.type === 'queued' ? 'queued' : 'busy',
            queuePosition: sessionStatus.type === 'queued' && Number.isFinite(sessionStatus.queuePosition)
              ? sessionStatus.queuePosition ?? null
              : null,
            error: null,
          }, generation)
          await startMonitor(identity)
          return
        }
      } catch {
        // 接管查询失败时仍交由 monitor 重试；不能因单次 status 故障解除输入锁。
        updateConversationView(sessionId, {
          pending: true,
          phase: 'loading',
          error: '检测到已有活动回合，正在恢复监视…',
        }, generation)
        await startMonitor(identity, true)
        return
      }
    }
    const detail = error instanceof Error ? error.message : '消息发送失败'
    appendPersistentConversationNotice(sessionId, 'error', `消息未进入执行：${detail}`, generation)
    updateConversationView(sessionId, {
      pending: false,
      phase: 'error',
      activeTool: null,
      activityTask: null,
      turnStatus: null,
      queuePosition: null,
      error: null,
      activeTurnID: null,
      activeUserMessageID: null,
      optimisticUserMessageID: null,
      boundaryMessageID: null,
    }, generation)
    throw error
  }
}

/**
 * 功能：只停止指定 session 的当前回合，不影响其它并行会话。
 * 参数：`sessionId` 为需要停止的会话编号。
 * 返回：Gateway 停止请求完成后的 Promise。
 * 错误：Gateway 停止失败时解除输入锁并保留可重试错误。
 * 状态：先进入 stopped/pending，收到 Host cancelled 正文或本地对账兜底后才结束。
 * 并发与取消：保留该 session 的监视器和 generation，直到 Host 的 cancelled 正文可见后才解除输入锁。
 * 权限：只能停止调用方已选择的目标 session，不影响其它 session。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export async function abortConversationTurn(sessionId: string) {
  const current = getConversationView(sessionId) ?? EMPTY_CONVERSATION_VIEW
  const identity: MonitorIdentity = runtimeFor(sessionId).monitorIdentity ?? {
    sessionId,
    generation: current.generation,
    turnID: current.activeTurnID,
    userMessageID: current.activeUserMessageID,
    boundaryMessageID: current.boundaryMessageID ?? boundaryBeforeLatestUser(current.messages),
  }
  updateConversationView(sessionId, {
    pending: true,
    phase: 'stopped',
    activeTool: null,
    activityTask: null,
    turnStatus: current.turnStatus,
    queuePosition: current.queuePosition,
    error: '正在停止本轮生成…',
  }, current.generation)
  runtimeFor(sessionId).abortRequestedGeneration = current.generation
  try {
    await officeGatewayApi.abortConversation(sessionId)
    // 204 只确认取消请求已接收。主动读取一次持久正文，避免已有 cancelled
    // marker 仍需等待下一轮轮询；缺少 marker 时继续由 monitor 执行 idle 兜底。
    try {
      const messages = await officeGatewayApi.conversationMessages(sessionId)
      rememberConversationMessages(sessionId, messages, current.generation)
      const terminal = terminalForIdentity(currentTurnMessages(messages, identity), identity)
      if (terminal?.info?.kind === 'cancelled') {
        updateConversationView(sessionId, {
          messages,
          pending: false,
          phase: 'stopped',
          activeTool: null,
          activityTask: null,
          turnStatus: null,
          queuePosition: null,
          error: null,
          activeTurnID: null,
          activeUserMessageID: null,
          optimisticUserMessageID: null,
          boundaryMessageID: null,
        }, current.generation)
        runtimeFor(sessionId).abortRequestedGeneration = undefined
        return
      }
    } catch {
      // messages 暂时不可用时保持 pending，由既有 monitor 继续重试和收敛。
    }
    try {
      const sessionStatus = await conversationStatus(sessionId)
      if (!sessionStatus) {
        appendPersistentConversationNotice(sessionId, 'cancelled', '本轮已停止。', current.generation)
        updateConversationView(sessionId, {
          pending: false,
          phase: 'stopped',
          activeTool: null,
          activityTask: null,
          turnStatus: null,
          queuePosition: null,
          error: null,
          activeTurnID: null,
          activeUserMessageID: null,
          optimisticUserMessageID: null,
          boundaryMessageID: null,
        }, current.generation)
        runtimeFor(sessionId).abortRequestedGeneration = undefined
        return
      }
    } catch {
      // status 单路失败不能错误解锁；保留 pending 并由 monitor 重试。
    }
    void startMonitor(identity)
    // abort 的 204 只表示取消请求已接受，不代表 cancelled marker 已可读取；继续
    // 保持 pending，避免用户立即发下一轮与 Host 尚未结束的旧回合发生 409 竞争。
    const latest = getConversationView(sessionId)
    if (latest?.generation === current.generation && latest.pending) {
      updateConversationView(sessionId, {
        pending: true,
        phase: 'stopped',
        activeTool: null,
        activityTask: null,
        turnStatus: latest.turnStatus,
        queuePosition: latest.queuePosition,
        error: '正在等待本轮安全停止…',
      }, current.generation)
    }
  } catch (error) {
    runtimeFor(sessionId).abortRequestedGeneration = undefined
    const latest = getConversationView(sessionId)
    if (latest?.generation === current.generation && latest.pending) {
      appendPersistentConversationNotice(sessionId, 'error', `停止请求失败：${error instanceof Error ? error.message : '停止生成失败'}；当前回合仍在监视，可重试停止。`, current.generation)
      updateConversationView(sessionId, {
        pending: true,
        phase: 'loading',
        turnStatus: latest.turnStatus,
        queuePosition: latest.queuePosition,
        error: '停止请求未确认，当前回合仍在监视；可重试停止',
      }, current.generation)
      void startMonitor(identity)
    }
    throw error
  }
}

/**
 * 功能：向 React 组件提供所选 session 的快照、发送、停止和刷新操作。
 * 参数：`sessionId` 为当前选择会话，`null` 表示未选择。
 * 返回：稳定的控制器对象，其中状态只来自目标 session。
 * 错误：发送和停止 Promise 保留底层错误；无选择时发送返回明确错误。
 * 状态：选择变化只切换订阅，不清空缓存或取消后台回合。
 * 并发与取消：不同 session 各自拥有 generation 和 monitor；组件卸载不终止执行。
 * 权限：只访问调用方传入的 session，不暴露工具输入输出或 reasoning。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export function useConversationController(sessionId: string | null): {
  state: ConversationViewState
  send: (text: string) => Promise<void>
  abort: () => Promise<void>
  refresh: () => Promise<void>
} {
  const subscribe = useCallback((listener: () => void) => sessionId ? subscribeConversationView(sessionId, listener) : () => undefined, [sessionId])
  const getSnapshot = useCallback(() => getConversationSnapshot(sessionId), [sessionId])
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CONVERSATION_VIEW)

  useEffect(() => {
    if (sessionId) void ensureConversationLoaded(sessionId)
    void restoreActiveConversations().catch(() => undefined)
  }, [sessionId])

  return {
    state,
    send: useCallback((text: string) => sessionId ? sendConversationTurn(sessionId, text) : Promise.reject(new Error('请选择会话')), [sessionId]),
    abort: useCallback(() => sessionId ? abortConversationTurn(sessionId) : Promise.resolve(), [sessionId]),
    refresh: useCallback(() => sessionId ? ensureConversationLoaded(sessionId) : Promise.resolve(), [sessionId]),
  }
}

/**
 * 功能：清理全部前端会话控制器运行态，供测试隔离使用。
 * 参数：无。
 * 返回：无。
 * 错误：无。
 * 状态：中止本地 monitor 并清空 runtime map 和乐观消息序列。
 * 并发与取消：只取消浏览器请求，不向 Host 发送 abort，也不改变远端回合。
 * 权限：测试辅助入口，不访问外部数据。
 * 关联：`CHG-2026-0013`。
 */
export function resetConversationControllers() {
  runtimes.forEach((runtime) => {
    runtime.monitorController?.abort()
    runtime.streamUnsubscribe?.()
  })
  runtimes.clear()
  streamMessageInfo.clear()
  streamParts.clear()
  resetConversationEventStream()
  optimisticSequence = 0
  activeRecoveryPromise = null
  activeRecoveryCompleted = false
  statusSnapshot = {}
  statusSnapshotExpiresAt = 0
  statusSnapshotPromise = null
  statusSnapshotRevision += 1
}
