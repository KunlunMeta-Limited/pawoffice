// node tests/browser/resultChanges.mjs --channel=msedge
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { createPawOfficeServer } from '../../server/dist/app.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = path.join(root, 'test-results/result-workspace')
await mkdir(output, { recursive: true })
const app = await createPawOfficeServer({ officeRequestMs: 5000 })
let server, browser
try {
  const relay = await app.listen({ host: '127.0.0.1', port: 0 })
  process.env.PAWOFFICE_INTERNAL_API_URL = relay
  server = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, open: false } })
  await server.listen()
  const base = server.resolvedUrls.local[0]
  const { stdout } = await promisify(execFile)('pwsh', ['-NoProfile', '-File', path.join(root, 'integration/clients/send-result-demo.ps1'), '-DryRun'], { encoding: 'utf8' })
  const payload = JSON.parse(stdout.replace(/^\uFEFF/, ''))
  payload.offices[0].conversations[0].whiteboard.result.updatedAt = '2026-10-28T17:32:44.6616512+08:00'
  const files = payload.offices[0].conversations[0].whiteboard.result.sections[0].files
  files.push(
    { path: 'src/statistics-only.ts', status: 'modified', added: 4, deleted: 2 },
    { path: 'data/large.txt', status: 'modified', added: 1200, deleted: 300, oversized: true },
    { path: 'src/escaped.ts', status: 'added', added: 1, diffTruncated: true, diff: '@@ -0,0 +1 @@\n+<script>window.diffExecuted = true</script>\n' },
  )
  const response = await fetch(`${relay}/api/pawoffice/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer pawoffice-demo-key', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  assert.equal(response.status, 202)
  const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10)
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base)
  await page.getByRole('button', { name: /查看当前成果/ }).click()
  const reader = page.getByRole('dialog', { name: '成果阅读器', exact: true })
  await expect(reader.locator('.result-workspace-meta time')).toHaveText('2026-10-28 17:32:44')
  await expect(reader.locator('.result-workspace-meta time')).toHaveAttribute('datetime', '2026-10-28T17:32:44.6616512+08:00')
  const overview = reader.getByRole('tabpanel', { name: '概览', exact: true })
  await expect(overview.getByRole('region', { name: '文件变更清单', exact: true })).toHaveCount(0)
  await overview.getByRole('button', { name: '查看变更', exact: true }).click()
  const changes = reader.getByRole('tabpanel', { name: '交付物', exact: true }).getByRole('region', { name: '文件变更清单', exact: true })
  await expect(changes.getByRole('heading', { name: '已编辑 9 个文件' })).toBeVisible()
  await expect(changes.locator('.result-change-row')).toHaveCount(4)
  const first = changes.getByRole('button', { name: /查看 src\/features\/auth\/LoginForm.tsx 差异/ })
  await first.hover()
  const popup = page.getByRole('dialog', { name: '文件差异：src/features/auth/LoginForm.tsx', exact: true })
  await expect(popup).toBeVisible()
  await expect(popup.locator('tr[data-kind=deleted]')).toHaveCount(2)
  await expect(popup.locator('tr[data-kind=added]')).toHaveCount(6)
  await expect(popup.locator('tr[data-kind=deleted]').first()).toContainText('14')
  await expect(popup.locator('tr[data-kind=added]').first()).toContainText('14')
  await popup.hover()
  await expect(popup).toBeVisible()
  await popup.getByRole('button', { name: '固定差异预览' }).click()
  await page.mouse.move(5, 5)
  await expect(popup).toBeVisible()
  const popupBounds = await popup.boundingBox()
  assert(popupBounds.x >= 0 && popupBounds.y >= 0 && popupBounds.x + popupBounds.width <= 1440)
  await page.screenshot({ path: path.join(output, 'file-changes-hover.png') })
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)
  await expect(reader).toBeVisible()
  await expect(first).toBeFocused()

  await first.press('Enter')
  await expect(popup).toBeVisible()
  await expect(popup.getByRole('region')).toBeFocused()
  await reader.getByRole('tabpanel', { name: '交付物', exact: true }).click({ position: { x: 2, y: 2 } })
  await expect(popup).toHaveCount(0)
  await changes.getByRole('button', { name: '全部 9 个文件' }).click()
  await expect(changes.locator('.result-change-row')).toHaveCount(9)
  for (const [file, text] of [
    ['docs/login-flow.png', '二进制文件不支持逐行对比。'],
    ['src/statistics-only.ts', '尚未提供逐行差异'],
    ['data/large.txt', '文件较大'],
  ]) {
    await changes.getByRole('button', { name: new RegExp(`查看 ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} 差异`) }).click()
    const active = page.getByRole('dialog', { name: `文件差异：${file}`, exact: true })
    await expect(active).toContainText(text)
    await page.keyboard.press('Escape')
  }
  await changes.getByRole('button', { name: /查看 src\/escaped.ts 差异/ }).click()
  const escaped = page.getByRole('dialog', { name: '文件差异：src/escaped.ts', exact: true })
  await expect(escaped).toContainText('当前显示部分差异')
  await expect(escaped.locator('code').last()).toHaveText('<script>window.diffExecuted = true</script>')
  assert.equal(await page.evaluate(() => window.diffExecuted), undefined)
  await page.keyboard.press('Escape')

  await reader.getByRole('tab', { name: '交付物', exact: true }).click()
  const deliveries = reader.getByRole('tabpanel', { name: '交付物', exact: true })
  const deliveryChanges = deliveries.getByRole('region', { name: '文件变更清单' })
  await deliveryChanges.getByRole('button', { name: /查看 src\/features\/auth\/LoginForm.tsx 差异/ }).click()
  await expect(popup).toBeVisible()
  await reader.getByRole('tab', { name: '交付物', exact: true }).focus()
  await page.keyboard.press('End')
  await expect(reader.getByRole('tab', { name: '过程记录', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(popup).toHaveCount(0)
  await reader.getByRole('tab', { name: '交付物', exact: true }).click()
  await expect(popup).toHaveCount(0)
  const downloadEvent = page.waitForEvent('download')
  await reader.getByRole('button', { name: '导出全部轮次原始数据' }).click()
  const download = await downloadEvent
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.equal(exported.result.sections[0].files[0].diff, files[0].diff)

  await page.setViewportSize({ width: 390, height: 844 })
  await reader.getByRole('tab', { name: '交付物', exact: true }).click()
  await first.click()
  await expect(popup).toBeVisible()
  const mobileBounds = await popup.boundingBox()
  assert(mobileBounds.x >= 0 && mobileBounds.x + mobileBounds.width <= 390)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'file-changes-mobile.png') })
  await popup.getByRole('button', { name: '关闭差异预览' }).click()
  await expect(popup).toHaveCount(0)

  // Updating the live snapshot replaces the edge-case fixtures with the six-file demo.
  files.splice(6)
  payload.offices[0].seq = 2
  const updated = await fetch(`${relay}/api/pawoffice/messages`, {
    method: 'POST', headers: { Authorization: 'Bearer pawoffice-demo-key', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  assert.equal(updated.status, 200)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(changes.getByRole('heading', { name: '已编辑 6 个文件' })).toBeVisible()
  await changes.getByRole('button', { name: '收起文件列表' }).click()
  await changes.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'file-changes-list.png') })
  await first.hover()
  await expect(popup).toBeVisible()
  await popup.getByRole('button', { name: '固定差异预览' }).click()
  await page.screenshot({ path: path.join(output, 'file-changes-hover.png') })
  assert.deepEqual(errors, [])
  console.log('Passed: PowerShell -> real HTTP -> office UI, hover, pin, focus, Escape, missing/binary/large diff, safe text, export and mobile.')
} finally {
  await browser?.close()
  await server?.close()
  await app.close()
}
