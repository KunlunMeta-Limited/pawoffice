import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createTestServer } from './helpers/vite.mjs'

let server, createOfficeRuntime, SceneMessageClient
before(async () => {
  server = await createTestServer()
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ SceneMessageClient } = await server.ssrLoadModule('/packages/runtime/src/adapters/messages.ts'))
})
after(() => server?.close())

const base = commandId => ({ protocolVersion: '2.0', sceneId: 'office-1', commandId })
const say = (id, actor = 'office-lead', durationMs = 300) => ({ ...base(id), type: 'activity.start', capability: 'scene.say',
  participants: [{ entityId: actor, role: 'actor' }], params: { text: id, durationMs } })
const move = id => ({ ...base(id), type: 'activity.start', capability: 'scene.move',
  participants: [{ entityId: 'office-lead', role: 'actor' }], params: { targetId: 'desk-1', anchor: 'conversationLeft' } })
const presentation = (id, status, actorId = 'code-agent', sourceRevision = 1) => ({ ...base(id), type: 'actor.presentation.set',
  actorId, status, title: id, sourceRevision })
function setup(t) {
  let now = 1000
  const runtime = createOfficeRuntime({ now: () => now })
  t.after(() => runtime.dispose())
  const client = new SceneMessageClient({ connect() { return () => {} } })
  const detach = client.register(runtime)
  t.after(detach)
  return { runtime, client, detach, receive(command) { client.receive({ teamId: runtime.sceneId, command }) },
    advance(ms) { for (let elapsed = 0; elapsed < ms; elapsed += 50) { now += 50; runtime.tick(50) } } }
}

test('single messages wait for actual arrival before applying work and thought states across actors', t => {
  const { runtime, receive, advance } = setup(t)
  const initial = runtime.readActors()[0].position
  receive(move('walk'))
  receive(presentation('work', 'working'))
  receive(presentation('think', 'thinking', 'file-agent'))
  receive(say('reply', 'app-agent'))
  assert.equal(runtime.getRecord('walk').status, 'running')
  for (const id of ['work', 'think', 'reply']) assert.equal(runtime.getRecord(id).status, 'queued')
  advance(500)
  assert.equal(runtime.getRecord('walk').status, 'running')
  assert.equal(runtime.readActors().find(actor => actor.id === 'code-agent').presentation.status, 'idle')
  assert.equal(runtime.readActors().find(actor => actor.id === 'file-agent').presentation.status, 'idle')
  for (let elapsed = 0; elapsed < 30000 && runtime.getRecord('walk').status === 'running'; elapsed += 50) advance(50)
  assert.equal(runtime.getRecord('walk').status, 'completed')
  assert.notDeepEqual(runtime.readActors()[0].position, initial)
  assert.equal(runtime.readActors()[0].motion, undefined)
  assert.equal(runtime.readActors()[0].seatTransition, undefined)
  assert.equal(runtime.readActors().find(actor => actor.id === 'code-agent').presentation.status, 'working')
  assert.equal(runtime.readActors().find(actor => actor.id === 'file-agent').presentation.status, 'thinking')
  advance(300)
  const completed = runtime.snapshot().events.filter(event => event.type === 'command.status' && event.data.status === 'completed')
  assert.deepEqual(completed.map(event => event.data.commandId), ['walk', 'work', 'think', 'reply'])
})

test('live arrivals serialize disjoint resources and later messages start after the queue drains', t => {
  const { runtime, receive, advance } = setup(t)
  receive(say('first'))
  advance(100)
  receive(say('second', 'code-agent'))
  assert.equal(runtime.getRecord('second').status, 'queued')
  advance(200)
  assert.equal(runtime.getRecord('first').status, 'completed')
  assert.equal(runtime.getRecord('second').status, 'running')
  advance(300)
  receive(say('third', 'file-agent'))
  assert.equal(runtime.getRecord('third').status, 'running')
})

test('duplicates do not change FIFO order or mutate the submitted command', t => {
  const { runtime, receive, advance } = setup(t)
  const first = say('first'), second = say('second', 'code-agent')
  receive(first); receive(second); receive(first); receive(second)
  assert.equal(runtime.snapshot().records.length, 2)
  assert.deepEqual(runtime.getRecord('first').command, first)
  assert.deepEqual(runtime.getRecord('second').command, second)
  assert.equal(runtime.submit(second).status, 'queued')
  assert.equal(runtime.submit({ ...second, params: { text: 'changed' } }).error.code, 'COMMAND_ID_CONFLICT')
  advance(600)
  assert.equal(runtime.getRecord('second').status, 'completed')
})

test('invalid, failed and expired messages do not block later independent messages', t => {
  t.mock.method(console, 'warn', () => {})
  const { runtime, receive, advance } = setup(t)
  receive(say('first', 'office-lead', 1000))
  receive({ ...say('invalid'), capability: 'unknown' })
  receive({ ...say('expired'), expiresAt: new Date(1200).toISOString() })
  receive(presentation('stale', 'working', 'code-agent', 0))
  receive(say('following', 'file-agent'))
  assert.equal(runtime.getRecord('invalid').status, 'rejected')
  advance(1500)
  assert.equal(runtime.getRecord('expired').status, 'expired')
  assert.equal(runtime.getRecord('stale').error.code, 'STALE_REVISION')
  assert.equal(runtime.getRecord('following').status, 'completed')
})

test('cancel bypasses FIFO and the next state waits for the cancelled movement to settle', t => {
  const { runtime, receive, advance } = setup(t)
  receive(move('walk'))
  for (let elapsed = 0; elapsed < 10000 && (!runtime.readActors()[0].step || runtime.readActors()[0].seatTransition); elapsed += 50) advance(50)
  assert(runtime.readActors()[0].step, 'cancel during a real grid step')
  assert.equal(runtime.readActors()[0].seatTransition, undefined)
  const destination = runtime.readActors()[0].step.to
  receive(presentation('work', 'working'))
  receive({ ...base('cancel'), type: 'command.cancel', targetCommandId: 'walk' })
  assert.equal(runtime.getRecord('cancel').status, 'completed')
  assert.equal(runtime.getRecord('walk').status, 'cancelled')
  runtime.tick(0)
  assert.equal(runtime.getRecord('work').status, 'queued')
  advance(2000)
  assert.deepEqual(runtime.readActors()[0].position, destination)
  assert.equal(runtime.getRecord('work').status, 'completed')
})

test('continuous activities hold FIFO until explicitly stopped, even after start acknowledgement', t => {
  const { runtime, receive, advance } = setup(t)
  receive({ ...base('focus'), type: 'activity.start', capability: 'office.focus',
    participants: [{ entityId: 'office-lead', role: 'worker' }], params: { title: 'Analyze' } })
  assert.equal(runtime.getRecord('focus').status, 'completed')
  receive(say('following', 'code-agent'))
  advance(1000)
  assert.equal(runtime.getRecord('following').status, 'queued')
  receive({ ...base('stop'), type: 'activity.stop', activityId: 'focus' })
  assert.equal(runtime.getRecord('stop').status, 'completed')
  advance(500)
  assert.equal(runtime.getRecord('following').status, 'completed')
})

test('explicit dependencies still fail as requested and cancellation of a queued message releases FIFO', t => {
  t.mock.method(console, 'warn', () => {})
  const { runtime, receive, advance } = setup(t)
  receive(say('first'))
  receive(say('cancelled', 'code-agent'))
  receive({ ...say('dependent', 'file-agent'), after: ['cancelled'] })
  receive(say('last', 'app-agent'))
  receive({ ...base('cancel'), type: 'command.cancel', targetCommandId: 'cancelled' })
  assert.equal(runtime.getRecord('cancelled').status, 'cancelled')
  runtime.tick(0)
  assert.equal(runtime.getRecord('dependent').error.code, 'DEPENDENCY_FAILED')
  advance(600)
  assert.equal(runtime.getRecord('last').status, 'completed')
})

test('different offices remain independent and a parallel batch waits for earlier messages', t => {
  const { runtime, client, receive, advance } = setup(t)
  const other = createOfficeRuntime({ sceneId: 'office-2' })
  t.after(() => other.dispose()); t.after(client.register(other))
  receive(say('first'))
  receive(say('queued', 'code-agent'))
  client.receive({ teamId: 'office-2', command: { ...say('other'), sceneId: 'office-2' } })
  assert.equal(runtime.getRecord('queued').status, 'queued')
  assert.equal(other.getRecord('other').status, 'running')
  receive({ mode: 'parallel', commands: [say('parallel-one', 'file-agent'), say('parallel-two', 'app-agent')] })
  assert.equal(runtime.getRecord('parallel-one').status, 'queued')
  assert.equal(runtime.getRecord('parallel-two').status, 'queued')
  advance(600)
  assert.equal(runtime.getRecord('parallel-one').status, 'running')
  assert.equal(runtime.getRecord('parallel-two').status, 'running')
})

test('disconnecting the transport preserves accepted messages and disposing cancels the queue', t => {
  const { runtime, receive, advance, client, detach } = setup(t)
  receive(say('first')); receive(say('second', 'code-agent'))
  detach()
  advance(600)
  assert.equal(runtime.getRecord('second').status, 'completed')
  t.after(client.register(runtime))
  receive(say('third')); receive(say('fourth', 'code-agent'))
  runtime.dispose()
  assert.equal(runtime.getRecord('third').status, 'cancelled')
  assert.equal(runtime.getRecord('fourth').status, 'cancelled')
})
