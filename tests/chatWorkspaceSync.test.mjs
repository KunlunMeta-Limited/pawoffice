import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IDBFactory } from 'fake-indexeddb'
import { createTestServer } from './helpers/vite.mjs'

const catalogue = ['a', 'b'].map(id => ({ id, title: `会话 ${id}` }))
const echo = { kind: 'test', async *stream(request) {
  yield { type: 'delta', text: `回复 ${request.messages.at(-1).content}` }; yield { type: 'done' }
} }
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
async function until(condition) {
  const deadline = Date.now() + 3000
  while (!condition() && Date.now() < deadline) await tick()
  assert(condition(), 'storage updates must settle without a reload')
}
async function flush(workspace) {
  await Promise.all(workspace.getSnapshot().conversations.map(entry => entry.session.flush()))
  await workspace.flush()
}
const session = (workspace, id) => workspace.getSnapshot().conversations.find(entry => entry.id === id)?.session
async function setup(t, source = echo, conversations = catalogue) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() })
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor); else delete globalThis.indexedDB })
  const vite = await createTestServer(); t.after(() => vite.close())
  const { ChatWorkspace } = await vite.ssrLoadModule('/apps/web/src/chat/ChatWorkspace.ts')
  const { browserChatPersistence } = await vite.ssrLoadModule('/apps/web/src/chat/persistence.ts')
  const { mergeChatWorkspaces } = await vite.ssrLoadModule('/apps/web/src/chat/mergeWorkspace.ts')
  const stores = [], workspaces = []
  t.after(() => workspaces.forEach(workspace => workspace.stop()))
  const page = async () => {
    let selected
    const persistence = { ...browserChatPersistence('team', 'source'), readSelection: () => selected, writeSelection: id => { selected = id } }
    stores.push(persistence)
    const workspace = new ChatWorkspace('team', source, { persistence }); workspaces.push(workspace)
    await workspace.ready; workspace.sync(conversations)
    await Promise.all(workspace.getSnapshot().conversations.map(entry => entry.session.ready))
    return workspace
  }
  const a = await page(); await flush(a)
  const b = await page(); await flush(b)
  return { a, b, stores, page, mergeChatWorkspaces }
}

test('two pages can save different conversations and drafts concurrently without blocking either workspace', async t => {
  const { a, b, stores } = await setup(t)
  a.select('a'); b.select('b')
  session(a, 'a').setDraft('A 的草稿'); session(b, 'b').setDraft('B 的草稿')
  await Promise.all([flush(a), flush(b)])
  let saved = await stores[0].read()
  assert.deepEqual(saved.conversations.map(entry => entry.chat.draft), ['A 的草稿', 'B 的草稿'])
  await Promise.all([session(a, 'a').send('A 的问题'), session(b, 'b').send('B 的问题')])
  await Promise.all([flush(a), flush(b)])
  saved = await stores[0].read()
  assert.equal(saved.conversations[0].chat.messages.at(-1).content, '回复 A 的问题')
  assert.equal(saved.conversations[1].chat.messages.at(-1).content, '回复 B 的问题')
  assert.equal(a.getSnapshot().storageError, null); assert.equal(b.getSnapshot().storageError, null)
  assert.equal(a.getSnapshot().selectedId, 'a'); assert.equal(b.getSnapshot().selectedId, 'b')
})

test('different turns in the same conversation merge as complete user/assistant pairs', async t => {
  const { a, b, stores } = await setup(t, echo, catalogue.slice(0, 1))
  await Promise.all([a.selected.send('第一个问题'), b.selected.send('第二个问题')])
  await Promise.all([flush(a), flush(b)])
  const saved = await stores[0].read()
  assert.equal(saved.conversations.length, 1)
  const messages = saved.conversations[0].chat.messages
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant', 'user', 'assistant'])
  assert.equal(new Set(messages.map(message => message.id)).size, 4)
  assert(messages.some(message => message.content === '回复 第一个问题'))
  assert(messages.some(message => message.content === '回复 第二个问题'))
})

test('divergent drafts in the same conversation are both saved and the local draft remains selected', async t => {
  const { a, b, stores } = await setup(t, echo, catalogue.slice(0, 1))
  a.selected.setDraft('另一页的草稿'); b.selected.setDraft('当前页的草稿')
  await flush(a); await flush(b)
  const saved = await stores[0].read()
  assert.equal(saved.conversations.length, 2)
  assert.deepEqual(new Set(saved.conversations.map(entry => entry.chat.draft)), new Set(['另一页的草稿', '当前页的草稿']))
  assert.equal(b.selected.getSnapshot().draft, '当前页的草稿')
  assert.match(b.getSnapshot().conversations.find(entry => entry.id === b.getSnapshot().selectedId).title, /恢复副本/)
  b.selected.setDraft('恢复后继续编辑'); await flush(b)
  assert.equal(b.getSnapshot().storageError, null)
  assert((await stores[0].read()).conversations.some(entry => entry.chat.draft === '恢复后继续编辑'))
})

test('remote deletion does not resurrect a conversation and concurrent local edits survive in a recovery copy', async t => {
  const { a, b, stores } = await setup(t, echo, catalogue.slice(0, 1))
  b.selected.setDraft('删除前未保存的重要内容')
  await a.remove('a'); await flush(b)
  const saved = await stores[0].read()
  assert(saved.deletedIds.includes('a'))
  assert.equal(saved.conversations.length, 1)
  assert.notEqual(saved.conversations[0].id, 'a')
  assert.equal(saved.conversations[0].chat.draft, '删除前未保存的重要内容')
  b.sync(catalogue.slice(0, 1))
  assert(!b.getSnapshot().conversations.some(entry => entry.id === 'a'))
})

test('started workspaces synchronize additions, messages and deletion without switching the other page selection', async t => {
  const { a, b, stores } = await setup(t)
  let writes = 0
  for (const store of stores) {
    const write = store.write
    store.write = async (...args) => { writes++; await write(...args) }
  }
  a.start(); b.start()
  a.select('b'); b.select('a')
  const sameSession = session(b, 'a')
  await session(a, 'a').send('跨页消息'); await flush(a)
  await until(() => session(b, 'a').getSnapshot().messages.at(-1)?.content === '回复 跨页消息')
  assert.equal(session(b, 'a'), sameSession, 'sync must preserve the session object')
  assert.equal(a.getSnapshot().selectedId, 'b'); assert.equal(b.getSnapshot().selectedId, 'a')
  const added = a.create(); await flush(a)
  await until(() => Boolean(session(b, added)))
  assert.equal(b.getSnapshot().selectedId, 'a')
  await a.remove(added)
  await until(() => !session(b, added))
  assert.equal(a.getSnapshot().storageError, null); assert.equal(b.getSnapshot().storageError, null)
  await flush(a); await flush(b)
  const settledWrites = writes
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(writes, settledWrites, 'incoming storage updates must not echo into endless writes')
  b.stop()
  await session(a, 'a').send('关闭订阅后的消息'); await flush(a); await tick()
  assert.equal(sameSession.getSnapshot().messages.length, 2, 'stopped workspaces release storage listeners')
})

test('background storage updates preserve an active receiver and never start another generation', async t => {
  let release, signal, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const source = { kind: 'test', async *stream(_request, incoming) {
    calls++; signal = incoming
    yield { type: 'delta', text: '前半段' }; await gate
    yield { type: 'delta', text: '后半段' }; yield { type: 'done' }
  } }
  const { a, b, stores } = await setup(t, source)
  t.after(() => release())
  a.start(); b.start()
  const pending = session(a, 'a').send('长回复')
  await until(() => session(a, 'a').getSnapshot().messages.at(-1)?.content === '前半段')
  session(a, 'a').setDraft('当前会话接着要问的问题')
  await flush(a)
  const currentSession = a.selected, currentSnapshot = currentSession.getSnapshot()
  session(b, 'b').setDraft('另一个会话继续编辑'); await flush(b)
  await until(() => session(a, 'b').getSnapshot().draft === '另一个会话继续编辑')
  assert.equal(a.selected, currentSession)
  assert.equal(a.selected.getSnapshot(), currentSnapshot, 'another conversation update must not replay the current snapshot')
  assert.equal(a.selected.getSnapshot().draft, '当前会话接着要问的问题')
  assert.equal(signal.aborted, false); assert.equal(calls, 1)
  assert.equal(session(a, 'a').getSnapshot().phase, 'streaming')
  release(); await pending; await flush(a)
  await until(() => session(b, 'a').getSnapshot().messages.at(-1)?.content === '前半段后半段')
  assert.equal(calls, 1)
  const saved = await stores[0].read()
  assert.equal(saved.conversations.find(entry => entry.id === 'a').chat.messages.at(-1).state, 'complete')
})

test('other conversations completing, stopping and deleting never change the current conversation or draft', async t => {
  const releases = new Map(), signals = new Map()
  const source = { kind: 'test', async *stream(request, signal) {
    signals.set(request.conversationId, signal)
    yield { type: 'delta', text: `回复 ${request.conversationId}` }
    await new Promise(resolve => releases.set(request.conversationId, resolve))
    yield { type: 'done' }
  } }
  const { a, b } = await setup(t, source)
  t.after(() => { for (const release of releases.values()) release() })
  a.start(); b.start(); a.select('a'); b.select('b')
  const current = a.selected
  current.setDraft('当前输入保持不变'); await flush(a)
  const snapshot = current.getSnapshot()
  const first = b.selected.send('后台会话的问题')
  await until(() => releases.has('b'))
  await flush(b)
  await until(() => session(a, 'b').getSnapshot().messages.length === 2)
  assert.equal(a.selected, current); assert.equal(current.getSnapshot(), snapshot)
  await b.selected.stop(); releases.get('b')(); await first; await flush(b)
  await until(() => session(a, 'b').getSnapshot().messages.at(-1)?.state === 'stopped')
  assert.equal(signals.get('b').aborted, true)
  assert.equal(current.getSnapshot(), snapshot)
  const second = b.selected.send('后台会话的后续问题')
  await until(() => b.selected.getSnapshot().messages.length === 4)
  await tick(); releases.get('b')(); await second; await flush(b)
  await until(() => session(a, 'b').getSnapshot().messages.at(-1)?.state === 'complete')
  assert.equal(a.getSnapshot().selectedId, 'a'); assert.equal(current.getSnapshot(), snapshot)
  await b.remove('b')
  await until(() => !session(a, 'b'))
  assert.equal(a.selected, current); assert.equal(current.getSnapshot(), snapshot)
  assert.equal(a.getSnapshot().storageError, null)
})

test('a draft edit and a new reply in the same conversation merge without a recovery copy', async t => {
  const { a, b, stores } = await setup(t, echo, catalogue.slice(0, 1))
  b.selected.setDraft('正在准备的下一条问题')
  await a.selected.send('正在回复的问题'); await flush(a); await flush(b)
  const saved = await stores[0].read()
  assert.equal(saved.conversations.length, 1)
  assert.equal(saved.conversations[0].chat.draft, '正在准备的下一条问题')
  assert.equal(saved.conversations[0].chat.messages.at(-1).content, '回复 正在回复的问题')
})

test('a transient read error during conflict recovery does not permanently disable later saves', async t => {
  const { a, b, stores } = await setup(t)
  session(a, 'a').setDraft('已保存的新版本'); await flush(a)
  const read = stores[1].read
  let unavailable = true
  stores[1].read = async () => { if (unavailable) throw new Error('temporary storage error'); return read() }
  session(b, 'b').setDraft('等待重试的本页草稿'); await flush(b)
  assert(b.getSnapshot().storageError)
  unavailable = false
  await flush(b)
  assert.equal(b.getSnapshot().storageError, null)
  const saved = await stores[0].read()
  assert.equal(saved.conversations[0].chat.draft, '已保存的新版本')
  assert.equal(saved.conversations[1].chat.draft, '等待重试的本页草稿')
})

const pair = (id, text = id, state = 'complete') => [
  { id: `${id}:user`, role: 'user', content: id, state: 'complete' },
  { id: `${id}:assistant`, role: 'assistant', content: text, state },
]
test('concurrent pagination and new replies retain chronological order without duplicating existing pairs', async t => {
  const { stores, mergeChatWorkspaces } = await setup(t)
  const base = await stores[0].read()
  base.conversations[0].chat.messages = pair('middle')
  const local = structuredClone(base), remote = structuredClone(base)
  local.conversations[0].chat.messages.unshift(...pair('older'))
  remote.conversations[0].chat.messages.push(...pair('newest'))
  const merged = mergeChatWorkspaces(base, local, remote)
  assert.deepEqual(merged.conversations[0].chat.messages.filter(message => message.role === 'user').map(message => message.content), ['older', 'middle', 'newest'])
})

test('receivers checkpointing different prefixes of one reply retain the complete version', async t => {
  const { stores, mergeChatWorkspaces } = await setup(t)
  const base = await stores[0].read()
  base.conversations[0].chat.messages = pair('turn', '已', 'pending')
  const local = structuredClone(base), remote = structuredClone(base)
  local.conversations[0].chat.messages = pair('turn', '已生成', 'pending')
  remote.conversations[0].chat.messages = pair('turn', '已生成完成')
  const merged = mergeChatWorkspaces(base, local, remote)
  assert.equal(merged.conversations.length, 2, 'no recovery copy for equivalent stream prefixes')
  assert.deepEqual(merged.conversations[0].chat.messages, remote.conversations[0].chat.messages)
})

test('simultaneous receivers in one conversation converge without echo writes or finishing each other turns', async t => {
  const releases = new Map()
  const source = { kind: 'test', async *stream(request) {
    const question = request.messages.at(-1).content
    yield { type: 'delta', text: `回复 ${question}` }
    await new Promise(resolve => releases.set(question, resolve))
    yield { type: 'done' }
  } }
  const { a, b, stores } = await setup(t, source, catalogue.slice(0, 1))
  t.after(() => { for (const release of releases.values()) release() })
  let writes = 0
  for (const store of stores) {
    const write = store.write
    store.write = async (...args) => { writes++; await write(...args) }
  }
  const first = a.selected.send('问题一'), second = b.selected.send('问题二')
  await until(() => releases.size === 2)
  await Promise.all([flush(a), flush(b)])
  a.start(); b.start()
  await until(() => a.selected.getSnapshot().messages.length === 4 && b.selected.getSnapshot().messages.length === 4)
  await flush(a); await flush(b)
  const settled = writes
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(writes, settled)
  releases.get('问题一')(); await first; await flush(a)
  await until(() => b.selected.getSnapshot().messages.find(message => message.content === '回复 问题一')?.state === 'complete')
  assert.equal(b.selected.getSnapshot().messages.find(message => message.content === '回复 问题二').state, 'pending')
  releases.get('问题二')(); await second; await flush(b)
  const saved = await stores[0].read()
  assert.equal(saved.conversations[0].chat.messages.length, 4)
  assert(saved.conversations[0].chat.messages.every(message => message.state === 'complete'))
})
