import { configureCharacterResources } from '@pawoffice/assets-office/frame/resources'
import { configureOfficeAssets } from '@pawoffice/scene-office/pixi'
import type { Application, MeshSimple } from 'pixi.js'
import type { PropView } from '@pawoffice/renderer-pixi/PropViewRegistry'
import { OfficeScene } from '../../apps/web/src/application/OfficeScene.ts'
import { OfficeSimulation } from '../../apps/web/src/application/OfficeSimulation.ts'
import { createOfficeRuntime } from '../../apps/web/src/application/createOfficeRuntime.ts'

configureCharacterResources('/characters')
configureOfficeAssets({ baseUrl: '/assets/office' })
const runtime = createOfficeRuntime({ referenceLayout: true }), simulation = new OfficeSimulation(runtime)
const scene = new OfficeScene({ runtime, simulation })
const host = document.getElementById('scene')!, state = document.getElementById('state')!
const resize = () => scene.resize(host.clientWidth, host.clientHeight)
await scene.init(host, host.clientWidth, host.clientHeight)
await scene.prepareActions()
const internals = scene as unknown as { propViews: Map<string, PropView>; app: Application }
const screens = () => [...internals.propViews.values()].flatMap(view => view.roots)
  .filter(root => root.label?.startsWith('office-monitor-screen:')) as MeshSimple[]
let textureUpdates = 0, suspended = false
screens()[0].texture.source.on('update', () => textureUpdates++)
const work = (working: boolean) => {
  for (const actor of runtime.readActors()) scene.setAgentState(actor.id, working ? 'working' : 'idle', working ? 'Development' : '')
  state.textContent = working ? 'Working' : 'Idle'
}
document.getElementById('work')!.onclick = () => work(true)
document.getElementById('idle')!.onclick = () => work(false)
document.getElementById('suspend')!.onclick = () => {
  suspended = !suspended; scene.setRenderingSuspended(suspended)
  state.textContent = suspended ? 'Suspended' : 'Visible'
}
window.addEventListener('resize', resize)
Object.assign(window, { monitorFixture: {
  runtime, scene,
  inspect: () => ({ textureUpdates, sharedTextures: new Set(screens().map(root => root.texture)).size,
    screens: screens().map(root => ({ id: root.label, visible: root.visible, uvs: [...root.geometry.uvs],
      updates: root.geometry.getBuffer('aUV')._updateID, bounds: root.getBounds().rectangle,
      texture: { width: root.texture.width, height: root.texture.height } })) }),
  render: () => internals.app.render(),
} })
work(true)
import.meta.hot?.dispose(() => { window.removeEventListener('resize', resize); scene.destroy(); simulation.dispose(); runtime.dispose() })
