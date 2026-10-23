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
const query = new URLSearchParams(location.search)
const idle = new OfficeIdleCoffee(runtime, { delayMs: 0,
  canIdle: query.get('mode') === 'window' ? id => id === (query.get('actor') ?? 'office-lead') : undefined,
  random: () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 } })
const scene = new OfficeScene({ runtime, simulation, idleCoffee: true })
await scene.init(document.getElementById('scene')!, 1100, 850)
await scene.prepareActions()
const advanceUntil = (condition: () => boolean) => {
  for (let i = 0; i < 2400; i++) {
    if (condition()) {
      document.getElementById('state')!.textContent = runtime.readActors().filter(actor => actor.speech)
        .map(actor => `${actor.name} ${actor.speech!.text}`).join(' / ') || '当前无人发言'
      return
    }
    runtime.tick(50); idle.tick(50)
  }
  throw new Error('咖啡预览没有到达目标阶段')
}
document.getElementById('arrive')!.onclick = () => advanceUntil(() => runtime.readActivePhases()
  .some(phase => phase.ready && phase.actions.some(action => action.actionId === 'office.coffee.hold')))
document.getElementById('sip')!.onclick = () => advanceUntil(() => runtime.readActivePhases()
  .some(phase => phase.ready && phase.progress > .4 && phase.progress < .7 && phase.actions.some(action => action.actionId === 'office.coffee.sip')))
document.getElementById('chat')!.onclick = () => {
  const old = runtime.readActivePhases().find(phase => phase.capability === 'office.idle-coffee')
  advanceUntil(() => runtime.snapshot().activities.some(activity => activity.status === 'active' && activity.phaseStarted
    && (activity.id !== old?.activityId || activity.phaseIndex !== old.phaseIndex)
    && activity.plan.phases[activity.phaseIndex]?.speech?.length))
}
document.getElementById('return')!.onclick = () => {
  idle.setEnabled(false)
  advanceUntil(() => runtime.readActors().every(actor => actor.posture === 'seated' && !actor.motion && !actor.step && !actor.seatTransition))
}
Object.assign(window, { coffeeFixture: { runtime, scene, idle,
  advance(ms: number) { for (let remaining = ms; remaining > 0; remaining -= 50) { runtime.tick(Math.min(50, remaining)); idle.tick(Math.min(50, remaining)) } },
  snapshot: () => runtime.snapshot(),
} })
import.meta.hot?.dispose(() => { idle.dispose(); scene.destroy(); runtime.dispose() })
