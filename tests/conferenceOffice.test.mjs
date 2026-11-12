// Temporary regression coverage; remove with apps/web/src/conference.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, runtime, DemoOfficeDirectory, createOfficeDataSource, conferenceLocalOffices, OfficeOverview, OfficeIntegrationSession, OfficeTeamSession, createOfficeRuntime
let readDemoReport, demoReportMarkdown, DemoReportCard, ConferenceChatSource
const flush = () => new Promise(resolve => setImmediate(resolve))
before(async () => {
  server = await createTestServer()
  runtime = await server.ssrLoadModule('/apps/web/src/conference/frameRuntime.ts')
  ;({ conferenceLocalOffices } = await server.ssrLoadModule('/apps/web/src/conference/demoScenarios.ts'))
  ;({ DemoOfficeDirectory } = await server.ssrLoadModule('/apps/web/src/dashboard/demoOfficeDirectory.ts'))
  ;({ createOfficeDataSource } = await server.ssrLoadModule('/apps/web/src/dashboard/createSource.ts'))
  ;({ OfficeOverview } = await server.ssrLoadModule('/apps/web/src/conference/ConferenceWorkspace.tsx'))
  ;({ OfficeIntegrationSession } = await server.ssrLoadModule('/apps/web/src/application/OfficeIntegrationSession.ts'))
  ;({ OfficeTeamSession } = await server.ssrLoadModule('/apps/web/src/application/OfficeTeamSession.ts'))
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ readDemoReport, demoReportMarkdown } = await server.ssrLoadModule('/apps/web/src/conference/demoReports.ts'))
  ;({ DemoReportCard } = await server.ssrLoadModule('/apps/web/src/conference/DemoReportCard.tsx'))
  ;({ ConferenceChatSource } = await server.ssrLoadModule('/apps/web/src/conference/ConferenceChatSource.ts'))
})
after(() => server?.close())
async function setup(t, definitions = conferenceLocalOffices().slice(0, 3)) {
  const offices = definitions.map(office => ({ ...office, session: runtime.localOfficeSession(office) }))
  const hosts = offices.map(office => runtime.independentDemoHost(office.session))
  await Promise.all(offices.map(office => office.session.refresh()))
  await flush()
  t.after(() => { hosts.forEach(host => host.stop()); offices.forEach(({ session }) => { session.simulation.dispose(); session.runtime.dispose() }) })
  return { offices, hosts, refresh: () => Promise.all(offices.map(office => office.session.refresh())) }
}

test('all eight overview demos use one main conversation and the classic offices keep their own chats', async t => {
  const { offices } = await setup(t, conferenceLocalOffices())
  const original = new DemoOfficeDirectory(createOfficeDataSource()).list()
  assert.equal(offices.length, 8)
  assert.equal(new Set(offices.map(office => office.id)).size, 8)
  assert.deepEqual(offices.slice(0, 3).map(({ id, name }) => ({ id, name })), original.map(({ id, name }) => ({ id, name })))
  for (const office of original) {
    assert.deepEqual(office.source.getConversations().map(item => item.id), ['main', 'product-assets', 'conversion-review'])
  }
  for (const { source, session } of offices) {
    assert.equal(source.kind, 'example')
    assert.equal(session.simulation.canDemo, true)
    assert.equal(session.ui.enabled, false)
    assert.equal(session.getSnapshot().connection, '本地示例')
    assert.ok(session.chat.source instanceof ConferenceChatSource)
    assert.deepEqual(session.chat.getSnapshot().conversations.map(item => item.id), ['main'])
    assert.equal(session.chat.selected.getSnapshot().messages.length, 0)
  }
  for (const { session } of offices.slice(0, 3)) assert.notEqual(session.chat.source.historyKey, 'commerce-demo-v1')
  for (const { session } of offices.slice(3)) assert.equal(session.chat.source.historyKey, 'commerce-demo-v1')
})

test('starting, stopping and replaying one demo cannot start or reset the other two offices', async t => {
  const { offices, hosts, refresh } = await setup(t)
  const snapshots = await Promise.all(offices.map(office => office.source.getSnapshot()))
  const [one, two, three] = offices.map(office => office.session)
  one.simulation.setDemo(true)
  hosts.forEach(host => host.advance(1000)); await refresh(); await flush()
  assert.equal(one.simulation.isDemoRunning, true)
  assert.equal(two.simulation.isDemoRunning, false)
  assert.equal(three.simulation.isDemoRunning, false)
  assert.deepEqual(await offices[1].source.getSnapshot(), snapshots[1])
  assert.deepEqual(await offices[2].source.getSnapshot(), snapshots[2])
  assert.deepEqual(offices.map(office => runtime.previewOf('test', false, office, 'members').activity.running), [true, false, false])
  two.simulation.setDemo(true); await refresh()
  const second = await offices[1].source.getSnapshot()
  one.simulation.setDemo(false); await refresh()
  assert.equal(two.simulation.isDemoRunning, true)
  assert.deepEqual(await offices[1].source.getSnapshot(), second)
  one.simulation.setDemo(true); await refresh()
  assert.equal(two.simulation.isDemoRunning, true)
  assert.deepEqual(await offices[1].source.getSnapshot(), second)
  assert.deepEqual(await offices[2].source.getSnapshot(), snapshots[2])
})

test('running counts use all business conversations, rather than animation or connection state', () => {
  const current = { tasks: [], events: [], whiteboard: { title: '当前会话' } }
  const background = { tasks: [{ status: 'running' }], events: [], whiteboard: { title: '后台任务' } }
  assert.equal(runtime.officeActivity([current, background], current).running, true)
  assert.equal(runtime.officeActivity([current, background], current, 1).status, 'attention')
  assert.equal(runtime.officeActivity([current], current).running, false)
  assert.equal(runtime.officeActivity([background], current, 0, true).running, false)
})

test('formal entry stays available with truthful unconfigured, awaiting initialization and disconnected states', () => {
  assert.equal(runtime.formalPlaceholder(false).connection, '未连接')
  assert.equal(runtime.formalPlaceholder(true, '已连接').connection, '等待初始化')
  assert.equal(runtime.formalPlaceholder(true, '重连中').connection, '重连中')
  assert.equal(runtime.formalPlaceholder(false).connected, true)
  assert.notEqual(runtime.officeKey(true, 'office-1'), runtime.officeKey(false, 'office-1'))
})

test('PixOffice-style overview preserves ratio, count-only heading, running glow, current marker and formal identification', async t => {
  const { offices } = await setup(t, conferenceLocalOffices())
  offices[0].session.simulation.setDemo(true)
  await offices[0].session.refresh()
  const entries = [runtime.formalPlaceholder(false), ...offices.map(office => runtime.previewOf('test', false, office, 'members'))]
  entries[2] = { ...entries[2], decisionCount: 1 }
  entries[4] = runtime.localOfficePreview(offices[3], 'classic')
  const images = { [entries[1].id]: 'blob:cached-office-preview' }
  const html = renderToStaticMarkup(createElement(OfficeOverview, {
    offices: entries, images, selectedId: entries[1].id, onSelect() {}, onClose() {}, livePreviews: false, onToggleLivePreviews() {},
  }))
  assert.match(html, /9 个办公室/)
  assert.match(html, /1\/9 个办公室运行中 · 1 项待确认 · 返回办公室/)
  assert.match(html, /data-running="true"/)
  assert.match(html, /当前办公室/)
  assert.match(html, /class="runtime-workspace /)
  assert.match(html, /检查页面标题与描述/)
  assert.match(html, /src="blob:cached-office-preview"/)
  assert.match(html, /src="[^"]*assets\/office\/preview\.webp"/)
  assert.match(html, /role="switch" class="dispatch-live-preview-toggle" aria-checked="false"[^>]*>实时预览<span aria-hidden="true">关<\/span>/)
  assert.match(html, /正式连接 · 未连接/)
  assert.match(html, /aria-label="进入正式办公室"/)
  assert.doesNotMatch(html, /新建办公室|dispatch-office-create/)
  assert.doesNotMatch(html, /conference-source-label/)
  assert.match(html, /商品视觉团队，1 项待确认/)
  for (const name of ['SEO优化办公室', '报税办公室', '自媒体运营办公室', '信息采集办公室', '多入口信息归纳办公室']) {
    assert.ok(html.includes(`aria-label="进入${name}"`))
  }
  assert.doesNotMatch(html, /大会|办公室与场景演示/)
})

async function answerDemoQuestions(t, chats, inputs) {
  const sending = chats.map((chat, index) => chat.send(inputs[index]))
  for (let tick = 0; tick < 200 && chats.some(chat => chat.getSnapshot().phase !== 'idle'); tick++) {
    await flush()
    t.mock.timers.tick(100)
  }
  assert.ok(chats.every(chat => chat.getSnapshot().phase === 'idle'))
  await Promise.all(sending)
  return chats.map(chat => {
    const message = chat.getSnapshot().messages.at(-1)
    assert.equal(message.role, 'assistant')
    assert.equal(message.state, 'complete')
    return message.content
  })
}

function advanceUntil(host, condition, limitMs = 60000) {
  for (let elapsed = 0; elapsed < limitMs && !condition(); elapsed += 50) host.advance(50)
  assert.ok(condition(), 'the office did not reach the expected stage')
}

test('all eight offices answer the current question using their own keywords', async t => {
  const { offices } = await setup(t, conferenceLocalOffices())
  const chats = offices.map(({ session }) => session.chat.selected)
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const questions = [
    [['这款支架多少钱？', /79 元/], ['上架前要检查什么？', /主图.+详情/]],
    [['主图应该怎么拍？', /支架/], ['详情页怎么安排尺寸说明？', /13–16 英寸/]],
    [['成交率怎么算？', /2\.5%.+4\.0%/], ['购买咨询主要是什么问题？', /10 条.+6 条/]],
    [['Ｈ１ 标题怎么写？', /H1.+「折叠电脑支架」/], ['关键词和内链怎么安排？', /便携笔记本支架.+六档调节支架/]],
    [['要准备哪些材料？', /收入与支出台账|收支台账/], ['哪几条凭证要补？', /P-04.+付款凭证编号.+R-06.+入账凭证编号/]],
    [['短视频的脚本是什么？', /整理线材/], ['周几发，排期怎么安排？', /周一.+周三.+周五/]],
    [['从哪里采集？', /园区活动页、主办方公告和订阅简报/], ['有多少条，去重了吗？', /3 条重复记录.+15 条|15 条.+3 条是重复记录/]],
    [['群聊说了什么？', /B 版封面|封面换成 B 版/], ['延期时以哪个时间为准？', /周三 15:00/]],
  ]
  for (const round of [0, 1]) {
    const answers = await answerDemoQuestions(t, chats, questions.map(pair => pair[round][0]))
    answers.forEach((answer, index) => assert.match(answer, questions[index][round][1]))
  }
  const repeatedInputs = questions.map(pair => pair[1][0])
  const first = await answerDemoQuestions(t, chats, repeatedInputs)
  const second = await answerDemoQuestions(t, chats, repeatedInputs)
  second.forEach((answer, index) => {
    assert.notEqual(answer, first[index])
    assert.match(answer, questions[index][1][1])
  })
  const unmatched = await answerDemoQuestions(t, chats, chats.map(() => '明天会下雨吗？'))
  assert.ok(unmatched.every(answer => answer.includes('可以问我')))
  assert.ok(unmatched.every(answer => !answer.includes('演示')))
  const [combined] = await answerDemoQuestions(t, [chats[3]], ['标题和内链怎么改？'])
  assert.match(combined, /折叠电脑支架｜六档调节与便携收纳/)
  assert.match(combined, /产品对比.+产品页/)
})

test('demo chat starts only an explicit local run and reports its actual progress and results', async t => {
  const { offices, hosts, refresh } = await setup(t, conferenceLocalOffices().slice(3, 5))
  const [seo, tax] = offices
  const chats = [seo.session.chat.selected]
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const ask = async question => (await answerDemoQuestions(t, chats, [question]))[0]

  assert.match(await ask('现在有结果吗？'), /当前没有任务在运行/)
  assert.match(await ask('可以先看成果预览吗？'), /交付内容的预览/)
  await ask('不要开始处理')
  assert.equal(seo.session.simulation.isDemoRunning, false)

  assert.match(await ask('请帮我开始处理。'), /已开始「产品页 SEO 检查」/)
  assert.equal(seo.session.simulation.isDemoRunning, true)
  assert.equal(tax.session.simulation.isDemoRunning, false)
  assert.match(await ask('现在进度如何？'), /王明正在交代「检查页面标题与描述」/)
  advanceUntil(hosts[0], () => seo.source.getConversations()[0].tasks[1].status === 'running')
  await refresh()
  assert.match(await ask('现在做到哪一步了？'), /已完成 1\/3 项。正在「整理关键词与内链」/)
  assert.match(await ask('结果出来了吗？'), /已完成 1\/3 项/)

  advanceUntil(hosts[0], () => !seo.session.simulation.isDemoRunning)
  await refresh()
  const firstResult = await ask('给我看最终结果。')
  const secondResult = await ask('给我看最终结果。')
  assert.match(firstResult, /SEO 优化清单/)
  assert.match(secondResult, /SEO 优化清单/)
  assert.notEqual(firstResult, secondResult)
  assert.equal(seo.session.simulation.isDemoRunning, false)
})

test('all eight offices produce their own themed reports in the main chat', async t => {
  const { offices } = await setup(t, conferenceLocalOffices())
  const chats = offices.map(({ session }) => session.chat.selected)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const answers = await answerDemoQuestions(t, chats, chats.map((_, index) => ['给我一份汇总', '发一下调研报告', '看看本轮业绩'][index % 3]))
  const reports = answers.map(readDemoReport)
  assert.ok(reports.every(report => report?.metrics.length === 3 && report.chart.rows.length > 0))
  assert.equal(new Set(reports.map(report => report.title)).size, 8)
  assert.equal(reports[0].status, '交付内容的预览')
  assert.equal(reports[0].metrics[0].value, '79 元')
  assert.equal(reports[1].metrics[1].value, '13–16 英寸')
  assert.deepEqual(reports[2].chart.rows.map(row => row.value), [2.5, 4])
  assert.match(reports[4].findings[0].detail, /P-04/)
  assert.equal(reports[6].chart.rows[2].value, 13)
  const html = renderToStaticMarkup(createElement(DemoReportCard, { report: reports[3] }))
  assert.match(html, /<h2>产品页 SEO 优化调研报告<\/h2>/)
  assert.match(html, /<figure class="demo-report-chart">/)
  assert.match(demoReportMarkdown(reports[3]), /^# 产品页 SEO 优化调研报告/)
  assert.equal(readDemoReport(answers[3].slice(0, -2)), undefined)

  const [started] = await answerDemoQuestions(t, [chats[1]], ['开始审核素材'])
  assert.match(started, /已开始「折叠电脑支架素材审核」/)
  assert.equal(offices[1].session.simulation.isDemoRunning, true)
  assert.equal(offices[2].session.simulation.isDemoRunning, false)
})

test('demo chat waits a randomized interval before its first reply and can be cancelled during the wait', async t => {
  t.mock.method(Math, 'random', () => 0.75)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const source = new ConferenceChatSource(() => '答复')
  const controller = new AbortController()
  const response = source.stream({ messages: [] }, controller.signal)
  assert.deepEqual((await response.next()).value, { type: 'status', phase: 'thinking' })
  let received = false
  const first = response.next().then(event => { received = true; return event.value })
  t.mock.timers.tick(1749)
  await flush()
  assert.equal(received, false)
  t.mock.timers.tick(1)
  assert.deepEqual(await first, { type: 'delta', text: '答复' })

  const waiting = source.stream({ messages: [] }, controller.signal)
  await waiting.next()
  const pending = waiting.next()
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('each of the eight offices waits for the leader handoff and can stop and replay independently', async t => {
  const { offices, hosts, refresh } = await setup(t, conferenceLocalOffices())
  const groups = new Set()
  for (const [index, office] of offices.entries()) {
    const others = offices.filter(candidate => candidate !== office)
    const before = await Promise.all(others.map(({ source }) => source.getSnapshot()))
    office.session.simulation.setDemo(true)
    await refresh()
    assert.equal(runtime.previewOf('test', false, office, 'members').activity.running, true)
    const statuses = () => office.source.getConversations()[0].tasks.map(task => task.status)
    const leaderPosition = () => office.session.runtime.readActors().find(actor => actor.id === 'office-lead').position
    const { x, y } = leaderPosition()
    assert.deepEqual(statuses(), ['queued', 'queued', 'queued'])
    advanceUntil(hosts[index], () => leaderPosition().x !== x || leaderPosition().y !== y)
    assert.deepEqual(statuses(), ['queued', 'queued', 'queued'])
    const visit = office.session.runtime.snapshot().records.find(record => record.command.capability === 'office.visit')
    const receivers = visit.command.participants.filter(participant => participant.role === 'host').map(participant => participant.entityId)
    assert.deepEqual(receivers, office.source.getConversations()[0].tasks.map(task => task.assigneeId))
    groups.add([...receivers].sort().join(','))

    advanceUntil(hosts[index], () => statuses()[1] === 'running')
    await refresh()
    assert.deepEqual((await office.source.getSnapshot()).tasks.map(task => task.status), ['completed', 'running', 'queued'])
    office.session.simulation.setDemo(false)
    await refresh()
    assert.equal((await office.source.getSnapshot()).whiteboard.status, 'queued')
    assert.equal(office.session.simulation.isDemoRunning, false)

    office.session.simulation.setDemo(true)
    if (office.id === 'office-1') {
      const { decisions } = office.session
      advanceUntil(hosts[index], () => decisions.getSnapshot().pending.length > 0)
      const [decision] = decisions.getSnapshot().pending
      assert.equal(decision.conversationId, 'main')
      assert.match(decision.title, /确认按 79 元上架/)
      assert.deepEqual(statuses(), ['completed', 'completed', 'queued'])
      assert.ok(await decisions.choose(office.id, decision.id, 'confirm'))
    }
    advanceUntil(hosts[index], () => !office.session.simulation.isDemoRunning)
    await refresh()
    assert.equal((await office.source.getSnapshot()).whiteboard.status, 'completed')
    assert.equal(office.session.simulation.isDemoRunning, false)
    assert.deepEqual(await Promise.all(others.map(({ source }) => source.getSnapshot())), before)
  }
  assert.equal(groups.size, 8)
})

test('backend initialization, reconnection reconciliation and restart leave independent demos intact, even with identical raw IDs', async t => {
  const { offices, refresh } = await setup(t), runtimes = [], connections = []
  const integration = new OfficeIntegrationSession({ transport: { connect(options) { connections.push(options); return () => {} } }, reply: async () => {},
    createSession: (source, sceneId) => { const scene = createOfficeRuntime({ sceneId, referenceLayout: true }); runtimes.push(scene); return new OfficeTeamSession(scene, source) } })
  t.after(() => { integration.stop(); runtimes.forEach(scene => scene.dispose()) })
  await integration.start(); connections[0].onStatus('已连接')
  const syncStart = stateId => ({ type: 'office.sync.start', stateId, layout: { currentLayoutId: 'classic', revision: 0 } })
  const snapshot = { schemaVersion: '1.0', seq: 1, workspace: { id: offices[0].id, name: '后端正式办公室' }, conversations: [{ id: 'main', title: '真实任务', employees: [], tasks: [], events: [], whiteboard: { template: 'task-board-v1', title: '', status: 'queued', steps: [] } }] }
  integration.receive(syncStart('server-one')); integration.receive({ type: 'office.sync', snapshot }); await flush()
  const live = integration.getSnapshot().offices[0]
  assert.equal(live.session.simulation.canDemo, false)
  offices[0].session.simulation.setDemo(true); await refresh()
  const before = await offices[0].source.getSnapshot()
  integration.receive({ type: 'office.sync', snapshot: { ...snapshot, seq: 2 } }); await flush()
  assert.equal(integration.getSnapshot().offices[0].session, live.session)
  assert.deepEqual(await offices[0].source.getSnapshot(), before)
  integration.receive(syncStart('server-two')); integration.receive({ type: 'office.sync.complete', offices: [] }); await flush()
  assert.equal(integration.getSnapshot().offices.length, 0)
  assert.equal(offices[0].session.isStarted, true)
  assert.equal(offices[0].session.simulation.isDemoRunning, true)
  assert.deepEqual(await offices[0].source.getSnapshot(), before)
  assert.equal(offices[1].session.simulation.isDemoRunning, false)
  integration.receive({ type: 'office.sync', snapshot }); await flush()
  assert.equal(integration.getSnapshot().offices[0].source.readSnapshot().workspace.name, '后端正式办公室')
  assert.deepEqual(await offices[0].source.getSnapshot(), before)
})

test('listing pauses for a decision, a rejection stops the current run, and replay gets a fresh decision', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { offices, hosts, refresh } = await setup(t)
  const [{ id, source, session }] = offices
  const { chat, decisions, simulation } = session
  const pending = () => decisions.getSnapshot().pending[0]
  const report = async () => readDemoReport((await answerDemoQuestions(t, [chat.selected], ['发一下上架报告']))[0])

  simulation.setDemo(true)
  advanceUntil(hosts[0], pending)
  const first = pending()
  for (let tick = 0; tick < 200; tick++) hosts[0].advance(50)
  assert.equal((await report()).status, '待确认上架')
  assert.equal(source.getConversations()[0].tasks.at(-1).progress, 0)
  assert.ok(await decisions.choose(id, first.id, 'reject'))
  advanceUntil(hosts[0], () => !simulation.isDemoRunning)
  assert.equal((await report()).status, '暂不上架')

  simulation.setDemo(true)
  advanceUntil(hosts[0], pending)
  const interrupted = pending()
  assert.notEqual(interrupted.id, first.id)
  // Deleting the conversation while the walkthrough runs would silently drop the work, so it is refused.
  await assert.rejects(chat.remove('main'), /请先停止演示再删除/)
  assert.equal(chat.getSnapshot().selectedId, 'main')
  assert.equal(pending()?.id, interrupted.id)
  assert.equal(simulation.isDemoRunning, true)
  // After stopping, deleting is allowed; the next run restores and selects the scenario conversation.
  simulation.setDemo(false)
  await chat.remove('main')
  assert.equal(pending(), undefined)

  simulation.setDemo(true)
  assert.equal(chat.getSnapshot().selectedId, 'main')
  advanceUntil(hosts[0], pending)
  assert.notEqual(pending().id, interrupted.id)
  assert.ok(await decisions.choose(id, pending().id, 'confirm'))
  advanceUntil(hosts[0], () => !simulation.isDemoRunning)
  await refresh()
  assert.equal((await report()).status, '本轮完成')
  assert.equal(session.getSnapshot().dashboard.whiteboard.status, 'completed')
})
