import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createTestServer } from './helpers/vite.mjs'

let server, createOfficeRuntime, DashboardSceneBridge, createReferenceOfficePresentation, officeActorTasks,
  OfficeIntegrationSession, OfficeTeamSession, createSceneRuntime, referenceOfficeScenePack, z
before(async () => {
  server = await createTestServer()
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ DashboardSceneBridge } = await server.ssrLoadModule('/apps/web/src/dashboard/sceneBridge.ts'))
  ;({ createReferenceOfficePresentation } = await server.ssrLoadModule('/packages/scene-office/src/pixi/index.ts'))
  ;({ officeActorTasks } = await server.ssrLoadModule('/apps/web/src/dashboard/actorTasks.ts'))
  ;({ OfficeIntegrationSession } = await server.ssrLoadModule('/apps/web/src/application/OfficeIntegrationSession.ts'))
  ;({ OfficeTeamSession } = await server.ssrLoadModule('/apps/web/src/application/OfficeTeamSession.ts'))
  ;({ createSceneRuntime } = await server.ssrLoadModule('/packages/runtime/src/createSceneRuntime.ts'))
  ;({ referenceOfficeScenePack } = await server.ssrLoadModule('/packages/scene-office/src/core/index.ts'))
  ;({ z } = await server.ssrLoadModule('zod'))
})
after(() => server?.close())
const base = (commandId, sceneId = 'office-1') => ({ protocolVersion: '2.0', sceneId, commandId })
const say = (commandId, actor = 'office-lead', durationMs = 300, sceneId = 'office-1') => ({ ...base(commandId, sceneId),
  type: 'activity.start', capability: 'scene.say', participants: [{ entityId: actor, role: 'actor' }], params: { text: commandId, durationMs } })
const advance = (runtime, ms) => { for (let i = 0; i < ms; i += 50) runtime.tick(50) }
function until(runtime, condition) {
  for (let i = 0; i < 3000; i++) { if (condition()) return; runtime.tick(50) }
  assert.fail('Ordered execution did not settle')
}
function fixture(t, options = {}) {
  const runtime = options.runtime ?? createOfficeRuntime({ referenceLayout: true, ...options })
  t.after(() => runtime.dispose())
  const data = { schemaVersion: '1.0', seq: 1, workspace: { id: runtime.sceneId, name: 'Ordered office' },
    employees: runtime.readActors().map(actor => ({ id: actor.id, name: actor.name, sceneActorId: actor.id })),
    tasks: [], events: [], whiteboard: { template: 'task-board-v1', title: '', status: 'queued', steps: [] } }
  let displayed = structuredClone(data)
  const commits = [], bridge = new DashboardSceneBridge(runtime)
  const sync = () => bridge.sync(data, { presented: next => { displayed = next; commits.push(next.seq) } })
  sync()
  const presentation = createReferenceOfficePresentation({ taskForActor: id => officeActorTasks(displayed).get(id) })
  const actor = (id = 'code-agent') => presentation.projectActors(runtime).find(actor => actor.id === id)
  const task = (status = 'running', title = 'Incoming work') => {
    data.seq++
    data.tasks = [{ id: 'work', title, assigneeId: 'code-agent', status, updatedAt: '2026-10-29T06:00:00Z' }]
    return sync()
  }
  return { runtime, data, bridge, actor, task, sync, commits, get displayed() { return displayed } }
}

const finiteActivities = {
  'scene.move': { participants: [{ entityId: 'office-lead', role: 'actor' }], params: { targetId: 'desk-1', anchor: 'conversationLeft' } },
  'scene.say': { participants: [{ entityId: 'office-lead', role: 'actor' }], params: { text: 'Wait for this speech', durationMs: 1500 } },
  'office.emote': { participants: [{ entityId: 'office-lead', role: 'actor' }], params: { animation: 'emotes/thinking', durationMs: 1500 } },
  'office.visit': { participants: [{ entityId: 'office-lead', role: 'visitor' }, { entityId: 'code-agent', role: 'host' }], params: { stops: [{ hostId: 'code-agent', message: 'Please take over' }], durationMs: 300 } },
  'office.meeting': { participants: [{ entityId: 'office-lead', role: 'speaker' }, { entityId: 'code-agent', role: 'attendee' }], params: { boardId: 'whiteboard-1', text: 'Discuss', durationMs: 1000 } },
  'furniture.use': { participants: [{ entityId: 'office-lead', role: 'user' }], params: { objectId: 'whiteboard-1', interactionId: 'write', durationMs: 1000 } },
}
for (const [capability, settings] of Object.entries(finiteActivities)) {
  test(`${capability} completes before a later snapshot can display work, task UI or whiteboard updates`, t => {
    const f = fixture(t, { referenceLayout: capability !== 'furniture.use' })
    assert.equal(f.runtime.submit({ ...base('first'), type: 'activity.start', capability, ...settings }, { ordered: true }).error, undefined)
    advance(f.runtime, 700)
    if (capability !== 'furniture.use') f.data.whiteboard = { template: 'task-board-v1', title: 'Next board', status: 'running', steps: [] }
    assert.deepEqual(f.task(), [])
    assert.equal(f.actor().intent.actionId, 'core.idle')
    assert.notEqual(f.actor().task?.status, 'running')
    assert.equal(f.displayed.seq, 1)
    until(f.runtime, () => f.runtime.getRecord('first').status === 'completed')
    assert.equal(f.actor().intent.actionId, 'office.type')
    assert.equal(f.actor().task.title, 'Incoming work')
    assert.equal(f.displayed.seq, 2)
    if (capability !== 'furniture.use') assert.equal(f.displayed.whiteboard.title, 'Next board')
  })
}

test('a newly added capability uses the same execution barrier without a capability allowlist', t => {
  const plugin = { id: 'test.extra', name: 'Future activity', apiVersion: 1, version: '1.0.0', capabilities: [{
    id: 'future.action', name: 'Future action', params: z.strictObject({}),
    build: context => ({ title: 'Future', claims: [{ resource: `actor:${context.participants[0].entityId}:body`, units: 1 }],
      phases: [{ title: 'Future', durationMs: 1500 }] }),
  }] }
  const runtime = createSceneRuntime({ ...referenceOfficeScenePack, plugins: [...referenceOfficeScenePack.plugins, plugin] })
  const f = fixture(t, { runtime })
  runtime.submit({ ...base('future'), type: 'activity.start', capability: 'future.action', participants: [{ entityId: 'office-lead', role: 'actor' }], params: {} }, { ordered: true })
  f.task()
  assert.equal(f.displayed.seq, 1)
  until(runtime, () => runtime.getRecord('future').status === 'completed')
  assert.equal(f.actor().intent.actionId, 'office.type')
})

test('snapshot commits stay between earlier and later commands and keep every live revision', t => {
  const f = fixture(t), observations = []
  f.runtime.submit(say('first'), { ordered: true })
  f.task('running', 'First work')
  f.runtime.submit(say('middle', 'file-agent'), { ordered: true })
  f.task('blocked', 'Next thought')
  f.task('completed', 'Finished')
  const unsubscribe = f.runtime.subscribe(() => observations.push({ work: f.actor().task?.title, middle: f.runtime.getRecord('middle')?.status }))
  t.after(unsubscribe)
  advance(f.runtime, 300)
  assert.equal(f.actor().task.title, 'First work')
  assert.equal(f.runtime.getRecord('middle').status, 'running')
  advance(f.runtime, 300)
  assert.equal(f.actor().task.title, 'Finished')
  assert.equal(f.actor().task.status, 'completed')
  assert.deepEqual(f.commits, [1, 2, 3, 4])
  assert(observations.some(item => item.work === 'First work' && item.middle === 'running'))
  assert(!observations.some(item => item.work === 'Next thought' && item.middle === 'running'))
})

test('a parallel batch is one barrier and waits for its longest activity', t => {
  const f = fixture(t)
  f.runtime.submit(say('lead-in'), { ordered: true })
  f.runtime.submitBatch({ mode: 'parallel', commands: [say('short', 'file-agent', 300), say('long', 'app-agent', 900)] })
  f.task()
  f.runtime.submit(say('last', 'data-agent'), { ordered: true })
  assert.equal(f.runtime.getRecord('short').status, 'queued')
  advance(f.runtime, 300)
  assert.equal(f.runtime.getRecord('short').status, 'running')
  assert.equal(f.runtime.getRecord('long').status, 'running')
  advance(f.runtime, 300)
  assert.equal(f.displayed.seq, 1)
  assert.equal(f.runtime.getRecord('last').status, 'queued')
  advance(f.runtime, 600)
  assert.equal(f.actor().task.status, 'running')
  assert.equal(f.runtime.getRecord('last').status, 'running')
})

test('yielding continuous work waits for actual seating, accepts progress and yields to a later action', t => {
  const f = fixture(t)
  f.runtime.submit({ ...base('away'), type: 'activity.start', capability: 'scene.move',
    participants: [{ entityId: 'code-agent', role: 'actor' }], params: { targetId: 'whiteboard-1', anchor: 'attendee1' } }, { ordered: true })
  until(f.runtime, () => f.runtime.getRecord('away').status === 'completed')
  f.runtime.submit({ ...base('focus'), type: 'activity.start', capability: 'office.focus',
    participants: [{ entityId: 'code-agent', role: 'worker' }], params: { title: 'Incoming work' } }, { ordered: true, continuous: 'yield' })
  f.task()
  advance(f.runtime, 700)
  assert.equal(f.displayed.seq, 1)
  until(f.runtime, () => f.displayed.seq === 2)
  assert.equal(f.actor().intent.actionId, 'office.type')
  f.runtime.submit(say('after-focus', 'code-agent'), { ordered: true, continuous: 'yield' })
  assert.equal(f.runtime.snapshot().activities.find(activity => activity.id === 'focus').status, 'cancelled')
  assert.equal(f.runtime.getRecord('after-focus').status, 'running')
})

test('completion stops a yielded focus even when its underlying presentation was still idle', t => {
  const f = fixture(t)
  f.runtime.submit({ ...base('focus'), type: 'activity.start', capability: 'office.focus',
    participants: [{ entityId: 'code-agent', role: 'worker' }], params: { title: 'Incoming work' } }, { ordered: true, continuous: 'yield' })
  f.task('completed')
  until(f.runtime, () => f.displayed.seq === 2)
  assert.equal(f.actor().task.status, 'completed')
  assert.notEqual(f.actor().intent.actionId, 'office.type')
  assert.equal(f.runtime.snapshot().activities.find(activity => activity.id === 'focus').status, 'cancelled')
})

test('failed, cancelled and invalid jobs do not poison later snapshots or batches', t => {
  const f = fixture(t)
  f.runtime.submit({ ...say('timeout', 'office-lead', 1000), timeoutMs: 100 }, { ordered: true })
  f.task()
  advance(f.runtime, 100)
  assert.equal(f.runtime.getRecord('timeout').status, 'failed')
  assert.equal(f.actor().task.status, 'running')
  f.runtime.submit(say('busy', 'office-lead', 1000), { ordered: true })
  f.task('blocked')
  f.runtime.submit({ ...base('cancel'), type: 'command.cancel', targetCommandId: 'busy' })
  assert.equal(f.actor().task.status, 'blocked')
  const conflict = f.runtime.submitBatch({ mode: 'parallel', commands: [say('busy', 'file-agent')] }, { ordered: true })
  assert.equal(conflict[0].error.code, 'COMMAND_ID_CONFLICT')
  const bad = f.runtime.enqueuePresentation(() => { throw new Error('Invalid projection') })
  assert.equal(bad.status, 'failed')
  f.task('completed')
  assert.equal(f.actor().task.status, 'completed')
})

test('stop cancels an activity that is still queued and cannot make it play later', t => {
  const f = fixture(t)
  f.runtime.submit(say('first', 'office-lead', 1000), { ordered: true })
  f.runtime.submit(say('never-start', 'file-agent'), { ordered: true })
  const stopped = f.runtime.submit({ ...base('stop-queued'), type: 'activity.stop', activityId: 'never-start' })
  assert.equal(stopped.status, 'completed')
  assert.equal(f.runtime.getRecord('never-start').status, 'cancelled')
  advance(f.runtime, 1500)
  assert(!f.runtime.snapshot().events.some(event => event.data.commandId === 'never-start' && event.data.status === 'running'))
})

test('presentation capacity is bounded and disposal cancels waiting commits without executing them', t => {
  const f = fixture(t), effects = []
  f.runtime.submit(say('blocker', 'office-lead', 30000), { ordered: true })
  let executed = 0
  for (let i = 0; i < 127; i++) effects.push(f.runtime.enqueuePresentation(() => { executed++ }))
  const overflow = f.runtime.enqueuePresentation(() => { executed++ })
  assert.equal(overflow.status, 'failed')
  assert.equal(overflow.errors[0].code, 'QUEUE_FULL')
  f.runtime.dispose()
  assert.equal(executed, 0)
  assert(effects.every(effect => effect.status === 'cancelled'))
})

test('expired presentation reports a failure without applying or presenting its snapshot', t => {
  let now = Date.now()
  const f = fixture(t, { now: () => now })
  f.runtime.submit(say('blocker', 'office-lead', 1000), { ordered: true })
  const results = []
  f.data.seq = 2
  f.bridge.sync(f.data, { presented: (data, errors, applied) => results.push({ seq: data.seq, errors, applied }) })
  now += 120001
  advance(f.runtime, 1000)
  assert.equal(results.length, 1)
  assert.equal(results[0].applied, false)
  assert.match(results[0].errors.join(), /PRESENTATION_FAILED/)
})

const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
async function connected(t) {
  const integration = new OfficeIntegrationSession({ transport: { connect() { return () => {} } }, reply: async () => {},
    createSession: (source, sceneId) => new OfficeTeamSession(createOfficeRuntime({ sceneId, referenceLayout: true }), source) })
  await integration.start()
  t.after(() => { for (const office of integration.getSnapshot().offices) office.session.runtime.dispose(); integration.stop() })
  const snapshot = { schemaVersion: '1.0', seq: 1, workspace: { id: 'office-1', name: 'Connected' }, conversations: [{ id: 'main', title: 'Main',
    employees: [{ id: 'writer', name: '陈书', sceneActorId: 'app-agent' }, { id: 'research', name: '李研', sceneActorId: 'code-agent' }, { id: 'lead', name: '王明', sceneActorId: 'office-lead' }],
    tasks: [], events: [], whiteboard: { template: 'task-board-v1', title: '', status: 'queued', steps: [] } }] }
  const send = async request => { integration.receive({ type: 'office.request', request, responseToken: `r-${globalThis.crypto.randomUUID()}`, remainingMs: 30000 }); await flush() }
  await send({ type: 'offices.initialize', offices: [snapshot] })
  const office = integration.getSnapshot().offices[0]
  return { integration, snapshot, send, office, runtime: office.session.runtime }
}

test('real office admission preserves snapshot order when later scene commands arrive in the same turn', async t => {
  const f = await connected(t)
  f.integration.receive({ teamId: 'office-1', command: say('first') })
  const next = structuredClone(f.snapshot); next.seq = 2
  next.conversations[0].tasks = [{ id: 'work', title: 'Work', assigneeId: 'research', status: 'running', updatedAt: '2026-10-29T06:00:00Z' }]
  f.integration.receive({ type: 'office.request', responseToken: 'snapshot', remainingMs: 30000,
    request: { type: 'office.snapshot', teamId: 'office-1', snapshot: next } })
  f.integration.receive({ teamId: 'office-1', command: say('last', 'file-agent') })
  await flush()
  assert.equal(f.office.source.readSnapshot().seq, 2, 'authoritative data is accepted without waiting for playback')
  assert.equal(f.office.session.getSnapshot().dashboard.seq, 1, 'scene and page presentation cannot jump ahead')
  advance(f.runtime, 300)
  assert.equal(f.office.session.getSnapshot().dashboard.seq, 2)
  assert.equal(f.runtime.getRecord('last').status, 'running')
})

test('decision prompts wait for earlier playback and closed prompts cannot reappear from the queue', async t => {
  const f = await connected(t)
  f.integration.receive({ teamId: 'office-1', command: say('first', 'office-lead', 1000) })
  const decision = id => ({ type: 'office.request', responseToken: id, remainingMs: 30000,
    request: { type: 'decision.request', teamId: 'office-1', conversationId: 'main', timeoutMs: 30000,
      decision: { id, kind: 'confirmation', title: 'Continue?', description: '', confirmLabel: 'Yes', rejectLabel: 'No' } } })
  f.integration.receive(decision('closed-before-admission'))
  f.integration.receive({ type: 'office.request.closed', responseToken: 'closed-before-admission' })
  f.integration.receive(decision('closed-prompt'))
  f.integration.receive(decision('next-prompt'))
  await flush()
  assert.equal(f.office.session.decisions.getSnapshot().pending.length, 0)
  f.integration.receive({ type: 'office.request.closed', responseToken: 'closed-prompt' })
  advance(f.runtime, 1000)
  assert.deepEqual(f.office.session.decisions.getSnapshot().pending.map(item => item.id), ['next-prompt'])
})

test('disposing during a presentation callback never publishes its stale completion', t => {
  const f = fixture(t)
  let committed = false
  const effect = f.runtime.enqueuePresentation(() => f.runtime.dispose(), () => { committed = true })
  assert.equal(effect.status, 'cancelled')
  assert.equal(committed, false)
})

test('cancelling presentation jobs is atomic and cannot start another child or stale commit', t => {
  const f = fixture(t)
  let committed = false
  const first = f.runtime.enqueuePresentation(() => {
    f.runtime.submit(say('first-child', 'office-lead', 1000))
    f.runtime.submit(say('never-started-child', 'file-agent', 1000))
  })
  const next = f.runtime.enqueuePresentation(() => { committed = true })
  f.runtime.cancelPresentations([first.id, next.id])
  assert.equal(first.status, 'cancelled')
  assert.equal(next.status, 'cancelled')
  assert.equal(committed, false)
  assert.equal(f.runtime.getRecord('never-started-child').status, 'cancelled')
  assert(!f.runtime.snapshot().events.some(event => event.data.commandId === 'never-started-child' && event.data.status === 'running'))
})

test('the weather workflow queues both delegated roles and repeated progress without early receiver work', async t => {
  const f = await connected(t), seen = []
  const data = f.snapshot.conversations[0]
  f.office.session.subscribe(() => seen.push(f.office.session.getSnapshot().dashboard?.seq))
  const update = async () => { f.snapshot.seq++; await f.send({ type: 'office.snapshot', teamId: 'office-1', snapshot: structuredClone(f.snapshot) }) }
  data.tasks.push({ id: 'write-md', title: '将长沙天气数据写入Markdown', assigneeId: 'writer', status: 'queued', updatedAt: '2026-10-29T06:00:00Z' })
  data.events.push({ id: 'delegate-draft', kind: 'task.assigned', taskId: 'write-md', employeeId: 'writer', fromEmployeeId: 'lead', summary: 'Write document', occurredAt: '2026-10-29T06:00:00Z' })
  await update()
  data.tasks[0].status = 'running'; await update()
  data.tasks[0].status = 'completed'; await update()
  data.tasks.push({ id: 'render-chart', title: '绘制长沙天气柱状图并嵌入文档', assigneeId: 'research', status: 'queued', updatedAt: '2026-10-29T06:01:00Z' })
  data.events.unshift({ id: 'delegate-research', kind: 'task.assigned', taskId: 'render-chart', employeeId: 'research', fromEmployeeId: 'lead', summary: 'Render chart', occurredAt: '2026-10-29T06:01:00Z' })
  await update()
  data.tasks[1].status = 'running'; await update()
  for (let i = 0; i < 3; i++) await update()
  assert.equal(f.office.session.getSnapshot().dashboard.seq, 1)
  assert.equal(f.office.source.readSnapshot().seq, 9)
  assert(f.runtime.readActors().filter(actor => ['app-agent', 'code-agent'].includes(actor.id)).every(actor => actor.presentation.status === 'idle'))
  until(f.runtime, () => f.office.session.getSnapshot().dashboard.seq === 9)
  const visits = f.runtime.snapshot().records.filter(record => record.command.capability === 'office.visit')
  assert.equal(visits.length, 2, 'repeated progress must not restart either handoff')
  assert(visits.every(record => record.status === 'completed'))
  assert.deepEqual([...new Set(seen.filter(Boolean))], [1, 2, 3, 4, 5, 6, 7, 8, 9])
})
