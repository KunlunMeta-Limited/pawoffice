import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createTestServer } from './helpers/vite.mjs'

let server, conferenceLocalOffices, editorialReply, officeResultSchema, cycleChatReport, readDemoReport
before(async () => {
  server = await createTestServer()
  ;({ conferenceLocalOffices } = await server.ssrLoadModule('/apps/web/src/conference/demoScenarios.ts'))
  ;({ editorialReply } = await server.ssrLoadModule('/apps/web/src/conference/demoEditorial.ts'))
  ;({ officeResultSchema } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  ;({ cycleChatReport, readDemoReport } = await server.ssrLoadModule('/apps/web/src/conference/demoReports.ts'))
})
after(() => server?.close())

test('five editorial rounds deliver distinct platform drafts, traceable sources and truthful publication states', () => {
  const { source } = conferenceLocalOffices().find(office => office.id === 'office-demo-social')
  const platforms = new Set(), titles = new Set()
  for (let round = 0; round < 5; round++) {
    const current = source.currentCase, plan = current.editorial
    assert.equal(plan.account, '一平米办公笔记')
    assert.equal(plan.drafts.length, 3)
    const sourceIds = new Set(plan.sources.map(item => item.id))
    source.showProgress(15, new Set(source.scenario.steps.map(step => step.assigneeId)))
    const result = officeResultSchema.parse(source.getConversations()[0].whiteboard.result)
    assert.equal(result.title, current.title)
    titles.add(result.title)
    assert.equal(result.artifacts.length, 5)
    assert.equal(result.artifacts.filter(item => item.kind === 'image').length, 0, '分镜不可冒充成品图片')
    assert.equal(result.metrics.find(item => item.id === 'published').value, '0')
    assert.equal(result.metrics.find(item => item.id === 'storyboards').value, String(plan.drafts.reduce((total, draft) => total + draft.pages.length, 0)))
    assert.equal(result.checks.filter(item => item.status === 'pending').length, 2)
    for (const [index, draft] of plan.drafts.entries()) {
      platforms.add(draft.platform)
      assert(draft.body.length >= (draft.format === '图文作品' ? 80 : 120), draft.title)
      assert(draft.sourceIds.length && draft.sourceIds.every(id => sourceIds.has(id)), draft.title)
      assert(result.artifacts[index + 2].content.includes(draft.body), '实际正文应可阅读与导出')
      assert(result.artifacts[index + 2].content.includes(draft.review))
      assert(result.artifacts[1].content.includes(draft.slot))
      for (const page of draft.pages) {
        assert(page.copy && page.visual)
        assert(result.artifacts[index + 2].content.includes(page.copy))
      }
    }
    source.advanceRound()
  }
  assert.equal(titles.size, 5)
  assert.deepEqual([...platforms].sort(), ['小红书', '微信公众号', '今日头条', '知乎', '百家号', '抖音'].sort())
})

test('chat exposes actual copy and image briefs without inventing unsupported platforms or fresh performance', () => {
  const { source } = conferenceLocalOffices().find(office => office.id === 'office-demo-social')
  const plan = source.currentCase.editorial
  assert(editorialReply(plan, '给我看小红书正文').includes(plan.drafts[0].body))
  assert(editorialReply(plan, '公众号完整稿件').includes(plan.drafts[1].body))
  assert.match(editorialReply(plan, '配图每页写什么'), /第|封面/)
  assert(editorialReply(plan, '配图每页写什么').includes(plan.drafts[0].pages[5].copy))
  assert.match(editorialReply(plan, '知乎正文'), /本轮没有安排知乎/)
  assert.match(editorialReply(plan, '阅读量怎么样'), /尚未发布，没有本轮/)
  assert.match(editorialReply(plan, '排期怎么安排'), /尚未发布/)
  assert.equal(editorialReply(plan, '明天会下雨吗'), undefined)

  const preview = readDemoReport(cycleChatReport(source.currentCase, '自媒体运营办公室', '本轮预览', '当前没有任务在运行。'))
  assert(!preview.summary.includes(source.currentCase.summary), '预览不声称已完成交付')
  for (let i = 0; i < 4; i++) source.advanceRound()
  const retrospective = editorialReply(source.currentCase.editorial, '旧内容数据')
  assert.match(retrospective, /72 小时/)
  assert.match(retrospective, /不是本轮待发稿的成绩/)
  assert.match(retrospective, /不合并阅读量/)
})
