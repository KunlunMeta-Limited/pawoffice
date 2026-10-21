import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resetConversationEventStream,
  subscribeConversationEvents,
  type OfficeConversationStreamEvent,
} from '@/services/conversationEventStream'

describe('对话 SSE 客户端', () => {
  afterEach(() => {
    resetConversationEventStream()
    vi.unstubAllGlobals()
  })

  it('共享连接按 sessionID 隔离并行会话的文本增量', async () => {
    const encoder = new TextEncoder()
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller } })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, body })))
    const first: OfficeConversationStreamEvent[] = []
    const second: OfficeConversationStreamEvent[] = []
    const stopFirst = subscribeConversationEvents('s1', (event) => first.push(event))
    const stopSecond = subscribeConversationEvents('s2', (event) => second.push(event))

    const frame = (sessionID: string, delta: string) => `data: ${JSON.stringify({
      type: 'message.part.delta',
      properties: { partID: `p-${sessionID}`, messageID: `m-${sessionID}`, sessionID, field: 'text', delta },
    })}\n\n`
    streamController?.enqueue(encoder.encode(`${frame('s1', '甲')}${frame('s2', '乙')}`))

    await vi.waitFor(() => {
      expect(first.map((event) => event.properties.delta)).toEqual(['甲'])
      expect(second.map((event) => event.properties.delta)).toEqual(['乙'])
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    stopFirst()
    stopSecond()
  })
})
