import { officeGatewayApi } from '@/services/officeGatewayApi'

export type OfficeConversationStreamEvent = {
  type: string
  properties: Record<string, unknown>
}

type StreamListener = (event: OfficeConversationStreamEvent) => void

const listeners = new Map<string, Set<StreamListener>>()
let connectionController: AbortController | null = null
let connectionTask: Promise<void> | null = null
let connected = false

function eventSessionId(event: OfficeConversationStreamEvent) {
  const properties = event.properties
  if (typeof properties.sessionID === 'string') return properties.sessionID
  const info = properties.info
  if (info && typeof info === 'object' && !Array.isArray(info) && typeof (info as Record<string, unknown>).sessionID === 'string') {
    return (info as Record<string, unknown>).sessionID as string
  }
  const part = properties.part
  if (part && typeof part === 'object' && !Array.isArray(part) && typeof (part as Record<string, unknown>).sessionID === 'string') {
    return (part as Record<string, unknown>).sessionID as string
  }
  return null
}

function dispatch(event: OfficeConversationStreamEvent) {
  const sessionId = eventSessionId(event)
  if (!sessionId) {
    if (event.type === 'stream.gap') listeners.forEach((sessionListeners) => sessionListeners.forEach((listener) => listener(event)))
    return
  }
  listeners.get(sessionId)?.forEach((listener) => listener(event))
}

function createParser(onEvent: (event: OfficeConversationStreamEvent) => void) {
  let buffer = ''
  return (chunk: string, flush = false) => {
    buffer = `${buffer}${chunk}`.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = frame.split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) {
        try {
          const parsed = JSON.parse(data)
          if (parsed && typeof parsed.type === 'string' && parsed.properties && typeof parsed.properties === 'object' && !Array.isArray(parsed.properties)) {
            onEvent(parsed as OfficeConversationStreamEvent)
          }
        } catch {
          // 损坏或未知的单帧事件由 REST 对账恢复，不能中断整条事件流。
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
    if (flush) buffer = ''
  }
}

function hasListeners() {
  return [...listeners.values()].some((items) => items.size > 0)
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

async function runConnection() {
  while (hasListeners()) {
    const controller = new AbortController()
    connectionController = controller
    try {
      const response = await fetch(officeGatewayApi.conversationEventsUrl(), {
        cache: 'no-store',
        headers: { Accept: 'text/event-stream' },
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error(`事件流连接失败（${response.status}）`)
      connected = true
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parse = createParser(dispatch)
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        parse(decoder.decode(value, { stream: true }))
      }
      parse(decoder.decode(), true)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        // REST monitor remains authoritative while the local SSE link reconnects.
      }
    } finally {
      connected = false
      if (connectionController === controller) connectionController = null
    }
    if (hasListeners()) await wait(500)
  }
}

function ensureConnection() {
  if (connectionTask) return
  const task = runConnection().finally(() => {
    if (connectionTask === task) connectionTask = null
  })
  connectionTask = task
}

/** 订阅指定会话的白名单文本事件；不同会话共享一个 Gateway SSE 连接。 */
export function subscribeConversationEvents(sessionId: string, listener: StreamListener) {
  const sessionListeners = listeners.get(sessionId) ?? new Set<StreamListener>()
  sessionListeners.add(listener)
  listeners.set(sessionId, sessionListeners)
  ensureConnection()
  return () => {
    sessionListeners.delete(listener)
    if (sessionListeners.size === 0) listeners.delete(sessionId)
    if (!hasListeners()) connectionController?.abort()
  }
}

export function isConversationEventStreamConnected() {
  return connected
}

/** 测试隔离入口；只关闭浏览器事件连接，不改变远端回合。 */
export function resetConversationEventStream() {
  listeners.clear()
  connectionController?.abort()
  connectionController = null
  connectionTask = null
  connected = false
}
