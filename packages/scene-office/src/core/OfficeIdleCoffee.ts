import type { SceneRuntime } from '@pawoffice/runtime'
import type { Actor, Point, Snapshot } from '@pawoffice/runtime/model'
import type { SceneCommand, StartCommand } from '@pawoffice/protocol'
import { IDLE_COFFEE, IDLE_RETURN } from './idleCoffee.ts'

type Rest = { ids: string[]; returning: boolean }
type Options = { random?: () => number; canIdle?: (id: string) => boolean; delayMs?: number }
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** Host-clock driven, optional behavior; business commands always take precedence. */
export class OfficeIdleCoffee {
  private readonly runtime: SceneRuntime
  private readonly options: Options
  private readonly random: () => number
  private readonly managed = new Map<string, Rest>()
  private readonly returning = new Set<string>()
  private readonly cooldown = new Map<string, number>()
  private readonly lastRest = new Map<string, number>()
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
  /** The UI waits for safe seat transitions before starting a map draft. */
  prepareEditing(): Promise<void> {
    this.editingRequested = true
    this.suspend()
    if (!this.managed.size && !this.returning.size) return Promise.resolve()
    return new Promise(resolve => this.editingWaiters.push(resolve))
  }
  cancelEditingPreparation() { this.editingRequested = false }
  private delay() { return this.options.delayMs ?? 5000 + this.random() * 10000 }
  private submit(command: SceneCommand) {
    this.internal = true
    try { return this.runtime.submit(command) }
    finally { this.internal = false }
  }
  private base() { return { protocolVersion: '2.0' as const, sceneId: this.runtime.sceneId, commandId: `coffee-${crypto.randomUUID()}` } }
  private interrupt(ids?: Set<string>, includeReturns = false) {
    for (const [commandId, rest] of [...this.managed]) {
      if (rest.returning && !includeReturns || ids && !rest.ids.some(id => ids.has(id))) continue
      // Retire before stopping: status notifications must not recursively stop this activity.
      this.managed.delete(commandId)
      rest.ids.forEach(id => { this.returning.add(id); this.cooldown.set(id, this.delay()) })
      const record = this.runtime.getRecord(commandId)
      if (record?.status === 'queued') this.submit({ ...this.base(), type: 'command.cancel', targetCommandId: commandId })
      else if (record?.status === 'running') this.submit({ ...this.base(), type: 'activity.stop', activityId: commandId })
    }
  }
  private before(command: SceneCommand) {
    if (this.internal) return
    if (command.type === 'activity.start') {
      const ids = new Set(command.participants.map(p => p.entityId))
      // Stop all chats to free aisles, and release return trips owned by requested participants.
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
    for (const id of this.cooldown.keys()) if (!actors.has(id)) { this.cooldown.delete(id); this.lastRest.delete(id) }
    for (const [commandId, rest] of [...this.managed]) {
      const record = this.runtime.getRecord(commandId)
      if (!record || !['queued', 'running'].includes(record.status)) {
        this.managed.delete(commandId)
        rest.ids.forEach(id => { this.returning.add(id); this.cooldown.set(id, this.delay()) })
      } else if (!rest.returning && rest.ids.some(id => actors.get(id)?.presentation.status !== 'idle' || this.options.canIdle?.(id) === false)) {
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
    // Recover each colleague independently; a business activity can keep another one busy.
    for (const id of [...this.returning]) {
      const actor = actors.get(id)
      if (!actor || this.atHome(actor, snapshot)) { this.returning.delete(id); continue }
      if (busy.has(id) || actor.motion || actor.step || actor.seatTransition) continue
      this.returning.delete(id)
      this.start([id], true, {})
      busy.add(id)
    }
    if (!this.managed.size && !this.returning.size && this.editingWaiters.length) {
      this.editingWaiters.splice(0).forEach(resolve => resolve())
    }
    if (!this.enabled || this.suspended || this.editingRequested || this.returning.size) return
    // Stagger arrivals: avoid sending several groups through the same seat corridors at once.
    if (snapshot.activities.some(activity => this.managed.has(activity.id) && (!activity.phaseStarted
      || !activity.plan.phases[activity.phaseIndex]?.actions?.length))) return
    const available = snapshot.world.actors.filter(actor => actor.homeId && actor.presentation.status === 'idle'
      && !busy.has(actor.id) && !actor.motion && !actor.step && !actor.seatTransition && !actor.speech && !actor.expression
      && this.options.canIdle?.(actor.id) !== false)
    for (const actor of available) if (!this.cooldown.has(actor.id)) this.cooldown.set(actor.id, this.delay())
    const ready = available.filter(actor => this.cooldown.get(actor.id) === 0)
    if (!ready.length) return
    // Fisher–Yates makes every eligible colleague and station reachable without biased sort callbacks.
    for (let i = ready.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [ready[i], ready[j]] = [ready[j], ready[i]] }
    // Keep random partners while giving colleagues who have waited longest the first places.
    ready.sort((a, b) => (this.lastRest.get(a.id) ?? -1) - (this.lastRest.get(b.id) ?? -1))
    const size = ready.length >= 3 && (ready.length === 3 || this.random() < .45) ? 3 : Math.min(2, ready.length)
    // A single colleague drinks alone only when nobody else is eligible.
    if (size === 1 && available.length > 1) return
    let group = ready.slice(0, size)
    let spot = this.spot(group, snapshot)
    if (!spot && group.length === 3) { group = group.slice(0, 2); spot = this.spot(group, snapshot) }
    group.forEach(actor => this.cooldown.set(actor.id, this.delay()))
    if (!spot) return
    const groupSize = group.length
    const turns = Array.from({ length: groupSize * 3 }, (_, index) => ({ speaker: index % groupSize,
      durationMs: index >= groupSize && index < groupSize * 2 ? 1800 : Math.floor(2200 + this.random() * 1800), sip: index >= groupSize && index < groupSize * 2 }))
    this.start(group.map(actor => actor.id), false, { ...spot, turns: turns.slice(0, 10) })
  }
  private start(ids: string[], returning: boolean, params: StartCommand['params']) {
    const command = { ...this.base(), type: 'activity.start' as const, capability: returning ? IDLE_RETURN : IDLE_COFFEE,
      busyPolicy: 'reject' as const, timeoutMs: 60000,
      participants: ids.map(entityId => ({ entityId, role: 'colleague' })), params }
    this.managed.set(command.commandId, { ids, returning })
    const result = this.submit(command)
    if (result.error) {
      this.managed.delete(command.commandId)
      if (returning) ids.forEach(id => this.returning.add(id))
    } else if (!returning) { const sequence = ++this.restSequence; ids.forEach(id => this.lastRest.set(id, sequence)) }
  }
  private spot(group: Actor[], snapshot: Snapshot) {
    const world = snapshot.world
    const chatting = new Set(snapshot.activities.filter(activity => activity.status === 'active' && activity.capability === IDLE_COFFEE).flatMap(activity => activity.participants))
    const stations = world.props.filter(prop => this.runtime.template(prop.templateId).anchors.conversationLeft)
    const start = Math.floor(this.random() * Math.max(1, stations.length))
    for (let offset = 0; offset < stations.length; offset++) {
      const prop = stations[(start + offset) % stations.length]
      const anchors = ['coffee1', 'coffee2', 'coffee3'].filter(anchor => {
        try {
          if (snapshot.resources.some(resource => resource.resource === `anchor:${prop.id}:${anchor}` && resource.holders.length)) return false
          const point = this.runtime.navigation.anchor(world, prop.id, anchor)
          if (world.actors.some(actor => chatting.has(actor.id) && Math.abs(actor.position.x - point.x) < 2
            && Math.abs(actor.position.y - point.y) < 3)) return false
          if (!this.runtime.navigation.walkable(world, point) || world.actors.some(actor => distance(actor.position, point) === 0
            || actor.step && distance(actor.step.to, point) === 0)) return false
          // Keep standing groups out of one-cell corridors whenever possible.
          const exits = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
            .filter(delta => this.runtime.navigation.walkable(world, { x: point.x + delta.x, y: point.y + delta.y }))
          return exits.length >= 2
        } catch { return false }
      })
      if (anchors.length < group.length) continue
      const chosen = anchors.slice(0, group.length)
      // Resolve the actual seated departure routes before accepting a social activity.
      const reachable = group.every((actor, index) => {
        const target = this.runtime.navigation.anchor(world, prop.id, chosen[index])
        const desk = world.props.find(p => p.id === actor.homeId)
        const approaches = desk && this.runtime.template(desk.templateId).interactions?.seat?.approaches
        return (actor.posture === 'seated' && approaches ? approaches.map(anchor => this.runtime.navigation.anchor(world, desk!.id, anchor)) : [actor.position])
          .some(from => { try { this.runtime.navigation.path(world, from, target); return true } catch { return false } })
      })
      if (reachable) return { placeId: prop.id, anchors: chosen }
    }
    return undefined
  }
}
