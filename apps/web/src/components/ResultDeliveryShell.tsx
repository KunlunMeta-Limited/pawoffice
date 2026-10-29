import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, History, LoaderCircle } from 'lucide-react'
import type { OfficeResult, ResultArtifact, ResultDelivery, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { resultDeliverySchema } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { formatResultTimestamp } from '../results/format.ts'
import { readDeliverySnapshot } from '../results/resources.ts'
import { ResultArtifactPreview } from './ResultArtifactPreview.tsx'
import './ResultDeliveryShell.css'

const label = (delivery: ResultDelivery) => delivery.title || `第 ${delivery.sequence} 次交付`

export function ResultDeliveryShell({ board, result, children, initialDeliveryId }: {
  board: WhiteboardTaskBoardData; result: OfficeResult
  initialDeliveryId?: string
  children: (board: WhiteboardTaskBoardData, result: OfficeResult, historical: boolean, executionKnown: boolean) => ReactNode
}) {
  const deliveries = useMemo(() => (board.deliveries ?? []).map(item => resultDeliverySchema.parse(item)).sort((a, b) => b.sequence - a.sequence), [board.deliveries])
  const [selected, setSelected] = useState<ResultDelivery | null>(() => deliveries.find(item => item.id === initialDeliveryId) ?? null)
  const [missingTarget, setMissingTarget] = useState(() => Boolean(initialDeliveryId && !deliveries.some(item => item.id === initialDeliveryId)))
  const [loaded, setLoaded] = useState<{ record: ResultDelivery; snapshot?: ResultDelivery; error?: string } | null>(null)
  const [preview, setPreview] = useState<{ artifact: ResultArtifact; trigger: HTMLElement } | null>(null)
  const [retry, setRetry] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selected || selected.result) return
    const controller = new AbortController()
    readDeliverySnapshot(selected, controller.signal).then(snapshot => {
      if (!controller.signal.aborted) setLoaded({ record: selected, snapshot })
    }).catch(error => {
      if (!controller.signal.aborted) setLoaded({ record: selected, error: error instanceof Error ? error.message : '读取历史交付失败。' })
    })
    return () => controller.abort()
  }, [selected, retry])
  const resolved = selected?.result ? selected : loaded?.record === selected ? loaded.snapshot : undefined
  const error = loaded?.record === selected ? loaded.error : ''
  const historical = Boolean(selected || missingTarget)
  const viewResult = historical ? resolved?.result : result
  const viewBoard: WhiteboardTaskBoardData = resolved && viewResult ? {
    template: 'task-board-v1', title: viewResult.title || board.title, status: 'completed', steps: [],
    detail: '本次交付未提供额外任务详情。', ...resolved.board, result: viewResult,
  } : board
  const selectDelivery = (id: string) => {
    const record = deliveries.find(item => item.id === id)
    setSelected(record ?? null)
    setMissingTarget(id !== '@current' && !record)
    setLoaded(null)
    container.current?.closest('.whiteboard-reader-content')?.scrollTo(0, 0)
  }
  const versions = useMemo(() => {
    if (!preview) return []
    const entries = new Map<string, { artifact: ResultArtifact; label: string }>()
    for (const delivery of [...deliveries].reverse()) for (const artifact of delivery.result?.artifacts ?? []) {
      if (artifact.id === preview.artifact.id && artifact.versionId) entries.set(artifact.versionId, { artifact, label: `${artifact.version || artifact.versionId} · ${label(delivery)}` })
    }
    for (const artifact of resolved?.result?.artifacts ?? []) {
      if (artifact.id === preview.artifact.id && artifact.versionId) entries.set(artifact.versionId, { artifact, label: `${artifact.version || artifact.versionId} · ${selected ? label(selected) : '历史交付'}` })
    }
    const current = result.artifacts.find(artifact => artifact.id === preview.artifact.id)
    if (current?.versionId) entries.set(current.versionId, { artifact: current, label: `${current.version || current.versionId} · 当前版本` })
    return [...entries.values()]
  }, [preview, deliveries, resolved, selected, result.artifacts])
  const origin = preview ? deliveries.find(delivery => delivery.id === preview.artifact.runId) : undefined
  const newer = selected && deliveries.some(delivery => delivery.sequence > selected.sequence)

  return <ArtifactPreviewContext.Provider value={{ open: (artifact, trigger) => setPreview({ artifact, trigger }) }}>
    <div ref={container} className="result-delivery-shell">
      {(deliveries.length > 0 || missingTarget) && <div className="result-delivery-selector">
        <History size={15} aria-hidden="true" />
        <label>交付范围<select aria-label="交付轮次" value={missingTarget ? '@unavailable' : selected?.id ?? '@current'} onChange={event => selectDelivery(event.target.value)}>
          <option value="@current">当前成果 · 最新产物汇总</option>
          {missingTarget && <option value="@unavailable" disabled>指定交付暂不可用</option>}
          {selected && !deliveries.some(item => item.id === selected.id) && <option value={selected.id}>{label(selected)} · 已打开的历史</option>}
          {deliveries.map(delivery => <option key={delivery.id} value={delivery.id}>{label(delivery)} · {formatResultTimestamp(delivery.createdAt)}</option>)}
        </select></label>
        <span>{deliveries.length} 次交付</span>
      </div>}
      {selected && <div className="result-delivery-notice" role="status">
        <div><strong>历史交付 · {label(selected)}</strong><span>文档绑定当时的版本，未修改的产物可在当前成果中继续查看。</span></div>
        <button type="button" onClick={() => selectDelivery('@current')}>{newer ? '查看当前成果' : '返回当前成果'}<ArrowRight size={13} /></button>
      </div>}
      {missingTarget && <div className="result-delivery-loading"><p role="alert">该次交付不在当前会话的可用目录中，未展示其他轮次内容。</p>
        <button type="button" onClick={() => selectDelivery('@current')}>查看当前成果</button></div>}
      {selected && !viewResult && <div className="result-delivery-loading">
        {error ? <><p role="alert">{error} 没有展示其他轮次的内容。</p><button type="button" onClick={() => { setLoaded(null); setRetry(value => value + 1) }}>重新读取此交付</button></>
          : <p role="status"><LoaderCircle size={16} />正在读取指定交付…</p>}
      </div>}
      {viewResult && children(viewBoard, viewResult, historical, !historical || Boolean(resolved?.board))}
    </div>
    {preview && <ResultArtifactPreview key={JSON.stringify([preview.artifact.id, preview.artifact.versionId, preview.artifact.url])}
      artifact={preview.artifact} current={result.artifacts.find(artifact => artifact.id === preview.artifact.id)}
      versions={versions} origin={origin ? label(origin) : historical ? '历史交付' : '当前成果'} trigger={preview.trigger}
      onClose={() => setPreview(null)} onSelect={artifact => setPreview({ ...preview, artifact })} />}
  </ArtifactPreviewContext.Provider>
}
