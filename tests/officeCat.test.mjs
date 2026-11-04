import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { Assets, DOMAdapter, Texture, TextureSource } from 'pixi.js'
import { createTestServer } from './helpers/vite.mjs'

let server, cat, createReferenceOfficePresentation, createOfficeRuntime
before(async () => {
  server = await createTestServer()
  cat = await server.ssrLoadModule('/packages/scene-office/src/pixi/effects/OfficeCat.ts')
  ;({ createReferenceOfficePresentation } = await server.ssrLoadModule('/packages/scene-office/src/pixi/index.ts'))
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
})
after(() => server?.close())

const atlas = () => new Texture({ source: new TextureSource({ width: 1536, height: 768 }) })
const cleanup = (view, texture) => { view.dispose(); view.roots.forEach(root => root.destroy({ children: true })); texture.destroy(true) }

test('the cat fades in while walking, lies down, sleeps, rises and walks away before fading out', () => {
  const motion = new cat.OfficeCatMotion(), phases = new Set()
  motion.update(0, true)
  assert.equal(motion.alpha, 0, 'a click must not pop a visible cat into existence')
  assert(motion.y > 630, 'the cat enters from the floor below its sleeping spot')
  for (let i = 0; i < 300; i++) {
    motion.update(1 / 60, true); phases.add(motion.phase)
    assert(motion.x + cat.OFFICE_CAT.displayPixels / 2 <= 1040, 'the full cat stays inside the right wall throughout arrival')
  }
  assert.deepEqual([...phases], ['entering', 'settling', 'sleeping'])
  assert.deepEqual([motion.x, motion.y, motion.alpha], [976, 630, 1])
  const sleep = cat.officeCatPose(motion)
  assert([...sleep.keys()].every(frame => frame >= 16))
  motion.update(0, false)
  assert.equal(motion.alpha, 1, 'closing begins by rising, without abruptly hiding the cat')
  for (let i = 0; i < 240; i++) { motion.update(1 / 60, false); phases.add(motion.phase) }
  assert.deepEqual([...phases], ['entering', 'settling', 'sleeping', 'rising', 'leaving', 'hidden'])
  assert.equal(motion.alpha, 0)
  assert(motion.x < 976, 'the cat actually moves away before disappearing')
})

test('rapid toggles preserve visible position, posture and opacity, including during a departure', () => {
  const motion = new cat.OfficeCatMotion()
  for (let frame = 0; frame < 1200; frame++) {
    const enabled = frame < 250 || frame > 700 ? true : Math.floor(frame / 13) % 2 === 0
    const before = { x: motion.x, y: motion.y, alpha: motion.alpha, posture: motion.posture }
    motion.update(1 / 60, enabled)
    if (before.alpha > 0 && motion.alpha > 0) {
      assert(Math.hypot(motion.x - before.x, motion.y - before.y) < 4, 'a visible cat must not teleport on reversal')
      assert(Math.abs(motion.alpha - before.alpha) < .1, 'opacity remains continuous')
      assert(Math.abs(motion.posture - before.posture) < .03, 'interrupting a lie-down resumes from the current posture')
    }
  }
  assert.equal(motion.phase, 'sleeping')
})

test('the cat blends adjacent poses, pauses with zero deltas, respects reduced motion and releases shared-source views', t => {
  t.mock.method(DOMAdapter.get(), 'createCanvas', () => ({ getContext: () => null }))
  const texture = atlas()
  let reduced = false, enabled = false
  const view = cat.createOfficeCat(texture, () => enabled, () => reduced), root = view.roots[0], poses = root.children[1]
  const frames = poses.children.map(sprite => sprite.texture)
  const snapshot = () => [root.x, root.y, root.alpha, ...poses.children.map(sprite => sprite.alpha)]
  try {
    assert.equal(root.eventMode, 'none'); assert.equal(root.interactiveChildren, false)
    assert.equal(view.activeMotion, false)
    enabled = true
    for (let i = 0; i < 320; i++) view.update(1 / 60)
    assert.equal(root.visible, true); assert.equal(view.activeMotion, true)
    const active = poses.children.filter(sprite => sprite.visible)
    assert.equal(active.length, 2, 'neighboring sleep poses mix continuously instead of holding for half a second')
    assert(Math.abs(active.reduce((sum, sprite) => sum + sprite.alpha, 0) - 1) < 1e-6, 'frame weights preserve opaque fur')
    assert(active.every(sprite => sprite.blendMode === 'add'))
    assert.equal(poses.filters.length, 1, 'frame blending is isolated from the office background')
    const before = snapshot()
    for (const dt of [0, -1, NaN, Infinity]) { view.update(dt); assert.deepEqual(snapshot(), before) }
    reduced = true; view.update(1 / 60)
    assert.equal(view.activeMotion, false)
    const still = snapshot()
    for (let i = 0; i < 20; i++) view.update(1 / 60)
    assert.deepEqual(snapshot(), still)
    enabled = false
    view.update(1 / 60)
    assert(root.visible && root.alpha > 0 && root.alpha < 1, 'reduced motion retains a gentle fade without walking')
    for (let i = 0; i < 60; i++) view.update(1 / 60)
    assert.equal(root.visible, false)
    view.dispose(); view.dispose(); view.update(1)
    assert(frames.every(frame => frame.destroyed))
    assert.equal(texture.source.destroyed, false)
  } finally { cleanup(view, texture) }
})

test('connected reference offices load one cat atlas and never add cats to business or saved world state', async t => {
  t.mock.method(DOMAdapter.get(), 'createCanvas', () => ({ getContext: () => null }))
  const runtime = createOfficeRuntime({ referenceLayout: true }), before = runtime.snapshot()
  const texture = atlas(), generic = new Texture({ source: new TextureSource({ width: 1536, height: 1536 }) })
  const workAtlas = new Texture({ source: new TextureSource({ width: 480, height: 320 }) })
  t.after(() => { runtime.dispose(); texture.destroy(true); generic.destroy(true); workAtlas.destroy(true) })
  const loads = []
  t.mock.method(Assets, 'load', async alias => {
    loads.push(alias)
    return alias === 'office-cat-motion-v2' ? texture : alias === 'office-work-crafting-lite-v1' ? workAtlas : generic
  })
  let enabled = false
  const pack = createReferenceOfficePresentation({ catEnabled: () => enabled }), reports = []
  assert.throws(() => pack.createAmbientViews(runtime), /Load the office cat atlas/)
  await pack.loadObjects(resource => reports.push(resource))
  const views = pack.createAmbientViews(runtime)
  try {
    assert.equal(views.length, 1, 'one cat is mounted even when work clouds are disabled')
    assert.equal(views[0].roots[0].label, 'office-cat')
    assert.equal(views[0].roots[0].visible, false, 'the cat starts hidden')
    enabled = true; views[0].update(0, runtime.readWorld())
    assert.equal(views[0].roots[0].visible, false, 'enabling starts at zero opacity')
    for (let i = 0; i < 300; i++) views[0].update(.05, runtime.readWorld(), pack.projectActors(runtime))
    assert.equal(views[0].roots[0].visible, true)
    assert.equal(loads.filter(alias => alias === 'office-cat-motion-v2').length, 1)
    assert.equal(reports.filter(resource => resource === 'office-cat-motion-v2').length, 1)
    assert.equal(pack.resourceCount, 9)
    assert.deepEqual(runtime.snapshot(), before)
  } finally { views.forEach(view => { view.dispose(); view.roots.forEach(root => root.destroy({ children: true })) }) }
  const workingPack = createReferenceOfficePresentation({ workEffects: true })
  await workingPack.loadObjects(() => {})
  const combined = workingPack.createAmbientViews(runtime)
  try {
    const roots = combined.flatMap(view => view.roots)
    assert.equal(roots.filter(root => root.label === 'office-cat').length, 1)
    assert.equal(roots.find(root => root.label === 'office-cat').visible, false, 'standalone packs also default to a hidden cat')
    assert.equal(roots.filter(root => root.label.startsWith('office-work-effect:')).length, 6)
    combined.forEach(view => view.update(.05, runtime.readWorld(), workingPack.projectActors(runtime)))
    assert.equal(workingPack.resourceCount, 10)
    assert.deepEqual(runtime.snapshot(), before)
  } finally { combined.forEach(view => { view.dispose(); view.roots.forEach(root => root.destroy({ children: true })) }) }
})

test('the office cat switch defaults off and toggles without changing business state or saved layouts', async t => {
  const { OfficeScene } = await server.ssrLoadModule('/apps/web/src/application/OfficeScene.ts')
  const runtime = createOfficeRuntime({ referenceLayout: true }), scene = new OfficeScene({ runtime })
  t.after(() => { scene.destroy(); runtime.dispose() })
  const before = runtime.snapshot()
  assert.equal(scene.canOfficeCat, true)
  assert.equal(scene.officeCatEnabled, false)
  for (const enabled of [true, false, true, false]) {
    scene.setOfficeCat(enabled)
    assert.equal(scene.officeCatEnabled, enabled)
    assert.deepEqual(runtime.snapshot(), before)
  }
})

test('the renderer uses 60 FPS for the visible cat and restores 20 FPS once it has left', async t => {
  t.mock.method(DOMAdapter.get(), 'createCanvas', () => ({ getContext: () => null }))
  const { OfficeScene } = await server.ssrLoadModule('/apps/web/src/application/OfficeScene.ts')
  const runtime = createOfficeRuntime({ referenceLayout: true }), scene = new OfficeScene({ runtime }), texture = atlas()
  const view = cat.createOfficeCat(texture, () => scene.officeCatEnabled, () => false)
  let renders = 0
  scene.app = { render() { renders++ } }; scene.layer = { sortChildren() {} }; scene.ambientViews = [view]
  t.after(() => { scene.app = null; scene.layer = null; scene.destroy(); cleanup(view, texture); runtime.dispose() })
  const second = () => { renders = 0; for (let i = 0; i < 60; i++) scene.onTick({ deltaTime: 1 }); return renders }
  assert.equal(second(), 20)
  scene.setOfficeCat(true)
  assert.equal(second(), 60)
  scene.setOfficeCat(false)
  for (let i = 0; i < 180; i++) scene.onTick({ deltaTime: 1 })
  assert.equal(second(), 20)
})

test('the published motion atlas has 32 distinct transparent poses, including 16 sleep frames, on one ground baseline', async () => {
  const generated = await readFile(new URL('../public/assets/office/ambient/cat-motion-v2.png', import.meta.url))
  const { data, info } = await sharp(generated).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 1536); assert.equal(info.height, 768)
  const hashes = new Set()
  for (let frame = 0; frame < 32; frame++) {
    const left = frame % 8 * 192, top = Math.floor(frame / 8) * 192
    const bytes = await sharp(generated).extract({ left, top, width: 192, height: 192 }).png().toBuffer()
    hashes.add(createHash('sha256').update(bytes).digest('hex'))
    let opaque = 0, lowest = 0
    for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) {
      const alpha = data[((top + y) * info.width + left + x) * 4 + 3]
      if (alpha >= 128) { opaque++; lowest = y }
      if (x < 4 || x >= 188 || y < 4 || y >= 188) assert.equal(alpha, 0, `frame ${frame}: artwork must not bleed into adjacent cells`)
    }
    assert(opaque > 8000, `frame ${frame}: retain the whole cat`)
    assert(lowest >= 147 && lowest <= 150, `frame ${frame}: paws remain on the common baseline`)
  }
  assert.equal(hashes.size, 32)
})
