import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createTestServer } from './helpers/vite.mjs'
import { safeTick } from './helpers/grid.mjs'
import { readFile } from 'node:fs/promises'
import { characterPackFixture } from './helpers/characterPack.mjs'
import { frameVisualFixture } from './helpers/frameVisual.mjs'

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

test('coffee discovery declares the same participant roles and conditional mode rules used by execution', t => {
  const { runtime } = fixture(t)
  const operations = runtime.describe().plugins.flatMap(plugin => plugin.operations)
  const coffee = operations.find(operation => operation.id === 'office.idle-coffee')
  assert.deepEqual(coffee.participants.roles, [{ role: 'visitor', min: 1, max: 1 }, { role: 'host', min: 0, max: 1 }])
  assert.equal(coffee.participants.min, 1); assert.equal(coffee.participants.max, 2)
  assert(coffee.participants.rules.some(rule => rule.includes('visit') && rule.includes('window') && rule.includes('host')))
  const returning = operations.find(operation => operation.id === 'office.idle-return')
  assert.deepEqual(returning.participants.roles, [{ role: 'visitor', min: 1, max: 1 }])
  assert.equal(returning.participants.min, 1); assert.equal(returning.participants.max, 1)
})

test('idle coffee remains opt-in for simulations and standalone presentation packs', t => {
  const runtime = createOfficeRuntime(), simulation = new OfficeSimulation(runtime)
  t.after(() => { simulation.dispose(); runtime.dispose() })
  const original = runtime.snapshot()
  for (let i = 0; i < 400; i++) simulation.tick(50)
  assert.deepEqual(runtime.snapshot(), original)
  assert.equal(createOfficePresentation().createAmbientViews, undefined)
})

test('one visitor drinks at a seated colleague desk and both alternate ellipsis bubbles', t => {
  const { runtime, idle, tick, until } = fixture(t)
  const original = runtime.readActors().map(actor => ({ id: actor.id, presentation: actor.presentation }))
  until(() => coffeePhase(runtime), 'colleagues never arrived for coffee')
  const phase = coffeePhase(runtime), ids = phase.participants
  assert.equal(ids.length, 2)
  const [visitorId, hostId] = ids
  const hostPosition = runtime.readActors().find(actor => actor.id === hostId).position
  assert.equal(runtime.readActors().find(actor => actor.id === visitorId).posture, 'standing')
  const drank = new Set(), spoke = []
  let lastSpeechPhase = -1
  const firstId = phase.activityId
  for (let i = 0; i < 1600; i++) {
    const phase = runtime.readActivePhases().find(phase => phase.activityId === firstId)
    if (!phase) break
    if (phase.ready) for (const action of phase.actions) if (action.actionId === 'office.coffee.sip') drank.add(action.actorId)
    const actors = runtime.readActors(), host = actors.find(actor => actor.id === hostId)
    assert.equal(host.posture, 'seated')
    assert.deepEqual(host.position, hostPosition)
    assert(actors.filter(actor => actor.id !== visitorId).every(actor => actor.posture === 'seated' && !actor.motion && !actor.seatTransition))
    const speaking = actors.filter(actor => actor.speech)
    assert(speaking.length <= 1)
    const started = runtime.snapshot().activities.find(activity => activity.id === firstId)?.phaseStarted
    for (const actor of speaking) {
      assert.equal(actor.speech.text, '...')
      if (phase.ready && started && phase.phaseIndex !== lastSpeechPhase) { spoke.push(actor.id); lastSpeechPhase = phase.phaseIndex }
    }
    safeTick(runtime, 50, () => tick())
  }
  assert.deepEqual([...drank], [visitorId])
  assert.deepEqual([...new Set(spoke)].sort(), [...ids].sort())
  assert(spoke.every((speaker, i) => i === 0 || speaker !== spoke[i - 1]))
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

test('a lone eligible colleague faces an accessible window and drinks without a conversation', t => {
  const { runtime, tick, until, idle } = fixture(t, { canIdle: id => id === 'office-lead' })
  until(() => coffeePhase(runtime), 'single colleague never took a break')
  assert.deepEqual(coffeePhase(runtime).participants, ['office-lead'])
  const record = runtime.getRecord(coffeePhase(runtime).activityId)
  assert.equal(record.command.params.mode, 'window')
  const actor = runtime.readActors().find(actor => actor.id === 'office-lead')
  assert.deepEqual(actor.position, runtime.navigation.anchor(runtime.readWorld(), 'office.coffee-window', record.command.params.anchor))
  assert.equal(actor.position.x, 18)
  assert.equal(actor.facing, 'right')
  for (let i = 0; i < 200; i++) { safeTick(runtime, 50, () => tick()); assert(!runtime.readActors().some(actor => actor.speech)) }
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
  assert.equal(coffee.length, 1)
  assert.equal(actors.find(actor => actor.id === coffeePhase(runtime).participants[1]).intent.poseId, 'seated')
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

test('a standing visitor speaks with the held cup and closes their mouth for the host and sip', t => {
  const { runtime, until } = fixture(t)
  const pack = createOfficePresentation(undefined, true)
  until(() => coffeePhase(runtime), 'no visit')
  const visitorId = coffeePhase(runtime).participants[0]
  until(() => coffeePhase(runtime) && runtime.readActors().find(actor => actor.id === visitorId).speech?.text === '...', 'visitor never spoke')
  const visitor = pack.projectActors(runtime).find(actor => actor.id === visitorId)
  assert.equal(visitor.intent.actionId, 'office.coffee.hold')
  assert.equal(visitor.intent.speech, '...')
  assert.equal(visitor.bubble, '...')
  until(() => coffeePhase(runtime) && runtime.readActors().some(actor => actor.id !== visitorId && actor.speech), 'host never spoke')
  assert.equal(pack.projectActors(runtime).find(actor => actor.id === visitorId).intent.speech, undefined)
  until(() => coffeePhase(runtime)?.actions.some(action => action.actionId === 'office.coffee.sip'), 'visitor never sipped')
  assert.equal(pack.projectActors(runtime).find(actor => actor.id === visitorId).intent.speech, undefined)
})

test('all six standing coffee speakers animate only their mouth in both side views and stop when listening', async t => {
  const load = async relative => JSON.parse(await readFile(new URL('../public/characters/' + relative, import.meta.url), 'utf8'))
  const registry = await load('coffee-registry.json')
  for (const { id } of registry.characters) {
    const pack = await characterPackFixture(id, 'coffee-registry.json')
    t.after(() => pack.dispose())
    const model = await frameVisualFixture(t, server, id, pack)
    const appearance = model.manifest
    const { sampleCharacterLayers } = await server.ssrLoadModule('/packages/assets-office/src/frame/packSchema.ts')
    for (const view of ['right', 'left']) {
      const intent = { actionId: 'office.coffee.hold', poseId: 'standing', view, progress: 0, speech: '...' }
      const request = resolveVisualRequest(appearance, intent)
      assert.equal(request.variantIds.length, 2)
      assert.equal(appearance.source.bindings[request.variantIds[1]].mouthLayer, true)
      const actor = { id, intent, position: { x: 0, y: 0 }, displayHeight: 84 }
      const visual = model.present(actor)
      const body = visual.sprite.texture, open = visual.mouthSprite.texture
      const mouthX = visual.mouthSprite.x
      assert.equal(body, model.texture(`coffee.hold.${view}`), `${id}: retains cup while speaking`)
      assert.equal(open, model.texture('mouth.right-speaking'))
      model.present(actor, .12)
      assert.equal(visual.sprite.texture, body)
      assert.notEqual(visual.mouthSprite.texture, open, `${id}: mouth actually advances while cup stays still`)
      const direction = view === 'left' ? -1 : 1
      assert.equal(Math.sign(mouthX), direction)
      assert.equal(Math.sign(visual.mouthSprite.scale.x), direction)
      model.present({ ...actor, intent: { ...intent, speech: undefined } })
      assert.equal(visual.sprite.texture, body)
      assert.equal(visual.mouthSprite.texture, model.texture('mouth.right-closed'))
      assert.equal(sampleCharacterLayers(pack.manifest, `coffee.sip.${view}`, 0, .5).mouth, undefined, 'sip needs no talking overlay')
    }
  }
})

test('all six colleagues take turns as the sole visitor without shared cells or failed activities', t => {
  const { runtime, idle, tick, until } = fixture(t)
  const seen = new Set()
  for (let i = 0; i < 8000 && seen.size < 6; i++) {
    safeTick(runtime, 50, () => tick())
    const phases = runtime.readActivePhases().filter(phase => phase.capability === 'office.idle-coffee')
    assert(phases.length <= 1)
    phases.filter(phase => phase.ready && phase.actions.length).forEach(phase => seen.add(phase.participants[0]))
    assert(runtime.readActors().filter(actor => actor.posture !== 'seated' || actor.motion || actor.step || actor.seatTransition).length <= 1)
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

test('a temporarily busy idle colleague prevents falling back to a lone window break', t => {
  const { runtime, tick, until, submit } = fixture(t, { canIdle: id => ['office-lead', 'code-agent'].includes(id) })
  assert.equal(submit({ type: 'activity.start', capability: 'scene.say', participants: [{ entityId: 'code-agent', role: 'actor' }],
    params: { text: '暂时占用', durationMs: 10000 } }).error, undefined)
  for (let i = 0; i < 100; i++) tick()
  assert(!runtime.readActivePhases().some(phase => phase.capability === 'office.idle-coffee'))
  until(() => coffeePhase(runtime), 'idle colleagues never began a visit after the temporary activity')
  assert.equal(runtime.getRecord(coffeePhase(runtime).activityId).command.params.mode, 'visit')
})

test('assigning the seated host releases them and holds new departures until the visitor is safely home', t => {
  const { runtime, tick, until, submit } = fixture(t)
  until(() => coffeePhase(runtime), 'no visit')
  const first = coffeePhase(runtime), [visitorId, hostId] = first.participants
  const hostPosition = runtime.readActors().find(actor => actor.id === hostId).position
  submit({ type: 'actor.presentation.set', actorId: hostId, status: 'working', title: '接待者的新任务', sourceRevision: 1 })
  let nextVisit = false
  for (let i = 0; i < 1600 && !nextVisit; i++) {
    safeTick(runtime, 50, () => tick())
    const actors = runtime.readActors(), host = actors.find(actor => actor.id === hostId)
    assert.equal(host.posture, 'seated')
    assert.equal(host.facing, 'back')
    assert.deepEqual(host.position, hostPosition)
    assert.equal(host.presentation.title, '接待者的新任务')
    assert(actors.filter(actor => actor.posture !== 'seated' || actor.motion || actor.step || actor.seatTransition).length <= 1)
    const next = runtime.readActivePhases().find(phase => phase.capability === 'office.idle-coffee' && phase.activityId !== first.activityId)
    if (next) {
      const previous = actors.find(actor => actor.id === visitorId)
      assert.equal(previous.posture, 'seated')
      assert(!previous.motion && !previous.step && !previous.seatTransition)
      nextVisit = true
    }
  }
  assert(nextVisit, 'no follow-up visitor after safe return')
})

test('an explicit second coffee request cannot evict the current visitor or bypass the per-office slot', t => {
  const { runtime, idle, until, submit } = fixture(t)
  until(() => coffeePhase(runtime), 'no visit')
  const first = coffeePhase(runtime)
  const [visitor, host] = runtime.readActors().filter(actor => !first.participants.includes(actor.id))
  const result = submit({ type: 'activity.start', capability: 'office.idle-coffee', busyPolicy: 'reject',
    participants: [{ entityId: visitor.id, role: 'visitor' }, { entityId: host.id, role: 'host' }],
    params: { mode: 'visit', anchor: 'conversationLeft', turns: [
      { speaker: 'visitor', durationMs: 2200, sip: false }, { speaker: 'host', durationMs: 1800, sip: true },
    ] } })
  assert.equal(result.error?.code, 'BUSY')
  assert.equal(runtime.getRecord(first.activityId).status, 'running')
  assert.equal(runtime.readActivePhases().filter(phase => phase.capability === 'office.idle-coffee').length, 1)
  idle.setEnabled(false)
  until(() => home(runtime), 'visitor failed to return after the rejected second request')
})

test('the old group-gathering command is rejected instead of moving two colleagues off their seats', t => {
  const { runtime, submit } = fixture(t)
  const result = submit({ type: 'activity.start', capability: 'office.idle-coffee', busyPolicy: 'reject',
    participants: [{ entityId: 'office-lead', role: 'colleague' }, { entityId: 'code-agent', role: 'colleague' }],
    params: { placeId: 'desk-3', anchors: ['coffee1', 'coffee2'], turns: [
      { speaker: 0, durationMs: 2200, sip: false }, { speaker: 1, durationMs: 1800, sip: true },
    ] } })
  assert.equal(result.error?.code, 'INVALID_PARAMS')
  assert(home(runtime))
})

test('every character can take a lone break at a reachable window with matching authored orientation', t => {
  for (const id of ['office-lead', 'code-agent', 'file-agent', 'app-agent', 'review-agent', 'data-agent']) {
    const { runtime, idle, until } = fixture(t, { canIdle: actorId => actorId === id })
    until(() => coffeePhase(runtime), `${id} cannot reach a window`)
    const actor = runtime.readActors().find(actor => actor.id === id)
    assert.equal(actor.position.x, 18)
    assert.equal(actor.facing, 'right')
    const presented = createOfficePresentation(undefined, true).projectActors(runtime).find(actor => actor.id === id)
    assert.equal(presented.intent.actionId, 'office.coffee.hold')
    assert.equal(presented.intent.view, actor.facing)
    idle.setEnabled(false)
    until(() => home(runtime), `${id} failed to return from the window`)
    assert(!runtime.snapshot().records.some(record => record.error))
  }
})

test('two offices can each have one visitor at the same time', t => {
  const a = fixture(t), b = fixture(t)
  a.until(() => coffeePhase(a.runtime), 'first office never started')
  b.until(() => coffeePhase(b.runtime), 'second office incorrectly shared the first office slot')
  assert.equal(a.runtime.readActors().filter(actor => actor.posture === 'standing').length, 1)
  assert.equal(b.runtime.readActors().filter(actor => actor.posture === 'standing').length, 1)
})

test('window landmarks stay fixed when furniture is moved and do not add hidden furniture to saved layouts', t => {
  const { runtime, submit } = fixture(t)
  const world = runtime.readWorld(), position = runtime.navigation.anchor(world, 'office.coffee-window', 'window1')
  const board = world.props.find(prop => prop.templateId === 'office.wall-whiteboard')
  submit({ type: 'map.edit', edit: { action: 'begin', expectedLayoutRevision: world.layoutRevision } })
  const editor = runtime.snapshot().editor
  assert.equal(submit({ type: 'map.edit', edit: { action: 'patch', draftId: editor.id, expectedDraftRevision: editor.revision,
    operations: [{ op: 'prop.put', prop: { id: board.id, name: board.name, templateId: board.templateId, position: { x: 4, y: 4 } } }], requireValid: true } }).error, undefined)
  const draft = runtime.snapshot().editor
  assert.equal(submit({ type: 'map.edit', edit: { action: 'commit', draftId: draft.id, expectedDraftRevision: draft.revision } }).error, undefined)
  assert.deepEqual(runtime.navigation.anchor(runtime.readWorld(), 'office.coffee-window', 'window1'), position)
  assert.equal(runtime.readWorld().props.length, world.props.length)
  assert.equal(runtime.snapshot().resources.find(r => r.resource === 'landmark:office.coffee-session:visitor').capacity, 1)
})

test('old completed coffee records and existing layout checkpoints remain readable without replaying the old group flow', t => {
  const { runtime } = fixture(t)
  const checkpoint = runtime.checkpoint()
  checkpoint.records.push({ command: { protocolVersion: '2.0', sceneId: runtime.sceneId, commandId: 'old-group', type: 'activity.start',
    capability: 'office.idle-coffee', participants: [{ entityId: 'office-lead', role: 'colleague' }],
    params: { placeId: 'desk-3', anchors: ['coffee1'], turns: [{ speaker: 0, durationMs: 2200, sip: false }, { speaker: 0, durationMs: 1800, sip: true }] } },
    status: 'completed', acceptedAt: Date.now() })
  const restored = createOfficeRuntime({ referenceLayout: true, persistence: { load: () => checkpoint, save() {} } })
  t.after(() => restored.dispose())
  assert.equal(restored.snapshot().persistenceError, undefined)
  assert.equal(restored.getRecord('old-group').status, 'completed')
  assert(home(restored))
  assert.equal(restored.readActivePhases().length, 0)
})

test('an upcoming sip keeps a held cup until its speech and phase clock are actually ready', t => {
  const { runtime, tick, until } = fixture(t)
  until(() => runtime.snapshot().activities.some(activity => activity.status === 'active' && !activity.phaseStarted
    && activity.plan.phases[activity.phaseIndex]?.actions?.some(action => action.actionId === 'office.coffee.sip')), 'no pending sip boundary')
  const phase = runtime.readActivePhases().find(phase => phase.capability === 'office.idle-coffee')
  assert.equal(phase.ready, false)
  const pack = createOfficePresentation(undefined, true)
  const visitor = pack.projectActors(runtime).find(actor => actor.id === phase.participants[0])
  assert.equal(visitor.intent.actionId, 'office.coffee.hold')
  tick()
  assert.equal(runtime.readActivePhases().find(current => current.activityId === phase.activityId)?.ready, true)
  assert.equal(pack.projectActors(runtime).find(actor => actor.id === visitor.id).intent.actionId, 'office.coffee.sip')
  assert.equal(runtime.readActors().find(actor => actor.id === phase.participants[1]).speech?.text, '...')
})

test('queued business eligibility changes interrupt the host even while their displayed status stays idle', t => {
  const blocked = new Set()
  const { runtime, idle, tick, until } = fixture(t, { canIdle: id => !blocked.has(id) })
  until(() => coffeePhase(runtime), 'no visit')
  const first = coffeePhase(runtime), hostId = first.participants[1]
  blocked.add(hostId)
  for (let i = 0; i < 6; i++) tick()
  assert.equal(runtime.getRecord(first.activityId).status, 'cancelled')
  assert.equal(runtime.readActors().find(actor => actor.id === hostId).presentation.status, 'idle')
  idle.setEnabled(false)
  until(() => home(runtime), 'visitor failed to return after host received queued business work')
})
