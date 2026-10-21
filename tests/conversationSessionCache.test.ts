import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getConversationSessionsSnapshot,
  invalidateConversationSessions,
  loadConversationSessions,
  prefetchConversationSessions,
  resetConversationSessionCache,
  useConversationSessions,
} from '@/services/conversationSessionCache'

function json(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}

describe('会话摘要共享缓存', () => {
  beforeEach(() => {
    resetConversationSessionCache()
  })

  it('合并并发预取请求并向多个订阅者发布同一快照', async () => {
    let resolveResponse: ((value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | undefined
    const pending = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => { resolveResponse = resolve })
    const request = vi.fn(() => pending)
    vi.stubGlobal('fetch', request)

    const first = loadConversationSessions()
    prefetchConversationSessions()
    expect(request).toHaveBeenCalledTimes(1)
    resolveResponse?.({ ok: true, status: 200, json: () => Promise.resolve([
      { id: 'a', title: '缓存对话', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 2 },
    ]) })
    await first
    expect(getConversationSessionsSnapshot()).toMatchObject({ state: 'ready', data: [{ id: 'a', title: '缓存对话' }] })

    const { result } = renderHook(() => useConversationSessions(true))
    expect(result.current.data[0]?.title).toBe('缓存对话')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('禁用和重新启用时保留旧数据，并在失效后后台校准', async () => {
    const request = vi.fn()
      .mockImplementationOnce(() => json([{ id: 'a', title: '旧标题', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }]))
      .mockImplementationOnce(() => json([{ id: 'a', title: '新标题', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 2 }]))
    vi.stubGlobal('fetch', request)

    const { result, rerender } = renderHook(({ enabled }) => useConversationSessions(enabled), { initialProps: { enabled: true } })
    await waitFor(() => expect(result.current.data[0]?.title).toBe('旧标题'))
    rerender({ enabled: false })
    expect(result.current.data[0]?.title).toBe('旧标题')

    act(() => invalidateConversationSessions([{ id: 'a', title: '本地标题', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 3 }]))
    expect(result.current.data[0]?.title).toBe('本地标题')
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.data[0]?.title).toBe('新标题'))
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('已有缓存刷新失败时保留可见数据和 ready 状态', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockImplementationOnce(() => json([{ id: 'a', title: '可用缓存', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }]))
      .mockRejectedValueOnce(new Error('网关离线')))
    await loadConversationSessions()
    invalidateConversationSessions()
    await expect(loadConversationSessions(true)).rejects.toThrow('网关离线')
    expect(getConversationSessionsSnapshot()).toMatchObject({ state: 'ready', data: [{ title: '可用缓存' }], error: expect.any(Error) })
  })

  it('旧摘要请求迟到时不能覆盖创建后立即写入的新会话', async () => {
    let resolveResponse: ((value: { ok: boolean; status: number; json: () => Promise<unknown> }) => void) | undefined
    const pending = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>((resolve) => { resolveResponse = resolve })
    vi.stubGlobal('fetch', vi.fn(() => pending))

    const load = loadConversationSessions()
    act(() => invalidateConversationSessions([
      { id: 'new', title: '刚创建的会话', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
    ]))
    resolveResponse?.({ ok: true, status: 200, json: () => Promise.resolve([
      { id: 'old', title: '旧服务端快照', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
    ]) })
    await load

    expect(getConversationSessionsSnapshot()).toMatchObject({
      state: 'ready',
      data: [{ id: 'new', title: '刚创建的会话' }],
    })
  })
})
