// node tests/browser/chatDeliveries.mjs --channel=msedge
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { createPawOfficeServer } from '../../server/dist/app.js'
import { chatOperationSchema } from '@pawoffice/protocol/chat'

const root = fileURLToPath(new URL('../..', import.meta.url))
const output = path.join(root, 'test-results/result-workspace')
await mkdir(output, { recursive: true })
const board = JSON.parse(await readFile(path.join(root, 'integration/fixtures/result-deliveries.json'), 'utf8'))
board.deliveries.forEach((delivery, index) => { delivery.turnId = `turn-${index + 1}` })
board.deliveries.push({ id: 'unlinked', sequence: 4, title: '无关联交付不应插入聊天', createdAt: '2026-10-28T12:10:00+08:00', result: { runId: 'unlinked', status: 'ready' } })
const historical = structuredClone(board.deliveries[1])
const office = { schemaVersion: '1.0', seq: 1, workspace: { id: 'chat-results', name: '聊天交付联调' }, conversations: [
  { id: 'login-demo', title: '登录模块交付', whiteboard: board },
  { id: 'other-conversation', title: '另一会话', whiteboard: { deliveries: [{
    id: 'other-delivery', sequence: 1, turnId: 'turn-2', title: '另一会话的交付', createdAt: '2026-10-28T12:00:00+08:00', result: { runId: 'other-delivery', status: 'draft', summary: '这是另一个会话的独立交付。' },
  }] } },
] }
const turns = new Map([
  ['login-demo', [
    { id: 'turn-1', user: '请先确认登录模块的范围。', assistant: '已确认目标，下一步形成首版文档。', state: 'complete', error: '' },
    { id: 'turn-2', user: '生成首版需求说明和接口文档。', assistant: '首版文档已交付，可以打开查看当时的版本。', state: 'complete', error: '' },
    { id: 'turn-3', user: '增加登录限制并更新需求说明。', assistant: '需求说明已更新，接口文档保持原版本。', state: 'complete', error: '' },
  ]],
  ['other-conversation', [{ id: 'turn-2', user: '另一个会话的需求。', assistant: '交付范围相互独立。', state: 'complete', error: '' }]],
])
const app = await createPawOfficeServer({ officeRequestMs: 5000 })
let server, browser, relay, sendNumber = 0, sentTurnId = ''
const post = data => fetch(`${relay}/api/pawoffice/messages`, { method: 'POST', headers: {
  Authorization: 'Bearer pawoffice-demo-key', 'Content-Type': 'application/json',
}, body: JSON.stringify(data) })
app.get('/test-delivery-2.json', () => historical)
app.post('/test-chat', async (request, reply) => {
  const input = chatOperationSchema.parse(request.body)
  const messages = turns.get(input.conversationId) ?? []
  if (input.type === 'history') return { code: 200, msg: 'OK', data: { turns: messages, hasMore: false, nextCursor: '', activeTurnId: '' } }
  if (input.type === 'cancel') return { code: 200, msg: 'OK', data: { stopped: true } }
  assert.equal(input.type, 'send')
  const question = input.messages.at(-1).content
  const chatOnly = question.includes('仅聊天')
  const answer = chatOnly ? '这次只是讨论，没有交付文件。' : '补充文档与约束说明已交付。'
  messages.push({ id: input.turnId, user: question, assistant: answer, state: 'complete', error: '' })
  turns.set(input.conversationId, messages)
  sentTurnId = input.turnId
  reply.hijack()
  reply.raw.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' })
  reply.raw.write(`${JSON.stringify({ type: 'delta', text: answer })}\n`)
  if (!chatOnly) {
    sendNumber++
    const id = `live-delivery-${sendNumber}`
    const artifact = { id: `note-${sendNumber}`, title: '补充说明', versionId: `note-v${sendNumber}`, version: 'v1.0', runId: id, content: '# 补充说明\n\n保留后端提供的聊天轮次与产物关联。' }
    const current = office.conversations[0].whiteboard
    current.deliveries.push(
      { id, sequence: 5, turnId: input.turnId, title: '补充文档交付', createdAt: '2026-10-28T13:00:00+08:00', result: { runId: id, status: 'ready', summary: '新增一份补充说明。', artifacts: [artifact] } },
      { id: 'live-constraints', sequence: 6, turnId: input.turnId, title: '补充约束说明', createdAt: '2026-10-28T13:01:00+08:00', result: { runId: 'live-constraints', status: 'draft', summary: '另一次交付仅包含约束总结，没有文件。' } },
    )
    current.result.artifacts.push(artifact)
    current.result.runId = id
    office.seq++
    assert.equal((await post({ type: 'office.snapshot', teamId: office.workspace.id, snapshot: office })).status, 200)
  }
  reply.raw.end(`${JSON.stringify({ type: 'done' })}\n`)
  return reply
})

try {
  relay = await app.listen({ host: '127.0.0.1', port: 0 })
  board.deliveries[1] = { id: historical.id, sequence: historical.sequence, turnId: historical.turnId, title: historical.title,
    createdAt: historical.createdAt, snapshotUrl: `${relay}/test-delivery-2.json` }
  process.env.PAWOFFICE_INTERNAL_API_URL = relay
  server = await createServer({ configFile: path.join(root, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, open: false,
    proxy: { '/test-delivery-2.json': { target: relay } },
  } })
  await server.listen()
  const base = server.resolvedUrls.local[0]
  // File readers need a browser-readable version URL; the chat proxy uses the backend address.
  board.deliveries[1].snapshotUrl = `${base}test-delivery-2.json`
  assert.equal((await post({ type: 'offices.initialize', offices: [office], chat: { url: `${relay}/test-chat` } })).status, 202)
  const channel = process.argv.find(arg => arg.startsWith('--channel='))?.slice(10)
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce', timezoneId: 'Asia/Shanghai' })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const expandChat = async () => {
    await page.getByRole('textbox', { name: '给办公室发送消息' }).click()
    await expect(page.getByRole('region', { name: '办公室对话' })).toBeVisible()
  }
  await page.goto(base)
  await expandChat()
  const chat = page.getByRole('region', { name: '办公室对话' })
  await expect(chat.locator('.chat-delivery-entry')).toHaveCount(3)
  await expect(chat).not.toContainText('无关联交付不应插入聊天')
  const second = chat.getByRole('button', { name: '查看交付：第 2 轮 · 首次文档交付', exact: true })
  await expect(second.locator('..')).toContainText('产物详情待查看')
  await expect(second.locator('xpath=ancestor::article')).toContainText('首版文档已交付')
  await second.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(output, 'chat-deliveries-desktop.png') })
  await second.click()
  const reader = page.getByRole('dialog', { name: '当前成果', exact: true })
  await expect(reader.getByLabel('交付轮次')).toHaveValue('delivery-2')
  const oldDoc = reader.locator('.result-artifact:visible').filter({ has: page.getByRole('heading', { name: '登录模块需求说明', exact: true }) })
  await expect(oldDoc).toContainText('v1.0')
  await oldDoc.getByRole('button', { name: '查看', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '登录模块需求说明', exact: true })
  await expect(preview.getByLabel('文档正文')).not.toContainText('连续失败 5 次')
  await page.screenshot({ path: path.join(output, 'chat-delivery-history-preview.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  await expect(chat).toBeVisible()
  await expect(second).toBeFocused()

  await chat.getByRole('tab', { name: '另一会话', exact: true }).click()
  await expect(chat.locator('.chat-delivery-entry')).toHaveCount(1)
  const other = chat.getByRole('button', { name: '查看交付：另一会话的交付' })
  await other.click()
  await expect(reader.getByLabel('交付轮次')).toHaveValue('other-delivery')
  await expect(reader).not.toContainText('登录模块需求说明')
  await page.keyboard.press('Escape')
  await chat.getByRole('tab', { name: '登录模块交付', exact: true }).click()
  await expect(chat.locator('.chat-delivery-entry')).toHaveCount(3)

  const input = page.getByRole('textbox', { name: '给办公室发送消息' })
  await input.fill('请再补充一份说明。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  const live = chat.getByRole('button', { name: '查看交付：补充文档交付' })
  await expect(live).toBeVisible()
  assert(sentTurnId && !['turn-1', 'turn-2', 'turn-3'].includes(sentTurnId))
  const liveMessage = live.locator('xpath=ancestor::article')
  await expect(liveMessage.getByRole('list', { name: '本轮交付' }).locator('li')).toHaveCount(2)
  await expect(liveMessage).toContainText('1 项产物')
  await expect(liveMessage).toContainText('0 项产物')
  await expect(liveMessage).toContainText('补充文档与约束说明已交付')
  await expect(chat.locator('.chat-delivery-entry')).toHaveCount(5)
  await live.click()
  await expect(reader.getByLabel('交付轮次')).toHaveValue('live-delivery-1')
  await expect(reader.locator('.result-artifact:visible')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await input.fill('仅聊天，讨论一下安排。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(chat).toContainText('这次只是讨论，没有交付文件。')
  await expect(chat.locator('.chat-delivery-entry')).toHaveCount(5)

  await page.reload()
  await expandChat()
  await expect(chat.locator('.chat-delivery-entry')).toHaveCount(5)
  await page.setViewportSize({ width: 390, height: 844 })
  await live.scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(output, 'chat-deliveries-mobile.png') })
  await live.click()
  await expect(reader.getByLabel('交付轮次')).toHaveValue('live-delivery-1')
  await expect(reader).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(live).toBeFocused()
  assert.deepEqual(errors, [])
  console.log('Passed: chat history links, exact historical target/version, external snapshot, same turn in different conversations, live one-to-many deliveries, no guessed association, reload, focus and mobile.')
} finally {
  await browser?.close()
  await server?.close()
  await app.close()
}
