import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { OfficeScene, type OfficeAgentClick, type SceneLoadProgress, type SceneActionProgress } from '../application/OfficeScene.ts'
import type { Agent } from '@pawoffice/scene-office/types'
import type { SceneRuntime } from '@pawoffice/runtime/SceneRuntime'
import type { MapFurniture } from '../components/map-editor/commands.ts'
import { SceneHost } from '../../../shared/scene/SceneHost.ts'
import type { OfficeSimulation } from '../application/OfficeSimulation.ts'
import type { DashboardSnapshot } from '@pawoffice/protocol/dashboard'
import { officeActorTasks } from '../dashboard/actorTasks.ts'
import { WhiteboardProgress, whiteboardTaskBoard } from '@pawoffice/scene-office/whiteboard'

type AgentMenuState = {
  agent: Agent
  rosterNo: number
  x: number
  y: number
  agents: Agent[]
  pickingTarget: boolean
}

export function useOfficeSceneController(runtime: SceneRuntime, covered = false, simulation?: OfficeSimulation, dashboard: DashboardSnapshot | null = null, onInspect?: (actorId: string) => void, suppliedWhiteboardProgress?: WhiteboardProgress, onSelectActor?: (actorId: string) => boolean) {
  useSyncExternalStore(runtime.subscribe, runtime.getRevision)
  const [host] = useState(() => new SceneHost())
  const whiteboardProgress = useMemo(() => { void runtime; return suppliedWhiteboardProgress ?? new WhiteboardProgress() }, [runtime, suppliedWhiteboardProgress])
  const sceneRef = useRef<OfficeScene | null>(null)
  const selectionHandler = useRef(onSelectActor)
  useEffect(() => { selectionHandler.current = onSelectActor }, [onSelectActor])
  const tasks = useMemo(() => officeActorTasks(dashboard), [dashboard])
  const tasksRef = useRef(tasks)
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  const readyRef = useRef(false)
  const [menu, setMenu] = useState<AgentMenuState | null>(null)
  const readerScope = JSON.stringify([runtime.sceneId, dashboard?.conversationId ?? ''])
  const readerScopeRef = useRef(readerScope)
  useLayoutEffect(() => { readerScopeRef.current = readerScope }, [readerScope])
  const [reader, setReader] = useState<{ scope: string; boardId: string; deliveryId?: string } | null>(null)
  const whiteboardId = reader?.scope === readerScope ? reader.boardId : null
  const [demo, setDemo] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [progress, setProgress] = useState<SceneLoadProgress>({ completed: 0, total: 0 })
  const [actions, setActions] = useState<SceneActionProgress>({ completed: 0, total: 0, ready: false })
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({})
  const previewProp = useCallback((value?: MapFurniture) => sceneRef.current?.previewProp(value), [])
  const highlightProp = useCallback((id: string, valid: boolean) => sceneRef.current?.highlightProp(id, valid), [])

  useEffect(() => {
    const element = host.element
    setMenu(null); setReader(null); setNotice(simulation?.error ?? null); setDemo(simulation?.isDemoRunning ?? false)

    const handleAgentClick = (event: OfficeAgentClick) => {
      if (selectionHandler.current?.(event.agent.id)) { setMenu(null); return }
      if (onInspect) { onInspect(event.agent.id); return }
      const rect = element.getBoundingClientRect()
      const menuWidth = 260
      const menuHeight = Math.min(520, rect.height - 24)
      setMenu({
        agent: event.agent,
        rosterNo: event.rosterNo,
        x: Math.max(12, Math.min(event.clientX - rect.left, rect.width - menuWidth - 12)),
        y: Math.max(12, Math.min(event.clientY - rect.top, rect.height - menuHeight - 12)),
        agents: sceneRef.current?.getAgents() ?? [],
        pickingTarget: false,
      })
    }

    let active = true
    const scene = new OfficeScene({ runtime, simulation, onAgentClick: handleAgentClick, onDraftChange: setNotice, onDemoChange: setDemo,
      taskForActor: id => tasksRef.current.get(id), whiteboardProgress,
      onPropClick: event => {
        if (runtime.readWorld().props.some(prop => prop.id === event.propId && prop.templateId === 'office.wall-whiteboard')) {
          // The scope is read at click time so switching conversations does not leave a stale handler.
          setReader({ scope: readerScopeRef.current, boardId: event.propId })
        }
      },
      onLoadProgress: value => { if (active) setProgress(value) },
      onActionProgress: value => { if (active) setActions(value) } })
    sceneRef.current = scene

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width <= 0 || height <= 0) return

      if (!readyRef.current) {
        readyRef.current = true
        setLoaded(false)
        setProgress({ completed: 0, total: 0 })
        setActions({ completed: 0, total: 0, ready: false })
        void scene.init(element, width, height).then(async () => {
          if (!active) return
          setLoaded(true); setDemo(scene.isDemoRunning)
          const previews: Record<string, string> = {}
          for (const template of runtime.templates()) {
            if (!active) return
            previews[template.id] = await scene.furnitureThumbnail(template.id)
          }
          if (active) setThumbnails(previews)
        }).catch((error) => {
          console.error('[Office] 场景初始化失败', error)
          if (active) setNotice(String(error))
        })
        return
      }

      sceneRef.current?.resize(width, height)
    })

    ro.observe(element)

    return () => {
      active = false
      ro.disconnect()
      readyRef.current = false
      scene.destroy()
      sceneRef.current = null
    }
  }, [runtime, host, simulation, onInspect, whiteboardProgress])

  useEffect(() => {
    sceneRef.current?.setRenderingSuspended(covered || whiteboardId !== null)
  }, [covered, whiteboardId, loaded, runtime])

  const wallBoard = runtime.readWorld().props.find(prop => prop.templateId === 'office.wall-whiteboard')
  const dashboardBoard = dashboard?.whiteboard
    ? { id: wallBoard?.id ?? 'conversation-whiteboard', state: { taskBoard: dashboard.whiteboard } } : undefined
  const resultBoard = dashboardBoard ?? wallBoard
  const currentBoard = resultBoard ? whiteboardTaskBoard(resultBoard.state) : null
  const whiteboard = whiteboardId ? (dashboardBoard?.id === whiteboardId ? dashboardBoard : runtime.readWorld().props.find(prop => prop.id === whiteboardId)) : undefined
  return { host, sceneRef, menu, setMenu, whiteboard, currentBoard, readerScope, whiteboardProgress, initialDeliveryId: reader?.scope === readerScope ? reader.deliveryId : undefined,
    openWhiteboard: () => { if (resultBoard && currentBoard) setReader({ scope: readerScope, boardId: resultBoard.id }) },
    openDelivery: (conversationId: string, deliveryId: string) => {
      if (conversationId !== dashboard?.conversationId || !resultBoard || !currentBoard?.deliveries?.some(delivery => delivery.id === deliveryId)) return false
      setReader({ scope: readerScope, boardId: resultBoard.id, deliveryId })
      return true
    },
    closeWhiteboard: () => setReader(null), demo, setDemo, canDemo: simulation?.canDemo ?? true, notice, setNotice,
    loaded, progress, actions, thumbnails, previewProp, highlightProp }
}
export type OfficeSceneController = ReturnType<typeof useOfficeSceneController>
