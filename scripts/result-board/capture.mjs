/**
 * DEV-ONLY acceptance screenshot harness for the PawOffice result reading page.
 *
 *   node scripts/result-board/capture.mjs
 *
 * - Starts the Vite dev server from `apps/web` with the bundled Vite CLI (no new dependencies).
 * - Opens the dev-only preview page `apps/web/dev/result-board.html` (not a production build input).
 * - Captures the nine existing acceptance screenshots plus the eight data-type samples required by
 *   `docs/design/result-board/07-data-type-visual-system.md` §5 into
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
/** One fixture per data type; screenshots `type-01` … `type-08` come from these. */
const typeFixtureNames = [
  'type-metrics', 'type-delivery', 'type-artifacts', 'type-review',
  'type-versions', 'type-changes', 'type-fact', 'type-sections',
]
/** Every dev fixture must render without console errors; these markers prove the branch-specific data is on screen. */
const fixtureSmokeExpectations = {
  sample: ['登录模块交付成果', /需要关注\s*\d+\s*项/],
  history: ['登录模块交付成果', '登录模块需求说明'],
  matrix: ['全类型渲染验收矩阵', '自定义区块矩阵', '接口清单', '文件变更', '页面画廊', '测试用例数据'],
  layouts: ['自定义布局验收', '连续文档', '并排短内容', '网格内容', '轻卡片内容'],
  limits: ['极限数据密度验收', '24 个文件变更', '12 个附件', '8 张画廊', '8 份文档', '24 个区块'],
  states: ['成果 · '],
  'type-metrics': ['指标类型视觉验收', '待发布', '已达标', '仅覆盖登录模块', /首轮\s*2\.9%/],
  'type-delivery': ['文档交付与同源文档区', '需求说明', '接口文档', '验收记录', '文档说明（未关联文件）'],
  'type-artifacts': ['图像 / 外链 / 数据与画廊混合', '登录页截图', '待补外链', '回归用例数据', '待补截图', '页面画廊'],
  'type-review': ['验证结论与风险登记', '主流程冒烟', '异常路径回归', '性能基线复核', '需求范围检查', '短信验证码频率限制待复核', '旧版本文档已归档'],
  'type-versions': ['成果版本时间线', '草稿', '已发布', '已回滚'],
  'type-changes': ['代码变更与行内 diff', '已编辑 24 个文件', 'docs/login-flow.png', '较大文件'],
  'type-fact': ['说明型成果阅读验收', '说明与结论', '背景与范围', '决策记录'],
  'type-sections': ['接口 / 环境 / 附件 / 质量报告', '接口清单', '运行环境', '附件清单', '质量报告'],
}
const fixtureNames = ['sample', 'history', 'matrix', 'layouts', 'limits', ...typeFixtureNames]
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

/* -------------------------------------------------------------------------------------------------
 * Data-type visual samples — `type-01` … `type-08`
 *
 * Every shot scrolls its target block to the top of the reader's scroll viewport first, then asserts
 * the expected data is actually on screen before saving. A missing block or missing data fails the
 * run instead of producing a plausible-looking but wrong screenshot.
 * ----------------------------------------------------------------------------------------------- */

async function countOf(page, selector) {
  return page.evaluate(selector => document.querySelectorAll(selector).length, selector)
}

async function scrollBlockToTop(page, selectors, label) {
  const outcome = await page.evaluate(selectorList => {
    const dialog = document.querySelector('dialog[open]')
    if (!dialog) return { ok: false, reason: '成果阅读器未打开' }
    const scroller = dialog.querySelector('.whiteboard-reader-content') ?? dialog
    let target = null
    let matched = ''
    for (const selector of selectorList) {
      target = dialog.querySelector(selector)
      if (target) { matched = selector; break }
    }
    if (!target) return { ok: false, reason: `未找到目标区块：${selectorList.join(' | ')}` }
    const scrollerRect = scroller.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const maxScroll = Math.max(0, Math.round(scroller.scrollHeight - scroller.clientHeight))
    const targetContentTop = Math.round(scroller.scrollTop + targetRect.top - scrollerRect.top)
    const wanted = targetContentTop - 8
    let scrollTop = Math.max(0, wanted)
    let alignment = 'top'
    // When the target sits too close to the end it can never reach the viewport top. Align its
    // bottom instead (or the content bottom) so the whole block stays readable without clipping
    // the header of a short result.
    if (wanted > maxScroll) {
      alignment = 'bottom'
      scrollTop = Math.max(0, Math.min(maxScroll, targetContentTop + Math.round(targetRect.height) - scroller.clientHeight + 16))
    }
    scroller.style.setProperty('scroll-behavior', 'auto', 'important')
    scroller.scrollTop = scrollTop
    const after = target.getBoundingClientRect()
    return {
      ok: true, matched, alignment, scrollTop: Math.round(scroller.scrollTop),
      visible: after.bottom > scrollerRect.top + 8 && after.top < scrollerRect.bottom - 8,
    }
  }, selectors)
  if (!outcome.ok) throw new Error(`[${label}] ${outcome.reason}`)
  if (!outcome.visible) throw new Error(`[${label}] 目标区块未进入视口（scrollTop=${outcome.scrollTop}）`)
  await page.waitForTimeout(250)
  log(`[${label}] 已滚动到 ${outcome.matched}（${outcome.alignment === 'top' ? '顶部对齐' : '短内容底部对齐'}，scrollTop=${outcome.scrollTop}）`)
  return outcome
}

async function scrollToReaderTop(page, label) {
  const scrollTop = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]')
    const scroller = dialog?.querySelector('.whiteboard-reader-content')
    if (!scroller) return null
    scroller.style.setProperty('scroll-behavior', 'auto', 'important')
    scroller.scrollTop = 0
    return scroller.scrollTop
  })
  if (scrollTop === null) throw new Error(`[${label}] 未找到阅读器滚动容器`)
  await page.waitForTimeout(250)
  log(`[${label}] 已滚动到阅读器顶部（scrollTop=0）`)
}

async function nudgeScroll(page, delta, label) {
  const scrollTop = await page.evaluate(deltaPx => {
    const dialog = document.querySelector('dialog[open]')
    const scroller = dialog?.querySelector('.whiteboard-reader-content')
    if (!scroller) return null
    scroller.style.setProperty('scroll-behavior', 'auto', 'important')
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    scroller.scrollTop = Math.max(0, Math.min(maxScroll, scroller.scrollTop + deltaPx))
    return Math.round(scroller.scrollTop)
  }, delta)
  if (scrollTop === null) throw new Error(`[${label}] 未找到阅读器滚动容器`)
  await page.waitForTimeout(200)
  log(`[${label}] 额外下移 ${delta}px（scrollTop=${scrollTop}）`)
}

async function expectCount(page, selector, expected, label) {
  const actual = await countOf(page, selector)
  if (actual !== expected) throw new Error(`[${label}] ${selector} 数量应为 ${expected}，实际 ${actual}`)
}

/**
 * The text must be rendered AND inside the captured viewport, otherwise the screenshot misses it.
 * `scope` keeps ambiguous words (二进制 / 待补充验证 …) inside the intended container instead of
 * matching the first occurrence in the abstract.
 */
async function expectTextInViewport(page, text, label, scope) {
  const root = scope ? page.locator(scope) : page
  const locator = root.getByText(text, { exact: false })
  await locator.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    throw new Error(`[${label}] 未找到文本：${text}`)
  })
  const { height } = page.viewportSize()
  const count = await locator.count()
  const boxes = []
  for (let index = 0; index < Math.min(count, 30); index += 1) {
    const box = await locator.nth(index).boundingBox().catch(() => null)
    if (!box) continue
    boxes.push(box)
    if (box.y >= 0 && box.y + Math.min(box.height, 1) <= height) return locator.nth(index)
  }
  throw new Error(`[${label}] 文本“${text}”不在截图视口内：${JSON.stringify(boxes.slice(0, 3))}`)
}

async function expectTextExists(page, text, label) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    throw new Error(`[${label}] 未找到文本：${text}`)
  })
}

function normalizedText(value) {
  return value.replace(/\s+/g, ' ').trim()
}

/** Assert a visible container contains all needles; the container itself must be inside the capture. */
async function expectContainerText(page, container, needles, label) {
  const locator = (typeof container === 'string' ? page.locator(container) : container).first()
  await locator.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
    throw new Error(`[${label}] 未找到容器：${typeof container === 'string' ? container : '(locator)'}`)
  })
  const { height } = page.viewportSize()
  const box = await locator.boundingBox()
  if (!box || box.y < 0 || box.y + Math.min(box.height, 1) > height) {
    throw new Error(`[${label}] 容器不在截图视口内：${JSON.stringify(box)}`)
  }
  const text = normalizedText(await locator.innerText().catch(() => ''))
  for (const needle of needles) {
    if (!text.includes(needle)) throw new Error(`[${label}] 容器缺少文本“${needle}”，实际：${text.slice(0, 200)}`)
  }
  return locator
}

/** One entry per data type: fixture, output file, scroll target, and on-screen data assertions. */
const typeShots = [
  {
    fixture: 'type-metrics', file: 'type-01-metrics-kinds.png',
    scroll: ['.result-workspace-metric-band'],
    scrollTarget: '.result-workspace-metric-band（短内容底部对齐，保留成果标题与全部 6 项指标）',
    coverage: '数据类型：6 种 metric kind（value/comparison/status/target/text/auto→comparison）+ emphasis=primary，card 密度 3 列。',
    async verify(page, label) {
      await expectCount(page, '.result-metric', 6, label)
      const kinds = await page.evaluate(() => [...document.querySelectorAll('.result-metric')].map(element => element.getAttribute('data-kind')))
      for (const kind of ['value', 'comparison', 'status', 'target', 'text']) {
        if (!kinds.includes(kind)) throw new Error(`[${label}] 缺少 metric kind：${kind}（实际 ${kinds.join(', ')}）`)
      }
      if (kinds.includes('auto')) throw new Error(`[${label}] auto 未被解析，仍渲染为 auto`)
      const band = '.result-workspace-metric-band'
      for (const text of ['指标类型（6 种 kind）', '待发布', '已达标', '仅覆盖登录模块', '首轮 2.9%', '+0.9pp', '目标 95%']) {
        await expectTextInViewport(page, text, label, band)
      }
    },
  },
  {
    fixture: 'type-delivery', file: 'type-02-delivery-document.png',
    scroll: ['.result-workspace-delivery'],
    coverage: '数据类型：document artifacts ×3（Markdown content + versionId/version）+ documents section 精确同源 3 项 + 1 项未关联文档。',
    async verify(page, label) {
      await expectCount(page, '.result-deliverable', 3, label)
      await expectCount(page, '.result-workspace-doc-open', 3, label)
      for (const text of ['3 份交付文件', '需求说明', '接口文档', '验收记录']) {
        await expectTextInViewport(page, text, label, '.result-workspace-delivery')
      }
      for (const text of ['文档说明（未关联文件）', '交付文档（与上方同源）']) {
        await expectTextInViewport(page, text, label, '.result-workspace-detail')
      }
    },
  },
  {
    fixture: 'type-artifacts', file: 'type-03-artifacts-mixed.png',
    scroll: ['.result-workspace-delivery'],
    coverage: '数据类型：document / image（有效 URL + 空 URL）/ link（有效 URL + 空 URL）/ data（JSON content）+ gallery 3 项（含空 image 占位）。',
    async verify(page, label) {
      await expectCount(page, '.result-deliverable', 6, label)
      await expectCount(page, '.result-deliverable-media[data-placeholder="true"]', 1, label)
      await expectCount(page, '.result-deliverable-thumb', 1, label)
      await expectCount(page, '.result-workspace-gallery-item', 3, label)
      // Deterministic media: the one legal image must actually decode (same-origin asset), the empty
      // URL keeps the dashed placeholder, and both gallery images must be loaded before the capture.
      await page.waitForFunction(() => {
        const dialog = document.querySelector('dialog[open]')
        if (!dialog) return false
        const loaded = image => image.complete && image.naturalWidth > 0
        const thumbs = [...dialog.querySelectorAll('.result-deliverable-media img')]
        const gallery = [...dialog.querySelectorAll('.result-workspace-gallery-item img')]
        const placeholders = dialog.querySelectorAll('.result-deliverable-media[data-placeholder="true"]').length
        return placeholders === 1 && thumbs.length === 1 && loaded(thumbs[0])
          && gallery.length === 2 && gallery.every(loaded)
      }, null, { timeout: 15000 }).catch(() => {
        throw new Error(`[${label}] 图片未达到确定性状态（占位/缩略图/画廊解码失败）`)
      })
      for (const text of ['待补截图', '暂无图片可预览', '未提供可用链接', '回归用例数据']) {
        await expectTextInViewport(page, text, label, '.result-workspace-delivery')
      }
      await expectTextInViewport(page, '页面画廊（含空图占位）', label, '.result-workspace-detail')
    },
  },
  {
    fixture: 'type-review', file: 'type-04-review-checks-risks.png',
    scroll: ['.result-workspace-review'],
    coverage: '数据类型：checks 4 项（passed / pending / failed / stale 绑定旧 versionId）+ risks 3 项（high·open / medium·mitigating / low·closed）。',
    async verify(page, label) {
      const review = '.result-workspace-review'
      await expectCount(page, '.result-workspace-checks li', 4, label)
      await expectCount(page, '.result-workspace-checks li[data-status="stale"]', 1, label)
      await expectCount(page, '.result-workspace-risk', 3, label)
      const riskStates = await page.evaluate(() => [...document.querySelectorAll('.result-workspace-risk')]
        .map(element => `${element.getAttribute('data-level')}/${element.getAttribute('data-status')}`))
      for (const state of ['high/open', 'medium/mitigating', 'low/closed']) {
        if (!riskStates.includes(state)) throw new Error(`[${label}] 缺少风险组合 ${state}（实际 ${riskStates.join(', ')}）`)
      }
      // The stale check must keep its own message inside the stale row, not borrow the abstract wording.
      await expectContainerText(page, page.locator('.result-workspace-checks li[data-status="stale"]'),
        ['待补充验证', '原验证版本 type-review-doc-v1，当前版本 v2.0'], label)
      // Closed risks may sit in a native expandable group; open it so all three states are visible.
      const closedGroup = page.locator('.result-workspace-risk-closed summary')
      if (await closedGroup.count()) {
        await closedGroup.first().click()
        await page.waitForTimeout(200)
      }
      for (const text of ['共 4 项检查', '短信验证码频率限制待复核', '性能基线尚未覆盖冷启动', '旧版本文档已归档']) {
        await expectTextInViewport(page, text, label, review)
      }
      await expectContainerText(page, page.locator('.result-workspace-risk[data-level="low"]'),
        ['旧版本文档已归档', '已关闭'], label)
    },
  },
  {
    fixture: 'type-versions', file: 'type-05-versions-timeline.png',
    scroll: ['.result-workspace-record-versions', '.result-workspace-versions', '.result-version-timeline', '.result-workspace-version'],
    coverage: '数据类型：versions 3 项（draft / released / rolled-back）纵向时间线。',
    async verify(page, label) {
      await expectCount(page, '.result-workspace-version', 3, label)
      const states = await page.evaluate(() => [...document.querySelectorAll('.result-workspace-version')].map(element => element.getAttribute('data-status')))
      for (const status of ['draft', 'released', 'rolled-back']) {
        if (!states.includes(status)) throw new Error(`[${label}] 缺少版本状态：${status}（实际 ${states.join(', ')}）`)
      }
      for (const text of ['草稿', '已发布', '已回滚', '成果版本时间线（三种状态）']) {
        await expectTextInViewport(page, text, label)
      }
    },
  },
  {
    fixture: 'type-changes', file: 'type-06-changes-inline-diff.png',
    scroll: ['.result-workspace-detail .result-changes', '.result-changes', '.result-workspace-detail [data-kind="changes"]'],
    action: '点击第一条文件行展开行内 unified diff',
    coverage: '数据类型：changes 24 个文件（added / modified / deleted / renamed / binary / oversized），第一条就地展开真实 unified diff。',
    async verify(page, label) {
      await expectCount(page, '.result-change-row', 24, label)
      await expectTextInViewport(page, '已编辑 24 个文件', label, '.result-changes')
      // Ambiguous words are asserted inside the exact file row, never against the page abstract.
      await expectContainerText(page, page.locator('.result-change-row', { hasText: 'docs/login-flow.png' }),
        ['二进制'], label)
      await expectContainerText(page, page.locator('.result-change-row', { hasText: 'legacy-report.ts' }),
        ['较大文件'], label)
      await expectContainerText(page, page.locator('.result-change-row', { hasText: 'session.ts' }),
        ['原路径：src/features/auth/storage.ts'], label)
      await page.locator('.result-change-row').first().click()
      const diffLine = page.locator('.result-changes').getByText('AUTO_SUBMIT_GUARD', { exact: false }).first()
      await diffLine.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {
        throw new Error(`[${label}] 点击第一条文件行后未展开 diff 内容`)
      })
      const box = await diffLine.boundingBox()
      const { height } = page.viewportSize()
      if (!box || box.y < 0 || box.y + box.height > height) throw new Error(`[${label}] 行内 diff 不在截图视口内：${JSON.stringify(box)}`)
      const expanded = await countOf(page, '.result-change-row[aria-expanded="true"]')
      if (!expanded) throw new Error(`[${label}] 第一条文件行未进入展开态（aria-expanded=true）`)
    },
  },
  {
    fixture: 'type-fact', file: 'type-07-fact-mode.png',
    scroll: ['.result-workspace-detail'],
    coverage: '数据类型：说明型成果（无 artifacts、无 changes）——summary / verdict + 2 个 custom text section + decisions + next + note。',
    async verify(page, label) {
      await expectCount(page, '.result-workspace-delivery', 0, label)
      const mode = await page.evaluate(() => document.querySelector('.result-workspace')?.dataset.readingMode ?? '')
      if (mode !== 'fact') throw new Error(`[${label}] 阅读模式应为 fact，实际“${mode}”`)
      await expectCount(page, '.result-workspace-card[data-kind="custom"]', 2, label)
      await expectCount(page, '.result-workspace-decision', 2, label)
      for (const text of ['说明与结论', '背景与范围', '结论与依据']) {
        await expectTextInViewport(page, text, label, '.result-workspace-detail')
      }
      await expectTextExists(page, '本轮只提供结论与事实说明', label)
      await expectTextExists(page, '决策记录', label)
      await expectTextExists(page, '下一步', label)
      await expectTextExists(page, '前端验收 fixture，非真实业务数据。', label)
    },
  },
  {
    fixture: 'type-sections', file: 'type-08-sections-machinery.png',
    scroll: ['.result-workspace-detail'],
    scrollTarget: '.result-workspace-detail（api / environments / files 主体与 tests 标题同屏；tests 正文在 DOM 中断言）',
    coverage: '数据类型：api 3 行 / environments 4 种状态 / files 4 项 / tests（指标 + 进度 + 检查）区块机制。',
    async verify(page, label) {
      for (const kind of ['api', 'environments', 'files', 'tests']) {
        await expectCount(page, `.result-workspace-card[data-kind="${kind}"]`, 1, label)
      }
      await expectCount(page, '.result-workspace-file', 4, label)
      await expectCount(page, '.result-workspace-env', 4, label)
      await expectCount(page, '.result-workspace-card[data-kind="tests"] .result-workspace-checks li', 3, label)
      // The four blocks are stacked, so the last one starts near the fold; its header must still be
      // captured while its body is verified in the DOM to keep the coverage claim honest.
      for (const text of ['接口清单', '/api/auth/login', '运行环境', '本地开发', '附件清单', '登录页截图.png', '质量报告']) {
        await expectTextInViewport(page, text, label)
      }
      for (const text of ['回归测试进度', '主流程冒烟', '预发布', '旧版灰度', '灰度节点']) {
        await expectTextExists(page, text, label)
      }
    },
  },
]

async function captureTypeScreens(browser, context) {
  const page = await context.newPage()
  watchErrors(page, 'type-sample')
  // Deterministic media: any remaining external asset fails fast instead of racing the onError
  // fallback; the type-artifacts image URLs are same-origin runtime assets.
  await page.route('**://example.com/**', route => route.abort())
  for (const shot of typeShots) {
    const label = shot.file.replace(/\.png$/, '')
    await openPreview(page, `fixture=${shot.fixture}`)
    if (shot.top) await scrollToReaderTop(page, label)
    else await scrollBlockToTop(page, shot.scroll, label)
    if (shot.extraScroll) await nudgeScroll(page, shot.extraScroll, label)
    await shot.verify(page, label)
    await settle(page)
    await savePng(shot.file, await page.screenshot({ animations: 'disabled' }), {
      url: `${previewPath}?fixture=${shot.fixture}${shot.action ? `（${shot.action}）` : ''}`,
      viewport: `${desktopViewport.width}×${desktopViewport.height}`,
      dataSource: dataSources['frontend-fixture'], fixture: shot.fixture,
      coverage: shot.coverage,
      scrollTarget: shot.scrollTarget ?? (shot.scroll?.join(' 或 ') ?? '阅读器顶部'),
    })
  }
  await page.close()
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
  for (const name of fixtureNames) await run(`fixture=${name}`, fixtureSmokeExpectations[name])
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

  let browser, smoke, captureError
  try {
    browser = await launchBrowser()
    smoke = await smokeFixtures(browser)
    const desktopContext = await browser.newContext({ viewport: desktopViewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
    try {
      await captureHome(browser, desktopContext)
      await captureSampleFlow(browser, desktopContext)
      await captureHistoryFlow(browser, desktopContext)
      await captureTypeScreens(browser, desktopContext)
    } finally {
      await desktopContext.close()
    }
    await captureMobile(browser)
  } catch (error) {
    // A mid-run failure must still produce a manifest for the screenshots that did succeed.
    captureError = error
    log(`截图流程中断（已保存 ${captured.length} 张），将照常写出 manifest：${error instanceof Error ? error.message : String(error)}`)
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
    dataTypeSpec: 'docs/design/result-board/07-data-type-visual-system.md §5',
    note: 'DEV-ONLY 验收截图。数据来源逐张标注：真实样例为 sample JSON 的逐字节复制，其余为前端验收 fixture。type-01…type-08 为数据类型专用视觉样例，每张记录覆盖的数据类型。',
    dataSources,
    realSamples,
    fixtureSmoke: smoke ?? [],
    consoleErrors: browserErrors,
    interrupted: captureError ? String(captureError instanceof Error ? captureError.message : captureError) : null,
    screenshots: [...captured].sort((a, b) => a.file.localeCompare(b.file)),
  }
  await writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  log(`已写入 ${path.relative(root, path.join(outputDir, 'manifest.json'))}`)
  if (captureError) throw captureError
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
