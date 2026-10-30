import { canonical } from '@pawoffice/protocol'
import type { ChatArchive, ChatWorkspaceArchive } from './persistence.ts'

type Entry = ChatWorkspaceArchive['conversations'][number]
type Message = ChatArchive['messages'][number]
const same = (a: unknown, b: unknown) => a === b || canonical(a) === canonical(b)
const choose = <T>(base: T | undefined, local: T, remote: T): T => same(local, base) ? remote : local
export function archivedActiveTurn(messages: Message[]) {
  const suffix = ':assistant'
  const pending = messages.findLast(message => message.role === 'assistant' && message.state === 'pending' && message.id.endsWith(suffix))
  return pending ? pending.id.slice(0, -suffix.length) : ''
}

function mergeMessage(base: Message | undefined, local: Message, remote: Message): Message | undefined {
  if (same(local, base) || same(local, remote)) return remote
  if (same(remote, base)) return local
  if (local.id !== remote.id || local.role !== remote.role) return undefined
  if (local.content === remote.content) {
    const states = ['pending', 'stopped', 'error', 'complete'] as const
    return states.indexOf(local.state) >= states.indexOf(remote.state) ? local : remote
  }
  // Two receivers of the same stream may checkpoint different-length prefixes.
  if (local.role === 'assistant') {
    if (local.content.startsWith(remote.content)) return local
    if (remote.content.startsWith(local.content)) return remote
  }
  return undefined
}

function pairs(messages: Message[]) {
  const result = new Map<string, Message[]>()
  for (let i = 0; i < messages.length; i += 2) {
    if (messages[i]?.role !== 'user' || messages[i + 1]?.role !== 'assistant') return undefined
    result.set(messages[i].id, messages.slice(i, i + 2))
  }
  return result
}

function mergeMessages(base: Message[], local: Message[], remote: Message[]) {
  if (same(local, base) || same(local, remote)) return remote
  if (same(remote, base)) return local
  const b = pairs(base), l = pairs(local), r = pairs(remote)
  if (!b || !l || !r) return undefined
  const order = [...r.keys()], localOrder = [...l.keys()]
  for (const [index, id] of localOrder.entries()) if (!r.has(id)) {
    const next = localOrder.slice(index + 1).find(key => r.has(key))
    order.splice(next === undefined ? order.length : order.indexOf(next), 0, id)
  }
  const result: Message[] = []
  for (const id of new Set([...order, ...b.keys()])) {
    const before = b.get(id), left = l.get(id), right = r.get(id)
    if (same(left, before)) { if (right) result.push(...right); continue }
    if (same(right, before) || same(left, right)) { if (left) result.push(...left); continue }
    if (!left || !right) return undefined
    for (let i = 0; i < 2; i++) {
      const message = mergeMessage(before?.[i], left[i], right[i])
      if (!message) return undefined
      result.push(message)
    }
  }
  return new Set(result.map(message => message.id)).size === result.length ? result : undefined
}

function mergeEntry(base: Entry | undefined, local: Entry, remote: Entry): Entry | undefined {
  if (same(local, base) || same(local, remote)) return remote
  if (same(remote, base)) return local
  const messages = mergeMessages(base?.chat.messages ?? [], local.chat.messages, remote.chat.messages)
  const draftConflict = local.chat.draft !== remote.chat.draft && local.chat.draft !== (base?.chat.draft ?? '') && remote.chat.draft !== (base?.chat.draft ?? '')
  if (!messages || draftConflict) return undefined
  const activeTurnId = archivedActiveTurn(messages)
  return { ...remote, title: choose(base?.title, local.title, remote.title), local: local.local && remote.local,
    chat: { ...local.chat, draft: choose(base?.chat.draft ?? '', local.chat.draft, remote.chat.draft), activeTurnId, messages } }
}

/** Rebase local edits per conversation; divergent versions become visible, saved recovery copies. */
export function mergeChatWorkspaces(base: ChatWorkspaceArchive | undefined, local: ChatWorkspaceArchive,
  remote: ChatWorkspaceArchive | undefined, activeIds = new Set<string>()): ChatWorkspaceArchive {
  const b = new Map(base?.conversations.map(entry => [entry.id, entry]) ?? [])
  const l = new Map(local.conversations.map(entry => [entry.id, entry]))
  const r = new Map(remote?.conversations.map(entry => [entry.id, entry]) ?? [])
  const deleted = new Set<string>(), conversations: Entry[] = []
  let selectedId = local.selectedId
  const recover = (entry: Entry) => {
    const id = crypto.randomUUID()
    conversations.push({ ...entry, id, local: true, title: `${entry.title.slice(0, 150)}（恢复副本）`,
      chat: { ...entry.chat, conversationId: id, activeTurnId: '', messages: entry.chat.messages.map(message =>
        message.state === 'pending' ? { ...message, state: 'stopped' } : message) } })
    return id
  }
  const wasDeleted = (archive: ChatWorkspaceArchive | undefined, id: string) => archive?.deletedIds?.includes(id) ?? false
  for (const id of new Set([...r.keys(), ...l.keys(), ...(base?.deletedIds ?? []), ...local.deletedIds, ...(remote?.deletedIds ?? [])])) {
    const before = b.get(id), left = l.get(id), right = r.get(id)
    const localDelete = wasDeleted(local, id), remoteDelete = wasDeleted(remote, id)
    const removed = choose(wasDeleted(base, id), localDelete, remoteDelete)
    if (removed) {
      deleted.add(id)
      const edited = localDelete ? right : left
      if (edited && !same(edited, before)) {
        const copy = recover(edited)
        if (selectedId === id) selectedId = copy
      }
      continue
    }
    if (!left || !right) { const entry = left ?? right; if (entry) conversations.push(entry); continue }
    const merged = mergeEntry(before, left, right)
    if (merged) conversations.push(merged)
    else if (activeIds.has(id)) { conversations.push(left); recover(right) }
    else {
      conversations.push(right)
      const copy = recover(left)
      if (selectedId === id) selectedId = copy
    }
  }
  if (!conversations.some(entry => entry.id === selectedId)) selectedId = conversations[0]?.id ?? ''
  return { version: 2, teamId: local.teamId, selectedId, deletedIds: [...deleted], conversations }
}

export function sameWorkspaceData(a: ChatWorkspaceArchive, b: ChatWorkspaceArchive | undefined) {
  return b ? same({ ...a, selectedId: '' }, { ...b, selectedId: '' }) : !a.conversations.length && !a.deletedIds.length
}
