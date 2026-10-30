// Run after packages:build: node tests/browser/resultWorkspace.mjs [--channel=msedge]
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = path.join(root, 'test-results/result-workspace')
await mkdir(output, { recursive: true })
const server = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  const base = server.resolvedUrls.local[0]
  const channel = process.argv.find(value => value.startsWith('--channel='))?.split('=')[1]
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))

  for (const shell of ['classic', 'members']) {
    await page.goto(`${base}?shell=${shell}`)
    const entry = page.getByRole('button', { name: /查看当前成果/ })
    await expect(entry).toBeVisible()
    await page.locator('.office-loading').waitFor({ state: 'hidden' })
    await entry.click()
    const dialog = page.getByRole('dialog', { name: '成果阅读器' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('tablist')).toHaveCount(1)
    await expect(dialog.getByRole('tab')).toHaveCount(3)
    await expect(dialog.getByRole('tab', { name: '概览', exact: true })).toHaveAttribute('aria-selected', 'true')
    await dialog.getByRole('tab', { name: '概览', exact: true }).focus()
    await page.keyboard.press('End')
    await expect(dialog.getByRole('tab', { name: '过程记录', exact: true })).toBeFocused()
    await expect(dialog.getByRole('tabpanel', { name: '过程记录' })).toBeVisible()
    await dialog.getByRole('tab', { name: '概览', exact: true }).click()
    await page.screenshot({ path: path.join(output, `${shell}-integrated.png`) })
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(entry).toBeFocused()
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: /查看当前成果/ }).click()
  const mobileDialog = page.getByRole('dialog', { name: '成果阅读器' })
  const bounds = await mobileDialog.boundingBox()
  assert.equal(Math.round(bounds.width), 390)
  assert.equal(Math.round(bounds.height), 844)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'mobile-integrated.png') })
  await mobileDialog.getByRole('button', { name: '关闭当前成果' }).click()
  await expect(mobileDialog).toHaveCount(0)

  // Old bookmarked URLs now use the normal office entry.
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${base}?result-preview=1&case=login-module`)
  await expect(page.getByRole('button', { name: /查看当前成果/ })).toBeVisible()
  await expect(page.locator('.result-preview-page')).toHaveCount(0)
  const removedMock = await page.request.get(`${base}mock/result-preview.json`)
  assert(!removedMock.headers()['content-type']?.includes('application/json'), 'dedicated mock data is no longer served')
  assert.deepEqual(errors, [])
  console.log('Passed: both office layouts, keyboard and focus, mobile dialog, normal office entry for old bookmarks and removal of the dedicated mock endpoint.')
  console.log(`Screenshots: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
