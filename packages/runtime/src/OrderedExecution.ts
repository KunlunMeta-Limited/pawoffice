import type { SceneError } from '@pawoffice/protocol'

export type OrderedEffect = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  errors: SceneError[]
}
type Command = { kind: 'command'; id: string; yieldContinuous: boolean; done: boolean; error?: SceneError }
type Group = { kind: 'group'; mode: 'sequence' | 'parallel'; children: Step[]; cursor: number; done: boolean }
type Effect = Omit<Group, 'kind'> & { kind: 'effect'; apply: () => void; handle: OrderedEffect; expiresAt: number;
  complete?: (effect: OrderedEffect) => void }
type Step = Command | Group | Effect
type Port = {
  pending: (id: string, yieldContinuous: boolean) => boolean
  error: (id: string) => SceneError | undefined
  cancel: (id: string) => void
  changed: (effect: OrderedEffect) => void
  now: () => number
}

/** One execution timeline for commands, explicit batches and local presentation commits. */
export class OrderedExecution {
  private steps: Step[] = []
  private collecting?: Group | Effect
  private effects = new Map<string, Effect>()
  private commands = new Set<string>()
  private readonly port: Port
  constructor(port: Port) { this.port = port }

  has(id: string) { return this.commands.has(id) }
  get size() { return this.commands.size + this.effects.size }

  command(id: string, yieldContinuous = false) {
    this.commands.add(id)
    this.append({ kind: 'command', id, yieldContinuous, done: false })
  }

  batch<T>(mode: Group['mode'], submit: () => T): T {
    const siblings = this.collecting?.children ?? this.steps
    const group: Group = { kind: 'group', mode, children: [], cursor: 0, done: false }
    this.append(group)
    try { return this.collect(group, submit) }
    finally { if (!group.children.length) siblings.splice(siblings.indexOf(group), 1) }
  }

  effect(apply: () => void, complete?: Effect['complete']): OrderedEffect {
    const handle: OrderedEffect = { id: `effect-${globalThis.crypto.randomUUID()}`, status: 'queued', errors: [] }
    if (this.size >= 128) { handle.status = 'failed'; handle.errors.push({ code: 'QUEUE_FULL', message: '展示执行队列已满' }); return handle }
    const step: Effect = { kind: 'effect', mode: 'sequence', children: [], cursor: 0, done: false,
      apply, complete, handle, expiresAt: this.port.now() + 120000 }
    this.effects.set(handle.id, step)
    this.append(step)
    return handle
  }

  /** Controls may cancel waiting commits without waiting behind the activity they stop. */
  cancel(id: string) {
    const step = this.effects.get(id)
    if (!step || step.done) return
    step.handle.status = 'cancelled'
    const cancel = (child: Step) => {
      if (child.kind === 'command') { if (!child.done) this.port.cancel(child.id) }
      else child.children.forEach(cancel)
    }
    step.children.forEach(cancel)
  }

  allowed(): ReadonlySet<string> {
    while (this.steps.length) {
      const next = this.advance(this.steps[0])
      if (next) return next
      this.steps.shift()
    }
    return new Set()
  }

  clear() {
    const discard = (step: Step) => {
      step.done = true
      if (step.kind === 'effect') step.handle.status = 'cancelled'
      if (step.kind !== 'command') step.children.forEach(discard)
    }
    this.steps.forEach(discard)
    this.steps = []; this.effects.clear(); this.commands.clear(); this.collecting = undefined
  }

  get isCollecting() { return this.collecting !== undefined }
  private append(step: Step) { (this.collecting?.children ?? this.steps).push(step) }
  private collect<T>(group: Group | Effect, run: () => T): T {
    const previous = this.collecting
    this.collecting = group
    try { return run() } finally { this.collecting = previous }
  }

  private advance(step: Step): Set<string> | undefined {
    if (step.done) return
    if (step.kind === 'command') {
      if (this.port.pending(step.id, step.yieldContinuous)) return new Set([step.id])
      step.error = this.port.error(step.id)
      this.commands.delete(step.id); step.done = true
      return
    }
    if (step.kind === 'effect' && step.handle.status === 'queued') {
      step.handle.status = 'running'
      try {
        if (this.port.now() > step.expiresAt) throw new Error('展示消息在队列中等待过期')
        this.collect(step, step.apply)
      } catch (error) {
        step.handle.errors.push({ code: 'PRESENTATION_FAILED', message: error instanceof Error ? error.message : String(error) })
      }
    }
    if (step.mode === 'parallel') {
      const allowed = new Set<string>()
      for (const child of step.children) for (const id of this.advance(child) ?? []) allowed.add(id)
      if (allowed.size) return allowed
    } else {
      while (step.cursor < step.children.length) {
        const next = this.advance(step.children[step.cursor])
        if (next) return next
        step.cursor++
      }
    }
    if (step.done) return
    step.done = true
    if (step.kind === 'effect') {
      this.effects.delete(step.handle.id)
      const collectErrors = (child: Step) => {
        if (child.kind === 'command') {
          if (child.error) step.handle.errors.push(child.error)
        } else child.children.forEach(collectErrors)
      }
      step.children.forEach(collectErrors)
      if (step.handle.status !== 'cancelled') {
        step.handle.status = step.handle.errors.length ? 'failed' : 'completed'
        try { step.complete?.(step.handle) }
        catch (error) { step.handle.status = 'failed'; step.handle.errors.push({ code: 'PRESENTATION_FAILED', message: String(error) }) }
      }
      this.port.changed(step.handle)
    }
  }
}
