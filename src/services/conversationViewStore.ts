/**
 * 功能：按 session 保存对话正文和独立回合运行态，并向 React/后台协调器提供订阅快照。
 * 数据来源：乐观用户消息、Gateway 消息与目标会话状态；数据去向：对话中心和后台轮询器。
 * 并发与取消：每个 session 使用独立 generation；旧请求不能覆盖新回合，活动会话不会被 LRU 淘汰。
 * 权限：只保存文本消息和脱敏活动摘要，不保存工具输入、输出、凭据或文件正文。
 */
import type { OfficeConversationMessage } from '@/types/officeData'

/**
 * 对话回合在前端的可观察阶段。
 *
 * 功能：约束一个 session 在 UI 中可呈现的回合生命周期。
 * 字段/变体语义：`idle/loading/ready/stopped/timeout/error` 分别表示空闲、执行、完成、停止、等待超时和失败。
 * 数据来源：对话控制器对 Gateway 状态、正文和本地操作的协调结果。
 * 数据去向：输入锁、状态提示、停止按钮和会话列表运行标识。
 * 约束：阶段不能替代 Host turn outcome；`timeout` 仍保持后台监视。
 * 稳定性：前端内部公共类型，新增变体必须同步 UI 和测试。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
/** 公共类型：描述一个会话回合的前端阶段。 */
type ConversationPhase = 'idle' | 'loading' | 'ready' | 'stopped' | 'timeout' | 'error'

/**
 * 对话正文快照的读取阶段。
 *
 * 功能：表示正文是否尚未读取、正在读取、可显示或读取失败。
 * 字段/变体语义：`idle/loading/ready/error` 只描述正文读取，不描述回合执行结果。
 * 数据来源：`ensureConversationLoaded` 和 Gateway 消息接口。
 * 数据去向：对话正文的骨架、空态和错误态。
 * 约束：已有正文的后台刷新失败不得清空缓存。
 * 稳定性：前端内部公共类型。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
/** 公共类型：描述会话正文的读取阶段。 */
type ConversationMessagesState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 单个 session 的完整前端快照。
 *
 * 功能：把正文、运行态、工具摘要和 generation 绑定到唯一 session。
 * 字段/变体语义：消息与加载状态控制正文；pending/phase/turnStatus 控制回合；generation 隔离迟到结果。
 * 数据来源：Gateway 消息与状态接口、乐观用户消息和浏览器本地 notice。
 * 数据去向：对话中心、最近会话运行标识和后台监视器。
 * 约束：所有字段只属于当前 `sessionId`；不得保存 reasoning、工具输入输出或凭据。
 * 稳定性：前端内部公共状态契约，字段变更必须同步控制器和测试。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
/** 公共类型：保存单个 session 的完整前端快照。 */
export type ConversationViewState = {
  /** 已清洗的用户和助手文本消息。 */
  messages: OfficeConversationMessage[]
  /** 当前 session 是否仍有活动回合。 */
  pending: boolean
  /** 当前回合阶段。 */
  phase: ConversationPhase
  /** 正文读取阶段。 */
  messagesState: ConversationMessagesState
  /** 当前脱敏工具名；没有工具活动时为 `null`。 */
  activeTool: string | null
  /** 当前脱敏活动短提示；用于展示连续工具调用和恢复过程。 */
  activityTask: string | null
  /** Host 活动态；`queued` 表示等待全局运行槽位，`busy` 表示已开始执行。 */
  turnStatus: 'queued' | 'busy' | null
  /** 排队时的近似位置；运行或空闲时为 `null`。 */
  queuePosition: number | null
  /** 当前 session 的错误或停止提示。 */
  error: string | null
  /** 当前回合代数；用于拒绝迟到异步结果。 */
  generation: number
  /** Host 当前回合编号；未知或尚未接管时为 `null`。 */
  activeTurnID: string | null
  /** Host 当前回合对应的用户消息编号；未知时为 `null`。 */
  activeUserMessageID: string | null
  /** 当前回合浏览器乐观用户消息编号；用于按身份替换而不是按正文去重。 */
  optimisticUserMessageID: string | null
  /** 当前回合开始前最后一条远端消息编号；用于恢复本地失败的稳定插入位置。 */
  boundaryMessageID: string | null
  /** 最近更新时间，用于有界缓存淘汰。 */
  updatedAt: number
}

const MAX_CACHED_SESSIONS = 24
const MAX_CACHED_MESSAGES = 80
const MAX_CACHED_TEXT_LENGTH = 180_000
const LOCAL_NOTICE_STORAGE_KEY_V1 = 'ai-office.conversation-notices.v1'
const LOCAL_NOTICE_STORAGE_KEY_V2 = 'ai-office.conversation-notices.v2'
const MAX_LOCAL_NOTICE_SESSIONS = 40
const MAX_LOCAL_NOTICES_PER_SESSION = 10
const states = new Map<string, ConversationViewState>()
const listeners = new Map<string, Set<() => void>>()
const lruOrdinals = new Map<string, number>()
let nextLruOrdinal = 0

type LocalMessageKind = 'user' | 'error' | 'cancelled'

type LocalNoticeEnvelope = {
  version: 2
  sessionId: string
  localTurnId: string
  localTurnOrdinal: number
  messageKind: LocalMessageKind
  afterRemoteMessageId: string | null
  createdAt: number
  ordinal: number
  message: OfficeConversationMessage
}

/**
 * 功能：为空选择提供共享且稳定的只读对话快照。
 * 字段语义：所有状态均为空闲，消息为空，generation 和更新时间为零。
 * 错误：无；对象使用 `Object.freeze` 防止调用方误改。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
/** 公共常量：未选择会话时使用的稳定空快照。 */
export const EMPTY_CONVERSATION_VIEW: ConversationViewState = Object.freeze({
  messages: [],
  pending: false,
  phase: 'idle',
  messagesState: 'idle',
  activeTool: null,
  activityTask: null,
  turnStatus: null,
  queuePosition: null,
  error: null,
  generation: 0,
  activeTurnID: null,
  activeUserMessageID: null,
  optimisticUserMessageID: null,
  boundaryMessageID: null,
  updatedAt: 0,
})

function parseStorageRecord(key: string): Record<string, unknown[]> {
  try {
    const value = window.localStorage.getItem(key)
    const parsed = value ? JSON.parse(value) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // localStorage 损坏、隐私模式或访问被拒绝时按空集合降级；后续白名单清洗、
    // session 数量上限和单 session 条数上限共同约束浏览器侧数据规模。
    return {}
  }
}

function messageCreatedAt(message: OfficeConversationMessage, fallback: number) {
  const value = message.info?.time?.created
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function migrateV1Envelopes(sessionId: string, values: unknown[]): LocalNoticeEnvelope[] {
  const messages = sanitizeConversationMessages(values as OfficeConversationMessage[])
    .filter((message) => ['user', 'system'].includes(message.info?.role || '') && String(message.info?.id || '').startsWith('local-'))
  let turnOrdinal = 0
  let localTurnId = `legacy-${sessionId}-0`
  return messages.map((message, index) => {
    if (message.info?.role === 'user') {
      turnOrdinal += 1
      localTurnId = String(message.info?.id || `legacy-${sessionId}-${turnOrdinal}`)
    } else if (turnOrdinal === 0) {
      turnOrdinal = 1
      localTurnId = `legacy-${sessionId}-${turnOrdinal}`
    }
    return {
      version: 2,
      sessionId,
      localTurnId,
      localTurnOrdinal: turnOrdinal,
      messageKind: message.info?.role === 'user' ? 'user' : message.info?.kind === 'cancelled' ? 'cancelled' : 'error',
      afterRemoteMessageId: null,
      createdAt: messageCreatedAt(message, index),
      ordinal: index,
      message,
    }
  })
}

function validEnvelope(value: unknown, sessionId: string): LocalNoticeEnvelope | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<LocalNoticeEnvelope>
  if (source.version !== 2 || source.sessionId !== sessionId || typeof source.localTurnId !== 'string'
    || !Number.isFinite(source.localTurnOrdinal) || !Number.isFinite(source.createdAt) || !Number.isFinite(source.ordinal)
    || !['user', 'error', 'cancelled'].includes(source.messageKind || '')) return null
  const message = sanitizeConversationMessages([source.message as OfficeConversationMessage])[0]
  if (!message || !String(message.info?.id || '').startsWith('local-')) return null
  return {
    version: 2,
    sessionId,
    localTurnId: source.localTurnId,
    localTurnOrdinal: Number(source.localTurnOrdinal),
    messageKind: source.messageKind as LocalMessageKind,
    afterRemoteMessageId: typeof source.afterRemoteMessageId === 'string' ? source.afterRemoteMessageId : null,
    createdAt: Number(source.createdAt),
    ordinal: Number(source.ordinal),
    message,
  }
}

function readLocalEnvelopes(sessionId: string) {
  const v2Values = parseStorageRecord(LOCAL_NOTICE_STORAGE_KEY_V2)[sessionId] ?? []
  const v2 = v2Values.map((value) => validEnvelope(value, sessionId)).filter((value): value is LocalNoticeEnvelope => Boolean(value))
  if (v2.length > 0) return v2.slice(-MAX_LOCAL_NOTICES_PER_SESSION)
  const migrated = migrateV1Envelopes(sessionId, parseStorageRecord(LOCAL_NOTICE_STORAGE_KEY_V1)[sessionId] ?? [])
  if (migrated.length > 0) writeLocalEnvelopes(sessionId, migrated)
  return migrated.slice(-MAX_LOCAL_NOTICES_PER_SESSION)
}

function writeLocalEnvelopes(sessionId: string, envelopes: LocalNoticeEnvelope[]) {
  try {
    const current = parseStorageRecord(LOCAL_NOTICE_STORAGE_KEY_V2)
    const unique = [...new Map(envelopes.map((envelope) => [
      `${envelope.localTurnId}:${envelope.messageKind}`,
      envelope,
    ])).values()]
    const entries = Object.entries({ ...current, [sessionId]: unique.slice(-MAX_LOCAL_NOTICES_PER_SESSION) })
      .slice(-MAX_LOCAL_NOTICE_SESSIONS)
    window.localStorage.setItem(LOCAL_NOTICE_STORAGE_KEY_V2, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // 隐私模式或配额不足时仍保留当前页面内存状态。
  }
}

function localEnvelopeOrder(left: LocalNoticeEnvelope, right: LocalNoticeEnvelope) {
  return left.localTurnOrdinal - right.localTurnOrdinal || left.ordinal - right.ordinal || left.createdAt - right.createdAt
}

function mergeLocalEnvelopes(remoteMessages: OfficeConversationMessage[], envelopes: LocalNoticeEnvelope[]) {
  const output = [...remoteMessages]
  for (const envelope of [...envelopes].sort(localEnvelopeOrder)) {
    const id = envelope.message.info?.id
    if (id && output.some((message) => message.info?.id === id)) continue
    let insertAt = -1
    if (envelope.afterRemoteMessageId) {
      const anchorIndex = output.findIndex((message) => message.info?.id === envelope.afterRemoteMessageId)
      if (anchorIndex >= 0) {
        insertAt = anchorIndex + 1
        while (insertAt < output.length && String(output[insertAt].info?.id || '').startsWith('local-')) insertAt += 1
      }
    }
    if (insertAt < 0) {
      insertAt = output.findIndex((message) => messageCreatedAt(message, Number.POSITIVE_INFINITY) > envelope.createdAt)
      if (insertAt < 0) insertAt = output.length
    }
    output.splice(insertAt, 0, envelope.message)
  }
  return output
}

function createState(sessionId?: string): ConversationViewState {
  return {
    messages: sessionId ? mergeLocalEnvelopes([], readLocalEnvelopes(sessionId)) : [],
    pending: false,
    phase: 'idle',
    messagesState: 'idle',
    activeTool: null,
    activityTask: null,
    turnStatus: null,
    queuePosition: null,
    error: null,
    generation: 0,
    activeTurnID: null,
    activeUserMessageID: null,
    optimisticUserMessageID: null,
    boundaryMessageID: null,
    updatedAt: Date.now(),
  }
}

/**
 * 功能：清洗进入前端会话缓存的消息，建立与 Office Gateway 相同的数据边界。
 * 参数：`messages` 为 Gateway、旧版本缓存或测试替身返回的消息数组。
 * 返回：只保留 `info.id/sessionID/role/time` 和文本 part 的白名单副本。
 * 错误：非法数组项和字段被丢弃，不抛出解析异常。
 * 状态：只创建白名单副本，不修改调用方对象或缓存。
 * 并发与取消：纯同步转换，无异步取消语义。
 * 权限：丢弃 reasoning、tool 及 `state.input/output/error`，只保留可展示文本。
 * 关联：`CHG-2026-0010`、`API-OFFICE-GATEWAY-001`。
 */
export function sanitizeConversationMessages(messages: OfficeConversationMessage[]) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((message) => message && typeof message === 'object')
    .map((message) => {
      // 通过允许字段重建安全副本，而不是尝试删除已知敏感字段；这样新增的
      // reasoning、tool 或 Provider 私有字段默认不会进入浏览器缓存。
      const sourceInfo = message.info && typeof message.info === 'object' ? message.info : {}
      const sourceInfoRecord = sourceInfo as Record<string, unknown>
      const infoRecord = Object.fromEntries(['id', 'sessionID', 'role', 'kind', 'turnID']
        .filter((key) => typeof sourceInfoRecord[key] === 'string')
        .map((key) => [key, sourceInfoRecord[key]])) as Record<string, unknown>
      const sourceTime = sourceInfoRecord.time
      if (sourceTime && typeof sourceTime === 'object' && !Array.isArray(sourceTime)) {
        const timeRecord = sourceTime as Record<string, unknown>
        const time = Object.fromEntries(['created', 'completed']
          .filter((key) => typeof timeRecord[key] === 'number' && Number.isFinite(timeRecord[key]))
          .map((key) => [key, timeRecord[key]]))
        if (Object.keys(time).length > 0) infoRecord.time = time
      }
      const info = infoRecord as OfficeConversationMessage['info']
      const parts = (message.parts || [])
        .filter((part) => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
        .map((part) => Object.fromEntries(['id', 'messageID', 'sessionID', 'type', 'text']
          .filter((key) => key === 'text' || typeof (part as unknown as Record<string, unknown>)[key] === 'string')
          .map((key) => [key, (part as unknown as Record<string, unknown>)[key]])))
      return { info, parts } as OfficeConversationMessage
    })
}

function trimMessages(messages: OfficeConversationMessage[]) {
  const sanitized = sanitizeConversationMessages(messages)
  const turns: OfficeConversationMessage[][] = []
  for (const message of sanitized) {
    if (message.info?.role === 'user' || turns.length === 0) turns.push([message])
    else turns[turns.length - 1].push(message)
  }
  let textLength = 0
  let messageCount = 0
  const trimmed: OfficeConversationMessage[] = []
  // 缓存预算按完整 user 回合应用。最新回合即使单独超过预算也整体保留，避免
  // 180004 字 assistant 被后置空 completed marker 淘汰或留下半个回合。
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    const turnTextLength = turn.reduce((total, message) => total + (message.parts || [])
      .reduce((messageTotal, part) => messageTotal + (typeof part.text === 'string' ? part.text.length : 0), 0), 0)
    if (trimmed.length > 0 && (textLength + turnTextLength > MAX_CACHED_TEXT_LENGTH
      || messageCount + turn.length > MAX_CACHED_MESSAGES)) break
    trimmed.unshift(...turn)
    textLength += turnTextLength
    messageCount += turn.length
  }
  return trimmed
}

function messagesEqual(left: OfficeConversationMessage[], right: OfficeConversationMessage[]) {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((message, index) => JSON.stringify(message) === JSON.stringify(right[index]))
}

function touchSession(sessionId: string) {
  nextLruOrdinal += 1
  lruOrdinals.set(sessionId, nextLruOrdinal)
}

function notify(sessionId: string) {
  listeners.get(sessionId)?.forEach((listener) => listener())
}

function trimStates() {
  if (states.size <= MAX_CACHED_SESSIONS) return
  const candidates = [...states.entries()]
    .filter(([sessionId, state]) => !state.pending && readLocalEnvelopes(sessionId).length === 0)
    .sort(([leftId], [rightId]) => (lruOrdinals.get(leftId) ?? 0) - (lruOrdinals.get(rightId) ?? 0))
  for (const [sessionId] of candidates) {
    if (states.size <= MAX_CACHED_SESSIONS) break
    states.delete(sessionId)
    lruOrdinals.delete(sessionId)
  }
}

/**
 * 功能：返回指定 session 用于外部订阅的稳定快照。
 * 参数：`sessionId` 为目标会话；`null` 表示当前未选择会话。
 * 返回：已缓存快照，不存在时返回共享空快照。
 * 错误：无。
 * 状态：只读，不创建缓存项。
 * 并发与取消：可与后台监视并发读取；更新由 generation 控制。
 * 权限：只暴露已清洗的消息和脱敏活动摘要。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export function getConversationSnapshot(sessionId: string | null): ConversationViewState {
  if (!sessionId) return EMPTY_CONVERSATION_VIEW
  const state = states.get(sessionId)
  if (state) touchSession(sessionId)
  return state ?? EMPTY_CONVERSATION_VIEW
}

/**
 * 功能：订阅指定 session 的快照变化。
 * 参数：`sessionId` 为目标会话；`listener` 为 React 外部存储监听器。
 * 返回：只移除当前监听器的取消函数。
 * 错误：无。
 * 状态：增加或移除内存监听器，不改变会话数据。
 * 并发与取消：不同 session 监听器完全隔离；取消订阅不会取消后台回合。
 * 权限：不增加数据访问权限。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export function subscribeConversationView(sessionId: string, listener: () => void) {
  const sessionListeners = listeners.get(sessionId) ?? new Set<() => void>()
  sessionListeners.add(listener)
  listeners.set(sessionId, sessionListeners)
  return () => {
    sessionListeners.delete(listener)
    if (sessionListeners.size === 0) listeners.delete(sessionId)
  }
}

/**
 * 功能：原子更新指定 session，并发布新的稳定快照。
 * 参数：目标 `sessionId`、字段补丁和可选预期 generation。
 * 返回：更新成功返回 true；generation 不匹配返回 false。
 * 错误：无；消息在写入前统一清洗和裁剪。
 * 状态：刷新目标 session 的 LRU 顺序并通知其监听器。
 * 并发与取消：预期 generation 用于拒绝旧请求和旧监视器的迟到结果。
 * 权限：只接受前端内部已脱敏状态。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export function updateConversationView(
  sessionId: string,
  patch: Partial<Omit<ConversationViewState, 'updatedAt'>>,
  expectedGeneration?: number,
) {
  const existed = states.has(sessionId)
  const current = states.get(sessionId) ?? createState(sessionId)
  if (expectedGeneration !== undefined && current.generation !== expectedGeneration) return false
  const nextMessages = patch.messages ? trimMessages(patch.messages) : current.messages
  const next: ConversationViewState = {
    ...current,
    ...patch,
    messages: messagesEqual(current.messages, nextMessages) ? current.messages : nextMessages,
    updatedAt: Date.now(),
  }
  const unchanged = (Object.keys(next) as (keyof ConversationViewState)[])
    .filter((key) => key !== 'updatedAt')
    .every((key) => key === 'messages' ? next.messages === current.messages : next[key] === current[key])
  if (existed && unchanged) return true
  states.set(sessionId, next)
  touchSession(sessionId)
  trimStates()
  notify(sessionId)
  return true
}

/**
 * 功能：开始指定 session 的新前端回合。
 * 参数：`sessionId` 为目标会话。
 * 返回：递增后的 generation。
 * 错误：无。
 * 状态：设置 pending/loading 并清空上轮活动摘要和临时错误。
 * 并发与取消：每个 session 独立递增；旧 generation 结果随后会被拒绝。
 * 权限：不发送网络请求。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export function beginConversationTurn(sessionId: string) {
  const generation = (states.get(sessionId)?.generation ?? 0) + 1
  updateConversationView(sessionId, {
    generation,
    pending: true,
    phase: 'loading',
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
  })
  return generation
}

/**
 * 功能：读取指定会话的可修改缓存副本，供协调器计算下一状态。
 * 参数：`sessionId` 为目标会话。
 * 返回：浅复制状态和消息数组；不存在时返回 null。
 * 错误：无。
 * 状态：只读，不改变 LRU 顺序。
 * 并发与取消：调用方仍需用 generation 防止迟到写入。
 * 权限：只包含已清洗数据。
 * 关联：`CHG-2026-0013`。
 */
export function getConversationView(sessionId: string): ConversationViewState | null {
  const state = states.get(sessionId)
  if (!state) return null
  touchSession(sessionId)
  return { ...state, messages: [...state.messages] }
}

/**
 * 功能：合并 Gateway 真实消息，并保留当前 session 的独立运行态和本地 notice。
 * 参数：目标 session、远端消息和可选预期 generation。
 * 返回：无。
 * 错误：无；非法字段由白名单清洗丢弃。
 * 状态：更新正文读取状态为 ready。
 * 并发与取消：generation 不匹配时忽略；远端相同角色和正文会替代本地副本。
 * 权限：远端和本地消息都必须经过脱敏边界。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export function rememberConversationMessages(sessionId: string, messages: OfficeConversationMessage[], expectedGeneration?: number) {
  const current = states.get(sessionId) ?? createState(sessionId)
  const remote = sanitizeConversationMessages(messages)
  const envelopes = readLocalEnvelopes(sessionId)
  const persistedIds = new Set(envelopes.map((envelope) => envelope.message.info?.id).filter(Boolean))
  const boundaryIndex = current.boundaryMessageID
    ? remote.findIndex((message) => message.info?.id === current.boundaryMessageID)
    : -1
  const targetRemoteUser = current.activeUserMessageID
    ? remote.some((message) => message.info?.id === current.activeUserMessageID)
    : remote.slice(boundaryIndex + 1).some((message) => message.info?.role === 'user')
  // 已被 Host 接收的 optimistic user 只按稳定 userMessageID 或冻结边界后的首个远端
  // user 替换；本地失败 envelope 由 localTurnId 幂等，不按角色或正文去重。
  const retainedTransient = current.messages.filter((message) => {
    const id = String(message.info?.id || '')
    if (!id.startsWith('local-') || persistedIds.has(id)) return false
    return !(id === current.optimisticUserMessageID && targetRemoteUser)
  })
  updateConversationView(sessionId, {
    messages: mergeLocalEnvelopes([...remote, ...retainedTransient], envelopes),
    messagesState: 'ready',
  }, expectedGeneration)
}

/**
 * 功能：向指定 session 追加一条乐观或本地 system 消息。
 * 参数：目标 session、已构造消息和可选预期 generation。
 * 返回：无。
 * 错误：无；消息会统一清洗和裁剪。
 * 状态：消息编号已存在时保持幂等。
 * 并发与取消：generation 不匹配时不写入。
 * 权限：调用方不得传入 reasoning、工具输入输出或凭据。
 * 关联：`CHG-2026-0013`。
 */
export function appendConversationMessage(sessionId: string, message: OfficeConversationMessage, expectedGeneration?: number) {
  const current = states.get(sessionId) ?? createState(sessionId)
  const messages = current.messages.some((item) => item.info?.id === message.info?.id)
    ? current.messages
    : [...current.messages, message]
  updateConversationView(sessionId, { messages }, expectedGeneration)
}

/** 将 SSE 中逐步增长的 assistant 文本按稳定消息编号合并到当前会话。 */
export function upsertStreamedAssistantMessage(sessionId: string, message: OfficeConversationMessage, expectedGeneration?: number) {
  const streamed = sanitizeConversationMessages([message])[0]
  if (!streamed || streamed.info?.role !== 'assistant' || typeof streamed.info?.id !== 'string') return
  const current = states.get(sessionId) ?? createState(sessionId)
  if (expectedGeneration !== undefined && current.generation !== expectedGeneration) return
  const index = current.messages.findIndex((item) => item.info?.id === streamed.info?.id)
  const messages = [...current.messages]
  if (index >= 0) messages[index] = streamed
  else messages.push(streamed)
  updateConversationView(sessionId, { messages, messagesState: 'ready' }, expectedGeneration)
}

/**
 * 功能：追加浏览器侧可恢复的 system 提示，用于 Host 尚未接收请求或停止终态缺失的边界。
 * 参数：目标 session、提示类型和已脱敏中文正文。
 * 返回：无。
 * 错误：localStorage 不可用时降级为当前页面内存提示，不向调用方抛出。
 * 状态：写入当前会话缓存和有界 localStorage；不会写入 Host JSONL 或模型上下文。
 * 并发与取消：消息编号单调生成；远端出现相同终态正文后会在合并时去重。
 * 权限：正文必须是面向用户的脱敏信息，不得包含 Provider 原错或凭据。
 * 关联：`CHG-2026-0013`、`API-OFFICE-GATEWAY-001`。
 */
export function appendPersistentConversationNotice(sessionId: string, kind: 'error' | 'cancelled', text: string, expectedGeneration?: number) {
  const current = states.get(sessionId) ?? createState(sessionId)
  if (expectedGeneration !== undefined && current.generation !== expectedGeneration) return
  const now = Date.now()
  const message: OfficeConversationMessage = {
    info: {
      id: `local-notice-${sessionId}-${now}-${Math.random().toString(36).slice(2, 8)}`,
      sessionID: sessionId,
      role: 'system',
      kind,
      time: { created: now, completed: now },
    },
    parts: [{ type: 'text', text }],
  }
  const optimisticUser = current.messages.find((candidate) => candidate.info?.id === current.optimisticUserMessageID)
    ?? [...current.messages].reverse().find((candidate) => candidate.info?.role === 'user'
      && String(candidate.info?.id || '').startsWith('local-'))
  const existing = readLocalEnvelopes(sessionId)
  const localTurnId = String(optimisticUser?.info?.id || `local-turn-${sessionId}-${current.generation}-${now}`)
  const priorTurn = existing.find((envelope) => envelope.localTurnId === localTurnId)
  const localTurnOrdinal = priorTurn?.localTurnOrdinal
    ?? Math.max(0, ...existing.map((envelope) => envelope.localTurnOrdinal)) + 1
  const nextEnvelopes = [...existing]
  if (optimisticUser) {
    const persistedUser: OfficeConversationMessage = {
      ...sanitizeConversationMessages([optimisticUser])[0],
      info: {
        ...sanitizeConversationMessages([optimisticUser])[0].info,
        time: sanitizeConversationMessages([optimisticUser])[0].info?.time ?? { created: now },
      },
    }
    nextEnvelopes.push({
      version: 2,
      sessionId,
      localTurnId,
      localTurnOrdinal,
      messageKind: 'user',
      afterRemoteMessageId: current.boundaryMessageID,
      createdAt: messageCreatedAt(optimisticUser, now),
      ordinal: 0,
      message: persistedUser,
    })
  }
  nextEnvelopes.push({
    version: 2,
    sessionId,
    localTurnId,
    localTurnOrdinal,
    messageKind: kind,
    afterRemoteMessageId: current.boundaryMessageID,
    createdAt: now,
    ordinal: 1,
    message,
  })
  // 同一 envelope 重载保持幂等，不同 localTurnId 即使正文完全相同也分别保留。
  writeLocalEnvelopes(sessionId, nextEnvelopes)
  appendConversationMessage(sessionId, message, expectedGeneration)
}

/**
 * 功能：把浏览器 generation 与 Host 回合身份及本地消息锚点绑定。
 * 参数：目标 session、当前 generation 和可选的 turn/user/optimistic/boundary 编号。
 * 返回：generation 匹配且状态写入成功时为 true，否则为 false。
 * 错误：无；未知字段保持原值。
 * 状态：只更新当前 session 的回合身份，不改变正文或 pending。
 * 并发与取消：旧 generation 不能替换新回合身份。
 * 权限：编号均为不透明标识，不包含正文、工具参数或凭据。
 * 关联：`CHG-2026-0014`、`BLK-16`、`BLK-18`。
 */
export function bindConversationTurnIdentity(sessionId: string, identity: {
  generation: number
  turnID?: string | null
  userMessageID?: string | null
  optimisticUserMessageID?: string | null
  boundaryMessageID?: string | null
}) {
  const current = states.get(sessionId) ?? createState(sessionId)
  return updateConversationView(sessionId, {
    activeTurnID: identity.turnID === undefined ? current.activeTurnID : identity.turnID,
    activeUserMessageID: identity.userMessageID === undefined ? current.activeUserMessageID : identity.userMessageID,
    optimisticUserMessageID: identity.optimisticUserMessageID === undefined
      ? current.optimisticUserMessageID
      : identity.optimisticUserMessageID,
    boundaryMessageID: identity.boundaryMessageID === undefined ? current.boundaryMessageID : identity.boundaryMessageID,
  }, identity.generation)
}

/**
 * 功能：删除会话后清理其前端缓存并通知监听器。
 * 参数：`sessionId` 为已删除会话。
 * 返回：无。
 * 错误：无。
 * 状态：移除内存状态；不修改浏览器 notice 或远端 JSONL。
 * 并发与取消：调用方应先确认目标 session 没有活动回合。
 * 权限：不发起网络删除。
 * 关联：`CHG-2026-0013`。
 */
export function clearConversationView(sessionId: string) {
  states.delete(sessionId)
  lruOrdinals.delete(sessionId)
  notify(sessionId)
}

/**
 * 功能：清理全部前端会话状态，供测试隔离和本地登出使用。
 * 参数：无。
 * 返回：无。
 * 错误：localStorage 不可用时静默忽略。
 * 状态：清空内存状态、监听快照和浏览器本地 notice。
 * 并发与取消：不会终止控制器监视器；测试应同时调用控制器重置入口。
 * 权限：不触碰 Gateway、Host 或 OpenPaw 数据。
 * 关联：`CHG-2026-0013`。
 */
export function resetConversationViewStore() {
  const sessionIds = [...states.keys()]
  states.clear()
  lruOrdinals.clear()
  nextLruOrdinal = 0
  sessionIds.forEach(notify)
  try {
    window.localStorage.removeItem(LOCAL_NOTICE_STORAGE_KEY_V1)
    window.localStorage.removeItem(LOCAL_NOTICE_STORAGE_KEY_V2)
  } catch { /* 浏览器存储不可用时只清理内存。 */ }
}
