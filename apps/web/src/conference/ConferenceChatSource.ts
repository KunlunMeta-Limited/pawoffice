import type { ChatEvent, ChatRequest, OfficeChatSource } from '@pawoffice/protocol/chat'

function waitForReply(signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 1000 + Math.floor(Math.random() * 1001))
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
    await waitForReply(signal)
    signal.throwIfAborted()
    yield { type: 'delta', text: this.reply(request) }
    yield { type: 'done' }
  }
}
