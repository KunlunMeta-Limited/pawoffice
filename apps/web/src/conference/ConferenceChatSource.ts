import type { ChatEvent, ChatRequest, OfficeChatSource } from '@pawoffice/protocol/chat'
import { readDemoReport } from './demoReports.ts'

function wait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export class ConferenceChatSource implements OfficeChatSource {
  readonly kind = 'preview'
  readonly historyKey: string
  private readonly reply: (request: ChatRequest) => string

  constructor(reply: (request: ChatRequest) => string, historyKey = 'conference-demo-v1') {
    this.reply = reply
    this.historyKey = historyKey
  }

  async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent> {
    yield { type: 'status', phase: 'thinking' }
    await wait(1000 + Math.floor(Math.random() * 1001), signal)
    signal.throwIfAborted()
    const reply = this.reply(request)
    const report = readDemoReport(reply)
    const characters = Array.from(report ? '我把本轮的情况整理成了这份报告。' : reply)
    // Use small increments for short replies and keep long lists under a few seconds.
    const size = Math.max(1, Math.ceil(characters.length / 100))
    for (let index = 0; index < characters.length; index += size) {
      if (index) await wait(24, signal)
      signal.throwIfAborted()
      yield { type: 'delta', text: characters.slice(index, index + size).join('') }
    }
    if (report) {
      await wait(180, signal)
      signal.throwIfAborted()
      yield { type: 'delta', text: '\n\n' + reply }
    }
    yield { type: 'done' }
  }
}
