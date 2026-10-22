import { configureCharacterResources } from '@pawoffice/assets-office/frame/resources'
import { configureOfficeAssets } from '@pawoffice/scene-office/pixi'
import { OfficeIdleCoffee } from '@pawoffice/scene-office/core'
import { OfficeScene } from '../../apps/web/src/application/OfficeScene.ts'
import { OfficeSimulation } from '../../apps/web/src/application/OfficeSimulation.ts'
import { createOfficeRuntime } from '../../apps/web/src/application/createOfficeRuntime.ts'

configureCharacterResources('/characters')
configureOfficeAssets({ baseUrl: '/assets/office' })
const runtime = createOfficeRuntime({ referenceLayout: true })
const simulation = new OfficeSimulation(runtime)
let seed = 42
const idle = new OfficeIdleCoffee(runtime, { delayMs: 0, random: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 } })
const scene = new OfficeScene({ runtime, simulation, idleCoffee: true })
await scene.init(document.getElementById('scene')!, 1100, 850)
await scene.prepareActions()
Object.assign(window, { coffeeFixture: { runtime, scene, idle,
  advance(ms: number) { for (let remaining = ms; remaining > 0; remaining -= 50) { runtime.tick(Math.min(50, remaining)); idle.tick(Math.min(50, remaining)) } },
  snapshot: () => runtime.snapshot(),
} })
import.meta.hot?.dispose(() => { idle.dispose(); scene.destroy(); runtime.dispose() })
