import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { resultDeliverySchema } from '@pawoffice/protocol/office-ui'
import { ArrowDown, ArrowUp, LoaderCircle, MessageCircle, Plus, Square } from 'lucide-react'
import type { ChatSession } from '../chat/ChatSession.ts'
import type { ChatWorkspace, ChatWorkspaceSnapshot, ConversationEntry } from '../chat/ChatWorkspace.ts'
import type { DecisionSession } from '../application/decisions/DecisionSession.ts'
import type { DecisionSnapshot } from '../application/decisions/DecisionSession.ts'
import { OfficeDecisionPanel } from '../ui/decisions/OfficeDecisionPanel.tsx'
import { ChatSuggestions, ChatTranscript } from './ChatTranscript.tsx'
import type { ChatTranscriptHandle } from './ChatTranscript.tsx'
import { ConversationTabs } from './OfficeConversations.tsx'
import './OfficeChat.css'

type Props = {
  session: ChatWorkspace; expanded: boolean; onExpandedChange: (expanded: boolean) => void; hidden: boolean; leaderAppearanceId?: string; leaderName: string
  decisionSession: DecisionSession; decisionPreview?: boolean; decisionOpenToken?: number; onReplayDemo?: () => void
  onOpenDelivery?: (conversationId: string, deliveryId: string) => boolean
}
export const OfficeChat = memo(function OfficeChat(props: Props) {
  const state = useSyncExternalStore(props.session.subscribe, props.session.getSnapshot)
  const decisions = useSyncExternalStore(props.decisionSession.subscribe, props.decisionSession.getSnapshot)
  const entry = state.conversations.find(item => item.id === state.selectedId)
  if (!entry) return <div className="office-chat" hidden={props.hidden} data-expanded="false"><div className="office-chat-composer office-chat-initial"><button type="button" aria-label="新会话" onClick={() => { props.session.create(); props.onExpandedChange(true) }} disabled={!state.ready}><MessageCircle size={21} /><span>{state.ready ? '开始新的会话…' : '正在恢复会话…'}</span><Plus size={19} /></button></div></div>
  return <ActiveConversation key={entry.id} {...props} workspace={props.session} workspaceState={state} entry={entry} session={entry.session} allDecisions={decisions} />
})

function ActiveConversation({ session, workspace, workspaceState, entry, allDecisions, expanded, onExpandedChange, hidden, leaderName, decisionSession, decisionPreview = false, decisionOpenToken = 0, onReplayDemo, onOpenDelivery }: Omit<Props, 'session'> & {
  session: ChatSession; workspace: ChatWorkspace; workspaceState: ChatWorkspaceSnapshot; entry: ConversationEntry; allDecisions: DecisionSnapshot
}) {
  const chat = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const deliveries = useMemo(() => (entry.data?.whiteboard?.deliveries ?? []).map(item => resultDeliverySchema.parse(item)), [entry.data?.whiteboard?.deliveries])
  const decisions = { ...allDecisions, pending: allDecisions.pending.filter(item => item.conversationId === entry.id),
    submittingId: allDecisions.submittingIds?.find(id => allDecisions.pending.some(item => item.id === id && item.conversationId === entry.id)),
    error: allDecisions.pending.some(item => item.id === allDecisions.errorDecisionId && item.conversationId === entry.id) ? allDecisions.error : null,
    receipt: allDecisions.receipt?.request.conversationId === entry.id ? allDecisions.receipt : null }
  const draft = chat.draft
  const setDraft = (value: string) => session.setDraft(value)
  const [atBottom, setAtBottom] = useState(true)
  const [composerHeight, setComposerHeight] = useState(48)
  const [conversationMenuOpen, setConversationMenuOpen] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLFormElement>(null)
  const transcript = useRef<ChatTranscriptHandle>(null)
  const composing = useRef(false)
  const panelId = useId()
  const conversationMenuId = useId()
  const busy = chat.phase !== 'idle', canSend = chat.ready && !chat.syncing && !chat.historyError && !chat.canceling

  useEffect(() => { if (expanded) void session.synchronize(true) }, [expanded, session])
  useLayoutEffect(() => {
    const element = textarea.current
    if (!element) return
    const resize = () => {
      element.style.height = '24px'; element.style.height = `${Math.min(96, element.scrollHeight)}px`
      const height = composer.current?.offsetHeight ?? 48
      root.current?.style.setProperty('--chat-composer-height', `${height}px`)
      setComposerHeight(height)
    }
    resize()
    let width = element.clientWidth
    let resizeFrame = 0
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth
        cancelAnimationFrame(resizeFrame)
        resizeFrame = requestAnimationFrame(resize)
      }
    })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(resizeFrame) }
  }, [draft, hidden, expanded])
  const bottom = () => {
    setAtBottom(true); transcript.current?.toBottom()
  }
  const submit = (text = draft) => {
    if (!canSend || busy || !text.trim()) return
    onExpandedChange(true); setAtBottom(true)
    void session.send(text); textarea.current?.focus()
  }
  const collapse = () => { setConversationMenuOpen(false); onExpandedChange(false); textarea.current?.focus() }

  return <div ref={root} className="office-chat" hidden={hidden} data-expanded={expanded} onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.stopPropagation(); collapse() } }}>
    <section id={panelId} className="office-chat-panel" aria-label="办公室对话" aria-hidden={!expanded} inert={!expanded}>
      <ConversationTabs workspace={workspace} state={workspaceState} decisions={allDecisions} menuOpen={conversationMenuOpen} onMenuOpenChange={setConversationMenuOpen} menuId={conversationMenuId} onCollapse={collapse} panelId={panelId} />
      <div className="office-chat-body">
      <ChatTranscript ref={transcript} session={session} chat={chat} expanded={expanded} bottomInset={composerHeight + 40} leaderName={leaderName} storageError={workspaceState.storageError} onAtBottomChange={setAtBottom}
        deliveries={deliveries} onOpenDelivery={onOpenDelivery ? id => onOpenDelivery(entry.id, id) : undefined}
        onEdit={() => { setDraft(chat.messages.findLast(message => message.role === 'user')?.content ?? ''); textarea.current?.focus() }} />
      </div>
      {!atBottom && <button type="button" className="office-chat-latest" title="回到最新消息" aria-label="回到最新消息" onClick={bottom}><ArrowDown size={17} /></button>}
    </section>
    <OfficeDecisionPanel preview={decisionPreview} openToken={decisionOpenToken} snapshot={decisions} onResolve={(decisionId, choiceId, customText) => { void decisionSession.choose(decisionSession.teamId, decisionId, choiceId, customText) }}
      onReset={onReplayDemo ?? (() => decisionSession.reset())} />
    {expanded && !conversationMenuOpen && <div className="office-chat-suggestions"><ChatSuggestions send={submit} disabled={!canSend || busy} /></div>}
    <form ref={composer} className="office-chat-composer" data-busy={busy} aria-label="发送消息" onSubmit={event => { event.preventDefault(); submit() }}>
      <button type="button" className="office-chat-history is-session" aria-label={expanded ? `切换会话：${entry.title}` : '展开对话'} title={entry.title} aria-expanded={expanded && conversationMenuOpen} aria-controls={expanded ? conversationMenuId : panelId} onClick={() => { if (expanded) setConversationMenuOpen(true); else onExpandedChange(true) }}><MessageCircle size={15} /><span>{entry.title}</span></button>
      <textarea ref={textarea} value={draft} rows={1} maxLength={4000} disabled={!chat.ready} aria-label="给办公室发送消息" placeholder={expanded ? '继续当前会话，或安排办公室成员执行任务…' : '和办公室聊一聊…'} onClick={() => onExpandedChange(true)} onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); submit() }
      }} />
      {expanded && <button type="button" className="office-chat-new" title="新会话" aria-label="新会话" onClick={() => workspace.create()}><Plus size={17} /></button>}
      {busy ? <button type="button" className="office-chat-send" title="停止生成" aria-label="停止生成" onClick={() => session.stop()}><Square size={15} fill="currentColor" /></button> : <button type="submit" className="office-chat-send" title={chat.canceling ? '正在停止生成' : '发送消息'} aria-label="发送消息" disabled={!canSend || !draft.trim()}>{chat.canceling ? <LoaderCircle size={17} /> : <ArrowUp size={21} />}</button>}
    </form>
  </div>
}
