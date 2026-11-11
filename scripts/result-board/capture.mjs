/**
 * DEV-ONLY acceptance screenshot harness for the PawOffice result reading page.
 *
 *   node scripts/result-board/capture.mjs
 *
 * - Starts the Vite dev server from `apps/web` with the bundled Vite CLI (no new dependencies).
 * - Opens the dev-only preview page `apps/web/dev/result-board.html` (not a production build input).
 * - Captures the seven screenshots required by the acceptance spec into
 *   `docs/design/result-board/screenshots/` and writes `manifest.json` with provenance.
 * - Idempotent: previous PNG/manifest files in the output directory are replaced.
 * - Fails loudly on browser console errors or missing UI states; never fabricates a screenshot.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../..', import.meta.url))
const webRoot = path.join(root, 'apps/web')
const viteBin = path.join(root, 'node_modules/vite/bin/vite.js')
const outputDir = path.join(root, 'docs/design/result-board/screenshots')
const previewPath = '/dev/result-board.html'
const homePath = '/?conference=0'
const desktopViewport = { width: 1787, height: 864 }
const mobileViewport = { width: 390, height: 844 }
const dataSources = {
  'real-sample': '用户真实样例 result-ready-round3.json（逐字节复制）',
  'real-sample-history': '用户真实样例 whiteboard-ready-round3.json（逐字节复制，含历史交付）',
  'frontend-fixture': '前端验收 fixture（非真实数据）',
  home: 'PawOffice 首页（未改动，证明首页零回归）',
}
/** Every dev fixture must render without console errors; these markers prove the branch-specific data is on screen. */
const fixtureSmokeExpectations = {
  sample: ['登录模块交付成果', /需要关注\s*\d+\s*项/],
  history: ['登录模块交付成果', '登录模块需求说明'],
  matrix: ['全类型渲染验收矩阵', '自定义区块矩阵', '接口清单', '文件变更', '页面画廊', '测试用例数据'],
  layouts: ['自定义布局验收', '连续文档', '并排短内容', '网格内容', '轻卡片内容'],
  limits: ['极限数据密度验收', '24 个文件变更', '12 个附件', '8 张画廊', '8 份文档', '24 个区块'],
  states: ['成果 · '],
}
const presentationStateLabels = {
  draft: '草稿', ready: '已交付', verified: '已验证', rejected: '未通过', conflict: '验证待核对',
  producing: '正在产出', blocked: '产出受阻', failed: '尚无成果', missing: '尚未交付', empty: '暂无成果',
}

const captured = []
const browserErrors = []
let serverProcess, baseUrl

function log(message) {
  console.log(`[capture:result-board] ${message}`)
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('截图不是有效 PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForServer(url, timeoutMs = 120000) {
  const start = Date.now()
  let lastError
  while (Date.now() - start < timeoutMs) {
    if (serverProcess?.exitCode !== null && serverProcess?.exitCode !== undefined) {
      throw new Error(`Vite dev server 提前退出（code ${serverProcess.exitCode}）：${serverProcess.__stderr ?? ''}`)
    }
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise(resolve => setTimeout(resolve, 300))
  }
  throw new Error(`Vite dev server 无法访问：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function startViteDev(port) {
  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: webRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none' },
  })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  child.stdout.on('data', () => {})
  child.on('error', error => { stderr += `\nspawn error: ${error.message}` })
  child.on('exit', () => { child.__stderr = stderr })
  serverProcess = child
  return child
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return
  const exited = new Promise(resolve => serverProcess.once('exit', resolve))
  serverProcess.kill()
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 8000))])
  if (serverProcess.exitCode === null) serverProcess.kill('SIGKILL')
}

async function launchBrowser() {
  const attempts = [{ name: 'bundled chromium', options: { headless: true } }, { name: 'chrome channel', options: { channel: 'chrome', headless: true } }]
  let lastError
  for (const attempt of attempts) {
    try {
      const browser = await chromium.launch(attempt.options)
      log(`使用 ${attempt.name} 截图`)
      return browser
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`无法启动浏览器：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

function watchErrors(page, label) {
  page.on('pageerror', error => browserErrors.push(`[${label}] pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(`[${label}] console.error: ${message.text()}`)
  })
}

async function settle(page, extra = 350) {
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready })
  await page.waitForTimeout(extra)
}

async function savePng(file, buffer, meta) {
  const { width, height } = pngDimensions(buffer)
  if (width < 2 || height < 2) throw new Error(`截图尺寸异常：${file} ${width}×${height}`)
  // Screenshot sanity: a blank/white capture (remembered failures) must fail loudly.
  const imageStats = await sharp(buffer).stats()
  const pixelStdev = imageStats.channels.map(channel => Number(channel.stdev.toFixed(2)))
  if (pixelStdev.every(value => value < 2)) throw new Error(`截图疑似空白：${file}（stdev=${pixelStdev.join(',')}）`)
  await writeFile(path.join(outputDir, file), buffer)
  captured.push({ file, width, height, pixelStdev, sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length, capturedAt: new Date().toISOString(), ...meta })
  log(`已保存 ${file}（${width}×${height}，像素 stdev ${pixelStdev.join('/')}）`)
}

async function openPreview(page, query) {
  await page.goto(`${baseUrl}${previewPath}?${query}`, { waitUntil: 'load' })
  await page.waitForSelector('dialog[open]', { timeout: 45000 })
  await page.waitForFunction(() => document.body.classList.contains('preview-fonts-ready'), null, { timeout: 30000 })
  const previewError = await page.evaluate(() => document.body.dataset.previewError)
  if (previewError) throw new Error(`预览页 fixture 渲染失败：${previewError}`)
  const overflow = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    return {
      document: document.documentElement.scrollWidth - window.innerWidth,
      dialog: dialog ? dialog.scrollWidth - dialog.clientWidth : 0,
    }
  })
  if (overflow.document > 1) throw new Error(`[${query}] 页面出现横向溢出：${overflow.document}px`)
  if (overflow.dialog > 2) throw new Error(`[${query}] 成果阅读器出现非预期横向溢出：${overflow.dialog}px`)
  await settle(page)
}

/**
 * Expand the reader dialog and screenshot its full content.
 * The production dialog scrolls internally; for the long screenshot only, its scroll surfaces are
 * temporarily expanded and the dialog is given the measured content height. A `<dialog>` is
 * position:fixed with top/bottom:0, so `height:auto` alone stretches to the viewport instead of
 * shrinking to content — the explicit measured height is what makes an untruncated long shot.
 */
async function captureExpandedDialog(page, file) {
  const dialog = page.locator('dialog[open]').first()
  await dialog.waitFor({ state: 'visible' })
  // The sample's changes section ships 6 files, including the binary docs/login-flow.png; all rows
  // must be rendered by default (no "全部 N 个文件" folding toggle to depend on).
  const changeRows = await page.evaluate(() => ({
    count: document.querySelectorAll('.result-change-row').length,
    binaryVisible: (document.querySelector('dialog[open]')?.innerText ?? '').includes('docs/login-flow.png'),
  }))
  if (changeRows.count !== 6) throw new Error(`[03-result-full] changes 默认应渲染 6 个文件行，实际 ${changeRows.count}`)
  if (!changeRows.binaryVisible) throw new Error('[03-result-full] binary 变更 docs/login-flow.png 未渲染')
  const measured = await page.evaluate(() => {
    const element = document.querySelector('dialog[open]')
    if (!element) return null
    const expandScroller = target => {
      const style = getComputedStyle(target)
      if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflow === 'clip' || style.overflow === 'hidden') {
        target.style.setProperty('overflow', 'visible', 'important')
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          target.style.setProperty('overflow-y', 'visible', 'important')
        }
      }
      target.style.setProperty('max-height', 'none', 'important')
    }
    element.style.setProperty('overflow', 'visible', 'important')
    for (const child of element.querySelectorAll('*')) expandScroller(child)
    const article = element.querySelector('article')
    const workspace = element.querySelector('.result-workspace')
    const header = element.querySelector(':scope > header')
    if (article) {
      article.style.setProperty('height', 'auto', 'important')
      article.style.setProperty('max-height', 'none', 'important')
      article.style.setProperty('flex', 'none', 'important')
      article.style.setProperty('overflow', 'visible', 'important')
    }
    if (!workspace) return null
    workspace.style.setProperty('height', 'auto', 'important')
    workspace.style.setProperty('max-height', 'none', 'important')
    workspace.style.setProperty('overflow', 'visible', 'important')
    const workspaceHeight = Math.ceil(workspace.getBoundingClientRect().height)
    const height = (header?.getBoundingClientRect().height ?? 0) + workspaceHeight + 2
    // Fixed dialogs stretch between their inset anchors; pin the top and set the real height.
    element.style.setProperty('top', '0', 'important')
    element.style.setProperty('bottom', 'auto', 'important')
    element.style.setProperty('height', `${Math.ceil(height)}px`, 'important')
    element.style.setProperty('max-height', 'none', 'important')
    return { height: Math.ceil(height), workspaceHeight }
  })
  if (!measured) throw new Error('无法展开成果阅读器内容')
  await page.waitForTimeout(300)
  await page.setViewportSize({ width: desktopViewport.width, height: Math.min(14000, measured.height + 80) })
  await page.waitForTimeout(300)
  const buffer = await dialog.screenshot({ animations: 'disabled' })
  const dimensions = pngDimensions(buffer)
  if (dimensions.height < measured.workspaceHeight) {
    throw new Error(`[03-result-full] 完整长图被截断：截图高 ${dimensions.height}px < 正文高 ${measured.workspaceHeight}px`)
  }
  await savePng(file, buffer, {
    url: `${previewPath}?fixture=sample`, viewport: `${desktopViewport.width}×${desktopViewport.height}（展开为完整长图，正文 ${measured.workspaceHeight}px）`,
    dataSource: dataSources['real-sample'], fixture: 'sample', state: 'ready',
  })
  await page.setViewportSize(desktopViewport)
}

async function clickNearText(page, text, label) {
  const clickTarget = await page.evaluate(titleText => {
    const scope = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document.body
    const leaves = [...scope.querySelectorAll('*')].filter(element => element.children.length === 0 && (element.textContent ?? '').trim() === titleText)
    const title = leaves[0]
    if (!title) return { ok: false, reason: '未找到标题文本' }
    let node = title
    let candidate = null
    while (node && node !== scope) {
      if (node.matches('button, a, [role="button"]')) { candidate = node; break }
      const buttons = [...node.querySelectorAll('button, a[href], [role="button"]')]
      if (buttons.length) {
        candidate = buttons.find(button => button.matches('[aria-haspopup]'))
          ?? buttons.find(button => /查看|预览|打开/.test((button.textContent ?? '') + (button.getAttribute('aria-label') ?? '')))
          ?? buttons[0]
        break
      }
      node = node.parentElement
    }
    if (!candidate) return { ok: false, reason: '标题附近没有可点击元素' }
    candidate.setAttribute('data-capture-click', '1')
    return { ok: true, tag: candidate.tagName, text: (candidate.textContent ?? '').trim().slice(0, 40) }
  }, text)
  if (!clickTarget.ok) throw new Error(`[${label}] 无法点击“${text}”：${clickTarget.reason}`)
  log(`[${label}] 点击 ${clickTarget.tag} “${clickTarget.text}”`)
  await page.locator('[data-capture-click="1"]').first().click()
  await page.evaluate(() => document.querySelector('[data-capture-click="1"]')?.removeAttribute('data-capture-click'))
}

async function revealText(page, pattern, label) {
  const text = page.getByText(pattern).first()
  if (await text.isVisible().catch(() => false)) return text
  // Old tabbed UI: switch tabs until the target section is reachable. New single-flow UI has no tabs.
  for (const name of ['过程记录', '交付物', '概览', '验证', '检查']) {
    const tab = page.getByRole('tab', { name })
    if (await tab.count()) {
      await tab.first().click()
      await page.waitForTimeout(350)
      if (await text.isVisible().catch(() => false)) return text
    }
  }
  await text.waitFor({ state: 'visible', timeout: 10000 })
  return text
}

/** Render every dev fixture and presentation state once; data-specific markers must be on screen. */
async function smokeFixtures(browser) {
  const context = await browser.newContext({ viewport: desktopViewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const results = []
  const run = async (query, expectations) => {
    const page = await context.newPage()
    const before = browserErrors.length
    watchErrors(page, `smoke:${query}`)
    await openPreview(page, query)
    for (const expectation of expectations) {
      const locator = expectation instanceof RegExp ? page.getByText(expectation).first() : page.getByText(expectation, { exact: false }).first()
      await locator.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {
        throw new Error(`[smoke:${query}] 未找到预期内容：${expectation}`)
      })
    }
    const textLength = await page.evaluate(() => (document.querySelector('dialog[open]')?.innerText ?? '').length)
    if (textLength < 20) throw new Error(`[smoke:${query}] 阅读器内容异常短：${textLength}`)
    results.push({ query, ok: browserErrors.length === before, textLength })
    await page.close()
  }
  for (const name of ['sample', 'history', 'matrix', 'layouts', 'limits']) await run(`fixture=${name}`, fixtureSmokeExpectations[name])
  for (const [key, label] of Object.entries(presentationStateLabels)) await run(`state=${key}`, [`成果 · ${label}`])
  await context.close()
  log(`fixture 冒烟校验：${results.filter(item => item.ok).length}/${results.length} 无 console 错误`)
  return results
}

async function captureSampleFlow(browser, context) {
  const page = await context.newPage()
  watchErrors(page, 'desktop')

  // 02 — real sample, first screen.
  await openPreview(page, 'fixture=sample')
  // First-screen reading path: identity + conclusion + status + attention + first deliverable.
  const firstScreen = [
    ['成果标题', page.getByText('登录模块交付成果', { exact: false }).first()],
    ['成果摘要', page.getByText('需求说明更新至 v2.0', { exact: false }).first()],
    ['成果状态', page.getByText(/成果\s*·\s*已交付/).first()],
    ['需要关注提示', page.getByText(/需要关注\s*\d+\s*项/).first()],
    ['首个交付文件', page.getByText('登录模块需求说明', { exact: false }).first()],
  ]
  for (const [name, locator] of firstScreen) {
    await locator.waitFor({ state: 'visible', timeout: 20000 })
    const box = await locator.boundingBox()
    if (!box || box.y < 0 || box.y + box.height > desktopViewport.height || box.x < 0 || box.x + box.width > desktopViewport.width) {
      throw new Error(`[02-result-first-screen] ${name} 不在首屏可见区域：${JSON.stringify(box)}`)
    }
  }
  const dialogBox = await page.locator('dialog[open]').first().boundingBox()
  if (!dialogBox || dialogBox.width < 1100 || dialogBox.width > 1140 || dialogBox.height < 800 || dialogBox.height > 840) {
    throw new Error(`[02-result-first-screen] 阅读器尺寸异常（期望约 1120×824）：${JSON.stringify(dialogBox)}`)
  }
  await savePng('02-result-first-screen-1787x864.png', await page.screenshot({ animations: 'disabled' }), {
    url: `${previewPath}?fixture=sample`, viewport: `${desktopViewport.width}×${desktopViewport.height}`,
    dataSource: dataSources['real-sample'], fixture: 'sample', state: 'ready',
    checks: ['标题/结论/成果状态/需要关注提示/首个交付文件均首屏可见', `阅读器 ${Math.round(dialogBox.width)}×${Math.round(dialogBox.height)}`],
  })

  // 03 — real sample, complete long screenshot.
  await captureExpandedDialog(page, '03-result-full.png')

  // 04 — open the first document (需求说明 v2.0) and read its Markdown body.
  await openPreview(page, 'fixture=sample')
  await clickNearText(page, '登录模块需求说明', '04-markdown-reading')
  await page.getByText('验证码 5 分钟内有效', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 })
  await settle(page)
  await savePng('04-markdown-reading.png', await page.screenshot({ animations: 'disabled' }), {
    url: `${previewPath}?fixture=sample（点击「登录模块需求说明」打开文档预览）`, viewport: `${desktopViewport.width}×${desktopViewport.height}`,
    dataSource: dataSources['real-sample'], fixture: 'sample', state: 'ready',
  })

  // 05 — expand one real diff in the changes section.
  await openPreview(page, 'fixture=sample')
  const deliverablesTab = page.getByRole('tab', { name: '交付物' })
  if (await deliverablesTab.count()) {
    await deliverablesTab.first().click()
    await page.waitForTimeout(350)
  }
  await clickNearText(page, 'src/features/auth/LoginForm.tsx', '05-changes-diff')
  await page.waitForFunction(() => {
    const visible = element => element instanceof HTMLElement && element.getClientRects().length > 0
    return [...document.querySelectorAll('.result-diff-popover, [role="dialog"][aria-label*="差异"], .result-diff-table, [class*="diff"]')].some(visible)
  }, null, { timeout: 15000 })
  // The rendered diff must contain the real changed line from LoginForm.tsx.
  await page.getByText('setSubmitting', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 })
  await settle(page)
  await savePng('05-changes-diff.png', await page.screenshot({ animations: 'disabled' }), {
    url: `${previewPath}?fixture=sample（展开 LoginForm.tsx 的 diff）`, viewport: `${desktopViewport.width}×${desktopViewport.height}`,
    dataSource: dataSources['real-sample'], fixture: 'sample', state: 'ready',
  })

  // 06 — stale-version check must be visible as a pending re-verification item.
  await openPreview(page, 'fixture=sample')
  const staleCheck = await revealText(page, '需求范围检查', '06-stale-check')
  await staleCheck.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  const staleBox = await staleCheck.boundingBox()
  if (!staleBox || staleBox.y < 0 || staleBox.y + staleBox.height > desktopViewport.height) {
    throw new Error(`[06-stale-check] 旧版本检查不在可视区域：${JSON.stringify(staleBox)}`)
  }
  const staleNotice = page.getByText(/验证版本已更新|待补充验证/).first()
  if (!(await staleNotice.isVisible().catch(() => false))) throw new Error('[06-stale-check] 未显示旧版本检查的待补充/重新验证提示，截图已中止')
  await settle(page)
  await savePng('06-stale-check.png', await page.screenshot({ animations: 'disabled' }), {
    url: `${previewPath}?fixture=sample（滚动到旧版本检查「需求范围检查」）`, viewport: `${desktopViewport.width}×${desktopViewport.height}`,
    dataSource: dataSources['real-sample'], fixture: 'sample', state: 'ready',
  })
  await page.close()
}

async function captureHistoryFlow(browser, context) {
  const page = await context.newPage()
  watchErrors(page, 'history')

  // 08 — open a document, switch the preview to its historical version, then compare with current.
  await openPreview(page, 'fixture=history')
  const historySwitch = page.locator('.result-delivery-switch').first()
  await historySwitch.waitFor({ state: 'visible', timeout: 20000 })
  const switchText = (await historySwitch.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  await clickNearText(page, '登录模块需求说明', '08-history-version-compare')
  const versionSelect = page.getByLabel('文档版本')
  await versionSelect.waitFor({ state: 'visible', timeout: 20000 })
  const optionValues = await versionSelect.locator('option').evaluateAll(options => options.map(option => option.getAttribute('value')))
  if (!optionValues.includes('prd-v1')) throw new Error(`[08-history-version-compare] 版本选择器缺少 prd-v1，实际选项：${optionValues.join(', ')}`)
  await versionSelect.selectOption('prd-v1')
  await page.getByText(/正在查看历史版本/).first().waitFor({ state: 'visible', timeout: 20000 })
  const compareButton = page.getByRole('button', { name: /与当前版本比较/ }).first()
  await compareButton.waitFor({ state: 'visible', timeout: 20000 })
  await compareButton.click()
  await page.getByText(/对比两份版本正文/).first().waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForFunction(() => document.querySelector('.result-diff-table') !== null, null, { timeout: 20000 })
  // The diff must be the real prd-v1 → prd-v2 change, not just an opened dialog.
  await page.getByText('退出登录与角色权限校验', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 })
  await settle(page)
  await savePng('08-history-version-compare.png', await page.screenshot({ animations: 'disabled' }), {
    url: `${previewPath}?fixture=history（打开「登录模块需求说明」→ 版本选择器切到 prd-v1 → 与当前版本比较）`,
    viewport: `${desktopViewport.width}×${desktopViewport.height}`,
    dataSource: dataSources['real-sample-history'], fixture: 'history',
    steps: ['打开当前成果的文档预览', '文档版本选择器选择 prd-v1（第 2 轮历史交付）', '点击“与当前版本比较”', '等待真实 diff 渲染', `历史交付选择器：${switchText}`],
  })

  // 09 — open one historical delivery round through the existing initialDeliveryId entry.
  await openPreview(page, 'fixture=history&delivery=delivery-2')
  await page.getByText(/历史交付/).first().waitFor({ state: 'visible', timeout: 20000 })
  const roundsSwitch = page.locator('.result-delivery-switch').first()
  await roundsSwitch.waitFor({ state: 'visible', timeout: 20000 })
  const roundsText = (await roundsSwitch.innerText().catch(() => '')).replace(/\s+/g, ' ').trim()
  const returnButton = page.getByRole('button', { name: /返回当前成果/ }).first()
  await returnButton.waitFor({ state: 'visible', timeout: 20000 })
  // Historical content must be the delivery-2 payload (api doc only existed in round 2).
  await page.getByText('登录接口文档', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 })
  const noticeText = await page.locator('.result-delivery-notice').first().innerText().catch(() => '')
  await settle(page)
  await savePng('09-history-delivery.png', await page.screenshot({ animations: 'disabled' }), {
    url: `${previewPath}?fixture=history&delivery=delivery-2（打开第 2 轮历史交付）`,
    viewport: `${desktopViewport.width}×${desktopViewport.height}`,
    dataSource: dataSources['real-sample-history'], fixture: 'history',
    steps: [`通过 existing initialDeliveryId 打开 delivery-2`, `历史提示：${noticeText.replace(/\s+/g, ' ').trim()}`, `历史交付选择器：${roundsText}`],
  })
  await page.close()
}

async function captureHome(browser, context) {
  const page = await context.newPage()
  watchErrors(page, 'home')
  await page.goto(`${baseUrl}${homePath}`, { waitUntil: 'load' })
  await page.waitForSelector('canvas', { timeout: 90000 })
  await page.waitForFunction(() => !(document.body.innerText ?? '').includes('正在加载办公室'), null, { timeout: 90000 })
  await settle(page, 1200)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  if (overflow > 1) throw new Error(`[01-home] 页面出现横向溢出：${overflow}px`)
  await savePng('01-home-1787x864.png', await page.screenshot({ animations: 'disabled' }), {
    url: homePath, viewport: `${desktopViewport.width}×${desktopViewport.height}`,
    dataSource: dataSources.home, fixture: 'home',
  })
  await page.close()
}

async function captureMobile(browser) {
  const context = await browser.newContext({ viewport: mobileViewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  const page = await context.newPage()
  watchErrors(page, 'mobile')
  await openPreview(page, 'fixture=sample')
  // Mobile tap targets: 38px delivery actions, 36px document rows, 40px reader actions.
  const tapTargets = await page.evaluate(() => {
    const heights = selector => [...document.querySelectorAll(selector)]
      .filter(element => element.getClientRects().length > 0)
      .map(element => Math.round(element.getBoundingClientRect().height * 10) / 10)
    return {
      deliverableAction: heights('.result-deliverable-action'),
      documentOpen: heights('.result-workspace-doc-open'),
      readerAction: heights('.result-workspace-actions .result-action'),
    }
  })
  const minimum = values => values.length ? Math.min(...values) : null
  const smallest = {
    deliverableAction: minimum(tapTargets.deliverableAction),
    documentOpen: minimum(tapTargets.documentOpen),
    readerAction: minimum(tapTargets.readerAction),
  }
  if (smallest.deliverableAction === null) throw new Error('[07-mobile] 未找到交付物操作按钮，无法核对点击区域')
  if (smallest.deliverableAction < 37.5) throw new Error(`[07-mobile] 交付物操作点击区域过小：${smallest.deliverableAction}px < 38px`)
  if (smallest.documentOpen !== null && smallest.documentOpen < 35.5) throw new Error(`[07-mobile] 文档行点击区域过小：${smallest.documentOpen}px < 36px`)
  if (smallest.readerAction !== null && smallest.readerAction < 39.5) throw new Error(`[07-mobile] 阅读器操作点击区域过小：${smallest.readerAction}px < 40px`)
  await savePng('07-mobile-390x844.png', await page.screenshot({ animations: 'disabled' }), {
    url: `${previewPath}?fixture=sample`, viewport: `${mobileViewport.width}×${mobileViewport.height}`,
    dataSource: dataSources['real-sample'], fixture: 'sample', state: 'ready',
    tapTargets: smallest,
  })
  await context.close()
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  for (const entry of await readdir(outputDir)) {
    if (entry.endsWith('.png') || entry === 'manifest.json') await rm(path.join(outputDir, entry), { force: true })
  }
  const ports = await freePort()
  baseUrl = `http://127.0.0.1:${ports}`
  log(`启动 Vite dev：${baseUrl}（cwd=${path.relative(root, webRoot)}）`)
  await startViteDev(ports)
  await waitForServer(baseUrl)
  log('Vite dev 已就绪')

  let browser, smoke
  try {
    browser = await launchBrowser()
    smoke = await smokeFixtures(browser)
    const desktopContext = await browser.newContext({ viewport: desktopViewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    await captureHome(browser, desktopContext)
    await captureSampleFlow(browser, desktopContext)
    await captureHistoryFlow(browser, desktopContext)
    await desktopContext.close()
    await captureMobile(browser)
  } finally {
    if (browser) await browser.close()
    await stopServer()
  }

  let branch = 'unknown'
  try { branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim() || 'unknown' } catch { /* git is optional for the manifest */ }
  const sampleFiles = [
    { source: 'docs/design/chatgpt-result-board-handoff/sample/result-ready-round3.json', copy: 'apps/web/src/dev/fixtures/result-ready-round3.json' },
    { source: 'docs/design/chatgpt-result-board-handoff/sample/whiteboard-ready-round3.json', copy: 'apps/web/src/dev/fixtures/whiteboard-ready-round3.json' },
  ]
  const realSamples = []
  for (const entry of sampleFiles) {
    realSamples.push({ ...entry, sha256: createHash('sha256').update(await readFile(path.join(root, entry.copy))).digest('hex').toUpperCase() })
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    branch,
    previewPage: previewPath,
    homePage: homePath,
    note: 'DEV-ONLY 验收截图。数据来源逐张标注：真实样例为 sample JSON 的逐字节复制，其余为前端验收 fixture。',
    dataSources,
    realSamples,
    fixtureSmoke: smoke ?? [],
    consoleErrors: browserErrors,
    screenshots: [...captured].sort((a, b) => a.file.localeCompare(b.file)),
  }
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  log(`已写入 ${path.relative(root, path.join(outputDir, 'manifest.json'))}`)
  const failedSmoke = (smoke ?? []).filter(item => !item.ok)
  if (failedSmoke.length) throw new Error(`fixture 冒烟校验出现 console 错误：${failedSmoke.map(item => item.query).join(', ')}`)
  if (browserErrors.length) throw new Error(`页面控制台出现 ${browserErrors.length} 条错误：\n${browserErrors.join('\n')}`)
  log(`完成：${captured.length} 张截图`)
}

main().catch(async error => {
  console.error(`[capture:result-board] 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  if (browserErrors.length) console.error(`[capture:result-board] 页面错误：\n${browserErrors.join('\n')}`)
  await stopServer()
  process.exitCode = 1
})
