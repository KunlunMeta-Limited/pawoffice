// Temporary browser composition. Remove this directory and restore main.tsx's App import.
// These messages stay inside this page; they never enter the backend transport.
import type { DashboardConversation, DashboardSnapshot } from '@pawoffice/protocol/dashboard'
import type { OfficeLayoutId } from '@pawoffice/protocol/office-integration'
import { browserPersistence } from '@pawoffice/runtime/adapters/storage'
import { createReferenceOfficeWorld } from '@pawoffice/scene-office/core'
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
import { ConferenceChatSource } from './ConferenceChatSource.ts'
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
  initialized?: boolean
  decisionSubmittingId?: string; decisionError?: string
}
export type FrameCommand =
  | { type: 'view'; active: boolean; rendering: boolean; sampling: boolean }
  | { type: 'select' | 'decisions'; officeId: string }
  | { type: 'resolve'; officeId: string; decisionId: string; choiceId: string; customText?: string }
export type FrameReport =
  | { type: 'state'; offices: OfficePreview[] }
  | { type: 'image'; officeId: string; image: Blob | string }

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
  const demo = scenario ? new ScenarioDemoSource(runtime, scenario, () => session) : undefined
  // Keep the five existing scenarios' archives. The three replacements use
  // a separate key so they don't restore the classic commerce conversations.
  const historyKey = office.id.startsWith('office-demo-') ? 'commerce-demo-v1' : undefined
  const chatSource = demo ? new ConferenceChatSource(request => demo.reply(request), historyKey) : new PreviewChatSource()
  const simulation = demo ? new OfficeSimulation(runtime, demo, { idleCoffee: {} }) : undefined
  const session: OfficeTeamSession = new OfficeTeamSession(runtime, source, {
    chatSource, simulation, decisionPreview: !scenario,
    chatPersistence: storage ? browserChatPersistence(office.id, chatSource.historyKey) : undefined,
  })
  return session
}

// Match the local frame, which owns and advances a single office session.
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

const localAppearances = Object.fromEntries(createReferenceOfficeWorld().actors.map(actor => [actor.id, actor.templateId]))

export function localOfficePreview(office: OfficeTeamDefinition, layout: OfficeLayoutId): OfficePreview {
  const { id, name, source } = office
  const frameId = officeKey(false, id)
  const conversations = source.getConversations?.() ?? []
  const [conversation] = conversations
  const dashboard: DashboardSnapshot | null = conversation ? {
    schemaVersion: '1.0', workspace: { id, name }, conversationId: conversation.id,
    employees: conversation.employees, tasks: conversation.tasks, events: conversation.events, whiteboard: conversation.whiteboard,
  } : null
  return {
    id: frameId, frameId, rawId: id, name, connected: false, connection: '本地示例',
    dashboard, layout, appearances: localAppearances, conversationTitle: conversation?.title ?? '',
    activity: officeActivity(conversations, dashboard), decisionCount: 0, ready: false,
  }
}

// Live mode uses the original synchronous thumbnail encoding for comparison.
export async function captureScene(signal: AbortSignal, live: boolean): Promise<Blob | string | undefined> {
  const source = document.querySelector<HTMLCanvasElement>('.office-render-surface canvas')
  if (!source?.width || !source.height || document.hidden || document.querySelector('.office-loading, .office-stage[inert]')) return
  const canvas = document.createElement('canvas'), scale = Math.min(1, 640 / source.width)
  canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return
  return new Promise(resolve => {
    let frame = 0, attempts = 0
    const finish = (image?: Blob | string) => {
      cancelAnimationFrame(frame); clearTimeout(timeout)
      signal.removeEventListener('abort', cancel)
      resolve(image)
    }
    const cancel = () => finish()
    const timeout = setTimeout(cancel, 350)
    const sample = () => {
      if (!source.isConnected) { finish(); return }
      try {
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(source, 0, 0, canvas.width, canvas.height)
        // WebGL clears its back buffer after presenting. Retry on an empty frame.
        const pixel = context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data
        if (pixel[3] && (pixel[0] || pixel[1] || pixel[2])) {
          if (live) finish(canvas.toDataURL('image/webp', .72))
          else canvas.toBlob(image => finish(image ?? undefined), 'image/webp', .72)
        } else if (++attempts < 12) frame = requestAnimationFrame(sample)
        else finish()
      } catch { finish() }
    }
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    else frame = requestAnimationFrame(sample)
  })
}
