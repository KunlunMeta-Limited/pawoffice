import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArtifactShelf } from '@/components/ArtifactShelf'
import { MAIN_OFFICE_WORKSPACE_ID, officeSceneScopeId } from '@/config/officeWorkspaces'
import { OfficeScene, type OfficeAgentClick } from '@/scene/OfficeScene'
import { INITIAL_AGENTS, SCENE_HEIGHT, SCENE_WIDTH } from '@/scene/layout/officeLayout'
import { getOfficeAgents } from '@/store/officeStore'
import type { Agent, AgentState } from '@/types/agent'
import type { OfficeAgentSummary } from '@/types/officeData'

type AgentMenuState = {
  agent: Agent
  rosterNo: number
  x: number
  y: number
  agents: Agent[]
  pickingTarget: boolean
}

const STATE_ACTIONS: Array<{
  label: string
  state: AgentState
  task?: string
}> = [
  { label: '开始工作', state: 'working', task: '处理当前任务…' },
  { label: '进入思考', state: 'thinking', task: '思考下一步…' },
  { label: '暂时空闲', state: 'idle' },
]

const EMOTE_ACTIONS = [
  { label: '生气', animation: 'emotes/angry' },
  { label: '打嗝', animation: 'emotes/burp' },
  { label: '困惑', animation: 'emotes/confused' },
  { label: '哭泣', animation: 'emotes/crying' },
  { label: '倒下', animation: 'emotes/dead' },
  { label: '坚定', animation: 'emotes/determined' },
  { label: '凝视', animation: 'emotes/dramatic-stare' },
  { label: '兴奋', animation: 'emotes/excited' },
  { label: '撒娇', animation: 'emotes/fawning' },
  { label: '脸红', animation: 'emotes/flushed' },
  { label: '欢呼', animation: 'emotes/hooray' },
  { label: '灵感', animation: 'emotes/idea' },
  { label: '刚刚好', animation: 'emotes/just-right' },
  { label: '大笑', animation: 'emotes/laugh' },
  { label: '喜欢', animation: 'emotes/love' },
  { label: '害怕', animation: 'emotes/scared' },
  { label: '遮眼', animation: 'emotes/see-no-evil' },
  { label: '耸肩', animation: 'emotes/shrug' },
  { label: '闷闷不乐', animation: 'emotes/sulk' },
  { label: '冒汗', animation: 'emotes/sweat' },
  { label: '思考表情', animation: 'emotes/thinking' },
  { label: '吐舌', animation: 'emotes/tongue-out' },
  { label: '挥手', animation: 'emotes/wave' },
] as const

type OfficeCanvasProps = {
  workspaceId?: string
  sessionId?: string
  agentSummaries?: OfficeAgentSummary[]
  interactive?: boolean
  compact?: boolean
  publishToStore?: boolean
  paused?: boolean
}

function initialAgentsFromSummaries(summaries?: OfficeAgentSummary[]) {
  return INITIAL_AGENTS.map((agent, index) => {
    const summary = summaries?.find((item) => item.rosterNo === index + 1)
    return summary ? { ...agent, state: summary.state, currentTask: summary.task || undefined } : { ...agent }
  })
}

export function OfficeCanvas({ workspaceId = 'main', sessionId, agentSummaries, interactive = true, compact = false, publishToStore, paused = false }: OfficeCanvasProps = {}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<OfficeScene | null>(null)
  const readyRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const initialSummariesRef = useRef(agentSummaries)
  const sceneScopeId = officeSceneScopeId(sessionId, workspaceId)
  const [menu, setMenu] = useState<AgentMenuState | null>(null)
  const [sceneScale, setSceneScale] = useState(1)

  const openMenu = useCallback((agent: Agent, rosterNo: number, x: number, y: number) => {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return
    const menuWidth = Math.min(260, Math.max(220, rect.width - 24))
    const menuHeight = Math.min(520, rect.height - 24)
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setMenu({
      agent,
      rosterNo,
      x: Math.max(12, Math.min(x, rect.width - menuWidth - 12)),
      y: Math.max(12, Math.min(y, rect.height - menuHeight - 12)),
      agents: sceneRef.current?.getAgents() ?? getOfficeAgents(),
      pickingTarget: false,
    })
  }, [])

  const closeMenu = useCallback(() => {
    setMenu(null)
    window.setTimeout(() => restoreFocusRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    let cancelled = false

    const handleAgentClick = (event: OfficeAgentClick) => {
      const rect = host.getBoundingClientRect()
      openMenu(event.agent, event.rosterNo, event.clientX - rect.left, event.clientY - rect.top)
    }

    const scene = new OfficeScene({
      onAgentClick: interactive ? handleAgentClick : undefined,
      initialAgents: initialAgentsFromSummaries(initialSummariesRef.current),
      bridgeWorkspaceId: sceneScopeId,
      publishToStore: publishToStore ?? workspaceId === MAIN_OFFICE_WORKSPACE_ID,
    })
    sceneRef.current = scene

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width <= 0 || height <= 0) return
      setSceneScale(Math.min(width / SCENE_WIDTH, height / SCENE_HEIGHT))

      if (!readyRef.current) {
        readyRef.current = true
        void scene.init(host, width, height).catch((error: unknown) => {
          readyRef.current = false
          if (!cancelled) {
            console.error('[办公室] 场景初始化失败。', error)
          }
        })
        return
      }

      sceneRef.current?.resize(width, height)
    })

    ro.observe(host)

    return () => {
      cancelled = true
      ro.disconnect()
      readyRef.current = false
      scene.destroy()
      sceneRef.current = null
    }
  }, [interactive, openMenu, publishToStore, sceneScopeId, workspaceId])

  useEffect(() => {
    if (!agentSummaries) return
    for (const agent of agentSummaries) sceneRef.current?.setAgentState(agent.id, agent.state, agent.task || undefined)
  }, [agentSummaries])

  useEffect(() => {
    sceneRef.current?.setVisualPaused(paused)
  }, [paused])

  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.agent-action-menu')) {
        return
      }
      closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!menu) return
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeMenu, menu])

  useEffect(() => {
    if (!menu) return
    window.setTimeout(() => menuRef.current?.querySelector<HTMLElement>('button')?.focus(), 0)
  }, [menu])

  const applyState = (state: AgentState, task?: string) => {
    if (!menu) return
    sceneRef.current?.setAgentState(menu.agent.id, state, task)
    closeMenu()
  }

  const playEmote = (animation: string, label: string) => {
    if (!menu) return
    sceneRef.current?.playAgentAnimation(menu.agent.id, animation, label)
    closeMenu()
  }

  const startInteraction = (targetRosterNo: number, targetName: string) => {
    if (!menu || targetRosterNo === menu.rosterNo) return
    sceneRef.current?.requestDeskVisit(
      menu.rosterNo,
      targetRosterNo,
      `${targetName}，我来和你同步一下。`,
    )
    closeMenu()
  }

  return (
    <div ref={hostRef} className={`office-canvas${compact ? ' is-compact' : ''}`} aria-label={`${workspaceId} 办公室场景`} data-visual-paused={paused ? 'true' : 'false'}>
      <div
        className="office-scene-overlay"
        style={{
          width: SCENE_WIDTH,
          height: SCENE_HEIGHT,
          transform: `translate(-50%, -50%) scale(${sceneScale})`,
        } as CSSProperties}
      >
        <ArtifactShelf variant="wall" owner="当前协作空间" workspaceId={workspaceId} />
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="agent-action-menu"
          role="dialog"
          aria-modal="true"
          aria-label={`${menu.agent.name} 操作菜单`}
          style={{ left: menu.x, top: menu.y }}
        >
          <div className="agent-action-head">
            <span className="agent-action-name">{menu.agent.name}</span>
            <span className="agent-action-state">{menu.agent.state}</span>
            <button type="button" className="agent-action-close" aria-label="关闭人物操作菜单" onClick={closeMenu}>×</button>
          </div>

          {!menu.pickingTarget ? (
            <>
              <div className="agent-action-group">
                <div className="agent-action-section-title">互动</div>
                <button
                  type="button"
                  className="agent-action-btn"
                  onClick={() =>
                    setMenu((current) =>
                      current ? { ...current, pickingTarget: true } : current,
                    )
                  }
                >
                  互动…
                </button>
              </div>

              <div className="agent-action-group">
                <div className="agent-action-section-title">状态</div>
                {STATE_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    className="agent-action-btn"
                    onClick={() => applyState(action.state, action.task)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>

              <div className="agent-action-group">
                <div className="agent-action-section-title">表情动作</div>
                <div className="agent-emote-grid">
                  {EMOTE_ACTIONS.map((action) => (
                    <button
                      key={action.animation}
                      type="button"
                      className="agent-action-chip"
                      onClick={() => playEmote(action.animation, action.label)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="agent-action-group">
              <div className="agent-action-section-title">选择互动对象</div>
              <button
                type="button"
                className="agent-action-btn subtle"
                onClick={() =>
                  setMenu((current) =>
                    current ? { ...current, pickingTarget: false } : current,
                  )
                }
              >
                返回动作
              </button>
              {menu.agents
                .map((agent, index) => ({ agent, rosterNo: index + 1 }))
                .filter(({ agent }) => agent.id !== menu.agent.id)
                .map(({ agent, rosterNo }) => (
                  <button
                    key={agent.id}
                    type="button"
                    className="agent-action-btn"
                    onClick={() => startInteraction(rosterNo, agent.name)}
                  >
                    和 {agent.name} 互动
                  </button>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
