/**
 * 功能：装配 AI Office 顶层导航、场景、数据面板和对话专注模式。
 * 输入边界：接收浏览器交互和 Gateway 数据；输出边界：只组合现有组件，不直接调用 Host 协议。
 * 状态：导航、工具栏提示和办公室显隐由顶层受控，切换中心不会卸载后台会话控制器状态。
 * 关联：`CHG-2026-0013`、`REQ-B-OFFICE-005`。
 */
import { useEffect, useState } from 'react'
import { AgentWorkspaceView } from '@/components/AgentWorkspaceView'
import { OfficeActionConnector } from '@/components/OfficeActionConnector'
import { OfficeCanvas } from '@/components/OfficeCanvas'
import { ArtifactViewer } from '@/components/ConversationArtifacts'
import {
  OfficeBottomToolbar,
  OfficeHeaderStats,
  OfficeRightPanel,
  OfficeSidebar,
  type OfficeSection,
} from '@/components/OfficeDashboardChrome'
import { prefetchConversationSessions } from '@/services/conversationSessionCache'
import {
  MAIN_OFFICE_WORKSPACE,
  MAIN_OFFICE_WORKSPACE_ID,
  OFFICE_WORKSPACE_OVERVIEW_ID,
  normalizeOfficeWorkspaceId,
  type OfficeWorkspaceId,
} from '@/config/officeWorkspaces'
import { officeGatewayApi } from '@/services/officeGatewayApi'
import type { OfficeAgentWorkspaceSummary, OfficeConversationArtifact } from '@/types/officeData'
import './App.css'

const OFFICE_SECTION_STORAGE_KEY = 'ai-office.ui.active-section.v1'
const OFFICE_HIDDEN_STORAGE_KEY = 'ai-office.ui.office-hidden.v1'
const OFFICE_WORKSPACE_STORAGE_KEY = 'ai-office.ui.workspace.v1'
const CONVERSATION_SELECTION_STORAGE_KEY = 'ai-office.ui.selected-session.v1'

function readStoredSection(): OfficeSection {
  try {
    const value = window.sessionStorage.getItem(OFFICE_SECTION_STORAGE_KEY)
    if (value === '首页' || value === '任务中心' || value === '智能体' || value === '文件中心'
      || value === '技能中心' || value === '浏览器助手' || value === '对话中心'
      || value === '日程日历' || value === '通知中心') return value
  } catch {
    // 禁用浏览器存储时回退到首页，不阻断首屏渲染。
  }
  return '首页'
}

function readStoredOfficeHidden() {
  try {
    return window.sessionStorage.getItem(OFFICE_HIDDEN_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function readStoredWorkspace(): OfficeWorkspaceId {
  try {
    return normalizeOfficeWorkspaceId(window.sessionStorage.getItem(OFFICE_WORKSPACE_STORAGE_KEY))
  } catch {
    return MAIN_OFFICE_WORKSPACE_ID
  }
}

function readStoredConversationId() {
  try {
    return window.sessionStorage.getItem(CONVERSATION_SELECTION_STORAGE_KEY)
  } catch {
    return null
  }
}

function mainWorkspaceForSession(sessionId: string | null): OfficeAgentWorkspaceSummary {
  return sessionId
    ? { ...MAIN_OFFICE_WORKSPACE, id: sessionId, sessionId }
    : MAIN_OFFICE_WORKSPACE
}

/**
 * 功能：渲染 AI Office 单页应用并协调顶层 UI 状态。
 * 参数：无。
 * 返回：包含侧栏、办公室场景、右侧中心和底部工具栏的 React 节点。
 * 错误：子组件自行呈现 Gateway 错误；本组件不吞掉渲染异常。
 * 状态：保存当前中心、工具栏提示和办公室显隐状态，并在空闲阶段预取会话摘要。
 * 并发与取消：空闲预取在卸载时取消回调或定时器，不取消已由共享缓存接管的网络请求。
 * 权限：不直接读取敏感数据，只组合已登记的前端服务。
 * 关联：`CHG-2026-0013`、`API-OFFICE-DATA-001`。
 */
function App() {
  const [activeSection, setActiveSection] = useState<OfficeSection>(readStoredSection)
  const [toolbarStatus, setToolbarStatus] = useState<string | null>(null)
  const [officeHidden, setOfficeHidden] = useState(readStoredOfficeHidden)
  const [officeScenePaused, setOfficeScenePaused] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(readStoredConversationId)
  const [selectedWorkspace, setSelectedWorkspace] = useState<OfficeWorkspaceId>(readStoredWorkspace)
  const [agentWorkspaces, setAgentWorkspaces] = useState<OfficeAgentWorkspaceSummary[]>(() => [mainWorkspaceForSession(readStoredConversationId())])
  const [agentWorkspacesReady, setAgentWorkspacesReady] = useState(false)
  const [activeArtifact, setActiveArtifact] = useState<OfficeConversationArtifact | null>(null)
  const mainWorkspace = agentWorkspaces.find((workspace) => workspace.kind === 'main')
  const selectedWorkspaceSummary = agentWorkspaces.find((workspace) => workspace.id === selectedWorkspace)
  const artifactWorkspace = activeArtifact?.workspaceId
    ? agentWorkspaces.find((workspace) => workspace.id === activeArtifact.workspaceId)
    : null
  const conversationFocusMode = activeSection === '对话中心' && officeHidden
  const workspaceArtifactMode = activeSection === '对话中心' && activeArtifact !== null && artifactWorkspace?.kind === 'subagent'
  const artifactFocusMode = activeSection === '对话中心' && activeArtifact !== null && !workspaceArtifactMode
  const workspaceOverviewMode = activeSection === '对话中心' && selectedWorkspace === OFFICE_WORKSPACE_OVERVIEW_ID
  function openArtifact(artifact: OfficeConversationArtifact) {
    const owner = artifact.workspaceId ? agentWorkspaces.find((workspace) => workspace.id === artifact.workspaceId) : null
    if (owner?.kind === 'subagent') setSelectedWorkspace(owner.id)
    setActiveArtifact(artifact)
  }
  useEffect(() => {
    try {
      window.sessionStorage.setItem(OFFICE_SECTION_STORAGE_KEY, activeSection)
    } catch {
      // 存储不可用时仅失去刷新恢复能力，不影响导航。
    }
  }, [activeSection])
  useEffect(() => {
    try {
      window.sessionStorage.setItem(OFFICE_HIDDEN_STORAGE_KEY, String(officeHidden))
    } catch {
      // 存储不可用时保持当前内存状态。
    }
  }, [officeHidden])
  useEffect(() => {
    try {
      window.sessionStorage.setItem(OFFICE_WORKSPACE_STORAGE_KEY, selectedWorkspace)
    } catch {
      // 存储不可用时保留当前页面内的工作空间选择。
    }
  }, [selectedWorkspace])
  useEffect(() => {
    let cancelled = false
    let controller: AbortController | null = null
    let timer: number | null = null
    const fallback = mainWorkspaceForSession(selectedConversationId)
    setAgentWorkspaces([fallback])
    setAgentWorkspacesReady(false)
    setSelectedWorkspace(fallback.id)
    if (!selectedConversationId) {
      setAgentWorkspacesReady(true)
      return () => { cancelled = true }
    }
    const load = async () => {
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 5_000)
      try {
        const items = await officeGatewayApi.agentWorkspaces(selectedConversationId, controller.signal)
        if (!cancelled) {
          if (items.length > 0) setAgentWorkspaces(items)
          setAgentWorkspacesReady(true)
        }
      } catch {
        // Gateway 短暂不可用时保留最近一次空间快照，不让场景闪回主空间。
      } finally {
        window.clearTimeout(timeout)
        if (!cancelled) timer = window.setTimeout(load, 1_200)
      }
    }
    void load()
    return () => {
      cancelled = true
      controller?.abort()
      if (timer != null) window.clearTimeout(timer)
    }
  }, [selectedConversationId])
  useEffect(() => {
    if (!agentWorkspacesReady) return
    if (selectedWorkspace === OFFICE_WORKSPACE_OVERVIEW_ID) return
    if (!agentWorkspaces.some((workspace) => workspace.id === selectedWorkspace)) setSelectedWorkspace(mainWorkspace?.id || MAIN_OFFICE_WORKSPACE_ID)
  }, [agentWorkspaces, agentWorkspacesReady, mainWorkspace?.id, selectedWorkspace])
  useEffect(() => {
    if (activeSection !== '对话中心' && activeArtifact) setActiveArtifact(null)
  }, [activeArtifact, activeSection])
  useEffect(() => {
    const browserWindow = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback) => number
      cancelIdleCallback?: (handle: number) => void
    }
    if (browserWindow.requestIdleCallback) {
      const handle = browserWindow.requestIdleCallback(() => prefetchConversationSessions())
      return () => browserWindow.cancelIdleCallback?.(handle)
    }
    const timer = window.setTimeout(prefetchConversationSessions, 800)
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <div className={`office-app${conversationFocusMode ? ' conversation-focus-mode' : ''}${artifactFocusMode ? ' artifact-focus-mode' : ''}${workspaceOverviewMode ? ' workspace-overview-mode' : ''}${activeSection === '对话中心' ? ' is-conversation-section' : ''}`}>
      <OfficeActionConnector paused={officeScenePaused} />
      <OfficeSidebar active={activeSection} selectedWorkspace={selectedWorkspace} workspaces={agentWorkspaces} onSelect={setActiveSection} onWorkspaceSelect={setSelectedWorkspace} />
      <div className={`office-center${workspaceOverviewMode ? ' is-workspace-overview' : ''}`} aria-hidden={conversationFocusMode || artifactFocusMode || undefined}>
        {activeSection !== '首页' && !workspaceOverviewMode ? <OfficeHeaderStats /> : null}
        <main className={`office-main${workspaceArtifactMode ? ' is-workspace-artifact' : ''}`}>
          {workspaceArtifactMode && activeArtifact
            ? <ArtifactViewer artifact={activeArtifact} embedded onClose={() => setActiveArtifact(null)} />
            : <>
              {selectedWorkspaceSummary?.kind === 'main' ? <div className="office-scene-layer is-active"><OfficeCanvas workspaceId={selectedWorkspaceSummary.id} sessionId={selectedWorkspaceSummary.sessionId} agentSummaries={selectedWorkspaceSummary.agents} publishToStore /></div> : null}
              {selectedWorkspace === OFFICE_WORKSPACE_OVERVIEW_ID || selectedWorkspaceSummary?.kind === 'subagent' ? <div className="workspace-scene-layer"><AgentWorkspaceView workspaceId={selectedWorkspace} workspaces={agentWorkspaces} onArtifactOpen={openArtifact} onWorkspaceSelect={setSelectedWorkspace} /></div> : null}
              <OfficeBottomToolbar scenePaused={officeScenePaused} onNavigate={setActiveSection} onStatus={setToolbarStatus} onScenePausedChange={setOfficeScenePaused} />
            </>}
        </main>
      </div>
      <OfficeRightPanel
        active={activeSection}
        workspaceAgents={mainWorkspace?.agents}
        officeHidden={officeHidden}
        onNavigate={setActiveSection}
        onOfficeHiddenChange={setOfficeHidden}
        onArtifactOpen={openArtifact}
        onConversationSelected={setSelectedConversationId}
        conversationWorkspaceId={mainWorkspace?.id}
      />
      {artifactFocusMode && activeArtifact ? <ArtifactViewer artifact={activeArtifact} onClose={() => setActiveArtifact(null)} /> : null}
      {toolbarStatus ? <p className="toolbar-status" role="status">{toolbarStatus}</p> : null}
    </div>
  )
}

export default App
