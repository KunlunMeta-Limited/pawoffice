/**
 * 功能：在唯一临时目录中启动受控 Host、Gateway、Vite 和 Playwright，并可靠回收本轮资源。
 * 输入输出边界：输入为 Playwright CLI 参数；输出为测试日志、失败工件和进程退出码。
 * 设计约束：每轮 home/workspace/profile/端口均隔离；shell 就绪与数据就绪分开探测。
 * 安全边界：只终止本轮申请的回环端口监听者；成功后删除临时目录，失败时保留证据。
 * 关联：`CHG-2026-0014`、`BLK-14`、`BLK-22`、`TEST-AIOFFICE-E2E-001`。
 */
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer, connect } from 'node:net'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const children = []
const ownedPorts = []
const mockTimers = new Set()
let mockHost
let shuttingDown = false
let interrupted = false
let failed = true

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

/** 向操作系统申请一个临时回环端口，关闭探针后交给受控服务使用。 */
async function reserveFreePort() {
  const probe = createNetServer()
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolveListen)
  })
  const address = probe.address()
  if (!address || typeof address === 'string') throw new Error('无法分配 E2E 回环端口')
  const port = Number(address.port)
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()))
  ownedPorts.push(port)
  return port
}

/** 启动受控子进程并保留名称，便于启动失败时给出明确诊断。 */
function start(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  })
  child.e2eName = name
  children.push(child)
  return child
}

/** 等待 HTTP 条件成立；子进程提前退出时立即失败，不把退出误报成超时。 */
async function waitForHttp(url, label, validate, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = '尚未收到响应'
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`${label} 进程提前退出：code=${child.exitCode ?? ''} signal=${child.signalCode ?? ''}`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
      const text = await response.text()
      if (response.ok && await validate(response, text)) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await delay(120)
  }
  throw new Error(`${label} 未在 ${timeoutMs}ms 内就绪：${url}；最后错误：${lastError}`)
}

/** 创建只覆盖 E2E 所需协议的确定性 Host，避免任务用例连接用户或残留服务。 */
async function startMockHost(port) {
  const sessions = new Map()
  let sessionSequence = 0
  let turnSequence = 0
  const send = (res, status, body = null) => {
    const text = body == null ? '' : JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(text)
  }
  mockHost = createHttpServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method === 'GET' && url.pathname === '/global/health') { send(res, 200, { ok: true }); return }
    if (req.method === 'GET' && url.pathname === '/permission') { send(res, 200, []); return }
    if (req.method === 'GET' && url.pathname === '/session/status') {
      send(res, 200, Object.fromEntries([...sessions].filter(([, item]) => item.active).map(([id, item]) => [id, {
        type: 'busy', turnID: item.turnID, userMessageID: item.userMessageID,
      }])))
      return
    }
    if (req.method === 'GET' && url.pathname === '/session') {
      send(res, 200, [...sessions.values()].map((item) => item.summary))
      return
    }
    if (req.method === 'POST' && url.pathname === '/session') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        let payload = {}
        try { payload = raw ? JSON.parse(raw) : {} } catch { payload = {} }
        const id = `e2e-host-${++sessionSequence}`
        const now = Date.now()
        const summary = { id, title: payload.title || 'E2E Host', provider: 'mock', model: 'mock', createdAt: now, updatedAt: now }
        sessions.set(id, { summary, active: false, turnID: '', userMessageID: '', messages: [], turns: [] })
        send(res, 201, summary)
      })
      return
    }
    const match = url.pathname.match(/^\/session\/([^/]+)\/(prompt_async|abort|message|turns)$/)
    if (match) {
      const sessionId = decodeURIComponent(match[1])
      const action = match[2]
      const item = sessions.get(sessionId)
      if (!item) { req.resume(); req.on('end', () => send(res, 404, { error: '会话不存在' })); return }
      if (req.method === 'GET' && action === 'message') { send(res, 200, item.messages); return }
      if (req.method === 'GET' && action === 'turns') { send(res, 200, item.turns); return }
      if (req.method === 'POST' && action === 'abort') {
        item.active = false
        if (item.turnID && !item.turns.some((turn) => turn.turnID === item.turnID)) {
          item.turns.push({ turnID: item.turnID, userMessageID: item.userMessageID, state: 'cancelled', completedAt: Date.now(), error: { code: 'cancelled', retryable: false } })
        }
        req.resume(); req.on('end', () => send(res, 204)); return
      }
      if (req.method === 'POST' && action === 'prompt_async') {
        if (item.active) { req.resume(); req.on('end', () => send(res, 409, { error: '当前会话已有活动回合' })); return }
        let raw = ''
        req.on('data', (chunk) => { raw += chunk })
        req.on('end', () => {
          let payload = {}
          try { payload = raw ? JSON.parse(raw) : {} } catch { payload = {} }
          const text = Array.isArray(payload.parts) ? payload.parts.filter((part) => part?.type === 'text').map((part) => part.text || '').join('') : ''
          const currentSequence = ++turnSequence
          const turnID = `e2e-turn-${currentSequence}`
          const userMessageID = `e2e-user-${currentSequence}`
          const assistantMessageID = `e2e-assistant-${currentSequence}`
          item.turnID = turnID
          item.userMessageID = userMessageID
          item.active = true
          item.messages.push({ info: { id: userMessageID, sessionID: sessionId, role: 'user', turnID }, parts: [{ type: 'text', text }] })
          const timer = setTimeout(() => {
            mockTimers.delete(timer)
            item.messages.push({ info: { id: assistantMessageID, sessionID: sessionId, role: 'assistant', turnID }, parts: [{ type: 'text', text: 'E2E 任务已完成' }] })
            item.turns.push({ turnID, userMessageID, state: 'completed', completedAt: Date.now() })
            item.active = false
          }, 80)
          mockTimers.add(timer)
          send(res, 204)
        })
        return
      }
    }
    const deleteMatch = req.method === 'DELETE' ? url.pathname.match(/^\/session\/([^/]+)$/) : null
    if (deleteMatch) {
      sessions.delete(decodeURIComponent(deleteMatch[1]))
      send(res, 204)
      return
    }
    send(res, 404, { error: 'not found' })
  })
  await new Promise((resolveListen, reject) => {
    mockHost.once('error', reject)
    mockHost.listen(port, '127.0.0.1', resolveListen)
  })
}

/** 判断回环端口是否仍被监听。 */
function isPortOpen(port) {
  return new Promise((resolveOpen) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolveOpen(true) })
    socket.once('error', () => resolveOpen(false))
    socket.setTimeout(500, () => { socket.destroy(); resolveOpen(false) })
  })
}

/** Windows 下按父进程树强制回收；其他平台先 TERM，超时再 KILL。 */
async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit').catch(() => undefined)
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
  await Promise.race([exited, delay(2500)])
  if (child.exitCode === null && child.signalCode === null && process.platform !== 'win32') child.kill('SIGKILL')
  await Promise.race([exited, delay(1000)])
}

/** 仅对本轮申请且仍监听的端口执行兜底回收，防止 Windows 孙进程残留。 */
async function reclaimOwnedPorts() {
  if (process.platform !== 'win32') return
  const openPorts = []
  for (const port of ownedPorts) if (await isPortOpen(port)) openPorts.push(port)
  if (openPorts.length === 0) return
  const ports = openPorts.join(',')
  const command = `$ports=@(${ports}); Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, stdio: 'ignore' })
  await delay(300)
}

/** 测试成功后尽力删除浏览器临时目录；Windows 文件句柄延迟释放不得反向判定功能失败。 */
async function removeRuntimeRoot(runtimeRoot) {
  try {
    await fs.rm(runtimeRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  } catch (error) {
    console.warn(`[E2E] 测试已通过，但临时目录稍后需由系统清理：${runtimeRoot}`, error)
  }
}

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of [...children].reverse()) await stopChild(child)
  for (const timer of mockTimers) clearTimeout(timer)
  mockTimers.clear()
  if (mockHost) {
    const closing = new Promise((resolveClose) => mockHost.close(() => resolveClose()))
    mockHost.closeIdleConnections?.()
    mockHost.closeAllConnections?.()
    await Promise.race([closing, delay(2500)])
    mockHost = undefined
  }
  await reclaimOwnedPorts()
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true
    void shutdown()
  })
}

let exitCode = 1
let runtimeRoot = ''
try {
  runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-office-e2e-'))
  const openpawHome = path.join(runtimeRoot, 'openpaw-home')
  const officeWorkspace = path.join(runtimeRoot, 'office-workspace')
  const officeState = path.join(runtimeRoot, 'office-state')
  const profileRoot = path.join(runtimeRoot, 'browser-profile')
  const outputRoot = path.join(runtimeRoot, 'playwright-output')
  await Promise.all([openpawHome, officeWorkspace, officeState, profileRoot, outputRoot].map((directory) => fs.mkdir(directory, { recursive: true })))
  await fs.writeFile(path.join(officeWorkspace, 'README.md'), '# isolated E2E workspace\n', 'utf8')

  const hostPort = await reserveFreePort()
  const gatewayPort = Number(process.env.OFFICE_ACTION_GATEWAY_PORT || await reserveFreePort())
  const vitePort = Number(process.env.OFFICE_E2E_VITE_PORT || await reserveFreePort())
  const hostOrigin = `http://127.0.0.1:${hostPort}`
  const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`
  const viteOrigin = `http://127.0.0.1:${vitePort}`

  await startMockHost(hostPort)
  await waitForHttp(`${hostOrigin}/global/health`, 'Host 数据服务', async (_response, text) => JSON.parse(text)?.ok === true)

  const gateway = start('Gateway', process.execPath, ['scripts/action-gateway.mjs'], {
    OFFICE_ACTION_GATEWAY_PORT: String(gatewayPort),
    OFFICE_ALLOWED_ORIGINS: viteOrigin,
    OPENPAW_ENGINE_HOST_URL: hostOrigin,
    OPENPAW_DEFAULT_PROVIDER: 'mock',
    OPENPAW_HOME: openpawHome,
    OPENPAW_OFFICE_WORKSPACE: officeWorkspace,
    AI_OFFICE_STATE_DIR: officeState,
  })
  await waitForHttp(`${gatewayOrigin}/health`, 'Gateway shell', async (_response, text) => JSON.parse(text)?.ok === true, gateway)
  await waitForHttp(`${gatewayOrigin}/office/agents`, 'Gateway data', async (_response, text) => Array.isArray(JSON.parse(text)) && JSON.parse(text).length === 6, gateway)

  const vite = start('Vite', process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort', '--clearScreen', 'false'], {
    VITE_OFFICE_HTTP_ACTIONS_URL: `${gatewayOrigin}/actions`,
  })
  await waitForHttp(viteOrigin, 'Vite shell', async (_response, text) => text.includes('<div id="root"></div>'), vite)

  const runner = start('Playwright', process.execPath, ['node_modules/playwright/cli.js', 'test', ...process.argv.slice(2)], {
    OFFICE_E2E_MANAGED_SERVERS: '1',
    OFFICE_ACTION_GATEWAY_PORT: String(gatewayPort),
    OFFICE_E2E_VITE_PORT: String(vitePort),
    OFFICE_E2E_RUN_ROOT: runtimeRoot,
    OFFICE_E2E_OUTPUT_DIR: outputRoot,
    TEMP: profileRoot,
    TMP: profileRoot,
    TMPDIR: profileRoot,
  })
  const [code, signal] = await once(runner, 'exit')
  exitCode = interrupted || signal ? 130 : code ?? 1
  failed = exitCode !== 0
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : error)
  exitCode = 1
  failed = true
} finally {
  await shutdown()
  if (runtimeRoot) {
    if (failed) console.error(`[E2E] 失败工件已保留：${runtimeRoot}`)
    else await removeRuntimeRoot(runtimeRoot)
  }
}

process.exit(exitCode)
