import { createContext, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, Ref } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronUp, Copy, LoaderCircle, MessageCircle, RefreshCw } from 'lucide-react'
import type { ChatSession, ChatSnapshot } from '../chat/ChatSession.ts'
import { ChatMarkdown } from './ChatMarkdown.tsx'
import type { ResultDelivery } from '@pawoffice/protocol/office-ui'
import { deliveriesByTurn } from '../results/chatDeliveries.ts'
import { ChatDeliveries } from './ChatDeliveries.tsx'

export type ChatTranscriptHandle = { toBottom: () => void }

type TranscriptPresentation = {
  pendingLabel: string
  renderReply: (content: string) => { body: ReactNode; copyText: string; scrollToStart?: boolean } | undefined
  renderSuggestions?: (send: (text: string) => void, disabled: boolean) => ReactNode
}
const PresentationContext = createContext<TranscriptPresentation | undefined>(undefined)

export function ChatTranscriptPresentation({ value, children }: { value?: TranscriptPresentation; children: ReactNode }) {
  return <PresentationContext.Provider value={value}>{children}</PresentationContext.Provider>
}

export function ChatSuggestions({ send, disabled }: { send: (text: string) => void; disabled: boolean }) {
  return useContext(PresentationContext)?.renderSuggestions?.(send, disabled)
}

export function ChatTranscript({ ref, session, chat, expanded, bottomInset, leaderName, storageError, onAtBottomChange, onEdit, deliveries, onOpenDelivery }: {
  ref: Ref<ChatTranscriptHandle>; session: ChatSession; chat: ChatSnapshot; expanded: boolean
  bottomInset: number; leaderName: string; storageError: string | null; onAtBottomChange: (value: boolean) => void; onEdit: () => void
  deliveries?: readonly ResultDelivery[]; onOpenDelivery?: (deliveryId: string) => boolean
}) {
  'use no memo'
  const scroll = useRef<HTMLDivElement>(null), lastScrollTop = useRef(0)
  const [atStart, setAtStart] = useState(false)
  const turnDeliveries = useMemo(() => deliveriesByTurn(deliveries ?? []), [deliveries])
  const [copied, setCopied] = useState(''), copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const presentation = useContext(PresentationContext)
  const revealedReply = useRef('')
  const latest = chat.messages.at(-1)
  const latestReply = latest?.role === 'assistant' ? presentation?.renderReply(latest.content) : undefined
  const startAlignedReply = latestReply?.scrollToStart ? latest?.id : undefined
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  const rows = useMemo(() => [
    ...chat.messages.map(message => ({ id: message.id, kind: 'message' as const, message })),
    ...(!chat.messages.length ? [{ id: '@empty', kind: 'empty' as const }] : []),
    ...(chat.syncing || chat.historyError || chat.error ? [{ id: '@status', kind: 'status' as const }] : []),
    ...(chat.storageError || storageError ? [{ id: '@storage', kind: 'storage' as const }] : []),
  ], [chat, storageError])
  // eslint-disable-next-line react-hooks/incompatible-library -- Keep this mutable virtualizer local to the non-memoized transcript.
  const virtualizer = useVirtualizer({
    count: rows.length, getScrollElement: () => scroll.current, getItemKey: index => rows[index].id,
    // Keep start-aligned replies at their heading when their height is first measured.
    estimateSize: () => 140, overscan: 6, anchorTo: startAlignedReply ? 'start' : 'end', followOnAppend: true, scrollEndThreshold: 64,
    // The collapsed panel retains its layout. Disabling clears its rows, but direct DOM updates can skip rendering the same range on reopen.
    // Keep the composer clearance inside the scrollable content so suggestions float over an uninterrupted transcript.
    directDomUpdates: true, paddingStart: 22, paddingEnd: bottomInset + 18,
    // Delivery cards resize after live snapshots; measure them outside the observer's current layout cycle.
    useAnimationFrameWithResizeObserver: true,
    onChange: instance => { onAtBottomChange(instance.isAtEnd()); setAtStart((instance.scrollOffset ?? 0) < 200) },
  })
  useImperativeHandle(ref, () => ({ toBottom: () => virtualizer.scrollToEnd() }), [virtualizer])
  const latestUser = chat.messages.findLast(message => message.role === 'user')?.id
  useLayoutEffect(() => { if (expanded) virtualizer.scrollToEnd() }, [expanded, latestUser, virtualizer])
  useLayoutEffect(() => {
    if (!expanded || !startAlignedReply || revealedReply.current === startAlignedReply) return
    const frame = requestAnimationFrame(() => {
      revealedReply.current = startAlignedReply
      virtualizer.scrollToIndex(chat.messages.length - 1, { align: 'start' })
    })
    return () => cancelAnimationFrame(frame)
  }, [expanded, startAlignedReply, chat.messages.length, virtualizer])
  const copy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content); setCopied(id); clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(''), 1800)
    } catch { setCopied('') }
  }
  return <div className="office-chat-transcript-wrap">
    {(chat.hasMoreHistory || chat.olderError) && (atStart || chat.loadingOlder || chat.olderError) && <div className="office-chat-history-page">{chat.olderError && <span role="alert">{chat.olderError}</span>}<button type="button" disabled={chat.loadingOlder} onClick={() => { void session.loadOlder() }}>{chat.loadingOlder ? <LoaderCircle size={14} /> : <ChevronUp size={14} />}{chat.loadingOlder ? '加载中…' : '加载更早消息'}</button></div>}
    <div className="office-chat-transcript" ref={scroll} role="log" aria-label="对话内容" aria-live="off" onScroll={event => {
    const top = event.currentTarget.scrollTop, movingUp = top < lastScrollTop.current
    lastScrollTop.current = top
    if (movingUp && top >= 0 && top < 200 && !chat.olderError) void session.loadOlder()
  }}>
    <div ref={virtualizer.containerRef} className="office-chat-virtual-list">
      {virtualizer.getVirtualItems().map(item => {
        const row = rows[item.index]
        const reply = row.kind === 'message' && row.message.role === 'assistant'
          ? row.message === latest ? latestReply : presentation?.renderReply(row.message.content) : undefined
        return <div key={row.id} data-index={item.index} ref={virtualizer.measureElement} className="office-chat-row">
          {row.kind === 'message' && <article className={`office-chat-message is-${row.message.role}`} aria-label={row.message.role === 'user' ? '你' : leaderName}>
            <span className="office-chat-message-avatar">{row.message.role === 'assistant' ? 'AI' : '我'}</span><div className="office-chat-message-content">
              <div className="office-chat-message-meta"><span>{row.message.role === 'user' ? '你' : '办公室助手'}</span>{row.message.role === 'assistant' && row.message.content && row.message.state !== 'pending' && <button type="button" title={copied === row.id ? '已复制' : '复制回复'} aria-label={copied === row.id ? '已复制' : '复制回复'} onClick={() => { void copy(row.id, reply?.copyText ?? row.message.content) }}>{copied === row.id ? <Check size={14} /> : <Copy size={14} />}</button>}</div>
              <div className="office-chat-bubble">{reply ? reply.body
                : row.message.content ? row.message.role === 'assistant' ? <ChatMarkdown content={row.message.content} pending={row.message.state === 'pending'} /> : <p className="office-chat-user-text">{row.message.content}</p>
                  : row.message.state === 'pending' ? <div className="office-chat-pending"><span /><span /><span /><small>{presentation?.pendingLabel ?? (session.source.kind === 'preview' ? '预览回复准备中' : '正在思考')}</small></div> : null}
                {row.message.state === 'stopped' && <small className="office-chat-interrupted">已停止生成</small>}
                {row.message.state === 'error' && <small className="office-chat-interrupted">回复未完成</small>}
              </div>
              {row.message.role === 'assistant' && row.message.turnId && <ChatDeliveries deliveries={turnDeliveries.get(row.message.turnId) ?? []} onOpen={onOpenDelivery} />}
            </div>
          </article>}
          {row.kind === 'empty' && <div className="office-chat-empty"><MessageCircle size={30} /><h2>今天一起做点什么？</h2></div>}
          {row.kind === 'status' && <div className="office-chat-error" role={chat.syncing ? 'status' : 'alert'}><span>{chat.syncing ? '正在同步聊天记录…' : chat.historyError || chat.error}</span>{!chat.syncing && (session.source.history ? <button type="button" onClick={() => { void session.synchronize(true) }}><RefreshCw size={14} />重新同步</button> : <button type="button" onClick={onEdit}>重新编辑</button>)}</div>}
          {row.kind === 'storage' && <div className="office-chat-error" role="alert">{chat.storageError || storageError}</div>}
        </div>
      })}
    </div>
  </div>
  </div>
}
