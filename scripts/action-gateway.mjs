/**
 * 功能：提供 AI Office 动作 Gateway，并代理受控的 OpenPaw 会话和资源读取接口。
 * 输入输出边界：输入为浏览器或 Host 的 HTTP 请求，输出为动作队列、资源摘要或引擎响应。
 * 设计约束：动作必须整批校验；文件只能从非符号链接的工作区/home 根目录读取；请求体有大小上限。
 * 安全边界：本文件属于 L4，负责跨域、路径、鉴权转发、超时和写入点；不得把密钥写入响应或日志。
 * 关联：`API-OFFICE-ACTION-001`、`API-OFFICE-GATEWAY-001`、`REQ-B-OFFICE-003`、`CHG-2026-0004`。
 */
import { createServer } from 'node:http'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'

const DEFAULT_PORT = 8765
const DEFAULT_ENGINE_HOST_URL = 'http://127.0.0.1:4096'
const SESSION_SUMMARY_CACHE_TTL_MS = 2_000
const CONVERSATION_CREATE_CACHE_TTL_MS = 10 * 60 * 1000
const MAX_CONVERSATION_CREATE_CACHE = 256
const CONVERSATION_MESSAGE_CACHE_TTL_MS = 30 * 1000
const MAX_CONVERSATION_MESSAGE_CACHE = 512
const MESSAGE_PROJECTION_RETRY_DELAYS_MS = [50, 100, 200]
const TASK_MESSAGE_PROJECTION_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1600, 2000]
const COMPLETED_REPLY_GRACE_MS = 5_000
const MAX_LEGACY_ACTION_QUEUE = 2_048
const MAX_ACTION_JOURNAL = 4_096
const MAX_OFFICE_FILE_BYTES = 512 * 1024
const MAX_OFFICE_ARTIFACT_BYTES = 8 * 1024 * 1024
const MAX_REQUEST_BYTES = 1024 * 1024
const WORKSPACE_STATE_FILE = 'workspace-projections.jsonl'
const WORKSPACE_STATE_VERSION = 1
const MAX_WORKSPACE_ARTIFACTS = 200
const MAX_WORKSPACE_OUTPUTS = 40
const MAX_WORKSPACE_MODEL_CHARS = 20_000
const DEFAULT_QUICK_TASK_TIMEOUT_MS = 120_000
const DEFAULT_AUTO_PLAN_TASK_TIMEOUT_MS = 15 * 60_000
const DEFAULT_TASK_INACTIVITY_TIMEOUT_MS = 5 * 60_000
const ROSTER = [
  { rosterNo: 1, id: 'marvis', name: '王明' },
  { rosterNo: 2, id: 'code-agent', name: '李研' },
  { rosterNo: 3, id: 'file-agent', name: '周理' },
  { rosterNo: 4, id: 'app-agent', name: '陈书' },
  { rosterNo: 5, id: 'review-agent', name: '刘市' },
  { rosterNo: 6, id: 'data-agent', name: '赵审' },
]
const MAIN_WORKSPACE_ID = 'main'
const STATES = new Set(['idle', 'walking', 'working', 'talking', 'thinking'])
const actions = []
const actionJournal = []
const conversationCreateRequests = new Map()
const conversationMessageRequests = new Map()
let nextActionCursor = 0
function createAgentStates() { return new Map(ROSTER.map((agent) => [agent.rosterNo, { state: 'idle', task: undefined }])) }
const agentStates = createAgentStates()
function workspaceKey(sessionId, workspaceId) { return `${sessionId || ''}\u0000${workspaceId}` }
const legacyMainWorkspaceKey = workspaceKey(null, MAIN_WORKSPACE_ID)
const workspaceAgentStates = new Map([[legacyMainWorkspaceKey, agentStates]])
const agentWorkspaces = new Map([[legacyMainWorkspaceKey, { id: MAIN_WORKSPACE_ID, name: '我的空间', kind: 'main', updatedAt: 0 }]])
const workspaceRelations = new Map()
const workspaceArtifacts = new Map()
const workspaceOutputs = new Map()
const deletedWorkspaceSessions = new Set()
let workspaceProjectionMutation = Promise.resolve()
// 一个角色可能同时承接多个任务；使用 owner 集合避免先结束的任务把仍在执行的角色误置为空闲。
const agentTaskOwners = new Map(ROSTER.map((agent) => [agent.rosterNo, new Set()]))
const activeTasks = new Map()
const taskMetadataQueues = new Map()
let shuttingDown = false
const notifications = [{ id: 'office-ready', title: '办公室已就绪', body: 'OpenPaw 与 AI Office 已完成连接。', level: 'info', createdAt: Date.now(), read: false }]
let sessionSummaryCache = null
let sessionSummaryCacheExpiresAt = 0
let sessionSummaryRequest = null

/** 判断输入是否为当前 Office 名册范围内的整数编号。 */
function isRosterNo(value) { return Number.isInteger(value) && value >= 1 && value <= ROSTER.length }
function isWorkspaceId(value) { return typeof value === 'string' && value !== 'overview' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) }
function workspaceFields(action) {
  if (action.workspaceId == null) {
    if (action.workspaceName != null || action.parentWorkspaceId != null || action.sessionId != null) throw new Error('空间元数据必须同时包含 workspaceId')
    return {}
  }
  if (!isWorkspaceId(action.workspaceId)) throw new Error('workspaceId 格式无效')
  if (action.parentWorkspaceId != null && !isWorkspaceId(action.parentWorkspaceId)) throw new Error('parentWorkspaceId 格式无效')
  for (const field of ['workspaceName', 'sessionId']) {
    if (action[field] != null && (typeof action[field] !== 'string' || !action[field].trim() || action[field].length > 200)) throw new Error(`${field} 格式无效`)
  }
  return {
    workspaceId: action.workspaceId,
    ...(action.workspaceName ? { workspaceName: action.workspaceName.trim() } : {}),
    ...(action.parentWorkspaceId ? { parentWorkspaceId: action.parentWorkspaceId } : {}),
    ...(action.sessionId ? { sessionId: action.sessionId.trim() } : {}),
  }
}

/**
 * 功能：校验并规范化一条 Office 动作，阻止未知类型、越界名册和字段类型错误。
 * 参数：`action` 为未经信任的 JSON 对象。
 * 返回：可安全放入动作队列的最小字段对象。
 * 错误：输入不符合动作契约时抛出中文错误，HTTP 层返回 400。
 * 状态：不会写入队列或改变角色状态。
 * 权限：校验通过不代表引擎权限，仅表示动作满足 Gateway 数据契约。
 * 关联：`API-OFFICE-ACTION-001`、`DAT-OFFICE-ACTION-001`。
 */
export function validateAction(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('动作必须是对象')
  if (action.type === 'desk_visit') {
    if (!isRosterNo(action.visitor) || !isRosterNo(action.host)) throw new Error('desk_visit 的 visitor 和 host 必须是 1-6 的名册序号')
    if (action.visitor === action.host) throw new Error('visitor 和 host 不能相同')
    if (typeof action.message !== 'string' || !action.message.trim()) throw new Error('desk_visit 的 message 必须是非空字符串')
    return { type: 'desk_visit', visitor: action.visitor, host: action.host, message: action.message, ...workspaceFields(action) }
  }
  if (action.type === 'desk_visit_tour') {
    if (!isRosterNo(action.visitor) || !Array.isArray(action.hosts) || action.hosts.length === 0) throw new Error('desk_visit_tour 必须包含有效 visitor 和非空 hosts')
    if (action.hosts.some((host) => !isRosterNo(host) || host === action.visitor)) throw new Error('desk_visit_tour 的 hosts 必须是 1-6 的名册序号且不能等于 visitor')
    if (typeof action.message !== 'undefined' && typeof action.message !== 'string') throw new Error('desk_visit_tour 的 message 必须是字符串')
    return { type: 'desk_visit_tour', visitor: action.visitor, hosts: [...action.hosts], ...(action.message ? { message: action.message } : {}), ...workspaceFields(action) }
  }
  if (action.type === 'set_state') {
    if (!STATES.has(action.state)) throw new Error('未知的智能体状态')
    const hasRoster = action.rosterNo != null
    const hasId = action.agentId != null
    if (!hasRoster && !hasId) throw new Error('set_state 必须包含 rosterNo 或 agentId')
    if (hasRoster && !isRosterNo(action.rosterNo)) throw new Error('rosterNo 必须是 1-6')
    if (hasId && (typeof action.agentId !== 'string' || !ROSTER.some((a) => a.id === action.agentId))) throw new Error('agentId 不在名册中')
    if (hasRoster && hasId && ROSTER[action.rosterNo - 1].id !== action.agentId) throw new Error('rosterNo 和 agentId 指向不同智能体')
    if (action.task != null && typeof action.task !== 'string') throw new Error('task 必须是字符串')
    return { type: 'set_state', state: action.state, ...(hasRoster ? { rosterNo: action.rosterNo } : {}), ...(hasId ? { agentId: action.agentId } : {}), ...(action.task != null ? { task: action.task } : {}), ...workspaceFields(action) }
  }
  if (action.type === 'workspace_handoff') {
    if (!isWorkspaceId(action.fromWorkspaceId) || !isWorkspaceId(action.toWorkspaceId) || action.fromWorkspaceId === action.toWorkspaceId) throw new Error('workspace_handoff 必须包含两个不同的有效空间编号')
    if (!['going', 'talking', 'returning', 'complete'].includes(action.phase)) throw new Error('workspace_handoff phase 无效')
    if (action.rosterNo != null && !isRosterNo(action.rosterNo)) throw new Error('workspace_handoff rosterNo 必须是 1-6')
    if (action.message != null && (typeof action.message !== 'string' || action.message.length > 200)) throw new Error('workspace_handoff message 格式无效')
    if (action.sessionId != null && (typeof action.sessionId !== 'string' || !action.sessionId.trim() || action.sessionId.length > 200)) throw new Error('workspace_handoff sessionId 格式无效')
    return {
      type: 'workspace_handoff',
      fromWorkspaceId: action.fromWorkspaceId,
      toWorkspaceId: action.toWorkspaceId,
      phase: action.phase,
      ...(typeof action.fromWorkspaceName === 'string' && action.fromWorkspaceName.trim() ? { fromWorkspaceName: action.fromWorkspaceName.trim().slice(0, 80) } : {}),
      ...(typeof action.toWorkspaceName === 'string' && action.toWorkspaceName.trim() ? { toWorkspaceName: action.toWorkspaceName.trim().slice(0, 80) } : {}),
      ...(action.rosterNo != null ? { rosterNo: action.rosterNo } : {}),
      ...(action.message ? { message: action.message } : {}),
      ...(action.sessionId ? { sessionId: action.sessionId.trim() } : {}),
    }
  }
  if (action.type === 'register_artifact') {
    const fields = workspaceFields(action)
    if (!fields.workspaceId || !fields.sessionId) throw new Error('register_artifact 必须包含 workspaceId 和 sessionId')
    if (typeof action.path !== 'string' || !action.path.trim() || action.path.length > 1000) throw new Error('register_artifact path 格式无效')
    const relativePath = action.path.trim().replaceAll('\\', '/')
    if (path.posix.isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath) || relativePath.split('/').some((segment) => segment === '..' || segment === '')) {
      throw new Error('register_artifact path 必须是工作区内的规范相对路径')
    }
    return { type: 'register_artifact', path: relativePath, ...fields }
  }
  if (action.type === 'workspace_output') {
    const fields = workspaceFields(action)
    if (!fields.workspaceId || !fields.sessionId) throw new Error('workspace_output 必须包含 workspaceId 和 sessionId')
    if (!['model_delta', 'model_final'].includes(action.kind)) throw new Error('workspace_output kind 无效')
    if (typeof action.text !== 'string' || !action.text || Array.from(action.text).length > MAX_WORKSPACE_MODEL_CHARS) throw new Error('workspace_output text 格式无效')
    return { type: 'workspace_output', kind: action.kind, text: action.text, ...fields }
  }
  throw new Error(`未知动作类型：${String(action.type ?? '')}`)
}

/**
 * 功能：把单个动作、数组或 `{ actions }` 包装体统一为已校验动作数组。
 * 参数：`payload` 为 HTTP JSON 请求体。
 * 返回：按输入顺序排列的规范化动作数组。
 * 错误：空批次、空元素或任一非法动作都会整体失败，避免部分入队。
 * 状态：只做校验，不修改全局队列。
 * 并发与取消：调用方在入队前一次性完成校验，保证批次原子性。
 * 关联：`API-OFFICE-ACTION-001`。
 */
export function normalizeActions(payload) {
  const batch = Array.isArray(payload) ? payload : Array.isArray(payload?.actions) ? payload.actions : [payload]
  if (batch.length === 0 || batch.some((item) => item == null)) throw new Error('请求必须至少包含一个动作')
  return batch.map(validateAction)
}

/** 把动作同时写入旧破坏性队列和有界游标日志，兼容旧客户端并避免多窗口抢消费。 */
function appendActions(batch) {
  for (const action of batch) {
    nextActionCursor += 1
    actions.push(action)
    actionJournal.push({ cursor: nextActionCursor, action })
  }
  if (actions.length > MAX_LEGACY_ACTION_QUEUE) actions.splice(0, actions.length - MAX_LEGACY_ACTION_QUEUE)
  if (actionJournal.length > MAX_ACTION_JOURNAL) actionJournal.splice(0, actionJournal.length - MAX_ACTION_JOURNAL)
  return nextActionCursor
}

function removeSessionActions(sessionId) {
  const belongsToSession = (action) => action?.sessionId === sessionId
  const remainingActions = actions.filter((action) => !belongsToSession(action))
  actions.splice(0, actions.length, ...remainingActions)
  const remainingJournal = actionJournal.filter((entry) => !belongsToSession(entry.action))
  actionJournal.splice(0, actionJournal.length, ...remainingJournal)
}

/** 按单调游标读取仍保留的动作；Gateway 重启或游标过旧时显式返回 gap/reset。 */
function actionsAfterCursor(cursor) {
  const oldestCursor = actionJournal[0]?.cursor ?? nextActionCursor + 1
  if (cursor > nextActionCursor) {
    return { actions: [], nextCursor: nextActionCursor, oldestCursor, gap: true, reset: true }
  }
  const gap = actionJournal.length > 0 && cursor < oldestCursor - 1
  const effectiveCursor = gap ? oldestCursor - 1 : cursor
  const selected = actionJournal.filter((entry) => entry.cursor > effectiveCursor)
  return {
    actions: selected.map((entry) => entry.action),
    nextCursor: selected.at(-1)?.cursor ?? nextActionCursor,
    oldestCursor,
    gap,
    reset: false,
  }
}

/** 返回 OpenPaw home 的规范化绝对路径。 */
function resolveHome() { return path.resolve(process.env.OPENPAW_HOME || path.join(os.homedir(), '.openpaw')) }
/** 返回显式配置的 Office 工作区；未配置时不得回退到 Gateway 启动目录。 */
function resolveWorkspace() {
  const configured = process.env.OPENPAW_OFFICE_WORKSPACE?.trim()
  return configured ? path.resolve(configured) : null
}
/** 判断候选路径是否等于根目录或位于根目录之下。 */
function isWithinRoot(root, candidate) {
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`
  return candidate === root || candidate.startsWith(prefix)
}
/** 将数字或 ISO 时间转换为 Unix 毫秒，非法值回退到指定时间。 */
function toUnixMs(value, fallback = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value < 1e12 ? value * 1000 : value)
  if (typeof value === 'string') { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed }
  return Math.trunc(fallback)
}
/** 按 Unicode 字符数截断展示文本，避免半个代理项进入响应。 */
function truncateUnicode(value, max = 80) { return Array.from(String(value)).slice(0, max).join('') }
/** 读取目录项；目录不存在时返回空数组，其他错误继续抛出。 */
async function readDirIfExists(directory) {
  try { return await fs.readdir(directory, { withFileTypes: true }) } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return []
    throw error
  }
}
/** 只读取普通文件正文；符号链接、目录和读取错误统一返回 null。 */
async function readTextIfFile(file) {
  try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) return null; return await fs.readFile(file, 'utf8') } catch { return null }
}

/** 以固定并发度处理目录项，避免 Windows 串行小文件 I/O 拖慢请求，也避免无界并发耗尽句柄。 */
async function mapWithConcurrency(items, limit, operation) {
  const results = new Array(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await operation(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
/** 检查目录及其已有父路径均为普通目录，拒绝符号链接穿透。 */
async function isPlainDirectory(directory) {
  try {
    // 拒绝由符号链接父目录到达的根，以及根目录本身为链接的情况。
    // 逐段检查已有路径，避免 Windows 8.3 别名导致 realpath 字符串比较失真。
    const resolved = path.resolve(directory)
    const parsed = path.parse(resolved)
    let current = parsed.root
    const prefixes = []
    for (const segment of path.relative(parsed.root, resolved).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment)
      prefixes.push(current)
    }
    const stats = await Promise.all(prefixes.map((prefix) => fs.lstat(prefix)))
    return stats.every((part) => part.isDirectory() && !part.isSymbolicLink())
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

/** 使用 YAML 解析器读取 frontmatter，保留引号、列表和嵌套元数据。 */
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, body: text, valid: true }
  const lines = text.split(/\r?\n/)
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closing < 0) return { data: {}, body: text, valid: false }
  let data = {}
  try {
    const parsed = yaml.load(lines.slice(1, closing).join('\n'))
    if (parsed == null) data = {}
    else if (typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed
    else return { data: {}, body: lines.slice(closing + 1).join('\n'), valid: false }
  } catch {
    // 调用方通过 valid=false 跳过损坏元数据，同时继续服务目录中的其他文件。
    return { data: {}, body: lines.slice(closing + 1).join('\n'), valid: false }
  }
  return { data, body: lines.slice(closing + 1).join('\n'), valid: true }
}

/**
 * 功能：列出 OpenPaw home/sessions 下可验证 JSONL 会话的摘要。
 * 参数：无，目录由 `OPENPAW_HOME` 决定。
 * 返回：按更新时间倒序排列的最多 50 条会话摘要。
 * 错误：目录不存在时返回空数组，其他目录读取错误向调用方抛出。
 * 状态：只读文件系统，不修改会话或缓存。
 * 并发与取消：以固定并发度读取候选文件，不创建后台任务。
 * 权限：拒绝符号链接根和符号链接文件，只公开摘要白名单字段。
 * 关联：`T11`、`API-OFFICE-DATA-001`、`CHG-2026-0013`。
 */
export async function listSessions() {
  const home = resolveHome(); const root = path.join(home, 'sessions')
  const [homeSafe, rootSafe] = await Promise.all([isPlainDirectory(home), isPlainDirectory(root)])
  if (!homeSafe || !rootSafe) return []
  const entries = (await readDirIfExists(root)).filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl') && !entry.isSymbolicLink())
  const candidates = await mapWithConcurrency(entries, 16, async (entry) => {
    const file = path.join(root, entry.name); const content = await readTextIfFile(file); if (content == null) return null
    let meta = null; let title = ''; let metadataTitle = ''; let malformed = false
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (!meta && event.type === 'meta') meta = event
        if (!metadataTitle && event.type === 'metadata' && typeof event.title === 'string') metadataTitle = truncateUnicode(event.title)
        const role = event.role || event.message?.role
        const content = event.content || event.message?.content
        if (!title && event.type === 'message' && role === 'user') { const block = Array.isArray(content) ? content.find((part) => part?.type === 'text') : null; if (block?.text) title = truncateUnicode(block.text) }
      } catch {
        // 非空行损坏表示整份 transcript 不可信；跳过文件，避免暴露不完整摘要。
        malformed = true
        break
      }
    }
    if (malformed) return null
    const stat = await fs.stat(file).catch(() => ({ mtimeMs: Date.now() })); const id = String(meta?.id || entry.name.replace(/\.jsonl$/, '')); const createdAt = toUnixMs(meta?.created_at ?? meta?.createdAt, stat.mtimeMs)
    // 命名会话在消息到达后仍保留显式标题；首条用户消息只作为旧会话的回退标题。
    return { id, title: metadataTitle || title || 'New session', provider: String(meta?.provider || ''), model: String(meta?.model || ''), createdAt, updatedAt: Math.trunc(stat.mtimeMs) }
  })
  const result = candidates.filter(Boolean)
  return result.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, 50)
}

async function refreshOfficeSessions() {
  // T11 明确要求侧栏不依赖 Host 进程；会话摘要只从本地 JSONL 只读扫描。
  const summaries = await listSessions()
  sessionSummaryCache = summaries
  sessionSummaryCacheExpiresAt = Date.now() + SESSION_SUMMARY_CACHE_TTL_MS
  return summaries
}

/**
 * 功能：为 `/office/sessions` 提供本地 JSONL 的有界缓存摘要，不依赖 Host 进程。
 * 参数：`force` 为 true 时忽略 TTL 并等待本次刷新。
 * 返回：最多 50 条会话摘要。
 * 错误：本地扫描失败时向 HTTP 层抛出文件错误。
 * 状态：缓存 2 秒；有陈旧数据时立即返回并在后台刷新。
 * 并发与取消：并发请求共享一个刷新 Promise。
 * 权限：JSONL 只读，不读取消息正文之外的敏感数据。
 * 关联：`API-OFFICE-DATA-001`、`CHG-2026-0013`。
 */
export async function listOfficeSessions(force = false) {
  if (!force && sessionSummaryCache && Date.now() < sessionSummaryCacheExpiresAt) return sessionSummaryCache
  if (!force && sessionSummaryCache) {
    if (!sessionSummaryRequest) {
      sessionSummaryRequest = refreshOfficeSessions().finally(() => { sessionSummaryRequest = null })
    }
    return sessionSummaryCache
  }
  if (!sessionSummaryRequest) {
    sessionSummaryRequest = refreshOfficeSessions().finally(() => { sessionSummaryRequest = null })
  }
  return sessionSummaryRequest
}

function invalidateOfficeSessions() {
  sessionSummaryCacheExpiresAt = 0
}

/**
 * 功能：列出 OpenPaw home/skills 下带有效 frontmatter 的技能摘要。
 * 参数：无，目录由 `OPENPAW_HOME` 决定。
 * 返回：按名称排序的技能名称和相对路径。
 * 错误：目录不存在时返回空数组，其他目录读取错误向调用方抛出。
 * 状态：只读文件系统。
 * 并发与取消：以固定并发度读取技能文件，不创建后台任务。
 * 权限：拒绝符号链接根、目录和文件，结果路径固定在 skills 根下。
 * 关联：`T11`、`API-OFFICE-DATA-001`。
 */
export async function listSkills() {
  const home = resolveHome(); const root = path.join(home, 'skills')
  const [homeSafe, rootSafe] = await Promise.all([isPlainDirectory(home), isPlainDirectory(root)])
  if (!homeSafe || !rootSafe) return []
  const entries = (await readDirIfExists(root)).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
  const candidates = await mapWithConcurrency(entries, 16, async (entry) => {
    const file = path.join(root, entry.name, 'SKILL.md'); const text = await readTextIfFile(file); if (text == null) return null
    const parsed = parseFrontmatter(text); if (parsed.valid === false) return null
    return { name: String(parsed.data.name || entry.name), path: path.relative(home, file).split(path.sep).join('/') }
  })
  const result = candidates.filter(Boolean)
  return result.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
}

/**
 * 功能：递归列出工作区两层以内的普通文件和目录。
 * 参数：无，根目录由 `OPENPAW_OFFICE_WORKSPACE` 决定。
 * 返回：按路径排序的最多 200 条文件和目录摘要。
 * 错误：根目录不存在时返回空数组，其他目录读取错误向调用方抛出。
 * 状态：只读文件系统。
 * 并发与取消：目录层级有界，不创建后台任务。
 * 权限：过滤隐藏项、依赖目录和所有符号链接，并校验结果位于工作区根内。
 * 关联：`T11`、`API-OFFICE-DATA-001`。
 */
export async function listFiles() {
  const root = resolveWorkspace()
  if (!root) return []
  if (!(await isPlainDirectory(root))) return []
  const result = []
  async function walk(directory, depth) {
    if (depth > 2) return
    for (const entry of await readDirIfExists(directory)) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git' || entry.isSymbolicLink()) continue
      const full = path.resolve(directory, entry.name); if (!isWithinRoot(root, full)) continue
      const relative = path.relative(root, full).split(path.sep).join('/')
      if (entry.isDirectory()) { result.push({ path: relative, type: 'directory' }); await walk(full, depth + 1) }
      else if (entry.isFile()) result.push({ path: relative, type: 'file' })
    }
  }
  await walk(root, 1); return result.sort((a, b) => a.path.localeCompare(b.path) || a.type.localeCompare(b.type)).slice(0, 200)
}

/** 解析相对普通文件路径，执行根目录、符号链接和大小校验。 */
async function resolveRelativeRegularFile(root, relativePath, maxBytes = MAX_OFFICE_FILE_BYTES) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) throw Object.assign(new Error('文件路径不能为空'), { code: 'invalid_path' })
  if (!(await isPlainDirectory(root))) throw Object.assign(new Error('工作区不存在'), { code: 'not_found' })
  const candidate = path.resolve(root, relativePath)
  if (!isWithinRoot(root, candidate) || candidate === root) throw Object.assign(new Error('文件路径越界'), { code: 'forbidden' })
  let current = root
  for (const segment of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let stat
    try { stat = await fs.lstat(current) } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw Object.assign(new Error('文件不存在'), { code: 'not_found' })
      throw error
    }
    if (stat.isSymbolicLink()) throw Object.assign(new Error('不允许读取符号链接'), { code: 'forbidden' })
    if (current !== candidate && !stat.isDirectory()) throw Object.assign(new Error('文件路径无效'), { code: 'not_found' })
  }
  const stat = await fs.lstat(candidate)
  if (!stat.isFile()) throw Object.assign(new Error('只能读取文件'), { code: 'invalid_path' })
  if (stat.size > maxBytes) throw Object.assign(new Error(`文件超过 ${Math.trunc(maxBytes / 1024)}KB 读取上限`), { code: 'too_large' })
  return { root, candidate, relative: path.relative(root, candidate).split(path.sep).join('/'), stat }
}

/** 在 Office 工作区根目录中解析一个相对文件。 */
async function resolveWorkspaceFile(relativePath) {
  const root = resolveWorkspace()
  if (!root) throw Object.assign(new Error('未配置办公室工作区'), { code: 'invalid_configuration' })
  return resolveRelativeRegularFile(root, relativePath)
}

/** 在同一工作区边界内解析较大的产物文件，只用于元数据和图片预览。 */
async function resolveWorkspaceArtifactFile(relativePath) {
  const root = resolveWorkspace()
  if (!root) throw Object.assign(new Error('未配置办公室工作区'), { code: 'invalid_configuration' })
  return resolveRelativeRegularFile(root, relativePath, MAX_OFFICE_ARTIFACT_BYTES)
}

const ARTIFACT_TYPES = new Map([
  ['.md', ['markdown', 'text/markdown; charset=utf-8']],
  ['.markdown', ['markdown', 'text/markdown; charset=utf-8']],
  ['.mmd', ['diagram', 'text/plain; charset=utf-8']],
  ['.mermaid', ['diagram', 'text/plain; charset=utf-8']],
  ['.drawio', ['diagram', 'application/xml; charset=utf-8']],
  ['.svg', ['image', 'image/svg+xml']],
  ['.png', ['image', 'image/png']],
  ['.jpg', ['image', 'image/jpeg']],
  ['.jpeg', ['image', 'image/jpeg']],
  ['.gif', ['image', 'image/gif']],
  ['.webp', ['image', 'image/webp']],
  ['.json', ['data', 'application/json; charset=utf-8']],
  ['.geojson', ['data', 'application/geo+json; charset=utf-8']],
  ['.csv', ['data', 'text/csv; charset=utf-8']],
  ['.tsv', ['data', 'text/tab-separated-values; charset=utf-8']],
  ['.kml', ['data', 'application/vnd.google-earth.kml+xml; charset=utf-8']],
  ['.gpx', ['data', 'application/gpx+xml; charset=utf-8']],
  ['.html', ['document', 'text/html; charset=utf-8']],
  ['.txt', ['text', 'text/plain; charset=utf-8']],
  ['.yaml', ['text', 'text/yaml; charset=utf-8']],
  ['.yml', ['text', 'text/yaml; charset=utf-8']],
  ['.xml', ['text', 'application/xml; charset=utf-8']],
  ['.js', ['text', 'text/javascript; charset=utf-8']],
  ['.mjs', ['text', 'text/javascript; charset=utf-8']],
  ['.cjs', ['text', 'text/javascript; charset=utf-8']],
  ['.jsx', ['text', 'text/jsx; charset=utf-8']],
  ['.ts', ['text', 'text/typescript; charset=utf-8']],
  ['.tsx', ['text', 'text/typescript; charset=utf-8']],
  ['.pdf', ['document', 'application/pdf']],
])

/** 根据扩展名返回浏览器允许展示的产物类型和 MIME。 */
function artifactType(file) {
  if (/\.chart\.json$/i.test(file)) return ['diagram', 'application/vnd.ai-office.chart+json; charset=utf-8']
  return ARTIFACT_TYPES.get(path.extname(file).toLowerCase()) || ['other', 'application/octet-stream']
}

/** 校验会话编号，阻止通过产物接口构造 sessions 目录外的路径。 */
function safeSessionId(value) {
  const sessionId = String(value || '').trim()
  if (!sessionId || sessionId.length > 160 || /[\\/\u0000-\u001f]/.test(sessionId) || sessionId === '.' || sessionId === '..') {
    throw Object.assign(new Error('会话编号无效'), { code: 'invalid_path' })
  }
  return sessionId
}

/** 读取单个会话 JSONL，目录不存在或会话不存在时返回空内容。 */
async function readSessionTranscript(sessionId) {
  const home = resolveHome(); const root = path.join(home, 'sessions')
  if (!(await isPlainDirectory(home)) || !(await isPlainDirectory(root))) return ''
  const file = path.join(root, `${safeSessionId(sessionId)}.jsonl`)
  if (!isWithinRoot(root, file)) throw Object.assign(new Error('会话路径越界'), { code: 'forbidden' })
  return (await readTextIfFile(file)) || ''
}

function finalTextMentionsArtifact(text, relativePath) {
  const normalizedText = String(text).replaceAll('\\', '/')
  const normalizedPath = String(relativePath).replaceAll('\\', '/')
  const escapedPath = normalizedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}_.\\/-])${escapedPath}(?=$|[^\\p{L}\\p{N}_.\\/-])`, 'u').test(normalizedText)
}

const FINAL_ARTIFACT_HEADING = /(最终(?:产物|交付|成果)|交付(?:产物|文件)?|产物清单|成果清单|输出清单)/
const EXCLUDED_ARTIFACT_HEADING = /(过程|临时|中间|草稿|调试|缓存|不(?:是|属于|作为|列入)|未交付|无需交付|排除)/
const PROCESS_ARTIFACT_ROOT = /^(?:过程资料|过程产物|临时资料|agents|process)(?:\/|$)/i
const ARTIFACT_PATH_PATTERN = /(?:^|[\s（(:：`])([^\s`"'<>|，。；;（）()]+?\.(?:chart\.json|md|markdown|mermaid|geojson|drawio|html?|[cm]?jsx?|tsx?|json|csv|tsv|yaml|yml|xml|mmd|svg|png|jpe?g|gif|webp|kml|gpx|pdf|txt))(?=$|[\s）),，。；;`])/giu

function normalizeDeclaredArtifactPath(value) {
  let candidate = String(value || '').trim().replaceAll('\\', '/')
  try { candidate = decodeURIComponent(candidate) } catch { /* 保留无法解码的原文，交给安全路径校验拒绝。 */ }
  candidate = candidate.replace(/^\.\//, '').replace(/[?#].*$/, '')
  if (!candidate || candidate.includes('://') || path.isAbsolute(candidate) || PROCESS_ARTIFACT_ROOT.test(candidate)) return null
  if (candidate.split('/').some((segment) => !segment || segment === '.' || segment === '..')) return null
  return candidate
}

/** 从最终答复的交付章节提取模型明确声明的工作区相对路径，不扫描目录、不依赖 mtime。 */
function finalTextDeclaredArtifactPaths(text) {
  const paths = new Set()
  let section = 'neutral'
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const headingLike = /^#{1,6}\s+/.test(line) || /[:：]\s*$/.test(line)
    if (headingLike && EXCLUDED_ARTIFACT_HEADING.test(line)) section = 'excluded'
    else if (headingLike && FINAL_ARTIFACT_HEADING.test(line)) section = 'delivery'
    const deliveryLine = section === 'delivery' || (FINAL_ARTIFACT_HEADING.test(line) && !EXCLUDED_ARTIFACT_HEADING.test(line))
    if (!deliveryLine || EXCLUDED_ARTIFACT_HEADING.test(line)) continue
    const candidates = []
    for (const match of line.matchAll(/\]\(([^)]+)\)/g)) candidates.push(match[1])
    for (const match of line.matchAll(/`([^`]+)`/g)) candidates.push(match[1])
    for (const match of line.matchAll(ARTIFACT_PATH_PATTERN)) candidates.push(match[1])
    for (const candidate of candidates) {
      const normalized = normalizeDeclaredArtifactPath(candidate)
      if (normalized) paths.add(normalized)
    }
  }
  return [...paths]
}

/** 只有最终答复在明确交付语境中列出路径时，才把主 Agent 写入文件认定为用户产物。 */
function finalTextDeclaresArtifact(text, relativePath) {
  if (!finalTextMentionsArtifact(text, relativePath)) return false
  const negative = /(过程|临时|中间|草稿|调试|缓存|不(?:是|属于|作为|列入)|未交付|无需交付|排除)/
  const delivery = /(最终|交付|产物|成果|文件清单|输出清单|已生成|已完成|可查看|可下载)/
  let section = 'neutral'
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (negative.test(trimmed) && /(文件|产物|成果|清单)/.test(trimmed)) section = 'excluded'
    else if (delivery.test(trimmed)) section = 'delivery'
    if (!finalTextMentionsArtifact(trimmed, relativePath)) continue
    if (negative.test(trimmed)) continue
    if (section === 'delivery' || delivery.test(trimmed)) return true
  }
  return false
}

/**
 * 从持久化工具调用和各回合最终正文中重建指定会话的最终交付产物。
 * 仅接受最终正文明确列出的成功文件工具输出，不猜测 shell 命令，也不读取工具正文。
 */
export async function listConversationArtifacts(sessionId, workspaceId = null) {
  const normalizedSessionId = safeSessionId(sessionId)
  if (workspaceId != null) {
    if (!isWorkspaceId(workspaceId)) throw Object.assign(new Error('workspaceId 格式无效'), { code: 'invalid_path' })
    const entry = findWorkspaceEntry(workspaceId, normalizedSessionId)
    const implicitMainWorkspace = workspaceId === normalizedSessionId || workspaceId === MAIN_WORKSPACE_ID
    if (!entry && !implicitMainWorkspace) return []
    if (entry?.[1].kind === 'subagent') {
      const [key] = entry
      const artifacts = []
      for (const registered of workspaceArtifacts.get(key)?.values() || []) {
        try {
          const resolved = await resolveWorkspaceArtifactFile(registered.path)
          const [kind, mimeType] = artifactType(resolved.relative)
          artifacts.push({
            id: `${normalizedSessionId}:${workspaceId}:${resolved.relative}`,
            sessionId: normalizedSessionId,
            workspaceId,
            path: resolved.relative,
            name: path.basename(resolved.relative),
            kind,
            mimeType,
            size: resolved.stat.size,
            updatedAt: Math.trunc(resolved.stat.mtimeMs),
          })
        } catch {
          // 登记后已删除、越界、变为链接或超过限制的文件不进入子空间产物栏。
        }
      }
      return artifacts.sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path)).slice(0, 100)
    }
  }
  const transcript = await readSessionTranscript(normalizedSessionId)
  if (!transcript) return []
  const calls = new Map()
  const successful = []
  const finalTexts = new Map()
  let legacyTurn = 0
  let currentTurnKey = 'legacy:0'
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    const acceptedTurnId = event?.type === 'turn_accept_v1'
      ? (event?.outcome?.turnID || event?.requestAdmission?.turnID)
      : null
    if (acceptedTurnId) currentTurnKey = `turn:${String(acceptedTurnId)}`
    const content = event?.type === 'message'
      ? (Array.isArray(event.content) ? event.content : Array.isArray(event.message?.content) ? event.message.content : [])
      : []
    const role = event?.role || event?.message?.role
    const explicitTurnId = event?.turnID || event?.turn_id
    if (role === 'user' && content.some((part) => part?.type === 'text' && String(part.text || '').trim())) {
      legacyTurn += 1
      currentTurnKey = `legacy:${legacyTurn}`
    }
    const turnKey = explicitTurnId ? `turn:${String(explicitTurnId)}` : currentTurnKey
    if (role === 'assistant' && !content.some((part) => part?.type === 'tool_use')) {
      const text = content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n').trim()
      if (text) finalTexts.set(turnKey, text)
    }
    for (const part of content) {
      if (part?.type === 'tool_use'
        && typeof part.id === 'string'
        && ['write_file', 'edit_file', 'notebook_edit'].includes(part.name)
        && typeof part.input?.path === 'string') {
        calls.set(part.id, { name: part.name, path: part.input.path, turnId: explicitTurnId || undefined, turnKey })
      }
      if (part?.type === 'tool_result' && typeof part.tool_use_id === 'string' && part.is_error !== true) {
        const call = calls.get(part.tool_use_id)
        if (call) successful.push(call)
      }
    }
  }
  const artifacts = new Map()
  const successfulMainPaths = new Set()
  for (const output of successful) {
    try {
      const resolved = await resolveWorkspaceArtifactFile(output.path)
      const finalText = finalTexts.get(output.turnKey)
      if (!finalText || !finalTextDeclaresArtifact(finalText, resolved.relative)) continue
      successfulMainPaths.add(resolved.relative)
      const [kind, mimeType] = artifactType(resolved.relative)
      artifacts.set(resolved.relative, {
        id: `${normalizedSessionId}:${resolved.relative}`,
        sessionId: normalizedSessionId,
        ...(output.turnId ? { turnId: String(output.turnId) } : {}),
        path: resolved.relative,
        name: path.basename(resolved.relative),
        kind,
        mimeType,
        size: resolved.stat.size,
        updatedAt: Math.trunc(resolved.stat.mtimeMs),
      })
    } catch {
      // 文件已删除、越界、为链接或超过普通读取限制时不进入产物栏。
    }
  }
  const childOwnedPaths = new Set()
  for (const [key, workspace] of agentWorkspaces) {
    if (workspace.kind !== 'subagent' || workspace.sessionId !== normalizedSessionId) continue
    for (const registered of workspaceArtifacts.get(key)?.values() || []) childOwnedPaths.add(registered.path)
  }
  for (const finalText of finalTexts.values()) {
    for (const declaredPath of finalTextDeclaredArtifactPaths(finalText)) {
      try {
        const resolved = await resolveWorkspaceArtifactFile(declaredPath)
        if (childOwnedPaths.has(resolved.relative) && !successfulMainPaths.has(resolved.relative)) continue
        const [kind, mimeType] = artifactType(resolved.relative)
        artifacts.set(resolved.relative, {
          id: `${normalizedSessionId}:${resolved.relative}`,
          sessionId: normalizedSessionId,
          path: resolved.relative,
          name: path.basename(resolved.relative),
          kind,
          mimeType,
          size: resolved.stat.size,
          updatedAt: Math.trunc(resolved.stat.mtimeMs),
        })
      } catch {
        // 最终清单中的路径仍须通过存在性、边界、链接和大小检查；无效声明不伪造成产物。
      }
    }
  }
  return [...artifacts.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.path.localeCompare(b.path)).slice(0, 100)
}

/** 读取受控图片产物；其它类型继续使用 UTF-8 `/office/file` 接口。 */
async function readWorkspaceArtifactImage(relativePath) {
  const resolved = await resolveWorkspaceArtifactFile(relativePath)
  const [kind, mimeType] = artifactType(resolved.relative)
  if (kind !== 'image') throw Object.assign(new Error('该产物不是可预览图片'), { code: 'invalid_path' })
  return { ...resolved, mimeType, content: await fs.readFile(resolved.candidate) }
}

/** 读取工作区文件正文，返回规范化相对路径和 UTF-8 内容。 */
export async function readWorkspaceFile(relativePath) {
  const resolved = await resolveWorkspaceFile(relativePath)
  return { path: resolved.relative, content: await fs.readFile(resolved.candidate, 'utf8') }
}

/** 读取 OpenPaw home/skills 下指定技能的 SKILL.md 正文。 */
export async function readSkillFile(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.startsWith('skills/') || !relativePath.endsWith('/SKILL.md')) throw Object.assign(new Error('技能路径无效'), { code: 'invalid_path' })
  const home = resolveHome(); const root = path.join(home, 'skills'); const resolved = await resolveRelativeRegularFile(root, relativePath.slice('skills/'.length), 512 * 1024)
  return { path: path.relative(home, resolved.candidate).split(path.sep).join('/'), content: await fs.readFile(resolved.candidate, 'utf8') }
}

/** 从进程环境生成转发给 engine-host 的 Basic Authentication 头；缺失凭据时不发送。 */
function engineAuthHeaders() {
  const username = process.env.OPENCODE_SERVER_USERNAME
  const password = process.env.OPENCODE_SERVER_PASSWORD
  if (!username || !password) return {}
  return { Authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` }
}

/**
 * 功能：解析并校验 Gateway 连接的 OpenPaw Host origin。
 * 参数：无，读取 `OPENPAW_ENGINE_HOST_URL`，未配置时使用本机 4096 端口。
 * 返回：不含 userinfo、path、query 或 fragment 的 HTTP(S) origin。
 * 错误：显式配置非法时抛出配置错误，禁止静默连接其它本机实例。
 * 状态：纯函数，不写入环境变量、文件或网络。
 * 并发与取消：同步执行，不持有共享可变状态，不支持取消。
 * 权限：只读取进程环境，不返回凭据。
 * 关联：`T11`、`CHG-2026-0008`、`API-OFFICE-GATEWAY-001`。
 */
export function engineHostOrigin() {
  const raw = process.env.OPENPAW_ENGINE_HOST_URL || DEFAULT_ENGINE_HOST_URL
  let parsed
  try { parsed = new URL(raw) } catch { parsed = null }
  if (!parsed
    || !['http:', 'https:'].includes(parsed.protocol)
    || !parsed.hostname
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash) {
    throw Object.assign(new Error('OPENPAW_ENGINE_HOST_URL 必须是无用户信息、path、query、fragment 的 HTTP(S) origin'), { code: 'invalid_configuration' })
  }
  return parsed.origin
}

/**
 * 功能：冻结一次任务生命周期所需的运行配置。
 * 目的：后台任务不能在运行过程中读取被其他请求或测试改写的进程环境，
 *       否则会把任务请求错误地发往另一个引擎或 home 目录。
 * 返回：仅包含可安全复用的绝对路径、引擎地址、鉴权头和默认模型配置。
 */
function snapshotRuntimeContext() {
  const legacyTimeout = process.env.OPENPAW_TASK_TIMEOUT_MS == null ? null : Number(process.env.OPENPAW_TASK_TIMEOUT_MS)
  const configuredQuickTimeout = Number(process.env.OPENPAW_TASK_QUICK_TIMEOUT_MS ?? legacyTimeout ?? DEFAULT_QUICK_TASK_TIMEOUT_MS)
  const configuredAutoPlanTimeout = Number(process.env.OPENPAW_TASK_AUTO_PLAN_TIMEOUT_MS ?? legacyTimeout ?? DEFAULT_AUTO_PLAN_TASK_TIMEOUT_MS)
  const configuredInactivityTimeout = Number(process.env.OPENPAW_TASK_INACTIVITY_TIMEOUT_MS ?? DEFAULT_TASK_INACTIVITY_TIMEOUT_MS)
  const validTimeout = (value, fallback) => Number.isFinite(value) && value >= 1000 ? value : fallback
  return {
    home: resolveHome(),
    workspace: resolveWorkspace(),
    engineOrigin: engineHostOrigin(),
    authHeaders: engineAuthHeaders(),
    defaultProvider: process.env.OPENPAW_DEFAULT_PROVIDER,
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    openAiModel: process.env.OPENPAW_OPENAI_MODEL || '',
    taskQuickTimeoutMs: validTimeout(configuredQuickTimeout, DEFAULT_QUICK_TASK_TIMEOUT_MS),
    taskAutoPlanTimeoutMs: validTimeout(configuredAutoPlanTimeout, DEFAULT_AUTO_PLAN_TASK_TIMEOUT_MS),
    taskInactivityTimeoutMs: validTimeout(configuredInactivityTimeout, DEFAULT_TASK_INACTIVITY_TIMEOUT_MS),
  }
}

/** 创建 Host session 并启动首个回合；prompt 失败时回滚刚创建的 session。 */
async function createOfficeConversationOnce(payload, context = undefined) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('请求必须是对象'), { code: 'invalid_request' })
  const text = extractConversationText(payload)
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  if (!text && !title) throw Object.assign(new Error('对话名称不能为空'), { code: 'invalid_request' })
  const configuredProvider = context?.defaultProvider
    || (context ? (context.hasOpenAiKey ? 'openai' : undefined) : process.env.OPENPAW_DEFAULT_PROVIDER || (process.env.OPENAI_API_KEY ? 'openai' : undefined))
  const provider = payload.provider == null ? configuredProvider : String(payload.provider)
  if (provider && !['mock', 'echo', 'anthropic', 'openai'].includes(provider)) throw Object.assign(new Error('不支持的 provider'), { code: 'invalid_request' })
  const directory = payload.directory == null ? '' : String(payload.directory)
  const createBody = Object.fromEntries(Object.entries({ provider, model: payload.model, title }).filter(([, value]) => value != null && value !== ''))
  const origin = context?.engineOrigin || engineHostOrigin()
  const authHeaders = context?.authHeaders || engineAuthHeaders()
  const createHeaders = {
    ...authHeaders,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(directory ? { 'x-opencode-directory': directory } : {}),
  }
  let createResponse
  try {
    createResponse = await fetch(`${origin}/session`, { method: 'POST', headers: createHeaders, body: JSON.stringify(createBody), signal: AbortSignal.timeout(5000) })
  } catch { throw Object.assign(new Error('无法连接 OpenPaw 引擎'), { code: 'engine_unavailable' }) }
  if (!createResponse.ok) throw Object.assign(new Error(`OpenPaw 创建会话失败（${createResponse.status}）`), { code: 'engine_error', status: createResponse.status })
  const session = await createResponse.json()
  const sessionId = String(session?.id || session?.sessionID || '')
  if (!sessionId) throw Object.assign(new Error('OpenPaw 返回的会话缺少 id'), { code: 'engine_error' })
  try {
    if (text) {
      const requestID = conversationRequestId(payload) ?? `office-create-${randomUUID()}`
      await promptOfficeConversation(sessionId, text, origin, context, requestID)
    }
  } catch (error) {
    // 首个回合无法调度时删除刚创建的会话，避免留下不可用记录。
    await requestEngine(`/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }, context).catch(() => {})
    throw error
  }
  const now = Date.now()
  const createdAt = Number(session?.createdAt ?? session?.time?.created ?? now)
  const updatedAt = Number(session?.updatedAt ?? session?.time?.updated ?? now)
  invalidateOfficeSessions()
  return {
    session: {
      ...session,
      id: sessionId,
      title: truncateUnicode(session?.title || title || text || '新对话'),
      provider: provider || String(session?.provider || ''),
      // Host 的创建响应在兼容模式下可能不回显 model；此时使用启动配置的默认模型，
      // 让新建对话和会话列表保持一致，不要求用户额外填写测试参数。
      model: payload.model == null ? String(session?.model || context?.openAiModel || process.env.OPENPAW_OPENAI_MODEL || '') : String(payload.model),
      createdAt: Number.isFinite(createdAt) ? createdAt : now,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : now,
    },
    promptAccepted: Boolean(text),
  }
}

/** 校验可选的 Host 幂等键；旧客户端省略该字段时继续保持兼容。 */
function conversationRequestId(payload) {
  const requestID = payload?.requestID ?? payload?.requestId
  if (requestID == null) return undefined
  if (typeof requestID !== 'string'
    || requestID.length < 1
    || requestID.length > 128
    || !/^[\x20-\x7e]+$/.test(requestID)) {
    throw Object.assign(new Error('requestID 必须为 1..128 字节的可打印 ASCII'), { code: 'invalid_request' })
  }
  return requestID
}

function createConversationFingerprint(payload, context) {
  return JSON.stringify({
    engineOrigin: context?.engineOrigin || engineHostOrigin(),
    text: extractConversationText(payload),
    title: typeof payload?.title === 'string' ? payload.title.trim() : '',
    provider: payload?.provider == null ? null : String(payload.provider),
    model: payload?.model == null ? null : String(payload.model),
    directory: payload?.directory == null ? null : String(payload.directory),
  })
}

function cleanupConversationCreateRequests(now = Date.now()) {
  for (const [requestID, entry] of conversationCreateRequests) {
    if (now - entry.createdAt > CONVERSATION_CREATE_CACHE_TTL_MS) conversationCreateRequests.delete(requestID)
  }
  while (conversationCreateRequests.size >= MAX_CONVERSATION_CREATE_CACHE) {
    const oldest = conversationCreateRequests.keys().next().value
    if (oldest == null) break
    conversationCreateRequests.delete(oldest)
  }
}

/** 使用浏览器提供的 requestID 合并创建重试，避免响应丢失后创建重复 session。 */
export async function createOfficeConversation(payload, context = undefined) {
  const requestID = conversationRequestId(payload)
  if (!requestID) return createOfficeConversationOnce(payload, context)
  cleanupConversationCreateRequests()
  const fingerprint = createConversationFingerprint(payload, context)
  const existing = conversationCreateRequests.get(requestID)
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw Object.assign(new Error('requestID 已用于不同的创建请求'), { code: 'conflict' })
    }
    return existing.promise
  }
  const entry = { fingerprint, promise: null, createdAt: Date.now() }
  entry.promise = createOfficeConversationOnce(payload, context).catch((error) => {
    if (conversationCreateRequests.get(requestID) === entry) conversationCreateRequests.delete(requestID)
    throw error
  })
  conversationCreateRequests.set(requestID, entry)
  return entry.promise
}

/** 向现有 Host session 追加一个文本回合，保留 engine-host 的并发和幂等错误码。 */
async function promptOfficeConversation(sessionId, text, origin = engineHostOrigin(), context = undefined, requestID = undefined) {
  const request = () => fetch(`${origin}/session/${encodeURIComponent(sessionId)}/prompt_async`, { method: 'POST', headers: { ...(context?.authHeaders || engineAuthHeaders()), Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(requestID ? { requestID } : {}), parts: [{ type: 'text', text }] }), signal: AbortSignal.timeout(5000) })
  let promptResponse
  try {
    promptResponse = await request()
  } catch {
    // 只有带幂等键的请求才能在 Host 接收确认丢失后安全重试。
    if (!requestID) throw Object.assign(new Error('无法连接 OpenPaw 引擎'), { code: 'engine_unavailable' })
    try { promptResponse = await request() }
    catch { throw Object.assign(new Error('无法连接 OpenPaw 引擎'), { code: 'engine_unavailable' }) }
  }
  if (!promptResponse.ok) {
    let body = null
    try { body = await promptResponse.json() } catch { /* Host 可能返回空错误体。 */ }
    const detail = body && typeof body === 'object' ? String(body.error || '') : ''
    const fallback = promptResponse.status === 429 ? '当前并发任务已满，请稍后重试' : `OpenPaw 启动回合失败（${promptResponse.status}）`
    throw Object.assign(new Error(detail || fallback), {
      code: 'engine_error',
      status: promptResponse.status,
      ...(typeof body?.code === 'string' ? { hostCode: body.code } : {}),
      ...(typeof body?.retryable === 'boolean' ? { retryable: body.retryable } : {}),
    })
  }
  const turnID = promptResponse.headers.get('openpaw-turn-id')
  return { ...(turnID ? { turnID } : {}) }
}

function cleanupConversationMessageRequests(now = Date.now()) {
  for (const [key, entry] of conversationMessageRequests) {
    if (entry.completedAt != null && now - entry.completedAt > CONVERSATION_MESSAGE_CACHE_TTL_MS) {
      conversationMessageRequests.delete(key)
    }
  }
  while (conversationMessageRequests.size >= MAX_CONVERSATION_MESSAGE_CACHE) {
    const completedKey = [...conversationMessageRequests].find(([, entry]) => entry.completedAt != null)?.[0]
    if (completedKey == null) break
    conversationMessageRequests.delete(completedKey)
  }
}

/** 按 session 与 requestID 合并消息提交，并短暂保留终态供确认重放。 */
async function promptOfficeConversationOnce(sessionId, text, requestID) {
  if (!requestID) return promptOfficeConversation(sessionId, text)
  cleanupConversationMessageRequests()
  const key = `${sessionId}\u0000${requestID}`
  const existing = conversationMessageRequests.get(key)
  if (existing) {
    if (existing.text !== text) {
      throw Object.assign(new Error('requestID 已用于不同的消息请求'), {
        code: 'engine_error', status: 409, hostCode: 'idempotency_conflict', retryable: false,
      })
    }
    return existing.promise
  }
  const entry = { text, promise: null, completedAt: null }
  entry.promise = promptOfficeConversation(sessionId, text, undefined, undefined, requestID)
    .then((result) => {
      // 只有 Host 已返回接收确认时才保留幂等结果；连接失败或明确拒绝
      // 表示本次请求尚未确认入场，后续相同 requestID 必须允许重新尝试。
      entry.completedAt = Date.now()
      return result
    })
    .catch((error) => {
      if (conversationMessageRequests.get(key) === entry) conversationMessageRequests.delete(key)
      throw error
    })
  conversationMessageRequests.set(key, entry)
  return entry.promise
}

/** 统一调用 engine-host，并将响应正文解析为 JSON 或原始文本。 */
async function requestEngine(pathname, init = {}, context = undefined) {
  try {
    const response = await fetch(`${context?.engineOrigin || engineHostOrigin()}${pathname}`, { ...init, headers: { ...(context?.authHeaders || engineAuthHeaders()), ...(init.headers || {}) }, signal: init.signal || AbortSignal.timeout(5000) })
    const text = await response.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    return { response, body }
  } catch { throw Object.assign(new Error('无法连接 OpenPaw 引擎'), { code: 'engine_unavailable' }) }
}

/** 将 Host 的批量活动状态压缩为 Office 所需白名单，阻止跨会话附带内部字段。 */
export function normalizeOfficeConversationStatuses(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
  const output = {}
  for (const [sessionId, value] of Object.entries(body)) {
    if (!sessionId || !value || typeof value !== 'object' || Array.isArray(value)) continue
    if (!['queued', 'busy'].includes(value.type)) continue
    const status = { type: value.type }
    if (typeof value.turnID === 'string') status.turnID = value.turnID
    if (typeof value.userMessageID === 'string') status.userMessageID = value.userMessageID
    if (value.type === 'queued' && Number.isFinite(value.queuePosition)) {
      status.queuePosition = Math.max(1, Math.trunc(value.queuePosition))
    }
    if (value.activity && typeof value.activity === 'object' && !Array.isArray(value.activity)) {
      const activity = {}
      if (typeof value.activity.kind === 'string') activity.kind = truncateUnicode(value.activity.kind, 40)
      if (typeof value.activity.tool === 'string') activity.tool = truncateUnicode(value.activity.tool, 100)
      if (typeof value.activity.task === 'string') activity.task = truncateUnicode(value.activity.task, 160)
      if (Object.keys(activity).length > 0) status.activity = activity
    }
    output[sessionId] = status
  }
  return output
}

/** 将 Host SSE 事件收敛为浏览器允许读取的文本、状态和断流通知。 */
export function filterOfficeConversationEvent(event, textPartIds = new Set()) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') return null
  const properties = event.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return null
  if (event.type === 'message.updated') {
    const info = properties.info
    if (!info || typeof info !== 'object' || Array.isArray(info) || info.role !== 'assistant'
      || typeof info.id !== 'string' || typeof info.sessionID !== 'string') return null
    const time = info.time && typeof info.time === 'object' && !Array.isArray(info.time)
      ? Object.fromEntries(['created', 'completed'].filter((key) => Number.isFinite(info.time[key])).map((key) => [key, info.time[key]]))
      : undefined
    return { type: event.type, properties: { info: { id: info.id, sessionID: info.sessionID, role: 'assistant', ...(time && Object.keys(time).length ? { time } : {}) } } }
  }
  if (event.type === 'message.part.updated') {
    const part = properties.part
    if (!part || typeof part !== 'object' || Array.isArray(part) || part.type !== 'text'
      || typeof part.id !== 'string' || typeof part.messageID !== 'string' || typeof part.sessionID !== 'string'
      || typeof part.text !== 'string') return null
    textPartIds.add(part.id)
    if (textPartIds.size > 4096) textPartIds.delete(textPartIds.values().next().value)
    return { type: event.type, properties: { part: { id: part.id, messageID: part.messageID, sessionID: part.sessionID, type: 'text', text: part.text } } }
  }
  if (event.type === 'message.part.delta') {
    if (properties.field !== 'text' || typeof properties.partID !== 'string' || !textPartIds.has(properties.partID)
      || typeof properties.messageID !== 'string' || typeof properties.sessionID !== 'string' || typeof properties.delta !== 'string') return null
    return {
      type: event.type,
      properties: {
        partID: properties.partID,
        messageID: properties.messageID,
        sessionID: properties.sessionID,
        field: 'text',
        delta: properties.delta,
      },
    }
  }
  if (event.type === 'session.status') {
    const status = properties.status
    if (typeof properties.sessionID !== 'string' || !status || typeof status !== 'object' || Array.isArray(status)
      || !['queued', 'busy', 'idle'].includes(status.type)) return null
    return { type: event.type, properties: { sessionID: properties.sessionID, status: { type: status.type } } }
  }
  if (event.type === 'session.idle') {
    return typeof properties.sessionID === 'string' ? { type: event.type, properties: { sessionID: properties.sessionID } } : null
  }
  if (event.type === 'stream.gap') {
    return { type: event.type, properties: { scope: 'global', dropped: Number.isFinite(properties.dropped) ? Math.max(1, Math.trunc(properties.dropped)) : 1 } }
  }
  return null
}

async function proxyOfficeConversationEvents(req, res) {
  const controller = new AbortController()
  const close = () => controller.abort()
  res.once('close', close)
  let response
  try {
    response = await fetch(`${engineHostOrigin()}/global/event`, {
      headers: { ...engineAuthHeaders(), Accept: 'text/event-stream' },
      signal: controller.signal,
    })
  } catch {
    res.off('close', close)
    if (!res.headersSent) sendJson(res, 503, { error: '无法连接 OpenPaw 事件流' })
    return
  }
  if (!response.ok || !response.body) {
    res.off('close', close)
    sendJson(res, response.status === 401 ? 502 : 503, { error: `OpenPaw 事件流不可用（${response.status}）` })
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-store')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const textPartIds = new Set()
  let buffer = ''
  const consume = (chunk) => {
    buffer = `${buffer}${chunk}`.replaceAll('\r\n', '\n')
    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (data) {
        try {
          const filtered = filterOfficeConversationEvent(JSON.parse(data), textPartIds)
          if (filtered && !res.destroyed) res.write(`data: ${JSON.stringify(filtered)}\n\n`)
        } catch {
          // 单个损坏帧直接丢弃；客户端通过 REST 消息接口完成最终对账。
        }
      }
      boundary = buffer.indexOf('\n\n')
    }
  }
  const keepAlive = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n') }, 15_000)
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      consume(decoder.decode(value, { stream: true }))
    }
    consume(decoder.decode())
  } catch {
    // 浏览器断开或 Host 结束流时由前端自动重连，REST 监视器不受影响。
  } finally {
    clearInterval(keepAlive)
    res.off('close', close)
    controller.abort()
    if (!res.destroyed) res.end()
  }
}

/** 在限定时间内轮询 session/status，等待指定 session 回到空闲。 */
async function waitEngineIdle(sessionId, timeoutMs = 2000, context = undefined) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const result = await requestEngine('/session/status', {}, context)
      if (result.response.ok && !result.body?.[sessionId]) return true
    } catch { return false }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

/** 将 engine-host 响应透传为 Gateway JSON 响应，同时保留状态码和错误正文。 */
async function sendEngineResult(res, result) {
  if (result.response.ok) {
    if (result.response.status === 204) sendJson(res, 204, null)
    else sendJson(res, result.response.status, result.body ?? {})
    return
  }
  const detail = typeof result.body === 'object' && result.body?.error ? result.body.error : `OpenPaw 请求失败（${result.response.status}）`
  sendJson(res, result.response.status, { error: detail })
}

/**
 * 功能：过滤 Office 对话专用消息响应，阻止 Host 内部工具数据进入浏览器。
 * 参数：`body` 为 OpenPaw `/session/:id/message` 的完整 JSON 数组。
 * 返回：只包含 `info` 白名单字段和文本 part 的新数组；输入不是数组时返回空数组。
 * 安全：不复制 reasoning、tool 或 `state.input/output/error`，不修改 Host 原始响应。
 * 兼容：OpenCode 原始路由继续使用 `sendEngineResult`，只有 Office 消息路由调用此过滤器。
 * 关联：`CHG-2026-0010`、`API-OFFICE-GATEWAY-001`。
 */
export function filterOfficeConversationMessages(body) {
  if (!Array.isArray(body)) return []
  const copyInfo = (info) => {
    if (!info || typeof info !== 'object' || Array.isArray(info)) return {}
    const result = Object.fromEntries(['id', 'sessionID', 'role', 'kind', 'turnID']
      .filter((key) => typeof info[key] === 'string')
      .map((key) => [key, info[key]]))
    const sourceTime = info.time
    if (sourceTime && typeof sourceTime === 'object' && !Array.isArray(sourceTime)) {
      const time = Object.fromEntries(['created', 'completed']
        .filter((key) => typeof sourceTime[key] === 'number' && Number.isFinite(sourceTime[key]))
        .map((key) => [key, sourceTime[key]]))
      if (Object.keys(time).length > 0) result.time = time
    }
    return result
  }
  const copyTextPart = (part) => {
    if (!part || typeof part !== 'object' || Array.isArray(part) || part.type !== 'text' || typeof part.text !== 'string') return null
    return Object.fromEntries(['id', 'messageID', 'sessionID', 'type', 'text']
      .filter((key) => key === 'text' || typeof part[key] === 'string')
      .map((key) => [key, part[key]]))
  }
  return body
    .filter((message) => message && typeof message === 'object' && !Array.isArray(message))
    .map((message) => ({
      info: copyInfo(message.info),
      parts: Array.isArray(message.parts)
        ? message.parts.map(copyTextPart).filter((part) => part !== null)
        : [],
    }))
    .filter((message) => message.parts.some((part) => part.text.trim().length > 0))
}

const TURN_FAILURE_TEXT = {
  provider_rate_limited: '模型服务请求过于频繁，本轮未完成，请稍后重试。',
  provider_overloaded: '模型服务当前负载过高，本轮未完成，请稍后重试。',
  provider_server_error: '模型服务发生服务器错误，本轮未完成，请稍后重试。',
  provider_timeout: '模型服务响应超时，本轮未完成，请稍后重试。',
  provider_protocol_error: '模型服务返回了不完整响应，本轮未完成，请稍后重试。',
  provider_auth_failed: '模型服务认证失败，请检查运行配置后重试。',
  context_too_long: '对话内容超过模型可处理范围，请缩短内容后重试。',
  host_restarted: '引擎在本轮执行期间重新启动，本轮未完成，请重新发送。',
  persistence_failed: '对话结果保存失败，本轮未完成，请稍后重试。',
  completed_without_reply: '本轮已结束，但未收到智能体的有效回复，请重新发送。',
  turn_failed: '智能体处理失败，本轮未完成，请稍后重试。',
}

function normalizeTurnOutcomes(body) {
  if (!Array.isArray(body)) return []
  return body.filter((turn) => turn && typeof turn === 'object' && !Array.isArray(turn)
      && typeof turn.turnID === 'string' && typeof turn.state === 'string')
    .map((turn) => ({
      turnID: turn.turnID,
      userMessageID: typeof turn.userMessageID === 'string' ? turn.userMessageID : undefined,
      state: turn.state,
      queuedAt: Number.isFinite(turn.queuedAt) ? turn.queuedAt : undefined,
      startedAt: Number.isFinite(turn.startedAt) ? turn.startedAt : undefined,
      completedAt: Number.isFinite(turn.completedAt) ? turn.completedAt : undefined,
      error: turn.error && typeof turn.error === 'object' ? {
        code: typeof turn.error.code === 'string' ? turn.error.code : 'turn_failed',
        retryable: Boolean(turn.error.retryable),
      } : undefined,
    }))
}

/** 按 turnID 返回持久化终态；缺少目标编号时才回退到最后一个终态。 */
function terminalTurnFor(body, turnId = '') {
  const terminalTurns = normalizeTurnOutcomes(body).filter((turn) => ['completed', 'failed', 'cancelled'].includes(turn.state))
  if (turnId) return terminalTurns.find((turn) => turn.turnID === turnId)
  return terminalTurns.at(-1)
}

/**
 * 功能：判断目标回合的 user 消息到下一条 user 之间是否存在非空 assistant 正文。
 * 参数：`messages` 为 Host 原始消息；`terminal` 必须包含目标 `turnID/userMessageID`。
 * 返回：只有目标 user 可定位且窗口内存在非空 assistant 文本时返回 true。
 * 错误：字段缺失、仅 reasoning/tool、空白正文和无法证明关联时统一返回 false。
 * 状态：纯函数，不修改消息数组。
 * 并发与取消：通过持久 ID 和顺序窗口隔离回合，不读取当前活动状态。
 * 权限：只检查角色、ID 和 text 是否非空，不返回正文。
 * 关联：`CHG-2026-0014`、`TEST-0014-U01`、`TEST-0014-U02`。
 */
export function turnHasAssistantText(messages, terminal) {
  if (!Array.isArray(messages)
    || !terminal
    || typeof terminal.turnID !== 'string'
    || !terminal.turnID
    || typeof terminal.userMessageID !== 'string'
    || !terminal.userMessageID) return false
  const roleOf = (message) => message?.info?.role || message?.role || message?.message?.role
  const idOf = (message) => message?.info?.id || message?.id || message?.message?.id
  const hasText = (message) => {
    const parts = message?.parts || message?.content || message?.message?.content || []
    if (typeof parts === 'string') return parts.trim().length > 0
    return Array.isArray(parts) && parts.some((part) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim())
  }
  const userIndex = messages.findIndex((message) => roleOf(message) === 'user' && idOf(message) === terminal.userMessageID)
  if (userIndex < 0) return false
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    const role = roleOf(message)
    // 工具循环会追加空正文 user 消息；只有真实文本 user 才能表示下一轮边界。
    if (role === 'user' && hasText(message)) break
    if (role !== 'assistant') continue
    const explicitTurnId = message?.info?.turnID || message?.turnID || message?.message?.turnID
    if (typeof explicitTurnId === 'string' && explicitTurnId !== terminal.turnID) continue
    if (hasText(message)) return true
  }
  return false
}

/**
 * 在 completed 终态已经可见、assistant 消息仍在异步落盘的窗口内重读消息。
 * 只对 completed 做有界重试，失败/取消终态保持一次读取，避免掩盖真实错误。
 */
async function readTaskMessagesForTerminal(sessionId, terminal, context) {
  let result
  const retryDelays = completedReplyStillReconciling(terminal) ? TASK_MESSAGE_PROJECTION_RETRY_DELAYS_MS : []
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    result = await requestEngine(`/session/${encodeURIComponent(sessionId)}/message`, {}, context)
    if (!result.response.ok) throw new Error(`OpenPaw 消息读取失败（${result.response.status}）`)
    if (terminal.state !== 'completed' || turnHasAssistantText(result.body, terminal) || attempt === retryDelays.length) return result
    if (!completedReplyStillReconciling(terminal)) return result
    await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]))
  }
  return result
}

/** 判断 completed 正文是否仍处于允许继续对账的短窗口。 */
function completedReplyStillReconciling(turn, now = Date.now()) {
  return turn?.state === 'completed'
    && Number.isFinite(turn.completedAt)
    && now - turn.completedAt < COMPLETED_REPLY_GRACE_MS
}

/**
 * 功能：把 Host 回合终态合并进已脱敏的 Office 对话正文。
 * 参数：`messages` 为 Office 文本白名单；`turns` 为 `/session/:id/turns`；`sessionId` 为目标会话。
 * 返回：在对应 user 回合末尾插入 system 终态标记；失败和取消包含可见中文正文，完成标记无正文。
 * 错误：非法终态被忽略；错误文本按 code 静态映射，不透传 Provider 原始错误。
 * 状态：纯函数，不修改 Host 响应或 session JSONL。
 * 并发与取消：纯函数，可安全合并并行会话响应。
 * 权限：只允许 turnID、userMessageID、state、时间和脱敏错误 code 进入浏览器。
 * 关联：`API-OFFICE-CONVERSATION-004`、`CHG-2026-0013`。
 */
export function mergeOfficeConversationTurns(messages, turns, sessionId) {
  const output = filterOfficeConversationMessages(messages)
  const terminalTurns = normalizeTurnOutcomes(turns).filter((turn) => ['completed', 'failed', 'cancelled'].includes(turn.state))
  for (const turn of terminalTurns) {
    const id = `turn-${turn.turnID}-${turn.state}`
    if (output.some((message) => message.info?.id === id)) continue
    const completedWithReply = turn.state === 'completed' && turnHasAssistantText(messages, turn)
    if (turn.state === 'completed' && !completedWithReply && completedReplyStillReconciling(turn)) continue
    const kind = turn.state === 'failed' || (turn.state === 'completed' && !completedWithReply)
      ? 'error'
      : turn.state === 'cancelled' ? 'cancelled' : 'completed'
    const text = turn.state === 'failed'
      ? (TURN_FAILURE_TEXT[turn.error?.code] || TURN_FAILURE_TEXT.turn_failed)
      : turn.state === 'cancelled'
        ? '本轮已停止。'
        : completedWithReply ? null : TURN_FAILURE_TEXT.completed_without_reply
    const marker = {
      info: {
        id,
        sessionID: sessionId,
        role: 'system',
        kind,
        turnID: turn.turnID,
        time: Object.fromEntries([
          ['created', turn.queuedAt ?? turn.startedAt],
          ['completed', turn.completedAt],
        ].filter(([, value]) => Number.isFinite(value))),
      },
      parts: text ? [{ type: 'text', text }] : [],
    }
    const userIndex = turn.userMessageID ? output.findIndex((message) => message.info?.id === turn.userMessageID) : -1
    let insertAt = output.length
    if (userIndex >= 0) {
      insertAt = userIndex + 1
      while (insertAt < output.length) {
        const message = output[insertAt]
        const isRealUserMessage = message.info?.role === 'user'
          && message.parts.some((part) => typeof part.text === 'string' && part.text.trim())
        if (isRealUserMessage) break
        insertAt += 1
      }
    }
    output.splice(insertAt, 0, marker)
  }
  return output
}

/** 只对最新且仍在短窗口内的 completed 回合重读，历史缺失回合不拖慢后续请求。 */
function completedTurnNeedsMessageProjectionRetry(messages, turns) {
  if (!Array.isArray(turns)) return false
  const latest = normalizeTurnOutcomes(turns)
    .filter((turn) => ['completed', 'failed', 'cancelled'].includes(turn.state))
    .at(-1)
  return completedReplyStillReconciling(latest) && !turnHasAssistantText(messages, latest)
}

/** 同时读取消息和 turns，避免用不同时间点的两个响应组成投影结论。 */
async function readOfficeConversationProjection(sessionId) {
  const messagePromise = requestEngine(`/session/${encodeURIComponent(sessionId)}/message`, { headers: { Accept: 'application/json' } })
  const turnPromise = requestEngine(`/session/${encodeURIComponent(sessionId)}/turns`, { headers: { Accept: 'application/json' } })
    .catch(() => null)
  return Promise.all([messagePromise, turnPromise])
}

/**
 * 将 Host 的消息和回合终态投影到 Office；仅对 completed/消息快照短暂不同步执行
 * 固定次数的一致性重读。失败、取消和 turns 不可用不增加重读；短窗口结束前仍无
 * assistant 时暂不插入终态标记，让前端继续监视而不是固化临时失败。
 */
async function sendOfficeConversationMessages(res, messageResult, turnResult, sessionId, rereadMessages = undefined) {
  if (!messageResult.response.ok) {
    sendEngineResult(res, messageResult)
    return
  }
  let projectedTurns = turnResult?.response?.ok ? turnResult.body : []
  let projectedMessages = messageResult.response.status === 204 ? [] : messageResult.body
  for (const delayMs of MESSAGE_PROJECTION_RETRY_DELAYS_MS) {
    if (!rereadMessages || !completedTurnNeedsMessageProjectionRetry(projectedMessages, projectedTurns)) break
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    try {
      const [retryMessages, retryTurns] = await rereadMessages()
      if (retryMessages?.response?.ok && retryMessages.response.status !== 204) projectedMessages = retryMessages.body
      if (retryTurns?.response?.ok) projectedTurns = retryTurns.body
    } catch { break }
  }
  const merged = mergeOfficeConversationTurns(projectedMessages, projectedTurns, sessionId)
  if (messageResult.response.status === 204 && merged.length === 0) sendJson(res, 204, null)
  else sendJson(res, 200, merged)
}

/** 从兼容的 text 或 parts 字段提取对话正文。 */
function extractConversationText(payload) {
  if (typeof payload?.text === 'string') return payload.text.trim()
  if (Array.isArray(payload?.parts)) return payload.parts.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('').trim()
  return ''
}

/** 只读扫描 OpenPaw home/goals 中的任务元数据摘要，不触发恢复副作用。 */
async function scanTasks(context = undefined) {
  const home = context?.home || resolveHome(); const root = path.join(home, 'goals')
  const [homeSafe, rootSafe] = await Promise.all([isPlainDirectory(home), isPlainDirectory(root)])
  if (!homeSafe || !rootSafe) return []
  const entries = (await readDirIfExists(root)).filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.isSymbolicLink())
  const candidates = await mapWithConcurrency(entries, 16, async (entry) => {
    const file = path.join(root, entry.name); const text = await readTextIfFile(file); if (text == null) return null
    const parsed = parseFrontmatter(text); if (parsed.valid === false || !text.startsWith('---')) return null; const id = entry.name.replace(/\.md$/, '')
    const rawPriority = parsed.data.priority
    const priority = typeof rawPriority === 'string' || typeof rawPriority === 'number' ? rawPriority : ''
    const item = {
      id,
      objective: String(parsed.data.objective || parsed.data.title || parsed.data.name || id),
      status: String(parsed.data.status || 'unknown'),
      priority,
      nextAction: String(parsed.data.next_action ?? parsed.data.nextAction ?? ''),
    }
    if (parsed.data.phase) item.phase = String(parsed.data.phase)
    if (parsed.data.execution_mode) item.executionMode = parsed.data.execution_mode === 'quick' ? 'quick' : 'auto_plan'
    if (parsed.data.attempt) item.attempt = Math.max(1, Number.parseInt(String(parsed.data.attempt), 10) || 1)
    const successCriteria = parsed.data.success_criteria ?? parsed.data.successCriteria
    const failureReason = parsed.data.failure_reason ?? parsed.data.failureReason
    const failureStage = parsed.data.failure_stage ?? parsed.data.failureStage
    const errorCode = parsed.data.error_code ?? parsed.data.errorCode
    const recommendedAction = parsed.data.recommended_action ?? parsed.data.recommendedAction
    const parentTaskId = parsed.data.parent_task_id ?? parsed.data.parentTaskId
    const createdAt = parsed.data.created_at ?? parsed.data.createdAt
    const updatedAt = parsed.data.updated_at ?? parsed.data.updatedAt
    if (successCriteria) item.successCriteria = String(successCriteria)
    if (failureReason) item.failureReason = String(failureReason)
    if (failureStage) item.failureStage = String(failureStage)
    if (errorCode) item.errorCode = String(errorCode)
    if (parsed.data.retryable != null) item.retryable = parsed.data.retryable === true || String(parsed.data.retryable).toLowerCase() === 'true'
    if (recommendedAction) item.recommendedAction = String(recommendedAction)
    if (parentTaskId) item.parentTaskId = String(parentTaskId)
    if (createdAt) item.createdAt = toUnixMs(createdAt, 0)
    if (updatedAt) item.updatedAt = toUnixMs(updatedAt, item.createdAt || 0)
    const assignedAgent = parsed.data.assigned_agent ?? parsed.data.assignedAgent
    const sessionId = parsed.data.session_id ?? parsed.data.sessionId
    const turnId = parsed.data.turn_id ?? parsed.data.turnId
    if (assignedAgent) item.assignedAgent = String(assignedAgent)
    if (sessionId) item.sessionId = String(sessionId)
    if (turnId) item.turnId = String(turnId)
    return item
  })
  const result = candidates.filter(Boolean)
  return result.sort((a, b) => b.id.localeCompare(a.id))
}

/** 列出任务摘要；启动恢复由 server listening 生命周期唯一触发，读取接口没有副作用。 */
export async function listTasks(context = undefined) {
  return (await scanTasks(context)).map((task) => {
    const runState = activeTasks.get(task.id)
    if (runState && !runState.finalized && ['completed', 'failed', 'cancelled'].includes(task.status)) {
      return { ...task, status: 'in_progress', nextAction: '正在收敛任务结果' }
    }
    return task
  })
}

/** 确保目标路径的每一级都是普通目录；缺失目录会逐级创建。 */
async function ensurePlainDirectory(directory) {
  const resolved = path.resolve(directory)
  const parsed = path.parse(resolved)
  let current = parsed.root
  for (const segment of path.relative(parsed.root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Object.assign(new Error('目标目录不是安全的普通目录'), { code: 'forbidden' })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await fs.mkdir(current)
    }
  }
  return resolved
}

/** 清理任务文件名中的路径和控制字符，限制长度并提供默认编号。 */
function safeTaskId(value) {
  const normalized = String(value ?? '').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
  return normalized || `task-${Date.now()}`
}

/** 根据任务目标关键词选择 Office 名册角色，无法分类时回退到 1 号协调角色。 */
function chooseTaskAgent(objective) {
  const text = String(objective || '')
  if (/(搜索|调研|研究|数据|统计|分析)/u.test(text)) return ROSTER[1]
  if (/(文件|读取|文档|纪要|资料|整理)/u.test(text)) return ROSTER[2]
  if (/(编码|代码|写入|修改|实现|开发|修复)/u.test(text)) return ROSTER[3]
  if (/(审核|检查|审批|验收|评审)/u.test(text)) return ROSTER[5]
  // 协调角色是可执行回退；返回真实名册成员可让未分类任务继续可观察并进入回合。
  return ROSTER[0]
}

/** 生成区别于普通对话的目标任务提示，只要求公开计划和结果，不要求隐藏思维链。 */
function taskExecutionPrompt(task) {
  const criteria = task.successCriteria || '完成目标并给出可核验的结果、完成情况和未解决事项'
  const mode = task.executionMode === 'quick' ? '快速执行' : '自动规划'
  const instruction = task.executionMode === 'quick'
    ? '直接执行目标；仅在确有必要时列出简短步骤，避免冗长规划。'
    : '先给出简短、可公开的执行计划，再逐步完成目标并复核结果。'
  return [
    '你正在执行一个独立目标任务，不是普通对话。',
    `目标：${task.objective}`,
    `完成标准：${criteria}`,
    `执行模式：${mode}`,
    instruction,
    '最终请输出结果摘要、完成标准核对和仍未解决的事项；不要输出隐藏思维链。',
  ].join('\n')
}

function taskAbsoluteTimeoutMs(task, context) {
  return task.executionMode === 'quick'
    ? context.taskQuickTimeoutMs
    : context.taskAutoPlanTimeoutMs
}

function latestSessionWorkspaceActivity(sessionId) {
  let latest = 0
  for (const workspace of agentWorkspaces.values()) {
    if (workspace.sessionId === sessionId) latest = Math.max(latest, Number(workspace.updatedAt) || 0)
  }
  return latest
}

function taskProgressSignature(active, sessionId) {
  return `${JSON.stringify(active || null)}\u0000${latestSessionWorkspaceActivity(sessionId)}`
}

function taskDeadlineError(code, message) {
  return Object.assign(new Error(message), { code })
}

function isTaskResumePrompt(text) {
  const normalized = String(text || '').trim().replace(/[。！!？?]+$/u, '')
  return /^(?:继续(?:执行|完成|处理|工作)?|接着执行|从中断处继续|resume|continue)(?:[\s,，。.!！?？;；:：]|$)/iu.test(normalized)
}

/** 在 Windows 临时文件占用窗口内有界重试原子替换。 */
async function replaceTaskFileWithRetry(temporary, file) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await fs.rename(temporary, file)
      return
    } catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error?.code) || attempt === 11) throw error
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
    }
  }
}

/** 原子更新任务 frontmatter；同一任务的创建、运行、取消和恢复写入严格串行。 */
async function updateTaskMetadata(id, updates, context = undefined) {
  const home = context?.home || resolveHome(); const file = path.join(home, 'goals', `${safeTaskId(id)}.md`)
  const previous = taskMetadataQueues.get(file) || Promise.resolve()
  const operation = previous.catch(() => undefined).then(async () => {
    const text = await readTextIfFile(file)
    if (text == null) return false
    const parsed = parseFrontmatter(text)
    if (!parsed.valid) return false
    const metadata = { ...parsed.data, ...updates, updated_at: new Date().toISOString() }
    const closing = text.split(/\r?\n/).findIndex((line, index) => index > 0 && line.trim() === '---')
    const body = closing >= 0 ? text.split(/\r?\n/).slice(closing + 1).join('\n') : ''
    const document = `---\n${yaml.dump(metadata, { noRefs: true, lineWidth: 120 })}---\n${body}`
    const temporary = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, document, 'utf8')
      await replaceTaskFileWithRetry(temporary, file)
      return true
    } finally {
      await fs.unlink(temporary).catch(() => {})
    }
  })
  taskMetadataQueues.set(file, operation)
  void operation.finally(() => { if (taskMetadataQueues.get(file) === operation) taskMetadataQueues.delete(file) }).catch(() => {})
  return operation
}

/** 将内部动作校验、更新角色状态并追加到待轮询队列。 */
function enqueueInternalAction(action) {
  const normalized = validateAction(action)
  applyActionState(normalized)
  appendActions([normalized])
}

/** 注册任务对角色的占用，并发布该任务当前的思考状态。 */
function claimAgentTask(agent, taskId, objective, runState) {
  if (runState?.abandoned) return false
  if (!agent?.rosterNo) return false
  const owners = agentTaskOwners.get(agent.rosterNo) || new Set()
  owners.add(taskId)
  agentTaskOwners.set(agent.rosterNo, owners)
  enqueueInternalAction({ type: 'set_state', rosterNo: agent.rosterNo, state: 'thinking', task: `执行任务：${objective}` })
  return true
}

/** 释放任务对角色的占用；仍有并行任务时保持 working 状态而不是 idle。 */
function releaseAgentTask(agent, taskId, resultLabel, runState) {
  if (runState?.abandoned) return
  if (!agent?.rosterNo) return
  const owners = agentTaskOwners.get(agent.rosterNo)
  if (!owners) return
  owners.delete(taskId)
  if (owners.size === 0) {
    enqueueInternalAction({ type: 'set_state', rosterNo: agent.rosterNo, state: 'idle', task: resultLabel })
    return
  }
  enqueueInternalAction({ type: 'set_state', rosterNo: agent.rosterNo, state: 'working', task: `仍有 ${owners.size} 个任务执行中` })
}

/** 将一个持久化任务和匹配回合的终态收敛为稳定任务状态。 */
async function finalizeTaskFromTerminal(task, terminal, agent, runState, context) {
  const terminalCompleted = terminal.state === 'completed'
  if (terminalCompleted) await updateTaskMetadata(task.id, { phase: 'verifying', next_action: '正在验证执行结果' }, context)
  const messagesResult = terminalCompleted ? await readTaskMessagesForTerminal(task.sessionId, terminal, context) : { body: null }
  const completed = terminal.state === 'completed' && turnHasAssistantText(messagesResult.body, terminal)
  const taskStatus = completed ? 'completed' : terminal.state === 'cancelled' ? 'cancelled' : 'failed'
  const nextAction = completed
    ? (runState.resumed ? '继续执行后已完成，等待复核' : '已完成，等待复核')
    : taskStatus === 'cancelled'
      ? '任务已取消，可重新执行'
      : terminal.state === 'completed'
        ? '回合已完成但未获得有效回复'
        : `回合执行失败（${terminal.error?.code || 'turn_failed'}），可重新执行`
  const latest = (await scanTasks(context)).find((item) => item.id === task.id)
  if (!latest || ['completed', 'failed', 'cancelled'].includes(latest.status)) return
  if (completed) await updateTaskMetadata(task.id, { phase: 'delivering', next_action: '正在交付执行结果' }, context)
  const errorCode = terminalCompleted ? 'incomplete_response' : terminal.error?.code || 'turn_failed'
  const retryable = terminalCompleted ? true : terminal.error?.retryable !== false
  await updateTaskMetadata(task.id, {
    status: taskStatus,
    phase: completed ? 'completed' : taskStatus,
    next_action: nextAction,
    turn_id: terminal.turnID,
    failure_reason: completed || taskStatus === 'cancelled' ? null : nextAction,
    failure_stage: completed || taskStatus === 'cancelled' ? null : terminalCompleted ? 'verifying' : 'executing',
    error_code: completed || taskStatus === 'cancelled' ? null : errorCode,
    retryable: completed || taskStatus === 'cancelled' ? null : retryable,
    recommended_action: completed || taskStatus === 'cancelled' ? null : retryable ? '检查服务状态后重新执行' : '检查目标、权限或配置后再创建任务',
  }, context)
  createNotification({
    title: completed ? '任务已完成' : taskStatus === 'cancelled' ? '任务已取消' : '任务执行失败',
    body: `${task.objective}：${completed ? '智能体已返回结果，请在任务中心复核。' : nextAction}`,
    level: completed ? 'success' : taskStatus === 'cancelled' ? 'info' : 'error',
  })
  if (runState.agentClaimed) releaseAgentTask(agent, task.id, completed ? '任务已完成' : taskStatus === 'cancelled' ? '任务已取消' : '任务执行失败', runState)
  runState.finalized = true
}

/** 恢复 Gateway 重启前已经持久化、但当前内存中没有执行器的任务。 */
async function recoverPersistedTask(task, agent, runState, context) {
  try {
    if (!task.sessionId) throw new Error('网关重启后未找到任务执行会话')
    const taskTimeoutMs = taskAbsoluteTimeoutMs(task, context)
    const deadline = Date.now() + taskTimeoutMs
    let targetTurnId = task.turnId || ''
    while (Date.now() < deadline) {
      const [statusResult, turnsResult] = await Promise.all([
        requestEngine('/session/status', {}, context),
        requestEngine(`/session/${encodeURIComponent(task.sessionId)}/turns`, {}, context),
      ])
      if (!statusResult.response.ok) throw new Error(`OpenPaw 状态读取失败（${statusResult.response.status}）`)
      if (!turnsResult.response.ok) throw new Error(`OpenPaw 回合终态读取失败（${turnsResult.response.status}）`)
      const active = statusResult.body && typeof statusResult.body === 'object' ? statusResult.body[task.sessionId] : undefined
      if (!targetTurnId && typeof active?.turnID === 'string') {
        targetTurnId = active.turnID
        runState.turnId = targetTurnId
        await updateTaskMetadata(task.id, { turn_id: targetTurnId }, context)
      }
      const terminal = terminalTurnFor(turnsResult.body, targetTurnId)
      if (terminal) {
        runState.turnId = terminal.turnID
        await finalizeTaskFromTerminal(task, terminal, agent, runState, context)
        return
      }
      if (!active) throw new Error('网关重启后未找到可恢复的活动回合或持久终态')
      if (!runState.agentClaimed) runState.agentClaimed = claimAgentTask(agent, task.id, task.objective, runState)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw taskDeadlineError('task_deadline_exceeded', `任务恢复等待超过 ${Math.ceil(taskTimeoutMs / 1000)} 秒`)
  } catch (error) {
    const reason = error instanceof Error ? `恢复失败：${error.message}` : '任务恢复失败'
    const latest = (await scanTasks(context)).find((item) => item.id === task.id)
    if (latest && !['completed', 'failed', 'cancelled'].includes(latest.status)) {
      await updateTaskMetadata(task.id, { status: 'failed', phase: 'failed', next_action: `${reason}，可重新执行`, failure_reason: reason, failure_stage: task.phase || 'executing' }, context).catch(() => {})
      createNotification({ title: '任务恢复失败', body: `${task.objective}：${reason}`, level: 'error' })
    }
    runState.finalized = true
    if (runState.agentClaimed) releaseAgentTask(agent, task.id, '任务恢复失败', runState)
  }
}

/** 为无内存执行器的持久化活动任务注册唯一后台恢复器。 */
function schedulePersistedTaskRecovery(tasks, context = undefined) {
  if (shuttingDown) return
  for (const task of tasks) {
    if (!['queued', 'in_progress'].includes(task.status) || activeTasks.has(task.id)) continue
    const runtimeContext = context || snapshotRuntimeContext()
    const agent = ROSTER.find((candidate) => candidate.name === task.assignedAgent) || chooseTaskAgent(task.objective)
    const runState = { sessionId: task.sessionId || '', turnId: task.turnId || '', promise: null, cancelRequested: false, cancelNotice: false, finalized: false, abandoned: false, stateQueue: Promise.resolve(), context: runtimeContext, agentClaimed: false, recovering: true }
    activeTasks.set(task.id, runState)
    const promise = recoverPersistedTask(task, agent, runState, runtimeContext)
    runState.promise = promise
    void promise.finally(() => { if (activeTasks.get(task.id) === runState) activeTasks.delete(task.id) })
  }
}

/**
 * 功能：扫描持久任务并为每个 queued/in_progress 任务注册唯一恢复器。
 * 参数：可选冻结运行上下文；省略时在启动时读取当前环境。
 * 返回：本次扫描到的任务摘要，便于启动日志和测试观察。
 * 错误：目录或配置错误向调用方抛出；单任务恢复错误由恢复器写回稳定失败。
 * 状态：`activeTasks` 作为进程内幂等键，不重复提交 prompt 或重复注册恢复器。
 * 并发与取消：并发调用可共享同一任务键；Gateway 关闭时停止注册新恢复器。
 * 权限：只读取 goals，并通过 Host 状态/终态接口对账。
 * 关联：`CHG-2026-0014`、`TEST-0014-U03`、`TEST-0014-S04`。
 */
export async function startPersistedTaskRecovery(context = undefined) {
  const runtimeContext = context || snapshotRuntimeContext()
  const tasks = await scanTasks(runtimeContext)
  schedulePersistedTaskRecovery(tasks, runtimeContext)
  return tasks
}

/** 执行一个任务的完整生命周期，并在超时或关闭时主动终止 Host 回合。 */
async function runTask(task, agent, runState, context) {
  let sessionId = ''
  const taskTimeoutMs = taskAbsoluteTimeoutMs(task, context)
  const inactivityTimeoutMs = Math.min(context.taskInactivityTimeoutMs, taskTimeoutMs)
  try {
    if (runState.abandoned) return
    if (shuttingDown) throw new Error('办公室网关正在关闭')
    if (runState.cancelRequested) throw new Error('任务已取消')
    runState.agentClaimed = claimAgentTask(agent, task.id, task.objective, runState)
    const started = await enqueueTaskMutation(runState, async () => {
      if (runState.cancelRequested) return false
      await updateTaskMetadata(task.id, { status: 'in_progress', phase: 'planning', assigned_agent: agent?.name || '系统自动分派', next_action: '正在规划目标' }, context)
      return true
    })
    if (!started) throw new Error('任务已取消')
    if (shuttingDown) throw new Error('办公室网关正在关闭')
    const result = await createOfficeConversation({ title: `任务：${task.objective}`, text: taskExecutionPrompt(task), directory: context.workspace }, context)
    sessionId = String(result.session.id)
    runState.sessionId = sessionId
    if (runState.cancelRequested) throw new Error('任务已取消')
    if (shuttingDown) {
      await requestEngine(`/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST', headers: { Accept: 'application/json' } }, context).catch(() => {})
      await waitEngineIdle(sessionId, 2000, context)
      throw new Error('办公室网关正在关闭，任务回合已终止')
    }
    await enqueueTaskMutation(runState, async () => {
      if (runState.cancelRequested) return false
      await updateTaskMetadata(task.id, { session_id: sessionId, status: 'in_progress', phase: 'executing', assigned_agent: agent?.name || '系统自动分派', next_action: '智能体正在执行目标' }, context)
      return true
    }).then((ok) => { if (!ok) throw new Error('任务已取消') })
    const deadline = Date.now() + taskTimeoutMs
    let inactivityDeadline = Date.now() + inactivityTimeoutMs
    let lastProgressSignature = ''
    // prompt_async 只表示请求已接收，运行时可能还未把回合登记到 status。
    // 先等待一次 active，避免启动竞态把“只有 user 消息”的会话误判为完成。
    const startupDeadline = Math.min(deadline, Date.now() + 5000)
    let observedActive = false
    let observedTerminal = null
    while (!observedActive && Date.now() < startupDeadline) {
      if (runState.cancelRequested) throw new Error('任务已取消')
      const [statusResult, turnsResult] = await Promise.all([
        requestEngine('/session/status', {}, context),
        requestEngine(`/session/${encodeURIComponent(sessionId)}/turns`, {}, context),
      ])
      if (!statusResult.response.ok) throw Object.assign(new Error(`OpenPaw 状态读取失败（${statusResult.response.status}）`), { code: 'engine_error', status: statusResult.response.status })
      if (!turnsResult.response.ok) throw Object.assign(new Error(`OpenPaw 回合终态读取失败（${turnsResult.response.status}）`), { code: 'engine_error', status: turnsResult.response.status })
      const active = statusResult.body && typeof statusResult.body === 'object' ? statusResult.body[sessionId] : undefined
      observedActive = Boolean(active)
      const progressSignature = taskProgressSignature(active, sessionId)
      if (progressSignature !== lastProgressSignature) {
        lastProgressSignature = progressSignature
        inactivityDeadline = Date.now() + inactivityTimeoutMs
      }
      if (typeof active?.turnID === 'string') runState.turnId = active.turnID
      observedTerminal = terminalTurnFor(turnsResult.body, runState.turnId)
      if (observedTerminal) {
        runState.turnId = observedTerminal.turnID
        break
      }
      if (observedActive) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    if (runState.turnId) await updateTaskMetadata(task.id, { turn_id: runState.turnId }, context)
    while (observedActive) {
      if (runState.cancelRequested) throw new Error('任务已取消')
      const now = Date.now()
      if (now >= deadline) throw taskDeadlineError('task_deadline_exceeded', `任务执行超过 ${Math.ceil(taskTimeoutMs / 1000)} 秒`)
      if (now >= inactivityDeadline) throw taskDeadlineError('task_inactivity_timeout', `任务连续 ${Math.ceil(inactivityTimeoutMs / 1000)} 秒没有新进度`)
      const statusResult = await requestEngine('/session/status', {}, context)
      if (!statusResult.response.ok) throw Object.assign(new Error(`OpenPaw 状态读取失败（${statusResult.response.status}）`), { code: 'engine_error', status: statusResult.response.status })
      const active = statusResult.body && typeof statusResult.body === 'object' ? statusResult.body[sessionId] : undefined
      observedActive = Boolean(active)
      if (!observedActive) break
      const progressSignature = taskProgressSignature(active, sessionId)
      if (progressSignature !== lastProgressSignature) {
        lastProgressSignature = progressSignature
        inactivityDeadline = Date.now() + inactivityTimeoutMs
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const turnsResult = await requestEngine(`/session/${encodeURIComponent(sessionId)}/turns`, {}, context)
    if (!turnsResult.response.ok) throw Object.assign(new Error(`OpenPaw 回合终态读取失败（${turnsResult.response.status}）`), { code: 'engine_error', status: turnsResult.response.status })
    const terminal = terminalTurnFor(turnsResult.body, runState.turnId) || observedTerminal
    if (!terminal) throw new Error('OpenPaw 未返回可持久化的回合终态')
    runState.turnId = terminal.turnID
    const terminalCompleted = terminal.state === 'completed'
    if (terminalCompleted) await updateTaskMetadata(task.id, { phase: 'verifying', next_action: '正在验证执行结果' }, context)
    const messagesResult = terminalCompleted ? await readTaskMessagesForTerminal(sessionId, terminal, context) : { body: null }
    const completed = terminal.state === 'completed' && turnHasAssistantText(messagesResult.body, terminal)
    const taskStatus = completed ? 'completed' : terminal.state === 'cancelled' ? 'cancelled' : 'failed'
    const nextAction = completed
      ? '已完成，等待复核'
      : taskStatus === 'cancelled'
        ? '任务已取消，可重新执行'
        : terminal.state === 'completed'
          ? '回合已完成但未获得有效回复'
          : `回合执行失败（${terminal.error?.code || 'turn_failed'}），可重新执行`
    const finalized = await enqueueTaskMutation(runState, async () => {
      // 取消请求和回合收尾必须在线性化队列中竞争，避免 completed 覆盖 cancelled。
      if (runState.cancelRequested) return false
      const latest = (await scanTasks(context)).find((item) => item.id === task.id)
      if (runState.cancelRequested) return false
      if (!latest || latest.status === 'cancelled') return false
      if (completed) await updateTaskMetadata(task.id, { phase: 'delivering', next_action: '正在交付执行结果' }, context)
      const errorCode = terminalCompleted ? 'incomplete_response' : terminal.error?.code || 'turn_failed'
      const retryable = terminalCompleted ? true : terminal.error?.retryable !== false
      await updateTaskMetadata(task.id, {
        status: taskStatus,
        phase: completed ? 'completed' : taskStatus,
        next_action: nextAction,
        turn_id: terminal.turnID,
        failure_reason: completed || taskStatus === 'cancelled' ? null : nextAction,
        failure_stage: completed || taskStatus === 'cancelled' ? null : terminalCompleted ? 'verifying' : 'executing',
        error_code: completed || taskStatus === 'cancelled' ? null : errorCode,
        retryable: completed || taskStatus === 'cancelled' ? null : retryable,
        recommended_action: completed || taskStatus === 'cancelled' ? null : retryable ? '检查服务状态后重新执行' : '检查目标、权限或配置后再创建任务',
      }, context)
      createNotification({
        title: completed ? '任务已完成' : taskStatus === 'cancelled' ? '任务已取消' : '任务执行失败',
        body: `${task.objective}：${completed ? '智能体已返回结果，请在任务中心复核。' : nextAction}`,
        level: completed ? 'success' : taskStatus === 'cancelled' ? 'info' : 'error',
      })
      if (runState.agentClaimed) releaseAgentTask(agent, task.id, completed ? '任务已完成' : taskStatus === 'cancelled' ? '任务已取消' : '任务执行失败', runState)
      runState.finalized = true
      return true
    })
    if (!finalized) throw new Error('任务已取消')
  } catch (error) {
    // 任务超时或网关异常时主动终止 Host 回合，避免后台继续产出动作而任务已标记失败。
    let stopped = true
    if (sessionId) {
      await requestEngine(`/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST', headers: { Accept: 'application/json' } }, context).catch(() => {})
      stopped = await waitEngineIdle(sessionId, 2000, context)
    }
    const cancelled = runState.cancelRequested
    const reason = cancelled ? '任务已取消' : error instanceof Error ? `执行失败：${error.message}` : '任务执行失败'
    await enqueueTaskMutation(runState, async () => {
      const latest = (await scanTasks(context)).find((item) => item.id === task.id)
      if (!latest || ['completed', 'failed', 'cancelled'].includes(latest.status)) {
        runState.finalized = true
        return
      }
      const finalReason = stopped ? reason : `${reason}；引擎仍在停止`
      await updateTaskMetadata(task.id, {
        status: cancelled ? 'cancelled' : 'failed',
        phase: cancelled ? 'cancelled' : 'failed',
        next_action: finalReason,
        failure_reason: cancelled ? null : finalReason,
        failure_stage: sessionId ? 'executing' : 'planning',
        error_code: cancelled ? null : error?.code || 'task_failed',
        retryable: cancelled ? null : true,
        recommended_action: cancelled ? null : '检查服务状态后重新执行',
      }, context)
      runState.finalized = true
      if (!(cancelled && runState.cancelNotice)) createNotification({ title: cancelled ? '任务已取消' : '任务执行失败', body: `${task.objective}：${stopped ? reason : `${reason}；引擎仍在停止`}`, level: cancelled ? 'info' : 'error' })
    }).catch(() => {})
    if (runState.agentClaimed) releaseAgentTask(agent, task.id, cancelled ? '任务已取消' : '任务执行失败', runState)
  }
}

async function monitorResumedTask(task, agent, runState, context) {
  const taskTimeoutMs = taskAbsoluteTimeoutMs(task, context)
  const inactivityTimeoutMs = Math.min(context.taskInactivityTimeoutMs, taskTimeoutMs)
  const deadline = Date.now() + taskTimeoutMs
  const startupDeadline = Date.now() + 5000
  let inactivityDeadline = Date.now() + inactivityTimeoutMs
  let lastProgressSignature = ''
  try {
    while (true) {
      if (runState.cancelRequested) throw new Error('任务已取消')
      const now = Date.now()
      if (now >= deadline) throw taskDeadlineError('task_deadline_exceeded', `继续执行超过 ${Math.ceil(taskTimeoutMs / 1000)} 秒`)
      if (now >= inactivityDeadline) throw taskDeadlineError('task_inactivity_timeout', `继续执行连续 ${Math.ceil(inactivityTimeoutMs / 1000)} 秒没有新进度`)
      const [statusResult, turnsResult] = await Promise.all([
        requestEngine('/session/status', {}, context),
        requestEngine(`/session/${encodeURIComponent(task.sessionId)}/turns`, {}, context),
      ])
      if (!statusResult.response.ok) throw Object.assign(new Error(`OpenPaw 状态读取失败（${statusResult.response.status}）`), { code: 'engine_error' })
      if (!turnsResult.response.ok) throw Object.assign(new Error(`OpenPaw 回合终态读取失败（${turnsResult.response.status}）`), { code: 'engine_error' })
      const terminal = terminalTurnFor(turnsResult.body, runState.turnId)
      if (terminal) {
        await finalizeTaskFromTerminal(task, terminal, agent, runState, context)
        return
      }
      const active = statusResult.body && typeof statusResult.body === 'object' ? statusResult.body[task.sessionId] : undefined
      if (!runState.turnId && typeof active?.turnID === 'string') {
        runState.turnId = active.turnID
        await updateTaskMetadata(task.id, { turn_id: runState.turnId }, context)
      }
      const progressSignature = taskProgressSignature(active, task.sessionId)
      if (progressSignature !== lastProgressSignature) {
        lastProgressSignature = progressSignature
        inactivityDeadline = Date.now() + inactivityTimeoutMs
      }
      if (!active && Date.now() >= startupDeadline) throw Object.assign(new Error('继续执行未找到活动回合或持久终态'), { code: 'turn_missing' })
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  } catch (error) {
    if (task.sessionId && ['task_deadline_exceeded', 'task_inactivity_timeout'].includes(error?.code)) {
      await requestEngine(`/session/${encodeURIComponent(task.sessionId)}/abort`, { method: 'POST', headers: { Accept: 'application/json' } }, context).catch(() => {})
    }
    await enqueueTaskMutation(runState, async () => {
      const latest = (await scanTasks(context)).find((item) => item.id === task.id)
      if (!latest || latest.status === 'cancelled' || latest.status === 'completed') return
      const reason = error instanceof Error ? `继续执行失败：${error.message}` : '继续执行失败'
      await updateTaskMetadata(task.id, {
        status: 'failed',
        phase: 'failed',
        next_action: reason,
        failure_reason: reason,
        failure_stage: 'executing',
        error_code: error?.code || 'task_failed',
        retryable: true,
        recommended_action: '可在执行对话中再次继续，或重新执行任务',
      }, context)
      runState.finalized = true
      createNotification({ title: '任务继续执行失败', body: `${task.objective}：${reason}`, level: 'error' })
    }).catch(() => {})
  }
}

async function reconcileResumedTask(sessionId, text, turnID) {
  if (!turnID || !isTaskResumePrompt(text)) return
  const context = snapshotRuntimeContext()
  const candidates = (await scanTasks(context))
    .filter((task) => task.sessionId === sessionId
      && task.status === 'failed'
      && task.retryable !== false)
    .sort((left, right) => (right.updatedAt || right.createdAt || 0) - (left.updatedAt || left.createdAt || 0))
  const task = candidates[0]
  if (!task || activeTasks.has(task.id)) return
  const agent = ROSTER.find((candidate) => candidate.name === task.assignedAgent) || chooseTaskAgent(task.objective)
  const runState = {
    sessionId,
    turnId: turnID,
    promise: null,
    cancelRequested: false,
    cancelNotice: false,
    finalized: false,
    abandoned: false,
    stateQueue: Promise.resolve(),
    context,
    agentClaimed: false,
    resumed: true,
  }
  activeTasks.set(task.id, runState)
  await updateTaskMetadata(task.id, {
    status: 'in_progress',
    phase: 'executing',
    next_action: '正在继续执行中断的任务',
    turn_id: turnID,
    failure_reason: null,
    failure_stage: null,
    error_code: null,
    retryable: null,
    recommended_action: null,
  }, context)
  const promise = monitorResumedTask({ ...task, sessionId }, agent, runState, context)
  runState.promise = promise
  void promise.finally(() => { if (activeTasks.get(task.id) === runState) activeTasks.delete(task.id) })
}

/** 串行化单任务的最终状态写入，避免 cancel 与 completed 交叉覆盖。 */
function enqueueTaskMutation(runState, operation) {
  const previous = runState.stateQueue || Promise.resolve()
  const guardedOperation = async () => {
    if (runState.abandoned) return false
    return operation()
  }
  const next = previous.then(guardedOperation, guardedOperation)
  runState.stateQueue = next.catch(() => {})
  return next
}

/** 原子创建 goals frontmatter 文件，避免覆盖既有任务并阻止路径注入。 */
export async function createTask(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('任务请求必须是对象'), { code: 'invalid_request' })
  const objective = typeof payload.objective === 'string' ? payload.objective.trim() : ''
  if (!objective) throw Object.assign(new Error('任务目标不能为空'), { code: 'invalid_request' })
  if (objective.length > 500) throw Object.assign(new Error('任务目标不能超过 500 个字符'), { code: 'invalid_request' })
  // 客户端不能伪造执行结果；所有新任务必须从 queued 开始，由后台执行器写回后续状态。
  const status = 'queued'
  const nextAction = typeof payload.nextAction === 'string' ? payload.nextAction.trim() : typeof payload.next_action === 'string' ? payload.next_action.trim() : ''
  const priority = typeof payload.priority === 'string' || typeof payload.priority === 'number' ? payload.priority : 'normal'
  const successCriteria = typeof payload.successCriteria === 'string' ? payload.successCriteria.trim() : typeof payload.success_criteria === 'string' ? payload.success_criteria.trim() : ''
  if (successCriteria.length > 1000) throw Object.assign(new Error('完成标准不能超过 1000 个字符'), { code: 'invalid_request' })
  const executionMode = payload.executionMode === 'quick' || payload.execution_mode === 'quick' ? 'quick' : 'auto_plan'
  const executionAttempt = Math.max(1, Number.parseInt(String(payload.attempt || 1), 10) || 1)
  const parentTaskId = typeof payload.parentTaskId === 'string' ? payload.parentTaskId.trim() : typeof payload.parent_task_id === 'string' ? payload.parent_task_id.trim() : ''
  const context = snapshotRuntimeContext()
  const home = await ensurePlainDirectory(context.home)
  const goals = await ensurePlainDirectory(path.join(home, 'goals'))
  const baseId = safeTaskId(payload.id || objective)
  const createdAt = new Date().toISOString()
  const agent = chooseTaskAgent(objective)
  const metadata = {
    objective,
    success_criteria: successCriteria || '完成目标并给出可核验结果',
    execution_mode: executionMode,
    status,
    phase: 'planning',
    priority,
    next_action: nextAction || '等待智能体接手',
    assigned_agent: agent?.name || '系统自动分派',
    attempt: executionAttempt,
    ...(parentTaskId ? { parent_task_id: safeTaskId(parentTaskId) } : {}),
    created_at: createdAt,
    updated_at: createdAt,
  }
  const document = `---\n${yaml.dump(metadata, { noRefs: true, lineWidth: 120 })}---\n\n`
  let id = baseId
  let file = path.join(goals, `${id}.md`)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (activeTasks.has(id)) {
      id = `${baseId}-${attempt + 2}`
      file = path.join(goals, `${id}.md`)
      continue
    }
    const temporary = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    try {
      // 先完整写入临时文件，再用 hard-link 原子发布；并发读取不会看到半写 frontmatter。
      await fs.writeFile(temporary, document, 'utf8')
      let published = false
      try { await fs.link(temporary, file); published = true } finally { await fs.unlink(temporary).catch(() => {}) }
      if (!published) throw Object.assign(new Error('任务文件发布失败'), { code: 'publish_failed' })
      const task = {
        id,
        objective,
        successCriteria: metadata.success_criteria,
        executionMode,
        status,
        phase: 'planning',
        priority,
        nextAction: nextAction || '等待智能体接手',
        assignedAgent: agent?.name || '系统自动分派',
        attempt: executionAttempt,
        ...(parentTaskId ? { parentTaskId: metadata.parent_task_id } : {}),
        createdAt: toUnixMs(createdAt),
        updatedAt: toUnixMs(createdAt),
      }
      const runState = { sessionId: '', turnId: '', promise: null, cancelRequested: false, cancelNotice: false, finalized: false, abandoned: false, stateQueue: Promise.resolve(), context, agentClaimed: false }
      // 先注册运行状态，再启动异步回合，使刚创建的 queued 任务也可立即取消。
      activeTasks.set(id, runState)
      const promise = runTask(task, agent, runState, context)
      runState.promise = promise
      void promise.finally(() => { if (activeTasks.get(id) === runState) activeTasks.delete(id) })
      return task
    } catch (error) {
      await fs.unlink(temporary).catch(() => {})
      if (error?.code !== 'EEXIST') throw error
      id = `${baseId}-${attempt + 2}`
      file = path.join(goals, `${id}.md`)
    }
  }
  throw Object.assign(new Error('无法生成唯一任务文件名'), { code: 'conflict' })
}

/** 取消排队或执行中的任务，并同步终止绑定的 Host 回合。 */
export async function cancelTask(id) {
  const taskId = safeTaskId(id)
  const activeRunState = activeTasks.get(taskId)
  const tasks = await scanTasks(activeRunState?.context)
  const task = tasks.find((item) => item.id === taskId)
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 'not_found' })
  if (['completed', 'failed', 'cancelled'].includes(task.status)) throw Object.assign(new Error('任务已经结束，不能取消'), { code: 'conflict' })
  const runState = activeRunState
  const context = runState?.context
  if (runState) {
    runState.cancelRequested = true
    runState.cancelNotice = true
    if (runState.sessionId) await requestEngine(`/session/${encodeURIComponent(runState.sessionId)}/abort`, { method: 'POST', headers: { Accept: 'application/json' } }, context).catch(() => {})
  }
  await (runState
    ? enqueueTaskMutation(runState, async () => {
      const latest = (await scanTasks(context)).find((item) => item.id === taskId)
      if (latest && !['completed', 'failed', 'cancelled'].includes(latest.status)) await updateTaskMetadata(taskId, { status: 'cancelled', phase: 'cancelled', next_action: '任务已取消，可重新执行', failure_reason: null }, context)
      if (!runState.finalized) {
        createNotification({ title: '任务已取消', body: `${task.objective}：任务已停止，可在任务中心重新执行。`, level: 'info' })
        runState.finalized = true
      }
    })
    : updateTaskMetadata(taskId, { status: 'cancelled', phase: 'cancelled', next_action: '任务已取消，可重新执行', failure_reason: null }, context))
  if (!runState) createNotification({ title: '任务已取消', body: `${task.objective}：任务已停止，可在任务中心重新执行。`, level: 'info' })
  return (await scanTasks(context)).find((item) => item.id === taskId) || { ...task, status: 'cancelled', nextAction: '任务已取消，可重新执行' }
}

/** 为失败或已取消任务创建新的执行实例，保留原任务作为历史记录。 */
export async function retryTask(id) {
  const taskId = safeTaskId(id)
  const task = (await scanTasks()).find((item) => item.id === taskId)
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 'not_found' })
  if (!['failed', 'cancelled'].includes(task.status)) throw Object.assign(new Error('只有失败或已取消任务可以重新执行'), { code: 'conflict' })
  return createTask({
    id: `${taskId}-retry`,
    objective: task.objective,
    successCriteria: task.successCriteria,
    executionMode: task.executionMode,
    priority: task.priority,
    nextAction: '重新排队执行',
    parentTaskId: task.parentTaskId || task.id,
    attempt: (task.attempt || 1) + 1,
  })
}

/** 删除已结束任务的 goal 文件；关联会话和产物作为执行证据保留。 */
export async function deleteTask(id) {
  const rawId = String(id || '').trim()
  const taskId = safeTaskId(rawId)
  if (!rawId || taskId !== rawId) throw Object.assign(new Error('任务编号格式无效'), { code: 'invalid_request' })
  const context = activeTasks.get(taskId)?.context || snapshotRuntimeContext()
  const file = path.join(context.home, 'goals', `${taskId}.md`)
  const pendingWrite = taskMetadataQueues.get(file)
  if (pendingWrite) await pendingWrite
  const task = (await scanTasks(context)).find((item) => item.id === taskId)
  if (!task) throw Object.assign(new Error('任务不存在'), { code: 'not_found' })
  const dependentRetry = (await scanTasks(context)).find((item) => item.parentTaskId === taskId)
  if (dependentRetry) throw Object.assign(new Error(`任务存在重试记录“${dependentRetry.id}”，请先保留或删除该记录`), { code: 'conflict' })
  const runState = activeTasks.get(taskId)
  if (runState && !runState.finalized) throw Object.assign(new Error('活动任务必须先停止，进入终态后才能删除'), { code: 'conflict' })
  if (!['completed', 'failed', 'cancelled'].includes(task.status)) throw Object.assign(new Error('活动任务必须先停止，进入终态后才能删除'), { code: 'conflict' })
  let stat
  try { stat = await fs.lstat(file) } catch (error) {
    if (error?.code === 'ENOENT') throw Object.assign(new Error('任务不存在'), { code: 'not_found' })
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw Object.assign(new Error('任务文件不是可删除的普通文件'), { code: 'forbidden' })
  await fs.unlink(file)
  activeTasks.delete(taskId)
}

function findWorkspaceEntry(workspaceId, sessionId = null) {
  if (sessionId) {
    const key = workspaceKey(sessionId, workspaceId)
    return agentWorkspaces.has(key) ? [key, agentWorkspaces.get(key)] : null
  }
  const matches = [...agentWorkspaces.entries()].filter(([, workspace]) => workspace.id === workspaceId)
  if (matches.length === 1) return matches[0]
  if (workspaceId === MAIN_WORKSPACE_ID && agentWorkspaces.has(legacyMainWorkspaceKey)) return [legacyMainWorkspaceKey, agentWorkspaces.get(legacyMainWorkspaceKey)]
  return null
}

function chineseWorkspaceName(value, task = '', stableKey = '') {
  const requested = String(value || '').trim()
  if (/\p{Script=Han}/u.test(requested)) return requested.replace(/[A-Za-z0-9_-]+/g, '').replace(/\s+/g, '').trim()
  const searchable = `${requested} ${task}`.toLowerCase()
  const mappings = [
    [['audit', 'review', 'verify', 'check', 'qa', 'test'], '审核验收'],
    [['research', 'investigate', 'analysis', 'analyze'], '调研分析'],
    [['transport', 'traffic', 'route', 'map', 'geo'], '交通地理'],
    [['hotel', 'lodging', 'food', 'dining'], '住宿餐饮'],
    [['document', 'report', 'visual'], '文档整理'],
    [['code', 'develop', 'implement', 'frontend', 'backend'], '开发实现'],
    [['data', 'dataset'], '数据处理'],
    [['plan', 'design', 'architect'], '方案设计'],
  ]
  const mapped = mappings.find(([keywords]) => keywords.some((keyword) => searchable.includes(keyword)))
  if (mapped) return mapped[1]
  let hash = 0x811c9dc5
  for (const character of `${searchable}|${stableKey}`) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  const digits = [...'零一二三四五六七八九甲乙丙丁戊己']
  const suffix = [12, 8, 4, 0].map((shift) => digits[(hash >>> shift) & 0xf]).join('')
  return `协作子任务${suffix}`
}

function ensureAgentWorkspace(id = MAIN_WORKSPACE_ID, metadata = {}) {
  const requestedSessionId = metadata.sessionId ? safeSessionId(metadata.sessionId) : null
  const found = findWorkspaceEntry(id, requestedSessionId)
  const existing = found?.[1]
  const sessionId = requestedSessionId || existing?.sessionId || null
  const key = workspaceKey(sessionId, id)
  const parentWorkspaceId = metadata.parentWorkspaceId || existing?.parentWorkspaceId
  const mainWorkspace = !parentWorkspaceId && (id === MAIN_WORKSPACE_ID || Boolean(sessionId && id === sessionId))
  const requestedName = metadata.workspaceName || existing?.name || ''
  const workspace = {
    id,
    name: mainWorkspace ? '我的空间' : chineseWorkspaceName(requestedName, metadata.task, id),
    kind: mainWorkspace ? 'main' : 'subagent',
    ...(parentWorkspaceId ? { parentWorkspaceId } : {}),
    ...(sessionId ? { sessionId } : {}),
    updatedAt: Number.isFinite(metadata.updatedAt) ? metadata.updatedAt : Date.now(),
  }
  agentWorkspaces.set(key, workspace)
  if (!workspaceAgentStates.has(key)) workspaceAgentStates.set(key, createAgentStates())
  return { key, workspace }
}

function safeWorkspaceOutputText(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 160)
}

function recordWorkspaceOutput(key, output) {
  const text = safeWorkspaceOutputText(output.text)
  if (!text) return
  let entries = workspaceOutputs.get(key)
  if (!entries) {
    entries = []
    workspaceOutputs.set(key, entries)
  }
  const previous = entries.at(-1)
  if (previous?.kind === output.kind && previous.text === text && previous.rosterNo === output.rosterNo && previous.state === output.state) return
  entries.push({
    id: randomUUID(),
    kind: output.kind,
    text,
    ...(output.state ? { state: output.state } : {}),
    ...(isRosterNo(output.rosterNo) ? { rosterNo: output.rosterNo } : {}),
    createdAt: Date.now(),
  })
  if (entries.length > MAX_WORKSPACE_OUTPUTS) entries.splice(0, entries.length - MAX_WORKSPACE_OUTPUTS)
}

function recordWorkspaceModelOutput(key, output) {
  let entries = workspaceOutputs.get(key)
  if (!entries) {
    entries = []
    workspaceOutputs.set(key, entries)
  }
  const existing = [...entries].reverse().find((entry) => entry.kind === 'model' && entry.streaming)
  const now = Date.now()
  if (output.kind === 'model_delta') {
    if (existing) {
      existing.text = truncateUnicode(`${existing.text}${output.text}`, MAX_WORKSPACE_MODEL_CHARS)
      existing.updatedAt = now
    } else {
      entries.push({ id: randomUUID(), kind: 'model', text: truncateUnicode(output.text, MAX_WORKSPACE_MODEL_CHARS), streaming: true, createdAt: now, updatedAt: now })
    }
  } else if (existing) {
    existing.text = truncateUnicode(output.text, MAX_WORKSPACE_MODEL_CHARS)
    existing.streaming = false
    existing.updatedAt = now
  } else {
    entries.push({ id: randomUUID(), kind: 'model', text: truncateUnicode(output.text, MAX_WORKSPACE_MODEL_CHARS), streaming: false, createdAt: now, updatedAt: now })
  }
  if (entries.length > MAX_WORKSPACE_OUTPUTS) entries.splice(0, entries.length - MAX_WORKSPACE_OUTPUTS)
}

/** 返回指定独立 Agent 空间的完整六人名册及状态。 */
export function listAgents(workspaceId = MAIN_WORKSPACE_ID, sessionId = null) {
  const key = findWorkspaceEntry(workspaceId, sessionId)?.[0] || workspaceKey(sessionId, workspaceId)
  const states = workspaceAgentStates.get(key) || createAgentStates()
  return ROSTER.map((agent) => ({ ...agent, state: states.get(agent.rosterNo)?.state || 'idle', task: states.get(agent.rosterNo)?.task ?? '' }))
}

/** 返回真实动作登记出的主 Agent/子 Agent 空间，不创建静态部门空间。 */
export function listAgentWorkspaces(sessionId = null) {
  const normalizedSessionId = sessionId ? safeSessionId(sessionId) : null
  if (normalizedSessionId && deletedWorkspaceSessions.has(normalizedSessionId)) return []
  const scoped = [...agentWorkspaces.entries()].filter(([, workspace]) => !normalizedSessionId || workspace.sessionId === normalizedSessionId)
  if (normalizedSessionId && !scoped.some(([, workspace]) => workspace.kind === 'main')) {
    const workspace = { id: normalizedSessionId, name: '我的空间', kind: 'main', sessionId: normalizedSessionId, updatedAt: 0 }
    scoped.push([workspaceKey(normalizedSessionId, normalizedSessionId), workspace])
  }
  return scoped
    .sort(([, left], [, right]) => Number(left.kind !== 'main') - Number(right.kind !== 'main') || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .map(([key, workspace]) => {
      const relations = [...(workspaceRelations.get(key)?.values() || [])]
      const outputs = workspaceOutputs.get(key) || []
      return { ...workspace, agents: listAgents(workspace.id, workspace.sessionId || null), ...(outputs.length ? { outputs: [...outputs] } : {}), ...(relations.length ? { relation: relations[0], relations } : {}) }
    })
}

/** 应用动作到对应 Agent 空间；旧动作缺少 workspaceId 时兼容到无会话主空间。 */
export function applyActionState(action) {
  if (action.type !== 'set_state') return
  const workspaceId = action.workspaceId || MAIN_WORKSPACE_ID
  const { key } = ensureAgentWorkspace(workspaceId, action)
  const rosterNo = action.rosterNo ?? ROSTER.find((agent) => agent.id === action.agentId)?.rosterNo
  if (rosterNo) {
    workspaceAgentStates.get(key).set(rosterNo, { state: action.state, task: action.task })
    if (action.task) recordWorkspaceOutput(key, { kind: 'activity', text: action.task, state: action.state, rosterNo })
  }
}

function inferHandoffSession(action) {
  if (action.sessionId) {
    const sessionId = safeSessionId(action.sessionId)
    for (const workspaceId of [action.fromWorkspaceId, action.toWorkspaceId]) {
      const foreignMain = [...agentWorkspaces.values()].find((workspace) => workspace.id === workspaceId && workspace.kind === 'main' && workspace.sessionId && workspace.sessionId !== sessionId)
      if (foreignMain) throw new Error('workspace_handoff 不允许引用其它会话的主空间')
    }
    return sessionId
  }
  const fromSessions = new Set([...agentWorkspaces.values()].filter((workspace) => workspace.id === action.fromWorkspaceId).map((workspace) => workspace.sessionId || ''))
  const toSessions = new Set([...agentWorkspaces.values()].filter((workspace) => workspace.id === action.toWorkspaceId).map((workspace) => workspace.sessionId || ''))
  const shared = [...fromSessions].filter((sessionId) => toSessions.has(sessionId))
  if (shared.length === 1) return shared[0] || null
  if (fromSessions.size === 1 && toSessions.size === 0) return [...fromSessions][0] || null
  if (toSessions.size === 1 && fromSessions.size === 0) return [...toSessions][0] || null
  if (fromSessions.size === 0 && toSessions.size === 0) return null
  throw new Error('workspace_handoff 缺少可唯一确定的 sessionId，已拒绝跨会话交接')
}

function clearWorkspaceRelation(key, expectedPeerWorkspaceId = null) {
  const relations = workspaceRelations.get(key)
  if (!relations) return
  const workspace = agentWorkspaces.get(key)
  const peerIds = expectedPeerWorkspaceId ? [expectedPeerWorkspaceId] : [...relations.keys()]
  for (const peerWorkspaceId of peerIds) {
    if (!relations.delete(peerWorkspaceId)) continue
    const peerKey = workspaceKey(workspace?.sessionId || null, peerWorkspaceId)
    const peerRelations = workspaceRelations.get(peerKey)
    peerRelations?.delete(workspace?.id)
    if (peerRelations?.size === 0) workspaceRelations.delete(peerKey)
  }
  if (relations.size === 0) workspaceRelations.delete(key)
}

function setWorkspaceRelation(key, relation) {
  let relations = workspaceRelations.get(key)
  if (!relations) {
    relations = new Map()
    workspaceRelations.set(key, relations)
  }
  relations.set(relation.peerWorkspaceId, relation)
}

function applyWorkspaceProjection(action) {
  if (action.type === 'workspace_handoff') {
    const sessionId = inferHandoffSession(action)
    if (action.phase === 'complete') {
      const from = findWorkspaceEntry(action.fromWorkspaceId, sessionId)
      const to = findWorkspaceEntry(action.toWorkspaceId, sessionId)
      if (!from && !to) return
      if (from) clearWorkspaceRelation(from[0], action.toWorkspaceId)
      if (to) clearWorkspaceRelation(to[0], action.fromWorkspaceId)
      return
    }
    const from = ensureAgentWorkspace(action.fromWorkspaceId, { workspaceName: action.fromWorkspaceName, sessionId })
    const to = ensureAgentWorkspace(action.toWorkspaceId, { workspaceName: action.toWorkspaceName, sessionId })
    if (from.workspace.sessionId !== to.workspace.sessionId) throw new Error('workspace_handoff 不允许跨会话建立关系')
    const rosterNo = action.rosterNo || 5
    const message = action.message || '正在跨空间交接'
    setWorkspaceRelation(from.key, { peerWorkspaceId: action.toWorkspaceId, direction: 'outgoing', phase: action.phase, rosterNo, message })
    setWorkspaceRelation(to.key, { peerWorkspaceId: action.fromWorkspaceId, direction: 'incoming', phase: action.phase, rosterNo, message })
    recordWorkspaceOutput(from.key, { kind: 'handoff', text: message, rosterNo })
    recordWorkspaceOutput(to.key, { kind: 'handoff', text: message, rosterNo })
    return
  }
  const workspaceId = action.workspaceId || MAIN_WORKSPACE_ID
  const { key } = ensureAgentWorkspace(workspaceId, action)
  if (action.type === 'register_artifact') {
    let artifacts = workspaceArtifacts.get(key)
    if (!artifacts) {
      artifacts = new Map()
      workspaceArtifacts.set(key, artifacts)
    }
    artifacts.set(action.path, { path: action.path, registeredAt: Date.now() })
    while (artifacts.size > MAX_WORKSPACE_ARTIFACTS) artifacts.delete(artifacts.keys().next().value)
    recordWorkspaceOutput(key, { kind: 'artifact', text: `已生成产物：${path.basename(action.path)}` })
    return
  }
  if (action.type === 'workspace_output') {
    recordWorkspaceModelOutput(key, action)
    return
  }
  applyActionState(action)
}

/** 复制空间投影，用于在整批动作校验或持久化失败时恢复原状态。 */
function snapshotWorkspaceProjection() {
  return {
    workspaces: new Map([...agentWorkspaces].map(([key, value]) => [key, { ...value }])),
    states: new Map([...workspaceAgentStates].map(([key, value]) => [key, new Map([...value].map(([rosterNo, state]) => [rosterNo, { ...state }]))])),
    relations: new Map([...workspaceRelations].map(([key, value]) => [key, new Map([...value].map(([peerId, relation]) => [peerId, { ...relation }]))])),
    artifacts: new Map([...workspaceArtifacts].map(([key, value]) => [key, new Map([...value].map(([artifactPath, artifact]) => [artifactPath, { ...artifact }]))])),
    outputs: new Map([...workspaceOutputs].map(([key, value]) => [key, value.map((output) => ({ ...output }))])),
  }
}

/** 恢复空间投影快照；旧主空间继续复用稳定的 agentStates 引用。 */
function restoreWorkspaceProjectionSnapshot(snapshot) {
  agentWorkspaces.clear()
  snapshot.workspaces.forEach((value, key) => agentWorkspaces.set(key, value))
  workspaceAgentStates.clear()
  agentStates.clear()
  const legacyStates = snapshot.states.get(legacyMainWorkspaceKey) || createAgentStates()
  legacyStates.forEach((value, key) => agentStates.set(key, value))
  snapshot.states.forEach((value, key) => workspaceAgentStates.set(key, key === legacyMainWorkspaceKey ? agentStates : value))
  workspaceRelations.clear()
  snapshot.relations.forEach((value, key) => workspaceRelations.set(key, value))
  workspaceArtifacts.clear()
  snapshot.artifacts.forEach((value, key) => workspaceArtifacts.set(key, value))
  workspaceOutputs.clear()
  snapshot.outputs.forEach((value, key) => workspaceOutputs.set(key, value))
}

/** 返回 AI Office 自己的空间投影状态文件；该路径从不回退到 OPENPAW_HOME。 */
export function resolveWorkspaceProjectionStatePath(stateDirectory = null) {
  const configured = stateDirectory || process.env.AI_OFFICE_STATE_DIR?.trim()
  const directory = configured ? path.resolve(configured) : path.join(os.tmpdir(), 'ai-office-react-main', 'action-gateway-state')
  return path.join(directory, WORKSPACE_STATE_FILE)
}

function workspacePersistenceOptions(options = {}) {
  const configured = options.stateDirectory || process.env.AI_OFFICE_STATE_DIR?.trim()
  const enabled = options.persistWorkspaceState === true || Boolean(configured)
  const file = resolveWorkspaceProjectionStatePath(configured || null)
  if (enabled && isWithinRoot(resolveHome(), file)) throw new Error('AI_OFFICE_STATE_DIR 不得位于 OPENPAW_HOME 内')
  return {
    enabled,
    file,
  }
}

function persistedWorkspaceSessions() {
  const sessionIds = [...new Set([...agentWorkspaces.values()].map((workspace) => workspace.sessionId).filter(Boolean))].sort()
  return sessionIds.map((sessionId) => {
    const workspaces = [...agentWorkspaces.entries()]
      .filter(([, workspace]) => workspace.sessionId === sessionId)
      .sort(([, left], [, right]) => left.id.localeCompare(right.id))
      .map(([key, workspace]) => ({
        id: workspace.id,
        name: workspace.name,
        kind: workspace.kind,
        ...(workspace.parentWorkspaceId ? { parentWorkspaceId: workspace.parentWorkspaceId } : {}),
        updatedAt: workspace.updatedAt,
        artifacts: [...(workspaceArtifacts.get(key)?.values() || [])].sort((left, right) => left.path.localeCompare(right.path)),
        outputs: (workspaceOutputs.get(key) || []).map((output) => ({ ...output })),
      }))
    return { version: WORKSPACE_STATE_VERSION, sessionId, workspaces }
  })
}

async function persistWorkspaceProjection(file) {
  const directory = path.dirname(file)
  await fs.mkdir(directory, { recursive: true })
  const temporary = path.join(directory, `.${WORKSPACE_STATE_FILE}.${process.pid}.${randomUUID()}.tmp`)
  const body = persistedWorkspaceSessions().map((record) => JSON.stringify(record)).join('\n')
  try {
    await fs.writeFile(temporary, body ? `${body}\n` : '', { encoding: 'utf8', flag: 'wx' })
    await fs.rename(temporary, file)
  } finally {
    await fs.unlink(temporary).catch(() => {})
  }
}

function parsePersistedWorkspaceSession(value) {
  if (!value || typeof value !== 'object' || value.version !== WORKSPACE_STATE_VERSION || !Array.isArray(value.workspaces)) return null
  let sessionId
  try { sessionId = safeSessionId(value.sessionId) } catch { return null }
  const parsed = []
  const ids = new Set()
  for (const candidate of value.workspaces) {
    if (!candidate || !isWorkspaceId(candidate.id) || ids.has(candidate.id) || !['main', 'subagent'].includes(candidate.kind)) continue
    if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 200) continue
    if (candidate.parentWorkspaceId != null && !isWorkspaceId(candidate.parentWorkspaceId)) continue
    const artifacts = Array.isArray(candidate.artifacts)
      ? candidate.artifacts.filter((artifact) => typeof artifact?.path === 'string' && artifact.path.length <= 1000 && Number.isFinite(artifact.registeredAt))
      : []
    const outputs = Array.isArray(candidate.outputs)
      ? candidate.outputs.filter((output) => typeof output?.id === 'string'
        && ['activity', 'artifact', 'handoff', 'model'].includes(output.kind)
        && typeof output.text === 'string'
        && Array.from(output.text).length <= (output.kind === 'model' ? MAX_WORKSPACE_MODEL_CHARS : 160)
        && Number.isFinite(output.createdAt)
        && (output.rosterNo == null || isRosterNo(output.rosterNo)))
        .map((output) => output.kind === 'model' ? { ...output, streaming: false } : output)
        .slice(-MAX_WORKSPACE_OUTPUTS)
      : []
    ids.add(candidate.id)
    parsed.push({ candidate, artifacts, outputs })
  }
  if (parsed.length === 0) return null
  return { sessionId, parsed }
}

function removeSessionProjection(sessionId) {
  for (const [key, workspace] of [...agentWorkspaces.entries()]) {
    if (workspace.sessionId !== sessionId) continue
    agentWorkspaces.delete(key)
    workspaceAgentStates.delete(key)
    workspaceRelations.delete(key)
    workspaceArtifacts.delete(key)
    workspaceOutputs.delete(key)
  }
}

async function restoreWorkspaceProjection(file) {
  let text
  try { text = await fs.readFile(file, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  const records = new Map()
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = parsePersistedWorkspaceSession(JSON.parse(line))
      if (parsed) records.set(parsed.sessionId, parsed)
    } catch {
      // 单个损坏条目不能阻断其它会话空间恢复。
    }
  }
  for (const [sessionId, record] of records) {
    removeSessionProjection(sessionId)
    for (const { candidate, artifacts, outputs } of record.parsed) {
      const { key } = ensureAgentWorkspace(candidate.id, {
        workspaceName: candidate.name,
        parentWorkspaceId: candidate.parentWorkspaceId,
        sessionId,
        updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : 0,
      })
      if (artifacts.length) workspaceArtifacts.set(key, new Map(artifacts.map((artifact) => [artifact.path, artifact])))
      if (outputs.length) workspaceOutputs.set(key, outputs.map((output) => ({ ...output })))
    }
  }
}

function enqueueWorkspaceProjectionMutation(operation) {
  const result = workspaceProjectionMutation.then(operation, operation)
  workspaceProjectionMutation = result.catch(() => {})
  return result
}
/**
 * 清空动作和通知，并将所有角色恢复为空闲。
 * 测试或热重载前会先取消并等待后台任务，避免旧任务在清空后继续写入新状态。
 */
export async function resetGatewayState() {
  await workspaceProjectionMutation.catch(() => {})
  const running = [...activeTasks.entries()]
  for (const [, runState] of running) {
    runState.abandoned = true
    runState.cancelRequested = true
    runState.cancelNotice = true
    if (runState.sessionId) await requestEngine(`/session/${encodeURIComponent(runState.sessionId)}/abort`, { method: 'POST', headers: { Accept: 'application/json' } }, runState.context).catch(() => {})
  }
  const promises = running.map(([, runState]) => runState.promise).filter(Boolean)
  if (promises.length) await Promise.race([Promise.allSettled(promises), new Promise((resolve) => setTimeout(resolve, 3000))])
  if (taskMetadataQueues.size) await Promise.allSettled([...taskMetadataQueues.values()])
  activeTasks.clear()
  taskMetadataQueues.clear()
  sessionSummaryCache = null
  sessionSummaryCacheExpiresAt = 0
  sessionSummaryRequest = null
  actions.splice(0)
  actionJournal.splice(0)
  nextActionCursor = 0
  conversationCreateRequests.clear()
  conversationMessageRequests.clear()
  notifications.splice(0, notifications.length, { id: 'office-ready', title: '办公室已就绪', body: 'OpenPaw 与 AI Office 已完成连接。', level: 'info', createdAt: Date.now(), read: false })
  ROSTER.forEach((agent) => agentStates.set(agent.rosterNo, { state: 'idle', task: undefined }))
  ROSTER.forEach((agent) => agentTaskOwners.set(agent.rosterNo, new Set()))
  workspaceAgentStates.clear()
  workspaceAgentStates.set(legacyMainWorkspaceKey, agentStates)
  agentWorkspaces.clear()
  agentWorkspaces.set(legacyMainWorkspaceKey, { id: MAIN_WORKSPACE_ID, name: '我的空间', kind: 'main', updatedAt: 0 })
  workspaceRelations.clear()
  workspaceArtifacts.clear()
  workspaceOutputs.clear()
  deletedWorkspaceSessions.clear()
}

/** 创建并保存一条网关进程内通知。 */
function createNotification(payload) {
  const title = typeof payload?.title === 'string' ? payload.title.trim() : ''
  if (!title) throw Object.assign(new Error('通知标题不能为空'), { code: 'invalid_request' })
  const notification = { id: randomUUID(), title: title.slice(0, 200), body: typeof payload.body === 'string' ? payload.body.trim().slice(0, 1000) : '', level: ['info', 'success', 'warning', 'error'].includes(payload.level) ? payload.level : 'info', createdAt: Date.now(), read: false }
  notifications.unshift(notification)
  return notification
}

/** 统一写入 JSON 响应头和正文；204 响应不写入正文。 */
function sendJson(res, status, data) {
  const body = status === 204 ? '' : JSON.stringify(data)
  res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }); res.end(body)
}
/** 流式读取请求体并执行字节上限校验，超限立即停止累积。 */
function readBody(req, maxBytes = MAX_REQUEST_BYTES) {
  return new Promise((resolve, reject) => {
    let body = ''; let bytes = 0; let rejected = false
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      if (rejected) return
      bytes += Buffer.byteLength(chunk, 'utf8')
      if (bytes > maxBytes) {
        rejected = true
        reject(Object.assign(new Error(`请求体超过 ${Math.trunc(maxBytes / 1024 / 1024)}MB 限制`), { code: 'too_large' }))
        req.resume()
        return
      }
      body += chunk
    })
    req.on('end', () => { if (!rejected) resolve(body) })
    req.on('error', (error) => { if (!rejected) reject(error) })
  })
}

/** 读取允许的跨域来源；未配置时仅允许本地开发端口。 */
function allowedOrigins() {
  const configured = String(process.env.OFFICE_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
  return new Set(configured.length > 0 ? configured : ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173'])
}

/** 校验请求 Origin 并设置最小 CORS 响应头。 */
function applyCors(req, res) {
  const origin = req.headers.origin
  if (!origin) return true
  if (!allowedOrigins().has(origin)) return false
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept,Authorization')
  return true
}

/**
 * 功能：创建动作 Gateway HTTP 服务及全部已登记 `/office/*`、`/actions` 路由。
 * 返回：尚未 listen 的 Node HTTP Server，调用方负责绑定端口和生命周期。
 * 错误：路由内部将输入、文件和引擎错误转换为明确 HTTP 状态码；未知路径返回 404。
 * 状态：`POST /actions` 原子入队，`GET /actions` 读取后清空；Office 投影失败不改变 Host 回合。
 * 并发与取消：引擎请求使用 5 秒超时；关闭流程会中止活动任务。
 * 权限：CORS、Basic Authentication 转发、工作区根和请求体限制在此统一执行。
 * 关联：`API-OFFICE-GATEWAY-001`、`REQ-B-OFFICE-003`、`REQ-B-OFFICE-005`。
 */
export function createGatewayServer(options = {}) {
  engineHostOrigin()
  const workspacePersistence = workspacePersistenceOptions(options)
  const workspaceProjectionReady = workspacePersistence.enabled
    ? restoreWorkspaceProjection(workspacePersistence.file).catch((error) => {
      console.error(`[办公室动作网关] 空间投影恢复失败：${error instanceof Error ? error.message : String(error)}`)
    })
    : Promise.resolve()
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (!applyCors(req, res)) { sendJson(res, 403, { error: '不允许的跨域来源' }); return }
    if (req.method === 'OPTIONS') { sendJson(res, 204, null); return }
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/global/health')) { sendJson(res, 200, { ok: true, queued: actions.length }); return }
    if (req.method === 'GET' && url.pathname === '/office/events') {
      await proxyOfficeConversationEvents(req, res)
      return
    }
    if (req.method === 'GET' && url.pathname === '/actions') {
      if (url.searchParams.has('after')) {
        const rawCursor = url.searchParams.get('after')
        if (rawCursor === 'latest') {
          const oldestCursor = actionJournal[0]?.cursor ?? nextActionCursor + 1
          sendJson(res, 200, { actions: [], nextCursor: nextActionCursor, oldestCursor, gap: false, reset: false })
          return
        }
        const cursor = rawCursor === null || rawCursor.trim() === '' ? 0 : Number(rawCursor)
        if (!Number.isSafeInteger(cursor) || cursor < 0) { sendJson(res, 400, { error: 'after 必须是非负整数游标' }); return }
        sendJson(res, 200, actionsAfterCursor(cursor))
      } else {
        sendJson(res, 200, { actions: actions.splice(0), nextCursor: nextActionCursor })
      }
      return
    }
    if (req.method === 'POST' && url.pathname === '/actions') {
      try {
        const raw = await readBody(req)
        const batch = normalizeActions(raw.trim() ? JSON.parse(raw) : null)
        await workspaceProjectionReady
        let accepted = 0
        await enqueueWorkspaceProjectionMutation(async () => {
          // 删除和动作 POST 可能并发到达；必须在串行投影事务内再次读取墓碑，
          // 否则删除完成后才取得执行权的旧动作仍可能重建该会话空间。
          const liveBatch = batch.filter((action) => !action.sessionId || !deletedWorkspaceSessions.has(action.sessionId))
          const snapshot = snapshotWorkspaceProjection()
          try {
            liveBatch.forEach(applyWorkspaceProjection)
            if (workspacePersistence.enabled) await persistWorkspaceProjection(workspacePersistence.file)
          } catch (error) {
            restoreWorkspaceProjectionSnapshot(snapshot)
            throw error
          }
          appendActions(liveBatch)
          accepted = liveBatch.length
        })
        sendJson(res, 202, { accepted, ignored: batch.length - accepted, queued: actions.length, nextCursor: nextActionCursor })
      }
      catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : '请求体无效' }) }
      return
    }
    if (url.pathname === '/actions') {
      sendJson(res, 405, { error: '请求方法不允许' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/sessions') {
      try { sendJson(res, 200, await listOfficeSessions()) } catch (error) { sendJson(res, 500, { error: String(error) }) }
      return
    }
    const scans = { '/office/skills': listSkills, '/office/files': listFiles, '/office/tasks': listTasks }
    const scanner = req.method === 'GET' && Object.hasOwn(scans, url.pathname) ? scans[url.pathname] : undefined
    if (scanner) { try { sendJson(res, 200, await scanner()) } catch (error) { sendJson(res, 500, { error: String(error) }) }; return }
    if (req.method === 'GET' && url.pathname === '/office/file') {
      try { sendJson(res, 200, await readWorkspaceFile(url.searchParams.get('path') || '')) }
      catch (error) {
        const status = error?.code === 'invalid_configuration' ? 503 : error?.code === 'forbidden' ? 403 : error?.code === 'too_large' ? 413 : error?.code === 'invalid_path' ? 400 : 404
        sendJson(res, status, { error: error instanceof Error ? error.message : '文件读取失败' })
      }
      return
    }
    const artifactsMatch = req.method === 'GET' ? url.pathname.match(/^\/office\/conversations\/([^/]+)\/artifacts$/) : null
    if (artifactsMatch) {
      try {
        await workspaceProjectionReady
        sendJson(res, 200, await listConversationArtifacts(decodeURIComponent(artifactsMatch[1]), url.searchParams.get('workspaceId')))
      }
      catch (error) {
        const status = error?.code === 'forbidden' ? 403 : error?.code === 'invalid_path' ? 400 : 500
        sendJson(res, status, { error: error instanceof Error ? error.message : '产物读取失败' })
      }
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/artifact-image') {
      try {
        const artifact = await readWorkspaceArtifactImage(url.searchParams.get('path') || '')
        res.statusCode = 200
        res.setHeader('Content-Type', artifact.mimeType)
        res.setHeader('Content-Length', String(artifact.content.byteLength))
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.end(artifact.content)
      } catch (error) {
        const status = error?.code === 'invalid_configuration' ? 503 : error?.code === 'forbidden' ? 403 : error?.code === 'too_large' ? 413 : error?.code === 'invalid_path' ? 400 : 404
        sendJson(res, status, { error: error instanceof Error ? error.message : '图片产物读取失败' })
      }
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/workspace') {
      sendJson(res, 200, { root: resolveWorkspace() || '' })
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/skill') {
      try { sendJson(res, 200, await readSkillFile(url.searchParams.get('path') || '')) }
      catch (error) {
        const status = error?.code === 'forbidden' ? 403 : error?.code === 'too_large' ? 413 : error?.code === 'invalid_path' ? 400 : 404
        sendJson(res, status, { error: error instanceof Error ? error.message : '技能读取失败' })
      }
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/permissions') {
      try { await sendEngineResult(res, await requestEngine('/permission', { headers: { Accept: 'application/json' } })) }
      catch (error) { sendJson(res, 503, { error: error instanceof Error ? error.message : '无法连接 OpenPaw 引擎' }) }
      return
    }
    if (req.method === 'POST' && url.pathname === '/office/conversations') {
      try { const raw = await readBody(req); sendJson(res, 201, await createOfficeConversation(raw.trim() ? JSON.parse(raw) : null)) }
      catch (error) {
        const status = error?.code === 'engine_unavailable' ? 503 : error?.code === 'engine_error' ? (error.status || 502) : error?.code === 'conflict' ? 409 : 400
        sendJson(res, status, { error: error instanceof Error ? error.message : '对话创建失败' })
      }
      return
    }
    const messageMatch = req.method === 'POST' ? url.pathname.match(/^\/office\/conversations\/([^/]+)\/messages$/) : null
    if (messageMatch) {
      try {
        const raw = await readBody(req); const payload = raw.trim() ? JSON.parse(raw) : null; const text = extractConversationText(payload)
        if (!text) throw Object.assign(new Error('对话内容不能为空'), { code: 'invalid_request' })
        const sessionId = decodeURIComponent(messageMatch[1])
        const accepted = await promptOfficeConversationOnce(sessionId, text, conversationRequestId(payload))
        sendJson(res, 202, { accepted: true, sessionId, ...(accepted.turnID ? { turnID: accepted.turnID } : {}) })
        void reconcileResumedTask(sessionId, text, accepted.turnID).catch((error) => {
          console.warn(`[办公室动作网关] 任务续跑状态收敛失败：${error instanceof Error ? error.message : String(error)}`)
        })
      } catch (error) {
        const status = error?.code === 'engine_unavailable' ? 503 : error?.code === 'engine_error' ? (error.status || 502) : 400
        sendJson(res, status, {
          error: error instanceof Error ? error.message : '消息发送失败',
          ...(typeof error?.hostCode === 'string' ? { code: error.hostCode } : {}),
          ...(typeof error?.retryable === 'boolean' ? { retryable: error.retryable } : {}),
        })
      }
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/conversations/status') {
      try {
        const result = await requestEngine('/session/status', { headers: { Accept: 'application/json' } })
        if (result.response.ok) sendJson(res, result.response.status, normalizeOfficeConversationStatuses(result.body))
        else await sendEngineResult(res, result)
      }
      catch (error) { sendJson(res, error?.code === 'engine_unavailable' ? 503 : 500, { error: error instanceof Error ? error.message : '会话状态读取失败' }) }
      return
    }
    const conversationAbortMatch = req.method === 'POST' ? url.pathname.match(/^\/office\/conversations\/([^/]+)\/abort$/) : null
    if (conversationAbortMatch) {
      try {
        const sessionId = decodeURIComponent(conversationAbortMatch[1])
        await sendEngineResult(res, await requestEngine(`/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST', headers: { Accept: 'application/json' } }))
      } catch (error) { sendJson(res, error?.code === 'engine_unavailable' ? 503 : 500, { error: error instanceof Error ? error.message : '停止回合失败' }) }
      return
    }
    const conversationStatusMatch = req.method === 'GET' ? url.pathname.match(/^\/office\/conversations\/([^/]+)\/status$/) : null
    if (conversationStatusMatch) {
      try {
        const sessionId = decodeURIComponent(conversationStatusMatch[1])
        const result = await requestEngine('/session/status', { headers: { Accept: 'application/json' } })
        if (!result.response.ok) { await sendEngineResult(res, result); return }
        const status = normalizeOfficeConversationStatuses(result.body)[sessionId]
        // 对话状态接口只返回目标 session，避免并行会话之间串线和误判。
        sendJson(res, 200, status ? { [sessionId]: status } : {})
      }
      catch (error) { sendJson(res, error?.code === 'engine_unavailable' ? 503 : 500, { error: error instanceof Error ? error.message : '会话状态读取失败' }) }
      return
    }
    const conversationMessagesMatch = req.method === 'GET' ? url.pathname.match(/^\/office\/conversations\/([^/]+)\/messages$/) : null
    if (conversationMessagesMatch) {
      try {
        const sessionId = decodeURIComponent(conversationMessagesMatch[1])
        // turns 是失败/取消正文的增强来源；它不可用时仍必须返回已经可读的普通
        // user/assistant 正文，不能让诊断路由故障扩大成整段历史不可见。
        const [messageResult, turnResult] = await readOfficeConversationProjection(sessionId)
        await sendOfficeConversationMessages(
          res,
          messageResult,
          turnResult,
          sessionId,
          () => readOfficeConversationProjection(sessionId),
        )
      }
      catch (error) { sendJson(res, error?.code === 'engine_unavailable' ? 503 : 500, { error: error instanceof Error ? error.message : '会话消息读取失败' }) }
      return
    }
    const deleteMatch = req.method === 'DELETE' ? url.pathname.match(/^\/office\/conversations\/([^/]+)$/) : null
    if (deleteMatch) {
      try {
        const sessionId = decodeURIComponent(deleteMatch[1])
        const result = await requestEngine(`/session/${encodeURIComponent(sessionId)}`, { method: 'DELETE', headers: { Accept: 'application/json' } })
        if (result.response.status === 404) { sendJson(res, 404, { error: '会话不存在' }); return }
        if (!result.response.ok) { await sendEngineResult(res, result); return }
        invalidateOfficeSessions()
        await workspaceProjectionReady
        await enqueueWorkspaceProjectionMutation(async () => {
          deletedWorkspaceSessions.add(sessionId)
          removeSessionProjection(sessionId)
          removeSessionActions(sessionId)
          if (workspacePersistence.enabled) await persistWorkspaceProjection(workspacePersistence.file)
        })
        sendJson(res, 204, null)
      } catch (error) { sendJson(res, error?.code === 'engine_unavailable' ? 503 : 500, { error: error instanceof Error ? error.message : '会话删除失败' }) }
      return
    }
    const permissionMatch = req.method === 'POST' ? url.pathname.match(/^\/office\/permissions\/([^/]+)\/reply$/) : null
    if (permissionMatch) {
      try {
        const raw = await readBody(req); const payload = raw.trim() ? JSON.parse(raw) : null
        if (!payload || !['once', 'always', 'reject'].includes(payload.reply)) { sendJson(res, 400, { error: 'reply 必须是 once、always 或 reject' }); return }
        await sendEngineResult(res, await requestEngine(`/permission/${encodeURIComponent(decodeURIComponent(permissionMatch[1]))}/reply`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: payload.reply, reason: payload.reason }) }))
      } catch (error) { sendJson(res, error?.code === 'engine_unavailable' ? 503 : 400, { error: error instanceof Error ? error.message : '权限回复失败' }) }
      return
    }
    if (req.method === 'POST' && url.pathname === '/office/tasks') {
      if (shuttingDown) { sendJson(res, 503, { error: '办公室网关正在关闭' }); return }
      try { const raw = await readBody(req); sendJson(res, 201, await createTask(raw.trim() ? JSON.parse(raw) : null)) }
      catch (error) {
        const status = error?.code === 'forbidden' ? 403 : error?.code === 'conflict' ? 409 : error?.code === 'invalid_request' ? 400 : 500
        sendJson(res, status, { error: error instanceof Error ? error.message : '任务创建失败' })
      }
      return
    }
    const taskActionMatch = req.method === 'POST' ? url.pathname.match(/^\/office\/tasks\/([^/]+)\/(cancel|retry)$/) : null
    if (taskActionMatch) {
      try {
        const taskId = decodeURIComponent(taskActionMatch[1])
        const result = taskActionMatch[2] === 'cancel' ? await cancelTask(taskId) : await retryTask(taskId)
        sendJson(res, 200, result)
      } catch (error) {
        const status = error?.code === 'not_found' ? 404 : error?.code === 'conflict' ? 409 : error?.code === 'engine_unavailable' ? 503 : 400
        sendJson(res, status, { error: error instanceof Error ? error.message : '任务操作失败' })
      }
      return
    }
    const taskDeleteMatch = req.method === 'DELETE' ? url.pathname.match(/^\/office\/tasks\/([^/]+)$/) : null
    if (taskDeleteMatch) {
      try {
        await deleteTask(decodeURIComponent(taskDeleteMatch[1]))
        sendJson(res, 204, null)
      } catch (error) {
        const status = error?.code === 'not_found' ? 404 : error?.code === 'conflict' ? 409 : error?.code === 'forbidden' ? 403 : error?.code === 'invalid_request' ? 400 : 500
        sendJson(res, status, { error: error instanceof Error ? error.message : '任务删除失败' })
      }
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/notifications') {
      sendJson(res, 200, notifications)
      return
    }
    if (req.method === 'POST' && url.pathname === '/office/notifications') {
      try { const raw = await readBody(req); sendJson(res, 201, createNotification(raw.trim() ? JSON.parse(raw) : null)) }
      catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : '通知创建失败' }) }
      return
    }
    const notificationReadMatch = req.method === 'POST' ? url.pathname.match(/^\/office\/notifications\/([^/]+)\/read$/) : null
    if (notificationReadMatch) {
      const notification = notifications.find((item) => item.id === decodeURIComponent(notificationReadMatch[1]))
      if (!notification) sendJson(res, 404, { error: '通知不存在' })
      else { notification.read = true; sendJson(res, 200, notification) }
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/agents') {
      await workspaceProjectionReady
      const workspaceId = url.searchParams.get('workspaceId') || MAIN_WORKSPACE_ID
      const sessionId = url.searchParams.get('sessionId')
      if (!isWorkspaceId(workspaceId)) sendJson(res, 400, { error: 'workspaceId 格式无效' })
      else {
        try { sendJson(res, 200, listAgents(workspaceId, sessionId ? safeSessionId(sessionId) : null)) }
        catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : 'sessionId 格式无效' }) }
      }
      return
    }
    if (req.method === 'GET' && url.pathname === '/office/workspaces') {
      try {
        await workspaceProjectionReady
        sendJson(res, 200, listAgentWorkspaces(url.searchParams.get('sessionId')))
      }
      catch (error) { sendJson(res, 400, { error: error instanceof Error ? error.message : 'sessionId 格式无效' }) }
      return
    }
    sendJson(res, 404, { error: '未找到请求资源' })
  })
  if (options.autoRecover === true) {
    server.once('listening', () => {
      let context
      try { context = snapshotRuntimeContext() } catch (error) {
        console.error(`[办公室动作网关] 启动恢复配置无效：${error instanceof Error ? error.message : String(error)}`)
        return
      }
      void startPersistedTaskRecovery(context).catch((error) => {
        console.error(`[办公室动作网关] 启动恢复扫描失败：${error instanceof Error ? error.message : String(error)}`)
      })
    })
  }
  return server
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const port = Number(process.env.OFFICE_ACTION_GATEWAY_PORT ?? DEFAULT_PORT); const server = createGatewayServer({ autoRecover: true, persistWorkspaceState: true }); server.listen(port, '127.0.0.1', () => { console.log(`[办公室动作网关] 正在监听 http://127.0.0.1:${port}`); console.log('[办公室动作网关] 动作提交接口负责入队，动作读取接口读取后会清空队列') })
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await Promise.allSettled([...activeTasks.values()].filter((runState) => runState.sessionId).map((runState) => requestEngine(`/session/${encodeURIComponent(runState.sessionId)}/abort`, { method: 'POST', headers: { Accept: 'application/json' } }, runState.context).catch(() => {})))
    await Promise.race([Promise.allSettled([...activeTasks.values()].map((runState) => runState.promise)), new Promise((resolve) => setTimeout(resolve, 3000))])
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGINT', () => { void shutdown() }); process.on('SIGTERM', () => { void shutdown() })
}
