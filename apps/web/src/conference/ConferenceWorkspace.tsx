// Temporary composition. Removal: restore main.tsx's App import and delete this directory.
// The original application, backend messages and public renderers stay unchanged.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RefObject } from 'react'
import { ArrowUp, Bell, ChevronLeft, Clapperboard, Grid2X2, MessageCircle, Play } from 'lucide-react'
import App, { OfficeApp } from '../App.tsx'
import { SseMessageTransport } from '@pawoffice/runtime/adapters/sse'
import { officeIntegrationPaths } from '@pawoffice/protocol/office-integration'
import { chatPath } from '@pawoffice/protocol/chat'
import { stringifyProtocolObject } from '@pawoffice/protocol/schema'
import { OfficeIntegrationSession } from '../application/OfficeIntegrationSession.ts'
import { OfficeTeamSession } from '../application/OfficeTeamSession.ts'
import { OfficeTeamHost } from '../application/OfficeTeamHost.ts'
import { createOfficeRuntime } from '../application/createOfficeRuntime.ts'
import { supportsCharacterPose } from '../application/poseSupport.ts'
import { seatStepDurationMs } from '@pawoffice/scene-office/pixi/projection'
import { HttpChatSource } from '../chat/sources.ts'
import { browserChatPersistence } from '../chat/persistence.ts'
import { sceneRelayUrl } from '../../../shared/scene/connectionConfig.ts'
import { requestOfficeLayout } from '../application/requestOfficeLayout.ts'
import { requestOfficeUi } from '../application/requestOfficeUi.ts'
import { readOfficeShell, saveOfficeShell } from '../ui/officeLayout.ts'
import type { OfficeCreationInput } from '../dashboard/officeDirectory.ts'
import { OfficeShell } from '../ui/OfficeShell.tsx'
import { MemberOfficeShell } from '../ui/MemberOfficeShell.tsx'
import { OfficeEmptyState } from '../ui/OfficeEmptyState.tsx'
import { TeamDecisionNotice } from '../ui/team-switcher/TeamDecisionNotice.tsx'
import type { OfficeTeamOption } from '../ui/TeamSwitcher.tsx'
import { captureScene, formalFrame, formalPlaceholder, frameParameter, frameScope, localOfficePreview, localOfficeSession, officeKey, previewOf } from './frameRuntime.ts'
import type { FrameCommand, FrameReport, OfficePreview } from './frameRuntime.ts'
import { conferenceLocalOffices } from './demoScenarios.ts'
import './ConferenceWorkspace.css'

const noop = () => {}, noAction = async () => {}
const statuses = { unknown: '未同步', attention: '待处理', running: '运行中', completed: '已完成', idle: '空闲' }
const frameUrl = (frameId: string) => { const url = new URL(location.href); url.searchParams.set(frameParameter, frameId); return url.href }
const sendReport = (frameId: string, report: FrameReport) => parent.postMessage({ scope: frameScope, frameId, report }, location.origin)

// One clock per host, including when Chrome throttles background frame RAFs.
function useHostedSessions(sessions: readonly OfficeTeamSession[], active: boolean) {
  const [host] = useState(() => new OfficeTeamHost()), activeRef = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])
  useEffect(() => { host.update(sessions) }, [host, sessions])
  useEffect(() => {
    let previous = performance.now(), frame = 0
    const advance = () => { const now = performance.now(); host.advance(now - previous); previous = now }
    const tick = () => { if (activeRef.current && !document.hidden) advance(); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    const timer = setInterval(() => { if (!activeRef.current || document.hidden) advance() }, 50)
    return () => { cancelAnimationFrame(frame); clearInterval(timer); host.stop() }
  }, [host])
  useEffect(() => {
    const flush = () => { sessions.forEach(session => { void session.chat.flush() }) }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [sessions])
}

function useFrameBridge(frameId: string, getOffices: () => OfficePreview[], command: (value: FrameCommand) => void) {
  const [view, setView] = useState(() => ({ active: parent === window, rendering: parent === window }))
  const current = useRef({ getOffices, command })
  useEffect(() => { current.current = { getOffices, command } }, [getOffices, command])
  useEffect(() => {
    if (parent === window) return
    let desiredView = { active: false, rendering: false, sampling: false }
    let capture: AbortController | undefined
    const navigation = document.createElement('base')
    navigation.target = '_top'; document.head.append(navigation)
    const activeOffice = () => document.querySelector<HTMLElement>('[data-frame-office]')?.dataset.frameOffice
    const takePreview = (officeId: string, live: boolean) => {
      const pending = new AbortController()
      capture = pending
      void captureScene(pending.signal, live).catch(() => undefined).then(image => {
        if (capture !== pending) return
        capture = undefined
        if (!live) setView({ active: desiredView.active, rendering: desiredView.rendering })
        if (image) sendReport(frameId, { type: 'image', officeId, image })
      })
    }
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== parent || event.data?.scope !== frameScope || event.data.frameId !== frameId) return
      const value = event.data.command as FrameCommand | undefined
      if (!value) return
      if (value.type !== 'view') { current.current.command(value); return }
      if (desiredView.active === value.active && desiredView.rendering === value.rendering && desiredView.sampling === value.sampling) return
      const officeId = desiredView.active && !value.rendering ? activeOffice() : undefined
      desiredView = value
      capture?.abort()
      capture = undefined
      setView({ active: value.active, rendering: value.rendering || !!officeId })
      if (officeId) takePreview(officeId, false)
    }
    const publish = () => {
      const offices = current.current.getOffices(), loaded = !document.querySelector('.office-loading')
      const canvas = document.querySelector('.office-render-surface canvas')
      const officeId = activeOffice()
      sendReport(frameId, { type: 'state', offices: offices.map(office => ({ ...office,
        ready: !office.rawId || office.id === officeId && loaded && !!canvas })) })
      if (desiredView.sampling && !capture && officeId && loaded && canvas) takePreview(officeId, true)
    }
    window.addEventListener('message', receive); publish()
    const timer = setInterval(publish, 500)
    return () => { capture?.abort(); capture = undefined; clearInterval(timer); window.removeEventListener('message', receive); navigation.remove() }
  }, [frameId])
  return view
}

function LocalOfficeFrame({ frameId }: { frameId: string }) {
  const [office] = useState(() => conferenceLocalOffices(localStorage).find(office => officeKey(false, office.id) === frameId))
  const [session] = useState(() => office ? localOfficeSession(office, localStorage) : undefined)
  const [shell, setShell] = useState(readOfficeShell), [decisionToken, setDecisionToken] = useState(0)
  const sessions = useMemo(() => session ? [session] : [], [session])
  const view = useFrameBridge(frameId, () => office && session ? [previewOf(frameId, false, { ...office, session }, shell)] : [], value => {
    if (!session) return
    if (value.type === 'decisions') { const id = session.decisions.getSnapshot().pending[0]?.conversationId; if (id) session.chat.select(id); setDecisionToken(token => token + 1) }
    if (value.type === 'resolve') void session.decisions.choose(session.runtime.sceneId, value.decisionId, value.choiceId, value.customText)
  })
  useHostedSessions(sessions, view.active)
  return <div className="conference-frame" data-frame-office={office && officeKey(false, office.id)}>
    {session ? <OfficeApp dataSource={session.source} session={session} decisionOpenToken={decisionToken} renderingSuspended={!view.rendering}
      pageLayout={{ value: shell, busy: false, onChange: value => { saveOfficeShell(value); setShell(value) } }} />
      : <div className="conference-empty" role="status">办公室未找到，请返回总览。</div>}
  </div>
}

function ConnectedOfficeFrame() {
  const relayUrl = sceneRelayUrl(), baseUrl = relayUrl ?? ''
  const [integration] = useState(() => {
    const chatSource = new HttpChatSource(`${baseUrl.replace(/\/$/, '')}${chatPath}`)
    return new OfficeIntegrationSession({ transport: new SseMessageTransport(baseUrl), storage: localStorage,
      changeLayout: id => requestOfficeLayout(baseUrl, id),
      createSession: (source, sceneId) => new OfficeTeamSession(createOfficeRuntime({ sceneId, referenceLayout: true,
        supportsPose: supportsCharacterPose, seatStepDuration: seatStepDurationMs }), source, { chatSource,
        requestUi: action => requestOfficeUi(baseUrl, action),
        chatPersistence: browserChatPersistence(sceneId, `connected:${baseUrl}:${chatSource.historyKey ?? chatSource.kind}`) }),
      reply: async value => {
        const response = await fetch(`${baseUrl.replace(/\/$/, '')}${officeIntegrationPaths.reply}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: stringifyProtocolObject(value), signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw Object.assign(new Error(response.status === 410 ? '请求已结束或超时' : `结果提交失败（${response.status}）`), { status: response.status })
      },
    })
  })
  const state = useSyncExternalStore(integration.subscribe, integration.getSnapshot)
  const [selected, select] = useState(''), [decisionToken, setDecisionToken] = useState(0)
  const office = state.offices.find(office => office.id === selected) ?? state.offices[0]
  const sessions = useMemo(() => state.offices.map(office => office.session), [state.offices])
  const view = useFrameBridge(formalFrame, () => state.offices.length
    ? state.offices.map(office => previewOf(formalFrame, true, office, state.layout.currentLayoutId, state.connection))
    : [formalPlaceholder(!!relayUrl, state.connection)], value => {
    if (value.type === 'select' || value.type === 'decisions') {
      select(value.officeId)
      if (value.type === 'decisions') {
        const session = state.offices.find(office => office.id === value.officeId)?.session, id = session?.decisions.getSnapshot().pending[0]?.conversationId
        if (id) session?.chat.select(id)
        setDecisionToken(token => token + 1)
      }
    }
    if (value.type === 'resolve') void state.offices.find(office => office.id === value.officeId)?.session.decisions.choose(value.officeId, value.decisionId, value.choiceId, value.customText)
  })
  useHostedSessions(sessions, view.active)
  useEffect(() => { if (!relayUrl) return; void integration.start(); return () => integration.stop() }, [integration, relayUrl])
  const createOffice = async ({ name }: OfficeCreationInput) => {
    const result = await requestOfficeUi(baseUrl, { id: crypto.randomUUID(), teamId: '', conversationId: '', action: 'office.create', name })
    if (result.target !== 'office') throw new Error(result.target === 'result' ? result.message || '未能创建办公室，请重试。' : '工作空间服务没有返回新办公室。')
    await integration.registerCreatedOffice(result.snapshot)
  }
  const pageLayout = { value: state.layout.currentLayoutId, busy: state.layoutBusy, onChange: (id: typeof state.layout.currentLayoutId) => { void integration.selectLayout(id) } }
  const placeholder = formalPlaceholder(!!relayUrl, state.connection), Shell = pageLayout.value === 'classic' ? OfficeShell : MemberOfficeShell
  return <div className="conference-frame" data-frame-office={office ? officeKey(true, office.id) : placeholder.id}>
    {office ? <OfficeApp key={office.id} dataSource={office.source} session={office.session} pageLayout={pageLayout} decisionOpenToken={decisionToken} integrationError={state.error} renderingSuspended={!view.rendering} />
      : <Shell connection={placeholder.connection} dashboard={null} dashboardError={state.error} sceneLinkError={null} dataMode="push" hasOffice={false}
        canExecuteActions={false} executeAction={noAction} pendingTaskIds={[]} actionError={null} appearanceIds={{}} editing={false}
        canRecoverLayout={false} recoverLayout={noop} exportCapabilities={noop} exportSnapshot={noop} renderScenePanel={() => null}
        scene={<OfficeEmptyState create={relayUrl ? createOffice : undefined} />} />}
  </div>
}

export function OfficePreviewPage({ office, image }: { office: OfficePreview; image?: string }) {
  const Shell = office.layout === 'classic' ? OfficeShell : MemberOfficeShell
  const preview = image ?? (office.connected ? undefined : `${import.meta.env.BASE_URL}assets/office/preview.webp`)
  return <Shell connection={office.connection} dashboard={office.dashboard} dashboardError={null} sceneLinkError={null} dataMode={office.connected ? 'push' : 'example'}
    appearanceIds={office.appearances} executeAction={noAction} canExecuteActions={false} pendingTaskIds={[]} actionError={null} editing={false}
    canRecoverLayout={false} recoverLayout={noop} exportCapabilities={noop} exportSnapshot={noop} renderScenePanel={() => undefined}
    scene={<main className="office-main office-main-reference"><div className="office-stage"><div className="office-canvas"><div className="office-render-surface">
      {preview ? <img src={preview} className="dispatch-live-canvas" alt="" decoding="async" /> : <span className="dispatch-preview-loading">{office.rawId ? '暂无预览' : office.connection}</span>}</div>
      {!!office.rawId && <div className="dispatch-preview-toolbar"><Grid2X2 size={18} />{!office.connected && <><Clapperboard size={18} /><Play size={18} /></>}</div>}
    </div></div><div className="office-chat" data-expanded="false"><div className="office-chat-composer"><span className="office-chat-history is-session"><MessageCircle size={15} /><span>{office.conversationTitle || office.name}</span></span><span className="dispatch-preview-placeholder">和办公室聊一聊…</span><span className="office-chat-send"><ArrowUp size={21} /></span></div></div></main>} />
}
function OfficePreview({ office, image, viewport }: { office: OfficePreview; image?: string; viewport: { width: number; height: number } }) {
  const root = useRef<HTMLDivElement>(null), page = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const container = root.current, surface = page.current
    if (!container || !surface) return
    const fit = () => surface.style.setProperty('--preview-scale', String(Math.min(container.clientWidth / viewport.width, container.clientHeight / viewport.height)))
    fit(); const observer = new ResizeObserver(fit); observer.observe(container); return () => observer.disconnect()
  }, [viewport.width, viewport.height])
  return <div ref={root} className="dispatch-live-preview" aria-hidden="true" inert>
    <div ref={page} className="dispatch-live-page" style={viewport}><OfficePreviewPage office={office} image={image} /></div>
  </div>
}

// Temporary office overview; remove with ConferenceWorkspace.
export interface OverviewOrigin {
  top: number
  left: number
  width: number
  height: number
  radius: number
}

function readOverviewOrigin(trigger: HTMLElement | null, radius?: number): OverviewOrigin | undefined {
  if (!trigger) return undefined
  const bounds = trigger.getBoundingClientRect()
  return { top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height,
    radius: radius ?? Math.min(bounds.width, bounds.height) / 2 }
}

function overviewOriginFrame(origin: OverviewOrigin, viewport: { width: number; height: number }): Keyframe {
  const scaleX = Math.max(.001, origin.width / viewport.width), scaleY = Math.max(.001, origin.height / viewport.height)
  return { transform: `translate(${origin.left}px, ${origin.top}px) scale(${scaleX}, ${scaleY})`, borderRadius: `${origin.radius}px` }
}

const fullOverviewFrame: Keyframe = { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: '0px' }

function applyOverviewFrame(element: HTMLElement, frame: Keyframe) {
  element.style.transform = String(frame.transform ?? 'none')
  element.style.borderRadius = String(frame.borderRadius ?? '0px')
}

function overviewTriggerFrame(element: HTMLElement, trigger: HTMLElement | null): Keyframe {
  const viewport = element.ownerDocument.defaultView!
  return overviewOriginFrame(readOverviewOrigin(trigger) ?? { top: 18, left: viewport.innerWidth - 64, width: 44, height: 44, radius: 22 },
    { width: viewport.innerWidth, height: viewport.innerHeight })
}

function timing(element: HTMLElement, duration: number) {
  const reduced = element.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches
  return { duration: reduced ? 0 : duration, easing: 'cubic-bezier(.2,.75,.2,1)', fill: 'both' as const }
}

function animateOverview(element: HTMLElement, from: Keyframe, to: Keyframe, closing = false) {
  return element.animate([from, to], timing(element, closing ? 240 : 380))
}

function animateOfficeEntry(element: HTMLElement, origin: OverviewOrigin) {
  const viewport = element.ownerDocument.defaultView!
  return element.animate([
    { left: `${origin.left}px`, top: `${origin.top}px`, width: `${origin.width}px`, height: `${origin.height}px`, borderRadius: `${origin.radius}px` },
    { left: '0px', top: '0px', width: `${viewport.innerWidth}px`, height: `${viewport.innerHeight}px`, borderRadius: '0px' },
  ], timing(element, 420))
}

function revealOffice(element: HTMLElement) {
  return element.animate([{ opacity: 1 }, { opacity: 0 }], timing(element, 220))
}

const previewViewport = () => typeof window === 'undefined' ? { width: 1440, height: 900 } : ({ width: Math.max(1440, window.innerWidth), height: Math.max(900, window.innerHeight) })
type OverviewProps = { offices: OfficePreview[]; images: Record<string, string>; selectedId: string; onSelect: (office: OfficePreview, decisions?: boolean) => void;
  onClose: () => void; livePreviews: boolean; onToggleLivePreviews: () => void; trigger?: RefObject<HTMLButtonElement | null> }
export function OfficeOverview({ offices, images, selectedId, onSelect, onClose, livePreviews, onToggleLivePreviews, trigger }: OverviewProps) {
  const dialog = useRef<HTMLDialogElement>(null), zoom = useRef<HTMLDivElement>(null), transition = useRef<Animation | undefined>(undefined)
  const closing = useRef(false), closed = useRef(onClose), titleId = useId()
  const [opening, setOpening] = useState(true), [isClosing, setClosing] = useState(false)
  const [entry, setEntry] = useState<{ office: OfficePreview; origin: OverviewOrigin }>(), [expanded, setExpanded] = useState(false)
  const [viewport, setViewport] = useState(previewViewport)
  const running = offices.filter(office => office.activity.running).length, pending = offices.reduce((sum, office) => sum + office.decisionCount, 0)
  const close = () => {
    if (closing.current) return
    const element = dialog.current
    if (!element) return
    closing.current = true; setClosing(true)
    const current = getComputedStyle(element), from = { transform: current.transform === 'none' ? fullOverviewFrame.transform : current.transform, borderRadius: current.borderRadius }
    applyOverviewFrame(element, from); transition.current?.cancel()
    const animation = animateOverview(element, from, overviewTriggerFrame(element, trigger?.current ?? null), true)
    transition.current = animation; void animation.finished.then(onClose).catch(() => {})
  }
  const enter = (office: OfficePreview, preview?: HTMLElement | null, decisions = false) => {
    if (closing.current || opening || !preview) return
    const origin = readOverviewOrigin(preview, parseFloat(getComputedStyle(preview).borderTopLeftRadius))
    if (!origin) return
    closing.current = true; setEntry({ office, origin }); onSelect(office, decisions)
  }
  useEffect(() => { closed.current = onClose }, [onClose])
  useEffect(() => { const resize = () => setViewport(previewViewport()); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  useLayoutEffect(() => {
    const element = dialog.current
    if (!element) return
    let active = true
    const from = overviewTriggerFrame(element, trigger?.current ?? null)
    applyOverviewFrame(element, from); element.showModal()
    const timer = setTimeout(() => {
      if (!active) return
      const animation = animateOverview(element, from, fullOverviewFrame)
      transition.current = animation; element.dataset.presented = 'true'
      element.querySelector<HTMLButtonElement>('.dispatch-icon-button')?.focus({ preventScroll: true })
      void animation.finished.then(() => { if (active) { applyOverviewFrame(element, fullOverviewFrame); setOpening(false) } }).catch(() => {})
    }, 0)
    return () => { active = false; clearTimeout(timer); delete element.dataset.presented; transition.current?.cancel(); element.close() }
  }, [trigger])
  useLayoutEffect(() => {
    if (!entry || !zoom.current) return
    const animation = animateOfficeEntry(zoom.current, entry.origin)
    void animation.finished.then(() => setExpanded(true)).catch(() => {})
    return () => animation.cancel()
  }, [entry])
  const ready = !!entry && offices.some(office => office.id === entry.office.id && office.ready)
  useEffect(() => {
    if (!entry || !expanded || !ready || !dialog.current) return
    const animation = revealOffice(dialog.current); transition.current = animation
    void animation.finished.then(() => closed.current()).catch(() => {})
    return () => animation.cancel()
  }, [entry, expanded, ready])
  useEffect(() => { if (!entry) return; const timer = setTimeout(() => closed.current(), 10000); return () => clearTimeout(timer) }, [entry])
  return <dialog ref={dialog} className="dispatch-overview" aria-labelledby={titleId} aria-busy={isClosing || !!entry}
    onCancel={event => { event.preventDefault(); if (entry) onClose(); else close() }}>
    <h2 id={titleId} className="dispatch-visually-hidden">办公室总览</h2>
    <header className="dispatch-overview-heading">
      <button type="button" className="dispatch-icon-button" title="返回办公室" aria-label="关闭办公室总览" disabled={isClosing || !!entry} onClick={close}><ChevronLeft size={22} /></button>
      <span className="dispatch-office-count">{offices.length} 个办公室</span>
      <div className="dispatch-overview-actions">
        <button type="button" role="switch" className="dispatch-live-preview-toggle" aria-checked={livePreviews} disabled={isClosing || !!entry}
          title={livePreviews ? '关闭后复用办公室预览' : '开启后实时刷新所有办公室预览'} onClick={onToggleLivePreviews}>
          实时预览<span aria-hidden="true">{livePreviews ? '开' : '关'}</span>
        </button>
        <button type="button" className="dispatch-overview-ring" data-running={running > 0 || undefined} disabled={isClosing || !!entry}
          title={`${running}/${offices.length} 个办公室运行中${pending ? ` · ${pending} 项待确认` : ''} · 返回办公室`} aria-label="返回当前办公室" onClick={close}><span data-wide={`${running}/${offices.length}`.length > 5 || undefined}>{running}/{offices.length}</span>{pending > 0 && <i className="dispatch-attention-dot" aria-hidden="true" />}</button>
      </div>
    </header>
    <div className="dispatch-overview-scroll" inert={opening || isClosing || !!entry}>
      <div className="dispatch-office-grid">
        {offices.map(office => <article className="dispatch-office-card" key={office.id} data-office={office.id} data-running={office.activity.running || undefined}
          data-current={office.id === selectedId || undefined} data-status={office.activity.status}>
          <div role="button" tabIndex={0} className="dispatch-card-enter" aria-label={`进入${office.name}`} aria-pressed={office.id === selectedId}
            title={[office.name, office.connected ? `正式连接 · ${office.connection}` : '本地演示', statuses[office.activity.status], office.activity.goal, office.activity.latestActivity].filter(Boolean).join('\n')}
            onClick={event => enter(office, event.currentTarget.querySelector<HTMLElement>('.dispatch-preview'))}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); enter(office, event.currentTarget.querySelector<HTMLElement>('.dispatch-preview')) } }}>
            <div className="dispatch-preview"><OfficePreview office={office} image={images[office.id]} viewport={viewport} /></div>
            <span className="dispatch-card-caption"><span className="dispatch-card-name">{office.activity.status !== 'idle' && <span className="dispatch-status">{statuses[office.activity.status]}</span>}<strong>{office.name}</strong></span>
              {office.id === selectedId && !office.decisionCount && <span className="dispatch-current-label">当前办公室</span>}</span>
          </div>
          {!!office.decisionCount && <button type="button" className="dispatch-card-attention" aria-label={`${office.name}，${office.decisionCount} 项待确认`} title={`${office.decisionCount} 项待确认`}
            onClick={event => enter(office, event.currentTarget.closest('.dispatch-office-card')?.querySelector<HTMLElement>('.dispatch-preview'), true)}><Bell size={13} /><span>{office.decisionCount}</span></button>}
        </article>)}
      </div>
    </div>
    {entry && <div ref={zoom} className="dispatch-office-zoom" aria-hidden="true"><OfficePreview office={entry.office} image={images[entry.office.id]} viewport={viewport} /></div>}
    {entry && expanded && !ready && <p className="dispatch-entry-status" role="status">正在进入{entry.office.name}…</p>}
  </dialog>
}

function MultiOfficeWorkspace() {
  const [locals] = useState(() => conferenceLocalOffices(localStorage))
  const [selected, select] = useState(() => sceneRelayUrl() ? formalPlaceholder(true).id : officeKey(false, locals[0].id))
  const [reports, setReports] = useState<Record<string, OfficePreview[]>>({}), [images, setImages] = useState<Record<string, string>>({})
  const [overview, setOverview] = useState<'closed' | 'browse' | 'enter'>('closed'), [dismissed, setDismissed] = useState<string[]>([])
  const [optimized, setOptimized] = useState(true)
  const frames = useRef(new Map<string, HTMLIFrameElement>()), trigger = useRef<HTMLButtonElement>(null)
  const imageUrls = useRef(new Map<string, string>())
  const wasOverviewOpen = useRef(false)
  const [visitedFrameIds, setVisitedFrameIds] = useState(() => [sceneRelayUrl() ? formalFrame : officeKey(false, locals[0].id)])
  const frameIds = useMemo(() => [formalFrame, ...locals.map(office => officeKey(false, office.id))]
    .filter(id => !optimized || visitedFrameIds.includes(id)), [locals, optimized, visitedFrameIds])
  const open = overview !== 'closed'
  const localLayout = readOfficeShell()
  const localPreviews = useMemo(() => locals.map(office => localOfficePreview(office, localLayout)), [locals, localLayout])
  const offices = [
    ...(reports[formalFrame]?.length ? reports[formalFrame] : [formalPlaceholder(!!sceneRelayUrl())]),
    ...localPreviews.map(office => reports[office.frameId]?.[0] ?? office),
  ]
  const current = offices.find(office => office.id === selected) ?? (selected.startsWith('connected:') ? offices[0] : offices.find(office => !office.connected)) ?? offices[0]
  const activeFrame = (optimized ? overview !== 'browse' : !open) ? current.frameId : undefined
  const sampling = !optimized && open
  const running = offices.filter(office => office.activity.running).length, pending = offices.reduce((sum, office) => sum + office.decisionCount, 0)
  const command = (frameId: string, value: FrameCommand) => frames.current.get(frameId)?.contentWindow?.postMessage({ scope: frameScope, frameId, command: value }, location.origin)
  const selectOffice = (office: OfficePreview, decisions = false) => {
    select(office.id)
    setVisitedFrameIds(ids => ids.includes(office.frameId) ? ids : [...ids, office.frameId])
    if (open) setOverview('enter')
    command(office.frameId, { type: decisions ? 'decisions' : 'select', officeId: office.rawId })
  }
  const toggleOptimization = () => {
    if (!optimized) {
      setReports(current => Object.fromEntries(Object.entries(current).map(([id, offices]) => [
        id, visitedFrameIds.includes(id) ? offices : offices.map(office => ({ ...office, ready: false })),
      ])))
    }
    setOptimized(!optimized)
  }
  useEffect(() => {
    const urls = imageUrls.current
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.data?.scope !== frameScope) return
      const { frameId, report } = event.data as { frameId: string; report: FrameReport }
      if (!report || event.source !== frames.current.get(frameId)?.contentWindow) return
      if (report.type === 'state') setReports(current => ({ ...current, [frameId]: report.offices }))
      if (report.type === 'image') {
        const previous = urls.get(report.officeId)
        const image = typeof report.image === 'string' ? report.image : URL.createObjectURL(report.image)
        if (typeof report.image === 'string') urls.delete(report.officeId)
        else urls.set(report.officeId, image)
        setImages(current => ({ ...current, [report.officeId]: image }))
        if (previous) URL.revokeObjectURL(previous)
      }
    }
    window.addEventListener('message', receive)
    return () => {
      window.removeEventListener('message', receive)
      urls.forEach(url => URL.revokeObjectURL(url)); urls.clear()
    }
  }, [])
  useEffect(() => {
    const sync = () => frameIds.forEach(frameId => {
      const active = frameId === activeFrame
      command(frameId, { type: 'view', active, rendering: !optimized || active, sampling })
    })
    sync(); const timer = setInterval(sync, 1000); return () => clearInterval(timer)
  }, [frameIds, activeFrame, optimized, sampling])
  useEffect(() => {
    if (wasOverviewOpen.current && !open) trigger.current?.focus()
    wasOverviewOpen.current = open
  }, [open])
  const background = offices.filter(office => office.id !== current.id && office.decisionCount > 0)
  const notice = background.find(office => !dismissed.includes(`${office.id}:${office.pendingDecision?.id}`))
  const label = `办公室总览，${running} 个运行中，共 ${offices.length} 个办公室${pending ? `，${pending} 项待确认` : ''}`
  return <div className="conference-workspace">
    <div className="conference-frames">{frameIds.map(frameId => <iframe key={frameId} ref={frame => { if (frame) frames.current.set(frameId, frame); else frames.current.delete(frameId) }}
      src={frameUrl(frameId)} title={frameId === formalFrame ? '正式办公室' : locals.find(office => officeKey(false, office.id) === frameId)?.name}
      className="conference-office-frame" data-active={frameId === current.frameId || undefined} aria-hidden={frameId !== current.frameId || open}
      inert={frameId !== current.frameId || open} onLoad={() => {
        const active = frameId === activeFrame
        command(frameId, { type: 'view', active, rendering: !optimized || active, sampling })
      }} />)}</div>
    <span className="conference-current-source" data-connected={current.connected || undefined}>{current.connected ? `正式连接 · ${current.connection}` : '本地演示'}</span>
    {current.activity.running && <div className="dispatch-running-frame" aria-hidden="true" />}
    <button ref={trigger} type="button" className="dispatch-ring-button" data-running={running > 0 || undefined} aria-label={label} title={label}
      aria-expanded={open} aria-haspopup="dialog" onClick={() => setOverview('browse')}><span aria-hidden="true" data-wide={`${running}/${offices.length}`.length > 5 || undefined}>{running}/{offices.length}</span>{pending > 0 && <i className="dispatch-attention-dot" aria-hidden="true" />}</button>
    {!open && notice && <TeamDecisionNotice key={`${notice.id}:${notice.pendingDecision?.id}`} team={{ ...notice, sceneLabel: '办公室' } as OfficeTeamOption} otherCount={background.length - 1}
      onDismiss={() => setDismissed(values => [...values, `${notice.id}:${notice.pendingDecision?.id}`])} onOpen={() => selectOffice(notice, true)}
      onResolve={(decisionId, choiceId, customText) => command(notice.frameId, { type: 'resolve', officeId: notice.rawId, decisionId, choiceId, customText })} />}
    {open && <OfficeOverview offices={offices} images={images} selectedId={current.id} onSelect={selectOffice} trigger={trigger}
      livePreviews={!optimized} onToggleLivePreviews={toggleOptimization} onClose={() => setOverview('closed')} />}
  </div>
}

export default function ConferenceWorkspace() {
  const query = new URLSearchParams(location.search), frameId = query.get(frameParameter)
  if (query.get('conference') === '0' || query.get('whiteboard-demo') === '1') return <App />
  if (frameId === formalFrame) return <ConnectedOfficeFrame />
  if (frameId) return <LocalOfficeFrame frameId={frameId} />
  return <MultiOfficeWorkspace />
}
