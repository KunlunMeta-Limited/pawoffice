import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { createPawOfficeServer } from '../../server/dist/app.js'
import { createWorkflowMock } from '../../integration/clients/workflow-mock.mjs'
import { ecommerceScenario } from '../../integration/clients/ecommerce-scenario.mjs'

const app = await createPawOfficeServer({ officeRequestMs: 5000 })
let mock, vite, browser
await mkdir('test-results/result-workspace', { recursive: true })
try {
  const relay = await app.listen({ host: '127.0.0.1', port: 0 })
  mock = createWorkflowMock({ baseUrl: relay, scenario: 'ecommerce' })
  await mock.initialize(await mock.app.listen({ host: '127.0.0.1', port: 0 }))
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
  const close = async () => { if (await reader.count()) await reader.getByRole('button', { name: '关闭当前成果' }).click() }
  const current = async () => {
    await close()
    const collapse = page.getByRole('button', { name: '收起聊天', exact: true })
    if (await collapse.isVisible()) await collapse.click()
    await page.getByRole('button', { name: /查看当前成果/ }).click()
    await expect(reader.getByLabel('交付轮次')).toHaveCount(0)
    await expect(reader.locator('.result-delivery-notice')).toHaveCount(0)
    await reader.getByRole('tab', { name: '交付物', exact: true }).click()
  }
  const history = async n => {
    await close(); await input.click()
    await page.getByRole('button', { name: `查看交付：${ecommerceScenario.rounds[n - 1].title}`, exact: true }).click()
    await expect(reader).toContainText(`历史交付 · ${ecommerceScenario.rounds[n - 1].title}`)
    await expect(reader.getByLabel('交付轮次')).toHaveCount(0)
  }
  for (const [index, round] of ecommerceScenario.rounds.entries()) {
    await close()
    await input.fill(round.prompt)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await expect(page.getByRole('button', { name: `查看交付：${round.title}`, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible()
    await current()
    const cards = reader.locator('.result-artifact:visible')
    await expect(cards).toHaveCount([1, 5, 5, 6, 7][index])
    await expect(reader.locator('.result-workspace-head')).toContainText('电商协作 Agent（6人）')
    assert(!mock.office.conversations[0].whiteboard.result.artifacts.some(item => item.change === 'removed'))
    if (index === 2) {
      await expect(reader).toContainText('沿用已有版本')
      await history(2)
      const oldBudget = cards.filter({ hasText: '推广预算.csv' })
      await oldBudget.getByRole('button', { name: '查看', exact: true }).click()
      const preview = page.getByRole('dialog', { name: '推广预算.csv', exact: true })
      await expect(preview.getByLabel('文档正文')).toContainText('3000')
      await expect(preview).toContainText('当前采用版本 v2')
      const event = page.waitForEvent('download')
      await preview.getByRole('button', { name: '下载该版本' }).click()
      const download = await event
      assert.equal(await readFile(await download.path(), 'utf8'), ecommerceScenario.rounds[1].files.find(file => file.id === 'budget').content)
      await preview.getByLabel('文档版本').selectOption('budget-v2')
      await expect(preview.getByLabel('文档正文')).toContainText('1800')
      await page.keyboard.press('Escape')
      await expect(reader).toContainText('历史交付 · 首版上市资料')
      await reader.getByRole('button', { name: '返回当前成果', exact: true }).click()
      await expect(reader.locator('.result-delivery-notice')).toHaveCount(0)
    }
    if (index === 3) {
      await expect(cards.filter({ hasText: '商品标题与详情.md' })).toContainText('v2')
      await expect(cards.filter({ hasText: '淘宝上市计划.md' })).toContainText('v3')
      await page.screenshot({ path: 'test-results/result-workspace/ecommerce-current.png' })
    }
    if (index === 4) {
      await expect(reader.locator('.result-workspace-result-status')).toContainText('已验证')
      await expect(reader.locator('.task-whiteboard')).toHaveCount(0)
      await reader.getByRole('tab', { name: '过程记录', exact: true }).click()
      await expect(reader).toContainText('3/3 通过')
    }
  }
  await close(); await page.reload(); await current()
  await reader.getByRole('tab', { name: '交付物', exact: true }).click()
  await expect(reader.locator('.result-artifact:visible')).toHaveCount(7)
  await reader.locator('.result-artifact:visible').filter({ hasText: '推广预算.csv' }).getByRole('button', { name: '查看', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '推广预算.csv', exact: true })
  await preview.getByLabel('文档版本').selectOption('budget-v1')
  await expect(preview.getByLabel('文档正文')).toContainText('3000')
  await preview.getByRole('button', { name: '与当前版本比较' }).click()
  await expect(preview.locator('tr[data-kind=added]')).toContainText([/1800/])
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: 'test-results/result-workspace/ecommerce-version-mobile.png' })
  assert.deepEqual(errors, [])
  console.log('Passed ecommerce: five authored prompts/replies, current aggregate, chat-only historical entry, unchanged files, 3000→1800 budget, exact CSV, file versions/diff, verification, reload and mobile.')
} finally {
  await browser?.close(); await vite?.close(); await mock?.app.close(); await app.close()
}
