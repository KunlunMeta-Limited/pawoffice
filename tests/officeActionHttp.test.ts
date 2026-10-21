import { afterEach, describe, expect, it, vi } from 'vitest'
import { OfficeActionHttpClient } from '@/services/officeActionHttp'

describe('办公室动作轮询恢复', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('半开请求达到超时后会取消并继续下一轮轮询', async () => {
    vi.useFakeTimers()
    let calls = 0
    const request = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('请求已取消', 'AbortError')), { once: true })
        })
      }
      return Promise.resolve(new Response(JSON.stringify({ actions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', request)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const client = new OfficeActionHttpClient()
    client.connect('http://127.0.0.1:8765/actions')
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(request).toHaveBeenCalledTimes(2)
    client.disconnect()
  })

  it('首次连接从当前日志尾部开始，之后只读取新增动作', async () => {
    vi.useFakeTimers()
    const responses = [
      { actions: [], nextCursor: 48 },
      { actions: [{ type: 'set_state', rosterNo: 1, state: 'thinking' }], nextCursor: 49 },
    ]
    const request = vi.fn(() => Promise.resolve(new Response(
      JSON.stringify(responses.shift() ?? { actions: [], nextCursor: 49 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )))
    vi.stubGlobal('fetch', request)

    const client = new OfficeActionHttpClient()
    client.connect('http://127.0.0.1:8765/actions')
    await vi.advanceTimersByTimeAsync(0)

    expect(String(request.mock.calls[0]?.[0])).toContain('after=latest')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(String(request.mock.calls[1]?.[0])).toContain('after=48')
    client.disconnect()
  })

  it('重连后忽略旧轮询的迟到响应且只保留一条定时链', async () => {
    vi.useFakeTimers()
    let resolveOld!: (response: Response) => void
    let calls = 0
    const request = vi.fn(() => {
      calls += 1
      if (calls === 1) return new Promise<Response>((resolve) => { resolveOld = resolve })
      const nextCursor = calls === 2 ? 10 : 11
      return Promise.resolve(new Response(
        JSON.stringify({ actions: [], nextCursor }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ))
    })
    vi.stubGlobal('fetch', request)

    const client = new OfficeActionHttpClient()
    client.connect('http://127.0.0.1:8765/actions')
    client.connect('http://127.0.0.1:8765/actions')
    await vi.advanceTimersByTimeAsync(0)
    resolveOld(new Response(
      JSON.stringify({ actions: [{ type: 'set_state', rosterNo: 1, state: 'thinking' }], nextCursor: 1 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(request).toHaveBeenCalledTimes(3)
    expect(String(request.mock.calls[2]?.[0])).toContain('after=10')
    client.disconnect()
  })
})
