/**
 * 目的：在真实 Vite 页面中测量 50K/180K 助手正文的渲染完整性和 DOM 性能。
 * 边界：只使用浏览器路由夹具，不调用 Provider、Host 或 Gateway，不修改生产代码。
 * 证据：同时记录原始正文长度、渲染后 textContent/innerText、首屏渲染耗时、长任务和 DOM 规模。
 * 约束：尾部换行单独作为规范化场景，不把 Markdown 展示层的 trim 结果冒充原文完全相等。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(import.meta.dirname, '../..')
const reportPath = path.resolve(process.env.DOM_PERF_REPORT || path.join(root, 'test-results', `dom-performance-${process.pid}.json`))
const edgePath = process.env.CHROME_BIN || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const report = {
  schema: 'ai-office-dom-performance-evidence-v2',
  startedAt: new Date().toISOString(),
  classification: '真实 Vite 页面 + Playwright Edge + route fixture；不代表 Provider/Host 长流',
  browser: edgePath,
  cases: [],
  failures: [],
  status: 'running',
}

let vite
let browser

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address !== 'string', '无法分配性能测试端口')
  const port = address.port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForPage(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {
      // Vite 尚未监听，继续等待。
    }
    await sleep(100)
  }
  throw new Error(`Vite 未在 ${timeoutMs}ms 内就绪：${url}`)
}

function buildText(length, trailingNewline) {
  const atom = '长难句中文😀ABC123'
  let text = ''
  while (text.length < length) text += atom
  text = text.slice(0, length)
  return trailingNewline ? `${text}\n` : text
}

function markdownVisibleText(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' ')
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

async function shutdown() {
  if (browser) await browser.close().catch(() => undefined)
  if (vite?.pid && vite.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(vite.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else vite.kill('SIGTERM')
  }
}

try {
  assert(await fs.stat(edgePath).then(() => true).catch(() => false), `找不到 Edge/Chrome：${edgePath}`)
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--clearScreen', 'false'], {
    cwd: root,
    env: { ...process.env, VITE_OFFICE_HTTP_ACTIONS_URL: 'http://127.0.0.1:1/actions' },
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForPage(origin)
  browser = await chromium.launch({ executablePath: edgePath, headless: true, args: ['--enable-precise-memory-info'] })

  for (const size of [50_000, 180_000]) {
    for (const trailingNewline of [false, true]) {
      const rawText = buildText(size, trailingNewline)
      const expectedText = markdownVisibleText(rawText)
      const page = await browser.newPage()
      let currentText = rawText
      await page.addInitScript(() => {
        window.__domAudit = { longTasks: [] }
        if ('PerformanceObserver' in window) {
          try {
            const observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) window.__domAudit.longTasks.push(entry.duration)
            })
            observer.observe({ type: 'longtask', buffered: true })
          } catch {
            // 当前浏览器不支持 longtask 时保留空数组，由报告标注能力缺失。
          }
        }
      })
      await page.route('**/office/sessions', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'dom-perf', title: 'DOM 性能对话', provider: 'mock', model: 'mock', createdAt: 1, updatedAt: 1 }]) }))
      await page.route('**/office/conversations/dom-perf/status', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
      await page.route('**/office/conversations/dom-perf/messages', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { info: { id: 'dom-user', role: 'user', turnID: 'dom-turn' }, parts: [{ type: 'text', text: '请返回长正文' }] },
        { info: { id: 'dom-assistant', role: 'assistant', turnID: 'dom-turn' }, parts: [{ type: 'text', text: currentText }] },
      ]) }))
      for (const pathName of ['/office/agents', '/office/tasks', '/office/skills', '/office/files', '/office/permissions', '/office/notifications']) {
        await page.route(`**${pathName}`, async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
      }
      await page.route('**/office/workspace', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ root: 'audit' }) }))
      await page.route('**/actions', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: 0, queued: 0 }) }))

      const startedAt = Date.now()
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '对话中心' }).click()
      const sessionButton = page.getByRole('button', { name: 'DOM 性能对话', exact: true })
      await sessionButton.click()
      const message = page.locator('.transcript-message.assistant .message-content').first()
      await message.waitFor({ state: 'visible', timeout: 30_000 })
      const renderMs = Date.now() - startedAt
      const metrics = await message.evaluate((element) => {
        const textContent = element.textContent || ''
        const html = element.innerHTML
        return {
          textContentLength: textContent.length,
          textContentStart: textContent.slice(0, 64),
          textContentEnd: textContent.slice(-64),
          renderedText: textContent,
          innerTextStart: (element.innerText || '').slice(0, 64),
          innerTextEnd: (element.innerText || '').slice(-64),
          innerTextLength: (element.innerText || '').length,
          htmlLength: html.length,
          childCount: element.querySelectorAll('*').length,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }
      })
      const browserMetrics = await page.evaluate(() => ({
        usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null,
        longTasks: window.__domAudit?.longTasks || [],
      }))
      assert(metrics.renderedText === expectedText, `${size}${trailingNewline ? ' trailing-newline' : ''} DOM text mismatch: expected ${expectedText.length}, got ${metrics.textContentLength}`)
      const { renderedText, ...renderMetrics } = metrics
      report.cases.push({
        size,
        trailingNewline,
        rawLength: rawText.length,
        rawSha256: sha256(rawText),
        expectedVisibleLength: expectedText.length,
        expectedVisibleSha256: sha256(expectedText),
        renderMs,
        ...renderMetrics,
        renderedTextSha256: sha256(renderedText),
        renderedTextMatchesExpected: renderedText === expectedText,
        usedJSHeapSize: browserMetrics.usedJSHeapSize,
        longTaskCount: browserMetrics.longTasks.length,
        maxLongTaskMs: browserMetrics.longTasks.length ? Math.max(...browserMetrics.longTasks) : 0,
        pageReadyMs: Date.now() - startedAt,
      })
      await page.close()
    }
  }
  report.status = 'passed'
} catch (error) {
  report.failures.push({ message: error instanceof Error ? error.stack || error.message : String(error) })
  report.status = 'failed'
} finally {
  report.finishedAt = new Date().toISOString()
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await shutdown()
  console.log(`EVIDENCE report: ${reportPath}`)
  if (report.status !== 'passed') console.error(JSON.stringify(report.failures, null, 2))
  process.exitCode = report.status === 'passed' ? 0 : 1
}
