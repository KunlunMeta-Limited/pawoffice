import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

/**
 * Acceptance tests for the single-page result reading flow (result-board redesign).
 *
 * The data comes from the dev-only acceptance fixtures:
 * - `sample` / `history` are byte-for-byte copies of the user-supplied sample JSON.
 * - `matrix` / `layouts` / `limits` / `resultBoardStates` are schema-checked front-end fixtures.
 * No fixture is a protocol addition; every value is parsed by the frozen protocol schema first.
 *
 * Structure-only assertions are used here because these tests render static HTML (SSR):
 * dialogs, Escape, focus restoration, clipboard and download are covered by screenshots/manual steps.
 */

let server, resultSchema, boardSchema, emptyResult, ResultWorkspace, fixtures, presentation, format
before(async () => {
  server = await createTestServer()
  ;({ officeResultSchema: resultSchema, whiteboardTaskBoardSchema: boardSchema, emptyResult } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  ;({ ResultWorkspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  fixtures = await server.ssrLoadModule('/apps/web/src/dev/resultBoardFixtures.ts')
  presentation = await server.ssrLoadModule('/apps/web/src/results/presentation.ts')
  format = await server.ssrLoadModule('/apps/web/src/results/format.ts')
})
after(() => server?.close())

const render = (board, result) => renderToStaticMarkup(createElement(ResultWorkspace, { board, result }))
const boardFor = result => boardSchema.parse({ template: 'task-board-v1', title: '任务', status: 'completed', result })
const renderResult = result => render(boardFor(result), result)
const countOf = (html, needle) => html.split(needle).length - 1

const assertNoTabs = html => {
  assert(!html.includes('role="tablist"'), 'no tablist')
  assert(!html.includes('role="tab"'), 'no tab role')
  assert(!html.includes('aria-selected'), 'no aria-selected')
  assert(!/>(概览|交付物|过程记录)</.test(html), 'no legacy tab labels')
}

/* ------------------------------------------------------------------------------------------------
 * A03 / A05 / A06 / A10 — real sample first screen
 * ---------------------------------------------------------------------------------------------- */

test('the real sample is one reading flow with summary, verdict and note kept separate', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  assertNoTabs(html)
  // A05: ready is delivered, never "verified".
  assert(html.includes('data-result-status="ready"'))
  assert(html.includes('成果 · 已交付'))
  assert(!html.includes('成果 · 已验证'))
  assert(!html.includes('验收通过'))
  // A06: summary is the lead, verdict is a separate acceptance block.
  const summaryIndex = html.indexOf('result-workspace-conclusion')
  const verdictIndex = html.indexOf('result-workspace-verdict')
  assert(summaryIndex > 0 && verdictIndex > summaryIndex, 'summary before verdict')
  assert(html.includes(fixtures.sampleResult.summary))
  assert(html.includes(fixtures.sampleResult.verdict))
  // Identity / meta from the sample only.
  assert(html.includes('登录模块交付成果'))
  assert(html.includes('任务状态未提供'), 'isolated sample has no whiteboard.status')
  assert(html.includes('王明'))
  assert(html.includes('研发组（2人）'))
  // A10: the disclaimer is not optimised away.
  assert(html.includes('result-workspace-note'))
  assert(html.includes('以上内容均为本地模拟业务数据。'))
  // First-screen reminder and delivery total are visible.
  assert(html.includes('需要关注 3 项'))
  assert(html.includes('3 份交付文件'))
})

test('the real sample shows 2 passed / 1 pending / 1 stale instead of 3 passed', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  assert(html.includes('result-workspace-check-summary'))
  assert(html.includes('共 4 项检查：2 项标记通过 · 1 项待处理 · 1 项待补充验证'))
  assert(!html.includes('3 项标记通过'))
  assert(!html.includes('3/4 通过'))
  // A07: the stale row explains the old/current version without mutating data.
  assert(html.includes('data-status="stale"'))
  assert(html.includes('需求范围检查'))
  assert(html.includes('待补充验证'))
  assert(html.includes('原验证版本 prd-v1，当前版本 v2.0'))
  assert(html.includes('待补充验证项的原验证对象与当前交付版本不一致'))
  // The stale rule lives in checks.ts; the source check itself is still passed.
  const stale = presentation.resultChecks(fixtures.sampleResult).find(check => check.id === 'scope-review')
  assert.equal(stale.status, 'pending')
  assert.equal(fixtures.sampleResult.checks.find(check => check.id === 'scope-review').status, 'passed')
})

/* ------------------------------------------------------------------------------------------------
 * A08 / A09 / A16 — real sample deliveries and section order
 * ---------------------------------------------------------------------------------------------- */

test('the real sample keeps changes before documents and links documents to one preview entry', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  const changes = html.indexOf('data-kind="changes"')
  const documents = html.indexOf('data-kind="documents"')
  assert(changes > 0 && documents > changes, 'source order changes -> documents')
  assert(html.includes('已编辑 6 个文件'))
  // §7: all six file rows stay visible as compact rows; no diff is dumped into the first screen.
  assert.equal(countOf(html, 'class="result-change-row"'), 6)
  assert(html.includes('src/features/auth/LoginForm.tsx'))
  assert(html.includes('src/features/auth/useLogin.ts'))
  assert(html.includes('tests/auth/login.test.ts'))
  assert(html.includes('src/features/auth/legacyLogin.ts'))
  assert(html.includes('src/features/auth/session.ts'))
  assert(html.includes('原路径：src/features/auth/storage.ts'))
  assert(html.includes('docs/login-flow.png'))
  assert(html.includes('二进制'), 'binary file is labelled, not given a fake text diff')
  assert(!html.includes('全部 6 个文件'), 'no legacy first-four-file toggle')
  // All three documents match artifacts by exact artifactId + versionId.
  assert.equal(countOf(html, 'result-workspace-doc-open'), 3)
  assert.equal(countOf(html, 'class="result-deliverable"'), 3)
  assert(html.includes('登录模块需求说明'))
  assert(html.includes('登录接口文档'))
  assert(html.includes('验收报告'))
  assert(!html.includes('指定产物版本未提供'))
  assert(!html.includes('关联文件不在本轮交付中'))
  // The real files are Markdown with content; no invented file format.
  assert(!html.includes('.pdf'))
  assert(!html.includes('.docx'))
})

test('all three real Markdown deliverables are readable through the shared artifact preview', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  for (const artifact of fixtures.sampleResult.artifacts) {
    assert(html.includes(artifact.title), artifact.title)
    assert(html.includes(artifact.version), artifact.version)
  }
  assert(html.includes('阅读'))
  assert(html.includes('复制'))
  assert(html.includes('下载'))
  // The copy/download actions come from the reader actions view, not fake buttons.
  assert(html.includes('复制摘要'))
  assert(html.includes('下载报告'))
})

test('documents only open the exact artifactId + versionId pair, never a similar title', () => {
  const mismatched = resultSchema.parse({
    title: '版本不匹配', summary: '文档项绑定旧版本',
    artifacts: [{ id: 'doc', title: '需求说明', versionId: 'doc-v2', version: 'v2.0', content: '新版正文' }],
    sections: [{ kind: 'documents', id: 'docs', title: '交付文档', items: [
      { id: 'old', artifactId: 'doc', versionId: 'doc-v1', title: '需求说明', version: 'v1.0', status: 'done' },
      { id: 'plain', title: '同名但未绑定', version: 'v2.0', status: 'done' },
    ] }],
  })
  const html = renderResult(mismatched)
  assert.equal(countOf(html, 'result-workspace-doc-open'), 0)
  assert(html.includes('关联文件不在本轮交付中'))
  assert(html.includes('文档说明（未关联文件）'))
})

/* ------------------------------------------------------------------------------------------------
 * A11 — six metric kinds and the 1/2/3/4/6 -> cards, 7–12 -> compact density rule
 * ---------------------------------------------------------------------------------------------- */

test('all six metric kinds have a readable, semantically distinct form', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  assert(html.includes('result-metrics'))
  assert(html.includes('data-density="compact"'), '12 metrics use the compact data-row density')
  for (const kind of ['comparison', 'value', 'status', 'target', 'text']) {
    assert(html.includes(`data-kind="${kind}"`), kind)
  }
  assert(!html.includes('data-kind="auto"'), 'auto is resolved to comparison/value, not rendered raw')
  assert(html.includes('仅覆盖登录模块'), 'text metric renders the fact without inventing a unit')
  assert(html.includes('data-emphasis="primary"'))
  // Dense rows keep the same semantics as cards: target status, target and progress are still readable.
  assert(html.includes('已达标'))
  assert(html.includes('有风险'))
  assert(html.includes('目标 95%'))
  assert(html.includes('首轮 2.9% · +0.9pp'))

  // Card-mode semantics: comparison keeps previous/trend, target keeps target/targetStatus/progress.
  const pick = kind => fixtures.matrixResult.metrics.find(metric => metric.kind === kind)
  const targets = fixtures.matrixResult.metrics.filter(metric => metric.kind === 'target')
  const statuses = fixtures.matrixResult.metrics.filter(metric => metric.kind === 'status')
  const cardMetrics = resultSchema.parse({
    metrics: [pick('comparison'), targets[0], targets[1], statuses[0], statuses[1], pick('text')],
  })
  const cards = renderResult(cardMetrics)
  assert(cards.includes('data-density="card"'))
  assert(cards.includes('首轮 2.9%'), 'comparison keeps the previous value')
  assert(cards.includes('+0.9pp'))
  assert(cards.includes('已达标'))
  assert(cards.includes('有风险'))
  assert(cards.includes('目标 95%'))
  assert(cards.includes('role="progressbar"'), 'target progress is visible')
  assert(cards.includes('aria-valuenow="96"'))
  assert(cards.includes('待发布'), 'status metric keeps its value')
  assert(cards.includes('需复核'))
})

test('metric density is 1/2/3/4/6 cards and 7–12 compact rows, in source order', () => {
  for (const amount of [1, 2, 3, 4, 6]) {
    const result = resultSchema.parse({ metrics: fixtures.matrixResult.metrics.slice(0, amount) })
    const html = renderResult(result)
    assert(html.includes(`data-count="${amount}"`), `count ${amount}`)
    assert(html.includes('data-density="card"'), `cards at ${amount}`)
    assert.equal(countOf(html, 'class="result-metric"'), amount)
    assert(!html.includes('result-metric-row'), 'no compact rows at small counts')
    assert(html.includes('data-kind="'), 'each card keeps its resolved kind')
  }
  for (const amount of [7, 12]) {
    const result = resultSchema.parse({ metrics: fixtures.matrixResult.metrics.slice(0, amount) })
    const html = renderResult(result)
    assert(html.includes('data-count="dense"'), `dense count at ${amount}`)
    assert(html.includes('data-density="compact"'), `compact at ${amount}`)
    assert.equal(countOf(html, 'class="result-metric-row"'), amount)
    const labels = [...html.matchAll(/result-metric-row-label">([^<]+)/g)].map(match => match[1])
    assert.deepEqual(labels, fixtures.matrixResult.metrics.slice(0, amount).map(metric => metric.label))
  }
})

/* ------------------------------------------------------------------------------------------------
 * A13 / A14 / A15 — section kinds, custom blocks, layouts
 * ---------------------------------------------------------------------------------------------- */

test('all eight section kinds render in their source order', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  const kinds = fixtures.matrixResult.sections.map(section => section.kind)
  assert.deepEqual(kinds, ['gallery', 'documents', 'tests', 'api', 'environments', 'files', 'changes', 'custom'])
  let previous = -1
  for (const kind of kinds) {
    const index = html.indexOf(`data-kind="${kind}"`)
    assert(index > previous, `${kind} keeps source order`)
    previous = index
    assert(html.includes(`data-kind="${kind}"`), kind)
  }
  assert.equal(countOf(html, 'class="result-workspace-card"'), 8)
  for (const title of ['页面画廊', '交付文档', '质量报告', '接口清单', '运行环境', '附件清单', '文件变更', '自定义区块矩阵']) {
    assert(html.includes(title), title)
  }
})

test('section bodies use semantic rows instead of a generic card wall', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  // gallery
  assert(html.includes('result-workspace-gallery-item'))
  assert(html.includes('暂无预览'))
  // tests
  assert(html.includes('回归测试进度'))
  assert(html.includes('82%'))
  assert(html.includes('data-status="failed"'))
  // api
  assert(html.includes('/api/auth/login'))
  assert(html.includes('data-method="PATCH"'))
  // environments
  for (const text of ['运行中', '待发布', '已停止', '需关注']) assert(html.includes(text), text)
  // files
  assert(html.includes('登录页截图.png'))
  assert(html.includes('248 KB'))
  // changes
  assert(html.includes('已编辑 4 个文件'))
  assert(html.includes('docs/login-flow.png'))
})

test('all twelve custom blocks render with safe source fallbacks', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  const types = ['heading', 'text', 'keyValue', 'stats', 'table', 'list', 'progress', 'chart', 'image', 'diagram', 'callout', 'divider']
  for (const type of types) assert(html.includes(`data-block-type="${type}"`), type)
  assert(html.includes('自定义区块矩阵'))
  assert(html.includes('<strong>Markdown</strong>'), 'Markdown emphasis is rendered')
  assert(html.includes('result-block-table-el'), 'real table')
  assert(html.includes('data-method="POST"'), 'method format cell')
  assert(html.includes('role="progressbar"'), 'progress primitive')
  assert(html.includes('role="img"'), 'chart image role')
  assert(html.includes('柱状图'))
  assert(html.includes('登录流程图占位'), 'empty image falls back to a placeholder')
  assert(html.includes('mermaid-placeholder'))
  assert(html.includes('flowchart TD'), 'diagram source text is preserved')
  assert(html.includes('result-block-callout'))
  assert(html.includes('数据说明'))
  assert(html.includes('<hr'))
})

test('four custom layouts stay inside their own section', () => {
  const html = render(fixtures.layoutsBoard, fixtures.layoutsResult)
  for (const layout of ['stack', 'columns', 'grid', 'cards']) {
    assert(html.includes(`result-blocks-${layout}`), layout)
  }
  const titles = ['连续文档', '并排短内容', '网格内容', '轻卡片内容']
  let previous = -1
  for (const title of titles) {
    const index = html.indexOf(title)
    assert(index > previous, `${title} keeps order`)
    previous = index
  }
  assert(html.includes('所有 12 种 block 均已在本 fixture 与 matrix 中出现。'))
})

/* ------------------------------------------------------------------------------------------------
 * A18 — business record state text
 * ---------------------------------------------------------------------------------------------- */

test('risks, tasks, versions and check states use the contract text and keep state attributes', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  // checks: 1 passed + 1 pending + 1 failed + 1 stale
  assert(html.includes('共 4 项检查：1 项标记通过 · 1 项待处理 · 1 项未通过 · 1 项待补充验证'))
  // risks
  assert(html.includes('风险记录'))
  assert(html.includes('短信验证码频率限制待复核'))
  assert(html.includes('data-level="high"'))
  assert(html.includes('旧版本文档已归档'))
  assert(html.includes('data-status="closed"'))
  assert(html.includes('已关闭'))
  assert(html.includes('待处理'))
  // tasks: todo / doing / blocked / done
  for (const text of ['待开始', '进行中', '受阻', '已完成']) assert(html.includes(text), text)
  assert(html.includes('data-status="blocked"'))
  assert(html.includes('灰度节点排查'))
  // versions: draft / released / rolled-back
  for (const text of ['草稿', '已发布', '已回滚']) assert(html.includes(text), text)
  assert(html.includes('data-status="rolled-back"'))
})

test('production result status text is never derived from task or check state', () => {
  const states = fixtures.resultBoardStates
  assert.equal(presentation.resultPresentation(states.ready.board, states.ready.result).key, 'ready')
  assert.equal(presentation.resultPresentation(states.verified.board, states.verified.result).key, 'verified')
  assert.equal(presentation.resultPresentation(states.conflict.board, states.conflict.result).key, 'conflict')
  // ready fixture has no checks; the label must still be delivered, not verified.
  const ready = render(states.ready.board, states.ready.result)
  assert(ready.includes('成果 · 已交付'))
  assert(!ready.includes('成果 · 已验证'))
  const verified = render(states.verified.board, states.verified.result)
  assert(verified.includes('成果 · 已验证'))
  const conflict = render(states.conflict.board, states.conflict.result)
  assert(conflict.includes('成果 · 验证待核对'))
})

/* ------------------------------------------------------------------------------------------------
 * A21 — empty / short results
 * ---------------------------------------------------------------------------------------------- */

test('empty, summary-only and artifact-only results avoid fake blocks', () => {
  const emptyBoard = boardSchema.parse({ template: 'task-board-v1', title: '空任务', status: 'queued' })
  const emptyHtml = render(emptyBoard, emptyResult())
  assert(emptyHtml.includes('result-workspace-empty'))
  assert(emptyHtml.includes('成果 · 暂无成果'))
  assert(!emptyHtml.includes('result-metrics'))
  assert(!emptyHtml.includes('result-deliverable'))

  const summaryOnly = resultSchema.parse({ title: '短成果', status: 'ready', summary: '只交付了一句结论。' })
  const summaryHtml = renderResult(summaryOnly)
  assert(summaryHtml.includes('result-workspace-conclusion'))
  assert(summaryHtml.includes('只交付了一句结论。'))
  assert(!summaryHtml.includes('result-workspace-empty'))
  assert(!summaryHtml.includes('result-metrics'))
  assert(!summaryHtml.includes('本轮没有可查看的交付物'))
  assert(!summaryHtml.includes('缺少交付物'))

  const artifactOnly = resultSchema.parse({
    title: '只有交付物', status: 'ready',
    artifacts: [{ id: 'only', title: '唯一交付', content: '# 正文', versionId: 'only-v1' }],
  })
  const artifactHtml = renderResult(artifactOnly)
  assert.equal(countOf(artifactHtml, 'class="result-deliverable"'), 1)
  assert(artifactHtml.includes('唯一交付'))
  assert(!artifactHtml.includes('result-metrics'))
  assert(!artifactHtml.includes('缺少交付物'))
  assert(!artifactHtml.includes('result-workspace-empty'))
})

/* ------------------------------------------------------------------------------------------------
 * A22 — untrusted content safety and source preservation
 * ---------------------------------------------------------------------------------------------- */

test('untrusted HTML, scripts and SVG are never executed while source text is preserved', () => {
  const hostile = resultSchema.parse({
    title: '<img src=x onerror=alert(1)>',
    summary: '<script>alert(2)</script>',
    note: '<svg onload=alert(3)></svg>',
    checks: [{ id: 'c', label: '<script>alert(4)</script>', status: 'passed' }],
    risks: [{ id: 'r', title: '<b>风险</b>', level: 'high', status: 'open' }],
    sections: [{
      kind: 'custom', id: 'custom', title: '安全', layout: 'stack', blocks: [
        { type: 'text', text: '<script>alert(5)</script>\n\n**安全正文**' },
        { type: 'diagram', source: 'flowchart TD\n  A["<script>alert(6)</script>"] --> B[结束]' },
        { type: 'table', columns: [{ key: 'link', label: '地址', format: 'link' }], rows: [{ link: 'javascript:alert(7)' }] },
        { type: 'callout', tone: 'danger', text: '<svg onload=alert(8)></svg>' },
      ],
    }],
  })
  const html = renderResult(hostile)
  assert(!html.includes('<script'))
  assert(!html.includes('<svg onload'))
  assert(!html.includes('<img src=x'))
  assert(!/<(?:img|svg|script)[^>]*\son[a-z]+\s*=/i.test(html), 'no unescaped event-handler attribute')
  assert(!html.includes('href="javascript:'))
  // Escaped/plain text survives as data, not markup.
  assert(html.includes('&lt;script&gt;'))
  assert(html.includes('&lt;img src=x'))
  assert(html.includes('安全正文'))
  assert(html.includes('mermaid-placeholder'))
  assert(html.includes('flowchart TD'))
  // Invalid link cells stay plain text instead of becoming clickable.
  assert(!html.includes('href="javascript:'))
})

test('chart values and diagram source remain readable when a graph cannot be drawn', () => {
  const html = render(fixtures.layoutsBoard, fixtures.layoutsResult)
  assert(html.includes('aria-label="图表（饼图）：通过 68，待复核 32"'))
  assert(html.includes('result-block-chart-legend'))
  assert(html.includes('68'))
  assert(html.includes('32'))
  assert(html.includes('flowchart LR'))
  assert(html.includes('A[输入]'))
})

/* ------------------------------------------------------------------------------------------------
 * A12 — four artifact kinds and empty fallbacks
 * ---------------------------------------------------------------------------------------------- */

test('four artifact kinds expose the right reading action and honest empty fallbacks', () => {
  const result = resultSchema.parse({
    title: '交付类型', status: 'ready', summary: '四种交付物',
    artifacts: [
      { id: 'doc', kind: 'document', title: '文档产物', versionId: 'doc-v1', content: '# 文档正文' },
      { id: 'img', kind: 'image', title: '图片产物', versionId: 'img-v1', url: 'https://example.com/a.png' },
      { id: 'img-empty', kind: 'image', title: '空图片产物', versionId: 'img-v2' },
      { id: 'doc-empty', kind: 'document', title: '空文档产物', versionId: 'doc-empty-v1' },
      { id: 'lnk', kind: 'link', title: '外链产物', url: 'https://example.com/spec' },
      { id: 'lnk-empty', kind: 'link', title: '空外链产物' },
      { id: 'dat', kind: 'data', title: '数据产物', versionId: 'dat-v1', content: '| 行 | 值 |\n| --- | --- |\n| 1 | 10 |' },
    ],
  })
  const html = renderResult(result)
  for (const title of ['文档产物', '图片产物', '空图片产物', '空文档产物', '外链产物', '空外链产物', '数据产物']) assert(html.includes(title), title)
  // document/data: reading action; image: large-picture action; link without versionId: real anchor.
  assert(html.includes('阅读'))
  assert(html.includes('查看大图'))
  assert(html.includes('打开链接'))
  assert(html.includes('href="https://example.com/spec"'))
  assert(html.includes('未提供可用链接'), 'empty link never becomes a fake navigation')
  // A12: versions with no readable body/URL expose a disabled fallback instead of a failing preview button.
  assert(html.includes('暂无图片可预览'), 'empty image shows an honest disabled fallback')
  assert(html.includes('暂无正文或文件地址'), 'empty document shows an honest disabled fallback')
  assert(html.includes('aria-disabled="true"'))
  assert.equal(countOf(html, '查看大图'), 1, 'only the real image offers a preview')
  // Empty image URL never invents an <img>; the row keeps an icon fallback.
  assert.equal(countOf(html, 'result-deliverable-thumb'), 1)
})

test('the sample deliverable directory never fabricates file size or format', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  assert(!/\d+(\.\d+)?\s?(KB|MB|GB)/.test(html), 'no invented file size')
  assert(!html.includes('application/pdf'))
  assert(!html.includes('image/png'))
})

/* ------------------------------------------------------------------------------------------------
 * A19 — history deliveries
 * ---------------------------------------------------------------------------------------------- */

test('history deliveries switch through the existing shell without borrowing current data', () => {
  const current = render(fixtures.historyBoard, fixtures.historyResult)
  assert(current.includes('result-delivery-switch'))
  assert(current.includes('交付历史'))
  assert(current.includes('当前成果</option>'))
  assert(current.includes('第 2 轮 · 首次文档交付'))

  const historical = renderToStaticMarkup(createElement(ResultWorkspace, {
    board: fixtures.historyBoard, result: fixtures.historyResult, initialDeliveryId: 'delivery-2',
  }))
  assert(historical.includes('历史交付 · 第 2 轮 · 首次文档交付'))
  assert(historical.includes('文档固定为当时版本'))
  assert(historical.includes('返回当前成果'))
  assert(historical.includes('登录模块开发与验收'))
  assert(historical.includes('data-historical="true"'))
  // Historical content is the requested record, not the current v2.0 result.
  assert(historical.includes('首次交付需求说明 v1.0 与接口文档 v1.0。'))

  const missing = renderToStaticMarkup(createElement(ResultWorkspace, {
    board: fixtures.historyBoard, result: fixtures.historyResult, initialDeliveryId: 'does-not-exist',
  }))
  assert(missing.includes('该次交付不在当前会话的可用目录中，未展示其他轮次内容。'))
  assert(missing.includes('查看当前成果'))
})

test('historical delivery keeps its own checks and does not report the current stale state', () => {
  const historical = renderToStaticMarkup(createElement(ResultWorkspace, {
    board: fixtures.historyBoard, result: fixtures.historyResult, initialDeliveryId: 'delivery-2',
  }))
  // delivery-2 predates the prd-v2 update, so its own check is not stale.
  assert(!historical.includes('原验证版本 prd-v1，当前版本 v2.0'))
})

/* ------------------------------------------------------------------------------------------------
 * A20 — extreme counts
 * ---------------------------------------------------------------------------------------------- */

test('extreme counts keep every item and switch metrics to compact rows', () => {
  const html = render(fixtures.limitsBoard, fixtures.limitsResult)
  assert(html.includes('data-count="dense"'))
  assert.equal(countOf(html, 'class="result-metric-row"'), 12)
  assert.equal(countOf(html, 'class="result-deliverable"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-card"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-gallery-item"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-file"'), 12)
  assert(html.includes('/api/limit/resource-12'))
  assert(html.includes('环境 8'))
  assert(html.includes('已编辑 24 个文件'))
  assert.equal(countOf(html, 'class="result-change-row"'), 24)
  assert.equal(countOf(html, 'data-block-type='), 24)
  assert(html.includes('共 12 项检查：'))
  assert.equal(countOf(html, 'class="result-workspace-task"'), 12)
  assert.equal(countOf(html, 'class="result-workspace-version"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-risk"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-decision"'), 8)
  assert.equal(countOf(html, '后续行动 '), 8)
})

/* ------------------------------------------------------------------------------------------------
 * §9.2 — the ten existing presentation states
 * ---------------------------------------------------------------------------------------------- */

test('all ten presentation states render the existing label and no invented state', () => {
  for (const key of fixtures.presentationKeys) {
    const state = fixtures.resultBoardStates[key]
    assert.equal(presentation.resultPresentation(state.board, state.result).key, key, `fixture state ${key}`)
    const html = render(state.board, state.result)
    assert(html.includes(`data-result-status="${key}"`), key)
    assert(html.includes(`成果 · ${state.label}`), `${key} label`)
  }
  // Empty-ish states keep the empty container; no fake content is rendered.
  for (const key of ['producing', 'blocked', 'failed', 'missing', 'empty']) {
    const state = fixtures.resultBoardStates[key]
    assert(render(state.board, state.result).includes('result-workspace-empty'), `${key} empty state`)
  }
})

test('a result with only a note still renders a complete short report', () => {
  const result = resultSchema.parse({ note: '只有一句免责声明。' })
  const html = renderResult(result)
  assert(html.includes('只有一句免责声明。'))
  assert(html.includes('result-workspace-note'))
  assert(!html.includes('result-workspace-empty'))
})

test('the summary copy and report exports stay available for the single-page reader', () => {
  const summary = format.resultSummaryText(fixtures.sampleResult)
  assert(summary.includes('登录模块交付成果'))
  assert(summary.includes('需求说明更新至 v2.0'))
  const report = format.resultReport(fixtures.sampleResult)
  assert(report.includes('## 文件变更'))
  assert(report.includes('需求范围检查（验证版本已更新，需重新验证）'))
  assert(report.includes('以上内容均为本地模拟业务数据。'))
})
