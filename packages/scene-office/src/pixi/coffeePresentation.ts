import type { SceneReadPort } from '@pawoffice/runtime'
import type { World } from '@pawoffice/runtime/model'
import type { PresentedActor } from '@pawoffice/contracts/presentation'
import { COFFEE_HOLD, COFFEE_SIP, IDLE_COFFEE } from '../core/idleCoffee.ts'

/** Select full-body authored clips; the runtime still owns activity timing. */
export function projectCoffeeActors(runtime: SceneReadPort, world: World, actors: PresentedActor[],
  supports: (appearanceId: string) => boolean = () => true,
  reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false): PresentedActor[] {
  if (runtime.isEditing) return actors
  const phases = runtime.readActivePhases().filter(phase => phase.capability === IDLE_COFFEE && phase.ready)
  const actions = new Map(phases.flatMap(phase => phase.actions
    .filter(action => action.actionId === COFFEE_HOLD || action.actionId === COFFEE_SIP)
    .map(action => [action.actorId, { ...action, progress: phase.progress, participants: phase.participants }] as const)))
  if (!actions.size) return actors
  const byId = new Map(actors.map(actor => [actor.id, actor]))
  const entities = new Map(world.actors.map(actor => [actor.id, actor]))
  return actors.map(actor => {
    const action = actions.get(actor.id), entity = entities.get(actor.id)
    if (!action || !supports(actor.appearanceId) || entity?.presentation.status !== 'idle'
      || entity.posture !== 'standing' || entity.motion || entity.step || entity.seatTransition) return actor
    const index = action.participants.indexOf(actor.id)
    const peer = byId.get(action.participants[(index + 1) % action.participants.length])
    // Only side artwork was authored. Face the conversation partner on screen;
    // navigation and the actor's stored world facing remain unchanged.
    const view = actor.intent.view === 'left' || actor.intent.view === 'right' ? actor.intent.view
      : peer && peer.id !== actor.id ? peer.position.x >= actor.position.x ? 'right' : 'left'
      : actor.intent.view === 'back' ? 'left' : 'right'
    const sip = action.actionId === COFFEE_SIP && !reducedMotion
    return { ...actor, intent: { actionId: sip ? COFFEE_SIP : COFFEE_HOLD,
      poseId: 'standing', view, progress: sip ? Math.max(0, Math.min(1, action.progress)) : 0 } }
  })
}
