import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  appendConversationMessage,
  appendPersistentConversationNotice,
  beginConversationTurn,
  clearConversationView,
  getConversationView,
  rememberConversationMessages,
  resetConversationViewStore,
  sanitizeConversationMessages,
  subscribeConversationView,
  updateConversationView,
} from '@/services/conversationViewStore'
import type { OfficeConversationMessage } from '@/types/officeData'

describe('对话视图缓存数据边界', () => {
  beforeEach(() => resetConversationViewStore())

  it('只缓存文本 part，并清洗时间字段中的未知数据', () => {
    const input = [{
      info: {
        id: 'message-1',
        sessionID: 'session-1',
        role: 'assistant',
        time: { created: 100, completed: 200, secret: 'drop' },
        unknown: 'drop',
      },
      parts: [
        { id: 'text-1', type: 'text', text: '保留正文', unknown: 'drop' },
        { id: 'tool-1', type: 'tool', tool: 'read_file', state: { input: { path: 'secret' }, output: 'large' } },
        { id: 'bad-text', type: 'text', text: { leaked: true } },
      ],
      unknown: 'drop',
    }] as unknown as OfficeConversationMessage[]

    expect(sanitizeConversationMessages(input)).toEqual([{
      info: { id: 'message-1', sessionID: 'session-1', role: 'assistant', time: { created: 100, completed: 200 } },
      parts: [{ id: 'text-1', type: 'text', text: '保留正文' }],
    }])
    expect(JSON.stringify(sanitizeConversationMessages(input))).not.toContain('secret')
  })

  it('remember 后读取缓存仍保持脱敏结果', () => {
    const input = [{
      info: { id: 'message-2', role: 'user', time: { created: 300, extra: { secret: 'drop' } } },
      parts: [{ type: 'tool', state: { output: 'large' } }, { type: 'text', text: '用户问题' }],
    }] as unknown as OfficeConversationMessage[]

    rememberConversationMessages('session-2', input)
    const cached = getConversationView('session-2')
    expect(cached).toMatchObject({
      messages: [{ info: { id: 'message-2', role: 'user', time: { created: 300 } }, parts: [{ type: 'text', text: '用户问题' }] }],
      pending: false,
      phase: 'idle',
      messagesState: 'ready',
      activeTool: null,
      generation: 0,
      updatedAt: expect.any(Number),
    })
    expect(JSON.stringify(cached)).not.toMatch(/input|output|secret|不要缓存/)
  })

  it('保留失败正文需要的 system kind 和 turnID，但仍丢弃未知字段', () => {
    const input = [{
      info: { id: 'turn-t1-failed', sessionID: 'session-3', role: 'system', kind: 'error', turnID: 't1', secret: 'drop' },
      parts: [{ type: 'text', text: '模型服务响应超时，本轮未完成，请稍后重试。', raw: 'drop' }],
    }] as unknown as OfficeConversationMessage[]

    expect(sanitizeConversationMessages(input)).toEqual([{
      info: { id: 'turn-t1-failed', sessionID: 'session-3', role: 'system', kind: 'error', turnID: 't1' },
      parts: [{ type: 'text', text: '模型服务响应超时，本轮未完成，请稍后重试。' }],
    }])
    expect(JSON.stringify(sanitizeConversationMessages(input))).not.toContain('secret')
  })

  it('完整保留超过字符预算的最新回合和紧随其后的终态标记', () => {
    const longReply = `回复:${'长'.repeat(180_000)}`
    rememberConversationMessages('long-reply', [
      {
        info: { id: 'old-user', sessionID: 'long-reply', role: 'user' },
        parts: [{ type: 'text', text: '应被淘汰的旧问题' }],
      },
      {
        info: { id: 'old-assistant', sessionID: 'long-reply', role: 'assistant' },
        parts: [{ type: 'text', text: '应被淘汰的旧回答' }],
      },
      {
        info: { id: 'latest-user', sessionID: 'long-reply', role: 'user' },
        parts: [{ type: 'text', text: '最新问题' }],
      },
      {
        info: { id: 'latest-assistant', sessionID: 'long-reply', role: 'assistant' },
        parts: [{ type: 'text', text: longReply }],
      },
      {
        info: { id: 'turn-latest-completed', sessionID: 'long-reply', role: 'system', turnID: 'latest' },
        parts: [],
      },
    ] as OfficeConversationMessage[])

    const messages = getConversationView('long-reply')?.messages ?? []
    expect(messages.map((message) => message.info?.id)).toEqual([
      'latest-user',
      'latest-assistant',
      'turn-latest-completed',
    ])
    expect(messages[1]?.parts[0]?.text).toBe(longReply)
  })

  it('按 session 和 generation 隔离运行态，并拒绝迟到结果', () => {
    const changes: string[] = []
    const unsubscribeA = subscribeConversationView('a', () => changes.push('a'))
    const unsubscribeB = subscribeConversationView('b', () => changes.push('b'))
    const generationA = beginConversationTurn('a')
    const generationB = beginConversationTurn('b')

    updateConversationView('a', { activeTool: 'web_search', activityTask: '搜索失败，正在调整' }, generationA)
    updateConversationView('b', { activeTool: 'read_file', activityTask: '读取：项目资料' }, generationB)
    expect(updateConversationView('a', { phase: 'error', error: '旧请求' }, generationA - 1)).toBe(false)

    expect(getConversationView('a')).toMatchObject({ pending: true, phase: 'loading', activeTool: 'web_search', activityTask: '搜索失败，正在调整', error: null })
    expect(getConversationView('b')).toMatchObject({ pending: true, phase: 'loading', activeTool: 'read_file', activityTask: '读取：项目资料', error: null })
    expect(changes).toEqual(['a', 'b', 'a', 'b'])
    unsubscribeA()
    unsubscribeB()
  })

  it('刷新后保留 v2 失败包络，且不按相同正文误删远端新回合', async () => {
    const sessionId = 'refresh-error-session'
    const userText = '包含中文、emoji 😀 与换行\n的请求'
    const generation = beginConversationTurn(sessionId)
    appendConversationMessage(sessionId, {
      info: { id: 'local-refresh-user', sessionID: sessionId, role: 'user' },
      parts: [{ type: 'text', text: userText }],
    }, generation)
    appendPersistentConversationNotice(sessionId, 'error', '消息未进入执行：模型服务暂时不可用（503）', generation)

    const persisted = JSON.parse(window.localStorage.getItem('ai-office.conversation-notices.v2') || '{}')
    expect(persisted[sessionId].map(({ version, messageKind }: { version: number; messageKind: string }) => [version, messageKind])).toEqual([
      [2, 'user'],
      [2, 'error'],
    ])

    clearConversationView(sessionId)
    updateConversationView(sessionId, {})
    expect(getConversationView(sessionId)?.messages.map((message) => message.parts[0]?.text)).toEqual([
      userText,
      '消息未进入执行：模型服务暂时不可用（503）',
    ])

    vi.resetModules()
    const refreshedStore = await import('@/services/conversationViewStore')
    refreshedStore.updateConversationView(sessionId, { messagesState: 'loading' })
    expect(refreshedStore.getConversationView(sessionId)?.messages.map((message) => message.parts[0]?.text)).toEqual([
      userText,
      '消息未进入执行：模型服务暂时不可用（503）',
    ])
    refreshedStore.rememberConversationMessages(sessionId, [{
      info: { id: 'host-user', sessionID: sessionId, role: 'user' },
      parts: [{ type: 'text', text: userText }],
    }])

    const messages = refreshedStore.getConversationView(sessionId)?.messages ?? []
    expect(messages.filter((message) => message.info?.role === 'user')).toHaveLength(2)
    expect(messages.some((message) => message.info?.role === 'system')).toBe(true)
  })
})
