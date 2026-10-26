import type { OfficeChatSource } from '@pawoffice/protocol/chat'
import type { DashboardConversation } from '@pawoffice/protocol/dashboard'
import { notifySubscribers } from '../notifications.ts'
import { ChatSession } from './ChatSession.ts'
import { chatWorkspaceArchiveSchema } from './persistence.ts'
import type { ChatArchive, ChatWorkspaceArchive, ChatWorkspacePersistence } from './persistence.ts'
import { PreviewChatSource } from './sources.ts'
import { archivedActiveTurn, mergeChatWorkspaces, sameWorkspaceData } from './mergeWorkspace.ts'

export type ConversationEntry = { id: string; title: string; session: ChatSession; local: boolean; data?: DashboardConversation }
export type ChatWorkspaceSnapshot = { conversations: readonly ConversationEntry[]; selectedId: string; ready: boolean; storageError: string | null; deletingIds: readonly string[] }
export function conversationState(entry: ConversationEntry) {
  if (entry.session.getSnapshot().phase !== 'idle' || entry.data?.tasks.some(task => task.status === 'running')) return 'running'
  if (entry.data?.tasks.some(task => task.status === 'blocked')) return 'blocked'
  if (entry.data?.tasks.length && entry.data.tasks.every(task => task.status === 'completed')) return 'completed'
  return 'queued'
}

/** Conversation streams live independently of the selected transcript. */
export class ChatWorkspace {
  readonly source: OfficeChatSource
  readonly teamId: string
  readonly ready: Promise<void>
  private entries = new Map<string, ConversationEntry>()
  private archives = new Map<string, ChatArchive>()
  private deletedIds = new Set<string>()
  private unsubscribers = new Map<string, () => void>()
  private removals = new Map<string, Promise<void>>()
  private state: ChatWorkspaceSnapshot = { conversations: [], selectedId: '', ready: false, storageError: null, deletingIds: [] }
  private listeners = new Set<() => void>()
  private readonly persistence?: ChatWorkspacePersistence
  private persisted: unknown
  private blocked = false
  private dirty = false
  private saving?: Promise<void>
  private saveTimer?: ReturnType<typeof setTimeout>
  private catalogue: readonly DashboardConversation[] = []
  private readonly requestDelete?: (id: string) => Promise<void>
  private readonly onRemoved?: (id: string) => void
  private active = false
  private unsubscribeStorage?: () => void
  private refreshing?: Promise<void>
  private refreshAgain = false

  constructor(teamId: string, source: OfficeChatSource, options: { persistence?: ChatWorkspacePersistence; requestDelete?: (id: string) => Promise<void>; onRemoved?: (id: string) => void } = {}) {
    this.teamId = teamId; this.source = source; this.persistence = options.persistence
    this.requestDelete = options.requestDelete
    this.onRemoved = options.onRemoved
    this.ready = this.restore()
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get selected() { return this.entries.get(this.state.selectedId)?.session }
  requiresBackendDeletion(id: string) { return Boolean(this.requestDelete && this.entries.get(id)?.data) }
  private emit(change: Partial<ChatWorkspaceSnapshot> = {}) {
    if (change.selectedId !== undefined && change.selectedId !== this.state.selectedId) this.persistence?.writeSelection?.(change.selectedId)
    this.state = { ...this.state, ...change, conversations: [...this.entries.values()] }
    notifySubscribers(this.listeners, 'ChatWorkspace')
  }
  private async restore() {
    try {
      const value = await this.persistence?.read()
      this.persisted = value
      if (value !== undefined) {
        const archive = chatWorkspaceArchiveSchema.parse(value)
        if (archive.teamId !== this.teamId) throw new Error('会话不属于当前办公室')
        this.deletedIds = new Set(archive.deletedIds)
        for (const entry of archive.conversations) this.add(entry.id, entry.title, entry.local, entry.chat)
        const selection = this.persistence?.readSelection?.()
        this.state = { ...this.state, selectedId: selection !== undefined && this.entries.has(selection) ? selection : archive.selectedId }
        await Promise.all([...this.entries.values()].map(entry => entry.session.ready))
      }
    } catch {
      this.blocked = true
      this.state = { ...this.state, storageError: '会话记录无法读取，原记录未覆盖；本次会话仅临时保留。' }
    }
    this.emit({ ready: true })
    this.sync(this.catalogue)
  }
  private add(id: string, title: string, local: boolean, archive?: ChatArchive) {
    const initial: ChatArchive = archive ?? { version: 1, teamId: this.teamId, conversationId: id, draft: '', activeTurnId: '',
      messages: (this.source instanceof PreviewChatSource ? this.source.initialHistory(id, this.teamId) : []).map(message => ({ ...message, id: crypto.randomUUID(), state: 'complete' as const })) }
    this.archives.set(id, initial)
    const session = new ChatSession(this.teamId, this.source, { conversationId: id, syncOnRestore: false, persistence: {
      read: async () => initial,
      write: async next => { if (this.entries.get(id)?.session !== session) return; this.archives.set(id, next); this.scheduleSave(); await this.flush() },
    } })
    const entry: ConversationEntry = { id, title, session, local }
    this.entries.set(id, entry)
    this.unsubscribers.set(id, session.subscribe(() => {
      if (entry.local && entry.title === '新会话') {
        const message = session.getSnapshot().messages.find(message => message.role === 'user')
        if (message) { entry.title = message.content.trim().replace(/\s+/g, ' ').slice(0, 36) || '新会话'; this.scheduleSave() }
      }
      this.emit()
    }))
    return entry
  }
  sync(conversations: readonly DashboardConversation[]) {
    this.catalogue = conversations
    if (!this.state.ready) return
    let changed = false
    const remote = new Set(conversations.map(item => item.id))
    for (const entry of this.entries.values()) {
      // Keep archived transcripts, but never leave removed business state visible.
      if (!remote.has(entry.id) && entry.data) { entry.data = undefined; changed = true }
    }
    for (const data of conversations) {
      if (this.deletedIds.has(data.id)) continue
      if (!this.entries.has(data.id)) changed = true
      const entry = this.entries.get(data.id) ?? this.add(data.id, data.title, false)
      if (entry.title !== data.title || entry.local) changed = true
      entry.title = data.title; entry.local = false; entry.data = data
    }
    let selectedId = this.state.selectedId
    if (!this.entries.has(selectedId)) selectedId = this.entries.keys().next().value ?? ''
    this.emit({ selectedId })
    void this.selected?.synchronize()
    if (changed) this.scheduleSave()
  }
  select(id: string) {
    if (!this.state.ready || !this.entries.has(id) || this.state.selectedId === id) return
    this.emit({ selectedId: id })
    if (!this.persistence?.writeSelection) this.scheduleSave()
    void this.selected?.synchronize(true)
  }
  restorePreviewConversation(id: string) {
    if (!this.state.ready || this.source.kind !== 'preview' || !this.catalogue.some(entry => entry.id === id)) return
    if (this.deletedIds.delete(id)) { this.sync(this.catalogue); this.scheduleSave() }
    this.select(id)
  }
  create() {
    if (!this.state.ready) return
    const empty = [...this.entries.values()].find(entry => entry.local && entry.session.getSnapshot().messages.length === 0 && !entry.session.getSnapshot().draft)
    const entry = empty ?? this.add(crypto.randomUUID(), '新会话', true)
    this.emit({ selectedId: entry.id }); this.scheduleSave(); void entry.session.synchronize()
    return entry.id
  }
  remove(id: string): Promise<void> {
    const pending = this.removals.get(id)
    if (pending) return pending
    const entry = this.entries.get(id)
    if (!this.state.ready || !entry) return Promise.reject(new Error('会话不存在或尚未恢复'))
    if (this.blocked) return Promise.reject(new Error('会话存档当前不可写，请刷新后重试'))
    const removal = Promise.resolve().then(async () => {
      if (entry.data) await this.requestDelete?.(id)
      if ((!entry.data || !this.requestDelete) && !await entry.session.stop()) throw new Error('停止生成未确认，未删除会话；请重新同步后重试')
      if (this.entries.get(id) !== entry) return
      const ids = [...this.entries.keys()], index = ids.indexOf(id)
      this.unsubscribers.get(id)?.(); this.unsubscribers.delete(id)
      this.entries.delete(id); this.archives.delete(id); this.deletedIds.add(id)
      entry.session.dispose()
      this.onRemoved?.(id)
      this.emit({ selectedId: this.state.selectedId === id ? ids[index + 1] ?? ids[index - 1] ?? '' : this.state.selectedId })
      this.scheduleSave(); await this.flush()
      if (this.state.storageError) throw new Error('会话已从本页移除，但未能保存删除结果，请勿立即刷新')
    }).finally(() => { this.removals.delete(id); this.emit({ deletingIds: [...this.removals.keys()] }) })
    this.removals.set(id, removal); this.emit({ deletingIds: [...this.removals.keys()] })
    return removal
  }
  private scheduleSave() {
    if (!this.state.ready || !this.persistence || this.blocked) return
    this.dirty = true
    this.saveTimer ??= setTimeout(() => { void this.flush() }, 300)
  }
  flush = (): Promise<void> => {
    clearTimeout(this.saveTimer); this.saveTimer = undefined
    if (this.saving) return this.saving
    if (!this.dirty || !this.persistence || this.blocked) return Promise.resolve()
    this.saving = this.save().finally(() => { this.saving = undefined })
    return this.saving
  }
  private async save() {
    let collisions = 0
    while (this.dirty && this.persistence && !this.blocked) {
      this.dirty = false
      const archive = this.capture()
      try { await this.persistence.write(archive, this.persisted); this.persisted = archive; if (this.state.storageError) this.emit({ storageError: null }) }
      catch (error) {
        this.dirty = true
        if (error instanceof Error && 'code' in error && error.code === 'CHAT_STORAGE_CONFLICT' && collisions++ < 8) {
          try {
            const latest = await this.readStorage()
            const merged = mergeChatWorkspaces(this.persisted as ChatWorkspaceArchive | undefined, this.capture(), latest, this.activeIds())
            this.persisted = latest
            this.applyStorage(merged)
            continue
          } catch { /* Keep the visible local state and retry on the next save. */ }
        }
        this.emit({ storageError: '会话保存暂未完成，内容仍保留在本页；请稍后重试，刷新前保留重要内容。' })
        return
      }
    }
  }
  private capture(): ChatWorkspaceArchive {
    return { version: 2, teamId: this.teamId, selectedId: this.state.selectedId, deletedIds: [...this.deletedIds],
      conversations: [...this.entries.values()].map(({ id, title, local, session }) => {
        const chat = session.getSnapshot().ready ? session.getArchive() : this.archives.get(id)!
        // The shared checkpoint is deterministic even when pages own different receivers.
        return { id, title, local, chat: { ...chat, activeTurnId: archivedActiveTurn(chat.messages) } }
      }) }
  }
  private activeIds() { return new Set([...this.entries.values()].filter(entry => entry.session.isReceiving).map(entry => entry.id)) }
  private async readStorage() {
    const value = await this.persistence!.read()
    if (value === undefined) return undefined
    chatWorkspaceArchiveSchema.parse(value)
    if ((value as ChatWorkspaceArchive).teamId !== this.teamId) throw new Error('会话不属于当前办公室')
    for (const { chat } of (value as ChatWorkspaceArchive).conversations) {
      if (chat.messages.length % 2 || new Set(chat.messages.map(message => message.id)).size !== chat.messages.length
        || chat.messages.some((message, index) => message.role !== (index % 2 ? 'assistant' : 'user'))) throw new Error('聊天记录顺序无效')
    }
    return value as ChatWorkspaceArchive
  }
  private applyStorage(archive: ChatWorkspaceArchive) {
    const ids = new Set(archive.conversations.map(entry => entry.id))
    for (const [id, entry] of this.entries) if (!ids.has(id)) {
      this.unsubscribers.get(id)?.(); this.unsubscribers.delete(id)
      this.entries.delete(id); this.archives.delete(id); entry.session.detach()
      this.onRemoved?.(id)
    }
    this.deletedIds = new Set(archive.deletedIds)
    for (const saved of archive.conversations) {
      const entry = this.entries.get(saved.id) ?? this.add(saved.id, saved.title, saved.local, saved.chat)
      entry.title = saved.title; entry.local = saved.local
      this.archives.set(saved.id, saved.chat)
      const apply = () => { if (this.entries.get(saved.id) === entry && this.archives.get(saved.id) === saved.chat) entry.session.applyArchive(saved.chat) }
      if (entry.session.getSnapshot().ready) apply()
      else void entry.session.ready.then(apply)
    }
    this.entries = new Map(archive.conversations.map(saved => [saved.id, this.entries.get(saved.id)!]))
    this.emit({ selectedId: archive.selectedId, storageError: null })
  }
  start() {
    if (this.active) return
    this.active = true
    if (!this.persistence?.subscribe) return
    this.unsubscribeStorage = this.persistence?.subscribe?.(() => { void this.refreshStorage() })
    void this.refreshStorage()
  }
  private refreshStorage(): Promise<void> {
    this.refreshAgain = true
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      await this.ready
      while (this.active && this.refreshAgain && this.persistence && !this.blocked) {
        this.refreshAgain = false
        await this.flush()
        const base = this.persisted
        try {
          const latest = await this.readStorage()
          if (!this.active) return
          // A save that overtook this read owns the newer baseline.
          if (this.saving || this.persisted !== base) { this.refreshAgain = true; continue }
          const merged = mergeChatWorkspaces(base as ChatWorkspaceArchive | undefined, this.capture(), latest, this.activeIds())
          this.persisted = latest
          this.applyStorage(merged)
          if (!sameWorkspaceData(merged, latest)) this.scheduleSave()
        } catch { /* A failed background read must never discard visible conversations. */ }
      }
    })().finally(() => { this.refreshing = undefined })
    return this.refreshing
  }
  stop() {
    this.active = false; this.unsubscribeStorage?.(); this.unsubscribeStorage = undefined
    for (const entry of this.entries.values()) entry.session.detach()
    void this.flush()
  }
}
