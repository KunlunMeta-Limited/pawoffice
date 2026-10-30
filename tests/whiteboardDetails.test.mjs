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

const detailSections = [
  {
    id: 'goal', title: '只在展开后出现的详情', caption: '结构化详情', layout: 'stack', blocks: [
      { type: 'text', text: '完整内容：**加粗** 与 [链接](https://example.com)。' },
      { type: 'table', columns: [{ key: 'phase', label: '阶段' }, { key: 'result', label: '结果' }], rows: [{ phase: '审核', result: '完成' }] },
      { type: 'list', items: [{ text: '检查项', status: 'passed' }] },
      { type: 'callout', tone: 'warning', title: '提示', text: '注意范围。' },
      { type: 'diagram', source: 'flowchart LR\n  A[开始] --> B[结束]', caption: '流程图' },
    ],
  },
]

test('overview and structured detail remain independent across the business-to-scene bridge', async t => {
  const source = demo(), snapshot = await source.getSnapshot(), runtime = createRuntime({ referenceLayout: true })
  t.after(() => runtime.dispose())
  const board = schema.parse({
    ...snapshot.whiteboard, status: 'running', summary: '只在墙上显示的概览', description: '旧说明',
    detail: '# 旧版 Markdown 详情\n\n这段内容不应被渲染', detailSections,
  })
  assert.deepEqual(new Bridge(runtime).sync({ ...snapshot, whiteboard: board }), [])
  const state = runtime.readWorld().props.find(prop => prop.templateId === 'office.wall-whiteboard').state
  assert.equal(state.taskBoard.summary, board.summary)
  assert.deepEqual(state.taskBoard.detailSections, board.detailSections)
  assert(preview(state).includes(board.summary))
  assert(!preview(state).includes('只在展开后出现'))
  assert(!preview(state).includes('旧说明'))
  const expanded = read(state.taskBoard)
  assert(expanded.includes('<h2 id="whiteboard-detail-0">只在展开后出现的详情</h2>'))
  assert(expanded.includes('<strong>加粗</strong>'))
  assert(expanded.includes('result-block-table-el'))
  assert(expanded.includes('完成'))
  assert(expanded.includes('data-block-type="list"'))
  assert(expanded.includes('class="result-block-callout"'))
  assert(expanded.includes('mermaid-placeholder'))
  assert(!expanded.includes('旧版 Markdown'))
  assert(!expanded.includes('whiteboard-reader-fallback'))
  board.detailSections = [{ id: 'next', title: '更新后的详情', blocks: [{ type: 'text', text: '更新内容' }] }]
  assert.equal(preview({ taskBoard: board }), preview(state), 'changing detail must not change the overview')
})

test('legacy Markdown remains readable when no structured detail is available', () => {
  const legacy = schema.parse({ title: '旧白板', description: '原说明', steps: [] })
  assert.deepEqual(legacy.detailSections, [])
  for (const board of [legacy, { ...legacy, detail: '\n  ' }]) {
    assert(!read(board).includes('whiteboard-reader-fallback'))
    assert(!read(board).includes('>任务白板</summary>'))
    assert(read(board).includes('原说明'))
  }
  const withMarkdown = schema.parse({ ...legacy, detail: '# 旧版详情\n\n**完整内容**\n\n<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)' })
  const html = read(withMarkdown)
  assert(html.includes('旧版详情'))
  assert(html.includes('<strong>完整内容</strong>'))
  assert(!html.includes('whiteboard-reader-fallback'))
  assert(!html.includes('<script>'))
  assert(!html.includes('javascript:'))
})

test('structured details render primitives without executing Markdown HTML or unsafe links', () => {
  const board = schema.parse({
    title: '长内容', detailSections: [{
      id: 'long', title: '长详情', blocks: [
        { type: 'text', text: '完整段落。\n\n'.repeat(80) + '**详情结束**' },
        { type: 'text', text: '<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)\n\n<script>literal</script>' },
        { type: 'list', items: [{ text: '检查项', status: 'passed' }] },
      ],
    }],
  })
  const html = read(board)
  assert(html.includes('<strong>详情结束</strong>'))
  assert(html.includes('完整段落。'))
  assert(html.includes('data-block-type="list"'))
  assert(html.includes('检查项'))
  assert(!html.includes('<script>'))
  assert(!html.includes('javascript:'))
  assert(!html.includes('whiteboard-reader-fallback'))
})

test('detail sections, blocks and demo conversations respect their limits', () => {
  const section = (id = 'x') => ({ id, title: '标题', blocks: [{ type: 'divider' }] })
  assert(schema.safeParse({ detailSections: [section()] }).success)
  assert(!schema.safeParse({ detailSections: Array.from({ length: 9 }, (_, index) => section(`s${index}`)) }).success)
  assert(!schema.safeParse({ detailSections: [{ id: 'x', title: '标题', blocks: [] }] }).success)
  assert(!schema.safeParse({ detailSections: [{ id: 'x', title: '标题', blocks: Array.from({ length: 25 }, () => ({ type: 'divider' })) }] }).success)
  assert(!schema.safeParse({ detailSections: [section('字'.repeat(65))] }).success)
  assert(!schema.safeParse({ detailSections: [{ id: 'x', title: '字'.repeat(81), blocks: [{ type: 'divider' }] }] }).success)
  assert(!schema.safeParse({ detailSections: [{ ...section(), extra: true }] }).success)
  assert(!schema.safeParse({ detailSections: [{ id: 'x', title: '标题', blocks: [{ type: 'diagram', source: 'x'.repeat(8001) }] }] }).success)
  assert(schema.safeParse({ detail: '字'.repeat(16000) }).success, 'deprecated detail still parses stored snapshots')
  assert(!schema.safeParse({ detail: '字'.repeat(16001) }).success)
  for (const conversation of demo().getConversations()) assert(schema.safeParse(conversation.whiteboard).success, conversation.id)
})
