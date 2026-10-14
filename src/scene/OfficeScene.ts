import { Application, Container, Graphics, Sprite } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import type { Agent, AgentState } from '@/types/agent'
import {
  COLORS,
  DESKS,
  AGENT_ROSTER,
  INITIAL_AGENTS,
  pickHandoffVisitMessage,
  SCENE_HEIGHT,
  SCENE_WIDTH,
} from '@/scene/layout/officeLayout'
import { AgentEntity } from '@/scene/entities/AgentEntity'
import { DeskEntity } from '@/scene/entities/DeskEntity'
import { MovementSystem } from '@/scene/systems/MovementSystem'
import { AnimationSystem } from '@/scene/systems/AnimationSystem'
import { OfficeSimulator } from '@/scene/simulation/OfficeSimulator'
import { bindOfficeScene } from '@/scene/officeSceneBridge'
import {
  isVisitParticipantPending,
  isVisitVisitorPending,
  notifyVisitMissionActivity,
} from '@/services/officeActionDispatcher'
import { setOfficeAgents } from '@/store/officeStore'
import {
  getOfficeBackgroundTexture,
  loadOfficeAssets,
} from '@/scene/assets/loadOfficeAssets'
import { loadSpineAssets } from '@/scene/assets/loadSpineAssets'

export type OfficeAgentClick = {
  agent: Agent
  rosterNo: number
  clientX: number
  clientY: number
}

export class OfficeScene {
  private app: Application | null = null
  /** Monotonically invalidates an in-flight Pixi/asset initialization. */
  private initVersion = 0
  private disposedApps = new WeakSet<Application>()
  private world: Container | null = null
  private agentEntities = new Map<string, AgentEntity>()
  private deskEntities = new Map<string, DeskEntity>()
  private officeLayer: Container | null = null
  private visualPaused = false
  private deferredAgentStates = new Map<string, { state: AgentState; task?: string }>()

  private movement = new MovementSystem()
  private animation = new AnimationSystem()
  private simulator = new OfficeSimulator()

  private agents: Agent[] = INITIAL_AGENTS.map((a) => ({ ...a }))
  private readonly bridgeWorkspaceId: string | null
  private readonly publishToStore: boolean
  private readonly options: {
    onAgentClick?: (event: OfficeAgentClick) => void
  }

  constructor(options: { onAgentClick?: (event: OfficeAgentClick) => void; initialAgents?: Agent[]; bridgeWorkspaceId?: string; publishToStore?: boolean } = {}) {
    this.options = options
    this.agents = options.initialAgents?.map((agent) => ({ ...agent })) ?? INITIAL_AGENTS.map((agent) => ({ ...agent }))
    this.bridgeWorkspaceId = options.bridgeWorkspaceId ?? null
    this.publishToStore = options.publishToStore !== false
  }

  async init(container: HTMLElement, width: number, height: number) {
    const version = ++this.initVersion
    const app = new Application()
    try {
      await app.init({
        width,
        height,
        backgroundColor: COLORS.floor,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })

      // React can unmount the canvas while Pixi or assets are still loading.
      // Dispose the local app and leave no stale bridge/canvas behind.
      if (version !== this.initVersion) {
        this.disposeApp(app)
        return
      }

      this.app = app
      container.appendChild(app.canvas)

      this.world = new Container()
      app.stage.addChild(this.world)
      this.fitStage(width, height)

      await loadSpineAssets()
      if (version !== this.initVersion) {
        this.disposeApp(app)
        return
      }

      const officeOk = await loadOfficeAssets()
      if (version !== this.initVersion) {
        this.disposeApp(app)
        return
      }
      if (!officeOk) {
        console.error(
          '[办公室] desk.png / chair.png 加载失败，工位将使用矢量占位图。请检查 public/assets/office/ 并硬刷新。',
        )
      }

      this.drawMap(this.world)
      this.spawnOffice(this.world)
      this.pushDataToEntities()

      if (version !== this.initVersion) {
        this.disposeApp(app)
        return
      }
      app.ticker.add(this.onTick)
      if (this.bridgeWorkspaceId) bindOfficeScene(this, this.bridgeWorkspaceId)
    } catch (error) {
      // A failed initialization must not leave a partially mounted Pixi app.
      if (this.app === app) {
        this.destroy()
      } else {
        this.disposeApp(app)
      }
      throw error
    }
  }

  /** 名册序号从 1 开始：visitor 去找 host 说一句话后回座继续工作 */
  requestDeskVisit(
    visitorRosterNo: number,
    hostRosterNo: number,
    message: string,
  ) {
    this.agents = this.simulator.startDeskVisit(
      this.agents,
      visitorRosterNo,
      hostRosterNo,
      message,
    )
    this.pushDataToEntities()
  }

  /** 按顺序拜访多个工位，全部说完后回访客工位 */
  requestDeskVisitTour(
    visitorRosterNo: number,
    hostRosterNos: number[],
    messageFn?: (hostRosterNo: number, hostName: string) => string,
  ) {
    this.agents = this.simulator.startDeskVisitTour(
      this.agents,
      visitorRosterNo,
      hostRosterNos,
      messageFn ?? ((hostNo, hostName) => pickHandoffVisitMessage(hostName, hostNo)),
    )
    this.pushDataToEntities()
  }

  getAgents(): Agent[] {
    return this.agents.map((agent) => ({ ...agent }))
  }

  /** 设置纯视觉暂停；不改写角色状态、任务、路径或 mission。 */
  setVisualPaused(paused: boolean) {
    this.visualPaused = paused
  }

  /** 返回场景是否处于纯视觉暂停状态。 */
  isVisualPaused() {
    return this.visualPaused
  }

  setAgentState(id: string, state: AgentState, task?: string) {
    const rosterNo = AGENT_ROSTER.findIndex((entry) => entry.id === id) + 1
    const currentVisitHost = this.agents.some((agent) => {
      const mission = agent.mission
      return mission?.kind === 'desk_visit'
        && mission.phase !== 'return'
        && mission.hostAgentId === id
    })
    const visitParticipant = this.agents.some((agent) => {
      const mission = agent.mission
      if (mission?.kind !== 'desk_visit') return false
      const isVisitor = agent.id === id
      const isCurrentHost = mission.phase !== 'return' && mission.hostAgentId === id
      const isQueuedHost = mission.queue.some((stop) => stop.hostAgentId === id)
      return isVisitor || isCurrentHost || isQueuedHost
    })
    const queuedParticipant = Boolean(this.bridgeWorkspaceId) && rosterNo > 0 && isVisitParticipantPending(rosterNo, this.bridgeWorkspaceId!)
    if (visitParticipant || queuedParticipant) {
      // Host 往往会在工具很快结束后立即发送 idle。若此处直接应用，原实现会
      // 清空王明的 mission 和路径，导致还没走到对方工位，交接动画就消失。
      // 只保留最后状态，当前拜访结束后再落地。
      this.deferredAgentStates.set(id, { state, task })
      if (
        currentVisitHost
        && (state === 'working' || state === 'thinking')
        && task
      ) {
        this.agents = this.agents.map((agent) => agent.id === id
          ? {
              ...agent,
              interactionResumeState: state,
              interactionResumeTask: task,
            }
          : agent)
      }
      return
    }
    this.deferredAgentStates.delete(id)
    this.agents = this.agents.map((agent) => {
      if (agent.id !== id) return agent
      return this.withAgentState(agent, state, task)
    })
    this.publishAgents()
    this.pushDataToEntities()
  }

  playAgentAnimation(id: string, animation: string, task?: string) {
    this.agents = this.agents.map((agent) => {
      if (agent.id !== id) return agent
      return {
        ...agent,
        state: 'talking' as const,
        currentTask: task,
        targetX: undefined,
        targetY: undefined,
        walkPath: undefined,
        walkPathIndex: undefined,
        mission: undefined,
        bubbleText: undefined,
        customAnimation: animation,
        viewFacing: 'front' as const,
        facing: 1 as const,
      }
    })
    this.publishAgents()
    this.pushDataToEntities()
    this.agentEntities.get(id)?.playCustomAnimation(animation, task)
    this.pullDataFromEntities()
    this.publishAgents()
  }

  resize(containerWidth: number, containerHeight: number) {
    if (!this.app || !this.world) return
    this.app.renderer.resize(containerWidth, containerHeight)
    this.fitStage(containerWidth, containerHeight)
  }

  /** 等比缩放完整办公室场景并居中，任何屏幕比例下都不裁切内容 */
  private fitStage(containerWidth: number, containerHeight: number) {
    if (!this.world) return

    const scale = Math.min(
      containerWidth / SCENE_WIDTH,
      containerHeight / SCENE_HEIGHT,
    )
    const offsetX = (containerWidth - SCENE_WIDTH * scale) / 2
    const offsetY = (containerHeight - SCENE_HEIGHT * scale) / 2

    this.world.scale.set(scale)
    this.world.position.set(offsetX, offsetY)

    const canvas = this.app?.canvas as HTMLCanvasElement | undefined
    if (!canvas) return
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.maxWidth = '100%'
    canvas.style.maxHeight = '100%'
  }

  destroy() {
    this.initVersion += 1
    if (this.bridgeWorkspaceId) bindOfficeScene(null, this.bridgeWorkspaceId, this)
    this.app?.ticker.remove(this.onTick)
    if (this.app) this.disposeApp(this.app)
    this.app = null
    this.agentEntities.clear()
    this.deskEntities.clear()
    this.deferredAgentStates.clear()
    this.officeLayer = null
  }

  private disposeApp(app: Application) {
    if (this.disposedApps.has(app)) return
    this.disposedApps.add(app)
    if (this.app === app) {
      if (this.bridgeWorkspaceId) bindOfficeScene(null, this.bridgeWorkspaceId, this)
      this.app = null
      this.world = null
      this.agentEntities.clear()
      this.deskEntities.clear()
      this.deferredAgentStates.clear()
      this.officeLayer = null
    }
    try {
      // `Application.init()` can fail before a renderer exists (for example
      // when WebGL is unavailable), so avoid calling destroy on a half-built
      // application whose renderer field is still null.
      if (app.renderer) {
        // Pixi 的 Application.destroy 会先销毁 renderer；多场景同时卸载时，
        // 再由 stage 子节点归还文字纹理会访问已经释放的纹理池。先在 renderer
        // 存活期间销毁场景树，再只回收 renderer/canvas，避免共享文本重复回收。
        app.stage?.destroy({ children: true })
        app.destroy({ removeView: true }, false)
      }
      else app.stage?.destroy({ children: true })
    } catch (error) {
      console.warn('[办公室] 场景资源清理失败。', error)
    }
  }

  private onTick = (ticker: { deltaTime: number }) => {
    if (this.visualPaused) return
    const dt = Math.min(ticker.deltaTime / 60, 0.05)

    this.agents = this.simulator.tick(dt, this.agents)
    this.pushDataToEntities()

    this.movement.update(this.agentEntities, dt)
    this.pullDataFromEntities()

    this.agents = this.simulator.afterMovement(
      dt,
      this.agents,
      this.agentEntities,
    )
    this.pushDataToEntities()

    // 先完成 mission 调度与延迟状态落地，再只发布一次最终快照，避免
    // 订阅面板在同一帧观察到 working -> idle 的短暂闪烁。
    if (this.bridgeWorkspaceId) notifyVisitMissionActivity(this.agents, this.bridgeWorkspaceId)
    if (this.applyDeferredAgentStates()) this.pushDataToEntities()

    this.animation.update(this.agentEntities, dt)
    this.sortOfficeDepth()
    this.syncDeskOccupancy()

    this.publishAgents()
  }

  private withAgentState(agent: Agent, state: AgentState, task?: string): Agent {
    return {
      ...agent,
      state,
      currentTask: task,
      targetX: undefined,
      targetY: undefined,
      walkPath: undefined,
      walkPathIndex: undefined,
      mission: undefined,
      bubbleText: undefined,
      customAnimation: undefined,
      interactionResumeState: undefined,
      interactionResumeTask: undefined,
      viewFacing:
        state === 'working' || state === 'thinking'
          ? ('back' as const)
          : agent.viewFacing,
    }
  }

  private publishAgents() {
    if (this.publishToStore) setOfficeAgents(this.agents)
  }

  private applyDeferredAgentStates(): boolean {
    if (this.deferredAgentStates.size === 0) return false
    let changed = false
    this.agents = this.agents.map((agent) => {
      const deferred = this.deferredAgentStates.get(agent.id)
      if (!deferred) return agent
      const stillVisiting = this.agents.some((visitor) => {
        const mission = visitor.mission
        if (mission?.kind !== 'desk_visit') return false
        const isVisitor = visitor.id === agent.id
        const isCurrentHost = mission.phase !== 'return'
          && mission.hostAgentId === agent.id
        const isQueuedHost = mission.queue.some((stop) => stop.hostAgentId === agent.id)
        return isVisitor || isCurrentHost || isQueuedHost
      })
      const rosterNo = AGENT_ROSTER.findIndex((entry) => entry.id === agent.id) + 1
      const stillQueued = Boolean(this.bridgeWorkspaceId) && rosterNo > 0 && isVisitParticipantPending(rosterNo, this.bridgeWorkspaceId!)
      const waitingAsVisitor = Boolean(this.bridgeWorkspaceId) && rosterNo > 0 && isVisitVisitorPending(rosterNo, this.bridgeWorkspaceId!)
      if (stillVisiting || stillQueued) {
        if (waitingAsVisitor && agent.state === 'idle') {
          changed = true
          return {
            ...agent,
            state: 'working' as const,
            currentTask: '等待交接',
            viewFacing: 'back' as const,
          }
        }
        return agent
      }
      this.deferredAgentStates.delete(agent.id)
      changed = true
      return this.withAgentState(agent, deferred.state, deferred.task)
    })
    return changed
  }

  private sortOfficeDepth() {
    if (!this.officeLayer) return

    const agentPositions = [...this.agentEntities.values()].map((e) => ({
      x: e.position.x,
      y: e.position.y,
    }))

    for (const e of this.agentEntities.values()) {
      e.zIndex = e.position.y
    }

    for (const desk of this.deskEntities.values()) {
      desk.updateDepthZ(agentPositions)
    }

    this.officeLayer.sortChildren()
  }

  private pushDataToEntities() {
    for (const agent of this.agents) {
      const entity = this.agentEntities.get(agent.id)
      if (!entity) continue

      const prev = entity.data
      entity.apply(agent)
      if (
        prev.x !== agent.x ||
        prev.y !== agent.y ||
        agent.state !== 'walking'
      ) {
        entity.setPosition(agent.x, agent.y)
      }
    }
  }

  private pullDataFromEntities() {
    this.agents = this.agents.map((agent) => {
      const entity = this.agentEntities.get(agent.id)
      return entity ? { ...agent, ...entity.data } : agent
    })
  }

  private syncDeskOccupancy() {
    const occupied = new Set(
      this.agents
        .filter((a) => a.state === 'working' && a.assignedDeskId)
        .map((a) => a.assignedDeskId!),
    )
    for (const desk of this.deskEntities.values()) {
      desk.setOccupied(occupied.has(desk.deskId))
    }
  }

  /** 桌子 / 人物 / 椅子同层；桌沿为界动态遮挡 */
  private spawnOffice(parent: Container) {
    const layer = new Container()
    layer.label = 'office'
    layer.sortableChildren = true
    this.officeLayer = layer

    for (const desk of DESKS) {
      const entity = new DeskEntity(desk)
      this.deskEntities.set(desk.id, entity)
      layer.addChild(
        entity.shadowGfx,
        entity.deskLayer,
        entity.chairLayer,
        entity.occupiedIndicator,
      )
    }

    for (const agent of this.agents) {
      const entity = new AgentEntity(agent, Boolean(this.options.onAgentClick))
      this.agentEntities.set(agent.id, entity)
      entity.zIndex = agent.y
      if (this.options.onAgentClick) {
        entity.on('pointertap', (event: FederatedPointerEvent) => {
          event.stopPropagation()
          this.options.onAgentClick?.({
            agent: { ...entity.data },
            rosterNo: this.agents.findIndex((a) => a.id === agent.id) + 1,
            clientX: event.clientX,
            clientY: event.clientY,
          })
        })
      }
      layer.addChild(entity)
    }

    this.sortOfficeDepth()
    parent.addChild(layer)
  }

  private drawMap(parent: Container) {
    const map = new Container()
    map.label = 'map'

    const floor = new Graphics()
    floor.rect(0, 0, SCENE_WIDTH, SCENE_HEIGHT)
    floor.fill(COLORS.floor)
    map.addChild(floor)

    const bgTex = getOfficeBackgroundTexture()
    if (bgTex) {
      const bg = new Sprite(bgTex)
      const scale = Math.min(
        SCENE_WIDTH / bgTex.width,
        SCENE_HEIGHT / bgTex.height,
      )
      bg.scale.set(scale)
      bg.position.set(
        (SCENE_WIDTH - bgTex.width * scale) / 2,
        (SCENE_HEIGHT - bgTex.height * scale) / 2,
      )
      map.addChild(bg)
    }

    parent.addChildAt(map, 0)
  }
}
