import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Assets, Texture, TextureSource } from 'pixi.js'
import { createTestServer } from './helpers/vite.mjs'

let server, createOfficeCat, createOfficeRuntime, OfficeScene, createReferenceOfficePresentation

before(async () => {
  server = await createTestServer()
  ;({ createOfficeCat } = await server.ssrLoadModule('/packages/scene-office/src/pixi/effects/OfficeCat.ts'))
  ;({ createReferenceOfficePresentation } = await server.ssrLoadModule('/packages/scene-office/src/pixi/index.ts'))
  ;({ createOfficeRuntime } = await server.ssrLoadModule('/apps/web/src/application/createOfficeRuntime.ts'))
  ;({ OfficeScene } = await server.ssrLoadModule('/apps/web/src/application/OfficeScene.ts'))
})
after(() => server?.close())

const catTexture = () => new Texture({ source: new TextureSource({ width: 96, height: 68 }) })

test('the reference office mounts a sleeping cat and only the Zzz move', async t => {
  const runtime = createOfficeRuntime({ referenceLayout: true })
  const before = runtime.snapshot(), texture = catTexture()
  const generic = new Texture({ source: new TextureSource({ width: 1536, height: 1536 }) })
  t.after(() => { runtime.dispose(); texture.destroy(true); generic.destroy(true) })
  t.mock.method(Assets, 'load', async alias => alias === 'office-sleeping-cat' ? texture : generic)

  const pack = createReferenceOfficePresentation(), reports = []
  await pack.loadObjects(resource => reports.push(resource))
  const [view] = pack.createAmbientViews(runtime)
  const [root] = view.roots
  t.after(() => root.destroy({ children: true }))
  const [shadow, sprite, ...glyphs] = root.children
  const catPose = () => [root.x, root.y, sprite.x, sprite.y, sprite.scale.x, sprite.texture, shadow.alpha]
  const glyphPose = () => glyphs.map(glyph => [glyph.y, glyph.alpha])

  assert.equal(reports.filter(resource => resource === 'office-sleeping-cat').length, 1)
  assert.equal(root.eventMode, 'none')
  assert.equal(root.visible, true)
  assert.equal(sprite.texture, texture)
  assert.equal(glyphs.length, 3)
  view.update(0, runtime.readWorld())
  const resting = catPose(), initial = glyphPose()
  view.update(.05, runtime.readWorld())
  assert.notDeepEqual(glyphPose(), initial)
  assert.deepEqual(catPose(), resting)
  assert.deepEqual(runtime.snapshot(), before)
})

test('a visible sleeping cat retains the 20 FPS idle render budget', t => {
  const runtime = createOfficeRuntime({ referenceLayout: true })
  const scene = new OfficeScene({ runtime })
  const texture = catTexture(), view = createOfficeCat(texture, () => false)
  let renders = 0
  scene.app = { render() { renders++ } }
  scene.layer = { sortChildren() {} }
  scene.ambientViews = [view]
  t.after(() => {
    scene.app = null; scene.layer = null
    scene.destroy(); view.roots[0].destroy({ children: true })
    texture.destroy(true); runtime.dispose()
  })

  for (let i = 0; i < 60; i++) scene.onTick({ deltaTime: 1 })
  assert.equal(view.roots[0].visible, true)
  assert.equal(renders, 20)
})
