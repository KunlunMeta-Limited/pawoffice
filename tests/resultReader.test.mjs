import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, schema, resultSchema, emptyResult, ResultReader, WhiteboardReader, WhiteboardProgress
let createResultDemo, createResultDemoBoard, CommerceOfficeDataSource, format, renderBoard, WhiteboardBoardView, preview

before(async () => {
  server = await createTestServer()
  ;({ whiteboardTaskBoardSchema: schema, officeResultSchema: resultSchema, emptyResult } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  ;({ ResultReader } = await server.ssrLoadModule('/apps/web/src/components/ResultReader.tsx'))
  ;({ WhiteboardReader } = await server.ssrLoadModule('/apps/web/src/components/WhiteboardReader.tsx'))
  ;({ WhiteboardBoardView } = await server.ssrLoadModule('/apps/web/src/components/WhiteboardBoardView.tsx'))
  ;({ WhiteboardProgress } = await server.ssrLoadModule('/packages/scene-office/src/whiteboard.ts'))
  ;({ createResultDemo, createResultDemoBoard } = await server.ssrLoadModule('/apps/web/src/dashboard/resultDemo.ts'))
  ;({ CommerceOfficeDataSource } = await server.ssrLoadModule('/apps/web/src/dashboard/CommerceOfficeDataSource.ts'))
  ;({ renderWhiteboardContent: renderBoard } = await server.ssrLoadModule('/packages/scene-office/src/taskBoard.ts'))
  preview = await server.ssrLoadModule('/apps/web/src/dev/resultPreviewData.ts')
  format = await server.ssrLoadModule('/apps/web/src/results/format.ts')
})
after(() => server?.close())

const reader = board => renderToStaticMarkup(createElement(WhiteboardReader, {
  state: { taskBoard: schema.parse(board) }, boardId: 'whiteboard-1', progress: new WhiteboardProgress({ reduceMotion: true }), onClose() {},
}))
const resultReader = result => renderToStaticMarkup(createElement(ResultReader, { result }))

test('result data is optional, null-free and bounded on every whiteboard', () => {
  const empty = emptyResult()
  assert.equal(empty.template, 'result-v1'); assert.equal(empty.status, 'draft'); assert.deepEqual(empty.metrics, [])
  assert.deepEqual(schema.parse({}).result, empty)
  assert.equal(resultSchema.safeParse({ summary: '结论' }).success, true)
  assert.equal(resultSchema.safeParse({ unknown: 'x' }).success, false)
  assert.equal(resultSchema.safeParse({ summary: null }).success, false)
  assert.equal(schema.safeParse({ result: { metrics: Array.from({ length: 13 }, (_, index) => ({ id: `metric-${index}`, label: '指标', value: '1' })) } }).success, false)
  assert.equal(schema.safeParse({ result: { metrics: [{ id: 'metric', label: '指标', value: '1', tone: 'loud' }] } }).success, false)
  assert.equal(schema.safeParse({ result: { artifacts: [{ id: 'file', title: '文件', url: 'javascript:alert(1)' }] } }).success, false)
  assert.equal(schema.safeParse({ result: { checks: [{ id: 'check', label: '检查', status: 'maybe' }] } }).success, false)
})

test('metric kind, emphasis, target and progress are optional structured fields', () => {
  const parsed = resultSchema.parse({ metrics: [{ id: 'metric', label: '指标', value: '1' }], metricsTitle: '审核结论', metricsCaption: '本轮审核' })
  assert.equal(parsed.metrics[0].kind, 'auto')
  assert.equal(parsed.metrics[0].emphasis, 'normal')
  assert.equal(parsed.metrics[0].target, '')
  assert.equal(parsed.metrics[0].targetStatus, '')
  assert.equal(parsed.metrics[0].progress, undefined)
  assert.equal(parsed.metricsTitle, '审核结论')
  assert.equal(parsed.metricsCaption, '本轮审核')
  const structured = resultSchema.parse({ metrics: [{ id: 'sample', label: '样本', value: '18', unit: '位', kind: 'target', target: '20 位', targetStatus: 'at-risk', progress: 90, emphasis: 'primary' }] })
  assert.equal(structured.metrics[0].kind, 'target')
  assert.equal(structured.metrics[0].targetStatus, 'at-risk')
  assert.equal(structured.metrics[0].progress, 90)
  for (const metric of [{ kind: 'chart' }, { emphasis: 'huge' }, { targetStatus: 'unknown' }, { progress: 101 }, { progress: -1 }]) {
    assert.equal(resultSchema.safeParse({ metrics: [{ id: 'metric', label: '指标', value: '1', ...metric }] }).success, false, JSON.stringify(metric))
  }
})

const metricResult = (metrics, extra = {}) => resultSchema.parse({ summary: '本轮成果', metrics, ...extra })

test('metric data chooses the card form instead of forcing every metric into a comparison', () => {
  const comparison = resultReader(metricResult([
    { id: 'orders', label: '订单', value: '14', unit: '单', previous: '9 单', change: '+5 单', emphasis: 'primary' },
  ]))
  assert(comparison.includes('result-kind-comparison'))
  assert(comparison.includes('data-emphasis="primary"'))
  assert(comparison.includes('data-count="1"'))
  assert(comparison.includes('首轮 9 单'))
  assert(comparison.includes('+5 单'))

  const value = resultReader(metricResult([{ id: 'delivered', label: '交付', value: '3', unit: '篇', kind: 'value' }]))
  assert(value.includes('result-kind-value'))
  assert(!value.includes('首轮'))

  const status = resultReader(metricResult([{ id: 'audit', label: '审核结果', value: '通过', kind: 'status', tone: 'positive' }]))
  assert(status.includes('result-kind-status'))
  assert(status.includes('result-metric-state'))
  assert(status.includes('通过'))
  assert(!status.includes('result-metric-value'))

  const target = resultReader(metricResult([{ id: 'samples', label: '完成访谈', value: '18', unit: '位', kind: 'target', target: '20 位', targetStatus: 'at-risk', progress: 90 }]))
  assert(target.includes('result-kind-target'))
  assert(target.includes('有风险'))
  assert(target.includes('目标 20 位'))
  assert(target.includes('result-target-track'))
  assert(target.includes('aria-valuenow="90"'))

  const text = resultReader(metricResult([{ id: 'price', label: '价格敏感度', value: '高于预期', kind: 'text' }]))
  assert(text.includes('result-kind-text'))
  assert(text.includes('result-metric-text'))
  assert(text.includes('价格敏感度'))
  assert(text.includes('高于预期'))
})

test('the metric layout and heading follow the number and structure of metrics', () => {
  for (const [count, expected] of [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']]) {
    const metrics = Array.from({ length: count }, (_, index) => ({ id: `metric-${index}`, label: `指标${index}`, value: String(index), kind: 'value' }))
    const html = resultReader(metricResult(metrics))
    assert(html.includes(`data-count="${expected}"`), `${count} metrics`)
  }
  const custom = resultReader(metricResult([{ id: 'status', label: '审核结果', value: '通过', kind: 'status', tone: 'positive' }], { metricsTitle: '审核结论', metricsCaption: '本轮审核' }))
  assert(custom.includes('审核结论'))
  assert(custom.includes('本轮审核'))
  assert(!custom.includes('首轮观察 → 更新后观察'))
  const noMetrics = resultReader(resultSchema.parse({ summary: '文案已交付', verdict: '等待运营确认', artifacts: [{ id: 'doc', title: '文案', content: '内容' }] }))
  assert(!noMetrics.includes('result-metrics'))
  assert(!noMetrics.includes('关键指标'))
  assert(noMetrics.includes('交付物'))
})

test('the preview demo is driven by four structured task datasets', () => {
  assert.equal(preview.resultPreviewCases.length, 4)
  for (const item of preview.resultPreviewCases) {
    assert(resultSchema.safeParse(item.result).success, item.id)
    assert(schema.safeParse(item.board).success, item.id)
    assert(item.result.title.length > 0)
  }
  const content = preview.resultPreviewCases.find(item => item.id === 'content')
  assert.equal(content.result.metrics.length, 0, 'content task has no metrics')
  assert(content.result.artifacts.length > 0)
  const audit = preview.resultPreviewCases.find(item => item.id === 'audit')
  assert(audit.result.metrics.some(metric => metric.kind === 'status'))
  assert(audit.result.metrics.some(metric => metric.kind === 'target'))
  const research = preview.resultPreviewCases.find(item => item.id === 'research')
  assert(research.result.metrics.some(metric => metric.kind === 'text'))
  assert.equal(research.result.status, 'draft')
  assert(preview.findResultPreviewCase('missing').id === 'operations')
})

test('the result page leads with the conclusion and renders metrics, artifacts, acceptance and next steps', () => {
  const html = resultReader(createResultDemo('verified'))
  for (const text of ['已验证', '尺寸说明补齐后', '10,000', '首轮 9 单', '订单', '+5 单', '商品页改动清单', '交付物',
    '验收清单', '3/5 通过', '过程决策', '补充尺寸说明，保持 79 元', '下一步', '本地模拟数据', '验收通过']) {
    assert(html.includes(text), text)
  }
  assert(html.includes('result-conclusion'))
  assert(!html.includes('<script'))
  const rejected = resultReader(createResultDemo('rejected'))
  assert(rejected.includes('未通过'))
  assert(!rejected.includes('验收通过</span>'), 'only verified results carry the seal')
  assert(rejected.includes('data-status="rejected"'))
})

test('a completed goal with a result opens the reader on the result view and keeps the board one tab away', () => {
  const html = reader(createResultDemoBoard('verified'))
  assert(html.includes('role="tablist"'))
  assert(html.includes('is-result'))
  assert(html.includes('result-conclusion'))
  assert(html.includes('电脑支架首轮经营复盘'))
  assert(!html.includes('whiteboard-reader-fallback'))
  const boardTab = html.indexOf('任务白板')
  assert(boardTab > 0)
  assert(html.includes('aria-selected="true"'))
})

test('a running or draft goal keeps the board view while the result stays available', () => {
  const html = reader(createResultDemoBoard('draft'))
  assert(html.includes('执行详情'))
  assert(!html.includes('result-conclusion'))
  assert(html.includes('role="tablist"'))
  const legacy = reader({ template: 'task-board-v1', title: '旧白板', status: 'running', description: '原有说明', steps: [] })
  assert(legacy.includes('原有说明'))
  assert(legacy.includes('whiteboard-reader-fallback'))
  assert(!legacy.includes('role="tablist"'), 'boards without a result do not grow a result tab')
})

test('detail fallback behaviour is unchanged when a result exists but the board has a detail document', () => {
  const board = { ...createResultDemoBoard('draft'), detail: '# 执行详情\n\n完整内容' }
  const html = reader(board)
  assert(html.includes('<h1>执行详情</h1>'))
  assert(!html.includes('result-conclusion'))
})

test('the result can be exported as a portable Markdown report and summary', () => {
  const result = createResultDemo('verified')
  assert(format.resultHasContent(result))
  assert(!format.resultHasContent(emptyResult()))
  const report = format.resultReport(result)
  assert(report.startsWith('# 电脑支架首轮经营复盘'))
  assert(report.includes('## 关键指标'))
  assert(report.includes('| 订单 | 9 单 | 14 单 | +5 单 |'))
  assert(report.includes('- [x] 标题、主图、详情与价格完成复核'))
  assert(report.includes('## 下一步'))
  assert(format.resultSummaryText(result).includes('订单'))
  assert.equal(format.resultFileBase(result), '电脑支架首轮经营复盘')
  const mixed = resultSchema.parse({ summary: '审核完成', metricsTitle: '审核结论', metricsCaption: '本轮审核', metrics: [
    { id: 'result', label: '审核结果', value: '通过', kind: 'status', tone: 'positive' },
    { id: 'rate', label: '通过率', value: '86', unit: '%', kind: 'target', target: '90%', targetStatus: 'at-risk', progress: 86 },
  ] })
  const mixedReport = format.resultReport(mixed)
  assert(mixedReport.includes('## 审核结论'))
  assert(mixedReport.includes('本轮审核'))
  assert(mixedReport.includes('- 审核结果：通过'))
  assert(mixedReport.includes('通过率：86% / 目标 90%（有风险，86%）'))
  assert(!mixedReport.includes('| 首轮 |'), 'mixed metric kinds use a list, not a comparison table')
})

test('the authored detail page is what the board tab shows, while the result page stays separate', () => {
  const board = createResultDemoBoard('verified')
  assert(board.detail.includes('执行详情'))
  assert(board.detail.includes('验收要求'))
  const boardHtml = renderToStaticMarkup(createElement(WhiteboardBoardView, { detail: board.detail, html: '<p>compact fallback</p>' }))
  assert(boardHtml.includes('<h1>折叠电脑支架上架与优化 · 执行详情</h1>'))
  assert(!boardHtml.includes('compact fallback'))
  const fallback = renderToStaticMarkup(createElement(WhiteboardBoardView, { detail: '', html: '<p>compact fallback</p>' }))
  assert(fallback.includes('compact fallback'))
})

test('a completed result board points the wall link at 成果 while unfinished boards keep the task breakdown', () => {
  const verified = renderBoard({ taskBoard: schema.parse(createResultDemoBoard('verified')) })
  assert(verified.includes('查看成果'))
  const draft = renderBoard({ taskBoard: schema.parse(createResultDemoBoard('draft')) })
  assert(draft.includes('查看任务拆解'))
})

test('the commerce demo finishes with a verified per-office result and keeps it on the review conversation', async () => {
  const source = new CommerceOfficeDataSource('operations')
  source.applyStage('completed')
  const main = await source.getSnapshot()
  assert.equal(main.whiteboard?.status, 'completed')
  assert.equal(main.whiteboard?.result?.status, 'verified')
  assert.equal(main.whiteboard?.result?.metrics.length, 6)
  assert.match(main.whiteboard?.result?.summary ?? '', /订单 9 → 14 单/)
  assert.equal(main.whiteboard?.result?.artifacts.length, 3)
  source.selectConversation('conversion-review')
  const review = await source.getSnapshot()
  assert.equal(review.whiteboard?.result?.status, 'verified', 'the review conversation carries the same result')
})

test('the coupon branch produces its own result instead of reusing the information branch copy', async () => {
  const source = new CommerceOfficeDataSource('analysis')
  source.applyStage('completed', 'coupon')
  const whiteboard = (await source.getSnapshot()).whiteboard
  assert.match(whiteboard?.result?.summary ?? '', /5 元优惠后订单 9 → 13 单/)
  assert.equal(whiteboard?.result?.metrics.find(metric => metric.id === 'price')?.value, '74')
  assert.equal(whiteboard?.result?.metrics.find(metric => metric.id === 'revenue')?.value, '962')
})

test('goal boards that have not finished do not pretend to have a result', async () => {
  const source = new CommerceOfficeDataSource('visual')
  assert.equal((await source.getSnapshot()).whiteboard?.result?.status, 'draft')
  source.applyStage('decision')
  assert.equal((await source.getSnapshot()).whiteboard?.result?.status, 'draft')
  assert.equal((await source.getSnapshot()).whiteboard?.result?.metrics.length, 0)
})
