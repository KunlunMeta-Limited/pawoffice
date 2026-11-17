import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, conferenceLocalOffices, officeResultSchema, ResultWorkspace, ResultBodyPresentation, WhiteboardNotes
before(async () => {
  server = await createTestServer()
  ;({ conferenceLocalOffices } = await server.ssrLoadModule('/apps/web/src/conference/demoScenarios.ts'))
  ;({ officeResultSchema } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  ;({ ResultWorkspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  ;({ ResultBodyPresentation } = await server.ssrLoadModule('/apps/web/src/results/bodyPresentation.ts'))
  ;({ WhiteboardNotes } = await server.ssrLoadModule('/apps/web/src/conference/WhiteboardNotes.tsx'))
})
after(() => server?.close())

test('SEO delivery is ready on entry with complete copy, linked evidence and publication boundaries', () => {
  const offices = conferenceLocalOffices()
  const { source } = offices.find(office => office.id === 'office-demo-seo')
  const main = source.getConversations()[0], result = officeResultSchema.parse(main.whiteboard.result)
  assert(main.tasks.every(task => task.status === 'completed' && task.progress === 100))
  assert.equal(main.whiteboard.status, 'completed')
  assert.equal(result.artifacts.length, 6)
  assert.equal(result.sections.length, 3)
  const artifact = id => result.artifacts.find(file => file.id === id)
  const copy = artifact('copy').content
  for (const content of ['页面标题', '页面摘要', 'H1', '首屏导语', '常见问题', '17 英寸', '图片文字', '编辑交接']) assert(copy.includes(content), content)
  assert(copy.length > 900)
  assert.equal(artifact('keywords').content.split('\n').length, 7)
  assert.equal(artifact('links').content.split('\n').length, 4)
  assert.equal(artifact('issues').mimeType, 'text/csv')
  for (let i = 1; i <= 6; i++) {
    assert(artifact('report').content.includes(`SEO-0${i}`))
    assert(artifact('issues').content.includes(`SEO-0${i}`))
  }
  assert.equal(result.checks.filter(check => check.status === 'passed').length, 5)
  assert.equal(result.checks.filter(check => check.status === 'pending').length, 3)
  assert.match(result.verdict, /线上发布和搜索效果另行验收/)
  assert.match(artifact('release').content, /发布前后各取 28 天/)
  assert.match(result.note, /本地案例成果/)
  assert(!result.metrics.some(metric => /流量|排名|增长|CTR/.test(metric.label)))
  assert.equal(offices.find(office => office.id === 'office-demo-social').source.scenario.resultOnly, undefined)
})

test('the whiteboard opens with separate diagnosis, comparison and linking notes', () => {
  const { source } = conferenceLocalOffices().find(office => office.id === 'office-demo-seo')
  const board = source.getConversations()[0].whiteboard
  const html = renderToStaticMarkup(createElement(ResultBodyPresentation.Provider,
    { value: props => createElement(WhiteboardNotes, props) }, createElement(ResultWorkspace, { board, result: board.result })))
  for (const title of ['页面诊断与优先级', '修改前后对照', '关键词与内链布局', '交付文件', '验证与验收', '下一步']) assert(html.includes(title), title)
  assert(html.indexOf('页面诊断与优先级') < html.indexOf('交付文件'))
  assert(!html.includes('当前没有可阅读的成果内容'))
})
