import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { OfficeBottomToolbar, OfficeRightPanel, OfficeSidebar } from '@/components/OfficeDashboardChrome'
import { AgentWorkspaceView } from '@/components/AgentWorkspaceView'
import { ArtifactViewer, ConversationArtifactDock } from '@/components/ConversationArtifacts'
import { resetConversationViewStore, updateConversationView } from '@/services/conversationViewStore'
import { resetConversationSessionCache } from '@/services/conversationSessionCache'
import { resetConversationControllers } from '@/services/useConversationController'
import { useOfficeResource } from '@/services/useOfficeResource'
import { INITIAL_AGENTS } from '@/scene/layout/officeLayout'
import { setOfficeAgents } from '@/store/officeStore'
import type { OfficeAgentWorkspaceSummary } from '@/types/officeData'

const payloads = {
  '/office/tasks': [{ id: 'goal-1', objective: '市场调研', status: 'in_progress', priority: 'high', nextAction: '扫描来源' }],
  '/office/agents': [{ rosterNo: 1, id: 'marvis', name: '王明', state: 'thinking', task: '分析' }],
  '/office/sessions': [{ id: 's1', title: '查找 TODO', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }],
  '/office/files': [{ path: 'README.md', type: 'file' }],
  '/office/skills': [{ name: 'research', path: 'skills/research/SKILL.md' }],
}

function workspaceFixture(id: string, name: string, kind: 'main' | 'subagent' = 'subagent'): OfficeAgentWorkspaceSummary {
  return {
    id,
    name,
    kind,
    updatedAt: 1,
    agents: INITIAL_AGENTS.map((agent, index) => ({ rosterNo: index + 1, id: agent.id, name: agent.name, state: 'idle', task: '' })),
  }
}

describe('仪表板数据面板', () => {
  beforeEach(() => {
    setOfficeAgents(INITIAL_AGENTS.map((agent) => ({ ...agent })))
    window.sessionStorage.clear()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    resetConversationControllers()
    resetConversationViewStore()
    resetConversationSessionCache()
    vi.stubGlobal('fetch', vi.fn((input) => {
      const pathname = new URL(String(input)).pathname
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payloads[pathname as keyof typeof payloads] ?? []) })
    }))
  })

  it('工具角色在人物交接开始前不会提前显示工作中', async () => {
    const agents = INITIAL_AGENTS.map((agent, index) => ({
      rosterNo: index + 1,
      id: agent.id,
      name: agent.name,
      state: agent.id === 'code-agent' ? 'working' : 'idle',
      task: agent.id === 'code-agent' ? 'web_search' : '',
    }))
    vi.stubGlobal('fetch', vi.fn((input) => {
      const pathname = new URL(String(input)).pathname
      return Promise.resolve({ ok: true, json: () => Promise.resolve(pathname === '/office/agents' ? agents : []) })
    }))

    render(<OfficeRightPanel active="智能体" />)

    const row = await screen.findByText('李研')
    expect(row.closest('li')).toHaveTextContent('空闲')
    expect(row.closest('li')).not.toHaveTextContent('工作中')
  })

  it('首页和智能体中心优先显示当前会话工作区状态', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([
      { rosterNo: 1, id: 'marvis', name: '王明', state: 'idle', task: '' },
    ]) })))
    const workspaceAgents = [{ rosterNo: 1, id: 'marvis', name: '王明', state: 'thinking' as const, task: '正在整理当前对话' }]
    const view = render(<OfficeRightPanel workspaceAgents={workspaceAgents} />)

    expect(screen.getByText('王明').closest('li')).toHaveTextContent('正在整理当前对话')
    expect(screen.getByText('王明').closest('li')).toHaveTextContent('思考中')

    view.rerender(<OfficeRightPanel active="智能体" workspaceAgents={workspaceAgents} />)
    expect(screen.getByText('王明').closest('li')).toHaveTextContent('正在整理当前对话')
  })

  it('首页仅渲染智能体和快捷工具且不加载任务内容区', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payloads[pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel />)
    await waitFor(() => expect(screen.getByText('王明')).toBeInTheDocument())
    expect(screen.getByText('快捷工具')).toBeInTheDocument()
    expect(screen.queryByText('市场调研')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '任务中心' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建任务' })).not.toBeInTheDocument()
    expect(screen.queryByText('查找 TODO')).not.toBeInTheDocument()
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname === '/office/tasks')).toBe(false)
  })

  it('分别显示空状态和连接失败状态', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))
    render(<OfficeRightPanel />)
    await waitFor(() => expect(screen.getAllByText('暂无数据').length).toBeGreaterThan(0))
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('网关离线'))))
    render(<OfficeRightPanel />)
    await waitFor(() => expect(screen.getAllByText('无法连接办公室网关').length).toBeGreaterThan(0))
  })

  it('网关资源待返回时显示加载状态', async () => {
    let resolveResponse: ((response: { ok: boolean; json: () => Promise<unknown> }) => void) | undefined
    const pending = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveResponse = resolve
    })
    vi.stubGlobal('fetch', vi.fn(() => pending))

    render(<OfficeRightPanel active="任务中心" />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()

    resolveResponse?.({ ok: true, json: () => Promise.resolve([]) })
    await waitFor(() => expect(screen.getByText('暂无数据')).toBeInTheDocument())
  })

  it('后台刷新保留最近成功数据且不重新显示加载状态', async () => {
    let resolveRefresh: ((value: string[]) => void) | undefined
    const loader = vi.fn()
      .mockResolvedValueOnce(['已有任务'])
      .mockImplementationOnce(() => new Promise<string[]>((resolve) => { resolveRefresh = resolve }))

    function RefreshHarness() {
      const [refreshKey, setRefreshKey] = useState(0)
      const resource = useOfficeResource(loader, [] as string[], true, refreshKey)
      return <><button type="button" onClick={() => setRefreshKey((value) => value + 1)}>刷新</button><span>{resource.state}</span>{resource.data.map((item) => <p key={item}>{item}</p>)}</>
    }

    render(<RefreshHarness />)
    await waitFor(() => expect(screen.getByText('已有任务')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    expect(screen.getByText('已有任务')).toBeInTheDocument()
    expect(screen.getByText('ready')).toBeInTheDocument()
    expect(screen.queryByText('loading')).not.toBeInTheDocument()

    resolveRefresh?.(['更新任务'])
    await waitFor(() => expect(screen.getByText('更新任务')).toBeInTheDocument())
  })

  it('通过侧栏导航切换右侧面板', async () => {
    const onSelect = vi.fn()
    render(<OfficeSidebar onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /任务中心/ }))
    expect(onSelect).toHaveBeenCalledWith('任务中心')
    await waitFor(() => expect(screen.getByRole('button', { name: /任务中心/ })).toHaveTextContent('1'))
    expect(screen.getByRole('button', { name: /对话中心/ })).not.toHaveTextContent('1')
  })

  it('侧栏可以切换单 Agent 空间和多空间总览', () => {
    const onWorkspaceSelect = vi.fn()
    const workspaces = [workspaceFixture('main', '我的空间', 'main'), workspaceFixture('research-agent', '旅行研究 Agent')]
    render(<OfficeSidebar selectedWorkspace="research-agent" workspaces={workspaces} onWorkspaceSelect={onWorkspaceSelect} />)
    expect(screen.getByRole('button', { name: '旅行研究 Agent' })).toHaveAttribute('aria-current', 'true')
    expect(screen.queryByRole('button', { name: '市场部空间' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '空间总览' }))
    expect(onWorkspaceSelect).toHaveBeenCalledWith('overview')
  })

  it('空间总览按真实 Agent 数量展示完整六人办公室和跨空间关系', () => {
    const main = workspaceFixture('main', '我的空间', 'main')
    const child = workspaceFixture('research-agent', '旅行研究 Agent')
    const onWorkspaceSelect = vi.fn()
    child.outputs = [{ id: 'output-1', kind: 'activity', text: '正在整理旅行资料', state: 'working', rosterNo: 2, createdAt: 1 }]
    child.relation = { peerWorkspaceId: 'main', direction: 'outgoing', phase: 'going', message: '刘市正在向主 Agent 交付', rosterNo: 5 }
    render(<AgentWorkspaceView workspaceId="overview" workspaces={[main, child]} onWorkspaceSelect={onWorkspaceSelect} />)
    expect(screen.getByRole('heading', { name: '多 Agent 空间总览' })).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(screen.getByLabelText('main 办公室场景')).toBeInTheDocument()
    expect(screen.getByLabelText('research-agent 办公室场景')).toBeInTheDocument()
    expect(screen.getByText('刘市正在向主 Agent 交付')).toBeInTheDocument()
    expect(screen.getByLabelText('刘市正在向主 Agent 交付')).toHaveClass('phase-goto')
    fireEvent.click(screen.getByRole('button', { name: '查看旅行研究 Agent输出' }))
    expect(screen.getByRole('dialog', { name: '旅行研究 Agent输出记录' })).toHaveTextContent('李研 · 正在整理旅行资料')
    fireEvent.click(screen.getByRole('button', { name: /^旅行研究 Agent子 Agent$/ }))
    expect(onWorkspaceSelect).toHaveBeenCalledWith('research-agent')
  })

  it('空间总览滚出视口后暂停但不销毁已初始化的办公室', () => {
    const callbacks: IntersectionObserverCallback[] = []
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) { callbacks.push(callback) }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
      readonly root = null
      readonly rootMargin = '320px 0px'
      readonly thresholds = [0]
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    const workspace = workspaceFixture('stable-agent', '稳定性 Agent')

    render(<AgentWorkspaceView workspaceId="overview" workspaces={[workspace]} />)
    expect(screen.queryByLabelText('stable-agent 办公室场景')).not.toBeInTheDocument()

    act(() => callbacks[0]?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    const scene = screen.getByLabelText('stable-agent 办公室场景')
    expect(scene).toHaveAttribute('data-visual-paused', 'false')

    act(() => callbacks[0]?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(screen.getByLabelText('stable-agent 办公室场景')).toBe(scene)
    expect(scene).toHaveAttribute('data-visual-paused', 'true')

    act(() => callbacks[0]?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(screen.getByLabelText('stable-agent 办公室场景')).toBe(scene)
    expect(scene).toHaveAttribute('data-visual-paused', 'false')
  })

  it('空间总览同时展示同一主 Agent 发出的多条并行交接', () => {
    const main = workspaceFixture('main', '我的空间', 'main')
    const research = workspaceFixture('research-agent', '研究 Agent')
    const writer = workspaceFixture('writer-agent', '撰写 Agent')
    main.relations = [
      { peerWorkspaceId: research.id, direction: 'outgoing', phase: 'going', message: '向研究 Agent 交接', rosterNo: 5 },
      { peerWorkspaceId: writer.id, direction: 'outgoing', phase: 'talking', message: '向撰写 Agent 交接', rosterNo: 5 },
    ]
    research.relations = [{ peerWorkspaceId: main.id, direction: 'incoming', phase: 'going', message: '向研究 Agent 交接', rosterNo: 5 }]
    writer.relations = [{ peerWorkspaceId: main.id, direction: 'incoming', phase: 'talking', message: '向撰写 Agent 交接', rosterNo: 5 }]

    render(<AgentWorkspaceView workspaceId="overview" workspaces={[main, research, writer]} />)

    expect(screen.getByLabelText('向研究 Agent 交接')).toHaveClass('phase-goto')
    expect(screen.getByLabelText('向撰写 Agent 交接')).toHaveClass('phase-talk')
  })

  it('点击空间卡片的办公室空白区域直接进入对应空间', () => {
    const child = workspaceFixture('research-agent', '旅行研究 Agent')
    const onWorkspaceSelect = vi.fn()
    const { container } = render(<AgentWorkspaceView workspaceId="overview" workspaces={[child]} onWorkspaceSelect={onWorkspaceSelect} />)

    fireEvent.click(container.querySelector('.agent-space-canvas') as HTMLElement)
    expect(onWorkspaceSelect).toHaveBeenCalledWith('research-agent')
  })

  it('空间总览中的子 Agent 产物货架可以打开并查看产物', async () => {
    const main = workspaceFixture('main', '我的空间', 'main')
    const child = workspaceFixture('research-agent', '研究 Agent')
    main.sessionId = 'session-artifacts'
    child.sessionId = 'session-artifacts'
    const onArtifactOpen = vi.fn()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/artifacts')) return Promise.resolve({ ok: true, json: () => Promise.resolve(url.searchParams.get('workspaceId') === 'research-agent' ? [{ id: 'report', name: '研究报告.md', path: '研究报告.md', kind: 'markdown', size: 120 }] : []) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    }))

    render(<AgentWorkspaceView workspaceId="overview" workspaces={[main, child]} onArtifactOpen={onArtifactOpen} />)

    const childCard = screen.getByText('研究 Agent').closest('article')
    expect(childCard).not.toBeNull()
    const shelf = await within(childCard as HTMLElement).findByRole('button', { name: /打开当前协作空间的产物货架/ })
    await waitFor(() => expect(shelf).toBeEnabled())
    fireEvent.click(shelf)
    expect(screen.queryByText('研究报告.md')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /规划文档|文档/ })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /研究报告/ }))
    expect(onArtifactOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'report', path: '研究报告.md' }))
  })

  it('子 Agent 空间包含与主空间一致的完整六人名册', () => {
    const child = workspaceFixture('writer-agent', '方案撰写 Agent')
    render(<AgentWorkspaceView workspaceId="writer-agent" workspaces={[child]} />)
    expect(screen.getByLabelText('writer-agent 办公室场景')).toBeInTheDocument()
    expect(screen.queryByText('SUB AGENT')).not.toBeInTheDocument()
  })

  it('侧栏悬停或聚焦对话中心时预取会话摘要', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const pathname = new URL(String(input)).pathname
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeSidebar />)
    const conversations = screen.getByRole('button', { name: /对话中心/ })
    fireEvent.mouseEnter(conversations)
    await waitFor(() => expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname === '/office/sessions')).toBe(true))
    const sessionReads = request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/office/sessions').length
    fireEvent.focus(conversations)
    await waitFor(() => expect(request.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/office/sessions')).toHaveLength(sessionReads))
  })

  it('浏览器导航显示不支持且不发起请求', () => {
    const request = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="浏览器助手" />)
    expect(screen.getByText('浏览器助手')).toBeInTheDocument()
    expect(screen.getByText('不支持')).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('快捷工具对未实现的语音入口显示中文状态', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })))
    render(<OfficeRightPanel />)
    await waitFor(() => expect(screen.getAllByText('暂无数据').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: /语音输入/ }))
    expect(screen.getByText('语音输入：不支持')).toBeInTheDocument()
  })

  it('切换到日程时仍请求常驻任务数量', async () => {
    const request = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }))
    vi.stubGlobal('fetch', request)
    render(<OfficeSidebar active="日程日历" />)
    await waitFor(() => expect(request).toHaveBeenCalled())
    expect(request.mock.calls.every(([input]) => new URL(String(input)).pathname === '/office/tasks')).toBe(true)
  })

  it('任务数量在对话、文件和日程导航中持续显示', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([
      { id: 't1' }, { id: 't2' }, { id: 't3' },
    ]) })))
    const view = render(<OfficeSidebar active="对话中心" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /任务中心/ })).toHaveTextContent('3'))
    view.rerender(<OfficeSidebar active="文件中心" />)
    expect(screen.getByRole('button', { name: /任务中心/ })).toHaveTextContent('3')
    view.rerender(<OfficeSidebar active="日程日历" />)
    expect(screen.getByRole('button', { name: /任务中心/ })).toHaveTextContent('3')
  })

  it('新建对话仅提交名称并触发网关代理', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations') return Promise.resolve({ ok: true, json: () => Promise.resolve({ promptAccepted: false, session: { id: 'new-1', title: '新会话', provider: 'openai', model: 'gpt-4o', createdAt: 1000, updatedAt: 1000 } }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    fireEvent.click(screen.getByRole('button', { name: '+ 新建对话' }))
    await waitFor(() => expect(screen.getByPlaceholderText('例如：整理发布计划')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('对话名称'), { target: { value: '新会话' } })
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await waitFor(() => expect(screen.getAllByText('新会话').length).toBeGreaterThan(0))
    expect(screen.queryByText('对话已创建，可开始发送消息')).not.toBeInTheDocument()
    const conversationCall = request.mock.calls.find(([input]) => new URL(String(input)).pathname === '/office/conversations')
    expect(conversationCall?.[1]).toMatchObject({ method: 'POST' })
    const submitted = JSON.parse(String(conversationCall?.[1]?.body))
    expect(submitted).toMatchObject({ title: '新会话' })
    expect(submitted.requestID).toMatch(/^office-create-[\x20-\x7e]+$/)
    expect(submitted).not.toHaveProperty('text')
  })

  it('对话中心保留简洁标题并将模型配置固定在网关', async () => {
    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getAllByText('查找 TODO').length).toBeGreaterThan(0))
    const heading = screen.getByRole('heading', { name: '对话中心' })
    expect(heading.tagName).toBe('H2')
    expect(heading.parentElement).not.toHaveTextContent('任务记录目标与进度')
    expect(screen.queryByText(/默认配置/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ 新建对话' }))
    expect(screen.getByLabelText('对话名称')).toBeInTheDocument()
    expect(screen.queryByLabelText('回答方式')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('告诉王明你想讨论或完成什么')).not.toBeInTheDocument()
    expect(screen.queryByText('权限请求')).not.toBeInTheDocument()
  })

  it('对话中心可以受控隐藏和显示办公室', async () => {
    function OfficeVisibilityHarness() {
      const [hidden, setHidden] = useState(false)
      return <OfficeRightPanel active="对话中心" officeHidden={hidden} onOfficeHiddenChange={setHidden} />
    }

    render(<OfficeVisibilityHarness />)
    const hideButton = await screen.findByRole('button', { name: '隐藏办公室' })
    expect(hideButton).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(hideButton)
    expect(screen.getByRole('button', { name: '显示办公室' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('按会话展示折叠产物货架并可打开产物', async () => {
    const artifact = {
      id: 's1:report.md', sessionId: 's1', path: 'report.md', name: 'report.md', kind: 'markdown' as const,
      mimeType: 'text/markdown; charset=utf-8', size: 1024, updatedAt: 1000,
    }
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/artifacts') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([artifact]) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    const open = vi.fn()
    render(<ConversationArtifactDock sessionId="s1" pending={false} generation={1} officeHidden workspaceId="research-agent" onOpen={open} />)
    const shelf = await screen.findByRole('button', { name: '打开产物货架，共 1 项产物' })
    expect(request.mock.calls.some(([input]) => new URL(String(input)).searchParams.get('workspaceId') === 'research-agent')).toBe(true)
    expect(screen.queryByRole('button', { name: /report/ })).not.toBeInTheDocument()
    fireEvent.click(shelf)
    const item = await screen.findByRole('button', { name: /report/ })
    expect(screen.queryByText('report.md')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '文档' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '产物清单' })).toBeInTheDocument()
    fireEvent.click(item)
    expect(open).toHaveBeenCalledWith(artifact)
  })

  it('回合结束后延迟登记的产物无需切换页面即可点击', async () => {
    const artifact = {
      id: 's1:late.md', sessionId: 's1', path: 'late.md', name: 'late.md', kind: 'markdown' as const,
      mimeType: 'text/markdown; charset=utf-8', size: 20, updatedAt: 1000,
    }
    let artifactReads = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/artifacts') {
        artifactReads += 1
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(artifactReads >= 3 ? [artifact] : []) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    }))
    const view = render(<ConversationArtifactDock sessionId="s1" pending generation={1} officeHidden onOpen={vi.fn()} />)
    await waitFor(() => expect(artifactReads).toBeGreaterThanOrEqual(1))
    view.rerender(<ConversationArtifactDock sessionId="s1" pending={false} generation={1} officeHidden onOpen={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('button', { name: '打开产物货架，共 1 项产物' })).toBeEnabled(), { timeout: 1500 })
  })

  it('产物查看器复用 Markdown 预览并提供返回操作', async () => {
    const artifact = {
      id: 's1:report.md', sessionId: 's1', path: 'report.md', name: 'report.md', kind: 'markdown' as const,
      mimeType: 'text/markdown; charset=utf-8', size: 20, updatedAt: 1000,
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ path: 'report.md', content: '# 交付报告\n\n内容' }) })))
    const close = vi.fn()
    render(<ArtifactViewer artifact={artifact} onClose={close} />)
    await waitFor(() => expect(screen.getByRole('heading', { name: '交付报告', level: 1 })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '关闭产物' }))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('JavaScript 产物只按源码显示且不会执行', async () => {
    const artifact = {
      id: 's1:tools/output.js', sessionId: 's1', path: 'tools/output.js', name: 'output.js', kind: 'text' as const,
      mimeType: 'text/javascript; charset=utf-8', size: 42, updatedAt: 1000,
    }
    const source = 'window.__artifactExecuted = true\nconsole.log("deliverable")'
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ path: artifact.path, content: source }) })))
    const { container } = render(<ArtifactViewer artifact={artifact} onClose={vi.fn()} />)

    await waitFor(() => expect(container.querySelector('pre code')?.textContent).toBe(source))
    expect(screen.getByText('JavaScript 解析通过 · Script')).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    expect((window as Window & { __artifactExecuted?: boolean }).__artifactExecuted).toBeUndefined()
  })

  it('同一回合只突出最终答复并折叠过程播报', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads['/office/sessions']) })
      if (url.pathname === '/office/conversations/s1/messages') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { info: { id: 'u1', role: 'user' }, parts: [{ type: 'text', text: '生成交付物' }] },
        { info: { id: 'a1', role: 'assistant' }, parts: [{ type: 'text', text: '我先检查目录' }] },
        { info: { id: 'a2', role: 'assistant' }, parts: [{ type: 'text', text: '结论：已完成。\n\n生成文件：`output.js`' }] },
        { info: { id: 'done', role: 'system', kind: 'completed', turnID: 't1' }, parts: [] },
      ]) })
      if (url.pathname === '/office/conversations/status') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    }))
    const { container } = render(<OfficeRightPanel active="对话中心" />)

    await waitFor(() => expect(screen.getByText(/结论：已完成/)).toBeInTheDocument())
    const process = screen.getByText('执行过程（1 条）').closest('details')
    expect(process).not.toHaveAttribute('open')
    expect(process).toHaveTextContent('我先检查目录')
    expect(container.querySelectorAll('.transcript-message.assistant')).toHaveLength(1)
  })

  it.each([
    ['bar', '柱状图', 'artifact-chart-bar'],
    ['line', '折线图', 'artifact-chart-stroke'],
    ['area', '面积图', 'artifact-chart-area'],
    ['pie', '饼图', 'artifact-chart-pie'],
    ['donut', '环形图', 'artifact-chart-pie'],
    ['radar', '雷达图', 'artifact-chart-radar-series'],
  ])('产物查看器渲染带动画的 %s 数据图表', async (type, label, className) => {
    const artifact = {
      id: `s1:output-${type}.chart.json`, sessionId: 's1', path: `output-${type}.chart.json`, name: `output-${type}.chart.json`, kind: 'diagram' as const,
      mimeType: 'application/vnd.ai-office.chart+json; charset=utf-8', size: 200, updatedAt: 1000,
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
      path: artifact.path,
      content: JSON.stringify({ type, title: '产物趋势', subtitle: '真实数据展示', unit: '项', categories: ['阶段一', '阶段二', '阶段三'], series: [{ name: '完成量', data: [8, 21, 34] }] }),
    }) })))
    const { container } = render(<ArtifactViewer artifact={artifact} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText(`产物趋势，${label}`)).toBeInTheDocument())
    expect(container.querySelector(`.${className}`)).not.toBeNull()
  })

  it('未发送草稿按会话隔离并在导航切换后保留', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'a', title: '草稿对话 A', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
        { id: 'b', title: '草稿对话 B', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
      ]) })
      if (/^\/office\/conversations\/(a|b)\/(messages|status)$/.test(url.pathname)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.pathname.endsWith('/status') ? {} : []) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)

    const view = render(<OfficeRightPanel active="对话中心" />)
    const composer = await screen.findByLabelText('输入下一条消息')
    const sessionSelect = screen.getByRole('combobox', { name: '最近对话' })
    fireEvent.change(composer, { target: { value: 'A 的未发送草稿' } })
    fireEvent.change(sessionSelect, { target: { value: 'b' } })
    expect(screen.getByLabelText('输入下一条消息')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: 'B 的未发送草稿' } })
    fireEvent.change(sessionSelect, { target: { value: 'a' } })
    expect(screen.getByLabelText('输入下一条消息')).toHaveValue('A 的未发送草稿')

    view.rerender(<OfficeRightPanel active="文件中心" />)
    view.rerender(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toHaveValue('A 的未发送草稿'))
  })

  it('任务深链选择只消费一次，之后手动切换不会被拉回', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/tasks') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'task-a', objective: '任务甲', status: 'in_progress', priority: 'normal', nextAction: '执行中', sessionId: 'a' },
      ]) })
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'a', title: '对话 A', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
        { id: 'b', title: '对话 B', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
      ]) })
      if (url.pathname === '/office/permissions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      if (/^\/office\/conversations\/(a|b)\/(messages|status)$/.test(url.pathname)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.pathname.endsWith('/status') ? {} : []) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    function NavigationHarness() {
      const [active, setActive] = useState<'任务中心' | '对话中心'>('任务中心')
      return <OfficeRightPanel active={active} onNavigate={(section) => {
        if (section === '任务中心' || section === '对话中心') setActive(section)
      }} />
    }
    render(<NavigationHarness />)
    await waitFor(() => expect(screen.getByText('任务甲')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '查看执行对话' }))
    const sessionSelect = await screen.findByRole('combobox', { name: '最近对话' })
    await waitFor(() => expect(sessionSelect).toHaveValue('a'))
    fireEvent.change(sessionSelect, { target: { value: 'b' } })
    await waitFor(() => expect(sessionSelect).toHaveValue('b'))
    await new Promise((resolve) => window.setTimeout(resolve, 50))
    expect(sessionSelect).toHaveValue('b')
  })

  it('对话中心不渲染权限栏，也不启动权限轮询', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'a', title: '对话 A', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
        { id: 'b', title: '对话 B', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
      ]) })
      if (/^\/office\/conversations\/(a|b)\/(messages|status)$/.test(url.pathname)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.pathname.endsWith('/status') ? {} : []) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    await screen.findByRole('combobox', { name: '最近对话' })
    expect(screen.queryByText('权限请求')).not.toBeInTheDocument()
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname === '/office/permissions')).toBe(false)
  })

  it('发送后立即显示用户消息和智能体思考状态', async () => {
    const pending = new Promise(() => undefined)
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages' && init?.method === 'POST') return pending
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '请分析测试失败原因' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(screen.getByText('请分析测试失败原因')).toBeInTheDocument()
    expect(document.querySelector('.transcript-message.pending')).toBeInTheDocument()
    expect(screen.getByText('智能体正在思考…')).toBeInTheDocument()
  })

  it('网关拒绝发送时保留用户消息并把失败追加到当前对话正文', async () => {
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages' && init?.method === 'POST') {
        return Promise.reject(new Error('回合正在处理中（409）'))
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '不会发送成功' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('消息未进入执行：回合正在处理中（409）')).toBeInTheDocument())
    expect(screen.getByText('不会发送成功')).toBeInTheDocument()
    expect(screen.getByLabelText('输入下一条消息')).toBeEnabled()
  })

  it('Host 离线刷新后优先显示浏览器持久化的失败正文', async () => {
    window.localStorage.setItem('ai-office.conversation-notices.v1', JSON.stringify({
      'offline-refresh': [
        { info: { id: 'local-user-offline', sessionID: 'offline-refresh', role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: '失败后刷新仍可见' }] },
        { info: { id: 'local-notice-offline', sessionID: 'offline-refresh', role: 'system', kind: 'error', time: { created: 2, completed: 2 } }, parts: [{ type: 'text', text: '消息未进入执行：无法连接 OpenPaw 引擎' }] },
      ],
    }))
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'offline-refresh', title: '离线失败会话', provider: 'openai', model: 'gpt5.6', createdAt: 1, updatedAt: 2 },
      ]) })
      if (/^\/office\/conversations\/offline-refresh\/(messages|status)$/.test(url.pathname)) {
        return Promise.reject(new Error('无法连接 OpenPaw 引擎'))
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)

    render(<OfficeRightPanel active="对话中心" />)

    expect(await screen.findByText('失败后刷新仍可见')).toBeInTheDocument()
    expect(screen.getByText('消息未进入执行：无法连接 OpenPaw 引擎')).toBeInTheDocument()
    expect(screen.queryByText('正在读取消息…')).not.toBeInTheDocument()
    expect(screen.queryByText('消息读取失败，请重新选择该对话')).not.toBeInTheDocument()
  })

  it('回合完成后用真实消息替换临时状态', async () => {
    let messageReads = 0
    let started = false
    let busyEmitted = false
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages' && init?.method === 'POST') { started = true; return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ accepted: true, sessionId: 's1' }) }) }
      if (url.pathname === '/office/conversations/s1/status') {
        const active = started && !busyEmitted
        if (active) busyEmitted = true
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(active ? { s1: { type: 'busy' } } : {}) })
      }
      if (url.pathname === '/office/conversations/s1/messages') {
        messageReads += 1
        const messages = messageReads === 1 ? [] : [
          { info: { id: 'u2', role: 'user' }, parts: [{ type: 'text', text: '给出结论' }] },
          { info: { id: 'a2', role: 'assistant' }, parts: [{ type: 'text', text: '结论已经生成' }] },
        ]
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(messages) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '给出结论' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('结论已经生成')).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('.transcript-message.pending')).not.toBeInTheDocument())
    expect(screen.getAllByText('给出结论')).toHaveLength(1)
  })

  it('任务中心按真实状态显示，而不是固定进行中', async () => {
    vi.stubGlobal('fetch', vi.fn((input) => {
      const pathname = new URL(String(input)).pathname
      if (pathname === '/office/tasks') return Promise.resolve({ ok: true, json: () => Promise.resolve([
        { id: 'done', objective: '完成项', status: 'completed', priority: 1, nextAction: '' },
        { id: 'blocked', objective: '待处理项', status: 'blocked', priority: 2, nextAction: '等待审批' },
        { id: 'failed', objective: '失败项', status: 'failed', priority: 3, nextAction: '' },
      ]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    }))
    render(<OfficeRightPanel active="任务中心" />)
    await waitFor(() => expect(screen.getByText('完成项')).toBeInTheDocument())
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('待处理')).toBeInTheDocument()
    expect(screen.getByText('失败')).toBeInTheDocument()
    expect(screen.queryByText('进行中')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建任务' })).toBeEnabled()
  })

  it('选择文件后读取网关返回的内容', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/files') return Promise.resolve({ ok: true, json: () => Promise.resolve([{ path: 'README.md', type: 'file' }, { path: 'src', type: 'directory' }]) })
      if (url.pathname === '/office/file') return Promise.resolve({ ok: true, json: () => Promise.resolve({ path: 'README.md', content: '# 内容\n\n> 摘要\n\n---\n\n| 项目 | 状态 |\n|---|---|\n| 对话 | 正常 |' }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<><main className="office-main" /><OfficeRightPanel active="文件中心" /></>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'README.md' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'README.md' }))
    expect(await screen.findByRole('dialog', { name: '查看文件 README.md' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { name: '内容', level: 1 })).toBeInTheDocument())
    expect(screen.getByText('摘要')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '项目' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '正常' })).toBeInTheDocument()
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname === '/office/file')).toBe(true)
    expect(screen.getByRole('heading', { name: '文件中心' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭文件查看器' }))
    expect(screen.queryByRole('dialog', { name: '查看文件 README.md' })).not.toBeInTheDocument()
  })

  it('文件中心按每次对话显示独立文件夹并懒加载产物', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'session-a', title: '会话甲', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
        { id: 'session-b', title: '会话乙', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
      ]) })
      if (url.pathname === '/office/files') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ path: 'shared.md', type: 'file' }]) })
      if (url.pathname === '/office/conversations/session-a/artifacts') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'a', sessionId: 'session-a', path: 'deliverables/a.js', name: 'a.js', kind: 'text', mimeType: 'text/javascript; charset=utf-8', size: 10, updatedAt: 2 },
      ]) })
      if (url.pathname === '/office/conversations/session-b/artifacts') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'b', sessionId: 'session-b', path: 'deliverables/b.md', name: 'b.md', kind: 'markdown', mimeType: 'text/markdown; charset=utf-8', size: 10, updatedAt: 1 },
      ]) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="文件中心" />)

    fireEvent.click(await screen.findByRole('button', { name: '对话文件夹 会话甲' }))
    expect(await screen.findByRole('button', { name: 'deliverables/a.js' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'deliverables/b.md' })).not.toBeInTheDocument()
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname === '/office/conversations/session-a/artifacts')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '对话文件夹 会话乙' }))
    expect(await screen.findByRole('button', { name: 'deliverables/b.md' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'deliverables/a.js' })).not.toBeInTheDocument()
  })

  it('文件中心将图表 JSON 渲染为可视化并格式化普通 JSON', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/files') return Promise.resolve({ ok: true, json: () => Promise.resolve([{ path: '能力.chart.json', type: 'file' }, { path: '配置.json', type: 'file' }]) })
      if (url.pathname === '/office/file') {
        const selected = url.searchParams.get('path')
        return Promise.resolve({ ok: true, json: () => Promise.resolve(selected === '能力.chart.json'
          ? { path: selected, content: JSON.stringify({ type: 'donut', title: '能力分布', categories: ['研究', '实现', '验证'], series: [{ name: '得分', data: [72, 91, 84] }] }) }
          : { path: selected, content: '{"name":"office","enabled":true}' }) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<><main className="office-main" /><OfficeRightPanel active="文件中心" /></>)
    fireEvent.click(await screen.findByRole('button', { name: '能力.chart.json' }))
    expect(await screen.findByLabelText('能力分布，环形图')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '关闭文件查看器' }))
    fireEvent.click(screen.getByRole('button', { name: '配置.json' }))
    await waitFor(() => expect(screen.getByText('结构化 JSON')).toBeInTheDocument())
    expect(screen.getByText(/"enabled": true/)).toBeInTheDocument()
  })

  it('OpenPaw 引擎连接失败时显示中文错误', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations') return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: '无法连接 OpenPaw 引擎' }) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    fireEvent.click(screen.getByRole('button', { name: '+ 新建对话' }))
    fireEvent.change(screen.getByLabelText('对话名称'), { target: { value: '测试连接' } })
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await waitFor(() => expect(screen.getByText('无法连接 OpenPaw 引擎')).toBeInTheDocument())
  })

  it('新建任务后提交真实字段并刷新任务列表', async () => {
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/tasks' && init?.method === 'POST') return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 'new-task', objective: '整理会议', status: 'queued', priority: 'normal', nextAction: '等待智能体接手' }) })
      if (url.pathname === '/office/tasks') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="任务中心" />)
    await waitFor(() => expect(screen.getByPlaceholderText('例如：整理本周会议纪要')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('例如：整理本周会议纪要'), { target: { value: '整理会议' } })
    fireEvent.change(screen.getByPlaceholderText('可选，例如：包含结论、负责人和截止时间'), { target: { value: '输出结论和负责人' } })
    fireEvent.click(screen.getByRole('button', { name: '新建任务' }))
    await waitFor(() => expect(screen.getByText('任务已创建')).toBeInTheDocument())
    // 即使刷新接口暂时仍返回旧快照，创建响应也必须立即生成任务卡。
    await waitFor(() => expect(screen.getByText('整理会议')).toBeInTheDocument())
    const createCall = request.mock.calls.find(([input, init]) => new URL(String(input)).pathname === '/office/tasks' && init?.method === 'POST')
    expect(createCall?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ objective: '整理会议', priority: 'normal', successCriteria: '输出结论和负责人', executionMode: 'auto_plan' }) })
  })

  it('任务中心展示公开阶段、失败原因和终态删除操作', async () => {
    let reads = 0
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/tasks/failed' && init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })
      if (url.pathname === '/office/tasks') {
        reads += 1
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reads === 1 ? [
          { id: 'running', objective: '执行中的目标', status: 'in_progress', phase: 'executing', priority: 'normal', nextAction: '智能体正在执行目标' },
          { id: 'failed', objective: '失败的目标', status: 'failed', phase: 'failed', priority: 'high', nextAction: '可重新执行', failureReason: '模型服务暂时不可用', failureStage: 'executing', errorCode: 'provider_timeout', retryable: true, recommendedAction: '检查服务状态后重新执行', attempt: 2, parentTaskId: 'failed-original' },
        ] : []) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="任务中心" />)

    await waitFor(() => expect(screen.getByText('失败的目标')).toBeInTheDocument())
    expect(screen.getAllByText('规划').length).toBeGreaterThan(0)
    expect(screen.getAllByText('执行').length).toBeGreaterThan(0)
    expect(screen.getAllByText('验证').length).toBeGreaterThan(0)
    expect(screen.getAllByText('交付').length).toBeGreaterThan(0)
    expect(screen.getByText('模型服务暂时不可用')).toBeInTheDocument()
    expect(screen.getByText(/失败阶段：执行/)).toBeInTheDocument()
    expect(screen.getByText('建议：检查服务状态后重新执行')).toBeInTheDocument()
    expect(screen.getByText('failed-original')).toBeInTheDocument()
    expect(screen.queryByText(/45%/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '删除任务' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '删除任务' }))
    await waitFor(() => expect(request.mock.calls.some(([input, init]) => new URL(String(input)).pathname === '/office/tasks/failed' && init?.method === 'DELETE')).toBe(true))
    expect(window.confirm).toHaveBeenCalledWith('确认删除任务“失败的目标”吗？关联执行对话和产物会保留。')
  })

  it('任务阶段缺失时不伪造规划进度，原任务存在重试记录时禁用删除', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/tasks') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'root-task', objective: '原始任务', status: 'failed', priority: 'normal', nextAction: '等待处理' },
        { id: 'retry-task', objective: '重试任务', status: 'completed', priority: 'normal', nextAction: '已完成', parentTaskId: 'root-task' },
      ]) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    }))
    const { container } = render(<OfficeRightPanel active="任务中心" />)

    await waitFor(() => expect(screen.getByText('原始任务')).toBeInTheDocument())
    const rootCard = screen.getByText('原始任务').closest('article')
    expect(rootCard?.querySelector('.task-stage-track li.current')).toBeNull()
    const rootDelete = rootCard?.querySelector<HTMLButtonElement>('button.danger')
    expect(rootDelete).toBeDisabled()
    expect(rootDelete).toHaveAttribute('title', '请先删除该任务的重试记录')
    const retryCard = screen.getByText('重试任务').closest('article')
    expect(retryCard?.querySelector<HTMLButtonElement>('button.danger')).toBeEnabled()
    expect(container.querySelectorAll('.task-stage-track li.current')).toHaveLength(0)
  })

  it('支持选择会话续聊和删除', async () => {
    let started = false
    let completed = false
    let busyEmitted = false
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages' && init?.method === 'POST') { started = true; completed = true; return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ accepted: true, sessionId: 's1' }) }) }
      if (url.pathname === '/office/conversations/s1/status') {
        const active = started && !busyEmitted
        if (active) busyEmitted = true
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(active ? { s1: { type: 'busy' } } : {}) })
      }
      if (url.pathname === '/office/conversations/s1/messages') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(completed ? [
        { info: { id: 'u-continue', role: 'user' }, parts: [{ type: 'text', text: '继续分析' }] },
        { info: { id: 'a-continue', role: 'assistant' }, parts: [{ type: 'text', text: '分析完成' }] },
      ] : []) })
      if (url.pathname === '/office/conversations/s1' && init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '继续分析' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('分析完成')).toBeInTheDocument(), { timeout: 3000 })
    await waitFor(() => expect(screen.getByRole('button', { name: '删除 查找 TODO' })).toBeEnabled(), { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: '删除 查找 TODO' }))
    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('确认删除对话“查找 TODO”吗？此操作无法撤销。'))
    await waitFor(() => expect(screen.queryByText('查找 TODO')).not.toBeInTheDocument())
    expect(request.mock.calls.some(([input, init]) => new URL(String(input)).pathname.endsWith('/messages') && init?.method === 'POST')).toBe(true)
  })

  it('删除有关联任务的对话时提醒任务记录会保留', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: 'linked-session', title: '关联会话', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }]) })
      if (url.pathname === '/office/tasks') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: 'linked-task', objective: '关联任务', status: 'completed', sessionId: 'linked-session' }]) })
      if (url.pathname === '/office/conversations/linked-session' && init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    }))

    render(<OfficeRightPanel active="对话中心" />)
    fireEvent.click(await screen.findByRole('button', { name: '删除 关联会话' }))

    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('确认删除对话“关联会话”吗？此操作无法撤销。\n\n该对话关联 1 个任务。删除对话不会删除任务记录，但任务中的“查看执行对话”将不再可用。'))
    await waitFor(() => expect(screen.queryByText('关联会话')).not.toBeInTheDocument())
  })

  it('删除对话失败时显示网关返回的真实引擎错误', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: 'offline-session', title: '离线会话', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 }]) })
      if (url.pathname === '/office/conversations/offline-session' && init?.method === 'DELETE') return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: '无法连接 OpenPaw 引擎' }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    }))

    render(<OfficeRightPanel active="对话中心" />)
    fireEvent.click(await screen.findByRole('button', { name: '删除 离线会话' }))

    expect(await screen.findByText('无法连接 OpenPaw 引擎')).toBeInTheDocument()
  })

  it('删除当前会话后自动发布下一条会话选择', async () => {
    const selected = vi.fn()
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'a', title: '会话 A', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
        { id: 'b', title: '会话 B', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
      ]) })
      if (url.pathname === '/office/conversations/a' && init?.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) })
      if (/^\/office\/conversations\/(a|b)\/(messages|status)$/.test(url.pathname)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.pathname.endsWith('/status') ? {} : []) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    }))
    render(<OfficeRightPanel active="对话中心" onConversationSelected={selected} />)

    const sessionSelect = await screen.findByRole('combobox', { name: '最近对话' })
    await waitFor(() => expect(sessionSelect).toHaveValue('a'))
    fireEvent.click(screen.getByRole('button', { name: '删除 会话 A' }))
    await waitFor(() => expect(sessionSelect).toHaveValue('b'))
    expect(selected).toHaveBeenLastCalledWith('b')
  })

  it('进入对话中心自动选中首条会话并加载正文', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads['/office/sessions']) })
      if (url.pathname === '/office/conversations/s1/messages') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { info: { id: 'm-user', role: 'user' }, parts: [{ type: 'text', text: '首条内容' }] },
        { info: { id: 'm-assistant', role: 'assistant' }, parts: [{ type: 'text', text: '智能体已收到' }] },
      ]) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByText('首条内容')).toBeInTheDocument())
    expect(screen.getByText('智能体已收到')).toBeInTheDocument()
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname === '/office/conversations/s1/messages')).toBe(true)
  })

  it('system 失败与取消正文使用独立消息样式且不显示助手头像', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { info: { id: 'system-error', role: 'system', kind: 'error', turnID: 'turn-1' }, parts: [{ type: 'text', text: '模型服务暂时不可用' }] },
        { info: { id: 'system-cancelled', role: 'system', kind: 'cancelled', turnID: 'turn-2' }, parts: [{ type: 'text', text: '本轮已由用户取消' }] },
      ]) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    const errorArticle = (await screen.findByText('模型服务暂时不可用')).closest('article')
    const cancelledArticle = screen.getByText('本轮已由用户取消').closest('article')
    expect(errorArticle).toHaveClass('transcript-message', 'system', 'error')
    expect(cancelledArticle).toHaveClass('transcript-message', 'system', 'cancelled')
    expect(errorArticle?.querySelector('.message-author')).toBeNull()
    expect(cancelledArticle?.querySelector('.message-author')).toBeNull()
  })

  it('暂停与继续场景使用单一受控开关且不请求 Gateway 状态', async () => {
    const onStatus = vi.fn()
    const onScenePausedChange = vi.fn()
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    render(<OfficeBottomToolbar onStatus={onStatus} onScenePausedChange={onScenePausedChange} />)
    const pause = screen.getByRole('button', { name: /暂停场景/ })
    expect(pause).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pause)
    expect(onStatus).toHaveBeenCalledWith('已暂停办公室场景显示')
    expect(onScenePausedChange).toHaveBeenCalledWith(true)
    expect(request).not.toHaveBeenCalled()

    const view = render(<OfficeBottomToolbar scenePaused onStatus={onStatus} onScenePausedChange={onScenePausedChange} />)
    const resume = screen.getByRole('button', { name: /继续场景/ })
    expect(resume).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(resume)
    expect(onScenePausedChange).toHaveBeenCalledWith(false)
    expect(onStatus).toHaveBeenCalledWith('')
    view.unmount()
  })

  it('日程显示不支持且不会阻断通知已读操作', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/notifications') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: 'n1', title: '提醒', body: '请查看', level: 'info', createdAt: 1, read: false }]) })
      if (url.pathname.endsWith('/read')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'n1', title: '提醒', body: '请查看', level: 'info', createdAt: 1, read: true }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="日程日历" />)
    expect(screen.getByText('不支持')).toBeInTheDocument()
    expect(request.mock.calls.some(([input]) => new URL(String(input)).pathname === '/office/calendar/events')).toBe(false)
    render(<OfficeRightPanel active="通知中心" />)
    await waitFor(() => expect(screen.getByText('提醒')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '标为已读' }))
    await waitFor(() => expect(screen.getByText('已读')).toBeInTheDocument())
  })

  it('回合执行中展示工具和人物联动，并可停止生成', async () => {
    let started = false
    let aborted = false
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages' && init?.method === 'POST') { started = true; return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ accepted: true, sessionId: 's1' }) }) }
      // 初始加载必须是 idle；发送消息后才进入 busy，符合 Host 状态协议。
      if (url.pathname === '/office/conversations/s1/status') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(started && !aborted ? { s1: { type: 'busy', activity: { kind: 'tool', tool: 'web_search', task: '正在搜索网页' } } } : {}) })
      if (url.pathname === '/office/conversations/s1/abort' && init?.method === 'POST') { aborted = true; return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) }) }
      if (url.pathname === '/office/conversations/s1/messages') return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(aborted ? [
          { info: { id: 's1-user', role: 'user' }, parts: [{ type: 'text', text: '请搜索长沙天气' }] },
          { info: { id: 's1-cancelled', role: 'system', kind: 'cancelled' }, parts: [{ type: 'text', text: '本轮已停止。' }] },
        ] : []),
      })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '请搜索长沙天气' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getAllByText(/正在搜索网页/)).toHaveLength(2))
    expect(screen.getByText('办公室：李研 · 执行中')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    expect(window.confirm).toHaveBeenCalledWith('确认停止当前生成吗？已生成的内容会保留。')
    expect(screen.getByLabelText('输入下一条消息')).toBeDisabled()
    await waitFor(() => expect(screen.getByText('本轮已停止。')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeEnabled())
    expect(request.mock.calls.some(([input, init]) => new URL(String(input)).pathname === '/office/conversations/s1/abort' && init?.method === 'POST')).toBe(true)
  })

  it('活动回合收到部分助手正文后显示实时生成状态并移除重复占位消息', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/status') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ s1: { type: 'busy' } }) })
      if (url.pathname === '/office/conversations/s1/messages') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    }))
    render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    act(() => {
      updateConversationView('s1', {
        messages: [
          { info: { id: 'stream-user', role: 'user' }, parts: [{ type: 'text', text: '生成详细方案' }] },
          { info: { id: 'stream-assistant', role: 'assistant' }, parts: [{ type: 'text', text: '正在生成第一部分内容' }] },
        ],
        messagesState: 'ready',
        pending: true,
        phase: 'loading',
        turnStatus: 'busy',
      })
    })
    expect(screen.getByText('正在生成第一部分内容')).toBeInTheDocument()
    expect(screen.getByText('实时生成中')).toBeInTheDocument()
    expect(document.querySelector('.transcript-message.pending')).not.toBeInTheDocument()
  })

  it('长回合只显示单一稳定的处理中状态', async () => {
    let started = false
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages' && init?.method === 'POST') { started = true; return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ accepted: true, sessionId: 's1' }) }) }
      if (url.pathname === '/office/conversations/s1/status') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(started ? { s1: { type: 'busy' } } : {}) })
      if (url.pathname === '/office/conversations/s1/messages') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    try {
      render(<OfficeRightPanel active="对话中心" />)
      await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
      fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '长任务' } })
      fireEvent.click(screen.getByRole('button', { name: '发送' }))
      await waitFor(() => expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument())
      now.mockReturnValue(122_000)
      await waitFor(() => expect(screen.getAllByText('正在核对本轮状态…')).toHaveLength(1), { timeout: 4000 })
      expect(screen.queryByText(/本轮仍在处理中/)).not.toBeInTheDocument()
      expect(document.querySelector('.conversation-turn-status')).toBeEmptyDOMElement()
    } finally {
      now.mockRestore()
    }
  }, 10_000)

  it('技能正文必须经信任确认后才能应用到新对话', async () => {
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/skill') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ path: 'skills/research/SKILL.md', content: '# 研究技能\n请先确认来源。' }) })
      if (url.pathname === '/office/conversations' && init?.method === 'POST') return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ session: { id: 'skill-1', title: '技能：research', provider: 'echo', model: 'echo-1' } }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="技能中心" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /research/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /research/ }))
    await waitFor(() => expect(screen.getByText(/# 研究技能/)).toBeInTheDocument())
    const apply = screen.getByRole('button', { name: '应用到新对话' })
    expect(apply).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /我已阅读并信任/ }))
    expect(apply).toBeEnabled()
    fireEvent.click(apply)
    await waitFor(() => expect(screen.getByText('已创建技能执行对话')).toBeInTheDocument())
    expect(request.mock.calls.some(([input, init]) => new URL(String(input)).pathname === '/office/conversations' && init?.method === 'POST')).toBe(true)
  })

  it('切换到文件中心再切回时保留正在处理的对话状态', async () => {
    let started = false
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages' && init?.method === 'POST') { started = true; return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ accepted: true, sessionId: 's1' }) }) }
      if (url.pathname === '/office/conversations/s1/status') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(started ? { s1: { type: 'busy', activity: { kind: 'tool', tool: 'web_search', task: '正在搜索网页' } } } : {}) })
      if (url.pathname === '/office/conversations/s1/messages') return new Promise(() => undefined)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    })
    vi.stubGlobal('fetch', request)
    const view = render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '请继续检索长沙天气' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('请继续检索长沙天气')).toBeInTheDocument())
    view.rerender(<OfficeRightPanel active="文件中心" />)
    view.rerender(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByText('请继续检索长沙天气')).toBeInTheDocument())
    expect(screen.getAllByText(/正在搜索网页/)).toHaveLength(2)
    expect(screen.getByText('办公室：李研 · 执行中')).toBeInTheDocument()
  })

  it('新建会话后立即切页仍保留 pending 消息和当前会话', async () => {
    let started = false
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      if (url.pathname === '/office/conversations' && init?.method === 'POST') return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ promptAccepted: false, session: { id: 'new-session', title: '新建验证', provider: 'echo', model: 'echo-1', createdAt: Date.now(), updatedAt: Date.now() } }) })
      if (url.pathname === '/office/conversations/new-session/messages' && init?.method === 'POST') { started = true; return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ accepted: true, sessionId: 'new-session' }) }) }
      if (url.pathname === '/office/conversations/new-session/status') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(started ? { 'new-session': { type: 'busy', activity: { kind: 'tool', tool: 'read_file', task: '正在读取文件' } } } : {}) })
      if (url.pathname === '/office/conversations/new-session/messages') return new Promise(() => undefined)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    const view = render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByRole('button', { name: '+ 新建对话' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '+ 新建对话' }))
    fireEvent.change(screen.getByLabelText('对话名称'), { target: { value: '新建验证' } })
    fireEvent.click(screen.getByRole('button', { name: '创建对话' }))
    await waitFor(() => expect(screen.getAllByText('新建验证').length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '请读取项目说明' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByText('请读取项目说明')).toBeInTheDocument())
    view.rerender(<OfficeRightPanel active="文件中心" />)
    view.rerender(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByText('请读取项目说明')).toBeInTheDocument())
    expect(screen.getAllByText(/正在读取文件/)).toHaveLength(2)
    expect(screen.getByText('办公室：周理 · 执行中')).toBeInTheDocument()
  })

  it('任务操作失败时只在对应任务卡显示错误', async () => {
    const request = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/tasks') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'task-a', objective: '任务甲', status: 'in_progress', priority: 'normal', nextAction: '执行中' },
        { id: 'task-b', objective: '任务乙', status: 'in_progress', priority: 'normal', nextAction: '执行中' },
      ]) })
      if (url.pathname.endsWith('/cancel')) return Promise.reject(new Error('任务甲停止失败'))
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="任务中心" />)
    await waitFor(() => expect(screen.getByText('任务甲')).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: '停止任务' })[0])
    await waitFor(() => expect(screen.getByText('任务甲停止失败')).toBeInTheDocument())
    const cards = screen.getAllByRole('article')
    expect(cards[0]).toHaveTextContent('任务甲停止失败')
    expect(cards[1]).not.toHaveTextContent('任务甲停止失败')
  })

  it('允许导入本地技能并创建技能执行对话', async () => {
    const request = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/skills') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      if (url.pathname === '/office/conversations' && init?.method === 'POST') return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ promptAccepted: true, session: { id: 'skill-session', title: '技能：本地技能', provider: 'echo', model: 'echo-1', createdAt: 1, updatedAt: 1 } }) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    })
    vi.stubGlobal('fetch', request)
    render(<OfficeRightPanel active="技能中心" />)
    const file = new File(['---\nname: local\n---\n# 本地规则'], 'local.md', { type: 'text/markdown' })
    fireEvent.change(screen.getByLabelText('导入技能文件'), { target: { files: [file] } })
    await waitFor(() => expect(screen.getAllByText('local').length).toBeGreaterThan(0))
    const apply = screen.getByRole('button', { name: '应用到新对话' })
    expect(apply).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(apply).toBeEnabled())
    fireEvent.click(apply)
    await waitFor(() => expect(screen.getByText('已创建技能执行对话')).toBeInTheDocument())
    const call = request.mock.calls.find(([input, init]) => new URL(String(input)).pathname === '/office/conversations' && init?.method === 'POST')
    expect(call?.[1]).toMatchObject({ method: 'POST' })
    expect(String(call?.[1]?.body)).toContain('本地规则')
  })

  it('从 sessionStorage 恢复选中会话并在切换后更新', async () => {
    window.sessionStorage.setItem('ai-office.ui.selected-session.v1', 'b')
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/sessions') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([
        { id: 'a', title: '恢复对话 A', provider: 'echo', model: 'mock', createdAt: 2, updatedAt: 2 },
        { id: 'b', title: '恢复对话 B', provider: 'echo', model: 'mock', createdAt: 1, updatedAt: 1 },
      ]) })
      if (/^\/office\/conversations\/(a|b)\/(messages|status)$/.test(url.pathname)) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(url.pathname.endsWith('/status') ? {} : []) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    }))
    render(<OfficeRightPanel active="对话中心" />)
    const sessionSelect = await screen.findByRole('combobox', { name: '最近对话' })
    await waitFor(() => expect(sessionSelect).toHaveValue('b'))
    fireEvent.change(sessionSelect, { target: { value: 'a' } })
    expect(window.sessionStorage.getItem('ai-office.ui.selected-session.v1')).toBe('a')
  })

  it('对话加载和执行状态暴露 aria-busy 与单一 live region', async () => {
    let started = false
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/office/conversations/s1/messages' && init?.method === 'POST') { started = true; return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ accepted: true, sessionId: 's1' }) }) }
      if (url.pathname === '/office/conversations/s1/status') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(started ? { s1: { type: 'busy' } } : {}) })
      if (url.pathname === '/office/conversations/s1/messages') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payloads[url.pathname as keyof typeof payloads] ?? []) })
    }))
    const { container } = render(<OfficeRightPanel active="对话中心" />)
    await waitFor(() => expect(screen.getByLabelText('输入下一条消息')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('输入下一条消息'), { target: { value: '检查状态' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(container.querySelector('.conversation-center')).toHaveAttribute('aria-busy', 'true'))
    const liveRegions = container.querySelectorAll('[role="status"][aria-live="polite"]')
    expect(liveRegions).toHaveLength(1)
    expect(liveRegions[0]).toHaveTextContent('智能体正在处理')
  })
})
