import { Container, Graphics, Sprite, type Texture } from 'pixi.js'
import type { SceneAmbientView } from '@pawoffice/renderer-pixi/ScenePresentationPack'

// Sunlit floor beside the bottom-right planter, clear of the conference table.
const SLEEP_SPOT = { x: 860, y: 805 }
const CAT_AND_BED_WIDTH = 90
const ZZZ_SECONDS = 3.6

export function createOfficeCat(texture: Texture, reducedMotion?: () => boolean): SceneAmbientView {
  const root = new Container({ label: 'office-cat', eventMode: 'none', interactiveChildren: false })
  root.position.set(SLEEP_SPOT.x, SLEEP_SPOT.y)
  root.zIndex = SLEEP_SPOT.y

  const cat = new Sprite({ texture, label: 'office-cat-sleeping' })
  cat.anchor.set(.5, 1)
  cat.scale.set(CAT_AND_BED_WIDTH / texture.width)
  const shadow = new Graphics().ellipse(0, -2.25, 36.75, 4.5).fill({ color: 0x65523f, alpha: .12 })
  root.addChild(shadow, cat)

  // Draw the glyphs once; each update only adjusts their position and opacity.
  const glyphs = [8, 7, 5].map((size, index) => {
    const glyph = new Graphics({ label: 'office-cat-zzz' })
    glyph.moveTo(0, 0).lineTo(size, 0).lineTo(0, size).lineTo(size, size)
      .stroke({ color: 0x526a65, width: 1.2, cap: 'round', join: 'round' })
    glyph.position.set(-26 + index * 9, -cat.height - 1 - index * 4)
    root.addChild(glyph)
    return { glyph, baseY: glyph.y, offset: index / 3 }
  })

  const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
  const reduceMotion = reducedMotion ?? (() => media?.matches ?? false)
  let elapsed = 0
  return {
    roots: [root],
    update(dt) {
      const still = reduceMotion()
      if (!still && Number.isFinite(dt) && dt > 0) elapsed = (elapsed + Math.min(dt, .1)) % ZZZ_SECONDS
      for (const { glyph, baseY, offset } of glyphs) {
        const phase = (elapsed / ZZZ_SECONDS + offset) % 1
        glyph.y = still ? baseY : baseY - 9 * phase
        glyph.alpha = still ? .5 : .65 * Math.sin(Math.PI * phase)
      }
    },
  }
}
