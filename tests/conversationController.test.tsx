import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OfficeRightPanel } from '@/components/OfficeDashboardChrome'
import { resetConversationSessionCache } from '@/services/conversationSessionCache'
import { getConversationView, resetConversationViewStore } from '@/services/conversationViewStore'
import { resetConversationControllers, restoreActiveConversations, sendConversationTurn } from '@/services/useConversationController'
import type { OfficeConversationMessage } from '@/types/officeData'

type SessionFixture = {
  active: boolean
  tool?: string
  task?: string
  messages: OfficeConversationMessage[]
}

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })
}

describe('多会话并行控制器', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    resetConversationControllers()
    resetConversationSessionCache()
    resetConversationViewStore()
  })

  it('A 运行时可切换并发送 B，逆序完成不会串写正文或状态', async () => {
    const sessions = [
      { id: 'a', title: '对话 A', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 2 },
      { id: 'b', title: '对话 B', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
    ]
    const fixtures = new Map<string, SessionFixture>([
      ['a', { active: false, messages: [] }],
      ['b', { active: false, messages: [] }],
    ])
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return json(sessions)
      if (url.pathname === '/office/permissions') return json([])
      const match = url.pathname.match(/^\/office\/conversations\/([^/]+)\/(messages|status|abort)$/)
      if (match) {
        const [, sessionId, action] = match
        const fixture = fixtures.get(sessionId)!
        if (action === 'status') return json(fixture.active ? { [sessionId]: { type: 'busy', activity: { kind: fixture.tool ? 'tool' : 'thinking', tool: fixture.tool, task: fixture.task } } } : {})
        if (action === 'abort') { fixture.active = false; return json(null, 204) }
        if (init?.method === 'POST') { fixture.active = true; return json({ accepted: true, sessionId }, 202) }
        return json(fixture.messages)
      }
      return json([])
    })
    vi.stubGlobal('fetch', request)

    render(<OfficeRightPanel active="对话中心" />)
    const sessionSelect = await screen.findByRole('combobox', { name: '最近对话' })
    await waitFor(() => expect(sessionSelect).toHaveValue('a'))

    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: 'A 的问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('A 的问题')).toBeInTheDocument())
    expect(sessionSelect).toBeEnabled()

    fireEvent.change(sessionSelect, { target: { value: 'b' } })
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeEnabled())
    expect(screen.queryByText('A 的问题')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: 'B 的问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('B 的问题')).toBeInTheDocument())

    fixtures.set('b', {
      active: false,
      messages: [
        { info: { id: 'b-user', role: 'user' }, parts: [{ type: 'text', text: 'B 的问题' }] },
        { info: { id: 'b-assistant', role: 'assistant' }, parts: [{ type: 'text', text: 'B 先完成' }] },
      ],
    })
    await waitFor(() => expect(screen.getByText('B 先完成')).toBeInTheDocument(), { timeout: 4000 })
    expect(screen.queryByText('A 的问题')).not.toBeInTheDocument()

    fixtures.set('a', {
      active: false,
      messages: [
        { info: { id: 'a-user', role: 'user' }, parts: [{ type: 'text', text: 'A 的问题' }] },
        { info: { id: 'a-assistant', role: 'assistant' }, parts: [{ type: 'text', text: 'A 后完成' }] },
      ],
    })
    await new Promise((resolve) => window.setTimeout(resolve, 700))
    expect(screen.getByText('B 先完成')).toBeInTheDocument()
    expect(screen.queryByText('A 后完成')).not.toBeInTheDocument()

    fireEvent.change(sessionSelect, { target: { value: 'a' } })
    await waitFor(() => expect(screen.getByText('A 后完成')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByText('B 先完成')).not.toBeInTheDocument()
    expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()
  }, 15_000)

  it('搜索失败后会继续刷新后续活动并正常完成', async () => {
    const fixture: SessionFixture = { active: false, tool: 'web_search', task: '搜索失败，正在调整', messages: [] }
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return json([{ id: 'search-recovery', title: '搜索恢复', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }])
      if (url.pathname === '/office/permissions') return json([])
      if (url.pathname === '/office/conversations/search-recovery/status') {
        return json(fixture.active ? { 'search-recovery': { type: 'busy', activity: { kind: 'tool', tool: fixture.tool, task: fixture.task } } } : {})
      }
      if (url.pathname === '/office/conversations/search-recovery/messages' && init?.method === 'POST') {
        fixture.active = true
        return json({ accepted: true, sessionId: 'search-recovery' }, 202)
      }
      if (url.pathname === '/office/conversations/search-recovery/messages') return json(fixture.messages)
      return json([])
    })
    vi.stubGlobal('fetch', request)

    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '继续搜索并整理' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getAllByText(/搜索失败，正在调整/)).toHaveLength(2))
    fixture.task = '搜索：恢复后的主题'
    await waitFor(() => expect(screen.getAllByText(/搜索：恢复后的主题/)).toHaveLength(2))
    expect(screen.queryByText(/搜索失败，正在调整/)).not.toBeInTheDocument()

    fixture.task = '正在整理搜索结果'
    await waitFor(() => expect(screen.getAllByText(/正在整理搜索结果/)).toHaveLength(2))
    fixture.active = false
    fixture.messages = [
      { info: { id: 'search-user', role: 'user' }, parts: [{ type: 'text', text: '继续搜索并整理' }] },
      { info: { id: 'search-assistant', role: 'assistant' }, parts: [{ type: 'text', text: '搜索恢复后已完成整理' }] },
    ]
    await waitFor(() => expect(screen.getByText('搜索恢复后已完成整理')).toBeInTheDocument(), { timeout: 3_000 })
  }, 10_000)

  it('A 运行时创建并选择 C 后仍可后台完成，停止 C 也不会停止 A', async () => {
    const fixtures = new Map<string, SessionFixture>([
      ['a', { active: false, messages: [] }],
      ['c', { active: false, messages: [] }],
    ])
    const aborted: string[] = []
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return json([{ id: 'a', title: '对话 A', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }])
      if (url.pathname === '/office/permissions') return json([])
      if (url.pathname === '/office/conversations' && init?.method === 'POST') return json({ promptAccepted: false, session: { id: 'c', title: '对话 C', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 } }, 201)
      const match = url.pathname.match(/^\/office\/conversations\/([^/]+)\/(messages|status|abort)$/)
      if (match) {
        const [, sessionId, action] = match
        const fixture = fixtures.get(sessionId)!
        if (action === 'status') return json(fixture.active ? { [sessionId]: { type: 'busy' } } : {})
        if (action === 'abort') {
          aborted.push(sessionId)
          fixture.active = false
          fixture.messages = [
            { info: { id: 'c-user', role: 'user' }, parts: [{ type: 'text', text: 'C 的问题' }] },
            { info: { id: 'c-cancelled', role: 'system', kind: 'cancelled' }, parts: [{ type: 'text', text: '本轮已停止。' }] },
          ]
          return json(null, 204)
        }
        if (init?.method === 'POST') { fixture.active = true; return json({ accepted: true, sessionId }, 202) }
        return json(fixture.messages)
      }
      return json([])
    })
    vi.stubGlobal('fetch', request)

    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: 'A 持续运行' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('A 持续运行')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '+ 新建对话' }))
    fireEvent.change(screen.getByLabelText('对话名称'), { target: { value: '对话 C' } })
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    const sessionSelect = screen.getByRole('combobox', { name: '最近对话' })
    await waitFor(() => expect(sessionSelect).toHaveValue('c'))
    expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()
    expect(screen.queryByText('对话已创建，可开始发送消息')).not.toBeInTheDocument()

    fixtures.set('a', {
      active: false,
      messages: [
        { info: { id: 'a-user', role: 'user' }, parts: [{ type: 'text', text: 'A 持续运行' }] },
        { info: { id: 'a-assistant', role: 'assistant' }, parts: [{ type: 'text', text: 'A 后台完成' }] },
      ],
    })
    expect(sessionSelect).toHaveValue('c')
    expect(screen.queryByText('A 后台完成')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: 'C 的问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(screen.getByLabelText('输入下一条消息')).toBeDisabled()
    await waitFor(() => expect(screen.getByText('本轮已停止。')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeEnabled())
    expect(aborted).toEqual(['c'])

    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: 'C 停止后继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('C 停止后继续')).toBeInTheDocument())

    fireEvent.change(sessionSelect, { target: { value: 'a' } })
    await waitFor(() => expect(screen.getByText('A 后台完成')).toBeInTheDocument())
    expect(screen.getByText('A 持续运行')).toBeInTheDocument()
    expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()
  }, 15_000)

  it('失败终态作为 system 正文保留，切换后可恢复且下一轮仍可发送', async () => {
    const sessions = [
      { id: 'a', title: '失败后恢复', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 2 },
      { id: 'b', title: '其它对话', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
    ]
    let running = false
    let failed = false
    let sends = 0
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return json(sessions)
      if (url.pathname === '/office/permissions') return json([])
      if (url.pathname === '/office/conversations/a/status') return json(running ? { a: { type: 'busy' } } : {})
      if (url.pathname === '/office/conversations/b/status') return json({})
      if (url.pathname === '/office/conversations/a/messages' && init?.method === 'POST') {
        sends += 1
        running = true
        window.setTimeout(() => { running = false; failed = true }, 80)
        return json({ accepted: true, sessionId: 'a' }, 202)
      }
      if (url.pathname === '/office/conversations/a/messages') return json(failed ? [
        { info: { id: 'u-a', sessionID: 'a', role: 'user' }, parts: [{ type: 'text', text: '触发失败' }] },
        { info: { id: 'turn-a-failed', sessionID: 'a', role: 'system', kind: 'error', turnID: 'turn-a' }, parts: [{ type: 'text', text: '模型服务响应超时，本轮未完成，请稍后重试。' }] },
      ] : [])
      if (url.pathname === '/office/conversations/b/messages') return json([])
      return json([])
    })
    vi.stubGlobal('fetch', request)

    render(<OfficeRightPanel active="对话中心" />)
    const sessionSelect = await screen.findByRole('combobox', { name: '最近对话' })
    await waitFor(() => expect(sessionSelect).toHaveValue('a'))
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '触发失败' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('模型服务响应超时，本轮未完成，请稍后重试。')).toBeInTheDocument(), { timeout: 4000 })
    expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()
    expect(screen.queryByText('本轮未收到智能体回复，可能是模型服务暂时不可用，请稍后重试')).not.toBeInTheDocument()

    fireEvent.change(sessionSelect, { target: { value: 'b' } })
    expect(screen.queryByText('模型服务响应超时，本轮未完成，请稍后重试。')).not.toBeInTheDocument()
    fireEvent.change(sessionSelect, { target: { value: 'a' } })
    expect(screen.getByText('模型服务响应超时，本轮未完成，请稍后重试。')).toBeInTheDocument()

    failed = false
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '第二轮仍可发送' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(sends).toBe(2))
  }, 15_000)

  it('Gateway 内部超时后会协调 Host 状态并解除 pending，不永久锁住输入', async () => {
    // 把内部 12 秒超时压缩为 5 毫秒，并让逻辑时钟每次前进 1 秒，覆盖 3 秒
    // idle 对账路径而不把单元测试真实等待时间拉长。
    const nativeSetTimeout = window.setTimeout.bind(window)
    const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
      nativeSetTimeout(handler, timeout === 12_000 ? 5 : timeout, ...args)
    )) as typeof window.setTimeout)
    let clock = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      clock += 1_000
      return clock
    })
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return json([{ id: 'timeout', title: '超时恢复', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }])
      if (url.pathname === '/office/permissions') return json([])
      if (url.pathname === '/office/conversations/timeout/status') return json({})
      if (url.pathname === '/office/conversations/timeout/messages' && init?.method === 'POST') {
        // 故意保持半开，只有 AbortSignal 触发时拒绝，用于模拟 Gateway 接收确认超时。
        return new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('请求已取消', 'AbortError')), { once: true })
        })
      }
      if (url.pathname === '/office/conversations/timeout/messages') return json([])
      return json([])
    })
    vi.stubGlobal('fetch', request)

    try {
      render(<OfficeRightPanel active="对话中心" />)
      await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeEnabled())
      fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '确认超时后恢复' } })
      fireEvent.click(screen.getByRole('button', { name: '发送' }))

      await waitFor(() => expect(screen.getByText('发送确认超时，Host 未报告活动回合；本次消息可能未进入执行，请重新发送。')).toBeInTheDocument(), { timeout: 5_000 })
      expect(screen.getByText('确认超时后恢复')).toBeInTheDocument()
      expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()
      expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
    } finally {
      timeoutSpy.mockRestore()
      nowSpy.mockRestore()
    }
  }, 10_000)

  it('发送确认丢失时复用 generation 的同一 requestID 且只生成一次逻辑提交', async () => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    const timeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number, ...args: unknown[]) => (
      nativeSetTimeout(handler, timeout === 12_000 ? 5 : timeout, ...args)
    )) as typeof window.setTimeout)
    const requestIds: string[] = []
    let postAttempts = 0
    let statusReads = 0
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/retry/messages' && init?.method === 'POST') {
        postAttempts += 1
        const requestID = JSON.parse(String(init.body)).requestID
        requestIds.push(requestID)
        if (postAttempts === 1) {
          return new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('请求已取消', 'AbortError')), { once: true })
          })
        }
        return json({ accepted: true, sessionId: 'retry' }, 202)
      }
      if (url.pathname === '/office/conversations/status') {
        statusReads += 1
        return json(statusReads === 1 ? { retry: { type: 'busy', turnID: 'turn-retry', userMessageID: 'user-retry' } } : {})
      }
      if (url.pathname === '/office/conversations/retry/messages') return json([
        { info: { id: 'user-retry', role: 'user' }, parts: [{ type: 'text', text: '只执行一次' }] },
        { info: { id: 'assistant-retry', role: 'assistant', turnID: 'turn-retry' }, parts: [{ type: 'text', text: '幂等回复' }] },
      ])
      return json([])
    })
    vi.stubGlobal('fetch', request)

    try {
      await sendConversationTurn('retry', '只执行一次')
      expect(postAttempts).toBe(2)
      expect(new Set(requestIds).size).toBe(1)
      expect(requestIds[0]).toMatch(/^office-\d+-[\x20-\x7e]+$/)
      expect(getConversationView('retry')).toMatchObject({ pending: false, phase: 'ready' })
    } finally {
      timeoutSpy.mockRestore()
    }
  }, 10_000)

  it('批量恢复只加载活动会话，50 个空闲摘要不会形成正文 N+1', async () => {
    const active = {
      a: { type: 'busy', turnID: 'turn-a', userMessageID: 'user-a' },
      b: { type: 'queued', turnID: 'turn-b', userMessageID: 'user-b', queuePosition: 2 },
    }
    const requestedMessages: string[] = []
    let batchStatusReads = 0
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/status') { batchStatusReads += 1; return json(active) }
      const match = url.pathname.match(/^\/office\/conversations\/([^/]+)\/messages$/)
      if (match) {
        const sessionId = match[1]
        requestedMessages.push(sessionId)
        return json([
          { info: { id: `user-${sessionId}`, role: 'user' }, parts: [{ type: 'text', text: `问题 ${sessionId}` }] },
          { info: { id: `terminal-${sessionId}`, role: 'system', kind: 'completed', turnID: `turn-${sessionId}` }, parts: [] },
        ])
      }
      if (url.pathname === '/office/sessions') throw new Error('新版批量恢复不应读取全部会话摘要')
      return json([])
    })
    vi.stubGlobal('fetch', request)

    await restoreActiveConversations(Array.from({ length: 50 }, (_, index) => index < 2 ? ['a', 'b'][index] : `idle-${index}`))
    await waitFor(() => expect(getConversationView('a')?.pending).toBe(false))
    await waitFor(() => expect(getConversationView('b')?.pending).toBe(false))
    expect(batchStatusReads).toBeLessThanOrEqual(2)
    expect(new Set(requestedMessages)).toEqual(new Set(['a', 'b']))
    expect(requestedMessages.some((sessionId) => sessionId.startsWith('idle-'))).toBe(false)
  })

  it('轮询延时正常完成后会移除 abort listener', async () => {
    const listeners = new Set<EventListenerOrEventListenerObject>()
    const nativeAdd = AbortSignal.prototype.addEventListener
    const nativeRemove = AbortSignal.prototype.removeEventListener
    const addSpy = vi.spyOn(AbortSignal.prototype, 'addEventListener').mockImplementation(function (type, listener, options) {
      if (type === 'abort') listeners.add(listener)
      return nativeAdd.call(this, type, listener, options)
    })
    const removeSpy = vi.spyOn(AbortSignal.prototype, 'removeEventListener').mockImplementation(function (type, listener, options) {
      if (type === 'abort') listeners.delete(listener)
      return nativeRemove.call(this, type, listener, options)
    })
    let statusReads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/listener/messages' && init?.method === 'POST') return json({ accepted: true, sessionId: 'listener' }, 202)
      if (url.pathname === '/office/conversations/status') {
        statusReads += 1
        return json(statusReads === 1 ? { listener: { type: 'busy', turnID: 'turn-listener', userMessageID: 'user-listener' } } : {})
      }
      if (url.pathname === '/office/conversations/listener/messages') return json([
        { info: { id: 'user-listener', role: 'user' }, parts: [{ type: 'text', text: '监听器清理' }] },
        { info: { id: 'assistant-listener', role: 'assistant', turnID: 'turn-listener' }, parts: [{ type: 'text', text: '已完成' }] },
      ])
      return json([])
    }))

    try {
      await sendConversationTurn('listener', '监听器清理')
      expect(statusReads).toBeGreaterThanOrEqual(2)
      expect(listeners.size).toBe(0)
    } finally {
      addSpy.mockRestore()
      removeSpy.mockRestore()
    }
  })

  it('queued 会显示队列位置，并可晋升 busy 后完成和解除输入锁', async () => {
    let started = false
    let turnState: 'queued' | 'busy' | 'completed' = 'queued'
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return json([{ id: 'queued', title: '排队会话', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }])
      if (url.pathname === '/office/permissions') return json([])
      if (url.pathname === '/office/conversations/queued/messages' && init?.method === 'POST') {
        started = true
        return json({ accepted: true, sessionId: 'queued' }, 202)
      }
      if (url.pathname === '/office/conversations/queued/status') {
        if (!started || turnState === 'completed') return json({})
        if (turnState === 'queued') return json({ queued: { type: 'queued', turnID: 'turn-q', queuePosition: 3 } })
        return json({ queued: { type: 'busy', turnID: 'turn-q', activity: { kind: 'thinking' } } })
      }
      if (url.pathname === '/office/conversations/queued/messages') return json(turnState === 'completed' ? [
        { info: { id: 'queued-user', role: 'user' }, parts: [{ type: 'text', text: '排队任务' }] },
        { info: { id: 'queued-assistant', role: 'assistant' }, parts: [{ type: 'text', text: '排队任务已完成' }] },
      ] : [])
      return json([])
    })
    vi.stubGlobal('fetch', request)

    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '排队任务' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getByText(/正在排队（前方 2 项）/)).toBeInTheDocument())
    expect(screen.getByText('本轮正在排队…')).toBeInTheDocument()
    expect(screen.getByText('等待可用运行槽位，可继续切换其它对话')).toBeInTheDocument()
    expect(screen.getByLabelText('输入下一条消息')).toBeDisabled()

    turnState = 'busy'
    await waitFor(() => expect(screen.getByText(/^正在思考/)).toBeInTheDocument(), { timeout: 3_000 })
    expect(screen.queryByText(/正在排队（前方 2 项）/)).not.toBeInTheDocument()

    turnState = 'completed'
    await waitFor(() => expect(screen.getByText('排队任务已完成')).toBeInTheDocument(), { timeout: 3_000 })
    expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()
    expect(screen.queryByText('本轮正在排队…')).not.toBeInTheDocument()
  }, 10_000)

  it.each([
    [400, '请求内容不合法'],
    [409, '回合正在处理中'],
    [429, '并发队列已满'],
    [503, '模型服务暂时不可用'],
  ])('%i 发送拒绝会生成本地 system 错误，切换会话后仍可见', async (status, detail) => {
    const sessions = [
      { id: 'error', title: '错误会话', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
      { id: 'other', title: '其它会话', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
    ]
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return json(sessions)
      if (url.pathname === '/office/permissions') return json([])
      if (url.pathname === '/office/conversations/error/messages' && init?.method === 'POST') return json({ error: `${detail}（${status}）` }, status)
      if (/^\/office\/conversations\/(error|other)\/status$/.test(url.pathname)) return json({})
      if (/^\/office\/conversations\/(error|other)\/messages$/.test(url.pathname)) return json([])
      return json([])
    })
    vi.stubGlobal('fetch', request)

    render(<OfficeRightPanel active="对话中心" />)
    const sessionSelect = await screen.findByRole('combobox', { name: '最近对话' })
    await waitFor(() => expect(sessionSelect).toHaveValue('error'))
    const userText = `触发 ${status}`
    const errorText = `消息未进入执行：${detail}（${status}）`
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: userText } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getByText(errorText)).toBeInTheDocument())
    expect(screen.getByText(userText)).toBeInTheDocument()
    expect(screen.getByText(errorText).closest('article')).toHaveClass('system', 'error')
    expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()

    fireEvent.change(sessionSelect, { target: { value: 'other' } })
    expect(screen.queryByText(errorText)).not.toBeInTheDocument()
    fireEvent.change(sessionSelect, { target: { value: 'error' } })
    expect(screen.getByText(errorText)).toBeInTheDocument()
    expect(screen.getByText(userText)).toBeInTheDocument()
  })

  it('成功确认后立即采用 turnID，并忽略其它回合的终态', async () => {
    let messageReads = 0
    let statusReads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/identity/messages' && init?.method === 'POST') {
        return json({ accepted: true, sessionId: 'identity', turnID: 'turn-current' }, 202)
      }
      if (url.pathname === '/office/conversations/status') {
        statusReads += 1
        return json(statusReads === 1 ? { identity: { type: 'busy' } } : {})
      }
      if (url.pathname === '/office/conversations/identity/messages') {
        messageReads += 1
        if (messageReads === 1) return json([
          { info: { id: 'old-terminal', role: 'system', kind: 'error', turnID: 'turn-old' }, parts: [{ type: 'text', text: '旧回合失败' }] },
        ])
        return json([
          { info: { id: 'current-user', role: 'user' }, parts: [{ type: 'text', text: '当前问题' }] },
          { info: { id: 'current-terminal', role: 'system', kind: 'completed', turnID: 'turn-current' }, parts: [] },
        ])
      }
      return json([])
    }))

    await sendConversationTurn('identity', '当前问题')
    expect(messageReads).toBeGreaterThanOrEqual(2)
    expect(getConversationView('identity')).toMatchObject({ pending: false, phase: 'ready' })
  })

  it('completed 标记出现后先完成最终 REST 对账再关闭回合', async () => {
    let statusReads = 0
    let messageReads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/final-reconcile/messages' && init?.method === 'POST') {
        return json({ accepted: true, sessionId: 'final-reconcile', turnID: 'turn-final', userMessageID: 'user-final' }, 202)
      }
      if (url.pathname === '/office/conversations/status') {
        statusReads += 1
        return json(statusReads === 1 ? { 'final-reconcile': { type: 'busy', turnID: 'turn-final', userMessageID: 'user-final' } } : {})
      }
      if (url.pathname === '/office/conversations/final-reconcile/messages') {
        messageReads += 1
        if (messageReads === 1) return json([
          { info: { id: 'user-final', role: 'user' }, parts: [{ type: 'text', text: '生成产物' }] },
          { info: { id: 'process-final', role: 'assistant' }, parts: [{ type: 'text', text: '正在整理' }] },
          { info: { id: 'terminal-final', role: 'system', kind: 'completed', turnID: 'turn-final' }, parts: [] },
        ])
        return json([
          { info: { id: 'user-final', role: 'user' }, parts: [{ type: 'text', text: '生成产物' }] },
          { info: { id: 'process-final', role: 'assistant' }, parts: [{ type: 'text', text: '正在整理' }] },
          { info: { id: 'answer-final', role: 'assistant' }, parts: [{ type: 'text', text: '结论：完成。生成文件：output.js' }] },
          { info: { id: 'terminal-final', role: 'system', kind: 'completed', turnID: 'turn-final' }, parts: [] },
        ])
      }
      return json([])
    }))

    await sendConversationTurn('final-reconcile', '生成产物')

    expect(messageReads).toBeGreaterThanOrEqual(2)
    expect(getConversationView('final-reconcile')).toMatchObject({ pending: false, phase: 'ready' })
    expect(getConversationView('final-reconcile')?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ info: expect.objectContaining({ id: 'answer-final' }) }),
    ]))
  })

  it('只接管 active_turn，idempotency_conflict 必须作为发送失败保留', async () => {
    let statusReads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/conflict/messages' && init?.method === 'POST') {
        return json({ error: 'requestID 已用于不同消息', code: 'idempotency_conflict', retryable: false }, 409)
      }
      if (url.pathname === '/office/conversations/status') {
        statusReads += 1
        return json({ conflict: { type: 'busy', turnID: 'unrelated-turn' } })
      }
      if (url.pathname === '/office/conversations/conflict/messages') return json([])
      return json([])
    }))

    await expect(sendConversationTurn('conflict', '不能接管')).rejects.toMatchObject({
      status: 409,
      code: 'idempotency_conflict',
      retryable: false,
    })
    expect(statusReads).toBe(0)
    expect(getConversationView('conflict')).toMatchObject({ pending: false, phase: 'error' })
    expect(getConversationView('conflict')?.messages.some((message) => (
      message.info?.kind === 'error'
      && message.parts?.[0]?.text === '消息未进入执行：requestID 已用于不同消息'
    ))).toBe(true)
  })

  it('active_turn 409 会接管 Host 活动回合并继续监视', async () => {
    let statusReads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/active/messages' && init?.method === 'POST') {
        return json({ error: '已有活动回合', code: 'active_turn', retryable: true }, 409)
      }
      if (url.pathname === '/office/conversations/status') {
        statusReads += 1
        return json(statusReads <= 2 ? { active: { type: 'busy', turnID: 'turn-active', userMessageID: 'user-active' } } : {})
      }
      if (url.pathname === '/office/conversations/active/messages') return json([
        { info: { id: 'user-active', role: 'user' }, parts: [{ type: 'text', text: '已有问题' }] },
        { info: { id: 'done-active', role: 'system', kind: 'completed', turnID: 'turn-active' }, parts: [] },
      ])
      return json([])
    }))

    await sendConversationTurn('active', '重复确认')
    expect(statusReads).toBeGreaterThan(0)
    expect(getConversationView('active')).toMatchObject({ pending: false, phase: 'ready' })
  })

  it('无 code 的 409 且状态缺少回合身份时作为失败保留，不接管无关回合', async () => {
    let statusReads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/ambiguous/messages' && init?.method === 'POST') {
        return json({ error: '回合正在处理中' }, 409)
      }
      if (url.pathname === '/office/conversations/status') {
        statusReads += 1
        return json({ ambiguous: { type: 'busy' } })
      }
      if (url.pathname === '/office/conversations/ambiguous/messages') return json([])
      return json([])
    }))

    await expect(sendConversationTurn('ambiguous', '不能绑定未知回合')).rejects.toMatchObject({ status: 409 })
    expect(statusReads).toBeGreaterThan(0)
    expect(getConversationView('ambiguous')).toMatchObject({ pending: false, phase: 'error' })
    expect(getConversationView('ambiguous')?.messages.some((message) => (
      message.info?.kind === 'error'
      && message.parts?.[0]?.text === '消息未进入执行：回合正在处理中'
    ))).toBe(true)
  })

  it('abort 返回 204 但取消正文缺失时会追加本地兜底并解除输入锁', async () => {
    // 消息接口故意不返回 cancelled marker，验证 abort 204 后 3 秒 idle 对账会追加
    // 本地取消正文，而不是让 session 永久 pending。
    let started = false
    let aborted = false
    let clock = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      clock += 1_000
      return clock
    })
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return json([{ id: 'abort', title: '停止兜底', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }])
      if (url.pathname === '/office/permissions') return json([])
      if (url.pathname === '/office/conversations/abort/messages' && init?.method === 'POST') {
        started = true
        return json({ accepted: true, sessionId: 'abort' }, 202)
      }
      if (url.pathname === '/office/conversations/abort/abort' && init?.method === 'POST') {
        aborted = true
        return json(null, 204)
      }
      if (url.pathname === '/office/conversations/abort/status') return json(started && !aborted ? { abort: { type: 'busy' } } : {})
      if (url.pathname === '/office/conversations/abort/messages') return json(started ? [
        { info: { id: 'abort-user', role: 'user' }, parts: [{ type: 'text', text: '需要停止' }] },
      ] : [])
      return json([])
    })
    vi.stubGlobal('fetch', request)

    try {
      render(<OfficeRightPanel active="对话中心" />)
      await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeEnabled())
      fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '需要停止' } })
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
      await waitFor(() => expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: '停止生成' }))

      expect(screen.getByLabelText('输入下一条消息')).toBeDisabled()
      await waitFor(() => expect(screen.getByText('本轮已停止。')).toBeInTheDocument(), { timeout: 5_000 })
      expect(screen.getByText('本轮已停止。').closest('article')).toHaveClass('system', 'cancelled')
      expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()
      expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
    } finally {
      nowSpy.mockRestore()
    }
  }, 10_000)
})
