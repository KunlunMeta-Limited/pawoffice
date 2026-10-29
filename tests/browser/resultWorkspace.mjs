// Run after packages:build: node tests/browser/resultWorkspace.mjs [--channel=msedge]
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
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
    const dialog = page.getByRole('dialog', { name: '当前成果' })
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
  const mobileDialog = page.getByRole('dialog', { name: '当前成果' })
  const bounds = await mobileDialog.boundingBox()
  assert.equal(Math.round(bounds.width), 390)
  assert.equal(Math.round(bounds.height), 844)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'mobile-integrated.png') })
  await mobileDialog.getByRole('button', { name: '关闭当前成果' }).click()
  await expect(mobileDialog).toHaveCount(0)

  const fixtures = { cases: [
    { id: 'only-sections', label: '仅结构化交付', description: '回归', whiteboard: {
      title: '结构化交付任务', status: 'completed', result: { status: 'ready', sections: [
        { kind: 'documents', id: 'docs', title: '交付文档', items: [{ id: 'one', title: '正式入口可见的文档' }] },
      ] },
    } },
    { id: 'legacy', label: '历史详情', description: '回归', whiteboard: { title: '旧任务', detail: '# 历史内容\n\n**仍然可读**' } },
  ] }
  await page.route('**/mock/result-preview.json', route => route.fulfill({ json: fixtures }))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`${base}?result-preview=1`)
  await page.getByRole('tab', { name: '交付物', exact: true }).click()
  await expect(page.getByText('正式入口可见的文档', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '未通过', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('成果 · 未通过')
  await expect(page.getByRole('tab', { name: '交付物', exact: true })).toHaveAttribute('aria-selected', 'true')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载完整成果与白板数据' }).click()
  const download = await downloadEvent
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.equal(exported.result.sections[0].items[0].title, '正式入口可见的文档')
  assert.equal(exported.result.status, 'rejected')
  await page.getByRole('button', { name: '历史详情', exact: true }).click()
  await expect(page.getByRole('tab', { name: '概览', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: '过程记录', exact: true }).click()
  await expect(page.getByText('仍然可读', { exact: true })).toBeVisible()

  await page.unroute('**/mock/result-preview.json')
  await page.goto(`${base}?result-preview=1&case=login-module`)
  await expect(page.getByRole('heading', { name: '登录模块开发', exact: true })).toBeVisible()
  const featured = page.getByRole('region', { name: '主要交付物' })
  await expect(featured.getByRole('heading', { name: '登录模块 PRD', exact: true })).toHaveCount(1)
  await expect(featured).toContainText('v1.2 · 2024-06-10 · 已完成')
  await featured.getByRole('button', { name: '查看', exact: true }).first().click()
  await expect(featured).toContainText('验证码 5 分钟内有效')
  await featured.getByRole('button', { name: '收起', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'overview.png') })
  await page.getByRole('button', { name: '未通过', exact: true }).click()
  await expect(page.locator('.result-workspace-result-status')).toHaveText('成果 · 未通过')
  await page.getByRole('tab', { name: '交付物', exact: true }).click()
  const deliveries = page.getByRole('tabpanel', { name: '交付物', exact: true })
  await expect(deliveries.getByRole('heading', { name: '登录模块 PRD', exact: true })).toHaveCount(1)
  await expect(deliveries.locator('.result-workspace-doc')).not.toContainText(['登录模块 PRD'])
  await expect(page.getByText('暂无预览', { exact: true })).toHaveCount(4)
  await expect(page.getByText('上传文件 →', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: path.join(output, 'deliverables.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('tab', { name: '概览', exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'mobile-overview.png') })
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const label of ['电商复盘', '入职培训', '文案交付', '内容审核', '用户调研', '安全审查']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('tab', { name: '概览', exact: true })).toHaveAttribute('aria-selected', 'true')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await page.screenshot({ path: path.join(output, 'security-overview.png') })
  assert.deepEqual(errors, [])
  console.log('Passed: both office layouts, keyboard and focus, mobile dialog, new-only results, state updates, export, legacy detail and preview navigation.')
  console.log(`Screenshots: ${output}`)
} finally {
  await browser?.close()
  await server.close()
}
