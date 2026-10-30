import { test, expect } from '@playwright/test'

const errors = new WeakMap()
async function ready(page, url = '/?whiteboard-demo=1') {
  await page.goto(url)
  await expect(page.locator('canvas')).toBeVisible({ timeout: 30000 })
  await expect(page.getByText(/正在加载办公室/)).toHaveCount(0, { timeout: 30000 })
}
async function clickWorld(page, x, y) {
  const canvas = page.locator('canvas'), bounds = await canvas.boundingBox()
  const scale = Math.min(bounds.width / 1100, bounds.height / 850)
  await canvas.click({ position: { x: (bounds.width - 1100 * scale) / 2 + x * scale, y: (bounds.height - 850 * scale) / 2 + y * scale } })
}
async function select(page, mode) {
  await clickWorld(page, 268, mode === 'collaboration' ? 84 : 134)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.waitForTimeout(400) // Native HTMLText refresh is capped at four updates per second.
}
const open = page => clickWorld(page, 550, 120)
const close = page => page.getByRole('button', { name: '关闭白板', exact: true }).click()

test.beforeEach(async ({ page }) => {
  const messages = []; errors.set(page, messages)
  page.on('pageerror', error => messages.push(error.message))
})
test.afterEach(({ page }) => expect(errors.get(page), 'no uncaught browser errors').toEqual([]))

test('original collaboration, native left labels, transparent result overview and original reader shell', async ({ page }, info) => {
  await ready(page)
  await page.screenshot({ path: info.outputPath('office-collaboration.png') })
  await open(page)
  await expect(page.getByRole('dialog', { name: '白板详情', exact: true })).toContainText('商品上架计划 · 执行详情')
  await expect(page.getByRole('dialog')).toContainText('详情结束。')
  await expect(page.getByRole('dialog').locator('iframe')).toHaveCount(0)
  await close(page)
  await select(page, 'output')
  await page.screenshot({ path: info.outputPath('office-output.png') })
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.locator('.wall-whiteboards, .whiteboard-workspace, .wall-whiteboard-switch')).toHaveCount(0)
  await open(page)
  const reader = page.getByRole('dialog', { name: '结果白板', exact: true })
  await expect(reader).toBeVisible()
  await expect(reader.getByRole('button')).toHaveCount(2)
  await expect(page.frameLocator('iframe[title="结果白板详情"]').getByRole('heading', { name: '今日成果日报', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('result-report.png') })
  await page.keyboard.press('Escape')
  await select(page, 'collaboration')
  await open(page)
  await expect(page.getByRole('dialog')).toContainText('商品上架计划 · 执行详情')
})

test('labels stay on the same scene position at desktop, narrow, mobile and browser page zoom', async ({ page }, info) => {
  await ready(page)
  for (const viewport of [{ width: 1440, height: 1050 }, { width: 956, height: 914 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.waitForTimeout(400)
    await select(page, 'output')
    await page.screenshot({ path: info.outputPath(`wall-${viewport.width}.png`) })
    await open(page)
    await expect(page.getByRole('dialog', { name: '结果白板', exact: true })).toBeVisible()
    await expect(page.frameLocator('iframe[title="结果白板详情"]').getByRole('heading', { name: '今日成果日报', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: info.outputPath(`reader-${viewport.width}.png`) })
    await close(page)
    await select(page, 'collaboration'); await open(page)
    await expect(page.getByRole('dialog')).toContainText('商品上架计划 · 执行详情')
    await close(page)
  }
  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.evaluate(() => { document.body.style.zoom = '80%' })
  await page.waitForTimeout(500)
  await select(page, 'output'); await open(page)
  await expect(page.getByRole('dialog', { name: '结果白板', exact: true })).toBeVisible()
})

test('HTTP/SSE output is office-wide, live, isolated, supports URL reports and clears without affecting collaboration', async ({ page, request }) => {
  const html = '<h1>完整地图报表</h1><script>document.body.dataset.executed="yes";try{parent.document.body.dataset.leaked="bad"}catch{document.body.dataset.isolated="yes"}</script>'
  const state = { schemaVersion: '1.0', seq: 1, workspace: { id: 'minimal-output-team', name: '结果验收办公室' },
    outputBoard: { title: '地图采集成果', overviewHtml: '<h1 style="font-size:80px">采集 42 个地点</h1>', detail: { format: 'html', html } },
    conversations: [
      { id: 'a', title: '会话 A', whiteboard: { title: '目标 A', detail: '# 原有协作内容 A' } },
      { id: 'b', title: '会话 B', whiteboard: { title: '目标 B', detail: '# 原有协作内容 B' } },
    ] }
  const post = async payload => {
    const response = await request.post('http://127.0.0.1:5188/api/pawoffice/messages', { headers: { Authorization: 'Bearer whiteboard-local-test-key' }, data: payload })
    expect([200, 202]).toContain(response.status())
    return response.json()
  }
  await post({ type: 'offices.initialize', offices: [state] })
  await ready(page, '/office/')
  await select(page, 'output'); await open(page)
  const report = page.frameLocator('iframe[title="结果白板详情"]')
  await expect(report.getByRole('heading', { name: '完整地图报表' })).toBeVisible()
  await expect(report.locator('body')).toHaveAttribute('data-executed', 'yes')
  await expect(report.locator('body')).toHaveAttribute('data-isolated', 'yes')
  expect(await page.locator('body').getAttribute('data-leaked')).toBeNull()
  await close(page)
  await page.getByRole('button', { name: '展开对话', exact: true }).click()
  await page.getByRole('tab', { name: '会话 B', exact: true }).click()
  await page.getByRole('button', { name: '收起聊天', exact: true }).click()
  await select(page, 'collaboration'); await open(page)
  await expect(page.getByRole('dialog')).toContainText('原有协作内容 B')
  await close(page)
  state.seq++; state.conversations[0].whiteboard.detail = '# 后台更新协作 A'
  state.outputBoard.overviewHtml = '<h1 style="font-size:80px">采集 99 个地点</h1>'
  state.outputBoard.detail.html = '<h1>已更新至 99 个地点</h1>'
  await post({ type: 'office.snapshot', teamId: state.workspace.id, snapshot: state })
  await select(page, 'output'); await open(page)
  await expect(report.getByRole('heading', { name: '已更新至 99 个地点' })).toBeVisible()
  await page.route('**/test-report', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><h1>托管 URL 报表</h1>' }))
  state.seq++; state.outputBoard.detail = { format: 'url', url: 'http://127.0.0.1:5188/test-report' }
  await post({ type: 'office.snapshot', teamId: state.workspace.id, snapshot: state })
  await expect(report.getByRole('heading', { name: '托管 URL 报表' })).toBeVisible()
  await page.reload()
  await expect(page.getByText(/正在加载办公室/)).toHaveCount(0, { timeout: 30000 })
  await select(page, 'output'); await open(page)
  await expect(report.getByRole('heading', { name: '托管 URL 报表' })).toBeVisible()
  await close(page)
  delete state.outputBoard; state.seq++
  await post({ type: 'office.snapshot', teamId: state.workspace.id, snapshot: state })
  await open(page)
  await expect(page.getByRole('dialog')).toContainText('等待结果更新')
  await expect(page.getByRole('dialog').locator('iframe')).toHaveCount(0)
  await close(page); await select(page, 'collaboration'); await open(page)
  await expect(page.getByRole('dialog')).toContainText('原有协作内容 B')
})
