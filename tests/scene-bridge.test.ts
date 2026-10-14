import { describe, expect, it, vi, afterEach } from 'vitest'
import { OfficeScene } from '@/scene/OfficeScene'
import { INITIAL_AGENTS } from '@/scene/layout/officeLayout'
import { OfficeSimulator } from '@/scene/simulation/OfficeSimulator'
import {
  processDeskVisitMissions,
  startDeskVisit,
  talkDurationForMessage,
} from '@/scene/simulation/deskVisit'
import {
  bindOfficeScene,
  requestDeskVisit,
  resetOfficeSceneBridges,
  setAgentState,
  setOfficeScenePaused,
} from '@/scene/officeSceneBridge'
import {
  isVisitParticipantPending,
  isVisitVisitorPending,
  notifyVisitMissionActivity,
  resetOfficeActionDispatcher,
  submitVisitAction,
} from '@/services/officeActionDispatcher'
import { dispatchOfficeAction } from '@/services/officeActionHttp'
import { officeSceneScopeId } from '@/config/officeWorkspaces'
import { setOfficeAgents } from '@/store/officeStore'

describe('场景桥初始化队列', () => {
  afterEach(() => {
    setOfficeScenePaused(false)
    resetOfficeSceneBridges()
    resetOfficeActionDispatcher()
    vi.useRealTimers()
  })

  it('场景未挂载时丢弃过期拜访并只应用每个角色的最新状态', () => {
    const events: string[] = []
    const fakeScene = {
      setVisualPaused: (paused: boolean) => events.push(`paused:${paused}`),
      getAgents: () => [],
      requestDeskVisit: (visitor: number, host: number, message: string) => {
        events.push(`visit:${visitor}:${host}:${message}`)
      },
      requestDeskVisitTour: () => undefined,
      setAgentState: (id: string, state: string) => events.push(`state:${id}:${state}`),
    } as unknown as OfficeScene

    requestDeskVisit(1, 2, '第一项')
    setAgentState('file-agent', 'working', '索引中')
    setAgentState('file-agent', 'idle')
    requestDeskVisit(1, 3, '第二项')
    bindOfficeScene(fakeScene)
    expect(events).toEqual(['paused:false', 'state:file-agent:idle'])
  })

  it('视觉暂停期间继续收敛业务状态但不在恢复后补播拜访', () => {
    const events: string[] = []
    const agents = [{ id: 'worker', state: 'working', currentTask: '分析中', mission: { kind: 'desk_visit' } }]
    const fakeScene = {
      setVisualPaused: (paused: boolean) => events.push(`paused:${paused}`),
      getAgents: () => agents,
      requestDeskVisit: (visitor: number, host: number) => events.push(`visit:${visitor}:${host}`),
      requestDeskVisitTour: () => undefined,
      setAgentState: (id: string, state: string) => events.push(`state:${id}:${state}`),
    } as unknown as OfficeScene

    bindOfficeScene(fakeScene)
    setOfficeScenePaused(true)
    setAgentState('worker', 'thinking', '继续分析')
    requestDeskVisit(1, 2, '交接')

    expect(agents[0]).toMatchObject({ state: 'working', currentTask: '分析中', mission: { kind: 'desk_visit' } })
    expect(events).toEqual(['paused:false', 'paused:true', 'state:worker:thinking'])

    agents[0].mission = undefined as never
    setOfficeScenePaused(false)
    expect(events).toEqual(['paused:false', 'paused:true', 'state:worker:thinking', 'paused:false'])
  })

  it('没有真实动作时六名角色全部空闲且没有拜访 mission', () => {
    expect(INITIAL_AGENTS).toHaveLength(6)
    expect(INITIAL_AGENTS.every((agent) => agent.state === 'idle' && !agent.currentTask && !agent.mission)).toBe(true)
    expect(new OfficeScene().getAgents().every((agent) => agent.state === 'idle' && !agent.mission)).toBe(true)

    const firstTick = new OfficeSimulator().tick(0, INITIAL_AGENTS)
    expect(firstTick).toEqual(INITIAL_AGENTS)
  })

  it('纯场景拜访结束后恢复双方原有空闲状态', () => {
    let agents = startDeskVisit(
      INITIAL_AGENTS.map((agent) => ({ ...agent })),
      1,
      3,
      '同步一下',
      1,
    )
    agents = agents.map((agent, index) => index === 0 && agent.mission
      ? { ...agent, state: 'talking' as const, mission: { ...agent.mission, phase: 'talk' as const, talkRemaining: 1 } }
      : agent)
    agents = processDeskVisitMissions(0.1, agents, new Map())
    expect(agents[2]).toMatchObject({ state: 'talking', interactionResumeState: 'idle' })

    agents = agents.map((agent, index) => index === 0 && agent.mission
      ? { ...agent, state: 'idle' as const, mission: { ...agent.mission, phase: 'return' as const }, targetX: undefined, targetY: undefined }
      : agent)
    agents = processDeskVisitMissions(0, agents, new Map())
    expect(agents[0]?.state).toBe('idle')
    expect(agents[0]?.mission).toBeUndefined()
    expect(agents[2]).toMatchObject({ state: 'idle', currentTask: undefined })
  })

  it('真实任务摘要贯穿行走和交谈阶段且长文本有足够展示时间', () => {
    const message = '写入 animation-handoff-check.md，已完成'
    let agents = startDeskVisit(
      INITIAL_AGENTS.map((agent) => ({ ...agent })),
      4,
      1,
      message,
    )
    expect(agents[3]).toMatchObject({
      state: 'walking',
      currentTask: message,
      mission: {
        message,
        talkDuration: talkDurationForMessage(message),
      },
    })
    agents = agents.map((agent, index) => index === 3 && agent.mission
      ? { ...agent, state: 'idle' as const, targetX: undefined, targetY: undefined }
      : agent)
    agents = processDeskVisitMissions(0, agents, new Map())
    expect(agents[3]).toMatchObject({ state: 'talking', currentTask: message })
    expect(agents[0]).toMatchObject({ state: 'talking', currentTask: `接收：${message}` })
    expect(talkDurationForMessage('x'.repeat(200))).toBe(6)
  })

  it('交接台词保持简洁但接收者显示自己的具体任务', () => {
    let agents = startDeskVisit(
      INITIAL_AGENTS.map((agent) => ({ ...agent })),
      1,
      2,
      '请搜索内容',
      1,
    )
    agents = agents.map((agent, index) => {
      if (index === 0 && agent.mission) {
        return {
          ...agent,
          state: 'talking' as const,
          mission: { ...agent.mission, phase: 'talk' as const, talkRemaining: 1 },
        }
      }
      if (index === 1) {
        return {
          ...agent,
          interactionResumeState: 'working' as const,
          interactionResumeTask: '搜索“长沙十日深度游”',
        }
      }
      return agent
    })
    agents = processDeskVisitMissions(0.1, agents, new Map())
    expect(agents[0]).toMatchObject({ state: 'talking', currentTask: '请搜索内容' })
    expect(agents[1]).toMatchObject({
      state: 'talking',
      currentTask: '搜索“长沙十日深度游”',
      interactionResumeTask: '搜索“长沙十日深度游”',
    })
  })

  it('最终接收者结束交谈后恢复空闲且不会保持绿色状态', () => {
    const simulator = new OfficeSimulator()
    let agents = INITIAL_AGENTS.map((agent, index) => index === 0
      ? {
          ...agent,
          state: 'talking' as const,
          currentTask: '接收：任务已完成，请查收',
          interactionResumeState: 'idle' as const,
          interactionResumeTask: undefined,
        }
      : { ...agent })

    agents = simulator.tick(0, agents)
    expect(agents[0]?.state).toBe('talking')
    agents = simulator.afterMovement(0, agents, new Map())
    expect(agents[0]).toMatchObject({ state: 'idle', currentTask: undefined })
    expect(agents[0]?.interactionResumeState).toBeUndefined()
    expect(agents[0]?.interactionResumeTask).toBeUndefined()
  })

  it('视觉暂停只冻结帧推进并保留角色业务状态', () => {
    const scene = new OfficeScene()
    scene.setAgentState('marvis', 'working', '长任务')
    const before = scene.getAgents().find((agent) => agent.id === 'marvis')
    scene.setVisualPaused(true)
    const paused = scene.getAgents().find((agent) => agent.id === 'marvis')
    expect(scene.isVisualPaused()).toBe(true)
    expect(paused).toMatchObject({ state: 'working', currentTask: '长任务' })
    expect(paused?.mission).toEqual(before?.mission)
  })

  it('回合结束状态不会提前清除王明与工具角色的交接动作', () => {
    const scene = new OfficeScene()
    scene.requestDeskVisit(1, 3, 'read_file')
    scene.setAgentState('marvis', 'idle')
    scene.setAgentState('file-agent', 'working', '读取文件')

    expect(scene.getAgents().find((agent) => agent.id === 'marvis')?.mission).toMatchObject({
      kind: 'desk_visit',
      hostAgentId: 'file-agent',
    })
    expect(scene.getAgents().find((agent) => agent.id === 'file-agent')).toMatchObject({ state: 'idle' })

    const internal = scene as unknown as {
      agents: typeof INITIAL_AGENTS
      applyDeferredAgentStates: () => boolean
    }
    internal.agents = internal.agents.map((agent) => agent.id === 'marvis'
      ? { ...agent, mission: undefined }
      : agent)
    expect(internal.applyDeferredAgentStates()).toBe(true)
    expect(scene.getAgents().find((agent) => agent.id === 'marvis')).toMatchObject({ state: 'idle' })
    expect(scene.getAgents().find((agent) => agent.id === 'file-agent')).toMatchObject({
      state: 'working',
      currentTask: '读取文件',
    })
  })

  it('后续工具角色在王明到达前保持空闲并追加到同一条拜访路线', () => {
    const scene = new OfficeScene()
    scene.requestDeskVisit(1, 2, 'web_search')
    scene.requestDeskVisit(1, 3, 'read_file')
    scene.requestDeskVisit(1, 4, 'write_file')
    scene.setAgentState('file-agent', 'working', '读取文件')
    scene.setAgentState('file-agent', 'idle')
    scene.setAgentState('app-agent', 'working', '写入文件')

    const mission = scene.getAgents().find((agent) => agent.id === 'marvis')?.mission
    expect(mission).toMatchObject({
      hostAgentId: 'code-agent',
      queue: [
        { hostAgentId: 'file-agent' },
        { hostAgentId: 'app-agent' },
      ],
    })
    expect(scene.getAgents().find((agent) => agent.id === 'file-agent')).toMatchObject({
      state: 'idle',
      currentTask: undefined,
    })
    expect(scene.getAgents().find((agent) => agent.id === 'app-agent')).toMatchObject({
      state: 'idle',
      currentTask: undefined,
    })
  })

  it('并发回合访问同一角色时保留两条独立拜访 mission', () => {
    const visits: number[] = []
    let agents = INITIAL_AGENTS.map((agent) => ({ ...agent }))
    const fakeScene = {
      setVisualPaused: () => undefined,
      getAgents: () => agents,
      requestDeskVisit: (_visitor: number, host: number) => {
        visits.push(host)
        agents = agents.map((agent, index) => index === 0 ? {
          ...agent,
          mission: {
            kind: 'desk_visit' as const,
            phase: 'goto' as const,
            hostAgentId: agents[host - 1]!.id,
            hostDeskId: agents[host - 1]!.assignedDeskId!,
            message: 'read_file',
            resumeState: 'idle' as const,
            resumeTask: '处理中',
            talkDuration: 1,
            queue: [],
          },
        } : agent)
        setOfficeAgents(agents)
      },
      requestDeskVisitTour: () => undefined,
      setAgentState: () => undefined,
    } as unknown as OfficeScene
    bindOfficeScene(fakeScene)

    submitVisitAction({ type: 'desk_visit', visitor: 1, host: 3, message: 'read_file' })
    notifyVisitMissionActivity(agents)
    submitVisitAction({ type: 'desk_visit', visitor: 1, host: 3, message: 'read_file' })
    expect(visits).toEqual([3])

    agents = agents.map((agent, index) => index === 0 ? { ...agent, mission: undefined } : agent)
    setOfficeAgents(agents)
    notifyVisitMissionActivity(agents)
    expect(visits).toEqual([3, 3])

    notifyVisitMissionActivity(agents)
    agents = agents.map((agent, index) => index === 0 ? { ...agent, mission: undefined } : agent)
    setOfficeAgents(agents)
    notifyVisitMissionActivity(agents)
  })

  it('更早排队的重复目标不会被后到的新目标越过', () => {
    const visits: number[] = []
    let agents = INITIAL_AGENTS.map((agent) => ({ ...agent }))
    const fakeScene = {
      setVisualPaused: () => undefined,
      getAgents: () => agents,
      requestDeskVisit: (_visitor: number, host: number) => {
        visits.push(host)
        agents = agents.map((agent, index) => index === 0 ? {
          ...agent,
          mission: {
            kind: 'desk_visit' as const,
            phase: 'goto' as const,
            hostAgentId: agents[host - 1]!.id,
            hostDeskId: agents[host - 1]!.assignedDeskId!,
            message: 'tool',
            resumeState: 'idle' as const,
            talkDuration: 1,
            queue: [],
          },
        } : agent)
        setOfficeAgents(agents)
      },
      requestDeskVisitTour: () => undefined,
      setAgentState: () => undefined,
    } as unknown as OfficeScene
    bindOfficeScene(fakeScene)

    submitVisitAction({ type: 'desk_visit', visitor: 1, host: 3, message: 'first' })
    notifyVisitMissionActivity(agents)
    submitVisitAction({ type: 'desk_visit', visitor: 1, host: 3, message: 'second' })
    submitVisitAction({ type: 'desk_visit', visitor: 1, host: 4, message: 'third' })

    const projection = new OfficeScene({ bridgeWorkspaceId: 'main' })
    projection.setAgentState('app-agent', 'working', 'third')
    const projectionInternal = projection as unknown as { applyDeferredAgentStates: () => boolean }
    expect(projectionInternal.applyDeferredAgentStates()).toBe(false)
    expect(projection.getAgents().find((agent) => agent.id === 'app-agent')).toMatchObject({
      state: 'idle',
      currentTask: undefined,
    })

    for (let index = 0; index < 3; index += 1) {
      agents = agents.map((agent, position) => position === 0 ? { ...agent, mission: undefined } : agent)
      setOfficeAgents(agents)
      notifyVisitMissionActivity(agents)
      notifyVisitMissionActivity(agents)
    }
    expect(visits).toEqual([3, 3, 4])
  })

  it('排队交接同时保护访客和目标角色的延迟状态', () => {
    let agents = INITIAL_AGENTS.map((agent) => ({ ...agent }))
    const fakeScene = {
      setVisualPaused: () => undefined,
      getAgents: () => agents,
      requestDeskVisit: (visitor: number, host: number) => {
        agents = agents.map((agent, index) => index === visitor - 1 ? {
          ...agent,
          mission: {
            kind: 'desk_visit' as const,
            phase: 'goto' as const,
            hostAgentId: agents[host - 1]!.id,
            hostDeskId: agents[host - 1]!.assignedDeskId!,
            message: 'handoff',
            resumeState: agent.state,
            resumeTask: agent.currentTask,
            talkDuration: 2,
            queue: [],
          },
        } : agent)
        setOfficeAgents(agents)
      },
      requestDeskVisitTour: () => undefined,
      setAgentState: () => undefined,
    } as unknown as OfficeScene
    bindOfficeScene(fakeScene)

    submitVisitAction({ type: 'desk_visit', visitor: 1, host: 2, message: 'first' })
    notifyVisitMissionActivity(agents)
    submitVisitAction({ type: 'desk_visit', visitor: 4, host: 3, message: 'queued' })

    expect(isVisitParticipantPending(4)).toBe(true)
    expect(isVisitParticipantPending(3)).toBe(true)
    expect(isVisitVisitorPending(4)).toBe(true)
    expect(isVisitVisitorPending(3)).toBe(false)

    const projection = new OfficeScene({ bridgeWorkspaceId: 'main' })
    projection.setAgentState('app-agent', 'working', '准备交接')
    projection.setAgentState('app-agent', 'idle')
    const projectionInternal = projection as unknown as {
      applyDeferredAgentStates: () => boolean
    }
    expect(projectionInternal.applyDeferredAgentStates()).toBe(true)
    expect(projection.getAgents().find((agent) => agent.id === 'app-agent')).toMatchObject({
      state: 'working',
      currentTask: '等待交接',
    })

    agents = agents.map((agent, index) => index === 0 ? { ...agent, mission: undefined } : agent)
    setOfficeAgents(agents)
    notifyVisitMissionActivity(agents)
    expect(agents[3]?.mission?.kind).toBe('desk_visit')

    agents = agents.map((agent, index) => index === 3 ? { ...agent, mission: undefined } : agent)
    setOfficeAgents(agents)
    notifyVisitMissionActivity(agents)
  })

  it('不同 Agent 空间的拜访队列和场景互不串扰', () => {
    const visits: string[] = []
    const sceneA = {
      setVisualPaused: () => undefined,
      getAgents: () => [],
      requestDeskVisit: (_visitor: number, host: number) => visits.push(`a:${host}`),
      requestDeskVisitTour: () => undefined,
      setAgentState: () => undefined,
    } as unknown as OfficeScene
    const sceneB = {
      setVisualPaused: () => undefined,
      getAgents: () => [],
      requestDeskVisit: (_visitor: number, host: number) => visits.push(`b:${host}`),
      requestDeskVisitTour: () => undefined,
      setAgentState: () => undefined,
    } as unknown as OfficeScene
    bindOfficeScene(sceneA, 'agent-a')
    bindOfficeScene(sceneB, 'agent-b')

    submitVisitAction({ type: 'desk_visit', workspaceId: 'agent-a', visitor: 1, host: 2, message: 'A' }, { workspaceId: 'agent-a' })
    submitVisitAction({ type: 'desk_visit', workspaceId: 'agent-b', visitor: 1, host: 3, message: 'B' }, { workspaceId: 'agent-b' })

    expect(visits).toEqual(['a:2', 'b:3'])
    expect(isVisitParticipantPending(2, 'agent-a')).toBe(true)
    expect(isVisitParticipantPending(2, 'agent-b')).toBe(false)
    expect(isVisitParticipantPending(3, 'agent-b')).toBe(true)
  })

  it('相同 workspaceId 在不同会话中使用独立场景作用域', () => {
    const states: string[] = []
    const sceneA = {
      setVisualPaused: () => undefined,
      getAgents: () => INITIAL_AGENTS,
      requestDeskVisit: () => undefined,
      requestDeskVisitTour: () => undefined,
      setAgentState: (id: string, state: string) => states.push(`a:${id}:${state}`),
    } as unknown as OfficeScene
    const sceneB = {
      setVisualPaused: () => undefined,
      getAgents: () => INITIAL_AGENTS,
      requestDeskVisit: () => undefined,
      requestDeskVisitTour: () => undefined,
      setAgentState: (id: string, state: string) => states.push(`b:${id}:${state}`),
    } as unknown as OfficeScene
    bindOfficeScene(sceneA, officeSceneScopeId('session-a', 'shared-child'))
    bindOfficeScene(sceneB, officeSceneScopeId('session-b', 'shared-child'))

    dispatchOfficeAction({ type: 'set_state', sessionId: 'session-a', workspaceId: 'shared-child', rosterNo: 1, state: 'thinking' })
    dispatchOfficeAction({ type: 'set_state', sessionId: 'session-b', workspaceId: 'shared-child', rosterNo: 2, state: 'working' })

    expect(states).toEqual(['a:marvis:thinking', 'b:code-agent:working'])
  })
})
