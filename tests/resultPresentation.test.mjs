import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, boardSchema, resultSchema, presentation, format, Reader, Progress, wall
before(async () => {
  server = await createTestServer()
  ;({ whiteboardTaskBoardSchema: boardSchema, officeResultSchema: resultSchema } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  presentation = await server.ssrLoadModule('/apps/web/src/results/presentation.ts')
  format = await server.ssrLoadModule('/apps/web/src/results/format.ts')
  ;({ WhiteboardReader: Reader } = await server.ssrLoadModule('/apps/web/src/components/WhiteboardReader.tsx'))
  ;({ WhiteboardProgress: Progress } = await server.ssrLoadModule('/packages/scene-office/src/whiteboard.ts'))
  ;({ renderWhiteboardPreview: wall } = await server.ssrLoadModule('/packages/scene-office/src/taskBoard.ts'))
})
after(() => server?.close())

const render = board => renderToStaticMarkup(createElement(Reader, {
  state: { taskBoard: board }, boardId: 'board', progress: new Progress({ reduceMotion: true }), onClose() {},
}))

test('backend timestamps are formatted to seconds with timezone conversion and legacy support', () => {
  assert.equal(format.formatResultTimestamp('2026-10-28T17:32:44.6616512+08:00', 'Asia/Shanghai'), '2026-10-28 17:32:44')
  assert.equal(format.formatResultTimestamp('2026-10-28T09:32:44.661Z', 'Asia/Shanghai'), '2026-10-28 17:32:44')
  assert.equal(format.formatResultTimestamp('2026-10-28T23:32:44-05:00', 'Asia/Shanghai'), '2026-10-29 12:32:44')
  assert.equal(format.formatResultTimestamp('2026-10-28T16:00:00Z', 'Asia/Shanghai'), '2026-10-29 00:00:00')
  assert.equal(format.formatResultTimestamp('2024-06-20 14:30'), '2024-06-20 14:30:00')
  assert.equal(format.formatResultTimestamp('2024-06-20T14:30:15.123'), '2024-06-20 14:30:15')
  assert.equal(format.formatResultTimestamp('2024-06-20'), '2024-06-20')
  assert.equal(format.formatResultTimestamp(''), '')
  assert.equal(format.formatResultTimestamp('invalid date'), '—')
})

test('the header keeps the original event timestamp while displaying a readable date', () => {
  const source = '2026-10-28T17:32:44.6616512+08:00'
  const board = boardSchema.parse({ title: '时间格式验证', result: { updatedAt: source } })
  const html = render(board)
  assert(html.includes(`dateTime="${source}"`))
  assert(html.includes(`>${format.formatResultTimestamp(source)}</time>`))
  assert(!html.includes(`>${source}</time>`))
  const fallback = render(boardSchema.parse({ title: '仅产出时间', result: { producedAt: source } }))
  assert(fallback.includes('产出时间（本地时区）'))
  const empty = render(boardSchema.parse({ title: '尚无时间' }))
  assert(!empty.includes('<time'))
})

test('absence of a result distinguishes pending, producing, blocked, failed and missing delivery', () => {
  const empty = resultSchema.parse({})
  const expected = { queued: 'empty', running: 'producing', blocked: 'blocked', failed: 'failed', completed: 'missing' }
  for (const [status, key] of Object.entries(expected)) {
    const board = boardSchema.parse({ title: '任务', status, steps: [{ id: 's', title: '阶段', progress: 100 }] })
    assert.equal(presentation.resultPresentation(board, empty).key, key)
  }
})

test('result state is independent of execution, check success and progress', () => {
  for (const taskStatus of ['queued', 'running', 'completed', 'failed']) {
    for (const resultStatus of ['draft', 'ready', 'verified', 'rejected']) {
      const result = resultSchema.parse({ status: resultStatus, summary: '阶段内容', checks: [{ id: 'c', label: '检查', status: 'passed' }] })
      const board = boardSchema.parse({ title: '任务', status: taskStatus, result })
      assert.equal(presentation.resultPresentation(board, result).key, resultStatus)
      const html = render(board)
      assert(html.includes(`data-result-status="${resultStatus}"`))
      assert(html.includes(`任务 · ${presentation.boardStatusLabels[taskStatus]}`))
    }
  }
  const deliveredWithoutBody = resultSchema.parse({ status: 'ready' })
  assert.equal(presentation.resultPresentation(boardSchema.parse({}), deliveredWithoutBody).key, 'ready')
})

test('new-only payloads are reachable through the production reader and wall entry', () => {
  const inputs = [
    { sections: [{ kind: 'documents', id: 'd', title: '交付文档', items: [{ id: 'doc', title: '仅新结构文档' }] }] },
    { tasks: [{ id: 't', title: '仅任务明细' }] },
    { versions: [{ id: 'v', version: 'v2' }] },
    { risks: [{ id: 'r', title: '仅风险记录' }] },
    { next: ['补充验证'] },
    { note: '交付说明' },
  ]
  for (const input of inputs) {
    const result = resultSchema.parse(input)
    assert(format.resultHasContent(result))
    const board = boardSchema.parse({ title: '任务', status: 'completed', result })
    const html = render(board)
    assert(html.includes('result-workspace'))
    assert.equal((html.match(/role="tablist"/g) ?? []).length, 1)
    assert.equal((html.match(/role="tab"/g) ?? []).length, 3)
    assert(wall({ taskBoard: board }).includes('查看成果'))
  }
  assert(!format.resultHasContent(resultSchema.parse({})))
})

test('attention includes failed checks, nested checks, unresolved risks and blocked tasks', () => {
  const result = resultSchema.parse({
    checks: [{ id: 'c', label: '验收未通过', status: 'failed' }, { id: 'ok', label: '已通过', status: 'passed' }],
    sections: [{ kind: 'tests', id: 'tests', title: '测试', checks: [{ id: 'nested', label: '补充回归', status: 'pending' }] }],
    risks: [{ id: 'open', title: '高风险', level: 'high' }, { id: 'closed', title: '已解决', status: 'closed' }],
    tasks: [{ id: 'blocked', title: '发布受阻', status: 'blocked' }],
  })
  const attention = presentation.resultAttention(result)
  assert.equal(attention.length, 4)
  assert.deepEqual(attention.slice(0, 2).map(item => item.danger), [true, true])
  const html = render(boardSchema.parse({ title: '任务', result }))
  assert(html.includes('需要关注'))
  assert(html.includes('全部待处理事项'))
  assert(html.includes('补充回归'))
})

test('placeholder previews and captions do not promise unavailable actions', () => {
  const board = boardSchema.parse({ title: '任务', result: { sections: [
    { kind: 'gallery', id: 'g', title: '页面', caption: '查看全部 →', items: [{ id: 'i', title: '设计' }] },
    { kind: 'files', id: 'f', title: '附件', caption: '上传文件 →', items: [{ id: 'i', name: '文件' }] },
  ] } })
  const html = render(board)
  assert(html.includes('暂无预览'))
  assert(!html.includes('result-workspace-wireframe'))
  assert(!html.includes('查看全部 →'))
  assert(!html.includes('上传文件 →'))
})

test('duplicate document listings merge without losing metadata or changing export data', () => {
  const result = resultSchema.parse({
    artifacts: [{ id: 'prd', title: '登录模块 PRD', content: '正文' }],
    sections: [{ kind: 'documents', id: 'docs', title: '产品文档', items: [
      { id: 'prd-doc', title: '登录模块 PRD', version: 'v1.2', at: '2026-10-28', status: 'active' },
      { id: 'acceptance', title: '验收标准', version: 'v1.0' },
    ] }],
  })
  const before = JSON.stringify(result)
  const layout = presentation.resultDeliveryLayout(result)
  assert.deepEqual(layout.sections[0].items.map(item => item.id), ['acceptance'])
  assert.equal(layout.documentMeta.get('prd').version, 'v1.2')
  assert.equal(layout.documentMeta.get('prd').status, 'active')
  assert.equal(JSON.stringify(result), before)
  const html = render(boardSchema.parse({ title: '任务', result }))
  assert(html.includes('v1.2 · 2026-10-28 · 进行中'))
  assert(html.includes('验收标准'))
  assert(format.resultReport(result).includes('正文'))
})

test('ambiguous document titles remain separate and empty duplicate groups are removed', () => {
  const source = { artifacts: [{ id: 'a', title: '文档' }], sections: [{ kind: 'documents', id: 'docs', title: '文档清单', items: [{ id: 'd', title: '文档' }] }] }
  assert.equal(presentation.resultDeliveryLayout(resultSchema.parse(source)).sections.length, 0)
  const duplicate = resultSchema.parse({ ...source, artifacts: [{ id: 'a', title: '文档' }, { id: 'b', title: '文档' }] })
  assert.equal(presentation.resultDeliveryLayout(duplicate).documentMeta.size, 0)
  assert.equal(presentation.resultDeliveryLayout(duplicate).sections[0].items.length, 1)
})
