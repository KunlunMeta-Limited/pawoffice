// Temporary browser composition. Remove this directory and restore main.tsx's App import.
// These messages stay inside this page; they never enter the backend transport.
import type { DashboardConversation, DashboardSnapshot } from '@pawoffice/protocol/dashboard'
import type { OfficeLayoutId } from '@pawoffice/protocol/office-integration'
import { browserPersistence } from '@pawoffice/runtime/adapters/storage'
import { seatStepDurationMs } from '@pawoffice/scene-office/pixi/projection'
import { OfficeTeamSession } from '../application/OfficeTeamSession.ts'
import { OfficeTeamHost } from '../application/OfficeTeamHost.ts'
import { OfficeSimulation } from '../application/OfficeSimulation.ts'
import { createOfficeRuntime } from '../application/createOfficeRuntime.ts'
import { supportsCharacterPose } from '../application/poseSupport.ts'
import { PreviewChatSource } from '../chat/sources.ts'
import { browserChatPersistence } from '../chat/persistence.ts'
import type { DecisionRequest } from '../application/decisions/DecisionSession.ts'
import type { OfficeTeamDefinition } from '../dashboard/officeDirectory.ts'
import { ScenarioDemoSource, ScenarioOfficeDataSource } from './demoScenarios.ts'

export const frameScope = 'pawoffice-temporary-overview-v1'
export const frameParameter = 'office-frame'
export const formalFrame = 'connected'
export const officeKey = (connected: boolean, id: string) => `${connected ? 'connected' : 'local'}:${id}`
export type Activity = { running: boolean; status: 'unknown' | 'attention' | 'running' | 'completed' | 'idle'; goal: string; latestActivity: string }
export type OfficePreview = {
  id: string; frameId: string; rawId: string; name: string; connected: boolean; connection: string
  dashboard: DashboardSnapshot | null; appearances: Record<string, string>; layout: OfficeLayoutId
  conversationTitle: string; activity: Activity; decisionCount: number; pendingDecision?: DecisionRequest; ready: boolean
  decisionSubmittingId?: string; decisionError?: string
}
export type FrameCommand =
  | { type: 'view'; active: boolean; sampling: boolean }
  | { type: 'select' | 'decisions'; officeId: string }
  | { type: 'resolve'; officeId: string; decisionId: string; choiceId: string; customText?: string }
export type FrameReport =
  | { type: 'state'; offices: OfficePreview[] }
  | { type: 'image'; officeId: string; image: string }

export function officeActivity(conversations: readonly Pick<DashboardConversation, 'tasks' | 'events' | 'whiteboard'>[],
  current: DashboardSnapshot | null, pending = 0, unavailable = false): Activity {
  const scopes = conversations.length ? conversations : current ? [current] : [], tasks = scopes.flatMap(scope => scope.tasks)
  const running = !unavailable && tasks.some(task => task.status === 'running')
  const attention = pending > 0 || tasks.some(task => task.status === 'blocked' || task.status === 'failed')
  const latest = scopes.flatMap(scope => scope.events).reduce<DashboardSnapshot['events'][number] | undefined>((previous, event) =>
    !previous || Date.parse(event.occurredAt) > Date.parse(previous.occurredAt) ? event : previous, undefined)
  return { running, status: unavailable || !scopes.length ? 'unknown' : attention ? 'attention' : running ? 'running'
    : tasks.length && tasks.every(task => task.status === 'completed') ? 'completed' : 'idle',
    goal: scopes.find(scope => scope.tasks.some(task => task.status === 'running'))?.whiteboard?.title || current?.whiteboard?.title || '',
    latestActivity: latest?.summary ?? '' }
}

export function localOfficeSession(office: OfficeTeamDefinition, storage?: Storage) {
  const { source } = office
  const runtime = createOfficeRuntime({
    sceneId: office.id, referenceLayout: true, supportsPose: supportsCharacterPose,
    seatStepDuration: seatStepDurationMs, persistence: storage ? browserPersistence(storage, office.id) : undefined,
  })
  const scenario = source instanceof ScenarioOfficeDataSource ? source : undefined
  const demo = scenario ? new ScenarioDemoSource(runtime, scenario) : undefined
  const chatSource = new PreviewChatSource(demo ? request => demo.reply(request) : undefined)
  const simulation = demo ? new OfficeSimulation(runtime, demo, { idleCoffee: {} }) : undefined
  return new OfficeTeamSession(runtime, source, {
    chatSource, simulation, decisionPreview: !scenario,
    chatPersistence: storage ? browserChatPersistence(office.id, chatSource.historyKey) : undefined,
  })
}

// A commerce host intentionally coordinates every office it owns. Each temporary
// demo therefore gets its own host, while retaining the original demo content.
export function independentDemoHost(session: OfficeTeamSession) {
  const host = new OfficeTeamHost()
  host.update([session])
  return host
}

export function previewOf(frameId: string, connected: boolean, office: { id: string; name: string; session: OfficeTeamSession },
  layout: OfficeLayoutId, connection?: string): OfficePreview {
  const session = office.session, state = session.getSnapshot(), chat = session.chat.getSnapshot(), decisions = session.decisions.getSnapshot(), pending = decisions.pending
  const activity = officeActivity(session.source.getConversations?.() ?? [], state.dashboard, pending.length, !!state.dashboardError)
  const demo = session.simulation.demoSource
  if (demo instanceof ScenarioDemoSource && demo.isDispatching && !state.dashboardError) {
    activity.running = true
    if (activity.status !== 'attention') activity.status = 'running'
  }
  return { id: officeKey(connected, office.id), frameId, rawId: office.id, connected, name: state.dashboard?.workspace.name ?? office.name,
    connection: connection ?? state.connection, dashboard: state.dashboard, appearances: Object.fromEntries(session.runtime.readActors().map(actor => [actor.id, actor.templateId])),
    layout, conversationTitle: chat.conversations.find(item => item.id === chat.selectedId)?.title ?? '', decisionCount: pending.length, pendingDecision: pending[0],
    decisionSubmittingId: decisions.submittingIds?.find(id => id === pending[0]?.id),
    decisionError: decisions.errorDecisionId === pending[0]?.id ? decisions.error ?? '' : '',
    activity, ready: false }
}

export function formalPlaceholder(configured: boolean, connection = '连接中'): OfficePreview {
  return { id: officeKey(true, ''), rawId: '', frameId: formalFrame, connected: true, name: '正式办公室',
    connection: !configured ? '未连接' : connection === '已连接' ? '等待初始化' : connection, dashboard: null, appearances: {}, layout: 'members',
    conversationTitle: '', activity: officeActivity([], null), decisionCount: 0, ready: true }
}

// Canvas snapshots use the live scene rather than creating/destroying preview
// Pixi applications. Separate frame realms also isolate Pixi's global pools.
export async function captureScene(): Promise<string | undefined> {
  const source = document.querySelector<HTMLCanvasElement>('.office-render-surface canvas')
  if (!source?.width || !source.height || document.querySelector('.office-loading')) return
  const canvas = document.createElement('canvas'), scale = Math.min(1, 640 / source.width)
  canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (!source.isConnected) return
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(source, 0, 0, canvas.width, canvas.height)
    // WebGL clears its back buffer after presenting. Retry on an empty frame.
    const pixel = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
    if (pixel[3] && (pixel[0] || pixel[1] || pixel[2])) return canvas.toDataURL('image/webp', .72)
  }
}
