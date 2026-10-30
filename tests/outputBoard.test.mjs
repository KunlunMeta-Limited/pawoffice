import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, ui, snapshots, PushSource, createRuntime, createViews, Progress, preview, Reader, demo
before(async () => {
  server = await createTestServer()
  ui = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts')
  snapshots = await server.ssrLoadModule('/packages/protocol/src/office-integration.ts')
  ;({ PushOfficeDataSource: PushSource } = await server.ssrLoadModule('/apps/web/src/dashboard/PushOfficeDataSource.ts'))
  ;({ createOfficeRuntime: createRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ createReferenceOfficePropViews: createViews } = await server.ssrLoadModule('/packages/scene-office/src/pixi/views/referenceOffice.ts'))
  ;({ WhiteboardProgress: Progress } = await server.ssrLoadModule('/packages/scene-office/src/whiteboard.ts'))
  ;({ renderWhiteboardPreview: preview } = await server.ssrLoadModule('/packages/scene-office/src/taskBoard.ts'))
  ;({ WhiteboardReader: Reader } = await server.ssrLoadModule('/apps/web/src/components/WhiteboardReader.tsx'))
  ;({ createWhiteboardDemoSource: demo } = await server.ssrLoadModule('/apps/web/src/dashboard/whiteboardDemo.ts'))
})
after(() => server?.close())
const output = () => ({ title: '地图采集', overviewHtml: '<div style="font-size:40px">42 个地点</div>', detail: { format: 'html', html: '<h1>地图报表</h1>' } })

test('office output remains separate from the original conversation schema and survives selection, updates and removal', async () => {
  const snapshot = { schemaVersion: '1.0', seq: 1, workspace: { id: 'test', name: '验收' }, outputBoard: output(),
    conversations: [{ id: 'a', title: 'A', whiteboard: { title: '目标 A' } }, { id: 'b', title: 'B', whiteboard: { title: '目标 B' } }] }
  const source = new PushSource(snapshots.officeSnapshotSchema.parse(snapshot))
  assert.deepEqual((await source.getSnapshot()).outputBoard, output())
  source.selectConversation('b')
  assert.equal((await source.getSnapshot()).whiteboard.title, '目标 B')
  assert.deepEqual((await source.getSnapshot()).outputBoard, output())
  snapshot.seq++; snapshot.outputBoard.overviewHtml = '<p>99 个地点</p>'
  source.update(snapshots.officeSnapshotSchema.parse(snapshot))
  assert.equal((await source.getSnapshot()).outputBoard.overviewHtml, '<p>99 个地点</p>')
  delete snapshot.outputBoard; snapshot.seq++
  source.update(snapshots.officeSnapshotSchema.parse(snapshot))
  assert.equal((await source.getSnapshot()).outputBoard, undefined)
  assert(!ui.whiteboardTaskBoardSchema.safeParse({ title: '协作', overviewHtml: '<p>不属于这里</p>' }).success)
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', 'file:///test', 'not-a-url', '']) {
    assert(!ui.outputBoardSchema.safeParse({ ...output(), detail: { format: 'url', url } }).success)
  }
  assert(ui.outputBoardSchema.safeParse({ ...output(), detail: { format: 'url', url: 'https://example.com/report' } }).success)
})

test('one native HTMLText switches to arbitrary result HTML then restores the original collaboration rendering without mutating it', t => {
  const runtime = createRuntime({ referenceLayout: true })
  t.after(() => runtime.dispose())
  const prop = runtime.readWorld().props.find(item => item.id === 'whiteboard-1'), template = runtime.template(prop.templateId)
  const state = structuredClone(prop.state), progress = new Progress({ reduceMotion: true })
  let mode = 'collaboration', enabled = true, board = output()
  const view = createViews(progress, { read: () => ({ mode, outputBoard: board, enabled }), select: value => { mode = value } }).create(prop, template)
  t.after(() => view.roots.forEach(root => root.destroy({ children: true })))
  view.update(prop, template, [])
  const root = view.roots[0], content = root.children[0], labels = root.children[1]
  const original = content.text
  assert.equal(content.constructor.name, 'HTMLText')
  assert.equal(original, preview(state))
  assert.equal(content.x, 71); assert.equal(content.y, -157)
  const stopped = { stopPropagation() { this.stopped = true } }
  labels.children[1].emit('pointertap', stopped)
  assert(stopped.stopped)
  view.updateFrame(.3)
  assert(content.text.includes(board.overviewHtml))
  assert(content.text.includes('background:transparent'))
  board = { ...board, overviewHtml: '<p>99 个地点</p>' }
  view.updateFrame(.3)
  assert(content.text.includes('99 个地点'))
  labels.children[0].emit('pointertap', stopped); view.updateFrame(.3)
  assert.equal(content.text, original)
  assert.deepEqual(prop.state, state)
  enabled = false; view.updateFrame(.3)
  assert.equal(labels.visible, false)
})

test('the original reader still renders Markdown and legacy fallback; only result mode embeds an isolated webpage', () => {
  const state = { taskBoard: ui.whiteboardTaskBoardSchema.parse({ title: '协作', detail: '# 原来的详情\n\n**保留 Markdown**' }) }
  const props = { state, boardId: 'board', progress: new Progress(), onClose() {} }
  const collaboration = renderToStaticMarkup(createElement(Reader, props))
  assert.equal(collaboration, renderToStaticMarkup(createElement(Reader, { ...props, mode: 'collaboration', outputBoard: output() })))
  assert(collaboration.includes('<h1>原来的详情</h1>'))
  assert(!collaboration.includes('<iframe'))
  const results = renderToStaticMarkup(createElement(Reader, { ...props, mode: 'output', outputBoard: output() }))
  assert(results.includes('sandbox="allow-scripts"'))
  assert(!results.includes('<h1>原来的详情</h1>'))
  assert(!results.includes('allow-same-origin'))
  const empty = renderToStaticMarkup(createElement(Reader, { ...props, mode: 'output' }))
  assert(empty.includes('等待结果更新'))
})

test('the opt-in demo supplies independent templates without changing original collaboration details', async () => {
  const source = demo(), snapshot = await source.getSnapshot()
  assert(ui.outputBoardSchema.safeParse(snapshot.outputBoard).success)
  for (const text of ['今日工作成果', '商品销量', '328', '采集信息', '1,286', '任务完成', '18', '/24', '商品信息 860 条 · 竞品信息 426 条']) {
    assert(snapshot.outputBoard.overviewHtml.includes(text), text)
  }
  assert(!snapshot.outputBoard.overviewHtml.includes('{{'))
  assert(snapshot.whiteboard.detail.includes('详情结束'))
  source.selectConversation('short-detail')
  assert.deepEqual((await source.getSnapshot()).outputBoard, snapshot.outputBoard)
  source.selectConversation('new-local-draft')
  assert.deepEqual((await source.getSnapshot()).outputBoard, snapshot.outputBoard)
})
