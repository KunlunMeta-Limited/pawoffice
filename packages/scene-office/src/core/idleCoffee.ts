import { z } from 'zod'
import { SceneFault } from '@pawoffice/protocol'
import type { Actor, Phase, Pose } from '@pawoffice/runtime/model'
import type { PluginContext, ScenePlugin } from '@pawoffice/runtime/plugins'
import { COFFEE_WINDOW, COFFEE_WINDOW_ANCHORS } from './coffeeLocations.ts'

export const IDLE_COFFEE = 'office.idle-coffee'
export const IDLE_RETURN = 'office.idle-return'
export const COFFEE_HOLD = 'office.coffee.hold'
export const COFFEE_SIP = 'office.coffee.sip'
const SESSION = 'office.coffee-session'
const sessionClaim = () => ({ resource: `landmark:${SESSION}:visitor`, units: 1 })

const turnSchema = z.strictObject({ speaker: z.enum(['visitor', 'host', 'none']),
  durationMs: z.number().int().min(1200).max(6000), sip: z.boolean() })
const paramsSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('visit'), anchor: z.enum(['conversationLeft', 'conversationRight']), turns: z.array(turnSchema).min(2).max(20) }),
  z.strictObject({ mode: z.literal('window'), anchor: z.enum(COFFEE_WINDOW_ANCHORS), turns: z.array(turnSchema).min(2).max(20) }),
])

function person(context: PluginContext, role: string): Actor {
  const participants = context.participants.filter(p => p.role === role)
  if (participants.length !== 1) throw new SceneFault('INVALID_PARTICIPANTS', `需要一位 ${role}`)
  const actor = context.world.actors.find(a => a.id === participants[0].entityId)
  if (!actor?.homeId) throw new SceneFault('MISSING_BINDING', '咖啡休息人物需要绑定工位')
  return actor
}

function seated(context: PluginContext, actor: Actor) {
  const desk = context.world.props.find(prop => prop.id === actor.homeId)
  if (!desk) return false
  const offset = desk.anchors?.seat ?? context.template(desk.templateId).anchors.seat
  return actor.posture === 'seated' && !actor.motion && !actor.step && !actor.seatTransition
    && offset && actor.position.x === desk.position.x + offset.x && actor.position.y === desk.position.y + offset.y
}

function home(actor: Actor): Phase {
  return { title: '返回工位', moves: [{ actorId: actor.id, targetId: actor.homeId!, anchor: 'seat' }] }
}

/** One visitor leaves their seat; the host remains seated throughout the conversation. */
export const officeIdleCoffee: ScenePlugin = {
  // Checkpoints retain the same world schema; interrupted activities are never replayed.
  id: 'office.idle-coffee', name: '空闲咖啡拜访', version: '1.0.0', apiVersion: 1, dependencies: ['office.objects'],
  // Shared with explicit commands and interrupted return trips, independently per runtime.
  landmarks: [{ id: SESSION, anchors: {}, resources: { visitor: 1 } }],
  capabilities: [
    { id: IDLE_COFFEE, name: '咖啡休息', params: paramsSchema,
      participants: { min: 1, max: 2, roles: [{ role: 'visitor', min: 1, max: 1 }, { role: 'host', min: 0, max: 1 }],
        rules: ['参与者必须绑定工位、安全入座且处于空闲状态', 'visit 模式需要一位 host；window 模式不能包含 host', '访问者喝咖啡时不发言；window 模式的 speaker 只能为 none'] },
      build(context, raw) {
        const params = paramsSchema.parse(raw), visitor = person(context, 'visitor')
        const host = params.mode === 'visit' ? person(context, 'host') : undefined
        const list = host ? [visitor, host] : [visitor]
        if (context.participants.length !== list.length) throw new SceneFault('INVALID_PARTICIPANTS', '咖啡休息只允许访问者及可选的接待者')
        if (list.some(actor => actor.presentation.status !== 'idle')) throw new SceneFault('BUSY', '有任务的人物不能闲聊')
        if (!seated(context, visitor) || host && !seated(context, host)) throw new SceneFault('BUSY', '请在人物安全回座后开始咖啡休息')
        if (params.turns.some(turn => turn.sip && turn.speaker === 'visitor' || !host && turn.speaker !== 'none')) {
          throw new SceneFault('INVALID_PARAMS', '访问者喝咖啡时不发言，独饮时不产生聊天气泡')
        }
        const poses: Pose[] = host
          ? [{ actorId: visitor.id, posture: 'standing', lookAt: host.id }, { actorId: host.id, posture: 'seated', lookAt: visitor.id }]
          : [{ actorId: visitor.id, posture: 'standing', facing: 'right' }]
        const phases: Phase[] = [{ title: host ? `前往${host.name}的工位` : '前往窗边',
          moves: [{ actorId: visitor.id, targetId: host?.homeId ?? COFFEE_WINDOW, anchor: params.anchor }], poses },
        { title: '端杯休息', durationMs: 1000, poses, actions: [{ actorId: visitor.id, actionId: COFFEE_HOLD }] }]
        for (const turn of params.turns) {
          const speaker = turn.speaker === 'visitor' ? visitor : turn.speaker === 'host' ? host : undefined
          phases.push({ title: turn.sip ? '喝一口咖啡' : speaker ? '随意聊聊' : '安静端杯', durationMs: turn.durationMs, poses,
            actions: [{ actorId: visitor.id, actionId: turn.sip ? COFFEE_SIP : COFFEE_HOLD }],
            ...(speaker ? { speech: [{ actorId: speaker.id, text: '...' }] } : {}) })
        }
        if (host) {
          const desk = context.world.props.find(prop => prop.id === host.homeId)!
          phases.push({ title: '结束闲聊', poses: [{ actorId: host.id, posture: 'seated', facing: context.template(desk.templateId).interactions?.seat?.facing ?? 'back' }] })
        }
        return { title: host ? '工位咖啡闲聊' : '窗边咖啡休息',
          claims: [sessionClaim(), ...list.flatMap(actor => ['body', 'speech'].map(channel => ({ resource: `actor:${actor.id}:${channel}`, units: 1 }))),
            ...(host ? [{ resource: `prop:${host.homeId}:visitor`, units: 1 }] : [])],
          phases: [...phases, home(visitor)] }
      } },
    { id: IDLE_RETURN, name: '结束休息回座', params: z.strictObject({}),
      participants: { min: 1, max: 1, roles: [{ role: 'visitor', min: 1, max: 1 }], rules: ['参与者必须绑定工位'] },
      build(context) {
        const visitor = person(context, 'visitor')
        if (context.participants.length !== 1) throw new SceneFault('INVALID_PARTICIPANTS', '仅访问者需要回座')
        return { title: '返回工位', claims: [sessionClaim(), { resource: `actor:${visitor.id}:body`, units: 1 }], phases: [home(visitor)] }
      } },
  ],
}
