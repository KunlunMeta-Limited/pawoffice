import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

/**
 * The 8 conference demo walkthroughs used to end with "任务已完成, 成果尚未交付" because the
 * generated whiteboard never carried a result. This round only the 经营分析团队 (office-analysis)
 * walkthrough was given a semantic result sample, built from the same data as its chat report:
 * two 24h observation windows, 360→350 visits, 9→14 orders and 6/10 size questions.
 *
 * These tests pin two things:
 * 1. the finished analysis walkthrough produces a readable delivery result;
 * 2. the other seven walkthroughs still show the honest empty fallback (no invented result).
 */

let server, conferenceLocalOffices, resultPresentation, resultReadingMode, resultHasContent, ResultWorkspace
before(async () => {
  server = await createTestServer()
  ;({ conferenceLocalOffices } = await server.ssrLoadModule('/apps/web/src/conference/demoScenarios.ts'))
  ;({ resultPresentation } = await server.ssrLoadModule('/apps/web/src/results/presentation.ts'))
  ;({ resultReadingMode } = await server.ssrLoadModule('/apps/web/src/results/readingMode.ts'))
  ;({ resultHasContent } = await server.ssrLoadModule('/apps/web/src/results/format.ts'))
  ;({ ResultWorkspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
})
after(() => server?.close())

const officeById = id => conferenceLocalOffices().find(office => office.id === id)

/** Advance the scenario's own progress helper until every task is completed. */
function finishWalkthrough(office) {
  const { source } = office
  const assigned = new Set(source.scenario.steps.map(step => step.assigneeId))
  source.showProgress(source.scenario.steps.length * 5, assigned)
  return source.getConversations()[0].whiteboard
}

test('经营分析团队：任务完成后产出可阅读的复盘成果', () => {
  const board = finishWalkthrough(officeById('office-analysis'))
  assert.equal(board.status, 'completed')
  assert.equal(board.description, '对比两轮 24 小时经营数据，整理复盘建议与下一步动作。')
  const result = board.result

  assert.equal(result.title, '折叠电脑支架转化复盘')
  assert.equal(result.status, 'ready')
  assert.match(result.summary, /360 → 350/)
  assert.match(result.verdict, /79 元|因果/)
  assert.equal(result.owner, '王明 · 负责人')
  assert.equal(result.metricsTitle, '两轮经营观察')

  assert.equal(result.metrics.length, 4)
  const [visits, orders, conversion, inquiries] = result.metrics
  assert.equal(visits.label, '商品访问')
  assert.equal(visits.previous, '360 次')
  assert.equal(visits.value, '350')
  assert.equal(orders.value, '14')
  assert.equal(orders.change, '+5 单')
  assert.equal(conversion.change, '+1.5pp')
  assert.equal(conversion.kind, 'comparison')
  assert.equal(inquiries.kind, 'text')

  assert.equal(result.artifacts.length, 2)
  assert.deepEqual(result.artifacts.map(artifact => artifact.title), ['转化复盘报告', '两轮观察数据'])
  assert.equal(result.artifacts[0].kind, 'document')
  assert.equal(result.artifacts[1].kind, 'data')
  assert.match(result.artifacts[1].content, /商品访问（次）,360,350/)

  assert.equal(result.checks.length, 3)
  assert(result.checks.every(check => check.status === 'passed'))
  assert.equal(result.risks.length, 1)
  assert.equal(result.risks[0].status, 'open')
  assert.equal(result.tasks.length, 3)
  assert(result.tasks.every(task => task.status === 'done'))
  assert.equal(result.next.length, 3)

  assert.equal(resultHasContent(result), true)
  assert.equal(resultReadingMode(result), 'delivery')
  assert.equal(resultPresentation(board, result).label, '已交付')
})

test('电商运营团队：任务完成并确认上架后产出上架检查成果', () => {
  const board = finishWalkthrough(officeById('office-1'))
  assert.equal(board.status, 'completed')
  assert.equal(board.description, '核对商品资料与页面，按 79 元完成上架准备与确认登记。')
  const result = board.result

  assert.equal(result.title, '折叠电脑支架上架检查')
  assert.equal(result.status, 'ready')
  assert.match(result.summary, /79 元/)
  assert.match(result.verdict, /79 元|承重/)
  assert.equal(result.team, '电商运营团队')
  assert.equal(result.metricsTitle, '上架前核对')

  assert.equal(result.metrics.length, 4)
  const [status, price, fit, pageCheck] = result.metrics
  assert.equal(status.kind, 'status')
  assert.equal(status.value, '已确认上架')
  assert.equal(price.value, '79')
  assert.equal(fit.value, '13–16')
  assert.equal(pageCheck.value, '4 / 4')

  assert.deepEqual(result.artifacts.map(artifact => artifact.title), ['上架检查清单', '商品资料核对表'])
  assert.equal(result.artifacts[1].kind, 'data')
  assert.match(result.artifacts[1].content, /售价,79 元,79 元,一致/)

  assert.equal(result.checks.length, 3)
  assert(result.checks.every(check => check.status === 'passed'))
  assert.equal(result.decisions.length, 1)
  assert.equal(result.decisions[0].choice, '确认上架')
  assert.equal(result.risks.length, 1)
  assert.equal(result.tasks.length, 3)
  assert.equal(result.next.length, 3)

  assert.equal(resultHasContent(result), true)
  assert.equal(resultReadingMode(result), 'delivery')
  assert.equal(resultPresentation(board, result).label, '已交付')
})

const expectedResults = {
  'office-1': '折叠电脑支架上架检查',
  'office-content': '折叠电脑支架素材审核',
  'office-analysis': '折叠电脑支架转化复盘',
  'office-demo-seo': '产品页 SEO 优化清单',
  'office-demo-tax': '本期申报资料核对',
  'office-demo-social': '折叠电脑支架 · 适用尺寸更新',
  'office-demo-collection': '周四彩排 · 会前准备简报',
  'office-demo-digest': '跨入口项目简报',
}

test('8 个演示场景全部产出可阅读的成果页', () => {
  const offices = conferenceLocalOffices()
  assert.equal(offices.length, 8)
  for (const office of offices) {
    const board = finishWalkthrough(office)
    assert.equal(board.status, 'completed', office.id)
    const result = board.result
    assert.equal(result.title, expectedResults[office.id], `${office.id} 成果标题`)
    assert.equal(result.status, 'ready', office.id)
    assert.equal(result.artifacts.length, office.id === 'office-demo-tax' ? 3 : 2, `${office.id} 交付物`)
    assert(result.artifacts.some(artifact => artifact.kind === 'data'), office.id)
    assert.equal(result.checks.length, office.source.currentCase ? 1 : 3, `${office.id} 检查项`)
    assert.equal(result.tasks.length, 3, `${office.id} 任务记录`)
    assert.equal(result.next.length, office.source.currentCase ? 1 : 3, `${office.id} 下一步`)
    assert(result.summary.length > 0 && result.verdict.length > 0, office.id)
    assert.doesNotMatch(JSON.stringify(result), /模拟数据|模拟业务数据|仅模拟|演示模拟值|仅用于演示|申报项目（模拟）/, office.id)
    assert.equal(resultHasContent(result), true, office.id)
    assert.equal(resultReadingMode(result), 'delivery', office.id)
    assert.equal(resultPresentation(board, result).label, '已交付', `${office.id} 状态`)
  }
})

test('每个场景都有与自身语义对应的关键内容', () => {
  const expectations = {
    'office-content': ['图片清单', '素材审核清单', '13–16 英寸'],
    'office-demo-seo': ['产品页 SEO 优化清单', '核心搜索词', '内链建议'],
    'office-demo-tax': ['待补凭证', 'P-04', 'R-06', '申报草稿（待复核）'],
    'office-demo-social': ['小红书', '13–16 英寸', '待审核'],
    'office-demo-collection': ['周四 14:00', 'A201', 'B105', '待确认'],
    'office-demo-digest': ['信息入口', '周三 15:00', '待确认'],
  }
  for (const [id, needles] of Object.entries(expectations)) {
    const result = finishWalkthrough(officeById(id)).result
    const haystack = JSON.stringify(result)
    for (const needle of needles) assert(haystack.includes(needle), `${id} 应包含「${needle}」`)
  }
})

test('成果能够渲染到单页阅读器（SSR）', () => {
  const board = finishWalkthrough(officeById('office-analysis'))
  const html = renderToStaticMarkup(createElement(ResultWorkspace, { board, result: board.result }))
  for (const text of ['折叠电脑支架转化复盘', '本轮交付', '转化复盘报告', '两轮观察数据', '两轮经营观察',
    '验证与验收', '观察窗口短，因果未证实', '延长第二个观察窗口', '下一步']) {
    assert(html.includes(text), `阅读器应显示「${text}」`)
  }
  assert(!html.includes('当前没有可阅读的成果内容'))
  assert(!html.includes('role="tablist"'), '保持单页阅读，不出现 tablist')

  const listingBoard = finishWalkthrough(officeById('office-1'))
  const listingHtml = renderToStaticMarkup(createElement(ResultWorkspace, { board: listingBoard, result: listingBoard.result }))
  for (const text of ['折叠电脑支架上架检查', '上架检查清单', '商品资料核对表', '上架状态', '已确认上架',
    '确认上架', '上架前核对', '下一步']) {
    assert(listingHtml.includes(text), `阅读器应显示「${text}」`)
  }
  assert(!listingHtml.includes('当前没有可阅读的成果内容'))
})
