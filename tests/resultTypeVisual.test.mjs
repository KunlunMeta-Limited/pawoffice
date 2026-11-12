import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, Workspace, fixtures, presentation
before(async () => {
  server = await createTestServer()
  ;({ ResultWorkspace: Workspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  fixtures = await server.ssrLoadModule('/apps/web/src/dev/resultBoardFixtures.ts')
  presentation = await server.ssrLoadModule('/apps/web/src/results/presentation.ts')
})
after(() => server?.close())

const render = (board, result) => renderToStaticMarkup(createElement(Workspace, { board, result }))
const countOf = (html, text) => html.split(text).length - 1

/* ------------------------------------------------------------------------------------------------
 * Data-type visual system — one dedicated form per semantic type (round after the single-page layout)
 * ---------------------------------------------------------------------------------------------- */

test('reading focus switches with field composition without new protocol fields', () => {
  const delivery = render(fixtures.sampleBoard, fixtures.sampleResult)
  assert(delivery.includes('data-reading-mode="delivery"'))
  assert(delivery.includes('本轮交付'))
  assert(delivery.includes('result-workspace-delivery'))

  const fact = render(fixtures.typeFactBoard, fixtures.typeFactResult)
  assert(fact.includes('data-reading-mode="fact"'))
  assert(!fact.includes('本轮交付'), 'fact results never render a deliverable block')
  assert(!fact.includes('result-workspace-delivery'))
  assert(fact.includes('说明与结论'))
  assert(fact.includes(fixtures.typeFactResult.summary))

  // Both modes keep the no-tabs promise.
  for (const html of [delivery, fact]) {
    assert(!html.includes('role="tablist"'))
    assert(!html.includes('role="tab"'))
    assert(!html.includes('aria-selected'))
  }
})

test('six metric kinds keep distinct semantics instead of one numeric template', () => {
  const html = render(fixtures.typeMetricsBoard, fixtures.typeMetricsResult)
  for (const kind of ['value', 'comparison', 'status', 'target', 'text']) {
    assert(html.includes(`data-kind="${kind}"`), kind)
  }
  assert(!html.includes('data-kind="auto"'), 'auto is resolved, never shown as a raw kind')
  // Comparison gets the two-point bars; status is a lamp + words; target gets a target line.
  assert.equal(countOf(html, 'class="result-metric-bars"'), 2, 'comparison + auto-with-previous both get bars')
  assert(html.includes('result-metric-status-dot'))
  assert(html.includes('result-metric-status-text'))
  assert(html.includes('result-metric-target-line'))
  assert(html.includes('result-metric-caption'))
  assert.equal(countOf(html, 'class="result-metric"'), 6)
  assert(html.includes('data-emphasis="primary"'))
  // No invented numbers: only values supplied by the fixture.
  assert(html.includes('首轮 120 次') || html.includes('首轮 2.9%'))
})

test('four artifact kinds have their own delivery form and honest fallbacks', () => {
  const html = render(fixtures.typeArtifactsBoard, fixtures.typeArtifactsResult)
  for (const kind of ['document', 'image', 'link', 'data']) {
    assert(html.includes(`data-kind="${kind}"`), kind)
  }
  // Document rows, image media slots, link domains and data formats are different structures.
  assert(html.includes('result-deliverable-media'))
  assert.equal(countOf(html, 'class="result-deliverable-thumb"'), 1, 'only the legal http(s) image renders an <img>')
  assert(html.includes('result-deliverable-domain'))
  assert(html.includes('example.com'))
  assert(html.includes('result-deliverable-format'))
  assert(html.includes('JSON'))
  // Empty URL fallbacks stay honest.
  assert(html.includes('未提供可用链接'))
  assert(html.includes('暂无图片可预览'))
})

test('documents with the exact artifact identity share the preview entry instead of duplicating cards', () => {
  const html = render(fixtures.typeDeliveryBoard, fixtures.typeDeliveryResult)
  assert.equal(countOf(html, 'class="result-deliverable"'), 3)
  assert.equal(countOf(html, 'result-workspace-doc-open'), 3)
  assert(html.includes('data-kind="documents"'))
  assert(html.includes('本次更新'))
  assert(html.includes('本次新增'))
  assert(!html.includes('关联文件不在本轮交付中'))
})

test('checks and risks use a review ledger: tally, ratio segments, stale evidence and severity register', () => {
  const html = render(fixtures.typeReviewBoard, fixtures.typeReviewResult)
  assert(html.includes('result-workspace-check-band'))
  assert(html.includes('共 4 项检查：1 项标记通过 · 1 项待处理 · 1 项未通过 · 1 项待补充验证'))
  assert.equal(countOf(html, 'class="result-workspace-check-ratio-seg"'), 4)
  for (const status of ['passed', 'pending', 'failed', 'stale']) {
    assert(html.includes(`data-status="${status}"`), status)
  }
  assert(html.includes('待补充验证'))
  assert(html.includes('原验证版本 type-review-doc-v1，当前版本 v2.0'))
  assert(html.includes('风险记录'))
  assert.equal(countOf(html, 'class="result-workspace-risk"'), 3)
  for (const level of ['high', 'medium', 'low']) assert(html.includes(`data-level="${level}"`), level)
  for (const status of ['open', 'mitigating', 'closed']) assert(html.includes(`data-status="${status}"`), status)
})

test('version records are a timeline with three contract states', () => {
  const html = render(fixtures.typeVersionsBoard, fixtures.typeVersionsResult)
  assert.equal(countOf(html, 'class="result-workspace-version"'), 3)
  for (const status of ['draft', 'released', 'rolled-back']) {
    assert(html.includes(`data-status="${status}"`), status)
  }
  for (const label of ['草稿', '已发布', '已回滚']) assert(html.includes(label), label)
  assert(html.includes('result-workspace-versions'))
})

test('code changes are a diff list with inline expansion and no fake diffs', () => {
  const html = render(fixtures.typeChangesBoard, fixtures.typeChangesResult)
  assert.equal(countOf(html, 'class="result-change-row"'), 24)
  assert(html.includes('已编辑 24 个文件'))
  assert(!html.includes('result-diff-popover'), 'inline expansion replaced the top-layer popover')
  assert(html.includes('aria-expanded="false"'), 'diff stays collapsed on first render')
  assert(html.includes('二进制'))
  assert(html.includes('较大文件'))
  assert(html.includes('原路径：'))
})

test('api, environments, files and tests each keep their own report shape', () => {
  const html = render(fixtures.typeSectionsBoard, fixtures.typeSectionsResult)
  assert(html.includes('data-kind="api"'))
  assert(html.includes('data-kind="environments"'))
  assert(html.includes('data-kind="files"'))
  assert(html.includes('data-kind="tests"'))
  assert(html.includes('result-workspace-method'))
  assert(html.includes('result-workspace-env'))
  assert(html.includes('result-workspace-file'))
  assert(html.includes('result-workspace-stat'))
  // Source order of sections is preserved.
  const kinds = fixtures.typeSectionsResult.sections.map(section => section.kind)
  let previous = -1
  for (const kind of kinds) {
    const index = html.indexOf(`data-kind="${kind}"`)
    assert(index > previous, `${kind} keeps source order`)
    previous = index
  }
  // Presentation contract still drives status labels only.
  assert.equal(presentation.resultPresentation(fixtures.typeSectionsBoard, fixtures.typeSectionsResult).key, 'ready')
})
