import type { SceneRuntime } from '@pawoffice/runtime/SceneRuntime'
import type { Actor } from '@pawoffice/runtime/model'
import type { SceneCommand } from '@pawoffice/protocol'
import { commandBase } from '@pawoffice/scene-office/adapters/office'

const topics = [
  ['电脑支架的商品标题核对好了吗？', '已保留六档调节、便携收纳与适用尺寸，没有夸大卖点。'],
  ['商品主图和详情的尺寸说明请再核对一次。', '收到，我确认图片与 13–16 英寸适用范围一致。'],
  ['售价先保持 79 元，核对成本与发布信息。', '好的，未计入广告和退货的模拟成本为 43 元。'],
  ['首轮访问有了，购买咨询主要问什么？', '尺寸兼容问题较集中，先提出假设，不直接归因。'],
  ['商品更新后，继续观察访问与成交的变化。', '收到，我会分别记录价格、订单和成交额。'],
]

export function demoPairs(actors: Actor[], round: number): [Actor, Actor][] {
  const roster: (Actor | undefined)[] = actors.filter(actor => actor.homeId)
  if (roster.length < 2) return []
  if (roster.length % 2) roster.push(undefined)
  // Round-robin pairs never share a participant; the next round reverses each visit.
  const rotations = Math.floor(round / 2) % (roster.length - 1)
  for (let i = 0; i < rotations; i++) roster.splice(1, 0, roster.pop())
  const pairs: [Actor, Actor][] = []
  for (let i = 0; i < roster.length / 2; i++) {
    const a = roster[i], b = roster[roster.length - 1 - i]
    if (a && b) pairs.push((round + i) % 2 ? [b, a] : [a, b])
  }
  return pairs
}

export function demoCommands(runtime: SceneRuntime, round: number): SceneCommand[] {
  return demoPairs(runtime.readActors(), round).map(([visitor, host], index) => {
    const [message, reply] = topics[(Math.floor(round / 2) + index) % topics.length]
    return {
      ...commandBase(runtime), type: 'activity.start', capability: 'office.visit',
      participants: [{ entityId: visitor.id, role: 'visitor' }, { entityId: host.id, role: 'host' }],
      params: { durationMs: 2200 + index * 400, stops: [{ hostId: host.id, message: `${host.name}，${message}`, reply: `${visitor.name}，${reply}` }] },
    }
  })
}

export function demoReturnCommands(runtime: SceneRuntime): SceneCommand[] {
  const world = runtime.readWorld()
  return world.actors.filter(actor => {
    if (!actor.homeId) return false
    const seat = runtime.navigation.anchor(world, actor.homeId, 'seat')
    return actor.posture !== 'seated' || actor.using?.propId !== actor.homeId || actor.position.x !== seat.x || actor.position.y !== seat.y
  }).map(actor => ({
    ...commandBase(runtime), type: 'activity.start', capability: 'scene.move',
    participants: [{ entityId: actor.id, role: 'actor' }], params: { targetId: actor.homeId!, anchor: 'seat' },
  }))
}
