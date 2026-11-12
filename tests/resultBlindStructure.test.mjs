import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

/**
 * Blind-structure checks: results that are NOT one of the eight demo scenarios.
 * The reader must adapt from structure alone (no per-business template):
 *  - long fact research without deliverables
 *  - metrics-only analysis (comparison data becomes the lead)
 *  - mixed result with a document + custom section
 */

let server, ResultWorkspace, resultSchema, boardSchema
before(async () => {
  server = await createTestServer()
  ;({ ResultWorkspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  ;({ officeResultSchema: resultSchema, whiteboardTaskBoardSchema: boardSchema } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
})
after(() => server?.close())

const render = result => renderToStaticMarkup(createElement(ResultWorkspace, {
  board: boardSchema.parse({ template: 'task-board-v1', title: '说明型成果', status: 'completed', result }),
  result,
}))

test('长篇说明型成果：无交付物时以正文与结论为主，不出现空交付区', () => {
  const result = resultSchema.parse({
    title: '新业务领域调研报告',
    status: 'ready',
    summary: '本次调研覆盖 3 个渠道与 12 份公开材料，形成 5 条可验证结论。',
    verdict: '结论依赖公开材料，样本有限，不能代表全部客户。',
    metrics: [],
    artifacts: [],
    next: ['补充一手访谈。', '复核样本来源。', '更新结论边界。'],
    note: '本地模拟数据。',
  })
  const html = render(result)
  assert(html.includes('新业务领域调研报告'))
  assert(html.includes('本次调研覆盖'))
  assert(!html.includes('本轮交付'), '无交付物时不应出现空的交付区')
  assert(html.includes('下一步'))
  assert(!html.includes('当前没有可阅读的成果内容'))
})

test('指标型成果：比较数据成为首屏主内容（data-lead）', () => {
  const result = resultSchema.parse({
    title: '渠道转化对比',
    status: 'ready',
    summary: 'A 渠道转化率 2.1% → 3.4%，B 渠道 1.8% → 2.2%。',
    verdict: '转化提升仍需延长观察窗口确认。',
    metrics: [
      { id: 'a', label: 'A 渠道转化率', value: '3.4', unit: '%', kind: 'comparison', previous: '2.1%', change: '+1.3pp', trend: 'up', tone: 'positive' },
      { id: 'b', label: 'B 渠道转化率', value: '2.2', unit: '%', kind: 'comparison', previous: '1.8%', change: '+0.4pp', trend: 'up', tone: 'positive' },
    ],
    artifacts: [],
    next: ['延长观察窗口。'],
    note: '本地模拟数据。',
  })
  const html = render(result)
  assert(html.includes('data-lead="data"'), '比较型指标应触发 data-lead')
  assert(html.includes('A 渠道转化率'))
  assert(html.indexOf('result-workspace-metric-band') < html.indexOf('result-workspace-review'), '指标区应排在验收区之前')
})

test('混合结构成果：文档交付物与自定义区块同时渲染', () => {
  const result = resultSchema.parse({
    title: '混合结构成果',
    status: 'ready',
    summary: '包含一份文档与一段自定义说明。',
    artifacts: [{ id: 'doc', kind: 'document', title: '分析说明', content: '# 分析说明\n\n正文内容。' }],
    sections: [{ kind: 'custom', id: 'extra', title: '补充说明', blocks: [{ type: 'text', text: '这是自定义区块的正文。' }] }],
    note: '本地模拟数据。',
  })
  const html = render(result)
  assert(html.includes('混合结构成果'))
  assert(html.includes('本轮交付'))
  assert(html.includes('分析说明'))
  assert(html.includes('补充说明'))
  assert(!html.includes('role="tablist"'))
})
