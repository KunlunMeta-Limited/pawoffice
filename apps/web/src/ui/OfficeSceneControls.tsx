import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { Coffee, Grid2X2, Pause, PawPrint, Play, RotateCw, FolderOpen } from 'lucide-react'
import { officeResultSchema } from '@pawoffice/protocol/office-ui'
import { resultPresentation } from '../results/presentation.ts'
import type { AgentState } from '@pawoffice/scene-office/types'
import type { SceneRuntime } from '@pawoffice/runtime/SceneRuntime'
import type { OfficeSceneController } from '../controller/useOfficeSceneController.ts'
import { APARTMENT_EMOTES } from '../scene/characters/apartmentFrames.ts'
import { RoomEditor } from '../components/map-editor/RoomEditor.tsx'
import { MapEditorOverlay } from '../components/map-editor/MapEditorOverlay.tsx'
import { initialMapView } from '../components/map-editor/commands.ts'
import type { MapView } from '../components/map-editor/commands.ts'
import { TeamSwitcher } from './TeamSwitcher.tsx'
import type { OfficeTeamSelection } from './TeamSwitcher.tsx'

const STATE_ACTIONS: Array<{
  label: string
  state: AgentState
  task?: string
}> = [
  { label: '开始工作', state: 'working', task: '处理当前任务…' },
  { label: '进入思考', state: 'thinking', task: '思考下一步…' },
  { label: '暂时空闲', state: 'idle' },
]

export function OfficeSceneControls({ runtime, controller, mapView, setMapView, teamSelection, teamName, onTeamPickerOpenChange, teamSwitcherTarget }: {
  runtime: SceneRuntime; controller: OfficeSceneController; mapView: MapView; setMapView: Dispatch<SetStateAction<MapView>>
  teamSelection?: OfficeTeamSelection; teamName?: string; onTeamPickerOpenChange?: (open: boolean) => void
  teamSwitcherTarget?: HTMLElement | null
}) {
  const { sceneRef, menu, setMenu, demo, setDemo, canDemo, setNotice, loaded, actions, thumbnails, previewProp, highlightProp } = controller
  const resultState = controller.currentBoard
    ? resultPresentation(controller.currentBoard, officeResultSchema.parse(controller.currentBoard.result ?? {})) : null
  const editorRuntime = runtime, editor = runtime.editorSnapshot()
  const [coffee, setCoffee] = useState(true)
  const [canCoffee, setCanCoffee] = useState(false)
  const [cat, setCat] = useState(false)
  const [canCat, setCanCat] = useState(false)
  const [preparingEdit, setPreparingEdit] = useState(false)
  useEffect(() => {
    setCanCoffee(loaded && Boolean(sceneRef.current?.canIdleCoffee))
    setCanCat(loaded && Boolean(sceneRef.current?.canOfficeCat))
    if (loaded) setCoffee(sceneRef.current?.idleCoffeeEnabled ?? false)
    setCat(loaded && (sceneRef.current?.officeCatEnabled ?? false))
  }, [loaded, runtime, sceneRef])
  useEffect(() => {
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.agent-action-menu')) {
        return
      }
      setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }

    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKeyDown)
      setMenu(null)
    }
  }, [setMenu])

  const applyState = (state: AgentState, task?: string) => {
    if (!menu) return
    sceneRef.current?.setAgentState(menu.agent.id, state, task)
    setMenu(null)
  }
  const playEmote = (animation: string) => {
    if (!menu) return
    const result = sceneRef.current?.playAgentAnimation(menu.agent.id, animation)
    if (result?.error) setNotice(result.error.message)
    setMenu(null)
  }
  const startInteraction = (targetRosterNo: number, targetName: string) => {
    if (!menu || targetRosterNo === menu.rosterNo) return
    const result = sceneRef.current?.requestDeskVisit(menu.rosterNo, targetRosterNo, `${targetName}，我来和你同步一下。`)
    if (result?.error) setNotice(result.error.message)
    setMenu(null)
  }
  const edit = async () => {
    setPreparingEdit(true)
    try {
      const scene = sceneRef.current
      await scene?.prepareIdleForEditing()
      if (sceneRef.current !== scene) return
      scene?.beginEditing(); setMapView(initialMapView); setDemo(false); setMenu(null); setNotice(null)
    }
    catch (error) { setNotice(error instanceof Error ? error.message : '暂时无法编辑') }
    finally { setPreparingEdit(false) }
  }
  const toggleDemo = () => {
    try { sceneRef.current?.setDemo(!demo); setNotice(null) }
    catch (error) { setNotice(error instanceof Error ? error.message : '演示启动失败') }
  }

  return <>
      {!editor && <TeamSwitcher selection={teamSelection} fallbackName={teamName} onOpenChange={onTeamPickerOpenChange} triggerTarget={teamSwitcherTarget} />}
      {editor && editorRuntime ? <>
        <MapEditorOverlay runtime={editorRuntime} draft={editor} view={mapView} setView={setMapView} onError={setNotice} onPreview={previewProp} onHighlight={highlightProp} />
        <RoomEditor key={editor.id} runtime={editorRuntime} draft={editor} view={mapView} setView={setMapView} onError={setNotice} thumbnails={thumbnails} />
      </> : <div className="runtime-scene-toolbar">
          {resultState && <button type="button" className="office-result-entry" aria-label={`查看当前成果：${resultState.label}`}
            aria-haspopup="dialog" title={resultState.description} onClick={controller.openWhiteboard}>
            <FolderOpen size={16} aria-hidden="true" /><strong>当前成果</strong><small data-status={resultState.key}>{resultState.label}</small>
          </button>}
          <button type="button" title={preparingEdit ? '人物正在返回工位' : '编辑布局'} aria-label="编辑布局" disabled={!loaded || !actions.ready || preparingEdit} onClick={() => { void edit() }}><Grid2X2 size={17} /></button>
          {canCoffee && <button type="button" title={coffee ? '关闭空闲闲聊' : '开启空闲闲聊'} aria-label={coffee ? '关闭空闲闲聊' : '开启空闲闲聊'} aria-pressed={coffee} disabled={!actions.ready}
            onClick={() => { const enabled = !coffee; sceneRef.current?.setIdleCoffee(enabled); setCoffee(enabled) }}><Coffee size={17} /></button>}
          {canCat && <button type="button" title={cat ? '关闭办公室猫咪' : '开启办公室猫咪'} aria-label={cat ? '关闭办公室猫咪' : '开启办公室猫咪'} aria-pressed={cat}
            onClick={() => { const enabled = !cat; sceneRef.current?.setOfficeCat(enabled); setCat(enabled) }}><PawPrint size={17} aria-hidden="true" /></button>}
          {canDemo && <button type="button" title={demo ? '停止演示' : '开始演示'} aria-label={demo ? '停止演示' : '开始演示'} disabled={!loaded || !actions.ready} onClick={toggleDemo}>{demo ? <Pause size={17} /> : <Play size={17} />}</button>}
          {loaded && !actions.ready && <span role="status" title={actions.error}>{actions.error ? '互动动作加载失败' : `准备互动动作 · ${actions.completed}/${actions.total}`}</span>}
          {loaded && actions.error && <button type="button" title="重试加载互动动作" aria-label="重试加载互动动作" onClick={() => { void sceneRef.current?.prepareActions() }}><RotateCw size={16} /></button>}
      </div>}
      {menu && !editor && (
        <div
          className="agent-action-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <div className="agent-action-head">
            <span className="agent-action-name">{menu.agent.name}</span>
            <span className="agent-action-state">{menu.agent.state}</span>
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
                  {APARTMENT_EMOTES.map((action) => (
                    <button
                      key={action.animation}
                      type="button"
                      className="agent-action-chip"
                      onClick={() => playEmote(action.animation)}
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
  </>
}
