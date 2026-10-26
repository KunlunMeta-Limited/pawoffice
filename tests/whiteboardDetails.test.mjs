import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, schema, preview, WhiteboardReader, WhiteboardProgress, createRuntime, Bridge, demo
before(async () => {
  server = await createTestServer()
  ;({ whiteboardTaskBoardSchema: schema } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  ;({ renderWhiteboardPreview: preview } = await server.ssrLoadModule('/packages/scene-office/src/taskBoard.ts'))
  ;({ WhiteboardReader } = await server.ssrLoadModule('/apps/web/src/components/WhiteboardReader.tsx'))
  ;({ WhiteboardProgress } = await server.ssrLoadModule('/packages/scene-office/src/whiteboard.ts'))
  ;({ createOfficeRuntime: createRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ DashboardSceneBridge: Bridge } = await server.ssrLoadModule('/apps/web/src/dashboard/sceneBridge.ts'))
  ;({ createWhiteboardDemoSource: demo } = await server.ssrLoadModule('/apps/web/src/dashboard/whiteboardDemo.ts'))
})
after(() => server?.close())

const read = board => renderToStaticMarkup(createElement(WhiteboardReader, {
  state: { taskBoard: board }, boardId: 'whiteboard-1', progress: new WhiteboardProgress({ reduceMotion: true }), onClose() {},
}))

test('overview and detail remain independent across the business-to-scene bridge', async t => {
  const source = demo(), snapshot = await source.getSnapshot(), runtime = createRuntime({ referenceLayout: true })
  t.after(() => runtime.dispose())
  const board = schema.parse({ ...snapshot.whiteboard, summary: '只在墙上显示的概览', description: '旧说明', detail: '# 只在展开后出现的详情\n\n完整内容' })
  assert.deepEqual(new Bridge(runtime).sync({ ...snapshot, whiteboard: board }), [])
  const state = runtime.readWorld().props.find(prop => prop.templateId === 'office.wall-whiteboard').state
  assert.equal(state.taskBoard.summary, board.summary)
  assert.equal(state.taskBoard.detail, board.detail)
  assert(preview(state).includes(board.summary))
  assert(!preview(state).includes('只在展开后出现'))
  assert(!preview(state).includes('旧说明'))
  const expanded = read(state.taskBoard)
  assert(expanded.includes('<h1>只在展开后出现的详情</h1>'))
  assert(!expanded.includes(board.summary))
  board.detail = '# 更新后的详情'
  assert.equal(preview({ taskBoard: board }), preview(state), 'changing detail must not change the overview')
})

test('legacy and whitespace-only details fall back to the original board', () => {
  const legacy = schema.parse({ title: '旧白板', description: '原说明', steps: [] })
  assert.equal(legacy.summary, '')
  assert.equal(legacy.detail, '')
  for (const board of [legacy, { ...legacy, summary: '  ', detail: '\n  ' }]) {
    assert(preview({ taskBoard: board }).includes('原说明'))
    assert(read(board).includes('whiteboard-reader-fallback'))
    assert(read(board).includes('原说明'))
  }
})

test('long details retain the ending, tables, lists and literal code without executing HTML', () => {
  const detail = '# 长详情\n\n' + '完整段落。\n\n'.repeat(100) + '| 阶段 | 结果 |\n| --- | --- |\n| 审核 | 完成 |\n\n- 检查项\n\n```html\n<script>literal</script>\n```\n\n<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)\n\n**详情结束**'
  const html = read(schema.parse({ title: '长内容', detail }))
  assert(html.includes('<strong>详情结束</strong>'))
  assert(html.includes('<td>完成</td>'))
  assert(html.includes('<li>检查项</li>'))
  assert(html.includes('&lt;script&gt;literal&lt;/script&gt;'))
  assert(!html.includes('<script>'))
  assert(!html.includes('javascript:'))
  assert(!html.includes('whiteboard-reader-fallback'))
})

test('new fields enforce their limits and demo conversations all pass protocol validation', () => {
  assert(schema.safeParse({ title: '范围', summary: '字'.repeat(300), detail: '字'.repeat(16000) }).success)
  assert(!schema.safeParse({ summary: '字'.repeat(301) }).success)
  assert(!schema.safeParse({ detail: '字'.repeat(16001) }).success)
  for (const conversation of demo().getConversations()) assert(schema.safeParse(conversation.whiteboard).success, conversation.id)
})
