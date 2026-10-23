import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, OfficeSceneControls
before(async () => {
  server = await createTestServer()
  ;({ OfficeSceneControls } = await server.ssrLoadModule('/apps/web/src/ui/OfficeSceneControls.tsx'))
})
after(() => server?.close())

function render(canDemo, { demo = false, ...props } = {}) {
  return renderToStaticMarkup(createElement(OfficeSceneControls, {
    runtime: { editorSnapshot: () => undefined }, mapView: {}, setMapView() {},
    controller: { sceneRef: { current: null }, menu: null, setMenu() {}, demo, setDemo() {}, canDemo,
      setNotice() {}, loaded: true, actions: { ready: true }, thumbnails: {}, previewProp() {}, highlightProp() {} },
    ...props,
  }))
}

test('office toolbar keeps layout/demo controls and removes the character preview entry', () => {
  const demo = render(true)
  assert.match(demo, /aria-label="编辑布局"/)
  assert.match(demo, /aria-label="开始演示"/)
  assert(!demo.includes('人物预览'))
  assert(!demo.includes('character-preview-trigger'))
  const real = render(false)
  assert.match(real, /aria-label="编辑布局"/)
  assert(!real.includes('开始演示'))
})

test('office toolbar is anchored to the top-right of the scene in both shells', async () => {
  const css = await readFile(new URL('../apps/web/src/components/OfficeCanvas.css', import.meta.url), 'utf8')
  const rule = css.match(/\.runtime-scene-toolbar\s*\{([^}]+)\}/)[1]
  assert.match(rule, /right:\s*12px/)
  assert.match(rule, /top:\s*12px/)
  assert(!/\bleft\s*:/.test(rule))
  assert(!css.includes('.runtime-scene-toolbar.is-left'))
  const workspace = await readFile(new URL('../apps/web/src/components/RuntimeWorkspace.tsx', import.meta.url), 'utf8')
  assert(!workspace.includes('toolbarPlacement'))
})

test('running demo uses only its pause icon with an accessible label and tooltip', () => {
  const html = render(true, { demo: true })
  assert.match(html, /class="runtime-scene-toolbar"/)
  assert.equal(html.match(/aria-label="编辑布局"/g)?.length, 1)
  assert.match(html, /title="停止演示" aria-label="停止演示"/)
  assert.match(html, /lucide-pause/)
  assert(!html.includes('演示中'))
  assert(!html.includes('lucide-play'))
})

test('mobile member drawer entry stays on the left away from the toolbar', async () => {
  const css = await readFile(new URL('../apps/web/src/ui/MemberOfficeShell.css', import.meta.url), 'utf8')
  const rule = css.match(/\.member-drawer-open\s*\{([^}]+)\}/)?.[1] ?? ''
  assert.match(rule, /left:\s*12px/)
  assert(!/\bright\s*:/.test(rule))
})
