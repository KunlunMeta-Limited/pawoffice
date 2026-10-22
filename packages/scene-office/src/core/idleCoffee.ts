import { z } from 'zod'
import { SceneFault, idSchema } from '@pawoffice/protocol'
import type { Actor, Phase } from '@pawoffice/runtime/model'
import type { PluginContext, ScenePlugin } from '@pawoffice/runtime/plugins'

export const IDLE_COFFEE = 'office.idle-coffee'
export const IDLE_RETURN = 'office.idle-return'
export const COFFEE_HOLD = 'office.coffee.hold'
export const COFFEE_SIP = 'office.coffee.sip'

const paramsSchema = z.strictObject({
  placeId: idSchema,
  anchors: z.array(idSchema).min(1).max(3),
  turns: z.array(z.strictObject({ speaker: z.number().int().min(0).max(2),
    durationMs: z.number().int().min(1200).max(6000), sip: z.boolean() })).min(2).max(10),
})

function participants(context: PluginContext) {
  if (context.participants.length < 1 || context.participants.length > 3 || context.participants.some(p => p.role !== 'colleague')) {
    throw new SceneFault('INVALID_PARTICIPANTS', '咖啡休息需要 1–3 位 colleague')
  }
  return context.participants.map(p => {
    const actor = context.world.actors.find(a => a.id === p.entityId)
    if (!actor?.homeId) throw new SceneFault('MISSING_BINDING', '咖啡休息人物需要绑定工位')
    return actor
  })
}

function home(list: Actor[]): Phase[] {
  // Leave in reverse arrival order so a back-row colleague can pass safely.
  return [...list].reverse().map(actor => ({ title: '返回工位',
    moves: [{ actorId: actor.id, targetId: actor.homeId!, anchor: 'seat' }] }))
}

/** Optional office behavior. It never writes task presentation or business data. */
export const officeIdleCoffee: ScenePlugin = {
  id: 'office.idle-coffee', name: '空闲咖啡闲聊', version: '1.0.0', apiVersion: 1, dependencies: ['office.objects'],
  capabilities: [
    { id: IDLE_COFFEE, name: '咖啡闲聊', params: paramsSchema,
      build(context, raw) {
        const list = participants(context), params = paramsSchema.parse(raw)
        if (params.anchors.length !== list.length || new Set(params.anchors).size !== list.length
          || params.turns.some(turn => turn.speaker >= list.length)) throw new SceneFault('INVALID_PARAMS', '闲聊站位和发言人必须与参与者对应')
        if (list.some(actor => actor.presentation.status !== 'idle')) throw new SceneFault('BUSY', '有任务的人物不能闲聊')
        const poses = list.map((actor, index) => ({ actorId: actor.id, posture: 'standing' as const,
          ...(list.length > 1 ? { lookAt: list[(index + 1) % list.length].id } : { facing: 'front' as const }) }))
        const phases: Phase[] = list.map((actor, index) => ({ title: '端杯前往闲聊',
          moves: [{ actorId: actor.id, targetId: params.placeId, anchor: params.anchors[index] }] }))
        phases.push({ title: '咖啡休息', durationMs: 1000, poses,
          actions: list.map(actor => ({ actorId: actor.id, actionId: COFFEE_HOLD })) })
        for (const turn of params.turns) {
          const speaker = list[turn.speaker]
          phases.push({ title: turn.sip ? '喝一口咖啡' : '随意聊聊', durationMs: turn.durationMs, poses,
            actions: list.map(actor => ({ actorId: actor.id, actionId: turn.sip && actor.id === speaker.id ? COFFEE_SIP : COFFEE_HOLD })),
            ...(!turn.sip && list.length > 1 ? { speech: [{ actorId: speaker.id, text: '...' }] } : {}) })
        }
        return { title: '咖啡闲聊', claims: list.flatMap(actor => ['body', 'speech'].map(channel => ({ resource: `actor:${actor.id}:${channel}`, units: 1 }))),
          phases: [...phases, ...home(list)] }
      } },
    { id: IDLE_RETURN, name: '结束休息回座', params: z.strictObject({}),
      build(context) {
        const list = participants(context)
        return { title: '返回工位', claims: list.map(actor => ({ resource: `actor:${actor.id}:body`, units: 1 })), phases: home(list) }
      } },
  ],
}
