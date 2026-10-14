import { spawn, spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = path.dirname(fileURLToPath(import.meta.url))
const officeRoot = path.resolve(here, '..', '..')
const workspaceRoot = path.dirname(officeRoot)
const openpawRoot = path.resolve(process.env.OPENPAW_E2E_SOURCE_ROOT || path.join(workspaceRoot, 'openpaw_merge'))
const hostBinary = path.resolve(process.env.OPENPAW_E2E_HOST_BINARY || path.join(openpawRoot, 'target-windows', 'debug', 'openpaw.exe'))
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-office-subagent-'))
const home = path.join(runtimeRoot, 'openpaw-home')
const workspace = path.join(runtimeRoot, 'workspace')
const stateDirectory = path.join(runtimeRoot, 'office-state')
const screenshotPath = path.join(officeRoot, 'test-results', `subagent-workspaces-${Date.now()}.png`)
const children = []
let browser

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const assert = (condition, message) => { if (!condition) throw new Error(message) }

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error('failed to reserve loopback port')
  return port
}

function start(name, command, args, cwd, env = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  child.output = () => output
  child.name = name
  children.push(child)
  return child
}

async function stop(child) {
  if (!child || child.exitCode != null) return
  const exited = new Promise((resolve) => child.once('close', resolve))
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  else child.kill('SIGTERM')
  await Promise.race([exited, sleep(3000)])
}

function browserExecutable() {
  const candidates = process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium']
  return candidates.find((candidate) => existsSync(candidate))
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { response, body }
}

function postJson(url, body) {
  return requestJson(url, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

async function waitFor(check, label, timeout = 20_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try { return await check() } catch (error) { lastError = error; await sleep(80) }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError || 'timeout')}`)
}

async function waitHealthy(origin, route, child) {
  await waitFor(async () => {
    if (child.exitCode != null) throw new Error(`${child.name} exited: ${child.output().slice(-800)}`)
    const result = await requestJson(`${origin}${route}`)
    assert(result.response.ok, `HTTP ${result.response.status}`)
    return result
  }, `${child.name} startup`)
}

function startGateway(port, hostOrigin, webOrigin) {
  return start('gateway', process.execPath, [path.join(officeRoot, 'scripts', 'action-gateway.mjs')], officeRoot, {
    OFFICE_ACTION_GATEWAY_PORT: String(port),
    OFFICE_ALLOWED_ORIGINS: webOrigin,
    OPENPAW_ENGINE_HOST_URL: hostOrigin,
    OPENPAW_DEFAULT_PROVIDER: 'mock',
    OPENPAW_HOME: home,
    OPENPAW_OFFICE_WORKSPACE: workspace,
    AI_OFFICE_STATE_DIR: stateDirectory,
  })
}

async function createConversation(gatewayOrigin, title) {
  const created = await postJson(`${gatewayOrigin}/office/conversations`, { title, provider: 'mock', model: 'mock-1' })
  assert(created.response.status === 201, `create returned ${created.response.status}: ${JSON.stringify(created.body)}`)
  return created.body.session.id
}

async function run() {
  await Promise.all([home, workspace, stateDirectory, path.dirname(screenshotPath)].map((directory) => fs.mkdir(directory, { recursive: true })))
  await fs.writeFile(path.join(workspace, 'README.md'), '# subagent system fixture\n', 'utf8')
  const [hostPort, gatewayPort, webPort] = await Promise.all([freePort(), freePort(), freePort()])
  const hostOrigin = `http://127.0.0.1:${hostPort}`
  const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`
  const webOrigin = `http://127.0.0.1:${webPort}`

  let gateway = startGateway(gatewayPort, hostOrigin, webOrigin)
  await waitHealthy(gatewayOrigin, '/health', gateway)
  const host = start('host', hostBinary, ['--engine-host', '--engine-host-port', String(hostPort), '--provider', 'mock', '--home', home, '--workspace', workspace], openpawRoot, {
    OPENPAW_ENGINE_MOCK: 'delegate_multi',
    OPENPAW_OFFICE_ACTIONS_URL: `${gatewayOrigin}/actions`,
  })
  await waitHealthy(hostOrigin, '/global/health', host)
  const vite = start('vite', process.execPath, [path.join(officeRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort', '--clearScreen', 'false', '--logLevel', 'silent'], officeRoot, {
    VITE_OFFICE_HTTP_ACTIONS_URL: `${gatewayOrigin}/actions`,
  })
  await waitHealthy(webOrigin, '/', vite)

  const sessionA = await createConversation(gatewayOrigin, 'Subagent Session A')
  const accepted = await postJson(`${gatewayOrigin}/office/conversations/${sessionA}/messages`, { parts: [{ type: 'text', text: 'delegate a research task' }] })
  assert(accepted.response.status === 202, `prompt returned ${accepted.response.status}`)
  const spacesA = await waitFor(async () => {
    const result = await requestJson(`${gatewayOrigin}/office/workspaces?sessionId=${sessionA}`)
    assert(result.response.ok && Array.isArray(result.body), 'workspace response is invalid')
    assert(result.body.length === 4, `expected 4 workspaces, got ${result.body.length}`)
    assert(result.body.filter((item) => item.kind === 'subagent' && item.parentWorkspaceId === sessionA).length === 3, 'three child workspaces are required')
    return result.body
  }, 'real child workspace registration', 30_000)
  const childrenA = spacesA.filter((item) => item.kind === 'subagent')
  assert(new Set(childrenA.map((item) => item.id)).size === 3, 'child workspace ids must be unique')
  await waitFor(async () => {
    const status = await requestJson(`${gatewayOrigin}/office/conversations/${sessionA}/status`)
    assert(status.response.ok && !status.body?.[sessionA], 'parent turn is still active')
  }, 'parent turn completion')
  const settledSpacesA = await waitFor(async () => {
    const settled = await requestJson(`${gatewayOrigin}/office/workspaces?sessionId=${sessionA}`)
    assert(settled.response.ok, 'settled workspace response is invalid')
    assert(settled.body.every((item) => item.agents.every((agent) => agent.state === 'idle')), 'completed workspaces must release all agent states')
    const children = settled.body.filter((item) => item.kind === 'subagent')
    assert(children.every((item) => item.outputs?.some((output) => output.kind === 'model' && !output.streaming && output.text?.trim())), 'every child workspace must retain final model output')
    return settled.body
  }, 'child workspace state cleanup', 10_000)
  const firstChildModelText = settledSpacesA
    .find((item) => item.id === childrenA[0].id)
    ?.outputs?.find((output) => output.kind === 'model')?.text
  assert(firstChildModelText?.trim(), 'first child model output is empty')

  const sessionB = await createConversation(gatewayOrigin, 'Main-only Session B')
  const spacesB = await requestJson(`${gatewayOrigin}/office/workspaces?sessionId=${sessionB}`)
  assert(spacesB.response.ok && spacesB.body.length === 1 && spacesB.body[0].kind === 'main', 'empty conversation must have only its main workspace')

  const childArtifacts = []
  for (const child of childrenA) {
    const result = await requestJson(`${gatewayOrigin}/office/conversations/${sessionA}/artifacts?workspaceId=${encodeURIComponent(child.id)}`)
    assert(result.response.ok, `artifact query failed for ${child.id}`)
    childArtifacts.push(...result.body)
  }
  assert(childArtifacts.length === 3, `expected 3 real child artifacts, got ${childArtifacts.length}`)
  assert(new Set(childArtifacts.map((item) => item.path)).size === 3, 'child artifacts must keep independent paths')
  assert(childArtifacts.every((item) => childrenA.some((child) => child.id === item.workspaceId)), 'artifact workspace ownership is invalid')

  browser = await chromium.launch({ headless: true, executablePath: browserExecutable(), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.addInitScript(() => window.sessionStorage.clear())
  await page.goto(webOrigin)
  await page.getByRole('button', { name: '\u5bf9\u8bdd\u4e2d\u5fc3' }).click()
  const officeToggle = page.getByRole('button', { name: '\u663e\u793a\u529e\u516c\u5ba4' })
  if (await officeToggle.count()) await officeToggle.click()
  const sessions = page.getByRole('combobox', { name: '\u6700\u8fd1\u5bf9\u8bdd' })
  await sessions.waitFor({ state: 'visible' })
  await sessions.selectOption(sessionA)
  for (const child of childrenA) await page.getByRole('button', { name: child.name, exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '\u7a7a\u95f4\u603b\u89c8', exact: true }).click()
  await page.locator('.agent-space-card').first().waitFor({ state: 'visible' })
  assert(await page.locator('.agent-space-card').count() === 4, 'browser did not render main and three child office cards')
  const firstChildCard = page.locator('.agent-space-card').filter({ hasText: childrenA[0].name })
  await firstChildCard.getByRole('button', { name: new RegExp(`查看${childrenA[0].name}输出`) }).click()
  const childOutputDialog = page.getByRole('dialog', { name: `${childrenA[0].name}输出记录` })
  await childOutputDialog.waitFor({ state: 'visible' })
  assert((await childOutputDialog.textContent())?.includes(firstChildModelText), 'browser child output panel does not show model text')
  await childOutputDialog.getByRole('button', { name: '关闭输出记录' }).click()
  await waitFor(async () => {
    const canvases = page.locator('.agent-space-card canvas')
    assert(await canvases.count() === 4, 'all office scenes must mount a canvas')
    const sizes = await canvases.evaluateAll((items) => items.map((canvas) => ({ width: canvas.width, height: canvas.height })))
    assert(sizes.every((size) => size.width > 0 && size.height > 0), 'office canvas has no rendered pixels')
  }, 'browser office canvas rendering', 30_000)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await page.locator('.workspace-list').getByRole('button', { name: '\u6211\u7684\u7a7a\u95f4', exact: true }).click()
  await sessions.selectOption(sessionB)
  await waitFor(async () => assert(await page.getByRole('button', { name: childrenA[0].name, exact: true }).count() === 0, 'child workspace leaked into session B'), 'browser session isolation')

  await stop(gateway)
  gateway = startGateway(gatewayPort, hostOrigin, webOrigin)
  await waitHealthy(gatewayOrigin, '/health', gateway)
  const restored = await waitFor(async () => {
    const result = await requestJson(`${gatewayOrigin}/office/workspaces?sessionId=${sessionA}`)
    assert(result.response.ok && result.body.length === 4, `restored workspace count=${result.body?.length}`)
    return result.body
  }, 'gateway restart workspace recovery')
  const restoredArtifacts = []
  for (const child of childrenA) {
    const result = await requestJson(`${gatewayOrigin}/office/conversations/${sessionA}/artifacts?workspaceId=${encodeURIComponent(child.id)}`)
    assert(result.response.ok, `restored artifact query failed for ${child.id}`)
    restoredArtifacts.push(...result.body)
  }
  assert(restoredArtifacts.length === 3, 'gateway restart lost child artifact ownership')
  await page.getByRole('combobox', { name: '\u6700\u8fd1\u5bf9\u8bdd' }).selectOption(sessionA)
  await page.getByRole('button', { name: childrenA[0].name, exact: true }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: childrenA[0].name, exact: true }).click()
  const shelf = page.getByRole('button', { name: /打开当前协作空间的产物货架，共 1 项产物/ })
  await shelf.waitFor({ state: 'visible' })
  await shelf.click()
  await page.getByRole('dialog', { name: '产物清单' }).waitFor({ state: 'visible' })
  await page.getByRole('dialog', { name: '产物清单' }).locator('.artifact-category-group button').first().click()
  await page.getByRole('main', { name: /查看产物/ }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: '关闭产物' }).click()

  console.log(JSON.stringify({ status: 'passed', sessionA, sessionB, childWorkspaceIds: childrenA.map((item) => item.id), artifactPaths: childArtifacts.map((item) => item.path), restoredWorkspaceCount: restored.length, screenshotPath }, null, 2))
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  for (const child of children) if (child.output?.()) console.error(`[${child.name}] ${child.output().slice(-1200)}`)
  process.exitCode = 1
}).finally(async () => {
  if (browser) await browser.close().catch(() => {})
  for (const child of [...children].reverse()) await stop(child)
  if (!process.exitCode) await fs.rm(runtimeRoot, { recursive: true, force: true }).catch(() => {})
  else console.error(`failed runtime retained: ${runtimeRoot}`)
  const exitCode = process.exitCode || 0
  setTimeout(() => process.exit(exitCode), 0)
})
