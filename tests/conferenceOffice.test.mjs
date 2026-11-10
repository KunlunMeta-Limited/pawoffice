// Temporary regression coverage; remove with apps/web/src/conference.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, runtime, DemoOfficeDirectory, createOfficeDataSource, OfficeOverview, OfficeIntegrationSession, OfficeTeamSession, createOfficeRuntime
const flush = () => new Promise(resolve => setImmediate(resolve))
before(async () => {
  server = await createTestServer()
  runtime = await server.ssrLoadModule('/apps/web/src/conference/frameRuntime.ts')
  ;({ DemoOfficeDirectory } = await server.ssrLoadModule('/apps/web/src/dashboard/demoOfficeDirectory.ts'))
  ;({ createOfficeDataSource } = await server.ssrLoadModule('/apps/web/src/dashboard/createSource.ts'))
  ;({ OfficeOverview } = await server.ssrLoadModule('/apps/web/src/conference/ConferenceWorkspace.tsx'))
  ;({ OfficeIntegrationSession } = await server.ssrLoadModule('/apps/web/src/application/OfficeIntegrationSession.ts'))
  ;({ OfficeTeamSession } = await server.ssrLoadModule('/apps/web/src/application/OfficeTeamSession.ts'))
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
})
after(() => server?.close())
async function setup(t) {
  const offices = new DemoOfficeDirectory(createOfficeDataSource()).list().map(office => ({ ...office, session: runtime.localOfficeSession(office) }))
  const hosts = offices.map(office => runtime.independentDemoHost(office.session))
  await Promise.all(offices.map(office => office.session.refresh()))
  await flush()
  t.after(() => { hosts.forEach(host => host.stop()); offices.forEach(({ session }) => { session.simulation.dispose(); session.runtime.dispose() }) })
  return { offices, hosts, refresh: () => Promise.all(offices.map(office => office.session.refresh())) }
}

test('reuses the original three offices, original commerce content, and local-only capabilities', async t => {
  const { offices } = await setup(t)
  assert.deepEqual(offices.map(office => office.id), ['office-1', 'office-content', 'office-analysis'])
  assert.deepEqual(offices.map(office => office.name), ['电商运营团队', '商品视觉团队', '经营分析团队'])
  for (const { source, session } of offices) {
    assert.equal(source.kind, 'example')
    assert.equal(session.simulation.canDemo, true)
    assert.equal(session.ui.enabled, false)
    assert.equal(session.getSnapshot().connection, '本地示例')
    assert.equal(session.chat.source.kind, 'preview')
    assert.match(session.getSnapshot().dashboard.whiteboard.title, /电脑支架/)
  }
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
  const { offices } = await setup(t)
  offices[0].session.simulation.setDemo(true)
  await offices[0].session.refresh()
  const entries = [runtime.formalPlaceholder(false), ...offices.map(office => runtime.previewOf('test', false, office, 'members'))]
  entries[2] = { ...entries[2], decisionCount: 1 }
  const html = renderToStaticMarkup(createElement(OfficeOverview, { offices: entries, images: {}, selectedId: entries[1].id, onSelect() {}, onClose() {} }))
  assert.match(html, /4 个办公室/)
  assert.match(html, /1\/4 个办公室运行中 · 1 项待确认 · 返回办公室/)
  assert.match(html, /data-running="true"/)
  assert.match(html, /当前办公室/)
  assert.match(html, /正式连接 · 未连接/)
  assert.match(html, /aria-label="进入正式办公室"/)
  assert.doesNotMatch(html, /新建办公室|dispatch-office-create/)
  assert.doesNotMatch(html, /conference-source-label/)
  assert.match(html, /商品视觉团队，1 项待确认/)
  assert.doesNotMatch(html, /大会|办公室与场景演示|SEO优化|报税办公室/)
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

test('each original office can finish its complete commerce story alone without changing either other office', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 })
  const { offices, hosts, refresh } = await setup(t)
  for (let index = 0; index < offices.length; index++) {
    const before = await Promise.all(offices.map(office => office.source.getSnapshot()))
    const owner = offices[index].session
    owner.simulation.setDemo(true)
    for (let elapsed = 0; elapsed < 100000 && offices[index].source.stage !== 'completed'; elapsed += 50) {
      const decision = owner.decisions.getSnapshot().pending[0]
      if (decision) await owner.decisions.choose(owner.runtime.sceneId, decision.id, decision.kind === 'confirmation' ? 'confirm' : 'information')
      hosts[index].advance(50); t.mock.timers.tick(50); await flush()
    }
    await refresh()
    assert.equal(offices[index].source.stage, 'completed', offices[index].name)
    assert.equal(owner.getSnapshot().dashboard.whiteboard.status, 'completed')
    for (let other = 0; other < offices.length; other++) if (other !== index) {
      assert.deepEqual(await offices[other].source.getSnapshot(), before[other], `${offices[other].name} must stay independent`)
    }
  }
})
