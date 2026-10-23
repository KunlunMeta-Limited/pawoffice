import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { Assets, DOMAdapter, Texture, TextureSource } from 'pixi.js'
import { createTestServer } from './helpers/vite.mjs'

let server, screen
before(async () => {
  server = await createTestServer()
  screen = await server.ssrLoadModule('/packages/scene-office/src/pixi/effects/OfficeMonitorScreen.ts')
})
after(() => server?.close())

function mockCanvas(t) {
  const calls = []
  const context = { fillRect() {}, fillText: (...args) => calls.push(args) }
  const create = t.mock.method(DOMAdapter.get(), 'createCanvas', (width, height) => ({ width, height, getContext: () => context }))
  return { create, calls }
}

const actor = { id: 'worker', status: 'working', task: { status: 'running' },
  intent: { actionId: 'office.type', view: 'back' }, furniture: { propId: 'desk', seated: true, transitioning: false } }

test('monitor scrolling follows actual seated typing, not just a running task', () => {
  assert.equal(screen.officeMonitorWorking(actor, 'desk'), true)
  for (const change of [{ status: 'idle' }, { task: { status: 'completed' } }, { task: { status: 'blocked' } },
    { intent: { ...actor.intent, actionId: 'core.walk' } }, { intent: { ...actor.intent, actionId: 'core.idle' } },
    { intent: { ...actor.intent, speech: { text: 'Hello' } } }, { intent: { ...actor.intent, view: 'front' } },
    { furniture: { ...actor.furniture, seated: false } }, { furniture: { ...actor.furniture, transitioning: true } },
    { furniture: { ...actor.furniture, propId: 'other' } }]) {
    assert.equal(screen.officeMonitorWorking({ ...actor, ...change }, 'desk'), false)
  }
  assert.equal(screen.officeMonitorWorking(actor, 'other'), false)
})

test('monitor clocks cap updates at 20 Hz even during 60 FPS walking elsewhere', () => {
  const a = new screen.OfficeMonitorClock('desk-0'), b = new screen.OfficeMonitorClock('desk-0')
  let changes = 0
  for (let i = 0; i < 600; i++) if (a.update(1 / 60, true)) changes++
  for (let i = 0; i < 200; i++) b.update(.05, true)
  assert(changes > 120 && changes <= 200)
  assert(Math.abs(a.offset - b.offset) < 1e-8, 'scroll speed must not depend on scene render cadence')
  const offsets = new Set(Array.from({ length: 6 }, (_, i) => new screen.OfficeMonitorClock(`desk-${i}`).offset))
  assert.equal(offsets.size, 6)
  assert(Math.max(...offsets) - Math.min(...offsets) > .5, 'consecutive desk IDs must not show nearly identical code')
})

test('monitor scrolling includes short pauses, wraps safely and never catches up after inactivity', () => {
  const clock = new screen.OfficeMonitorClock('desk')
  let holds = 0, changes = 0
  for (let i = 0; i < 2000; i++) {
    if (clock.update(.05, true)) changes++
    else holds++
    assert(clock.offset >= 0 && clock.offset < 1)
  }
  assert(holds > 300 && changes > 1200)
  const before = clock.offset
  for (const dt of [0, -1, NaN, Infinity]) assert.equal(clock.update(dt, true), false)
  assert.equal(clock.update(10000, false), false)
  assert.equal(clock.update(10000, true, true), false)
  assert.equal(clock.offset, before)
  clock.update(10000, true)
  assert((clock.offset - before + 1) % 1 <= .1 * 12 / 256 + 1e-8, 'background time must not cause a scroll jump')
})

test('six monitor quads share one tiny static texture and only mutate their UV buffers', t => {
  const canvas = mockCanvas(t)
  const views = Array.from({ length: 6 }, (_, i) => screen.createOfficeMonitorScreen(`desk-${i}`, () => false))
  t.after(() => views.forEach(view => { if (!view.root.destroyed) view.root.destroy() }))
  const texture = views[0].root.texture, source = texture.source
  const uploads = t.mock.method(source, 'update')
  const vertices = views.map(view => [...view.root.vertices])
  const positions = views.map(view => t.mock.method(view.root.geometry.getBuffer('aPosition'), 'update'))
  const uvs = views.map(view => t.mock.method(view.root.geometry.getBuffer('aUV'), 'update'))
  assert.equal(canvas.create.mock.callCount(), 1)
  assert.equal(canvas.calls.length, 64)
  assert.equal(texture.width, 128); assert.equal(texture.height, 256)
  assert.equal(source.style.addressModeV, 'repeat')
  assert.equal(source.autoGenerateMipmaps, false)
  assert(views.every(view => view.root.texture === texture && !view.root.autoUpdate && view.root.eventMode === 'none'))
  views.forEach(view => view.setWorking(true))
  for (let frame = 0; frame < 600; frame++) views.forEach(view => view.updateFrame(1 / 60))
  assert.equal(uploads.mock.callCount(), 0, 'animation must not redraw or re-upload the canvas texture')
  assert.equal(canvas.calls.length, 64)
  views.forEach((view, i) => {
    assert.deepEqual([...view.root.vertices], vertices[i])
    assert.equal(positions[i].mock.callCount(), 0)
    assert(uvs[i].mock.callCount() > 120 && uvs[i].mock.callCount() <= 200)
    assert.equal(view.root.visible, true)
  })
  const buffers = views[0].root.geometry.buffers.slice()
  views[0].root.destroy()
  assert(buffers.every(buffer => buffer.destroyed), 'each monitor must release its geometry buffers')
  assert.equal(source.destroyed, false, 'another monitor still needs the shared texture')
  views.slice(1).forEach(view => view.root.destroy())
  assert.equal(source.destroyed, true)
  const remounted = screen.createOfficeMonitorScreen('new')
  assert.notEqual(remounted.root.texture, texture)
  assert.equal(canvas.create.mock.callCount(), 2)
  remounted.root.destroy()
})

test('idle, reduced-motion and zero-time frames keep the monitor still without hiding its last code frame', t => {
  mockCanvas(t)
  let reduced = false
  const view = screen.createOfficeMonitorScreen('desk', () => reduced)
  t.after(() => view.root.destroy())
  const uv = view.root.geometry.getBuffer('aUV'), updates = t.mock.method(uv, 'update')
  assert.equal(view.root.visible, false)
  view.setWorking(true)
  for (let i = 0; i < 40; i++) view.updateFrame(.05)
  const before = [...uv.data], count = updates.mock.callCount()
  view.setWorking(false)
  for (let i = 0; i < 60; i++) view.updateFrame(.05)
  view.setWorking(true); reduced = true
  for (let i = 0; i < 60; i++) view.updateFrame(.05)
  reduced = false
  for (let i = 0; i < 60; i++) view.updateFrame(0)
  assert.deepEqual([...uv.data], before)
  assert.equal(updates.mock.callCount(), count)
  assert.equal(view.root.visible, true)
  for (let i = 0; i < 40; i++) view.updateFrame(.05)
  assert(updates.mock.callCount() > count)
})

test('workstation screens follow edited desks, stay behind occupants and update work status without desk movement', async t => {
  mockCanvas(t)
  const { loadOfficeAssets } = await server.ssrLoadModule('/packages/scene-office/src/pixi/assets/loadOfficeAssets.ts')
  const { loadWorkstationTrialAssets } = await server.ssrLoadModule('/packages/scene-office/src/pixi/assets/loadWorkstationTrialAssets.ts')
  const { referenceWorkstationView } = await server.ssrLoadModule('/packages/scene-office/src/pixi/views/referenceOffice.ts')
  const textures = []
  t.mock.method(Assets, 'load', async () => {
    const texture = new Texture({ source: new TextureSource({ width: 1536, height: 1295 }) })
    textures.push(texture); return texture
  })
  await loadOfficeAssets(); await loadWorkstationTrialAssets()
  const prop = { id: 'desk', position: { x: 5, y: 5 } }, view = referenceWorkstationView(prop)
  t.after(() => { view.roots.forEach(root => root.destroy({ children: true })); textures.forEach(texture => texture.destroy(true)) })
  view.update(prop, {}, [actor])
  const root = view.roots.find(root => root.label === 'office-monitor-screen:desk')
  const x = root.x, y = root.y, uv = root.geometry.getBuffer('aUV'), start = [...uv.data]
  assert.equal(root.visible, true)
  assert(root.zIndex > view.hitTarget.zIndex)
  assert(root.zIndex < 365, 'the seated occupant must cover the screen normally')
  for (let i = 0; i < 40; i++) view.updateFrame(.05)
  assert.notDeepEqual([...uv.data], start)
  view.update(prop, {}, [{ ...actor, task: { status: 'completed' } }])
  const paused = [...uv.data]
  for (let i = 0; i < 40; i++) view.updateFrame(.05)
  assert.deepEqual([...uv.data], paused)
  view.update({ ...prop, position: { x: 7, y: 6 } }, {}, [])
  assert.equal(root.x, x + 100); assert.equal(root.y, y + 50)
})
