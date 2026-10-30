import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { createPawOfficeServer } from '../../server/dist/app.js'
import { createWorkflowMock } from '../../integration/clients/workflow-mock.mjs'

const app = await createPawOfficeServer({ officeRequestMs: 5000 })
let mock, vite, browser
await mkdir('test-results/result-workspace', { recursive: true })
try {
  const relay = await app.listen({ host: '127.0.0.1', port: 0 })
  mock = createWorkflowMock({ baseUrl: relay })
  const upstream = await mock.app.listen({ host: '127.0.0.1', port: 0 })
  await mock.initialize(upstream)
  process.env.PAWOFFICE_INTERNAL_API_URL = relay
  vite = await createServer({ configFile: 'vite.config.ts', server: { host: '127.0.0.1', port: 0, open: false } })
  await vite.listen()
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(vite.resolvedUrls.local[0])
  const input = page.getByRole('textbox', { name: '给办公室发送消息' })
  const reader = page.getByRole('dialog', { name: '成果阅读器', exact: true })
  const current = async () => {
    if (await reader.count()) await reader.getByRole('button', { name: '关闭当前成果' }).click()
    const collapse = page.getByRole('button', { name: '收起聊天', exact: true })
    if (await collapse.isVisible()) await collapse.click()
    await page.getByRole('button', { name: /查看当前成果/ }).click()
    await expect(reader.getByLabel('交付轮次')).toHaveCount(0)
    await expect(reader.locator('.result-delivery-notice')).toHaveCount(0)
  }
  const open = async n => {
    if (await reader.count()) await reader.getByRole('button', { name: '关闭当前成果' }).click()
    await input.click()
    await page.getByRole('button', { name: `查看交付：第 ${n} 轮交付`, exact: true }).click()
    await expect(reader).toContainText(`历史交付 · 第 ${n} 轮交付`)
  }
  for (let n = 1; n <= 6; n++) {
    await input.fill(['确认目标', '生成文档', '更新需求', '回滚需求', '移除接口', '重新验收'][n - 1])
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    if (n > 1) await expect(page.getByRole('button', { name: `查看交付：第 ${n} 轮交付`, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
    if (n === 1) await current(); else await open(n)
    if (n === 1) await expect(reader.locator('.result-artifact:visible')).toHaveCount(0)
    if (n === 2) {
      const api = reader.locator('.result-artifact:visible').filter({ hasText: '接口约定.json' })
      const event = page.waitForEvent('download')
      await api.getByRole('button', { name: '下载', exact: true }).click()
      const download = await event
      assert.equal(await readFile(await download.path(), 'utf8'), '{"login":"POST /api/login"}\n')
      assert(download.suggestedFilename().endsWith('.json'))
    }
    if (n === 3) {
      await expect(reader).toContainText('验证待核对')
      await expect(reader).toContainText('本次更新')
      await current()
      await expect(reader).toContainText('沿用已有版本')
      await page.screenshot({ path: 'test-results/result-workspace/workflow-current.png' })
      await open(2)
      await reader.locator('.result-artifact:visible').filter({ hasText: '需求说明.md' }).getByRole('button', { name: '查看', exact: true }).click()
      const preview = page.getByRole('dialog', { name: '需求说明.md', exact: true })
      await expect(preview.getByLabel('文档正文')).not.toContainText('五次')
      await expect(preview).toContainText('当前采用版本 v2')
      await page.keyboard.press('Escape')
    }
    if (n === 4) {
      await open(3)
      await reader.locator('.result-artifact:visible').filter({ hasText: '需求说明.md' }).getByRole('button', { name: '查看', exact: true }).click()
      const preview = page.getByRole('dialog', { name: '需求说明.md', exact: true })
      await expect(preview).toContainText('当前采用版本 v1')
      await expect(preview.getByLabel('文档正文')).toContainText('五次')
      await page.keyboard.press('Escape')
    }
    if (n === 5) {
      await expect(reader).toContainText('本次移除')
      await current()
      await expect(reader.locator('.result-artifact:visible').filter({ hasText: '接口约定.json' })).toHaveCount(0)
    }
    if (n === 6) await expect(reader.locator('.result-workspace-result-status')).toContainText('已验证')
    await page.keyboard.press('Escape')
  }
  await page.reload()
  await input.click()
  await open(2)
  await expect(reader.locator('.result-artifact:visible')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: '会话隔离测试', exact: true }).click()
  await input.fill('确认第二会话目标')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
  await current()
  await expect(reader.locator('.result-artifact:visible')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const conversation of mock.office.conversations) {
    conversation.whiteboard.title = '已命名的白板'
    mock.office.seq++
    const response = await fetch(`${relay}/api/pawoffice/messages`, { method: 'POST', headers: { Authorization: 'Bearer pawoffice-demo-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'office.snapshot', teamId: mock.office.workspace.id, snapshot: mock.office }) })
    assert.equal(response.status, 200)
    await input.click()
    await page.getByRole('tab', { name: conversation.title, exact: true }).click()
    await current()
    await expect(reader).toContainText(conversation.id === 'main' ? '针对当前采用' : '已确认目标')
    await page.keyboard.press('Escape')
  }
  assert.deepEqual(errors, [])
  console.log('Passed complete workflow: empty chat, six actual sends, exact JSON download, update, stale verification, pinned history, rollback, removal, revalidation, reload, untitled second conversation and mobile.')
} finally {
  await browser?.close(); await vite?.close(); await mock?.app.close(); await app.close()
}
