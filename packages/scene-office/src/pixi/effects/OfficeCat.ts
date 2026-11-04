import { AlphaFilter, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js'
import type { SceneAmbientView } from '@pawoffice/renderer-pixi/ScenePresentationPack'

export const OFFICE_CAT = {
  columns: 8, rows: 4, cellPixels: 192, displayPixels: 112, baseline: 150,
  position: { x: 976, y: 630 }, entry: { x: 858, y: 732 }, entryControl: { x: 870, y: 600 }, exit: { x: 884, y: 644 },
  enterSeconds: 3.2, leaveSeconds: 2, settleSeconds: 1.25, fadeSeconds: .65,
  poseBlendSeconds: .24, sleepSeconds: 6.4, walkFPS: 12,
  clips: { walk: { start: 0, count: 8 }, settle: { start: 8, count: 8 }, sleep: { start: 16, count: 16 } },
} as const

type CatPhase = 'hidden' | 'entering' | 'settling' | 'sleeping' | 'rising' | 'leaving'
const clamp = (value: number) => Math.max(0, Math.min(1, value))
const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t) }
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount

/** Presentation-only state; interruptions retain position, opacity and posture. */
export class OfficeCatMotion {
  phase: CatPhase = 'hidden'
  x: number = OFFICE_CAT.entry.x
  y: number = OFFICE_CAT.entry.y
  alpha = 0
  posture = 0
  walkTime = 0
  sleepTime = 0
  private time = 0
  private departure = { x: this.x, y: this.y, alpha: 0 }

  private leave() {
    this.phase = 'leaving'; this.time = 0
    this.departure = { x: this.x, y: this.y, alpha: this.alpha }
  }

  update(dt: number, enabled: boolean, reducedMotion = false) {
    const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, .1)) : 0
    if (reducedMotion) {
      this.x = OFFICE_CAT.position.x; this.y = OFFICE_CAT.position.y; this.posture = 1
      this.alpha = clamp(this.alpha + elapsed / OFFICE_CAT.fadeSeconds * (enabled ? 1 : -1))
      this.phase = this.alpha > 0 ? 'sleeping' : 'hidden'
      this.sleepTime = 0
      return
    }
    if (this.phase === 'hidden' && enabled) {
      this.phase = 'entering'; this.time = 0; this.posture = 0; this.walkTime = 0
      this.x = OFFICE_CAT.entry.x; this.y = OFFICE_CAT.entry.y
    }
    if (this.phase === 'entering' && !enabled) this.leave()
    if ((this.phase === 'settling' || this.phase === 'sleeping') && !enabled) this.phase = 'rising'
    if (this.phase === 'rising' && enabled) this.phase = 'settling'
    switch (this.phase) {
      case 'entering': {
        this.time += elapsed; this.walkTime += elapsed
        const progress = smooth(this.time / OFFICE_CAT.enterSeconds)
        // Curve up the open floor to the left of the planter, then toward the window.
        this.x = mix(mix(OFFICE_CAT.entry.x, OFFICE_CAT.entryControl.x, progress), mix(OFFICE_CAT.entryControl.x, OFFICE_CAT.position.x, progress), progress)
        this.y = mix(mix(OFFICE_CAT.entry.y, OFFICE_CAT.entryControl.y, progress), mix(OFFICE_CAT.entryControl.y, OFFICE_CAT.position.y, progress), progress)
        this.alpha = smooth(this.time / OFFICE_CAT.fadeSeconds)
        if (progress === 1) { this.phase = 'settling'; this.posture = 0 }
        break
      }
      case 'settling':
        this.posture = clamp(this.posture + elapsed / OFFICE_CAT.settleSeconds)
        if (this.posture === 1) { this.phase = 'sleeping'; this.sleepTime = 0 }
        break
      case 'sleeping':
        this.sleepTime = (this.sleepTime + elapsed) % OFFICE_CAT.sleepSeconds
        break
      case 'rising':
        this.posture = clamp(this.posture - elapsed / OFFICE_CAT.settleSeconds)
        if (this.posture === 0) this.leave()
        break
      case 'leaving': {
        this.time += elapsed; this.walkTime += elapsed
        const progress = smooth(this.time / OFFICE_CAT.leaveSeconds)
        this.x = mix(this.departure.x, OFFICE_CAT.exit.x, progress)
        this.y = mix(this.departure.y, OFFICE_CAT.exit.y, progress)
        this.alpha = this.departure.alpha * (1 - smooth((this.time - .45) / (OFFICE_CAT.leaveSeconds - .45)))
        // Finish an interrupted departure before re-entering, without teleporting a visible cat.
        if (progress === 1) { this.phase = 'hidden'; this.alpha = 0 }
        break
      }
    }
  }
}

/** Two adjacent authored poses, with continuous weights instead of long frame holds. */
export function officeCatPose(motion: OfficeCatMotion, reducedMotion = false): Map<number, number> {
  const { walk, settle, sleep } = OFFICE_CAT.clips
  if (reducedMotion) return new Map([[sleep.start, 1]])
  const walking = motion.phase === 'entering' || motion.phase === 'leaving'
  const resting = motion.phase === 'sleeping' || motion.phase === 'hidden'
  const clip = walking ? walk : resting ? sleep : settle
  const frame = walking ? motion.walkTime * OFFICE_CAT.walkFPS % clip.count
    : resting ? motion.sleepTime / OFFICE_CAT.sleepSeconds * clip.count : motion.posture * (clip.count - 1)
  const index = Math.floor(frame), fraction = frame - index
  const next = walking || resting ? (index + 1) % clip.count : Math.min(index + 1, clip.count - 1)
  const facingOffset = motion.phase === 'entering' ? OFFICE_CAT.columns * OFFICE_CAT.rows : 0
  if (next === index) return new Map([[clip.start + index + facingOffset, 1]])
  return new Map([[clip.start + index + facingOffset, 1 - fraction], [clip.start + next + facingOffset, fraction]])
}

/** Pure decoration: no actor, prop, command, collision or saved state. */
export function createOfficeCat(atlas: Texture, enabled: () => boolean = () => false, reducedMotion?: () => boolean): SceneAmbientView {
  const { columns, rows, cellPixels, displayPixels, baseline } = OFFICE_CAT
  if (atlas.width !== columns * cellPixels || atlas.height !== rows * cellPixels) throw new Error('Invalid office cat atlas: expected 1536 x 768')
  const frames = Array.from({ length: columns * rows }, (_, index) => new Texture({ source: atlas.source,
    frame: new Rectangle(index % columns * cellPixels, Math.floor(index / columns) * cellPixels, cellPixels, cellPixels) }))
  const root = new Container(), shadow = new Graphics(), poses = new Container()
  root.label = 'office-cat'; root.eventMode = 'none'; root.interactiveChildren = false
  root.visible = false; root.alpha = 0
  poses.label = 'office-cat-poses'
  // Isolate additive premultiplied frame weights from the office background.
  // This preserves opaque fur at blend midpoints instead of making it translucent.
  const isolation = new AlphaFilter({ alpha: 1, resolution: 'inherit', antialias: false })
  poses.filters = [isolation]
  // Mirrored walk views reuse the atlas and remain available during the turn into lying down.
  const sprites = [...frames, ...frames.slice(0, OFFICE_CAT.clips.walk.count)].map((texture, index) => {
    const sprite = new Sprite(texture)
    sprite.label = `office-cat-frame:${index}`; sprite.blendMode = 'add'; sprite.visible = false
    const scale = displayPixels / cellPixels
    sprite.anchor.set(.5, baseline / cellPixels); sprite.scale.set(index < frames.length ? scale : -scale, scale)
    poses.addChild(sprite)
    return sprite
  })
  shadow.ellipse(0, -3, 39, 7).fill({ color: 0x65523f, alpha: .13 })
  root.addChild(shadow, poses)
  const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  const reduceMotion = reducedMotion ?? (() => media?.matches ?? false)
  const motion = new OfficeCatMotion()
  let disposed = false, phase: CatPhase = 'hidden', transition: number = OFFICE_CAT.poseBlendSeconds
  let weights = new Map<number, number>(), previous = weights
  return { roots: [root],
    get activeMotion() { return !disposed && (motion.phase !== 'hidden' || enabled()) && !reduceMotion() },
    update(dt) {
      if (disposed) return
      const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(dt, .1)) : 0
      const reduced = reduceMotion()
      motion.update(elapsed, enabled(), reduced)
      root.visible = motion.alpha > 0; root.alpha = motion.alpha
      root.position.set(motion.x, motion.y); root.zIndex = motion.y
      if (!root.visible) return
      if (motion.phase !== phase) { previous = new Map(weights); transition = 0; phase = motion.phase }
      transition += elapsed
      const amount = previous.size && !reduced ? smooth(transition / OFFICE_CAT.poseBlendSeconds) : 1
      const target = officeCatPose(motion, reduced)
      weights = new Map()
      for (const [index, weight] of previous) weights.set(index, weight * (1 - amount))
      for (const [index, weight] of target) weights.set(index, (weights.get(index) ?? 0) + weight * amount)
      for (const [index, sprite] of sprites.entries()) {
        sprite.alpha = weights.get(index) ?? 0
        sprite.visible = sprite.alpha > .0001
      }
    },
    dispose() {
      if (disposed) return
      disposed = true; root.visible = false
      poses.filters = []
      isolation.destroy()
      frames.forEach(frame => frame.destroy())
    },
  }
}
