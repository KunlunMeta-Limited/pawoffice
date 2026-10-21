import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createTestServer } from './helpers/vite.mjs'
import { safeTick } from './helpers/grid.mjs'
import { readFile } from 'node:fs/promises'

let server, createOfficeRuntime, OfficeIdleCoffee, OfficeSimulation, projectCoffeeActors, createOfficePresentation, bindOfficeFrames, resolveVisualRequest
before(async () => {
  server = await createTestServer()
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ OfficeIdleCoffee } = await server.ssrLoadModule('/packages/scene-office/src/core/OfficeIdleCoffee.ts'))
  ;({ OfficeSimulation } = await server.ssrLoadModule('/apps/web/src/application/OfficeSimulation.ts'))
  ;({ projectCoffeeActors } = await server.ssrLoadModule('/packages/scene-office/src/pixi/coffeePresentation.ts'))
  ;({ createOfficePresentation } = await server.ssrLoadModule('/packages/scene-office/src/pixi/index.ts'))
  ;({ bindOfficeFrames } = await server.ssrLoadModule('/packages/assets-office/src/frame/bindings.ts'))
  ;({ resolveVisualRequest } = await server.ssrLoadModule('/packages/renderer-pixi/src/presentation/AnimationPresenter.ts'))
})
after(() => server?.close())

function random(seed = 42) { return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32 } }
function fixture(t, options = {}) {
  const runtime = createOfficeRuntime({ referenceLayout: true })
  const idle = new OfficeIdleCoffee(runtime, { delayMs: 0, random: random(), ...options })
  t.after(() => { idle.dispose(); runtime.dispose() })
  const tick = (ms = 50) => { runtime.tick(ms); idle.tick(ms) }
  const until = (predicate, message, limit = 1600) => {
    for (let i = 0; i < limit; i++) { if (predicate()) return; tick() }
    assert.fail(message)
  }
  const submit = command => runtime.submit({ protocolVersion: '2.0', sceneId: runtime.sceneId, commandId: crypto.randomUUID(), ...command })
  return { runtime, idle, tick, until, submit }
}
const coffeePhase = runtime => runtime.readActivePhases().find(phase => phase.capability === 'office.idle-coffee' && phase.ready && phase.actions.length)
const home = runtime => runtime.readActors().every(actor => actor.posture === 'seated' && !actor.motion && !actor.step && !actor.seatTransition)

test('idle coffee remains opt-in for simulations and standalone presentation packs', t => {
  const runtime = createOfficeRuntime(), simulation = new OfficeSimulation(runtime)
  t.after(() => { simulation.dispose(); runtime.dispose() })
  const original = runtime.snapshot()
  for (let i = 0; i < 400; i++) simulation.tick(50)
  assert.deepEqual(runtime.snapshot(), original)
  assert.equal(createOfficePresentation().createAmbientViews, undefined)
})

test('idle colleagues meet, alternate ellipses and coffee sips, and return to their own seats', t => {
  const { runtime, idle, tick, until } = fixture(t)
  const original = runtime.readActors().map(actor => ({ id: actor.id, presentation: actor.presentation }))
  until(() => coffeePhase(runtime), 'colleagues never arrived for coffee')
  const phase = coffeePhase(runtime), ids = phase.participants
  assert(ids.length >= 2 && ids.length <= 3)
  assert(ids.every(id => runtime.readActors().find(actor => actor.id === id).posture === 'standing'))
  const drank = new Set(), spoke = new Set()
  const firstId = phase.activityId
  for (let i = 0; i < 1600; i++) {
    const phase = runtime.readActivePhases().find(phase => phase.activityId === firstId)
    if (!phase) break
    if (phase.ready) for (const action of phase.actions) if (action.actionId === 'office.coffee.sip') drank.add(action.actorId)
    for (const actor of runtime.readActors()) if (actor.speech) { assert.equal(actor.speech.text, '...'); if (ids.includes(actor.id)) spoke.add(actor.id) }
    tick()
  }
  assert.deepEqual([...drank].sort(), [...ids].sort())
  assert.deepEqual([...spoke].sort(), [...ids].sort())
  idle.setEnabled(false)
  until(() => home(runtime), 'colleagues did not return home')
  assert.deepEqual(runtime.readActors().map(actor => ({ id: actor.id, presentation: actor.presentation })), original)
  assert(!runtime.snapshot().records.some(record => record.error), JSON.stringify(runtime.snapshot().records.filter(record => record.error)))
})

test('queued business work and all non-idle task states exclude a colleague', t => {
  const { runtime, tick, submit } = fixture(t, { canIdle: id => id !== 'office-lead' })
  for (const [actorId, status] of [['code-agent', 'working'], ['file-agent', 'thinking']]) {
    assert.equal(submit({ type: 'actor.presentation.set', actorId, status, title: '原有任务', sourceRevision: 1 }).status, 'completed')
  }
  for (let i = 0; i < 1200; i++) tick()
  for (const activity of runtime.snapshot().activities.filter(activity => activity.capability === 'office.idle-coffee')) {
    assert(activity.participants.every(id => !['office-lead', 'code-agent', 'file-agent'].includes(id)))
  }
})

test('a business command with busyPolicy reject can preempt an established coffee chat', t => {
  const { runtime, idle, until, submit } = fixture(t)
  until(() => coffeePhase(runtime), 'no coffee phase')
  const id = coffeePhase(runtime).participants[0]
  const result = submit({ type: 'activity.start', capability: 'office.emote', busyPolicy: 'reject',
    participants: [{ entityId: id, role: 'actor' }], params: { animation: 'emotes/wave', durationMs: 400 } })
  assert.equal(result.error, undefined)
  assert.equal(runtime.readActivePhases().some(phase => phase.capability === 'office.idle-coffee'), false)
  idle.setEnabled(false)
  until(() => home(runtime), 'interrupted colleagues never recovered their seats')
  assert.equal(runtime.getRecord(result.commandId).status, 'completed')
})

test('task assignment ends chat, preserves its revision and returns the worker home', t => {
  const { runtime, idle, until, submit } = fixture(t)
  until(() => coffeePhase(runtime), 'no coffee phase')
  const id = coffeePhase(runtime).participants[0]
  assert.equal(submit({ type: 'actor.presentation.set', actorId: id, status: 'working', title: '继续原有任务', sourceRevision: 1 }).status, 'completed')
  idle.setEnabled(false)
  until(() => home(runtime), 'assigned worker did not return home')
  assert.deepEqual(runtime.readActors().find(actor => actor.id === id).presentation, { status: 'working', title: '继续原有任务', sourceRevision: 1 })
})

test('map editing waits for safe return and leaves no coffee claims or speech behind', async t => {
  const { runtime, idle, until, submit } = fixture(t)
  until(() => coffeePhase(runtime), 'no coffee phase')
  let ready = false
  const waiting = idle.prepareEditing().then(() => { ready = true })
  // Production's shared simulation clock resumes the controller every frame.
  // Editing preparation must survive those resumes until the draft has opened.
  for (let i = 0; i < 500; i++) {
    idle.resume()
    runtime.tick(50); idle.tick(50)
  }
  until(() => home(runtime) && runtime.readActivePhases().length === 0, 'idle claims not released')
  await waiting
  assert(ready)
  assert.equal(submit({ type: 'map.edit', edit: { action: 'begin', expectedLayoutRevision: runtime.readWorld().layoutRevision } }).error, undefined)
  assert(runtime.isEditing)
  assert(!runtime.readActors().some(actor => actor.speech))
})

test('a lone eligible colleague can drink without inventing a conversation', t => {
  const { runtime, tick, until, idle } = fixture(t, { canIdle: id => id === 'office-lead' })
  until(() => coffeePhase(runtime), 'single colleague never took a break')
  assert.deepEqual(coffeePhase(runtime).participants, ['office-lead'])
  for (let i = 0; i < 200; i++) { tick(); assert(!runtime.readActors().some(actor => actor.speech)) }
  idle.setEnabled(false)
  until(() => home(runtime), 'single colleague did not return')
})

test('full-body coffee actions use phase progress, mirror side views and yield to tasks', t => {
  const { runtime, until, submit } = fixture(t)
  until(() => coffeePhase(runtime), 'no coffee phase')
  const pack = createOfficePresentation(undefined, true), original = createOfficePresentation()
  const before = runtime.readWorld()
  const actors = pack.projectActors(runtime, before)
  const coffee = actors.filter(actor => actor.intent.actionId === 'office.coffee.hold')
  assert.equal(coffee.length, coffeePhase(runtime).participants.length)
  assert(coffee.every(actor => ['left', 'right'].includes(actor.intent.view)))
  assert.equal(pack.createAmbientViews, undefined, 'coffee must not mount a duplicate arm/cup overlay')
  assert.deepEqual(runtime.readWorld(), before)
  assert(original.projectActors(runtime, before).every(actor => !actor.intent.actionId.startsWith('office.coffee.')))
  until(() => coffeePhase(runtime)?.actions.some(action => action.actionId === 'office.coffee.sip') && coffeePhase(runtime).progress > .2 && coffeePhase(runtime).progress < .8, 'no sip phase')
  const phase = coffeePhase(runtime), id = phase.actions.find(action => action.actionId === 'office.coffee.sip').actorId
  const sipping = pack.projectActors(runtime).find(actor => actor.id === id)
  assert.equal(sipping.intent.actionId, 'office.coffee.sip')
  assert.equal(sipping.intent.progress, phase.progress)
  assert.equal(sipping.intent.speech, undefined, 'ellipsis bubble must not replace the coffee body with a speech clip')
  const base = original.projectActors(runtime)
  assert.equal(projectCoffeeActors(runtime, runtime.readWorld(), base, () => true, true).find(actor => actor.id === id).intent.actionId, 'office.coffee.hold')
  assert.deepEqual(projectCoffeeActors(runtime, runtime.readWorld(), base, () => false), base)
  submit({ type: 'actor.presentation.set', actorId: id, status: 'thinking', title: '处理任务', sourceRevision: 1 })
  assert(pack.projectActors(runtime).filter(actor => phase.participants.includes(actor.id)).every(actor => !actor.intent.actionId.startsWith('office.coffee.')))
})

test('all six coffee extensions retain original clips and expose complete mirrored coffee bodies', async () => {
  const load = async relative => JSON.parse(await readFile(new URL('../public/characters/' + relative, import.meta.url), 'utf8'))
  const base = await load('registry.json'), coffee = await load('coffee-registry.json')
  assert.equal(coffee.characters.length, 6)
  for (const entry of coffee.characters) {
    const original = await load(base.characters.find(character => character.id === entry.id).manifest)
    const manifest = await load(entry.manifest)
    assert.notEqual(manifest.revision, original.revision)
    for (const [name, clip] of Object.entries(original.clips)) assert.deepEqual(manifest.clips[name], clip)
    assert.deepEqual(manifest.pages.slice(0, original.pages.length), original.pages)
    assert.deepEqual(manifest.mouth, original.mouth)
    assert.equal(manifest.clips['coffee.hold.right'].frames.length, 1)
    assert.equal(manifest.clips['coffee.sip.left'].mirrorX, true)
    const sip = manifest.clips['coffee.sip.right']
    assert.equal(sip.frames[0].frame, sip.frames.at(-1).frame)
    assert(sip.frames.some(frame => frame.frame.endsWith('/005.png')))
    const appearance = bindOfficeFrames(manifest, entry.manifest)
    for (const actionId of ['office.coffee.hold', 'office.coffee.sip']) for (const view of ['left', 'right']) {
      const request = resolveVisualRequest(appearance, { actionId, poseId: 'standing', view })
      assert.equal(request.variantIds.length, 1)
      assert.equal(appearance.source.bindings[request.variantIds[0]].clip, `coffee.${actionId.split('.').at(-1)}.${view}`)
    }
  }
})

test('all six colleagues can take turns without shared cells or failed background activities', t => {
  const { runtime, idle, tick, until } = fixture(t)
  const seen = new Set()
  for (let i = 0; i < 1800; i++) {
    safeTick(runtime, 50, () => tick())
    runtime.readActivePhases().filter(phase => phase.capability === 'office.idle-coffee')
      .forEach(phase => phase.participants.forEach(id => seen.add(id)))
  }
  assert.equal(seen.size, 6, JSON.stringify({ seen: [...seen], phases: runtime.readActivePhases(),
    actors: runtime.readActors().map(a => ({ id: a.id, position: a.position, motion: a.motion, transition: a.seatTransition })),
    failures: runtime.snapshot().records.filter(record => record.error) }))
  idle.setEnabled(false)
  until(() => home(runtime), 'all six must settle after disabling coffee')
  assert(!runtime.snapshot().records.some(record => record.error), JSON.stringify(runtime.snapshot().records.filter(record => record.error)))
})

test('assignment during a departure settles the current step and returns safely without changing task state', t => {
  const { runtime, idle, tick, until, submit } = fixture(t)
  until(() => runtime.readActors().some(actor => actor.seatTransition), 'no seated departure started')
  const actor = runtime.readActors().find(actor => actor.seatTransition)
  submit({ type: 'actor.presentation.set', actorId: actor.id, status: 'working', title: '优先任务', sourceRevision: 1 })
  idle.setEnabled(false)
  for (let i = 0; i < 1000 && !home(runtime); i++) safeTick(runtime, 50, () => tick())
  assert(home(runtime))
  assert.equal(runtime.readActors().find(candidate => candidate.id === actor.id).presentation.title, '优先任务')
})
