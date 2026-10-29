import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createTestServer } from './helpers/vite.mjs'
import { base, visit } from './helpers/grid.mjs'

let server, createOfficeRuntime, DashboardSceneBridge, createReferenceOfficePresentation, officeActorTasks, TaskBadge
before(async () => {
  server = await createTestServer()
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ DashboardSceneBridge } = await server.ssrLoadModule('/apps/web/src/dashboard/sceneBridge.ts'))
  ;({ createReferenceOfficePresentation } = await server.ssrLoadModule('/packages/scene-office/src/pixi/index.ts'))
  ;({ officeActorTasks } = await server.ssrLoadModule('/apps/web/src/dashboard/actorTasks.ts'))
  ;({ TaskBadge } = await server.ssrLoadModule('/packages/renderer-pixi/src/ui/TaskBadge.ts'))
})
after(() => server?.close())

function setup(t, options = {}) {
  const runtime = createOfficeRuntime({ referenceLayout: true, ...options })
  t.after(() => runtime.dispose())
  const data = { schemaVersion: '1.0', workspace: { id: 'office-1', name: 'Handoff' },
    employees: runtime.readActors().map(actor => ({ id: actor.id, name: actor.name, sceneActorId: actor.id })),
    tasks: [
      { id: 'incoming', title: 'Incoming task', assigneeId: 'code-agent', status: 'queued', updatedAt: '2026-10-29T06:00:00Z' },
      { id: 'independent', title: 'Other work', assigneeId: 'file-agent', status: 'running', updatedAt: '2026-10-29T06:00:00Z' },
    ], events: [] }
  const bridge = new DashboardSceneBridge(runtime)
  let displayed = structuredClone(data)
  const presentation = createReferenceOfficePresentation({ taskForActor: id => officeActorTasks(displayed).get(id) })
  const actor = (id = 'code-agent') => presentation.projectActors(runtime).find(actor => actor.id === id)
  const sync = (status = 'running', title = 'Incoming task') => {
    Object.assign(data.tasks[0], { status, title })
    assert.deepEqual(bridge.sync(data, { presented: next => { displayed = next } }), [])
  }
  assert.deepEqual(bridge.sync(data), [])
  return { runtime, data, bridge, actor, sync }
}

function until(runtime, condition) {
  for (let i = 0; i < 2400; i++) {
    if (condition()) return
    runtime.tick(50)
  }
  assert.fail('Animation did not reach the expected state')
}

for (const referenceLayout of [false, true]) for (const durationMs of [300, 3000]) {
  test(`snapshot work waits for the actual reply in ${referenceLayout ? 'reference' : 'classic'} layout (${durationMs} ms dialogue)`, t => {
    const f = setup(t, { referenceLayout })
    const command = visit('handoff')
    command.params.durationMs = durationMs
    command.params.stops[0].reply = 'Accepted'
    assert.equal(f.runtime.submit(command).status, 'running')
    for (let i = 0; i < 14; i++) f.runtime.tick(50)
    f.sync()
    const unchanged = structuredClone(f.data)
    assert.equal(f.runtime.readActors().find(actor => actor.id === 'code-agent').presentation.status, 'idle')
    assert.equal(f.data.tasks[0].status, 'running', 'business data still updates immediately')
    assert.equal(f.actor().task, undefined, 'the workstation task UI waits for the same handoff as the animation')
    assert.equal(f.actor().status, 'idle', 'the receiver waits while the visitor is still approaching')
    assert.equal(f.actor('file-agent').intent.actionId, 'office.type', 'unrelated work keeps playing')
    until(f.runtime, () => f.runtime.readActors().find(actor => actor.id === 'code-agent').speech?.text === 'Accepted')
    while (f.runtime.readActors().find(actor => actor.id === 'code-agent').speech) {
      assert.notEqual(f.actor().intent.actionId, 'office.type', 'typing waits through the receiver reply')
      assert.equal(f.actor().task, undefined, 'the task UI stays hidden through the receiver reply')
      f.runtime.tick(50)
    }
    until(f.runtime, () => f.actor().intent.actionId === 'office.type')
    assert.equal(f.actor().task.status, 'running')
    assert.equal(f.actor().task.title, 'Incoming task')
    assert.equal(f.runtime.getRecord('handoff').status, 'completed', 'the next message waits for the complete preceding activity')
    assert.deepEqual(f.data, unchanged, 'animation never rewrites the business snapshot')
  })
}

test('a snapshot containing both running work and a new assignment gates the animation on the first render', t => {
  const f = setup(t)
  f.data.events.push({ id: 'assigned', kind: 'task.assigned', taskId: 'incoming', employeeId: 'code-agent',
    fromEmployeeId: 'office-lead', summary: 'Please take over', occurredAt: '2026-10-29T06:00:01Z' })
  f.sync()
  assert.equal(f.runtime.snapshot().records.filter(record => record.command.capability === 'office.visit').length, 1)
  assert.equal(f.actor().task, undefined)
  assert.equal(f.data.tasks[0].status, 'running')
  assert.equal(f.actor().status, 'idle')
  f.sync()
  assert.equal(f.runtime.snapshot().records.filter(record => record.command.capability === 'office.visit').length, 1)
  until(f.runtime, () => f.actor().intent.actionId === 'office.type')
})

test('cancelling a queued handoff does not let snapshots overtake an earlier activity', t => {
  const f = setup(t), other = setup(t)
  f.runtime.submit({ ...base('busy'), type: 'activity.start', capability: 'scene.say',
    participants: [{ entityId: 'office-lead', role: 'actor' }], params: { text: 'Busy', durationMs: 10000 } })
  assert.equal(f.runtime.submit(visit('waiting')).status, 'queued')
  f.sync(); other.sync()
  assert.equal(f.actor().status, 'idle')
  assert.equal(f.actor().task, undefined)
  assert.equal(other.actor().intent.actionId, 'office.type', 'different runtimes do not share handoff waits')
  f.sync('running', 'Latest task')
  assert.equal(f.actor().task, undefined, 'new task UI cannot leak through another snapshot')
  f.runtime.submit({ ...base('cancel-waiting'), type: 'command.cancel', targetCommandId: 'waiting' })
  assert.equal(f.actor().status, 'idle')
  assert.equal(f.runtime.getRecord('busy').status, 'running')
  until(f.runtime, () => f.runtime.getRecord('busy').status === 'completed')
  assert.equal(f.actor().intent.actionId, 'office.type')
  assert.equal(f.actor().title, 'Latest task')
  assert.equal(f.actor().task.title, 'Latest task')
})

for (const status of ['running', 'blocked', 'completed']) {
  test(`an interrupted handoff uses the latest ${status} task without replaying old work`, t => {
    const f = setup(t)
    f.runtime.submit(visit('interrupted'))
    f.sync()
    assert.equal(f.actor().status, 'idle')
    f.sync(status, 'Latest state')
    f.runtime.submit({ ...base('stop'), type: 'activity.stop', activityId: 'interrupted' })
    assert.equal(f.actor().status, { running: 'working', blocked: 'thinking', completed: 'idle' }[status])
    assert.equal(f.actor().task.status, status)
    assert.equal(f.actor().task.title, 'Latest state')
    assert.equal(f.actor().intent.actionId === 'office.type', status === 'running')
  })
}

test('failed and expired handoffs release the visual wait', t => {
  let now = 1000
  const f = setup(t, { now: () => now })
  f.runtime.submit({ ...visit('timeout'), timeoutMs: 100 })
  f.sync()
  assert.equal(f.actor().status, 'idle')
  f.runtime.tick(100)
  assert.equal(f.runtime.getRecord('timeout').status, 'failed')
  assert.equal(f.actor().intent.actionId, 'office.type')
  f.runtime.submit({ ...base('busy'), type: 'activity.start', capability: 'scene.say',
    participants: [{ entityId: 'office-lead', role: 'actor' }], params: { text: 'Busy', durationMs: 10000 } })
  assert.equal(f.runtime.submit({ ...visit('expired'), expiresAt: new Date(now + 1000).toISOString() }).status, 'queued')
  assert.equal(f.actor().status, 'working', 'previously applied work is not rewound by a later queued visit')
  now += 2000; f.runtime.tick(0)
  assert.equal(f.runtime.getRecord('expired').status, 'expired')
  assert.equal(f.actor().intent.actionId, 'office.type')
})

test('work completed during the walk never starts typing after the handoff finishes', t => {
  const f = setup(t)
  f.runtime.submit(visit('completed-during-walk')); f.sync()
  f.sync('completed', 'Already finished')
  while (f.runtime.getRecord('completed-during-walk').status === 'running') {
    assert.notEqual(f.actor().intent.actionId, 'office.type')
    f.runtime.tick(50)
  }
  assert.equal(f.runtime.getRecord('completed-during-walk').status, 'completed')
  assert.equal(f.actor().status, 'idle')
  assert.equal(f.actor().task.status, 'completed')
})

test('a multi-stop visit completes before the following work snapshot is presented', t => {
  const f = setup(t), command = visit('multi')
  command.participants.push({ entityId: 'file-agent', role: 'host' })
  command.params.stops = [{ hostId: 'code-agent', message: 'First', reply: 'First accepted' },
    { hostId: 'file-agent', message: 'Second', reply: 'Second accepted' }]
  f.runtime.submit(command); f.sync()
  assert.equal(f.actor().status, 'idle')
  assert.equal(f.actor('file-agent').status, 'working', 'an already displayed work state can keep running')
  assert.equal(f.actor().task, undefined)
  assert.equal(f.actor('file-agent').task.id, 'independent')
  until(f.runtime, () => f.actor().intent.actionId === 'office.type')
  assert.equal(f.actor('file-agent').status, 'working')
  assert.equal(f.actor().task.status, 'running')
  assert.equal(f.actor('file-agent').task.status, 'running')
  assert.equal(f.runtime.getRecord('multi').status, 'completed')
  until(f.runtime, () => f.actor('file-agent').intent.actionId === 'office.type')
  assert.equal(f.runtime.getRecord('multi').status, 'completed')
})

test('the workstation badge is invisible and makes no progress until the actual handoff completes', t => {
  const f = setup(t)
  t.mock.method(TaskBadge.prototype, 'redraw', () => {})
  const badge = new TaskBadge()
  t.after(() => badge.destroy({ children: true }))
  f.runtime.submit(visit('badge-handoff')); f.sync()
  badge.setTask(f.actor().task)
  badge.update(10)
  assert.equal(badge.visible, false, 'the incoming task title, status and progress bar must all be hidden')
  assert.equal(badge.displayedProgress, undefined, 'waiting time does not advance the task progress')
  until(f.runtime, () => f.actor().intent.actionId === 'office.type')
  badge.setTask(f.actor().task)
  assert.equal(badge.visible, true)
  assert.equal(badge.displayedProgress, 0, 'task UI begins together with work instead of catching up to elapsed walking time')
  badge.update(.05)
  assert(badge.displayedProgress > 0)
})
