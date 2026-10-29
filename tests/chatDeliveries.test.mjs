import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, ui, grouping, history, persistence, resources, ChatSession, Entries, Workspace, OfficeState, integration, fixture
before(async () => {
  server = await createTestServer()
  ui = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts')
  integration = await server.ssrLoadModule('/packages/protocol/src/office-integration.ts')
  grouping = await server.ssrLoadModule('/apps/web/src/results/chatDeliveries.ts')
  history = await server.ssrLoadModule('/apps/web/src/chat/history.ts')
  persistence = await server.ssrLoadModule('/apps/web/src/chat/persistence.ts')
  resources = await server.ssrLoadModule('/apps/web/src/results/resources.ts')
  ;({ ChatSession } = await server.ssrLoadModule('/apps/web/src/chat/ChatSession.ts'))
  ;({ ChatDeliveries: Entries } = await server.ssrLoadModule('/apps/web/src/components/ChatDeliveries.tsx'))
  ;({ ResultWorkspace: Workspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  ;({ OfficeState } = await server.ssrLoadModule('/server/src/officeState.ts'))
  fixture = JSON.parse(await readFile(new URL('../integration/fixtures/result-deliveries.json', import.meta.url), 'utf8'))
})
after(() => server?.close())

test('turn association is optional, bounded and supports zero or many deliveries in backend order', () => {
  const records = fixture.deliveries.map((delivery, index) => ui.resultDeliverySchema.parse({ ...delivery, turnId: index ? 'turn:文档' : '' }))
  assert.equal(ui.resultDeliverySchema.parse(fixture.deliveries[0]).turnId, '')
  const grouped = grouping.deliveriesByTurn([...records].reverse())
  assert.deepEqual([...grouped.keys()], ['turn:文档'])
  assert.deepEqual(grouped.get('turn:文档').map(item => item.id), ['delivery-2', 'delivery-3'])
  assert.equal(grouped.get('unrelated'), undefined)
  assert.equal(ui.resultDeliverySchema.safeParse({ ...fixture.deliveries[0], turnId: 'x'.repeat(101) }).success, false)
  assert.equal(ui.resultDeliverySchema.safeParse({ ...fixture.deliveries[0], turnId: null }).success, false)
})

test('sending and persisting messages preserves the actual backend turn identity', async t => {
  let request, stored
  const session = new ChatSession('team', { kind: 'test', async *stream(value) { request = value; yield { type: 'delta', text: '已交付' }; yield { type: 'done' } } }, {
    conversationId: 'conversation', persistence: { read: async () => undefined, write: async value => { stored = value } },
  })
  t.after(() => session.dispose())
  await session.ready
  await session.send('生成文档')
  await session.flush()
  assert.deepEqual(session.getSnapshot().messages.map(item => item.turnId), [request.turnId, request.turnId])
  assert.deepEqual(persistence.chatArchiveSchema.parse(stored).messages.map(item => item.turnId), [request.turnId, request.turnId])
  const restored = new ChatSession('team', { kind: 'test', async *stream() {} }, { persistence: { read: async () => stored, write: async () => {} } })
  t.after(() => restored.dispose())
  await restored.ready
  assert.equal(restored.getSnapshot().messages[1].turnId, request.turnId)
})

test('history recovery and pagination retain explicit identities without parsing legacy message ids', () => {
  const turns = [{ id: 'turn:a:assistant', user: '需求', assistant: '回复', state: 'complete', error: '' }]
  const once = history.mergeHistory([], turns)
  const twice = history.mergeHistory(once, turns)
  assert.equal(twice.length, 2)
  assert(twice.every(item => item.turnId === 'turn:a:assistant'))
  const older = history.mergeHistory(twice, [{ ...turns[0], id: 'older' }], true)
  assert.deepEqual(older.map(item => item.turnId), ['older', 'older', 'turn:a:assistant', 'turn:a:assistant'])
  const legacy = persistence.chatArchiveSchema.parse({ version: 1, teamId: 'team', conversationId: 'chat', draft: '', messages: [
    { id: 'turn:user', role: 'user', content: '旧需求', state: 'complete' },
    { id: 'turn:assistant', role: 'assistant', content: '旧回复', state: 'complete' },
  ] })
  assert.equal(legacy.messages[1].turnId, undefined)
})

test('delivery entries display actual metadata and keep remote unknowns explicit', () => {
  const inline = ui.resultDeliverySchema.parse({ ...fixture.deliveries[1], title: '<script>alert(1)</script>' })
  const remote = ui.resultDeliverySchema.parse({ id: 'remote', sequence: 4, createdAt: '2026-10-28T15:00:00+08:00', snapshotUrl: 'https://backend.example/remote' })
  const html = renderToStaticMarkup(createElement(Entries, { deliveries: [inline, remote], onOpen: () => true }))
  assert(html.includes('2 项产物'))
  assert(html.includes('已交付'))
  assert(html.includes('产物详情待查看'))
  assert(!html.includes('0 项产物'))
  assert(!html.includes('<script>'))
  assert(html.includes('&lt;script&gt;'))
  const empty = renderToStaticMarkup(createElement(Entries, { deliveries: [] }))
  assert.equal(empty, '')
})

test('a delivery entry opens its exact snapshot, and an unknown target never opens current results', () => {
  const board = ui.whiteboardTaskBoardSchema.parse(fixture)
  const historical = renderToStaticMarkup(createElement(Workspace, { board, result: board.result, initialDeliveryId: 'delivery-2' }))
  assert(historical.includes('历史交付 · 第 2 轮'))
  assert(historical.includes('v1.0'))
  assert(!historical.includes('>验收报告<'))
  const missing = renderToStaticMarkup(createElement(Workspace, { board, result: board.result, initialDeliveryId: 'no-such-delivery' }))
  assert(missing.includes('该次交付不在当前会话'))
  assert(!missing.includes('class="result-workspace"'))
})

test('the receiver prevents reassignment to another chat turn and external history verifies the association', async t => {
  const board = structuredClone(fixture)
  board.deliveries[1].turnId = 'turn-2'
  const snapshot = (value, seq) => integration.officeSnapshotSchema.parse({ schemaVersion: '1.0', seq, workspace: { id: 'team', name: '版本测试' },
    conversations: [{ id: 'conversation', title: '会话', whiteboard: value }] })
  const state = new OfficeState()
  state.apply([snapshot(board, 1)])
  const changed = structuredClone(board)
  changed.deliveries[1].turnId = 'wrong-turn'
  assert.throws(() => state.apply([snapshot(changed, 2)]), error => error.reasonCode === 'RESULT_HISTORY_CONFLICT')
  const index = ui.resultDeliverySchema.parse({ id: 'delivery-2', sequence: 2, turnId: 'turn-2', createdAt: fixture.deliveries[1].createdAt, snapshotUrl: 'https://backend.example/2' })
  t.mock.method(globalThis, 'fetch', async () => Response.json(changed.deliveries[1]))
  await assert.rejects(resources.readDeliverySnapshot(index, new AbortController().signal), /轮次不匹配/)
})
