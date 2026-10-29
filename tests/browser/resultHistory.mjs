// node tests/browser/resultHistory.mjs --channel=msedge
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { createPawOfficeServer } from '../../server/dist/app.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = path.join(root, 'test-results/result-workspace')
await mkdir(output, { recursive: true })
const fixture = JSON.parse(await readFile(path.join(root, 'integration/fixtures/result-deliveries.json'), 'utf8'))
const bodies = new Map()
for (const result of [fixture.result, ...fixture.deliveries.map(item => item.result)]) {
  for (const artifact of result.artifacts ?? []) bodies.set(artifact.versionId, artifact.content)
}
const oldBody = bodies.get('prd-v1')
const app = await createPawOfficeServer({ officeRequestMs: 5000 })
let server, browser, history, oldMode = 'normal', historyMode = 'normal'
const requests = []
app.get('/test-artifacts/:name', (request, reply) => {
  const name = request.params.name
  requests.push(name)
  reply.header('Cache-Control', 'no-store')
  if (name === 'delivery-2.json') return historyMode === 'wrong' ? { ...history, id: 'wrong', result: { ...history.result, runId: 'wrong' } } : history
  if (name === 'prd-v1' && oldMode === 'missing') return reply.code(404).send('missing')
  reply.type('text/markdown; charset=utf-8')
  return name === 'prd-v1' && oldMode === 'wrong' ? bodies.get('prd-v2') : bodies.get(name)
})
try {
  const relay = await app.listen({ host: '127.0.0.1', port: 0 })
  process.env.PAWOFFICE_INTERNAL_API_URL = relay
  server = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: {
    host: '127.0.0.1', port: 0, open: false, proxy: { '/test-artifacts': { target: relay } },
  } })
  await server.listen()
  const base = server.resolvedUrls.local[0]
  for (const result of [fixture.result, ...fixture.deliveries.map(item => item.result)]) {
    for (const artifact of result.artifacts ?? []) {
      artifact.url = `${base}test-artifacts/${artifact.versionId}`
      artifact.content = ''
    }
  }
  history = structuredClone(fixture.deliveries[1])
  fixture.deliveries[1] = { id: history.id, sequence: history.sequence, title: history.title,
    createdAt: history.createdAt, snapshotUrl: `${base}test-artifacts/delivery-2.json` }
  const office = { schemaVersion: '1.0', seq: 1, workspace: { id: 'history-browser', name: '成果版本测试' },
    conversations: [{ id: 'login-demo', title: '登录模块交付', whiteboard: fixture }] }
  const post = data => fetch(`${relay}/api/pawoffice/messages`, { method: 'POST', headers: {
    Authorization: 'Bearer pawoffice-demo-key', 'Content-Type': 'application/json',
  }, body: JSON.stringify(data) })
  assert.equal((await post({ type: 'offices.initialize', offices: [office] })).status, 202)
  const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10)
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(base)
  const openReader = async () => {
    await page.getByRole('button', { name: /查看当前成果/ }).click()
    await expect(page.getByRole('dialog', { name: '当前成果', exact: true })).toBeVisible()
  }
  await openReader()
  const reader = page.getByRole('dialog', { name: '当前成果', exact: true })
  const selector = reader.getByLabel('交付轮次')
  const cards = reader.locator('.result-artifact:visible')
  const card = cards.filter({ has: page.getByRole('heading', { name: '登录模块需求说明', exact: true }) })
  await expect(cards).toHaveCount(3)
  await expect(reader).toContainText('验证版本已更新，需重新验证')
  await page.screenshot({ path: path.join(output, 'history-current.png') })
  await selector.selectOption('delivery-2')
  await expect(cards).toHaveCount(2)
  await expect(reader).toContainText('历史交付 · 第 2 轮')
  await expect(card).toContainText('v1.0')
  await page.screenshot({ path: path.join(output, 'history-round-2.png') })
  await card.getByRole('button', { name: '查看', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '登录模块需求说明', exact: true })
  await expect(preview.getByLabel('文档正文')).toContainText('验证码 5 分钟内有效')
  await expect(preview.getByLabel('文档正文')).not.toContainText('连续失败 5 次')
  await expect(preview).toContainText('已有更新版本 v2.0')
  await expect(preview).toContainText('SHA-256 校验通过')
  await page.screenshot({ path: path.join(output, 'history-version-preview.png') })
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: '下载该版本', exact: true }).click()
  const download = await downloading
  assert.equal(await readFile(await download.path(), 'utf8'), oldBody)
  assert(download.suggestedFilename().includes('v1.0'))
  await preview.getByRole('button', { name: '与最新版比较' }).click()
  await expect(preview.locator('tr[data-kind=added]')).toContainText([/连续失败 5 次/], { useInnerText: true })
  await page.screenshot({ path: path.join(output, 'history-version-diff.png') })
  await preview.getByRole('button', { name: '查看最新版' }).click()
  await expect(preview.getByLabel('文档正文')).toContainText('连续失败 5 次')
  await expect(preview.getByRole('button', { name: '关闭文档预览' })).toBeFocused()
  await preview.getByLabel('文档版本').selectOption('prd-v1')
  await expect(preview.getByLabel('文档正文')).not.toContainText('连续失败 5 次')

  // A new live delivery must not replace the old document the user is reading.
  const next = structuredClone(office)
  next.seq = 2
  const current = next.conversations[0].whiteboard.result
  const updated = current.artifacts[0]
  const v3 = `${bodies.get('prd-v2')}新增审计日志要求。\n`
  bodies.set('prd-v3', v3)
  Object.assign(updated, { versionId: 'prd-v3', version: 'v3.0', runId: 'delivery-4', sha256: createHash('sha256').update(v3).digest('hex'), url: `${base}test-artifacts/prd-v3` })
  current.runId = 'delivery-4'
  next.conversations[0].whiteboard.deliveries.push({ id: 'delivery-4', sequence: 4, title: '第 4 轮 · 审计补充', createdAt: '2026-10-28T13:00:00+08:00', result: { ...current, artifacts: [updated] } })
  assert.equal((await post({ type: 'office.snapshot', teamId: office.workspace.id, snapshot: next })).status, 200)
  await expect(preview).toContainText('已有更新版本 v3.0')
  await expect(preview.getByLabel('文档正文')).not.toContainText('审计日志')
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(reader).toBeVisible()
  await expect(selector).toHaveValue('delivery-2')
  await expect(card.getByRole('button', { name: '查看', exact: true })).toBeFocused()

  await page.reload()
  await openReader()
  await expect(selector).toHaveValue('@current')
  await expect(card).toContainText('v3.0')
  await selector.selectOption('delivery-4')
  await expect(reader).toContainText('任务状态未提供')
  await selector.selectOption('delivery-2')
  await card.getByRole('button', { name: '查看', exact: true }).click()
  await expect(preview.getByLabel('文档正文')).toContainText('验证码 5 分钟内有效')
  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await preview.boundingBox()
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 390)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'history-mobile.png') })
  await page.keyboard.press('Escape')

  for (const mode of ['missing', 'wrong']) {
    oldMode = mode
    const before = requests.length
    await card.getByRole('button', { name: '查看', exact: true }).click()
    await expect(preview.getByRole('alert')).toContainText(mode === 'missing' ? '历史版本已不可用' : '版本内容校验失败')
    await expect(preview).not.toContainText('SHA-256 校验通过')
    assert(requests.length > before)
    assert(requests.slice(before).every(name => name === 'prd-v1'))
    await page.keyboard.press('Escape')
  }
  historyMode = 'wrong'
  await selector.selectOption('@current')
  await selector.selectOption('delivery-2')
  await expect(reader.getByRole('alert')).toContainText('轮次不匹配')
  await expect(cards).toHaveCount(0)
  historyMode = 'normal'
  await reader.getByRole('button', { name: '重新读取此交付' }).click()
  await expect(card).toContainText('v1.0')
  assert.deepEqual(errors, [])
  console.log('Passed: external immutable snapshots, pinned versions, latest notice, exact download, diff, live update, reload, missing/hash mismatch, retry, focus and mobile.')
} finally {
  await browser?.close()
  await server?.close()
  await app.close()
}
