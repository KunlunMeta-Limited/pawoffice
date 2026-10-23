import type { SceneReadPort } from '@pawoffice/runtime'
import type { World } from '@pawoffice/runtime/model'
import type { PresentedActor } from '@pawoffice/contracts/presentation'
import { COFFEE_HOLD, COFFEE_SIP, IDLE_COFFEE } from '../core/idleCoffee.ts'

/** Select full-body authored clips; the runtime still owns activity timing. */
export function projectCoffeeActors(runtime: SceneReadPort, world: World, actors: PresentedActor[],
  supports: (appearanceId: string) => boolean = () => true,
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false): PresentedActor[] {
  if (runtime.isEditing) return actors
  const phases = runtime.readActivePhases().filter(phase => phase.capability === IDLE_COFFEE)
  const actions = new Map(phases.flatMap(phase => phase.actions
    .filter(action => action.actionId === COFFEE_HOLD || action.actionId === COFFEE_SIP)
    // Keep the cup visible across a phase boundary, but never start a sip before
    // the new phase's poses, speech and timing have actually been initialized.
    .map(action => [action.actorId, { ...action, actionId: phase.ready ? action.actionId : COFFEE_HOLD,
      progress: phase.ready ? phase.progress : 0 }] as const)))
  if (!actions.size) return actors
  const entities = new Map(world.actors.map(actor => [actor.id, actor]))
  return actors.map(actor => {
    const action = actions.get(actor.id), entity = entities.get(actor.id)
    if (!action || !supports(actor.appearanceId) || entity?.presentation.status !== 'idle'
      || entity.posture !== 'standing' || entity.motion || entity.step || entity.seatTransition) return actor
    // Visits select side anchors; window breaks explicitly face their window. Never rotate away
    // from the window merely to fit the artwork, or put a cup on the seated host.
    const view = actor.intent.view
    if (view !== 'left' && view !== 'right') return actor
    const sip = action.actionId === COFFEE_SIP && !reducedMotion
    return { ...actor, intent: { actionId: sip ? COFFEE_SIP : COFFEE_HOLD,
      poseId: 'standing', view, progress: sip ? Math.max(0, Math.min(1, action.progress)) : 0,
      speech: action.actionId === COFFEE_HOLD ? actor.intent.speech : undefined } }
  })
}
