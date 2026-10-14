import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ConversationArtifactDock } from '@/components/ConversationArtifacts'
import { AssistantText } from '@/components/AssistantText'
import { OfficeCanvas } from '@/components/OfficeCanvas'
import {
  OFFICE_WORKSPACE_OVERVIEW_ID,
  workspaceLabel,
  type OfficeWorkspaceId,
} from '@/config/officeWorkspaces'
import type { OfficeAgentWorkspaceSummary, OfficeConversationArtifact } from '@/types/officeData'

type WorkspaceRelation = NonNullable<OfficeAgentWorkspaceSummary['relation']>

function workspaceRelations(workspace: OfficeAgentWorkspaceSummary): WorkspaceRelation[] {
  if (workspace.relations?.length) return workspace.relations
  return workspace.relation ? [workspace.relation] : []
}

function WorkspaceOfficePreview({ workspace, children }: { workspace: OfficeAgentWorkspaceSummary; children?: ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const observerUnavailable = typeof IntersectionObserver === 'undefined'
  const [mounted, setMounted] = useState(observerUnavailable)
  const [visible, setVisible] = useState(observerUnavailable)

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      setMounted(true)
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      const isVisible = Boolean(entry?.isIntersecting)
      setVisible(isVisible)
      if (isVisible) setMounted(true)
    }, { rootMargin: '320px 0px' })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return <div ref={hostRef} className="agent-space-canvas">
    {mounted ? <OfficeCanvas workspaceId={workspace.id} sessionId={workspace.sessionId} agentSummaries={workspace.agents} interactive={false} compact publishToStore={false} paused={!visible} /> : <div className="agent-space-placeholder" aria-hidden="true" />}
    {children}
  </div>
}

function WorkspaceOutputConsole({ workspace, compact = false }: { workspace: OfficeAgentWorkspaceSummary; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const consoleRef = useRef<HTMLElement>(null)
  const outputs = workspace.outputs || []
  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !consoleRef.current?.contains(event.target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])
  useEffect(() => setOpen(false), [workspace.id])
  return <section ref={consoleRef} className={`workspace-output-console${compact ? ' is-compact' : ''}`}>
    <button type="button" className="workspace-output-object" aria-label={`查看${workspaceLabel(workspace)}输出`} title="查看空间输出" onClick={() => setOpen((value) => !value)}>
      <span className="workspace-output-screen"><i /><i /><i /></span><span>输出</span>{outputs.length ? <b>{outputs.length}</b> : null}
    </button>
    {open ? <div className="workspace-output-panel" role="dialog" aria-label={`${workspaceLabel(workspace)}输出记录`}>
      <header><div><strong>{workspaceLabel(workspace)}输出</strong><small>模型正文、活动、交接与产物</small></div><button type="button" aria-label="关闭输出记录" onClick={() => setOpen(false)}>×</button></header>
      {outputs.length === 0 ? <p>暂无输出记录</p> : <ol>{[...outputs].reverse().map((output) => {
        const agent = output.rosterNo ? workspace.agents.find((item) => item.rosterNo === output.rosterNo)?.name : null
        return <li key={output.id} className={`kind-${output.kind}${output.streaming ? ' is-streaming' : ''}`}><i /><div>
          {output.kind === 'model' ? <div className="workspace-model-output"><AssistantText text={output.text} /></div> : <span>{agent ? `${agent} · ` : ''}{output.text}</span>}
          <time>{output.streaming ? '实时生成中 · ' : ''}{new Date(output.updatedAt || output.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        </div></li>
      })}</ol>}
    </div> : null}
  </section>
}

function cardEdgePoint(rect: DOMRect, targetX: number, targetY: number, root: DOMRect) {
  const centerX = rect.left - root.left + rect.width / 2
  const centerY = rect.top - root.top + rect.height / 2
  const dx = targetX - centerX
  const dy = targetY - centerY
  const scale = 1 / Math.max(Math.abs(dx) / Math.max(rect.width / 2 - 7, 1), Math.abs(dy) / Math.max(rect.height / 2 - 7, 1), .001)
  return { x: centerX + dx * scale, y: centerY + dy * scale }
}

function WorkspaceOverview({ workspaces, onArtifactOpen, onWorkspaceSelect }: { workspaces: OfficeAgentWorkspaceSummary[]; onArtifactOpen?: (artifact: OfficeConversationArtifact) => void; onWorkspaceSelect?: (workspaceId: OfficeWorkspaceId) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef(new Map<string, HTMLElement>())
  const outgoing = useMemo(() => workspaces.flatMap((workspace) => workspaceRelations(workspace)
    .filter((relation) => relation.direction === 'outgoing')
    .map((relation) => ({ senderId: workspace.id, receiverId: relation.peerWorkspaceId, relation }))), [workspaces])
  const [routes, setRoutes] = useState<Array<{ senderId: string; receiverId: string; relation: WorkspaceRelation; left: number; top: number; width: number; angle: number }>>([])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) { setRoutes([]); return }
    const update = () => {
      const root = container.getBoundingClientRect()
      setRoutes(outgoing.flatMap((item) => {
        const source = cardsRef.current.get(item.senderId)
        const target = cardsRef.current.get(item.receiverId)
        if (!source || !target) return []
        const from = source.getBoundingClientRect()
        const to = target.getBoundingClientRect()
        const fromCenterX = from.left - root.left + from.width / 2
        const fromCenterY = from.top - root.top + from.height / 2
        const toCenterX = to.left - root.left + to.width / 2
        const toCenterY = to.top - root.top + to.height / 2
        const sourceEdge = cardEdgePoint(from, toCenterX, toCenterY, root)
        const targetEdge = cardEdgePoint(to, fromCenterX, fromCenterY, root)
        const reverse = item.relation.phase === 'returning'
        const x1 = reverse ? targetEdge.x : sourceEdge.x
        const y1 = reverse ? targetEdge.y : sourceEdge.y
        const x2 = reverse ? sourceEdge.x : targetEdge.x
        const y2 = reverse ? sourceEdge.y : targetEdge.y
        return [{ ...item, left: x1, top: y1, width: Math.hypot(x2 - x1, y2 - y1), angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI }]
      }))
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [outgoing])

  return <section className="multi-space-overview">
    <header className="multi-space-heading"><div><span>AGENT WORKSPACES</span><h2>多 Agent 空间总览</h2><p>每个卡片都直接复用主空间的完整办公室场景，只隔离 Agent 状态、动作和产物。</p></div><div className="workspace-count-chip">{workspaces.length} 个 Agent</div></header>
    <div ref={containerRef} className="agent-space-grid">
      {workspaces.map((workspace) => {
        const relations = workspaceRelations(workspace)
        const sending = outgoing.some((item) => item.senderId === workspace.id)
        const receiving = outgoing.some((item) => item.receiverId === workspace.id)
        return <article
          key={workspace.id}
          ref={(node) => { if (node) cardsRef.current.set(workspace.id, node); else cardsRef.current.delete(workspace.id) }}
          className={`agent-space-card${relations.length ? ' has-relation' : ''}${sending ? ' is-sending' : ''}${receiving ? ' is-receiving' : ''}`}
          onClick={(event) => {
            const target = event.target
            if (target instanceof Element && target.closest('button, a, input, select, textarea, [role="button"], [role="dialog"]')) return
            onWorkspaceSelect?.(workspace.id)
          }}
        >
          <button type="button" className="agent-space-select" onClick={() => onWorkspaceSelect?.(workspace.id)}><span><i className={workspace.kind === 'main' ? 'main' : ''} />{workspaceLabel(workspace)}</span><small>{workspace.kind === 'main' ? '主 Agent' : '子 Agent'}</small></button>
          <WorkspaceOfficePreview workspace={workspace}>
            <WorkspaceOutputConsole workspace={workspace} compact />
            {workspace.sessionId && onArtifactOpen ? <ConversationArtifactDock sessionId={workspace.sessionId} pending={workspace.agents.some((agent) => agent.state !== 'idle')} generation={workspace.updatedAt} officeHidden={false} workspaceId={workspace.id} onOpen={onArtifactOpen} /> : null}
          </WorkspaceOfficePreview>
          {relations.map((relation) => <div key={`${relation.direction}-${relation.peerWorkspaceId}`} className={`workspace-relation phase-${relation.phase}`}><i /><span>{relation.message}</span></div>)}
        </article>
      })}
      {routes.map((route) => {
        const routePhase = route.relation.phase === 'talking' ? 'talk' : route.relation.phase === 'returning' ? 'return' : 'goto'
        return <div key={`${route.senderId}-${route.receiverId}`} className={`space-handoff-route phase-${routePhase}`} style={{ left: route.left, top: route.top, width: route.width, transform: `rotate(${route.angle}deg)`, '--route-angle': `${route.angle}deg` } as CSSProperties} aria-label={route.relation.message}>
          <span className="space-handoff-track" /><span className="space-handoff-arrow" /><span className="space-handoff-dots"><i /><i /><i /></span><span className="space-handoff-label">{route.relation.phase === 'talking' ? '消息同步中' : route.relation.phase === 'returning' ? '结果返回' : '任务消息'}</span>
        </div>
      })}
    </div>
  </section>
}

/** 动态 Agent 空间直接复用主空间的完整 OfficeCanvas，不维护第二套仿制办公室。 */
export function AgentWorkspaceView({ workspaceId, workspaces, onArtifactOpen, onWorkspaceSelect }: { workspaceId: OfficeWorkspaceId; workspaces: OfficeAgentWorkspaceSummary[]; onArtifactOpen?: (artifact: OfficeConversationArtifact) => void; onWorkspaceSelect?: (workspaceId: OfficeWorkspaceId) => void }) {
  if (workspaceId === OFFICE_WORKSPACE_OVERVIEW_ID) return <WorkspaceOverview workspaces={workspaces} onArtifactOpen={onArtifactOpen} onWorkspaceSelect={onWorkspaceSelect} />
  const workspace = workspaces.find((item) => item.id === workspaceId)
  if (!workspace || workspace.kind === 'main') return null
  const activeCount = workspace.agents.filter((agent) => agent.state !== 'idle').length
  return <div className="single-agent-workspace">
    <OfficeCanvas workspaceId={workspace.id} sessionId={workspace.sessionId} agentSummaries={workspace.agents} />
    <WorkspaceOutputConsole workspace={workspace} />
    {workspace.sessionId && onArtifactOpen ? <ConversationArtifactDock sessionId={workspace.sessionId} pending={activeCount > 0} generation={workspace.updatedAt} officeHidden={false} workspaceId={workspace.id} onOpen={onArtifactOpen} /> : null}
  </div>
}
