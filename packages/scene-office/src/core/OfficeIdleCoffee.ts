import type { SceneRuntime } from '@pawoffice/runtime'
import type { Actor, Point, Snapshot } from '@pawoffice/runtime/model'
import type { SceneCommand, StartCommand } from '@pawoffice/protocol'
import { IDLE_COFFEE, IDLE_RETURN } from './idleCoffee.ts'
import { COFFEE_WINDOW, COFFEE_WINDOW_ANCHORS } from './coffeeLocations.ts'

type Rest = { ids: string[]; visitorId: string; returning: boolean }
type Options = { random?: () => number; canIdle?: (id: string) => boolean; delayMs?: number }
type Turn = { speaker: 'visitor' | 'host' | 'none'; durationMs: number; sip: boolean }
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** Per-office, host-clock behavior. One visitor owns the whole departure/return cycle. */
export class OfficeIdleCoffee {
  private readonly runtime: SceneRuntime
  private readonly options: Options
  private readonly random: () => number
  private readonly managed = new Map<string, Rest>()
  private readonly returning = new Set<string>()
  private readonly cooldown = new Map<string, number>()
  private readonly lastRest = new Map<string, number>()
  private readonly lastPartner = new Map<string, string>()
  private restSequence = 0
  private unsubscribe?: () => void
  private internal = false
  private enabled = true
  private disposed = false
  private suspended = false
  private editingRequested = false
  private sawEditor = false
  private poll = 0
  private editingWaiters: (() => void)[] = []

  constructor(runtime: SceneRuntime, options: Options = {}) {
    this.runtime = runtime; this.options = options; this.random = options.random ?? Math.random
    this.resume()
  }
  get isEnabled() { return this.enabled }
  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) this.interrupt()
  }
  resume() {
    if (this.disposed) return
    this.suspended = false
    this.unsubscribe ??= this.runtime.beforeCommand(command => this.before(command))
  }
  suspend() { this.suspended = true; this.interrupt() }
  dispose() {
    if (this.disposed) return
    this.suspend(); this.interrupt(undefined, true)
    this.disposed = true; this.returning.clear(); this.unsubscribe?.(); this.unsubscribe = undefined
    this.editingWaiters.splice(0).forEach(resolve => resolve())
  }
  prepareEditing(): Promise<void> {
    this.editingRequested = true
    this.suspend()
    if (!this.managed.size && !this.returning.size) return Promise.resolve()
    return new Promise(resolve => this.editingWaiters.push(resolve))
  }
  cancelEditingPreparation() { this.editingRequested = false }
  private delay() { return this.options.delayMs ?? 5000 + this.random() * 10000 }
  private shuffle<T>(list: readonly T[]): T[] {
    const result = [...list]
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] }
    return result
  }
  private submit(command: SceneCommand) {
    this.internal = true
    try { return this.runtime.submit(command) }
    finally { this.internal = false }
  }
  private base() { return { protocolVersion: '2.0' as const, sceneId: this.runtime.sceneId, commandId: `coffee-${crypto.randomUUID()}` } }
  private retire(commandId: string, rest: Rest) {
    this.managed.delete(commandId)
    // The seated host never joins the return queue, even if their business state changes.
    this.returning.add(rest.visitorId)
    rest.ids.forEach(id => this.cooldown.set(id, this.delay()))
  }
  private interrupt(ids?: Set<string>, includeReturns = false) {
    for (const [commandId, rest] of [...this.managed]) {
      if (rest.returning && !includeReturns || ids && !rest.ids.some(id => ids.has(id))) continue
      this.retire(commandId, rest)
      const record = this.runtime.getRecord(commandId)
      if (record?.status === 'queued') this.submit({ ...this.base(), type: 'command.cancel', targetCommandId: commandId })
      else if (record?.status === 'running') this.submit({ ...this.base(), type: 'activity.stop', activityId: commandId })
    }
  }
  private before(command: SceneCommand) {
    if (this.internal) return
    if (command.type === 'activity.start') {
      // Another coffee request must wait for the shared slot, never evict its current visitor.
      if ([IDLE_COFFEE, IDLE_RETURN].includes(command.capability)) return
      const ids = new Set(command.participants.map(p => p.entityId))
      this.interrupt()
      this.interrupt(ids, true)
      ids.forEach(id => this.cooldown.set(id, this.delay()))
    } else if (command.type === 'actor.presentation.set') {
      const actor = this.runtime.readActors().find(actor => actor.id === command.actorId)
      if (!actor || command.sourceRevision <= actor.presentation.sourceRevision) return
      this.cooldown.set(command.actorId, this.delay())
      if (command.status !== 'idle') this.interrupt(new Set([command.actorId]))
    } else if (command.type === 'map.edit' && command.edit.action === 'begin') this.suspend()
  }
  private atHome(actor: Actor, snapshot: Snapshot) {
    if (!actor.homeId) return true
    const seat = this.runtime.navigation.anchor(snapshot.world, actor.homeId, 'seat')
    return actor.posture === 'seated' && distance(actor.position, seat) === 0 && !actor.seatTransition
  }
  tick(elapsedMs: number) {
    if (this.disposed) return
    const dt = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(elapsedMs, 100)) : 0
    if (this.runtime.isEditing) { this.sawEditor = true; return }
    if (this.sawEditor) { this.sawEditor = false; this.editingRequested = false }
    if (!dt) return
    for (const [id, remaining] of this.cooldown) this.cooldown.set(id, Math.max(0, remaining - dt))
    this.poll -= dt
    if (this.poll > 0) return
    this.poll = 250
    const snapshot = this.runtime.snapshot()
    if (snapshot.persistenceError) { this.interrupt(); return }
    const actors = new Map(snapshot.world.actors.map(actor => [actor.id, actor]))
    for (const id of this.cooldown.keys()) if (!actors.has(id)) {
      this.cooldown.delete(id); this.lastRest.delete(id); this.lastPartner.delete(id)
    }
    for (const [commandId, rest] of [...this.managed]) {
      const record = this.runtime.getRecord(commandId)
      if (!record || !['queued', 'running'].includes(record.status)) this.retire(commandId, rest)
      else if (!rest.returning && rest.ids.some(id => actors.get(id)?.presentation.status !== 'idle' || this.options.canIdle?.(id) === false)) {
        this.interrupt(new Set(rest.ids))
      }
    }
    const busy = new Set(snapshot.resources.filter(resource => resource.holders.length).flatMap(resource => {
      const match = /^actor:(.*):(body|speech)$/.exec(resource.resource)
      return match ? [match[1]] : []
    }))
    for (const record of snapshot.records) if (record.status === 'queued' && record.command.type === 'activity.start') {
      record.command.participants.forEach(p => busy.add(p.entityId))
    }
    for (const id of [...this.returning]) {
      const actor = actors.get(id)
      if (!actor || this.atHome(actor, snapshot)) { this.returning.delete(id); continue }
      if (busy.has(id) || actor.motion || actor.step || actor.seatTransition) continue
      this.returning.delete(id)
      this.start(id, true, {})
      busy.add(id)
    }
    if (!this.managed.size && !this.returning.size && this.editingWaiters.length) {
      this.editingWaiters.splice(0).forEach(resolve => resolve())
    }
    if (!this.enabled || this.suspended || this.editingRequested || this.returning.size || this.managed.size) return
    if (snapshot.activities.some(activity => activity.status === 'active' && [IDLE_COFFEE, IDLE_RETURN].includes(activity.capability))) return
    // Count true idle colleagues before filtering temporary motion, speech and resource locks.
    // An unavailable colleague must not turn a multi-person office into a lone-window break.
    const idleActors = snapshot.world.actors.filter(actor => actor.homeId && actor.presentation.status === 'idle'
      && this.options.canIdle?.(actor.id) !== false)
    const available = idleActors.filter(actor => !busy.has(actor.id) && !actor.motion && !actor.step
      && !actor.seatTransition && !actor.speech && !actor.expression && this.atHome(actor, snapshot))
    for (const actor of available) if (!this.cooldown.has(actor.id)) this.cooldown.set(actor.id, this.delay())
    const ready = this.shuffle(available.filter(actor => this.cooldown.get(actor.id) === 0))
      .sort((a, b) => (this.lastRest.get(a.id) ?? -1) - (this.lastRest.get(b.id) ?? -1))
    for (const visitor of ready) {
      this.cooldown.set(visitor.id, this.delay())
      if (idleActors.length === 1) {
        const anchor = this.shuffle(COFFEE_WINDOW_ANCHORS).find(anchor => this.reachable(visitor, COFFEE_WINDOW, anchor, snapshot))
        if (anchor) { this.start(visitor.id, false, { mode: 'window', anchor, turns: this.turns(false) }); return }
      } else {
        const hosts = this.shuffle(available.filter(actor => actor.id !== visitor.id))
          .sort((a, b) => Number(a.id === this.lastPartner.get(visitor.id)) - Number(b.id === this.lastPartner.get(visitor.id)))
        for (const host of hosts) {
          const anchor = this.shuffle(['conversationLeft', 'conversationRight'] as const).find(anchor => {
            try {
              const point = this.runtime.navigation.anchor(snapshot.world, host.homeId!, anchor)
              // Only use actual side positions supported by both seated and coffee artwork.
              return Math.abs(point.x - host.position.x) > Math.abs(point.y - host.position.y)
                && this.reachable(visitor, host.homeId!, anchor, snapshot)
            } catch { return false }
          })
          if (!anchor) continue
          if (this.start(visitor.id, false, { mode: 'visit', anchor, turns: this.turns(true) }, host.id)) {
            this.lastPartner.set(visitor.id, host.id)
          }
          return
        }
      }
    }
  }
  private start(visitorId: string, returning: boolean, params: StartCommand['params'], hostId?: string) {
    const command = { ...this.base(), type: 'activity.start' as const, capability: returning ? IDLE_RETURN : IDLE_COFFEE,
      busyPolicy: 'reject' as const, timeoutMs: 90000,
      participants: [{ entityId: visitorId, role: 'visitor' }, ...(hostId ? [{ entityId: hostId, role: 'host' }] : [])], params }
    this.managed.set(command.commandId, { ids: command.participants.map(p => p.entityId), visitorId, returning })
    const result = this.submit(command)
    if (result.error) {
      this.managed.delete(command.commandId)
      if (returning) this.returning.add(visitorId)
      return false
    }
    if (!returning) this.lastRest.set(visitorId, ++this.restSequence)
    return true
  }
  private reachable(visitor: Actor, placeId: string, anchor: string, snapshot: Snapshot) {
    try {
      const world = snapshot.world, point = this.runtime.navigation.anchor(world, placeId, anchor)
      if (snapshot.resources.some(resource => resource.resource === `anchor:${placeId}:${anchor}` && resource.holders.length)) return false
      if (!this.runtime.navigation.walkable(world, point) || world.actors.some(actor => distance(actor.position, point) === 0
        || actor.step && distance(actor.step.to, point) === 0)) return false
      const desk = world.props.find(prop => prop.id === visitor.homeId)
      const approaches = desk && this.runtime.template(desk.templateId).interactions?.seat?.approaches
      const starts = visitor.posture === 'seated' && approaches
        ? approaches.map(anchor => this.runtime.navigation.anchor(world, desk!.id, anchor)) : [visitor.position]
      return starts.some(from => { try { this.runtime.navigation.path(world, from, point); return true } catch { return false } })
    } catch { return false }
  }
  private turns(visit: boolean): Turn[] {
    const count = visit ? 6 + Math.floor(this.random() * 2) * 2 : 6 + Math.floor(this.random() * 3)
    const firstHost = this.random() < .5
    const speakers: Turn['speaker'][] = Array.from({ length: count }, (_, index) => !visit ? 'none'
      : (index % 2 === 0) === firstHost ? 'host' : 'visitor')
    const candidates = speakers.flatMap((speaker, index) => speaker === 'visitor' ? [] : [index])
    const sipSlots = new Set(this.shuffle(candidates).slice(0, 1 + Math.floor(this.random() * 3)))
    const turns: Turn[] = []
    speakers.forEach((speaker, index) => {
      const sip = sipSlots.has(index)
      turns.push({ speaker, sip, durationMs: Math.floor(sip ? 1800 + this.random() * 400 : 2200 + this.random() * 1400) })
      if (visit && index < count - 1 && this.random() < .2) turns.push({ speaker: 'none', sip: false, durationMs: Math.floor(1200 + this.random() * 600) })
    })
    return turns
  }
}
