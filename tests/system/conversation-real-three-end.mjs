import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { waitForStableTurn } from './conversation-observation.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const officeRoot = path.resolve(here, '..', '..')
const workspaceRoot = path.dirname(officeRoot)
const openpawRoot = path.resolve(process.env.OPENPAW_E2E_SOURCE_ROOT || path.join(workspaceRoot, 'openpaw_merge'))
const hostCandidates = [
  path.join(openpawRoot, 'target-windows', 'debug', 'openpaw.exe'),
  path.join(openpawRoot, 'target', 'debug', process.platform === 'win32' ? 'openpaw.exe' : 'openpaw'),
]
let hostBinary = ''
const runtimeRoot = path.join(os.tmpdir(), `ai-office-real-three-end-${process.pid}-${Date.now()}`)
const openpawHome = path.join(runtimeRoot, 'openpaw-home')
const officeWorkspace = path.join(runtimeRoot, 'office-workspace')
const officeState = path.join(runtimeRoot, 'office-state')
const reportPath = path.resolve(process.env.OPENPAW_E2E_REPORT || path.join(officeRoot, 'test-results', `conversation-real-three-end-${process.pid}-${Date.now()}.json`))
const configuredProvider = String(process.env.OPENPAW_E2E_PROVIDER || 'mock').trim().toLowerCase()
const configuredModel = process.env.OPENPAW_E2E_MODEL || process.env.OPENPAW_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o'
const configuredBaseUrl = process.env.OPENPAW_E2E_BASE_URL || process.env.OPENPAW_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || ''
const configuredApiKey = process.env.OPENPAW_E2E_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || ''
const configuredStressTurns = Math.max(0, Number.parseInt(process.env.OPENPAW_E2E_TURNS || '0', 10) || 0)
const configuredStressSessions = Math.max(1, Number.parseInt(process.env.OPENPAW_E2E_SESSIONS || '8', 10) || 8)
const configuredStressWorkers = Math.max(1, Number.parseInt(process.env.OPENPAW_E2E_WORKERS || '4', 10) || 4)
const configuredHostRunning = Math.max(1, Number.parseInt(process.env.OPENPAW_E2E_HOST_RUNNING || String(configuredStressWorkers), 10) || configuredStressWorkers)
const configuredHostQueued = Math.max(0, Number.parseInt(process.env.OPENPAW_E2E_HOST_QUEUED || String(configuredStressSessions), 10) || configuredStressSessions)
const runFaultScenarios = process.env.OPENPAW_E2E_FAULTS !== '0'
const runProjectionScenario = process.env.OPENPAW_E2E_PROJECTION !== '0'
const keepRuntime = process.env.OPENPAW_E2E_KEEP_RUNTIME === '1'
const logs = []
const evidence = {
  schema: 'ai-office-conversation-evidence-v1',
  startedAt: new Date().toISOString(),
  reportPath,
  provider: configuredProvider,
  model: configuredModel,
  baseUrlConfigured: Boolean(configuredBaseUrl),
  apiKeyConfigured: Boolean(configuredApiKey),
  stress: {
    turns: configuredStressTurns,
    sessions: configuredStressSessions,
    clientWorkers: configuredStressWorkers,
    hostRunning: configuredHostRunning,
    hostQueued: configuredHostQueued,
  },
  phases: [],
  turns: [],
  failures: [],
}
let host
let gateway
let vite
let browser
let failed = false
let runError

/** 计算文件 SHA-256，绑定系统测试使用的 Host 二进制和源码输入。 */
async function sha256File(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

/**
 * 功能：计算影响 engine-host 构建的当前源码指纹。
 * 范围：Cargo.lock、工作区清单、CLI/engine-host 及其直接运行依赖 crate 的 Rust/清单文件。
 * 返回：按相对路径排序后对“路径、文件哈希”再次计算的稳定 SHA-256。
 * 约束：指纹只证明输入一致，不自行声称二进制由这些输入构建。
 */
async function currentHostSourceFingerprint() {
  const roots = [
    'Cargo.lock',
    'Cargo.toml',
    'crates/openpaw-cli',
    'crates/openpaw-core',
    'crates/openpaw-engine',
    'crates/openpaw-engine-host',
    'crates/openpaw-llm',
    'crates/openpaw-memory',
    'crates/openpaw-store',
    'crates/openpaw-tools',
  ]
  const files = []
  async function collect(relative) {
    const absolute = path.join(openpawRoot, relative)
    const stat = await fs.stat(absolute)
    if (stat.isFile()) {
      if (relative === 'Cargo.lock' || relative.endsWith('Cargo.toml') || relative.endsWith('.rs')) files.push(relative.split(path.sep).join('/'))
      return
    }
    for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
      if (entry.name === 'target' || entry.name === 'target-windows' || entry.name === '.git') continue
      await collect(path.join(relative, entry.name))
    }
  }
  for (const root of roots) await collect(root)
  files.sort()
  const digest = createHash('sha256')
  for (const relative of files) {
    digest.update(relative)
    digest.update('\0')
    digest.update(await sha256File(path.join(openpawRoot, relative)))
    digest.update('\n')
  }
  return digest.digest('hex')
}

/**
 * 功能：验证 Host 构建身份清单，禁止系统测试静默复用未知旧二进制。
 * 清单：默认与二进制同路径并追加 `.build-manifest.json`，也可由环境变量显式指定。
 * 必填：`binarySha256` 和 `sourceFingerprint` 必须分别匹配当前二进制与当前源码。
 */
async function verifyHostBuildIdentity(binary) {
  const manifestPath = process.env.OPENPAW_E2E_HOST_MANIFEST || `${binary}.build-manifest.json`
  assert(existsSync(manifestPath), `Host 构建身份清单缺失：${manifestPath}；拒绝复用无法证明来自当前源码的二进制`)
  let manifest
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) } catch (error) {
    throw new Error(`Host 构建身份清单无法解析：${manifestPath}；${error instanceof Error ? error.message : String(error)}`)
  }
  const [binarySha256, sourceFingerprint] = await Promise.all([
    sha256File(binary),
    currentHostSourceFingerprint(),
  ])
  assert(manifest?.binarySha256 === binarySha256, `Host 二进制 SHA-256 与构建清单不一致：${binary}`)
  assert(manifest?.sourceFingerprint === sourceFingerprint, 'Host 构建清单的源码指纹与当前 OpenPaw 源码不一致，请重新构建并生成身份清单')
  console.log(`PASS identity: Host binary ${binarySha256.slice(0, 12)} / source ${sourceFingerprint.slice(0, 12)}`)
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
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error('failed to allocate a loopback port')
  return port
}

function start(name, command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  child.output = () => output
  child.once('error', (error) => { logs.push(`${name} spawn error: ${error.message}`) })
  return child
}

async function stop(child) {
  if (!child || child.exitCode != null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
  await Promise.race([new Promise((resolve) => child.once('close', resolve)), sleep(3000)])
  if (child.exitCode == null) child.kill('SIGKILL')
}

async function waitFor(check, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  let lastError
  while (Date.now() < deadline) {
    try {
      return await check()
    } catch (error) {
      lastError = error
      await sleep(40)
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError || 'timeout')}`)
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  return { response, body }
}

function postJson(url, body) {
  return requestJson(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function recordPhase(name, status, detail = {}) {
  const entry = { name, status, at: new Date().toISOString(), ...detail }
  evidence.phases.push(entry)
  console.log(`${status === 'passed' ? 'PASS' : status === 'blocked' ? 'BLOCKED' : 'INFO'} phase: ${name}`)
  return entry
}

function recordFailure(scope, error, detail = {}) {
  const entry = {
    scope,
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
    ...detail,
  }
  evidence.failures.push(entry)
  return entry
}

async function writeEvidenceReport(status, error = undefined) {
  evidence.status = status
  evidence.finishedAt = new Date().toISOString()
  evidence.runtimeRoot = runtimeRoot
  if (error) recordFailure('system', error)
  await fs.mkdir(path.dirname(reportPath), { recursive: true })
  await fs.writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  console.log(`EVIDENCE report: ${reportPath}`)
}

function percentile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

function messageText(message) {
  return (message?.parts || []).filter((part) => part?.type === 'text').map((part) => part.text || '').join('')
}

function assistantTextForTurn(items, terminal) {
  if (!Array.isArray(items) || !terminal?.userMessageID) return ''
  const userIndex = items.findIndex((item) => item?.info?.role === 'user' && item?.info?.id === terminal.userMessageID)
  if (userIndex < 0) return ''
  const chunks = []
  for (let index = userIndex + 1; index < items.length; index += 1) {
    const item = items[index]
    const text = messageText(item)
    if (item?.info?.role === 'user' && text.trim()) break
    if (item?.info?.role !== 'assistant') continue
    if (item.info.turnID && item.info.turnID !== terminal.turnID) continue
    if (text.trim()) chunks.push(text)
  }
  return chunks.join('')
}

async function waitHealthy(origin, pathName, label, processRef) {
  return waitFor(async () => {
    if (processRef?.exitCode != null) throw new Error(`${label} exited with ${processRef.exitCode}: ${processRef.output().slice(-500)}`)
    const result = await requestJson(`${origin}${pathName}`)
    if (!result.response.ok) throw new Error(`HTTP ${result.response.status}`)
    return result
  }, label, 20_000)
}

async function createSession(gatewayOrigin, title, options = {}) {
  const result = await postJson(`${gatewayOrigin}/office/conversations`, {
    title,
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.requestID ? { requestID: options.requestID } : {}),
  })
  assert(result.response.status === 201, `create ${title} returned ${result.response.status}: ${JSON.stringify(result.body)}`)
  return result.body.session.id
}

async function sendMessage(gatewayOrigin, sessionId, text, requestID = undefined) {
  return postJson(`${gatewayOrigin}/office/conversations/${encodeURIComponent(sessionId)}/messages`, {
    parts: [{ type: 'text', text }],
    ...(requestID ? { requestID } : {}),
  })
}

async function waitIdle(gatewayOrigin, sessionId, timeout = 15_000) {
  return waitFor(async () => {
    const result = await requestJson(`${gatewayOrigin}/office/conversations/${encodeURIComponent(sessionId)}/status`)
    if (!result.response.ok) throw new Error(`status ${result.response.status}`)
    if (result.body?.[sessionId]) throw new Error(`still ${result.body[sessionId].type}`)
    return result
  }, `wait session ${sessionId} idle`, timeout)
}

async function messages(gatewayOrigin, sessionId) {
  const result = await requestJson(`${gatewayOrigin}/office/conversations/${encodeURIComponent(sessionId)}/messages`)
  assert(result.response.status === 200 && Array.isArray(result.body), `messages ${sessionId} returned ${result.response.status}`)
  return result.body
}

async function hostTurns(hostOrigin, sessionId) {
  const result = await requestJson(`${hostOrigin}/session/${encodeURIComponent(sessionId)}/turns`)
  assert(result.response.status === 200 && Array.isArray(result.body), `Host turns ${sessionId} returned ${result.response.status}`)
  return result.body
}

async function observeTurn(gatewayOrigin, hostOrigin, sessionId, turnID = '') {
  const [gatewayResult, turnsResult, hostMessagesResult] = await Promise.allSettled([
    messages(gatewayOrigin, sessionId),
    hostTurns(hostOrigin, sessionId),
    requestJson(`${hostOrigin}/session/${encodeURIComponent(sessionId)}/message`),
  ])
  assert(turnsResult.status === 'fulfilled', `Host turns unavailable for ${sessionId}: ${turnsResult.reason}`)
  assert(hostMessagesResult.status === 'fulfilled', `Host messages unavailable for ${sessionId}: ${hostMessagesResult.reason}`)
  const turns = turnsResult.value
  const hostMessagesResponse = hostMessagesResult.value
  assert(hostMessagesResponse.response.status === 200 && Array.isArray(hostMessagesResponse.body), `Host messages ${sessionId} returned ${hostMessagesResponse.response.status}`)
  assert(gatewayResult.status === 'fulfilled', `Gateway messages unavailable for ${sessionId}: ${gatewayResult.reason}`)
  const gatewayMessages = gatewayResult.value
  assert(Array.isArray(gatewayMessages), `Gateway messages ${sessionId} returned a non-array body`)
  assert(turnID, `观测 ${sessionId} 缺少请求 turnID`)
  const target = turns.find((turn) => turn?.turnID === turnID)
  assert(target, `Host turns ${sessionId} 未找到请求 turnID ${turnID}`)
  const targetTurnID = target.turnID
  const hostAssistantText = assistantTextForTurn(hostMessagesResponse.body, target)
  const gatewayAssistantText = assistantTextForTurn(gatewayMessages, target)
  const hostAssistant = Boolean(hostAssistantText.trim())
  const gatewayAssistant = Boolean(gatewayAssistantText.trim())
  const gatewayError = gatewayMessages.find((item) => item?.info?.role === 'system'
    && item?.info?.kind === 'error'
    && (!targetTurnID || item?.info?.turnID === targetTurnID))
  const gatewayCancelled = gatewayMessages.find((item) => item?.info?.role === 'system'
    && item?.info?.kind === 'cancelled'
    && (!targetTurnID || item?.info?.turnID === targetTurnID))
  return {
    turnID: target.turnID,
    targetUserMessageID: target.userMessageID || null,
    hostState: target.state || 'missing',
    hostErrorCode: target.error?.code || null,
    hostAssistant,
    gatewayAssistant,
    hostAssistantHash: hostAssistantText ? hashText(hostAssistantText) : null,
    gatewayAssistantHash: gatewayAssistantText ? hashText(gatewayAssistantText) : null,
    hostAssistantLength: hostAssistantText.length,
    gatewayAssistantLength: gatewayAssistantText.length,
    replacementCharacterCount: (hostAssistantText.match(/\uFFFD/g) || []).length,
    gatewayErrorText: gatewayError ? messageText(gatewayError) : null,
    gatewayCancelledText: gatewayCancelled ? messageText(gatewayCancelled) : null,
    gatewayReadError: gatewayResult.status === 'rejected' ? String(gatewayResult.reason) : null,
    hostMessageCount: hostMessagesResponse.body.length,
    gatewayMessageCount: gatewayMessages.length,
  }
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function waitAndRecordTurn(gatewayOrigin, hostOrigin, sessionId, turnID, expectedStates = ['completed']) {
  try {
    await waitIdle(gatewayOrigin, sessionId, 120_000)
    const stable = await waitForStableTurn(
      () => observeTurn(gatewayOrigin, hostOrigin, sessionId, turnID),
      { expectedStates, expectedTurnID: turnID, timeoutMs: 120_000 },
    )
    const observation = stable.observation
    const evidenceEntry = { sessionId, requestedTurnID: turnID, ...observation, stability: stable.stability }
    evidence.turns.push(evidenceEntry)
    return { ...observation, evidenceEntry }
  } catch (error) {
    const failureEntry = {
      sessionId,
      requestedTurnID: turnID || null,
      expectedStates,
      failure: error instanceof Error ? error.message : String(error),
      failureCode: error?.code || null,
    }
    if (error?.lastObservation) Object.assign(failureEntry, error.lastObservation)
    if (error?.stability) failureEntry.stability = error.stability
    evidence.turns.push(failureEntry)
    throw error
  }
}

async function startProviderFixture(mode) {
  let requestCount = 0
  const server = createHttpServer(async (req, res) => {
    if (!req.url?.endsWith('/chat/completions')) {
      res.writeHead(404); res.end('not found'); return
    }
    requestCount += 1
    if (mode === '429') {
      const body = JSON.stringify({ error: { status: 429, type: 'rate_limit_error', message: 'synthetic rate limit' } })
      res.writeHead(429, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    if (mode === 'timeout') {
      const body = JSON.stringify({ error: { status: 408, type: 'timeout', message: 'synthetic timeout' } })
      res.writeHead(408, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
      res.end(body)
      return
    }
    if (mode === 'protocol') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
      res.end()
      return
    }
    const requestBody = await new Promise((resolve) => {
      let raw = ''
      req.setEncoding('utf8')
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
      })
    })
    const prompt = Array.isArray(requestBody?.messages)
      ? requestBody.messages.findLast((message) => message?.role === 'user')?.content
      : ''
    const promptText = typeof prompt === 'string'
      ? prompt
      : Array.isArray(prompt)
        ? prompt.filter((part) => part?.type === 'text').map((part) => part.text || '').join('')
        : JSON.stringify(prompt || '')
    const marker = promptText.match(/DEEPSEEK_STRESS_\d+/)?.[0] || 'FIXTURE_RESPONSE'
    const body = `data: {"choices":[{"delta":{"content":"fixture response ${marker}"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(body)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  assert(port, `provider fixture ${mode} did not bind a port`)
  return { server, baseUrl: `http://127.0.0.1:${port}/v1`, requestCount: () => requestCount }
}

async function startProjectionFailureFixture() {
  let requestCount = 0
  const server = createHttpServer((req, res) => {
    requestCount += 1
    req.resume()
    req.on('end', () => {
      res.writeHead(503, { 'content-type': 'application/json' })
      res.end('{"error":"synthetic projection failure"}')
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  assert(port, 'projection failure fixture did not bind a port')
  return { server, actionsUrl: `http://127.0.0.1:${port}/actions`, requestCount: () => requestCount }
}

async function closeServer(server) {
  if (!server) return
  await new Promise((resolve) => server.close(() => resolve()))
}

async function runProjectionIsolation(gatewayOrigin, hostOrigin, hostPort) {
  if (!runProjectionScenario) {
    recordPhase('office projection failure isolation', 'skipped', { reason: 'OPENPAW_E2E_PROJECTION=0' })
    return
  }
  const fixture = await startProjectionFailureFixture()
  try {
    await stop(host)
    host = startHost(hostPort, gatewayOrigin, 'stream', '', { officeActionsUrl: fixture.actionsUrl })
    await waitHealthy(hostOrigin, '/global/health', 'projection isolation host startup', host)
    const sessionId = await createSession(gatewayOrigin, 'Projection failure isolation')
    const accepted = await sendMessage(gatewayOrigin, sessionId, '动画投影失败不应影响 Host 回合', `projection-${Date.now()}`)
    assert(accepted.response.status === 202, `projection isolation request returned ${accepted.response.status}`)
    const observation = await waitAndRecordTurn(gatewayOrigin, hostOrigin, sessionId, accepted.body?.turnID)
    assert(fixture.requestCount() > 0, 'Host did not attempt Office action projection')
    assert(observation.hostState === 'completed', `Host failed when only Office projection was unavailable: ${JSON.stringify(observation)}`)
    assert(observation.hostAssistant, `Host assistant message missing during projection failure: ${JSON.stringify(observation)}`)
    assert(observation.gatewayAssistant, `Gateway message view masked a successful Host turn: ${JSON.stringify(observation)}`)
    assert(observation.hostAssistantHash === observation.gatewayAssistantHash, `Gateway message projection changed Host output: ${JSON.stringify(observation)}`)
    recordPhase('office projection failure isolation', 'passed', {
      classification: 'projection_failed_host_succeeded',
      projectionAttempts: fixture.requestCount(),
      hostState: observation.hostState,
      hostAssistant: observation.hostAssistant,
      gatewayAssistant: observation.gatewayAssistant,
    })
  } finally {
    await closeServer(fixture.server)
    await stop(host)
    host = startHost(hostPort, gatewayOrigin)
    await waitHealthy(hostOrigin, '/global/health', 'projection isolation recovery', host)
  }
}

async function runFaultMatrix(gatewayOrigin, hostOrigin, hostPort) {
  if (!runFaultScenarios) {
    recordPhase('provider fault observability', 'skipped', { reason: 'OPENPAW_E2E_FAULTS=0' })
    return
  }
  try {
    const scenarios = [
      { mode: '429', code: 'provider_rate_limited', gatewayText: '请求过于频繁', maxAttempts: 2 },
      { mode: 'timeout', code: 'provider_timeout', gatewayText: '响应超时', maxAttempts: 4 },
      { mode: 'protocol', code: 'provider_protocol_error', gatewayText: '不完整响应', maxAttempts: 1 },
    ]
    for (const scenario of scenarios) {
      const fixture = await startProviderFixture(scenario.mode)
      try {
        await stop(host)
        host = startHost(hostPort, gatewayOrigin, '', '', {
          provider: 'openai',
          apiKey: 'fixture-key',
          baseUrl: fixture.baseUrl,
          officeActionsUrl: `${gatewayOrigin}/actions`,
        })
        await waitHealthy(hostOrigin, '/global/health', `${scenario.mode} fixture host startup`, host)
        const sessionId = await createSession(gatewayOrigin, `${scenario.mode} observability`, { provider: 'openai', model: 'fixture-model' })
        const accepted = await sendMessage(gatewayOrigin, sessionId, `${scenario.mode} 应记录 Host 失败码`, `fault-${scenario.mode}-${Date.now()}`)
        assert(accepted.response.status === 202, `${scenario.mode} fixture request returned ${accepted.response.status}`)
        const observation = await waitAndRecordTurn(gatewayOrigin, hostOrigin, sessionId, accepted.body?.turnID, ['failed'])
        assert(observation.hostErrorCode === scenario.code, `Host did not expose ${scenario.code}: ${JSON.stringify(observation)}`)
        assert(observation.gatewayErrorText?.includes(scenario.gatewayText), `Gateway did not project ${scenario.mode}: ${JSON.stringify(observation)}`)
        assert(fixture.requestCount() >= 1 && fixture.requestCount() <= scenario.maxAttempts, `${scenario.mode} unexpected upstream attempts: ${fixture.requestCount()}`)
        recordPhase(`${scenario.mode} fault observability`, 'passed', {
          classification: 'host_failed_gateway_projected',
          upstreamAttempts: fixture.requestCount(),
          hostErrorCode: observation.hostErrorCode,
          gatewayErrorText: observation.gatewayErrorText,
        })
      } finally {
        await closeServer(fixture.server)
      }
    }
  } finally {
    await stop(host)
    host = startHost(hostPort, gatewayOrigin)
    await waitHealthy(hostOrigin, '/global/health', 'post-fault host recovery', host)
  }
}

async function runDeepSeekStress(gatewayOrigin, hostOrigin, hostPort) {
  const phaseName = `OpenAI-compatible ${configuredStressTurns}-turn stress`
  if (configuredStressTurns <= 0) {
    recordPhase(phaseName, 'skipped', { reason: 'OPENPAW_E2E_TURNS is 0' })
    return
  }
  if (!['deepseek', 'openai'].includes(configuredProvider)) {
    recordPhase(phaseName, 'blocked', { reason: `provider=${configuredProvider}; use OPENPAW_E2E_PROVIDER=deepseek` })
    return
  }
  const useLocalFixture = process.env.OPENPAW_E2E_LOCAL_FIXTURE === '1'
  if (!useLocalFixture && (!configuredApiKey || !configuredBaseUrl)) {
    recordPhase(phaseName, 'blocked', { reason: 'missing API key or OpenAI-compatible base URL; no real request was sent' })
    return
  }
  let fixture
  let stressBaseUrl = configuredBaseUrl
  if (useLocalFixture) {
    fixture = await startProviderFixture('success')
    stressBaseUrl = fixture.baseUrl
  }
  await stop(host)
  host = startHost(hostPort, gatewayOrigin, '', '', {
    provider: 'openai',
    apiKey: useLocalFixture ? 'fixture-key' : configuredApiKey,
    baseUrl: stressBaseUrl,
    model: configuredModel,
    concurrency: { running: configuredHostRunning, queued: configuredHostQueued },
  })
  await waitHealthy(hostOrigin, '/global/health', 'DeepSeek-compatible host startup', host)
  const sessionCount = Math.min(configuredStressSessions, configuredStressTurns)
  const latencies = []
  const perSessionCompleted = Array(sessionCount).fill(0)
  let maxBusy = 0
  let maxQueued = 0
  let stopSampling = false
  const sampler = (async () => {
    while (!stopSampling) {
      try {
        const status = await requestJson(`${hostOrigin}/session/status`)
        if (status.response.ok && status.body && typeof status.body === 'object') {
          const values = Object.values(status.body)
          maxBusy = Math.max(maxBusy, values.filter((item) => item?.type === 'busy').length)
          maxQueued = Math.max(maxQueued, values.filter((item) => item?.type === 'queued').length)
        }
      } catch {}
      await sleep(50)
    }
  })()
  try {
    const sessions = await Promise.all(Array.from({ length: sessionCount }, (_, index) => createSession(
      gatewayOrigin,
      `DeepSeek stress ${index + 1}`,
      { provider: 'openai', model: configuredModel, requestID: `stress-create-${Date.now()}-${index}` },
    )))
    const sessionJobs = sessions.map((sessionId, sessionIndex) => ({ sessionId, sessionIndex, nextLocalIndex: 0 }))
    let nextTurn = 0
    let completed = 0
    let failedTurns = 0
    const runWorker = async (workerIndex) => {
      while (true) {
        const job = sessionJobs.shift()
        if (!job) return
        const turnIndex = nextTurn
        nextTurn += 1
        if (turnIndex >= configuredStressTurns) return
        const localIndex = job.nextLocalIndex
        job.nextLocalIndex += 1
        const marker = `DEEPSEEK_STRESS_${turnIndex + 1}`
        const text = `请处理这个长难句并在回答中原样保留标记 ${marker}：在多会话并行、页面切换、刷新恢复、Provider 限流、超时和取消可能同时发生的情况下，系统必须保持当前会话上下文、消息顺序、UTF-8 完整性、唯一终态和可追踪错误，不得把 Gateway 动画投影失败误报为 Host 回合失败；请分成“约束识别、风险分析、执行步骤、验证结论”四部分回答，并逐项覆盖并发隔离、同会话顺序、长文本完整性、错误持久化和办公室动画旁路。答复中禁止输出 Unicode 替换字符，也不要展示该字符本身。当前为第 ${turnIndex + 1} 次独立回合。${'复杂条件、中文、emoji 😀、标点；'.repeat(24)}`
        const startedAt = Date.now()
        try {
          const accepted = await sendMessage(gatewayOrigin, job.sessionId, text, `stress-${job.sessionIndex}-${localIndex}-${turnIndex}`)
          assert(accepted.response.status === 202, `stress turn ${turnIndex + 1} accepted with ${accepted.response.status}: ${JSON.stringify(accepted.body)}`)
          const observation = await waitAndRecordTurn(gatewayOrigin, hostOrigin, job.sessionId, accepted.body?.turnID)
          const elapsedMs = Date.now() - startedAt
          const sessionMessages = await messages(gatewayOrigin, job.sessionId)
          const userFound = sessionMessages.some((item) => item?.info?.role === 'user' && messageText(item) === text)
          const targetTurn = (await hostTurns(hostOrigin, job.sessionId)).find((turn) => turn?.turnID === accepted.body?.turnID)
          const assistantText = assistantTextForTurn(sessionMessages, targetTurn)
          assert(userFound, `stress user message ${turnIndex + 1} was not persisted exactly`)
          assert(observation.hostState === 'completed', `stress turn ${turnIndex + 1} Host state=${observation.hostState}`)
          assert(observation.hostAssistant && observation.gatewayAssistant, `stress turn ${turnIndex + 1} missing assistant projection`)
          assert(observation.hostAssistantHash === observation.gatewayAssistantHash, `stress turn ${turnIndex + 1} Host/Gateway hashes differ`)
          assert(observation.replacementCharacterCount === 0, `stress turn ${turnIndex + 1} contains UTF-8 replacement characters`)
          assert(assistantText.includes(marker), `stress turn ${turnIndex + 1} did not preserve marker ${marker}`)
          observation.evidenceEntry.stress = {
            index: turnIndex + 1,
            sessionIndex: job.sessionIndex,
            localIndex,
            workerIndex,
            elapsedMs,
            promptHash: hashText(text),
            userLength: text.length,
            markerPreserved: true,
          }
          latencies.push(elapsedMs)
          perSessionCompleted[job.sessionIndex] += 1
          completed += 1
          if (nextTurn < configuredStressTurns) sessionJobs.push(job)
        } catch (error) {
          failedTurns += 1
          recordFailure('deepseek-stress', error, { sessionId: job.sessionId, worker: workerIndex, sessionIndex: job.sessionIndex, turnIndex: turnIndex + 1 })
          throw error
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(configuredStressWorkers, sessions.length) }, (_, index) => runWorker(index)))
    assert(completed === configuredStressTurns && failedTurns === 0, `DeepSeek stress incomplete: ${completed}/${configuredStressTurns}, failed=${failedTurns}`)
    assert(perSessionCompleted.every((count) => count > 0), `not every session received a turn: ${perSessionCompleted.join(',')}`)
    recordPhase(phaseName, 'passed', {
      turns: completed,
      sessions: sessionCount,
      clientWorkers: Math.min(configuredStressWorkers, sessions.length),
      hostRunning: configuredHostRunning,
      hostQueued: configuredHostQueued,
      observedMaxBusy: maxBusy,
      observedMaxQueued: maxQueued,
      perSessionCompleted,
      latencyMs: {
        min: Math.min(...latencies),
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        max: Math.max(...latencies),
      },
    })
  } finally {
    stopSampling = true
    await sampler
    await stop(host)
    await closeServer(fixture?.server)
    host = startHost(hostPort, gatewayOrigin)
    await waitHealthy(hostOrigin, '/global/health', 'post-DeepSeek mock host recovery', host)
  }
}

function startHost(hostPort, gatewayOrigin, mockMode = 'stream', permissions = '', options = {}) {
  const provider = options.provider || 'mock'
  const concurrency = options.concurrency || { running: 2, queued: 8 }
  return start('host', hostBinary, [
    '--engine-host',
    '--engine-host-port', String(hostPort),
    '--provider', provider,
    '--home', openpawHome,
    '--workspace', officeWorkspace,
  ], openpawRoot, {
    ...(mockMode ? { OPENPAW_ENGINE_MOCK: mockMode } : {}),
    OPENPAW_ENGINE_PERMISSIONS: permissions,
    OPENPAW_MAX_CONCURRENT_TURNS: String(concurrency.running),
    OPENPAW_MAX_QUEUED_TURNS: String(concurrency.queued),
    OPENPAW_OFFICE_ACTIONS_URL: options.officeActionsUrl || `${gatewayOrigin}/actions`,
    ...(provider === 'openai' ? {
      OPENAI_API_KEY: options.apiKey || configuredApiKey,
      OPENPAW_OPENAI_MODEL: options.model || configuredModel,
      OPENPAW_OPENAI_BASE_URL: options.baseUrl || configuredBaseUrl,
    } : {}),
  })
}

function startGateway(gatewayPort, hostOrigin, webOrigin, options = {}) {
  return start('gateway', process.execPath, [path.join(officeRoot, 'scripts', 'action-gateway.mjs')], officeRoot, {
    OPENPAW_HOME: openpawHome,
    OPENPAW_OFFICE_WORKSPACE: officeWorkspace,
    OFFICE_ACTION_GATEWAY_PORT: String(gatewayPort),
    OPENPAW_ENGINE_HOST_URL: hostOrigin,
    OPENPAW_DEFAULT_PROVIDER: options.defaultProvider || 'mock',
    OFFICE_ALLOWED_ORIGINS: webOrigin,
    AI_OFFICE_STATE_DIR: officeState,
  })
}

function startVite(webPort, gatewayOrigin) {
  return start('vite', process.execPath, [
    path.join(officeRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host', '127.0.0.1',
    '--port', String(webPort),
    '--strictPort',
    '--clearScreen', 'false',
    '--logLevel', 'silent',
  ], officeRoot, {
    VITE_OFFICE_HTTP_ACTIONS_URL: `${gatewayOrigin}/actions`,
  })
}

async function run() {
  const requestedHostBinary = process.env.OPENPAW_E2E_HOST_BINARY
  const resolvedHostBinary = requestedHostBinary
    ? path.resolve(requestedHostBinary)
    : hostCandidates.find((candidate) => existsSync(candidate)) || ''
  assert(resolvedHostBinary, `missing engine-host binary: ${hostCandidates.join(', ')}`)
  assert(existsSync(resolvedHostBinary), `configured engine-host binary does not exist: ${resolvedHostBinary}`)
  hostBinary = resolvedHostBinary
  await verifyHostBuildIdentity(hostBinary)

  await fs.mkdir(openpawHome, { recursive: true })
  await fs.mkdir(officeWorkspace, { recursive: true })
  await fs.mkdir(officeState, { recursive: true })
  await fs.writeFile(path.join(officeWorkspace, 'README.md'), '# isolated system test\n', 'utf8')
  const hostPort = await freePort()
  const gatewayPort = await freePort()
  const webPort = await freePort()
  const hostOrigin = `http://127.0.0.1:${hostPort}`
  const gatewayOrigin = `http://127.0.0.1:${gatewayPort}`
  const webOrigin = `http://127.0.0.1:${webPort}`

  gateway = startGateway(gatewayPort, hostOrigin, webOrigin, { defaultProvider: 'mock' })
  await waitHealthy(gatewayOrigin, '/health', 'gateway startup', gateway)
  host = startHost(hostPort, gatewayOrigin)
  await waitHealthy(hostOrigin, '/global/health', 'host startup', host)
  vite = startVite(webPort, gatewayOrigin)
  await waitHealthy(webOrigin, '/', 'vite startup', vite)

  recordPhase('runtime startup', 'passed', {
    hostOrigin,
    gatewayOrigin,
    webOrigin,
    provider: configuredProvider,
    model: configuredModel,
    baseUrlConfigured: Boolean(configuredBaseUrl),
    apiKeyConfigured: Boolean(configuredApiKey),
  })

  const sessionA = await createSession(gatewayOrigin, 'System A')
  const sessionB = await createSession(gatewayOrigin, 'System B')
  const sessionC = await createSession(gatewayOrigin, 'System Queue')
  const textA = '\u4f1a\u8bdd A \u4fdd\u6301\u72ec\u7acb'
  const textB = '\u4f1a\u8bdd B \u4fdd\u6301\u72ec\u7acb'
  const [acceptedA, acceptedB] = await Promise.all([
    sendMessage(gatewayOrigin, sessionA, textA),
    sendMessage(gatewayOrigin, sessionB, textB),
  ])
  assert(acceptedA.response.status === 202 && acceptedB.response.status === 202, 'A/B were not accepted independently')
  await waitFor(async () => {
    const result = await requestJson(`${hostOrigin}/session/status`)
    assert(result.body?.[sessionA]?.type === 'busy' && result.body?.[sessionB]?.type === 'busy', 'A/B are not concurrently busy')
  }, 'A/B concurrent status')
  const duplicate = await sendMessage(gatewayOrigin, sessionA, 'duplicate')
  assert(duplicate.response.status === 409, `same-session conflict returned ${duplicate.response.status}`)
  const queued = await sendMessage(gatewayOrigin, sessionC, '\u6392\u961f\u4f1a\u8bdd')
  assert(queued.response.status === 202, `queued session returned ${queued.response.status}`)
  await waitFor(async () => {
    const result = await requestJson(`${hostOrigin}/session/status`)
    assert(result.body?.[sessionC]?.type === 'queued', 'C is not queued')
    assert(result.body?.[sessionC]?.queuePosition === 1, `unexpected queue position ${result.body?.[sessionC]?.queuePosition}`)
  }, 'queue position')
  await Promise.all([waitIdle(gatewayOrigin, sessionA), waitIdle(gatewayOrigin, sessionB), waitIdle(gatewayOrigin, sessionC)])
  const [messagesA, messagesB] = await Promise.all([messages(gatewayOrigin, sessionA), messages(gatewayOrigin, sessionB)])
  assert(messagesA.some((item) => item.info?.role === 'user' && messageText(item) === textA), 'A user text missing')
  assert(messagesB.some((item) => item.info?.role === 'user' && messageText(item) === textB), 'B user text missing')
  assert(!messagesA.some((item) => messageText(item) === textB) && !messagesB.some((item) => messageText(item) === textA), 'A/B messages crossed sessions')
  console.log('PASS api: A/B parallel, same-session 409, queued promotion')

  const multiTurnSession = await createSession(gatewayOrigin, 'Multi-turn recovery')
  for (const [index, text] of ['第一轮先完成', '第二轮不能被误判为频繁请求', '第三轮继续可用'].entries()) {
    const accepted = await sendMessage(gatewayOrigin, multiTurnSession, text)
    assert(accepted.response.status === 202, `multi-turn ${index + 1} returned ${accepted.response.status}`)
    assert(accepted.body?.turnID, `multi-turn ${index + 1} has no turnID`)
    await waitIdle(gatewayOrigin, multiTurnSession)
  }
  const multiTurnMessages = await messages(gatewayOrigin, multiTurnSession)
  for (const text of ['第一轮先完成', '第二轮不能被误判为频繁请求', '第三轮继续可用']) {
    assert(multiTurnMessages.some((item) => item.info?.role === 'user' && messageText(item) === text), `multi-turn user text missing: ${text}`)
  }
  assert(multiTurnMessages.filter((item) => item.info?.role === 'assistant').length >= 3, 'multi-turn assistant replies missing')
  console.log('PASS api: same-session first, second and third turns complete')

  const longSession = await createSession(gatewayOrigin, 'UTF-8 long sentence')
  const complexText = ('\u957f\u96be\u53e5\uff1a\u5f53\u7cfb\u7edf\u540c\u65f6\u5904\u7406\u4e2d\u6587\u3001emoji \ud83d\ude00\u3001\u6362\u884c\n\u3001\u5f15\u53f7 "quoted" \u548c\u53cd\u659c\u6760 \\ \u65f6\uff0c\u5fc5\u987b\u9010\u5b57\u4fdd\u5b58\u3002').repeat(70)
  const longAccepted = await sendMessage(gatewayOrigin, longSession, complexText)
  assert(longAccepted.response.status === 202, `long UTF-8 returned ${longAccepted.response.status}`)
  await waitIdle(gatewayOrigin, longSession)
  const longMessages = await messages(gatewayOrigin, longSession)
  const storedLong = longMessages.find((item) => item.info?.role === 'user')
  assert(messageText(storedLong) === complexText, `UTF-8 changed: expected ${complexText.length}, actual ${messageText(storedLong).length}`)
  console.log(`PASS api: UTF-8 long sentence preserved (${complexText.length} UTF-16 code units)`)

  const cancelSession = await createSession(gatewayOrigin, 'Cancel real turn')
  assert((await sendMessage(gatewayOrigin, cancelSession, '\u8bf7\u505c\u6b62\u8fd9\u4e00\u8f6e')).response.status === 202, 'cancel turn was not accepted')
  await waitFor(async () => {
    const result = await requestJson(`${hostOrigin}/session/status`)
    assert(result.body?.[cancelSession]?.type === 'busy', 'cancel session is not busy')
  }, 'cancel session busy')
  const aborted = await postJson(`${gatewayOrigin}/office/conversations/${cancelSession}/abort`, {})
  assert(aborted.response.ok, `abort returned ${aborted.response.status}`)
  await waitIdle(gatewayOrigin, cancelSession)
  const cancelledMessages = await messages(gatewayOrigin, cancelSession)
  assert(cancelledMessages.some((item) => item.info?.role === 'system' && item.info?.kind === 'cancelled'), 'cancelled system body missing')
  console.log('PASS api: cancellation persisted as system body')

  // manual approval leaves the turn deterministically active until an explicit reply or restart.
  await stop(host)
  host = startHost(hostPort, gatewayOrigin, 'tools', 'manual')
  await waitHealthy(hostOrigin, '/global/health', 'manual host startup', host)
  const restartSession = await createSession(gatewayOrigin, 'Host restart turn')
  assert((await sendMessage(gatewayOrigin, restartSession, '\u5f15\u64ce\u91cd\u542f\u4e2d\u7684\u56de\u5408')).response.status === 202, 'restart turn was not accepted')
  await waitFor(async () => {
    const result = await requestJson(`${gatewayOrigin}/office/permissions`)
    assert(Array.isArray(result.body) && result.body.some((item) => item.sessionID === restartSession), 'manual permission is not pending')
  }, 'restart session approval wait')
  await stop(host)
  host = startHost(hostPort, gatewayOrigin)
  await waitHealthy(hostOrigin, '/global/health', 'host restart', host)
  const restartedMessages = await waitFor(async () => {
    const value = await messages(gatewayOrigin, restartSession)
    assert(value.some((item) => item.info?.role === 'system' && item.info?.kind === 'error'), 'host restart error body missing')
    return value
  }, 'host restart terminal body')
  assert(restartedMessages.some((item) => messageText(item).includes('\u91cd\u65b0\u53d1\u9001')), 'host restart error is not actionable')
  console.log('PASS api: active Host restart becomes persisted failure')

  await stop(gateway)
  await expectFetchFailure(`${gatewayOrigin}/health`)
  gateway = startGateway(gatewayPort, hostOrigin, webOrigin)
  await waitHealthy(gatewayOrigin, '/health', 'gateway restart', gateway)
  const afterGatewayRestart = await messages(gatewayOrigin, sessionA)
  assert(afterGatewayRestart.some((item) => messageText(item) === textA), 'Gateway restart lost persisted history')
  console.log('PASS api: Gateway restart preserves Host history')

  await runFaultMatrix(gatewayOrigin, hostOrigin, hostPort)
  await runProjectionIsolation(gatewayOrigin, hostOrigin, hostPort, webOrigin)
  await runDeepSeekStress(gatewayOrigin, hostOrigin, hostPort)

  const blockerIds = await Promise.all(Array.from({ length: 4 }, (_, index) => createSession(gatewayOrigin, `UI blocker ${index + 1}`)))
  await Promise.all(blockerIds.map((id, index) => sendMessage(gatewayOrigin, id, `block-${index + 1}`)))
  const uiSession = await createSession(gatewayOrigin, 'UI page switch')
  await waitFor(async () => {
    const result = await requestJson(`${gatewayOrigin}/office/sessions`)
    assert(result.response.ok && Array.isArray(result.body) && result.body.some((item) => item.id === uiSession), 'UI session summary is not visible yet')
  }, 'UI session summary', 6_000)
  browser = await chromium.launch({ headless: true, executablePath: browserExecutable() || undefined })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(webOrigin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '\u5bf9\u8bdd\u4e2d\u5fc3' }).click()
  const sessionSelect = page.getByRole('combobox', { name: '\u6700\u8fd1\u5bf9\u8bdd' })
  await sessionSelect.waitFor({ state: 'visible', timeout: 30_000 })
  await sessionSelect.selectOption(uiSession)
  await page.getByLabel('\u8f93\u5165\u4e0b\u4e00\u6761\u6d88\u606f').fill('\u5207\u9875\u540e\u4ecd\u9700\u6062\u590d')
  await page.getByRole('button', { name: '\u53d1\u9001', exact: true }).click()
  await page.getByRole('button', { name: '\u9690\u85cf\u529e\u516c\u5ba4' }).click()
  await page.getByRole('button', { name: 'System A', exact: true }).click()
  await page.getByRole('button', { name: 'UI page switch', exact: true }).click()
  await page.getByRole('button', { name: '\u9996\u9875' }).click()
  await page.getByRole('button', { name: '\u4efb\u52a1\u4e2d\u5fc3' }).click()
  await page.getByRole('button', { name: '\u6587\u4ef6\u4e2d\u5fc3' }).click()
  await page.getByRole('button', { name: '\u5bf9\u8bdd\u4e2d\u5fc3' }).click()
  await page.getByRole('button', { name: 'UI page switch', exact: true }).click()
  await page.getByRole('button', { name: '\u663e\u793a\u529e\u516c\u5ba4' }).click()
  await page.getByText('\u5207\u9875\u540e\u4ecd\u9700\u6062\u590d').waitFor({ state: 'visible' })
  await waitIdle(gatewayOrigin, uiSession)
  await waitFor(async () => {
    await page.reload()
    await page.getByRole('button', { name: '\u5bf9\u8bdd\u4e2d\u5fc3' }).click()
    await page.getByRole('combobox', { name: '\u6700\u8fd1\u5bf9\u8bdd' }).selectOption(uiSession)
    await page.getByText('streamed response').waitFor({ state: 'visible', timeout: 1500 })
  }, 'UI page switch and reload recovery', 12_000)
  console.log('PASS browser: real Vite/Gateway/Host page switch and reload recovery')

  const failureSession = await createSession(gatewayOrigin, 'UI failure refresh')
  // Gateway 会话摘要使用 2 秒 stale-while-refresh 缓存；先等真实摘要可见，避免把
  // 缓存窗口误判为浏览器会话选择失败。
  await waitFor(async () => {
    const result = await requestJson(`${gatewayOrigin}/office/sessions`)
    assert(Array.isArray(result.body) && result.body.some((item) => item.id === failureSession), 'new session summary is not visible yet')
  }, 'new failure session summary', 6_000)
  await page.reload()
  await page.getByRole('button', { name: '\u5bf9\u8bdd\u4e2d\u5fc3' }).click()
  await page.getByRole('combobox', { name: '\u6700\u8fd1\u5bf9\u8bdd' }).selectOption(failureSession)
  await stop(host)
  await page.getByLabel('\u8f93\u5165\u4e0b\u4e00\u6761\u6d88\u606f').fill('\u5931\u8d25\u540e\u5237\u65b0\u4ecd\u53ef\u89c1')
  await page.getByRole('button', { name: '\u53d1\u9001', exact: true }).click()
  await page.getByText(/\u6d88\u606f\u672a\u8fdb\u5165\u6267\u884c/).waitFor({ state: 'visible' })
  await page.reload()
  await page.getByRole('button', { name: '\u5bf9\u8bdd\u4e2d\u5fc3' }).click()
  await page.getByRole('combobox', { name: '\u6700\u8fd1\u5bf9\u8bdd' }).selectOption(failureSession)
  await page.getByText('\u5931\u8d25\u540e\u5237\u65b0\u4ecd\u53ef\u89c1').waitFor({ state: 'visible' })
  await page.getByText(/\u6d88\u606f\u672a\u8fdb\u5165\u6267\u884c/).waitFor({ state: 'visible' })
  host = startHost(hostPort, gatewayOrigin)
  await waitHealthy(hostOrigin, '/global/health', 'host recovery after browser failure', host)
  console.log('PASS browser: pre-admission failure body survives full page refresh')

  await context.close()
  console.log(`PASS real three-end probe: ${runtimeRoot}`)
}

async function expectFetchFailure(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) })
  } catch {
    return
  }
  throw new Error(`expected ${url} to be unavailable`)
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

run().catch((error) => {
  failed = true
  runError = error
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = error?.code === 'external_blocked' ? 2 : 1
}).finally(async () => {
  try {
    await writeEvidenceReport(failed ? (runError?.code === 'external_blocked' ? 'blocked' : 'failed') : 'passed', runError)
  } catch (error) {
    console.error(`EVIDENCE report write failed: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    process.exitCode = process.exitCode || 1
  }
  if (browser) await browser.close().catch(() => {})
  await stop(vite)
  await stop(gateway)
  await stop(host)
  if (logs.length > 0) console.error(logs.join('\n'))
  if (!failed && !keepRuntime) await fs.rm(runtimeRoot, { recursive: true, force: true }).catch(() => {})
})
