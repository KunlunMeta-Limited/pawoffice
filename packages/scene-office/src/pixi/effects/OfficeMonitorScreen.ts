import { CanvasSource, DOMAdapter, MeshSimple, Texture } from 'pixi.js'
import type { PresentedActor } from '@pawoffice/contracts/presentation'
import { TRIAL_COMPUTER, trialComputerPlacement } from '../workstationSurface.ts'

export const OFFICE_MONITOR_SCREEN = { width: 128, height: 256, viewportHeight: 56, fps: 20,
  pixelsPerSecond: 12, scrollSeconds: 2.5, pauseSeconds: .7 } as const

// Inset from the source screen and below its window bar, leaving the original bezel visible.
const SCREEN_CORNERS = [349, 201, 1190, 201, 1187, 539, 352, 539]
const CODE_LINES = [
  'const task = queue.next();',
  'if (task.ready) {',
  '  await agent.run(task);',
  '  const result = {',
  '    status: "running",',
  '    output: task.output,',
  '  };',
  '  store.update(result);',
  '}',
  '',
  '// verify the next step',
  'async function verify() {',
  '  const checks = await test();',
  '  return checks.every(ok);',
  '}',
  '',
]

let shared: { texture: Texture; users: number } | undefined

function acquireCodeTexture() {
  if (!shared) {
    const { width, height } = OFFICE_MONITOR_SCREEN
    const canvas = DOMAdapter.get().createCanvas(width, height), context = canvas.getContext('2d')
    if (!context) throw new Error('A 2D canvas is required for the office monitor texture')
    context.fillStyle = '#173d49'; context.fillRect(0, 0, width, height)
    context.fillStyle = '#153742'; context.fillRect(0, 0, 15, height)
    context.font = '6px monospace'; context.textBaseline = 'top'
    for (let row = 0; row < height / 8; row++) {
      const line = CODE_LINES[row % CODE_LINES.length], y = row * 8 + 1
      context.fillStyle = '#668e98'; context.fillText(String(row + 1).padStart(2, ' '), 2, y)
      context.fillStyle = line.startsWith('//') ? '#7eaa9b' : row % 3 === 0 ? '#a2cbb9' : row % 3 === 1 ? '#b3c8dd' : '#dbc99f'
      context.fillText(line, 19, y)
    }
    const source = new CanvasSource({ resource: canvas, width, height, resolution: 1,
      addressModeU: 'clamp-to-edge', addressModeV: 'repeat', scaleMode: 'linear', autoGenerateMipmaps: false })
    shared = { texture: new Texture({ source }), users: 0 }
  }
  const resource = shared
  resource.users++
  let released = false
  return { texture: resource.texture, release() {
    if (released) return
    released = true
    if (--resource.users === 0) { resource.texture.destroy(true); if (shared === resource) shared = undefined }
  } }
}

export function officeMonitorWorking(actor: PresentedActor, propId: string) {
  return actor.status === 'working' && actor.task?.status === 'running' && actor.intent.actionId === 'office.type'
    && actor.intent.view === 'back' && !actor.intent.speech && actor.furniture?.propId === propId
    && actor.furniture.seated && !actor.furniture.transitioning
}

export class OfficeMonitorClock {
  offset: number
  private time: number
  private budget = 0

  constructor(id: string) {
    let hash = 0
    for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
    hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b) >>> 0
    hash = (hash ^ (hash >>> 16)) >>> 0
    this.offset = (hash % 997) / 997
    this.time = (hash % 127) / 127 * (OFFICE_MONITOR_SCREEN.scrollSeconds + OFFICE_MONITOR_SCREEN.pauseSeconds)
  }

  update(dt: number, active: boolean, reducedMotion = false) {
    if (!active || reducedMotion || !Number.isFinite(dt) || dt <= 0) { this.budget = 0; return false }
    const { fps, scrollSeconds, pauseSeconds, pixelsPerSecond, height } = OFFICE_MONITOR_SCREEN
    this.budget += Math.min(dt, .1)
    const steps = Math.floor((this.budget + 1e-8) * fps)
    if (!steps) return false
    const elapsed = steps / fps, cycle = scrollSeconds + pauseSeconds
    this.budget = Math.max(0, this.budget - elapsed)
    const distance = (time: number) => Math.floor(time / cycle) * scrollSeconds + Math.min(time % cycle, scrollSeconds)
    const advance = distance(this.time + elapsed) - distance(this.time)
    this.time = (this.time + elapsed) % cycle
    if (advance <= 1e-8) return false
    this.offset = (this.offset + advance * pixelsPerSecond / height) % 1
    return true
  }
}

export function createOfficeMonitorScreen(id: string, reducedMotion?: () => boolean) {
  const lease = acquireCodeTexture(), clock = new OfficeMonitorClock(id)
  const c = TRIAL_COMPUTER, scale = c.targetWidth / c.width, top = trialComputerPlacement().topY
  const vertices = new Float32Array(SCREEN_CORNERS.map((value, i) => i % 2
    ? top + (value - c.top) * scale : (value - c.left - c.width / 2) * scale))
  const uvs = new Float32Array([0, 0, 1, 0, 1, 0, 0, 0])
  const paintOffset = () => {
    const bottom = clock.offset + OFFICE_MONITOR_SCREEN.viewportHeight / OFFICE_MONITOR_SCREEN.height
    uvs[1] = uvs[3] = clock.offset
    uvs[5] = uvs[7] = bottom
  }
  paintOffset()
  const root = new MeshSimple({ texture: lease.texture, vertices, uvs, label: `office-monitor-screen:${id}`, eventMode: 'none' })
  root.autoUpdate = false
  root.visible = false
  const geometry = root.geometry
  root.on('destroyed', () => { geometry.destroy(true); lease.release() })
  const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  const reduceMotion = reducedMotion ?? (() => media?.matches ?? false)
  let working = false
  return { root,
    setWorking(value: boolean) { working = value; if (value) root.visible = true },
    updateFrame(dt: number) {
      if (root.destroyed || !clock.update(dt, working, reduceMotion())) return
      paintOffset()
      geometry.getBuffer('aUV').update()
    },
  }
}
