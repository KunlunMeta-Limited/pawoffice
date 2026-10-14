import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { AssistantText, MermaidDiagram } from '@/components/AssistantText'
import { ArtifactHtmlPreview } from '@/components/ArtifactHtmlPreview'
import { ArtifactChart } from '@/components/ArtifactChart'
import { ArtifactJsonPreview } from '@/components/ArtifactJsonPreview'
import { ArtifactMap } from '@/components/ArtifactMap'
import { ArtifactJavaScriptPreview, ConversationArtifactDock } from '@/components/ConversationArtifacts'
import { parseArtifactChart } from '@/components/artifactChartSpec'
import { parseArtifactMap } from '@/components/artifactMapData'
import {
  MAIN_OFFICE_WORKSPACE,
  MAIN_OFFICE_WORKSPACE_ID,
  OFFICE_WORKSPACE_OVERVIEW_ID,
  workspaceLabel,
  type OfficeWorkspaceId,
} from '@/config/officeWorkspaces'
import { officeGatewayApi } from '@/services/officeGatewayApi'
import {
  clearConversationView,
  EMPTY_CONVERSATION_VIEW,
  getConversationSnapshot,
  subscribeConversationView,
  updateConversationView,
} from '@/services/conversationViewStore'
import { useConversationController } from '@/services/useConversationController'
import { useOfficeResource, type OfficeResource } from '@/services/useOfficeResource'
import {
  getOfficeAgentStatusSnapshot,
  subscribeOfficeAgents,
} from '@/store/officeStore'
import {
  getConversationSessionsSnapshot,
  invalidateConversationSessions,
  prefetchConversationSessions,
  useConversationSessions,
} from '@/services/conversationSessionCache'
import type {
  OfficeAgentSummary,
  OfficeAgentWorkspaceSummary,
  OfficeConversationArtifact,
  OfficeConversationMessage,
  OfficeConversationResult,
  OfficeFileSummary,
  OfficeNotification,
  OfficeSessionSummary,
  OfficeSkillSummary,
  OfficeTaskSummary,
  OfficeWorkspaceSummary,
} from '@/types/officeData'

type NavItem = { icon: string; label: string; unsupported?: boolean }
const NAV_ITEMS: NavItem[] = [
  { icon: '⌂', label: '首页' },
  { icon: '▤', label: '任务中心' },
  { icon: '♙', label: '智能体' },
  { icon: '□', label: '文件中心' },
  { icon: '☆', label: '技能中心' },
  { icon: '◫', label: '浏览器助手', unsupported: true },
  { icon: '▱', label: '对话中心' },
  { icon: '□', label: '日程日历', unsupported: true },
  { icon: '♢', label: '通知中心' },
]

type QuickTool = { icon: string; label: string; unsupported?: boolean }
const QUICK_TOOLS: QuickTool[] = [
  { icon: '□', label: '文件浏览' },
  { icon: '◎', label: '打开浏览器' },
  { icon: '⌗', label: '截图 OCR' },
  { icon: '♩', label: '语音输入', unsupported: true },
]
const TOOLBAR_ITEMS: Array<{ icon: string; label: string; primary?: boolean }> = [
  { icon: '◷', label: '任务调度' },
  { icon: '□', label: '安排会议' },
  { icon: '⇩', label: '导出日报' },
]
const CONVERSATION_SELECTION_STORAGE_KEY = 'ai-office.ui.selected-session.v1'
const CONVERSATION_READ_REPLIES_STORAGE_KEY = 'ai-office.ui.read-replies.v1'

function readStoredConversationSelection() {
  try {
    return window.sessionStorage.getItem(CONVERSATION_SELECTION_STORAGE_KEY)
  } catch {
    return null
  }
}

function readStoredReplyKeys() {
  try {
    const value = window.localStorage.getItem(CONVERSATION_READ_REPLIES_STORAGE_KEY)
    const parsed = value ? JSON.parse(value) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

/** 读取每个会话最近一次已查看的助手回复标识；存储不可用时按空集合降级。 */
function storeReplyKeys(keys: Record<string, string>) {
  try {
    window.localStorage.setItem(CONVERSATION_READ_REPLIES_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(keys).slice(-100))))
  } catch {
    // 浏览器存储不可用时，未读状态仍在当前页面内有效。
  }
}

/**
 * AI Office 主导航允许选择的中心名称。
 *
 * 功能：限制导航状态和面板路由只能使用已登记的中文中心名称。
 * 字段/变体语义：每个字面量唯一对应一个右侧业务面板。
 * 数据来源：侧栏、底部工具栏和任务跳转操作。
 * 数据去向：`App` 的受控导航状态与 `OfficeRightPanel` 面板选择。
 * 约束：新增中心必须同步导航项、面板分派、样式和测试。
 * 稳定性：前端内部公共导航契约。
 * 关联：`CHG-2026-0013`。
 */
/** 中文门禁摘要：限制导航状态只能使用已登记的业务中心名称。 */
export type OfficeSection = '首页' | '任务中心' | '智能体' | '文件中心' | '技能中心' | '浏览器助手' | '对话中心' | '日程日历' | '通知中心'

function resourceMessage(state: 'idle' | 'loading' | 'ready' | 'error', empty: boolean) {
  if (state === 'loading') return '加载中…'
  if (state === 'error') return '无法连接办公室网关'
  if (empty) return '暂无数据'
  return null
}

function DataState({ state, empty, error }: { state: 'idle' | 'loading' | 'ready' | 'error'; empty: boolean; error?: Error | null }) {
  const message = resourceMessage(state, empty)
  return <>{message ? <p className={`data-state data-state-${state}`}>{message}</p> : null}{state === 'ready' && error ? <p className="data-state data-state-warning">无法连接办公室网关，当前显示最近一次数据</p> : null}</>
}

function taskStatus(status?: string) {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : ''
  if (/^(done|complete|completed|success|已完成|完成)$/.test(normalized) || normalized.includes('已完成')) return { label: '已完成', tone: 'done' }
  if (/^(queued|待开始|排队中)$/.test(normalized)) return { label: '待开始', tone: 'queued' }
  if (/^(cancelled|canceled|已取消|取消)$/.test(normalized)) return { label: '已取消', tone: 'blocked' }
  if (/^(blocked|pending|待处理|阻塞|待办)$/.test(normalized) || normalized.includes('阻塞')) return { label: '待处理', tone: 'blocked' }
  if (/^(failed|failure|error|失败)$/.test(normalized)) return { label: '失败', tone: 'failed' }
  if (/^(in_progress|running|working|进行中)$/.test(normalized) || normalized.includes('进行')) return { label: '进行中', tone: 'active' }
  return { label: status || '未开始', tone: 'unknown' }
}

const TASK_PHASES = [
  { id: 'planning', label: '规划' },
  { id: 'executing', label: '执行' },
  { id: 'verifying', label: '验证' },
  { id: 'delivering', label: '交付' },
] as const

function taskPhaseIndex(task: OfficeTaskSummary) {
  if (task.status === 'completed' || task.phase === 'completed') return TASK_PHASES.length
  const phase = task.phase === 'failed' || task.phase === 'cancelled' ? task.failureStage : task.phase
  return TASK_PHASES.findIndex((item) => item.id === phase)
}

function taskPhaseLabel(phase?: string) {
  return TASK_PHASES.find((item) => item.id === phase)?.label || phase || '未知阶段'
}

function TaskStageTrack({ task }: { task: OfficeTaskSummary }) {
  const completed = task.status === 'completed'
  const stopped = task.status === 'failed' || task.status === 'cancelled'
  const current = taskPhaseIndex(task)
  return <ol className="task-stage-track" aria-label="目标执行阶段">
    {TASK_PHASES.map((phase, index) => {
      const state = completed || index < current ? 'done' : index === current ? (stopped ? 'stopped' : 'current') : 'pending'
      return <li key={phase.id} className={state}><span aria-hidden="true" /><em>{phase.label}</em></li>
    })}
  </ol>
}

function agentStateLabel(state: OfficeAgentSummary['state']) {
  const labels: Record<OfficeAgentSummary['state'], string> = {
    idle: '空闲', walking: '移动中', working: '工作中', talking: '交流中', thinking: '思考中',
  }
  return labels[state] || state
}

const HANDOFF_AGENT_IDS = new Set(['code-agent', 'file-agent', 'app-agent'])

/**
 * 功能：渲染全局导航、工作空间和任务数量，并为对话中心提供交互预取入口。
 * 参数：active 为当前中心；onSelect 接收用户选择的新中心。
 * 返回：左侧导航 React 节点。
 * 错误：任务数量读取失败时保持导航可用，不显示错误详情。
 * 状态：任务 badge 独立轮询；不持有对话正文或会话运行态。
 * 并发与取消：hover/focus 预取复用共享会话请求；组件卸载会停止任务轮询。
 * 权限：只读取 Gateway 公开的任务与会话摘要。
 * 关联：CHG-2026-0013、conversationSessionCache。
 */
/** 中文门禁摘要：渲染全局导航并独立维护任务数量 badge。 */
export function OfficeSidebar({ active = '首页', selectedWorkspace = MAIN_OFFICE_WORKSPACE_ID, workspaces = [MAIN_OFFICE_WORKSPACE], onSelect, onWorkspaceSelect }: { active?: OfficeSection; selectedWorkspace?: OfficeWorkspaceId; workspaces?: OfficeAgentWorkspaceSummary[]; onSelect?: (section: OfficeSection) => void; onWorkspaceSelect?: (workspace: OfficeWorkspaceId) => void }) {
  const [unsupported, setUnsupported] = useState<string | null>(null)
  const [taskRefreshKey, setTaskRefreshKey] = useState(0)
  const tasks = useOfficeResource(officeGatewayApi.tasks, [] as OfficeTaskSummary[], true, taskRefreshKey)
  const taskBadge = tasks.data.length
  useEffect(() => {
    const timer = window.setInterval(() => setTaskRefreshKey((value) => value + 1), 3000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <aside className="office-sidebar">
      <div className="sidebar-brand"><span className="brand-mark">⬢</span><span>AI Office</span></div>
      <div className="sidebar-search"><span>⌕</span><span>搜索功能、任务、员工…</span><kbd>⌘K</kbd></div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => {
          // 任务数量可由首页数据稳定派生；对话数量会在创建/删除后异步刷新，导航中不显示易失真的缓存值。
          const badge = item.label === '任务中心' ? taskBadge : undefined
          return (
            <button key={item.label} type="button" aria-current={active === item.label ? 'page' : undefined} className={`nav-item ${active === item.label ? 'active' : ''}`} onMouseEnter={item.label === '对话中心' ? prefetchConversationSessions : undefined} onFocus={item.label === '对话中心' ? prefetchConversationSessions : undefined} onClick={() => {
              onSelect?.(item.label as OfficeSection)
              setUnsupported(item.unsupported ? item.label : null)
            }}>
              <span className="nav-main"><span className="nav-icon">{item.icon}</span><span>{item.label}</span></span>
              {badge !== undefined ? <span className="nav-badge">{badge}</span> : null}
            </button>
          )
        })}
      </nav>
      <select className="mobile-workspace-select" aria-label="切换 Agent 空间" value={selectedWorkspace} onChange={(event) => onWorkspaceSelect?.(event.target.value)}>
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspaceLabel(workspace)}</option>)}
        {workspaces.length > 1 ? <option value={OFFICE_WORKSPACE_OVERVIEW_ID}>空间总览</option> : null}
      </select>
      {unsupported ? <p className="sidebar-notice">{unsupported}：不支持</p> : null}
      <div className="sidebar-section">
        <p className="section-title">工作空间</p>
        <div className="workspace-list">
          {workspaces.map((workspace) => <button key={workspace.id} type="button" aria-current={selectedWorkspace === workspace.id ? 'true' : undefined} className={`workspace-row ${selectedWorkspace === workspace.id ? 'active' : ''}`} title={workspace.kind === 'main' ? '主 Agent 完整办公室' : '子 Agent 完整办公室'} onClick={() => onWorkspaceSelect?.(workspace.id)}>
            {workspace.agents.some((agent) => agent.state !== 'idle') ? <span className="agent-dot online" /> : <span className="dot-spacer" />}<span>{workspaceLabel(workspace)}</span>
          </button>)}
          {workspaces.length > 1 ? <button type="button" aria-current={selectedWorkspace === OFFICE_WORKSPACE_OVERVIEW_ID ? 'true' : undefined} className={`workspace-row ${selectedWorkspace === OFFICE_WORKSPACE_OVERVIEW_ID ? 'active' : ''}`} title="同时查看全部真实 Agent 空间" onClick={() => onWorkspaceSelect?.(OFFICE_WORKSPACE_OVERVIEW_ID)}><span className="dot-spacer" /><span>空间总览</span></button> : null}
        </div>
      </div>
      <div className="sidebar-footer">
        <div className="user-card"><span className="user-avatar">T</span><span><strong>Teejoo</strong><em><span className="agent-dot online" />在线</em></span></div>
        <div className="system-status"><span className="agent-dot online" /><span>本地运行正常</span><span>☼</span></div>
      </div>
    </aside>
  )
}

/**
 * 功能：显示任务总数、完成数、待处理数和活动智能体数量。
 * 参数：无；资源地址由集中登记的 `officeGatewayApi` 提供。
 * 返回：办公室顶部统计栏 React 节点。
 * 错误：资源请求失败时显示占位值，不阻断其它中心导航。
 * 状态：组件可见期间每 3 秒刷新任务和智能体摘要。
 * 并发与取消：两类资源独立加载；卸载时 `useOfficeResource` 中止在途请求并清理刷新定时器。
 * 权限：只读取 Gateway 已脱敏的任务和智能体摘要。
 * 关联：`REQ-B-OFFICE-006`、`API-OFFICE-DATA-001`。
 */
/** 中文门禁摘要：显示任务和活动角色统计，读取失败时保持其它中心可用。 */
export function OfficeHeaderStats() {
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => { const timer = window.setInterval(() => setRefreshKey((value) => value + 1), 3000); return () => window.clearInterval(timer) }, [])
  const tasks = useOfficeResource(officeGatewayApi.tasks, [] as OfficeTaskSummary[], true, refreshKey)
  const agents = useOfficeResource(officeGatewayApi.agents, [] as OfficeAgentSummary[], true, refreshKey)
  const completed = tasks.data.filter((task) => /done|complete|completed|已完成|完成/i.test(task.status)).length
  const blocked = tasks.data.filter((task) => /block|blocked|pending|queued|待开始|待处理|阻塞|待办/i.test(task.status)).length
  const online = agents.data.filter((agent) => agent.state !== 'idle').length
  const stats = [
    { label: '任务总数', value: tasks.state === 'ready' ? String(tasks.data.length) : '—', hint: '已加载' },
    { label: '已完成', value: tasks.state === 'ready' ? String(completed) : '—', hint: '今日完成' },
    { label: '待处理', value: tasks.state === 'ready' ? String(blocked) : '—', hint: '阻塞事项' },
    { label: 'AI 员工', value: agents.state === 'ready' ? `${online}/${agents.data.length || 6}` : '—', hint: '在线', online: true },
  ]
  return <header className="office-header-stats">
    {stats.map((stat) => <section key={stat.label} className="stat-card"><span className="stat-label">{stat.label}</span><strong className="stat-value">{stat.value}</strong><span className={`stat-hint ${stat.online ? 'online-hint' : ''}`}>{stat.online ? <span className="agent-dot online" /> : null}{stat.hint}</span></section>)}
    <section className="stat-card resource-card"><span className="stat-label">系统资源</span><p className="data-state">不支持</p></section>
  </header>
}

function TasksPanel({ tasks: taskResource, onCreated, onOpenConversation, showCreate = true }: { tasks: OfficeResource<OfficeTaskSummary[]>; onCreated?: () => void; onOpenConversation?: (sessionId: string) => void; showCreate?: boolean }) {
  const [objective, setObjective] = useState('')
  const [priority, setPriority] = useState('normal')
  const [successCriteria, setSuccessCriteria] = useState('')
  const [executionMode, setExecutionMode] = useState<'auto_plan' | 'quick'>('auto_plan')
  const [requestState, setRequestState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [actionId, setActionId] = useState<string | null>(null)
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [recentTasks, setRecentTasks] = useState<OfficeTaskSummary[]>([])
  useEffect(() => {
    if (recentTasks.length === 0 || taskResource.data.length === 0) return
    const persistedIds = new Set(taskResource.data.map((task) => task.id))
    setRecentTasks((value) => value.filter((task) => !persistedIds.has(task.id)))
  }, [recentTasks.length, taskResource.data])
  async function submitTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!objective.trim()) { setRequestState('error'); setRequestError('请输入任务目标'); return }
    setRequestState('loading'); setRequestError(null)
    try {
      const created = await officeGatewayApi.createTask({ objective: objective.trim(), priority, successCriteria: successCriteria.trim() || undefined, executionMode })
      setRecentTasks((value) => [created, ...value.filter((item) => item.id !== created.id)])
      setRequestState('ready'); setObjective(''); setSuccessCriteria(''); onCreated?.()
    }
    catch (error) { setRequestState('error'); setRequestError(error instanceof Error ? error.message : '任务创建失败') }
  }
  async function taskAction(task: OfficeTaskSummary, action: 'cancel' | 'retry' | 'delete') {
    if (action === 'cancel' && !window.confirm(`确认停止任务“${task.objective}”吗？`)) return
    if (action === 'delete' && !window.confirm(`确认删除任务“${task.objective}”吗？关联执行对话和产物会保留。`)) return
    setActionId(task.id); setActionErrors((value) => { const next = { ...value }; delete next[task.id]; return next })
    try {
      if (action === 'cancel') {
        const next = await officeGatewayApi.cancelTask(task.id)
        setRecentTasks((value) => [next, ...value.filter((item) => item.id !== next.id)])
      } else if (action === 'retry') {
        const next = await officeGatewayApi.retryTask(task.id)
        setRecentTasks((value) => [next, ...value.filter((item) => item.id !== next.id)])
      } else {
        await officeGatewayApi.deleteTask(task.id)
        setRecentTasks((value) => value.filter((item) => item.id !== task.id))
      }
      onCreated?.()
    } catch (error) {
      setActionErrors((value) => ({ ...value, [task.id]: error instanceof Error ? error.message : '任务操作失败' }))
    }
    finally { setActionId(null) }
  }
  const displayedTasks = [...recentTasks.filter((task) => !taskResource.data.some((item) => item.id === task.id)), ...taskResource.data]
  const tasks = { ...taskResource, data: displayedTasks }
  const retryParents = new Set(displayedTasks.flatMap((task) => task.parentTaskId ? [task.parentTaskId] : []))
  return <section className="panel-section task-center"><div className="panel-heading"><div><h2>任务中心</h2><p className="panel-description">以目标、完成标准和公开执行阶段推进；对话仅保留为执行记录。</p></div><span className="panel-caption">目标执行模式</span></div>{showCreate ? <form className="task-create-form" onSubmit={submitTask}><label>目标<input value={objective} maxLength={500} onChange={(event) => setObjective(event.target.value)} placeholder="例如：整理本周会议纪要" /></label><label>完成标准<textarea value={successCriteria} maxLength={1000} onChange={(event) => setSuccessCriteria(event.target.value)} placeholder="可选，例如：包含结论、负责人和截止时间" /></label><div className="task-create-options"><label>优先级<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">低</option><option value="normal">普通</option><option value="high">高</option></select></label><fieldset><legend>执行策略</legend><div className="task-mode-switch" role="group" aria-label="执行策略"><button type="button" aria-pressed={executionMode === 'auto_plan'} onClick={() => setExecutionMode('auto_plan')}>自动规划</button><button type="button" aria-pressed={executionMode === 'quick'} onClick={() => setExecutionMode('quick')}>快速执行</button></div></fieldset></div><button type="submit" disabled={requestState === 'loading'}>{requestState === 'loading' ? '创建中…' : '新建任务'}</button>{requestError ? <p className="data-state data-state-error" role="alert">{requestError}</p> : requestState === 'ready' ? <p className="data-state data-state-success" role="status">任务已创建</p> : null}</form> : null}<DataState state={tasks.state} empty={tasks.data.length === 0} error={tasks.error} /><div className="task-list" aria-live="polite">{tasks.data.map((task) => { const mapped = taskStatus(task.status); const active = mapped.tone === 'queued' || mapped.tone === 'active'; const canRetry = task.status === 'failed' || task.status === 'cancelled'; const terminal = ['completed', 'failed', 'cancelled'].includes(task.status); const deleteBlocked = retryParents.has(task.id); return <article key={task.id} className={`task-card tone-${mapped.tone}`}><div className="task-title-row"><strong>{task.objective}</strong><span className={`task-status ${mapped.tone}`}>{mapped.label}</span></div><TaskStageTrack task={task} /><p className="task-current-stage">{task.nextAction || '等待智能体更新执行阶段'}</p>{task.failureReason ? <div className="task-failure" role="alert"><strong>失败原因</strong><span>{task.failureReason}</span><small>失败阶段：{taskPhaseLabel(task.failureStage)}{task.errorCode ? ` · ${task.errorCode}` : ''}</small>{task.recommendedAction ? <small>建议：{task.recommendedAction}</small> : null}</div> : null}<details className="task-details"><summary>目标详情</summary><dl><div><dt>完成标准</dt><dd>{task.successCriteria || '完成目标并给出可核验结果'}</dd></div><div><dt>执行策略</dt><dd>{task.executionMode === 'quick' ? '快速执行' : '自动规划'}</dd></div><div><dt>负责人</dt><dd>{task.assignedAgent || '自动分派'}</dd></div><div><dt>执行次数</dt><dd>第 {task.attempt || 1} 次</dd></div>{task.parentTaskId ? <div><dt>重试来源</dt><dd>{task.parentTaskId}</dd></div> : null}</dl></details><div className="task-actions">{active ? <button type="button" className="link-button" disabled={actionId === task.id} onClick={() => void taskAction(task, 'cancel')}>停止任务</button> : null}{canRetry ? <button type="button" className="link-button" disabled={actionId === task.id || task.retryable === false} title={task.retryable === false ? '该失败需要先检查配置或权限' : undefined} onClick={() => void taskAction(task, 'retry')}>重新执行</button> : null}{task.sessionId ? <button type="button" className="link-button" onClick={() => onOpenConversation?.(task.sessionId!)}>查看执行对话</button> : null}{terminal ? <button type="button" className="link-button danger" disabled={actionId === task.id || deleteBlocked} title={deleteBlocked ? '请先删除该任务的重试记录' : undefined} onClick={() => void taskAction(task, 'delete')}>删除任务</button> : null}</div>{actionErrors[task.id] ? <p className="data-state data-state-error task-action-error" role="alert">{actionErrors[task.id]}</p> : null}</article> })}</div></section>
}

function AgentsPanel({ agents, workspaceAgents = [] }: { agents: OfficeResource<OfficeAgentSummary[]>; workspaceAgents?: OfficeAgentSummary[] }) {
  const sceneAgents = useSyncExternalStore(
    subscribeOfficeAgents,
    getOfficeAgentStatusSnapshot,
    getOfficeAgentStatusSnapshot,
  )
  const hasSceneMission = sceneAgents.some((agent) => agent.mission?.kind === 'desk_visit')
  const [holdSceneProjection, setHoldSceneProjection] = useState(false)
  useEffect(() => {
    if (hasSceneMission) {
      setHoldSceneProjection(true)
      return
    }
    const timer = window.setTimeout(() => setHoldSceneProjection(false), 1500)
    return () => window.clearTimeout(timer)
  }, [hasSceneMission])
  const useSceneProjection = hasSceneMission || holdSceneProjection
  const sceneById = new Map(sceneAgents.map((agent) => [agent.id, agent]))
  const projectedAgents = workspaceAgents.length > 0 ? workspaceAgents : agents.data
  const displayedAgents = projectedAgents.map((agent) => {
    const sceneAgent = sceneById.get(agent.id)
    const awaitingSceneHandoff = HANDOFF_AGENT_IDS.has(agent.id)
      && agent.state !== 'idle'
      && sceneAgent?.state === 'idle'
    return (useSceneProjection || awaitingSceneHandoff) && sceneAgent
      ? { ...agent, state: sceneAgent.state, task: sceneAgent.currentTask ?? '' }
      : agent
  })
  const state = workspaceAgents.length > 0 ? 'ready' : agents.state
  return <section className="panel-section"><div className="panel-heading"><h2>智能体状态</h2><span className="panel-caption">人物动作与引擎实时同步</span></div><DataState state={state} empty={displayedAgents.length === 0} error={agents.error} /><ul className="activity-list agent-status-list">{displayedAgents.map((agent) => <li key={agent.id}><span className={`activity-dot ${agent.state !== 'idle' ? 'online' : ''}`} /><p><strong>{agent.name}</strong><span>{agent.task || agentStateLabel(agent.state)}</span></p><em>{agentStateLabel(agent.state)}</em></li>)}</ul></section>
}

function sessionFromResult(result: OfficeConversationResult): OfficeSessionSummary {
  const value = result.session
  return { id: value.id, title: value.title, provider: value.provider || '', model: value.model || '', createdAt: value.createdAt, updatedAt: value.updatedAt }
}

function toolLabel(tool: string) {
  const labels: Record<string, string> = {
    web_search: '网页搜索',
    web_fetch: '读取网页',
    web_extract: '提取网页内容',
    read_file: '读取文件',
    grep: '搜索文件',
    glob: '扫描文件',
    write_file: '写入文件',
    edit_file: '修改文件',
    notebook_edit: '更新笔记',
    bash: '执行命令',
    todo_add: '更新任务清单',
    todo_update: '更新任务清单',
    todo_list: '查看任务清单',
  }
  return labels[tool] || '调用工具'
}

const TOOL_AGENT_NAMES: Record<string, string> = {
  web_search: '李研',
  web_fetch: '李研',
  web_extract: '李研',
  read_file: '周理',
  grep: '周理',
  glob: '周理',
  write_file: '陈书',
  edit_file: '陈书',
  notebook_edit: '陈书',
  bash: '陈书',
}

function visibleTextParts(message: OfficeConversationMessage) {
  // reasoning/tool part 只用于思考条和人物联动，不进入历史气泡，避免泄露内部过程。
  return (message.parts || []).filter((part) => part.type !== 'reasoning' && part.type !== 'tool' && typeof part.text === 'string' && part.text.trim())
}

function streamingAssistantIndex(messages: OfficeConversationMessage[], pending: boolean) {
  if (!pending) return -1
  let lastUser = -1
  let assistant = -1
  messages.forEach((message, index) => {
    if (message.info?.role === 'user') { lastUser = index; assistant = -1 }
    else if (index > lastUser && message.info?.role === 'assistant' && visibleTextParts(message).some((part) => Boolean(part.text?.trim()))) assistant = index
  })
  return assistant
}

function latestAssistantReplyKey(messages: OfficeConversationMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.info?.role !== 'assistant') continue
    const text = visibleTextParts(message).map((part) => part.text).join('\n').trim()
    if (!text) continue
    return String(message.info.id || `${message.info.time?.completed || message.info.time?.created || index}:${text.length}:${text.slice(0, 128)}`)
  }
  return null
}

function intermediateAssistantGroups(messages: OfficeConversationMessage[]) {
  const groups = new Map<number, number[]>()
  let assistantIndexes: number[] = []
  const closeTurn = () => {
    if (assistantIndexes.length > 1) groups.set(assistantIndexes[0], assistantIndexes.slice(0, -1))
    assistantIndexes = []
  }
  messages.forEach((message, index) => {
    if (message.info?.role === 'user') closeTurn()
    else if (message.info?.role === 'assistant' && visibleTextParts(message).length > 0) assistantIndexes.push(index)
  })
  closeTurn()
  return groups
}

function ConversationTranscriptMessages({ messages, activeStreamingMessage }: { messages: OfficeConversationMessage[]; activeStreamingMessage: number }) {
  const processGroups = intermediateAssistantGroups(messages)
  const groupedIndexes = new Set([...processGroups.values()].flat())
  return messages.map((item, index) => {
    const processIndexes = processGroups.get(index)
    if (processIndexes) {
      return <details key={`process-${item.info?.id || index}`} className="conversation-process"><summary>执行过程（{processIndexes.length} 条）</summary><div>{processIndexes.map((processIndex) => <section key={messages[processIndex].info?.id || processIndex}>{visibleTextParts(messages[processIndex]).map((part, partIndex) => <AssistantText key={partIndex} text={part.text || ''} />)}</section>)}</div></details>
    }
    if (groupedIndexes.has(index)) return null
    const textParts = visibleTextParts(item)
    if (textParts.length === 0) return null
    const isUser = item.info?.role === 'user'
    const isSystem = item.info?.role === 'system'
    const kind = item.info && 'kind' in item.info && typeof item.info.kind === 'string' ? item.info.kind : ''
    const messageClass = isUser ? 'user' : isSystem ? `system ${kind === 'error' || kind === 'cancelled' ? kind : ''}` : 'assistant'
    const streaming = index === activeStreamingMessage
    return <article key={item.info?.id || index} className={`transcript-message ${messageClass}${streaming ? ' is-streaming' : ''}`.trim()}>{isSystem ? null : <div className="message-author">{isUser ? '你' : '智能体'}{streaming ? <span className="message-streaming-state"><i />实时生成中</span> : null}</div>}<div className="message-content">{textParts.map((part, partIndex) => isUser || isSystem ? <p key={partIndex}>{part.text}</p> : <AssistantText key={partIndex} text={part.text || ''} />)}</div></article>
  })
}

/** 渲染隐藏办公室模式的会话项，并订阅该会话独立的运行态。 */
function SessionListItem({
  session,
  selected,
  deleting,
  readReplyKey,
  onSelect,
  onDelete,
}: {
  session: OfficeSessionSummary
  selected: boolean
  deleting: boolean
  readReplyKey?: string
  onSelect: () => void
  onDelete: () => void
}) {
  const subscribe = (listener: () => void) => subscribeConversationView(session.id, listener)
  const getSnapshot = () => getConversationSnapshot(session.id)
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CONVERSATION_VIEW)
  const replyKey = latestAssistantReplyKey(state.messages)
  const unread = !state.pending && state.generation > 0 && Boolean(replyKey) && replyKey !== readReplyKey
  return <li className={`${selected ? 'selected-session' : ''} ${state.pending ? 'running-session' : ''}`}>
    <button type="button" className="session-select" aria-label={session.title} aria-current={selected ? 'page' : undefined} title={state.pending ? `${session.title}（正在执行）` : session.title} onClick={onSelect}>
      <span className="session-title-line"><strong>{session.title}</strong>{state.pending ? <span className="session-running-dot" aria-hidden="true" title="正在执行" /> : unread ? <span className="session-unread-dot" aria-hidden="true" title="有未读回复" /> : null}</span>
    </button>
    <button type="button" className="icon-action" aria-label={`删除 ${session.title}`} title={state.pending ? '活动会话不能删除' : '删除对话'} disabled={state.pending || deleting} onClick={onDelete}>{deleting ? '…' : '×'}</button>
  </li>
}

/** 显示办公室模式的下拉项；每项独立订阅运行态，展开后可同时观察多个会话。 */
function SessionDropdownOption({
  session,
  selected,
  readReplyKey,
  onSelect,
}: {
  session: OfficeSessionSummary
  selected: boolean
  readReplyKey?: string
  onSelect: () => void
}) {
  const subscribe = (listener: () => void) => subscribeConversationView(session.id, listener)
  const getSnapshot = () => getConversationSnapshot(session.id)
  const state = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_CONVERSATION_VIEW)
  const replyKey = latestAssistantReplyKey(state.messages)
  const unread = !state.pending && state.generation > 0 && Boolean(replyKey) && replyKey !== readReplyKey
  return <button type="button" role="option" aria-selected={selected} className={`conversation-session-option ${selected ? 'selected' : ''}`} title={state.pending ? `${session.title}（正在执行）` : unread ? `${session.title}（有未读回复）` : session.title} onClick={onSelect}>
    <span className="conversation-session-option-title"><strong>{session.title}</strong>{state.pending ? <span className="session-running-dot" aria-label="正在执行" title="正在执行" /> : unread ? <span className="session-unread-dot" aria-label="有未读回复" title="有未读回复" /> : null}</span>
  </button>
}

type SessionsPanelProps = {
  sessions: OfficeResource<OfficeSessionSummary[]>
  tasks?: OfficeTaskSummary[]
  initialSessionId?: string | null
  focusRequest?: { sessionId: string; requestId: number } | null
  officeHidden?: boolean
  drafts?: Record<string, string>
  /** 右侧面板生命周期内保留新建会话摘要，避免切换到其它中心时丢失。 */
  persistedSessions?: OfficeSessionSummary[]
  onDraftChange?: (sessionId: string, draft: string) => void
  onOfficeHiddenChange?: (hidden: boolean) => void
  onArtifactOpen?: (artifact: OfficeConversationArtifact) => void
  onSessionCreated?: (session: OfficeSessionSummary) => void
  onSessionDeleted?: (sessionId: string) => void
  onSessionSelected?: (sessionId: string | null) => void
  onFocusConsumed?: (requestId: number) => void
  artifactWorkspaceId?: string
}

function SessionsPanel({ sessions, tasks = [], initialSessionId, focusRequest, officeHidden = false, drafts = {}, persistedSessions = [], onDraftChange, onOfficeHiddenChange, onArtifactOpen, onSessionCreated, onSessionDeleted, onSessionSelected, onFocusConsumed, artifactWorkspaceId }: SessionsPanelProps) {
  const [title, setTitle] = useState('')
  const [requestState, setRequestState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [requestError, setRequestError] = useState<string | null>(null)
  const [createdSessions, setCreatedSessions] = useState<OfficeSessionSummary[]>(persistedSessions)
  const [deletedIds, setDeletedIds] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<string[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  const [readReplyKeys, setReadReplyKeys] = useState<Record<string, string>>(readStoredReplyKeys)
  const transcriptEnd = useRef<HTMLDivElement | null>(null)
  const messageInput = useRef<HTMLTextAreaElement | null>(null)
  const sessionMenuRef = useRef<HTMLDivElement | null>(null)
  const initialSelectionApplied = useRef(false)
  const consumedFocusRequestId = useRef<number | null>(null)

  const visibleSessions = [...createdSessions, ...sessions.data.filter((session) => !createdSessions.some((item) => item.id === session.id))].filter((session) => !deletedIds.includes(session.id))
  const firstVisibleSessionId = visibleSessions[0]?.id
  const effectiveSelectedId = selectedId && visibleSessions.some((session) => session.id === selectedId)
    ? selectedId
    : firstVisibleSessionId ?? null
  const selectedSession = visibleSessions.find((session) => session.id === effectiveSelectedId) ?? null
  const message = effectiveSelectedId ? drafts[effectiveSelectedId] ?? '' : ''
  const conversation = useConversationController(effectiveSelectedId)
  const { messages, messagesState, phase: messageState, activeTool, activityTask, turnStatus, queuePosition, error: messageError, pending } = conversation.state
  const stopping = pending && messageState === 'stopped'
  const activeStreamingMessage = streamingAssistantIndex(messages, pending)
  const selectedReplyKey = latestAssistantReplyKey(messages)
  const selectedUnread = !pending
    && conversation.state.generation > 0
    && Boolean(selectedReplyKey)
    && selectedReplyKey !== (effectiveSelectedId ? readReplyKeys[effectiveSelectedId] : undefined)

  // 父级 OfficeRightPanel 在导航切换期间仍然挂载；同步其会话摘要，
  // 使刚创建但尚未被 Gateway 列表刷新到的会话在切回时立即可见。
  useEffect(() => {
    setCreatedSessions((current) => {
      const merged = [...persistedSessions, ...current.filter((item) => !persistedSessions.some((saved) => saved.id === item.id))]
      return merged
    })
  }, [persistedSessions])

  // 任务中心的深链是一次性选择请求；消费后不再覆盖用户后续手动选择。
  useEffect(() => {
    if (focusRequest
      && focusRequest.requestId !== consumedFocusRequestId.current
      && visibleSessions.some((session) => session.id === focusRequest.sessionId)) {
      consumedFocusRequestId.current = focusRequest.requestId
      initialSelectionApplied.current = true
      setSelectedId(focusRequest.sessionId)
      onSessionSelected?.(focusRequest.sessionId)
      onFocusConsumed?.(focusRequest.requestId)
      return
    }
    if (!initialSelectionApplied.current && visibleSessions.length > 0) {
      const nextId = initialSessionId && visibleSessions.some((session) => session.id === initialSessionId)
        ? initialSessionId
        : firstVisibleSessionId ?? null
      initialSelectionApplied.current = true
      setSelectedId(nextId)
      onSessionSelected?.(nextId)
      return
    }
    if (selectedId && !visibleSessions.some((session) => session.id === selectedId) && sessions.state !== 'loading') {
      const nextId = firstVisibleSessionId ?? null
      setSelectedId(nextId)
      onSessionSelected?.(nextId)
    }
  }, [focusRequest, initialSessionId, selectedId, firstVisibleSessionId, visibleSessions, sessions.state, onFocusConsumed, onSessionSelected])

  useEffect(() => {
    const transcript = transcriptEnd.current?.parentElement
    if (transcript) transcript.scrollTop = transcript.scrollHeight
  }, [messages, messageState])

  useEffect(() => {
    if (!sessionMenuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!sessionMenuRef.current?.contains(event.target as Node)) setSessionMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSessionMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [sessionMenuOpen])

  useEffect(() => {
    if (!effectiveSelectedId || pending || !selectedReplyKey) return
    setReadReplyKeys((current) => {
      if (current[effectiveSelectedId] === selectedReplyKey) return current
      const next = { ...current, [effectiveSelectedId]: selectedReplyKey }
      storeReplyKeys(next)
      return next
    })
  }, [effectiveSelectedId, pending, selectedReplyKey])

  async function createConversation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!title.trim()) { setRequestState('error'); setRequestError('请输入对话名称'); return }
    setRequestState('loading'); setRequestError(null)
    try {
      const result = await officeGatewayApi.createConversation({ title: title.trim() })
      const next = sessionFromResult(result)
      setCreatedSessions((value) => [next, ...value.filter((item) => item.id !== next.id)])
      onSessionCreated?.(next)
      updateConversationView(next.id, { messages: [], messagesState: 'ready' })
      initialSelectionApplied.current = true
      setSelectedId(next.id)
      onSessionSelected?.(next.id)
      setTitle('')
      setShowCreate(false)
      setRequestState('idle')
      window.setTimeout(() => messageInput.current?.focus(), 0)
    } catch (error) {
      setRequestState('error'); setRequestError(error instanceof Error ? error.message : '无法连接 OpenPaw 引擎')
    }
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSession || !message.trim() || pending) return
    const nextText = message.trim()
    onDraftChange?.(selectedSession.id, '')
    await conversation.send(nextText).catch(() => undefined)
  }
  async function abortConversation() {
    if (!window.confirm('确认停止当前生成吗？已生成的内容会保留。')) return
    await conversation.abort().catch(() => undefined)
  }
  function selectSession(sessionId: string) {
    initialSelectionApplied.current = true
    setRequestError(null)
    setSessionMenuOpen(false)
    setSelectedId(sessionId)
    const replyKey = latestAssistantReplyKey(getConversationSnapshot(sessionId).messages)
    if (replyKey) {
      setReadReplyKeys((current) => {
        if (current[sessionId] === replyKey) return current
        const next = { ...current, [sessionId]: replyKey }
        storeReplyKeys(next)
        return next
      })
    }
    onSessionSelected?.(sessionId)
  }
  async function removeConversation(session: OfficeSessionSummary) {
    let linkedTasks = tasks.filter((task) => task.sessionId === session.id)
    try {
      const latestTasks = await officeGatewayApi.tasks()
      linkedTasks = latestTasks.filter((task) => task.sessionId === session.id)
    } catch {
      // 删除确认仍可使用已加载快照；真正删除会继续由 Gateway/Host 校验。
    }
    const linkedTaskNotice = linkedTasks.length > 0
      ? `\n\n该对话关联 ${linkedTasks.length} 个任务。删除对话不会删除任务记录，但任务中的“查看执行对话”将不再可用。`
      : ''
    if (!window.confirm(`确认删除对话“${session.title}”吗？此操作无法撤销。${linkedTaskNotice}`)) return
    setDeletingIds((value) => [...value, session.id])
    try {
      const nextSessionId = visibleSessions.find((item) => item.id !== session.id)?.id ?? null
      await officeGatewayApi.deleteConversation(session.id)
      clearConversationView(session.id)
      setReadReplyKeys((current) => {
        if (!(session.id in current)) return current
        const next = { ...current }
        delete next[session.id]
        storeReplyKeys(next)
        return next
      })
      setCreatedSessions((value) => value.filter((item) => item.id !== session.id))
      onSessionDeleted?.(session.id)
      setDeletedIds((value) => [...value, session.id])
      if (selectedId === session.id) {
        setSelectedId(nextSessionId)
        onSessionSelected?.(nextSessionId)
      }
    } catch (error) { setRequestState('error'); setRequestError(error instanceof Error ? error.message : '会话删除失败') }
    finally { setDeletingIds((value) => value.filter((id) => id !== session.id)) }
  }
  const asyncStatus = messageError
    || (stopping ? '正在停止当前生成'
      : turnStatus === 'queued' ? '当前回合正在排队'
        : pending ? (activityTask || (activeTool ? `智能体正在调用${toolLabel(activeTool)}` : '智能体正在处理'))
          : messagesState === 'loading' ? '正在读取对话消息' : '')
  return <section className="conversation-center" aria-busy={messagesState === 'loading' || pending}>
    <header className="conversation-header">
      <h2>对话中心</h2>
      <div className="conversation-header-actions">
        <button type="button" className="conversation-office-toggle" aria-pressed={officeHidden} onClick={() => onOfficeHiddenChange?.(!officeHidden)}>{officeHidden ? '显示办公室' : '隐藏办公室'}</button>
        <button type="button" className="conversation-create-toggle" onClick={() => setShowCreate((value) => !value)}>{showCreate ? '收起' : '+ 新建对话'}</button>
      </div>
    </header>
    {showCreate ? <form className="conversation-create-form conversation-create-form-compact" onSubmit={createConversation}>
      <label>对话名称<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：整理发布计划" /></label><button type="submit" disabled={requestState === 'loading'}>{requestState === 'loading' ? '正在创建…' : '创建对话'}</button>
      {requestError ? <p className="data-state data-state-error conversation-form-status">{requestError}</p> : null}
    </form> : requestError ? <p className="conversation-global-status data-state data-state-error">{requestError}</p> : null}
    <ConversationArtifactDock sessionId={effectiveSelectedId} pending={pending} generation={conversation.state.generation} officeHidden={officeHidden} workspaceId={artifactWorkspaceId} onOpen={(artifact) => onArtifactOpen?.(artifact)} />
    <div className="conversation-layout">
      {officeHidden ? <aside className="conversation-list-pane">
        <div className="conversation-pane-title"><strong>最近对话</strong><span>{visibleSessions.length}</span></div>
        <DataState state={sessions.state} empty={visibleSessions.length === 0} error={sessions.error} />
        <ul className="session-list">{visibleSessions.map((session) => <SessionListItem key={session.id} session={session} selected={effectiveSelectedId === session.id} deleting={deletingIds.includes(session.id)} readReplyKey={readReplyKeys[session.id]} onSelect={() => selectSession(session.id)} onDelete={() => void removeConversation(session)} />)}</ul>
      </aside> : <div className="conversation-switcher">
        <label htmlFor="conversation-session-select">
          <span className="conversation-switcher-title"><span>最近对话</span>{pending ? <span className="session-running-dot" aria-label="当前对话正在处理" title="正在执行" /> : selectedUnread ? <span className="session-unread-dot" aria-label="当前对话有未读回复" title="有未读回复" /> : null}</span>
          <small>{visibleSessions.length} 个</small>
        </label>
        {sessions.state === 'loading' && visibleSessions.length === 0
          ? <p className="data-state">正在读取对话…</p>
          : sessions.state === 'error' && visibleSessions.length === 0
            ? <p className="data-state data-state-error">无法读取最近对话</p>
            : visibleSessions.length > 0
              ? <div className="conversation-select-row">
                <div className={`conversation-select-control ${sessionMenuOpen ? 'is-open' : ''}`} ref={sessionMenuRef}>
                  <select
                    id="conversation-session-select"
                    aria-label="最近对话"
                    aria-controls="conversation-session-options"
                    aria-expanded={sessionMenuOpen}
                    className="conversation-select-native"
                    value={effectiveSelectedId ?? ''}
                    onChange={(event) => selectSession(event.target.value)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      setSessionMenuOpen((value) => !value)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault()
                        setSessionMenuOpen(true)
                      }
                    }}
                  >{visibleSessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}</select>
                  <span className="conversation-select-display" aria-hidden="true"><span>{selectedSession?.title || '选择对话'}</span><span className="conversation-select-chevron">⌄</span></span>
                  {sessionMenuOpen ? <div id="conversation-session-options" className="conversation-session-options" role="listbox" aria-label="最近对话列表">
                    {visibleSessions.map((session) => <SessionDropdownOption key={session.id} session={session} selected={effectiveSelectedId === session.id} readReplyKey={readReplyKeys[session.id]} onSelect={() => selectSession(session.id)} />)}
                  </div> : null}
                </div>
                <button type="button" className="icon-action" aria-label={`删除 ${selectedSession?.title || '当前对话'}`} title={pending ? '活动会话不能删除' : '删除当前对话'} disabled={!selectedSession || pending || deletingIds.includes(selectedSession.id)} onClick={() => { if (selectedSession) void removeConversation(selectedSession) }}>{selectedSession && deletingIds.includes(selectedSession.id) ? '…' : '×'}</button>
              </div>
              : <p className="data-state">暂无对话</p>}
      </div>}
      <section className="conversation-workspace" aria-busy={messagesState === 'loading' || pending}>
        {selectedSession ? <>
          <div className="conversation-transcript">{messagesState === 'loading' && messages.length === 0 ? <p className="data-state">正在读取消息…</p> : messagesState === 'error' && messages.length === 0 ? <p className="data-state data-state-error">消息读取失败，请重新选择该对话</p> : messages.length === 0 ? <p className="data-state conversation-empty">这段对话还没有消息，发送内容后会由系统自动分派智能体处理。</p> : <ConversationTranscriptMessages messages={messages} activeStreamingMessage={activeStreamingMessage} />}{pending && !stopping && activeStreamingMessage < 0 ? <article className="transcript-message assistant pending"><div className="message-author">智能体</div><div className="message-content">{(() => {
            const currentTool = activeTool
            const toolAgentName = currentTool ? TOOL_AGENT_NAMES[currentTool] : null
            // 角色名称只在选中会话的工具已确定时显示，避免多会话并行时串线。
            const displayAgent = toolAgentName
            const queuedLabel = queuePosition && queuePosition > 0 ? `正在排队（前方 ${queuePosition - 1} 项）` : '正在排队'
            return <><p>{turnStatus === 'queued' ? queuedLabel : activityTask || (currentTool ? `正在调用：${toolLabel(currentTool)}` : '正在思考')}<span className="typing-dots">···</span></p>{turnStatus === 'queued' ? <small className="thinking-agent">等待可用运行槽位，可继续切换其它对话</small> : displayAgent ? <small className="thinking-agent">办公室：{displayAgent} · 执行中</small> : <small className="thinking-agent">办公室角色正在自动分派</small>}</>
          })()}</div></article> : null}<div ref={transcriptEnd} /></div>
          <form className="conversation-composer" aria-busy={pending} onSubmit={sendMessage}><textarea ref={messageInput} aria-label="输入下一条消息" value={message} onChange={(event) => { if (effectiveSelectedId) onDraftChange?.(effectiveSelectedId, event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder="发送消息…" rows={3} disabled={pending} /><div className="conversation-composer-footer"><span>{stopping ? '正在停止本轮…' : turnStatus === 'queued' ? '本轮正在排队…' : messageState === 'loading' ? '智能体正在思考…' : messageState === 'timeout' ? '正在核对本轮状态…' : '按 Enter 发送，Shift + Enter 换行'}</span>{pending ? <button type="button" className="conversation-stop-button" disabled={stopping} onClick={() => void abortConversation()}>{stopping ? '停止中…' : '停止生成'}</button> : <button type="submit" disabled={!message.trim()}>发送</button>}</div><div className="conversation-turn-status">{messageError ? <p className={`data-state ${messageState === 'timeout' || messageState === 'stopped' ? 'data-state-warning' : 'data-state-error'}`}>{messageError}</p> : null}</div><p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{asyncStatus}</p></form>
        </> : <div className="conversation-empty-state"><strong>选择或新建一段对话</strong><p>对话会保留协作上下文，并由系统自动分派智能体。</p><button type="button" onClick={() => setShowCreate(true)}>新建对话</button></div>}
      </section>
    </div>
  </section>
}

function FilesPanel({ files, workspace, sessions }: { files: OfficeResource<OfficeFileSummary[]>; workspace: OfficeResource<OfficeWorkspaceSummary>; sessions: OfficeResource<OfficeSessionSummary[]> }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedFolder, setSelectedFolder] = useState('workspace')
  const [conversationFiles, setConversationFiles] = useState<OfficeConversationArtifact[]>([])
  const [conversationFilesState, setConversationFilesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [query, setQuery] = useState('')
  const [content, setContent] = useState<string | null>(null)
  const [contentState, setContentState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [contentError, setContentError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedPath) { setContent(null); setContentState('idle'); setContentError(null); return }
    const controller = new AbortController(); setContentState('loading'); setContentError(null)
    void officeGatewayApi.fileContent(selectedPath, controller.signal).then((result) => { if (!controller.signal.aborted) { setContent(result.content); setContentState('ready') } }).catch((error: unknown) => { if (!controller.signal.aborted) { setContentState('error'); setContentError(error instanceof Error ? error.message : '文件读取失败') } })
    return () => controller.abort()
  }, [selectedPath])

  useEffect(() => {
    if (!selectedPath) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPath(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [selectedPath])

  useEffect(() => {
    if (selectedFolder === 'workspace') { setConversationFiles([]); setConversationFilesState('idle'); return }
    const controller = new AbortController()
    setConversationFiles([])
    setConversationFilesState('loading')
    void officeGatewayApi.conversationArtifacts(selectedFolder, controller.signal).then((items) => {
      if (!controller.signal.aborted) { setConversationFiles(items); setConversationFilesState('ready') }
    }).catch(() => {
      if (!controller.signal.aborted) setConversationFilesState('error')
    })
    return () => controller.abort()
  }, [selectedFolder])

  const selectedConversation = sessions.data.find((session) => session.id === selectedFolder)
  const selectedFiles: OfficeFileSummary[] = selectedFolder === 'workspace'
    ? files.data
    : conversationFiles.map((artifact) => ({ path: artifact.path, type: 'file' }))
  const visibleFiles = selectedFiles.filter((file) => file.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const markdownSelected = /\.md(?:own)?$/i.test(selectedPath || '')
  const mermaidSelected = /\.(?:mmd|mermaid)$/i.test(selectedPath || '')
  const htmlSelected = /\.html?$/i.test(selectedPath || '')
  const jsonSelected = /\.json$/i.test(selectedPath || '')
  const sourceCodeSelected = /\.(?:[cm]?js|jsx|tsx?)$/i.test(selectedPath || '')
  const chart = useMemo(() => jsonSelected && contentState === 'ready' ? parseArtifactChart(content || '') : null, [content, contentState, jsonSelected])
  const map = useMemo(() => contentState === 'ready' && selectedPath && !htmlSelected ? parseArtifactMap(selectedPath, content || '') : { document: null, error: null }, [content, contentState, htmlSelected, selectedPath])
  const viewer = selectedPath ? <div className="workspace-file-viewer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPath(null) }}>
    <section className={`workspace-file-viewer${markdownSelected ? ' markdown-preview' : ''}${jsonSelected ? ' json-preview' : ''}${mermaidSelected ? ' diagram-preview' : ''}${htmlSelected ? ' html-preview' : ''}${sourceCodeSelected ? ' source-code-preview' : ''}${map.document ? ' map-preview' : ''}`} role="dialog" aria-label={`查看文件 ${selectedPath}`}>
      <header><strong>{selectedPath}</strong><button type="button" aria-label="关闭文件查看器" onClick={() => setSelectedPath(null)}>×</button></header>
      <div className="workspace-file-viewer-body">{contentState === 'loading' ? <p className="data-state">读取中…</p> : contentState === 'error' ? <p className="data-state data-state-error">{contentError || '文件读取失败'}</p> : content === '' ? <p className="data-state">文件为空</p> : contentState === 'ready' ? markdownSelected ? <AssistantText text={content || ''} /> : mermaidSelected ? <MermaidDiagram source={content || ''} /> : htmlSelected ? <ArtifactHtmlPreview key={selectedPath} html={content || ''} /> : map.document ? <ArtifactMap document={map.document} /> : map.error ? <div className="artifact-data-fallback"><p className="data-state data-state-warning">{map.error}</p><pre>{content}</pre></div> : chart ? <ArtifactChart spec={chart} /> : jsonSelected ? <ArtifactJsonPreview content={content || ''} /> : sourceCodeSelected ? <ArtifactJavaScriptPreview path={selectedPath} content={content || ''} /> : <pre>{content}</pre> : null}</div>
    </section>
  </div> : null
  const viewerTarget = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.office-main')
  const listState = selectedFolder === 'workspace' ? files.state : conversationFilesState
  const listError = selectedFolder === 'workspace' ? files.error : conversationFilesState === 'error' ? new Error('无法读取该对话的产物') : null
  return <section className="panel-section"><div className="panel-heading"><h2>文件中心</h2><span className="panel-caption">按对话归档</span></div>{workspace.state === 'error' ? <p className="data-state data-state-error">无法读取工作区路径</p> : <p className="workspace-path">{workspace.state === 'loading' ? '路径读取中…' : workspace.data?.root || '未配置工作区'}</p>}<nav className="conversation-file-folders" aria-label="对话文件夹"><button type="button" className={selectedFolder === 'workspace' ? 'selected' : ''} onClick={() => { setSelectedFolder('workspace'); setSelectedPath(null) }}>工作区全部文件</button>{sessions.data.map((session) => <button key={session.id} type="button" className={selectedFolder === session.id ? 'selected' : ''} aria-label={`对话文件夹 ${session.title || session.id}`} onClick={() => { setSelectedFolder(session.id); setSelectedPath(null) }}><span aria-hidden="true">▰</span>{session.title || '未命名对话'}</button>)}</nav>{sessions.state === 'error' ? <p className="data-state data-state-error">无法读取对话文件夹</p> : null}<div className="file-folder-heading"><strong>{selectedConversation?.title || '工作区全部文件'}</strong><span>{selectedFolder === 'workspace' ? '未按会话过滤' : `${conversationFiles.length} 个产物`}</span></div><label className="file-search">筛选文件<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入路径关键词" /></label><DataState state={listState} empty={visibleFiles.length === 0} error={listError} /><ul className="activity-list file-list">{visibleFiles.map((file) => <li key={`${selectedFolder}:${file.path}`}><span className="activity-dot" />{file.type === 'file' ? <button type="button" className={`file-select ${selectedPath === file.path ? 'selected' : ''}`} onClick={() => setSelectedPath(file.path)}>{file.path}</button> : <p><strong>▰ {file.path}</strong></p>}</li>)}</ul>{viewer ? (viewerTarget ? createPortal(viewer, viewerTarget) : viewer) : null}</section>
}

function SkillsPanel({ skills, onNavigate }: { skills: OfficeResource<OfficeSkillSummary[]>; onNavigate?: (section: OfficeSection) => void }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [importedSkill, setImportedSkill] = useState<{ name: string; path: string; content: string } | null>(null)
  const [contentState, setContentState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [runState, setRunState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [runError, setRunError] = useState<string | null>(null)
  const [skillConfirmed, setSkillConfirmed] = useState(false)
  useEffect(() => {
    if (!selectedPath) { setContent(null); setContentState('idle'); return }
    if (importedSkill?.path === selectedPath) {
      setContent(importedSkill.content)
      setContentState('ready')
      setSkillConfirmed(false)
      return
    }
    const controller = new AbortController(); setContentState('loading'); setSkillConfirmed(false)
    void officeGatewayApi.skillContent(selectedPath, controller.signal).then((value) => { if (!controller.signal.aborted) { setContent(value.content); setContentState('ready') } }).catch(() => { if (!controller.signal.aborted) setContentState('error') })
    return () => controller.abort()
  }, [selectedPath, importedSkill])
  const selectedSkill = importedSkill && importedSkill.path === selectedPath ? importedSkill : skills.data.find((skill) => skill.path === selectedPath)
  const skillLength = content?.length ?? 0
  async function runSkill() {
    if (!selectedSkill || contentState !== 'ready' || content == null) return
    if (!skillConfirmed) { setRunState('error'); setRunError('请先确认已阅读技能正文，技能内容将作为新对话的执行规范'); return }
    if (content.length > 40_000) { setRunState('error'); setRunError('技能正文超过 40,000 个字符，已阻止直接注入对话'); return }
    setRunState('loading'); setRunError(null)
    try { await officeGatewayApi.createConversation({ title: `技能：${selectedSkill.name}`, text: `请按照以下技能执行任务：\n\n${content}` }); setRunState('ready') }
    catch (error) { setRunState('error'); setRunError(error instanceof Error ? error.message : '技能启动失败') }
  }
  function importSkill(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.name.toLocaleLowerCase().endsWith('.md')) { setRunState('error'); setRunError('技能文件必须是 Markdown（.md）格式'); return }
    if (file.size > 512 * 1024) { setRunState('error'); setRunError('技能文件超过 512 KB，已阻止导入'); return }
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      if (!text.trim()) { setRunState('error'); setRunError('技能文件为空，无法导入'); return }
      const path = `local:${file.name}`
      setImportedSkill({ name: file.name.replace(/\.md$/iu, ''), path, content: text })
      setSelectedPath(path)
      setContent(text)
      setContentState('ready')
      setRunState('idle')
      setRunError(null)
      setSkillConfirmed(false)
    }
    reader.onerror = () => { setRunState('error'); setRunError('技能文件读取失败') }
    reader.readAsText(file)
  }
  return <section className="panel-section"><div className="panel-heading"><div><h2>技能中心</h2><p className="panel-description">技能是可复用的执行规范。选择技能查看正文，确认信任后应用到一段新的执行对话。</p></div><span className="panel-caption">来自 OpenPaw skills</span></div><div className="skill-import"><label className="secondary-button">导入本地技能<input aria-label="导入技能文件" type="file" accept=".md,text/markdown" onChange={importSkill} /></label><small>仅当前页面使用，不会写入 OpenPaw home</small></div><DataState state={skills.state} empty={skills.data.length === 0 && !importedSkill} error={skills.error} /><ul className="activity-list">{importedSkill ? <li><span className="activity-dot online" /><button type="button" className={`file-select ${selectedPath === importedSkill.path ? 'selected' : ''}`} onClick={() => { setSelectedPath(importedSkill.path); setRunState('idle'); setRunError(null); setSkillConfirmed(false) }}><strong>{importedSkill.name}</strong><time>本地导入 · 未持久化</time></button></li> : null}{skills.data.map((skill) => <li key={skill.path}><span className="activity-dot" /><button type="button" className={`file-select ${selectedPath === skill.path ? 'selected' : ''}`} onClick={() => { setSelectedPath(skill.path); setRunState('idle'); setRunError(null); setSkillConfirmed(false) }}><strong>{skill.name}</strong><time>{skill.path}</time></button></li>)}</ul>{selectedPath ? <div className="file-preview"><strong>技能：{selectedSkill?.name || selectedPath}</strong>{contentState === 'loading' ? <p className="data-state">读取中…</p> : contentState === 'error' ? <p className="data-state data-state-error">技能读取失败</p> : contentState === 'ready' ? <><pre>{content}</pre><label className="skill-confirm"><input type="checkbox" checked={skillConfirmed} onChange={(event) => setSkillConfirmed(event.target.checked)} />我已阅读并信任此技能正文，允许将其用于新对话</label><button type="button" onClick={() => void runSkill()} disabled={runState === 'loading' || !skillConfirmed || skillLength > 40_000}>{runState === 'loading' ? '启动中…' : '应用到新对话'}</button>{skillLength > 40_000 ? <p className="data-state data-state-warning">技能正文过长，超过 40,000 个字符限制</p> : null}{runState === 'ready' ? <><p className="data-state data-state-success">已创建技能执行对话</p><button type="button" className="link-button" onClick={() => onNavigate?.('对话中心')}>查看对话</button></> : runError ? <p className="data-state data-state-error">{runError}</p> : null}</> : null}</div> : null}</section>
}

function BrowserPanel() {
  return <section className="panel-section"><h2>浏览器助手</h2><p className="data-state">不支持</p></section>
}

function CalendarPanel() {
  return <section className="panel-section"><div className="panel-heading"><h2>日程日历</h2><span className="panel-caption">本期未开放</span></div><p className="data-state">不支持</p></section>
}

function NotificationsPanel({ notifications }: { notifications: OfficeResource<OfficeNotification[]> }) {
  const [readIds, setReadIds] = useState<string[]>([])
  const [busyId, setBusyId] = useState<string | null>(null); const [error, setError] = useState<string | null>(null)
  async function markRead(item: OfficeNotification) { if (item.read || readIds.includes(item.id)) return; setBusyId(item.id); setError(null); try { await officeGatewayApi.markNotificationRead(item.id); setReadIds((value) => [...value, item.id]) } catch (reason) { setError(reason instanceof Error ? reason.message : '通知更新失败') } finally { setBusyId(null) } }
  return <section className="panel-section"><div className="panel-heading"><h2>通知中心</h2><span className="panel-caption">系统消息</span></div><DataState state={notifications.state} empty={notifications.data.length === 0} error={notifications.error} />{error ? <p className="data-state data-state-error">{error}</p> : null}<ul className="notification-list">{notifications.data.map((item) => { const read = item.read || readIds.includes(item.id); return <li key={item.id} className={read ? 'read' : ''}><div><strong>{item.title}</strong><p>{item.body}</p><time>{new Date(item.createdAt).toLocaleString()}</time></div>{!read ? <button type="button" disabled={busyId === item.id} onClick={() => void markRead(item)}>{busyId === item.id ? '更新中…' : '标为已读'}</button> : <span className="notification-read">已读</span>}</li> })}</ul></section>
}

type OfficeRightPanelProps = {
  active?: OfficeSection
  workspaceAgents?: OfficeAgentSummary[]
  officeHidden?: boolean
  onNavigate?: (section: OfficeSection) => void
  onOfficeHiddenChange?: (hidden: boolean) => void
  onArtifactOpen?: (artifact: OfficeConversationArtifact) => void
  onConversationSelected?: (sessionId: string | null) => void
  conversationWorkspaceId?: string
}

/**
 * 功能：渲染当前导航对应的数据面板，并持有跨导航保留的会话摘要、选择和草稿。
 * 参数：active 指定当前中心；officeHidden 控制办公室显隐；其余回调用于导航和受控状态同步。
 * 返回：当前中心的右侧面板 React 节点。
 * 错误：资源错误由各子面板转换为可见状态，不向 React 渲染边界抛出。
 * 状态：办公室显隐由 App 受控；会话草稿按 sessionId 隔离，不影响后台回合。
 * 并发与取消：不同会话控制器独立运行；切换导航不会取消后台回合。
 * 权限：只展示 Gateway 已脱敏并允许进入浏览器的数据。
 * 关联：CHG-2026-0013、OfficeActionConnector、useConversationController。
 */
/** 中文门禁摘要：按导航渲染右侧面板，并保持多会话选择、草稿和运行态隔离。 */
export function OfficeRightPanel({ active = '首页', workspaceAgents = [], officeHidden = false, onNavigate, onOfficeHiddenChange, onArtifactOpen, onConversationSelected, conversationWorkspaceId }: OfficeRightPanelProps) {
  const [taskRefreshKey, setTaskRefreshKey] = useState(0)
  const [agentRefreshKey, setAgentRefreshKey] = useState(0)
  const [quickToolNotice, setQuickToolNotice] = useState<string | null>(null)
  const [conversationFocus, setConversationFocus] = useState<{ sessionId: string; requestId: number } | null>(null)
  const conversationFocusSequence = useRef(0)
  const [conversationSelectedId, setConversationSelectedId] = useState<string | null>(readStoredConversationSelection)
  const [conversationDrafts, setConversationDrafts] = useState<Record<string, string>>({})
  const [conversationCreatedSessions, setConversationCreatedSessions] = useState<OfficeSessionSummary[]>([])
  const home = active === '首页'
  const tasks = useOfficeResource(officeGatewayApi.tasks, [] as OfficeTaskSummary[], active === '任务中心' || active === '对话中心', taskRefreshKey)
  const agents = useOfficeResource(officeGatewayApi.agents, [] as OfficeAgentSummary[], home || active === '智能体', agentRefreshKey)
  const sessions = useConversationSessions(active === '对话中心' || active === '文件中心')
  const files = useOfficeResource(officeGatewayApi.files, [] as OfficeFileSummary[], active === '文件中心')
  const skills = useOfficeResource(officeGatewayApi.skills, [] as OfficeSkillSummary[], active === '技能中心')
  const workspace = useOfficeResource(officeGatewayApi.workspace, {} as OfficeWorkspaceSummary, active === '文件中心')
  const notifications = useOfficeResource(officeGatewayApi.notifications, [] as OfficeNotification[], active === '通知中心')
  const persistedConversationSessions = [
    ...conversationCreatedSessions,
    ...sessions.data.filter((session) => !conversationCreatedSessions.some((created) => created.id === session.id)),
  ]
  useEffect(() => {
    try {
      if (conversationSelectedId) window.sessionStorage.setItem(CONVERSATION_SELECTION_STORAGE_KEY, conversationSelectedId)
      else window.sessionStorage.removeItem(CONVERSATION_SELECTION_STORAGE_KEY)
    } catch {
      // 禁用浏览器存储时仍保留当前页面内的选择状态。
    }
  }, [conversationSelectedId])
  useEffect(() => onConversationSelected?.(conversationSelectedId), [conversationSelectedId, onConversationSelected])
  function openConversation(sessionId: string) {
    conversationFocusSequence.current += 1
    setConversationFocus({ sessionId, requestId: conversationFocusSequence.current })
    onNavigate?.('对话中心')
  }
  useEffect(() => {
    if (active !== '任务中心') return
    const timer = window.setInterval(() => setTaskRefreshKey((value) => value + 1), 1500)
    return () => window.clearInterval(timer)
  }, [active])
  useEffect(() => {
    if (active !== '首页' && active !== '智能体' && active !== '对话中心' && active !== '任务中心') return
    const timer = window.setInterval(() => setAgentRefreshKey((value) => value + 1), 1200)
    return () => window.clearInterval(timer)
  }, [active])
  const panels = active === '浏览器助手' ? <BrowserPanel />
    : active === '任务中心' ? <TasksPanel tasks={tasks} onCreated={() => setTaskRefreshKey((value) => value + 1)} onOpenConversation={openConversation} />
    : active === '智能体' ? <AgentsPanel agents={agents} workspaceAgents={workspaceAgents} />
      : active === '文件中心' ? <FilesPanel files={files} workspace={workspace} sessions={sessions} />
          : active === '技能中心' ? <SkillsPanel skills={skills} onNavigate={onNavigate} />
            : active === '日程日历' ? <CalendarPanel />
            : active === '通知中心' ? <NotificationsPanel notifications={notifications} />
          : active === '对话中心' ? <SessionsPanel
            sessions={sessions}
            tasks={tasks.data}
            initialSessionId={conversationSelectedId}
            focusRequest={conversationFocus}
            officeHidden={officeHidden}
            drafts={conversationDrafts}
            persistedSessions={persistedConversationSessions}
            onDraftChange={(sessionId, draft) => {
              setConversationDrafts((value) => {
                const next = { ...value }
                if (draft) next[sessionId] = draft
                else delete next[sessionId]
                return next
              })
            }}
            onOfficeHiddenChange={onOfficeHiddenChange}
            onArtifactOpen={onArtifactOpen}
            artifactWorkspaceId={conversationWorkspaceId}
            onSessionCreated={(session) => {
              setConversationCreatedSessions((value) => [session, ...value.filter((item) => item.id !== session.id)])
              const latest = getConversationSessionsSnapshot().data
              invalidateConversationSessions([session, ...latest.filter((item) => item.id !== session.id)])
              setConversationSelectedId(session.id)
            }}
            onSessionDeleted={(sessionId) => {
              setConversationCreatedSessions((value) => value.filter((item) => item.id !== sessionId))
              const latest = getConversationSessionsSnapshot().data
              invalidateConversationSessions(latest.filter((item) => item.id !== sessionId))
              setConversationDrafts((value) => {
                const next = { ...value }
                delete next[sessionId]
                return next
              })
              setConversationSelectedId((value) => value === sessionId ? null : value)
            }}
            onSessionSelected={setConversationSelectedId}
            onFocusConsumed={(requestId) => setConversationFocus((value) => value?.requestId === requestId ? null : value)}
          />
    : <AgentsPanel agents={agents} workspaceAgents={workspaceAgents} />
  function handleQuickTool(tool: QuickTool) {
    setQuickToolNotice(null)
    if (tool.label === '打开浏览器') {
      const popup = window.open('about:blank', '_blank', 'noopener,noreferrer')
      setQuickToolNotice(popup ? '已打开浏览器' : '浏览器阻止了新窗口，请允许弹窗')
    } else if (tool.label === '文件浏览') onNavigate?.('文件中心')
    else if (tool.label === '截图 OCR') onNavigate?.('浏览器助手')
    else if (tool.unsupported) setQuickToolNotice(`${tool.label}：不支持`)
  }
  return <aside className={`office-right-panel ${active === '对话中心' ? 'is-conversation' : ''}`}>{panels}{home ? <section className="panel-section"><h2>快捷工具</h2><div className="quick-tools">{QUICK_TOOLS.map((tool) => <button key={tool.label} type="button" className="quick-tool" onClick={() => handleQuickTool(tool)}><span>{tool.icon}</span><strong>{tool.label}</strong></button>)}</div>{quickToolNotice ? <p className="data-state quick-tool-notice">{quickToolNotice}</p> : null}</section> : null}</aside>
}

/**
 * 功能：渲染办公室底部快捷命令，并把场景控制请求提交给 Gateway。
 * 参数：onNavigate 切换功能中心；onStatus 仅接收暂停、导出或失败等需要用户感知的结果。
 * 返回：底部工具栏 React 节点。
 * 错误：Gateway 异常转换为中文状态提示；恢复办公室成功时保持静默。
 * 状态：busy 期间禁用全部工具栏命令，避免重复提交。
 * 并发与取消：同一组件一次只执行一个命令；卸载后不保留本地状态。
 * 权限：只调用 Gateway 暴露的动作、任务、智能体和会话接口。
 * 关联：CHG-2026-0013、officeGatewayApi.enqueueActions。
 */
/** 中文门禁摘要：渲染底部快捷命令，并把受控场景操作提交给 Gateway。 */
export function OfficeBottomToolbar({ scenePaused = false, onNavigate, onStatus, onScenePausedChange }: { scenePaused?: boolean; onNavigate?: (section: OfficeSection) => void; onStatus?: (message: string) => void; onScenePausedChange?: (paused: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  function toggleScenePaused() {
    const next = !scenePaused
    onScenePausedChange?.(next)
    onStatus?.(next ? '已暂停办公室场景显示' : '')
  }
  async function exportDailyReport() {
    setBusy(true)
    try {
      const [tasks, agents, sessions] = await Promise.all([officeGatewayApi.tasks(), officeGatewayApi.agents(), officeGatewayApi.sessions()])
      const report = [`AI Office 日报`, `生成时间：${new Date().toLocaleString()}`, '', `任务（${tasks.length}）`, ...tasks.map((task) => `- ${task.objective}：${task.status}`), '', `智能体（${agents.length}）`, ...agents.map((agent) => `- ${agent.name}：${agent.state}${agent.task ? `（${agent.task}）` : ''}`), '', `对话（${sessions.length}）`, ...sessions.map((session) => `- ${session.title}`)].join('\n')
      const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = `ai-office-${new Date().toISOString().slice(0, 10)}.txt`; link.click(); URL.revokeObjectURL(url); onStatus?.('日报已导出')
    } catch (error) { onStatus?.(error instanceof Error ? error.message : '日报导出失败') }
    finally { setBusy(false) }
  }
  return <div className="office-bottom-toolbar"><div className="toolbar-inner"><button type="button" aria-pressed={scenePaused} className="toolbar-btn" onClick={toggleScenePaused}><span className="toolbar-icon">{scenePaused ? '▶' : 'Ⅱ'}</span><span>{scenePaused ? '继续场景' : '暂停场景'}</span></button>{TOOLBAR_ITEMS.map((item) => <button key={item.label} type="button" disabled={busy} className={`toolbar-btn ${item.primary ? 'primary' : ''}`} onClick={() => { if (item.label === '任务调度') onNavigate?.('任务中心'); else if (item.label === '安排会议') onNavigate?.('日程日历'); else if (item.label === '导出日报') void exportDailyReport() }}><span className="toolbar-icon">{item.icon}</span><span>{item.label}</span></button>)}</div></div>
}
