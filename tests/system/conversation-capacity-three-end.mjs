/**
 * 功能：在真实 Host + Gateway 链路验证进程级回合容量、FIFO 排队和队满边界。
 * 约束：只使用隔离临时目录与随机回环端口，不触碰用户正在运行的三端服务。
 * 说明：Provider 使用 OpenPaw 内置延迟流，仅用于稳定制造可观测的运行窗口；
 *       HTTP、调度、JSONL、Gateway 代理和终态对账仍走真实进程。
 */
import { spawn, spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const officeRoot = path.resolve(here, '..', '..')
const workspaceRoot = path.dirname(officeRoot)
const openpawRoot = path.resolve(process.env.OPENPAW_E2E_SOURCE_ROOT || path.join(workspaceRoot, 'openpaw_merge'))
const hostBinary = path.resolve(process.env.OPENPAW_E2E_HOST_BINARY || path.join(openpawRoot, 'target-windows', 'debug', 'openpaw.exe'))
const runtimeRoot = path.join(os.tmpdir(), `ai-office-capacity-${process.pid}-${Date.now()}`)
const openpawHome = path.join(runtimeRoot, 'openpaw-home')
const officeWorkspace = path.join(runtimeRoot, 'office-workspace')
const officeState = path.join(runtimeRoot, 'office-state')
const reportPath = path.resolve(process.env.OPENPAW_CAPACITY_REPORT || path.join(workspaceRoot, '_diagnostics', `capacity-${process.pid}.json`))
const evidence = { schema: 'ai-office-capacity-evidence-v1', startedAt: new Date().toISOString(), status: 'running', failures: [] }
let host
let gateway

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function processIsRunning(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function freePort() {
  const server = createNetServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error('随机端口分配失败')
  return port
}

function start(name, command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  child.output = () => output
  child.once('error', (error) => { evidence.failures.push({ scope: name, message: error.message }) })
  return child
}

async function stop(child) {
  if (!child || child.exitCode != null) return
  const exited = new Promise((resolve) => child.once('close', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, sleep(1000)])
  if (child.exitCode != null || !processIsRunning(child.pid)) return
  const killed = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  if (killed.status !== 0 && processIsRunning(child.pid)) throw new Error(`无法回收测试子进程 PID ${child.pid}`)
  await Promise.race([exited, sleep(3000)])
  if (processIsRunning(child.pid)) throw new Error(`测试子进程 PID ${child.pid} 未在超时内退出`)
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

async function waitFor(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { return await check() } catch (error) { last = error; await sleep(30) }
  }
  throw new Error(`${label}：${last?.message || '超时'}`)
}

async function main() {
  if (process.platform !== 'win32') throw new Error('本测试要求 Windows taskkill 进程回收语义')
  await fs.mkdir(openpawHome, { recursive: true })
  await fs.mkdir(officeWorkspace, { recursive: true })
  await fs.mkdir(officeState, { recursive: true })
  await fs.writeFile(path.join(officeWorkspace, 'README.md'), '# capacity fixture\n', 'utf8')
  const hostPort = await freePort()
  const gatewayPort = await freePort()
  const hostOrigin = `http://127.0.0.1:${hostPort}`
  const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`
  gateway = start('gateway', process.execPath, [path.join(officeRoot, 'scripts', 'action-gateway.mjs')], officeRoot, {
    OPENPAW_HOME: openpawHome,
    OPENPAW_OFFICE_WORKSPACE: officeWorkspace,
    OFFICE_ACTION_GATEWAY_PORT: String(gatewayPort),
    OPENPAW_ENGINE_HOST_URL: hostOrigin,
    OPENPAW_DEFAULT_PROVIDER: 'mock',
    AI_OFFICE_STATE_DIR: officeState,
  })
  await waitFor(async () => { const result = await requestJson(`${gatewayOrigin}/health`); if (!result.response.ok) throw new Error(`Gateway ${result.response.status}`); return result }, 'Gateway 启动')
  host = start('host', hostBinary, ['--engine-host', '--engine-host-port', String(hostPort), '--provider', 'mock', '--home', openpawHome, '--workspace', officeWorkspace], openpawRoot, {
    OPENPAW_ENGINE_MOCK: 'stream',
    OPENPAW_MAX_CONCURRENT_TURNS: '4',
    OPENPAW_MAX_QUEUED_TURNS: '32',
    OPENPAW_OFFICE_ACTIONS_URL: `${gatewayOrigin}/actions`,
  })
  await waitFor(async () => { const result = await requestJson(`${hostOrigin}/global/health`); if (!result.response.ok) throw new Error(`Host ${result.response.status}`); return result }, 'Host 启动')

  const sessionIds = []
  for (let index = 0; index < 37; index += 1) {
    const created = await postJson(`${gatewayOrigin}/office/conversations`, { title: `capacity-${index + 1}` })
    if (created.response.status !== 201) throw new Error(`创建 session ${index + 1} 返回 ${created.response.status}`)
    sessionIds.push(created.body.session.id)
  }
  const firstFour = await Promise.all(sessionIds.slice(0, 4).map((sessionId, index) => postJson(`${gatewayOrigin}/office/conversations/${sessionId}/messages`, { parts: [{ type: 'text', text: `running-${index + 1}` }] })))
  if (firstFour.some((result) => result.response.status !== 202)) throw new Error('前四个运行回合未全部接受')
  await waitFor(async () => {
    const result = await requestJson(`${hostOrigin}/session/status`)
    const busy = Object.values(result.body || {}).filter((value) => value?.type === 'busy').length
    if (busy !== 4) throw new Error(`当前 busy=${busy}`)
    return result
  }, '四个运行槽可观测')

  const queuedResults = await Promise.all(sessionIds.slice(4, 36).map((sessionId, index) => postJson(`${gatewayOrigin}/office/conversations/${sessionId}/messages`, { parts: [{ type: 'text', text: `queued-${index + 1}` }] })))
  if (queuedResults.some((result) => result.response.status !== 202)) throw new Error('32 个排队回合未全部接受')
  const queueSnapshot = await waitFor(async () => {
    const result = await requestJson(`${hostOrigin}/session/status`)
    const queued = Object.values(result.body || {}).filter((value) => value?.type === 'queued')
    if (queued.length !== 32) throw new Error(`当前 queued=${queued.length}`)
    if (queued.some((value) => !Number.isInteger(value.queuePosition))) throw new Error('排队回合缺少 queuePosition')
    return result.body
  }, '32 个排队回合可观测')

  const rejected = await postJson(`${gatewayOrigin}/office/conversations/${sessionIds[36]}/messages`, { parts: [{ type: 'text', text: 'queue-overflow' }] })
  if (rejected.response.status !== 429 || rejected.body?.code !== 'queue_full') throw new Error(`第 37 个回合未按 queue_full 拒绝：${rejected.response.status} ${JSON.stringify(rejected.body)}`)
  await waitFor(async () => {
    const result = await requestJson(`${hostOrigin}/session/status`)
    if (Object.keys(result.body || {}).length !== 36) throw new Error(`活动状态数量为 ${Object.keys(result.body || {}).length}`)
    return result
  }, '队列容量闭合')

  await waitFor(async () => {
    const states = await Promise.all(sessionIds.slice(0, 36).map(async (sessionId) => {
      const result = await requestJson(`${hostOrigin}/session/${sessionId}/turns`)
      if (result.response.status !== 200 || !Array.isArray(result.body)) throw new Error(`turns ${sessionId} 返回异常`)
      return result.body[0]?.state
    }))
    if (states.some((state) => state !== 'completed')) throw new Error(`未全部完成：${states.filter((state) => state !== 'completed').length}`)
    return states
  }, '36 个回合最终收敛', 60_000)

  evidence.status = 'passed'
  evidence.finishedAt = new Date().toISOString()
  evidence.ports = { hostPort, gatewayPort }
  evidence.capacity = { running: 4, queued: 32, rejectedRequest: 37, accepted: 36, completed: 36, rejectedStatus: rejected.response.status, rejectedCode: rejected.body.code, queuePositions: Object.values(queueSnapshot).filter((value) => value?.type === 'queued').map((value) => value.queuePosition).sort((a, b) => a - b) }
  console.log(`PASS capacity: 4 running + 32 queued + request 37 rejected; 36 completed`)
}

main().catch((error) => {
  evidence.status = 'failed'
  evidence.finishedAt = new Date().toISOString()
  evidence.failures.push({ scope: 'system', message: error instanceof Error ? error.message : String(error), hostLog: host?.output?.().slice(-1000), gatewayLog: gateway?.output?.().slice(-1000) })
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
}).finally(async () => {
  try {
    await stop(host)
    await stop(gateway)
    await fs.mkdir(path.dirname(reportPath), { recursive: true })
    await fs.writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    await fs.rm(runtimeRoot, { recursive: true, force: true }).catch(() => {})
    console.log(`EVIDENCE report: ${reportPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  }
  const exitCode = process.exitCode || 0
  setTimeout(() => process.exit(exitCode), 0)
})
