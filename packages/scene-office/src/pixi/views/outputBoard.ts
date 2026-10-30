import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import type { OutputBoard, WhiteboardMode } from '@pawoffice/protocol/office-ui'
import { WHITEBOARD_PREVIEW_LAYOUT } from '../../taskBoard.ts'

export type WhiteboardDisplay = {
  read(): { mode: WhiteboardMode; outputBoard?: OutputBoard; enabled: boolean }
  select(mode: WhiteboardMode): void
}

/** Static HTML uses the existing HTMLText texture; the room remains the only board background. */
export function renderOutputPreview(board?: OutputBoard): string {
  const { width, height } = WHITEBOARD_PREVIEW_LAYOUT
  const content = board?.overviewHtml ?? '<div style="padding:32px 12px;color:#203450;font-size:36px;font-weight:650">今日成果<div style="margin-top:24px;color:#778390;font-size:30px;font-weight:400">等待结果更新</div></div>'
  return `<div style="box-sizing:border-box;width:${width}px;height:${height}px;padding:8px 24px 16px;background:transparent;overflow:hidden;font-family:system-ui,sans-serif;color:#203450">${content}</div>`
}

/** Scene children share the board transform, including browser zoom and viewport resizing. */
export function createWhiteboardLabels(display: WhiteboardDisplay) {
  const root = new Container()
  const buttons = (['collaboration', 'output'] as const).map((mode, index) => {
    const button = new Container(), background = new Graphics()
    const text = new Text({ text: mode === 'collaboration' ? '协作' : '结果',
      resolution: 2, style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fontWeight: '500', align: 'center' } })
    text.anchor.set(.5); text.position.set(32, 18)
    button.position.set(-14, -133 + index * 49)
    button.rotation = index === 0 ? -.035 : .025
    button.hitArea = new Rectangle(0, 0, 64, 38)
    button.eventMode = 'static'; button.cursor = 'pointer'
    button.addChild(background, text)
    button.on('pointertap', event => { event.stopPropagation(); if (display.read().enabled) display.select(mode) })
    root.addChild(button)
    return { mode, background, text }
  })
  let previous = ''
  return { root, update() {
    const state = display.read()
    root.visible = state.enabled
    if (previous === state.mode) return
    previous = state.mode
    for (const { mode, background, text } of buttons) {
      const selected = state.mode === mode
      const white = mode === 'collaboration'
      background.clear()
        .poly([2, 3, 66, 3, 66, 33, 58, 41, 2, 41]).fill({ color: 0x594d39, alpha: .16 })
        .poly([0, 0, 64, 0, 64, 30, 56, 38, 0, 38]).fill(white ? 0xfffdf5 : 0xffe49b)
        .stroke({ color: white ? 0xdcd8cc : 0xd7bd78, width: .6 })
        .poly([56, 30, 64, 30, 56, 38]).fill(white ? 0xe8e4d8 : 0xeacb7d)
        .rect(21, -3, 22, 7).fill({ color: 0xe5d8b7, alpha: .55 })
      if (selected) background.moveTo(18, 32).lineTo(46, 32).stroke({ color: 0x665333, width: 1.8 })
      text.style.fill = white ? 0x4b514a : 0x68521e
      text.style.fontWeight = selected ? '600' : '500'
    }
  } }
}
