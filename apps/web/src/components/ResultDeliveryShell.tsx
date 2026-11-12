import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import type { OfficeResult, ResultArtifact, ResultDelivery, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { resultDeliverySchema } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { formatResultTimestamp } from '../results/format.ts'
import { readDeliverySnapshot } from '../results/resources.ts'
import { artifactPreviewSections } from '../results/sections.ts'
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
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [catalog, setCatalog] = useState<{ records: ResultDelivery[]; retry: number; snapshots: ResultDelivery[]; failed: number } | null>(null)
  const previewId = preview?.artifact.id
  const container = useRef<HTMLDivElement>(null)
  // The file menu remains a history entry even when chat messages have not loaded.
  // Only read backend-owned snapshot metadata when a file preview is open.
  useEffect(() => {
    if (!previewId || catalog?.records === deliveries && catalog.retry === catalogRetry) return
    const external = deliveries.filter(delivery => !delivery.result)
    if (!external.length) return
    const controller = new AbortController()
    const snapshots: ResultDelivery[] = []
    let cursor = 0, failed = 0
    const worker = async () => {
      while (cursor < external.length && !controller.signal.aborted) {
        const record = external[cursor++]
        try { snapshots.push(await readDeliverySnapshot(record, controller.signal)) }
        catch { if (!controller.signal.aborted) failed++ }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, external.length) }, worker)).then(() => {
      if (!controller.signal.aborted) setCatalog({ records: deliveries, retry: catalogRetry, snapshots, failed })
    })
    return () => controller.abort()
  }, [previewId, deliveries, catalog, catalogRetry])
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
    ...resolved.board, result: viewResult,
  } : board
  const returnToCurrent = () => {
    setSelected(null)
    setMissingTarget(false)
    setLoaded(null)
    container.current?.closest('.whiteboard-reader-content')?.scrollTo(0, 0)
  }
  const catalogReady = catalog?.records === deliveries && catalog.retry === catalogRetry
  const knownDeliveries = useMemo(() => deliveries.map(delivery => delivery.result ? delivery
    : (catalog?.records === deliveries ? catalog.snapshots.find(snapshot => snapshot.id === delivery.id) : undefined) ?? delivery), [deliveries, catalog])
  const versions = useMemo(() => {
    if (!preview) return []
    const entries = new Map<string, { artifact: ResultArtifact; label: string }>()
    for (const delivery of [...knownDeliveries].reverse()) for (const artifact of delivery.result?.artifacts ?? []) {
      if (artifact.id === preview.artifact.id && artifact.versionId) entries.set(artifact.versionId, { artifact, label: `${artifact.version || artifact.versionId} · ${label(delivery)}` })
    }
    for (const artifact of resolved?.result?.artifacts ?? []) {
      if (artifact.id === preview.artifact.id && artifact.versionId) entries.set(artifact.versionId, { artifact, label: `${artifact.version || artifact.versionId} · ${selected ? label(selected) : '历史交付'}` })
    }
    if (preview.artifact.versionId && !entries.has(preview.artifact.versionId)) entries.set(preview.artifact.versionId, {
      artifact: preview.artifact, label: `${preview.artifact.version || preview.artifact.versionId} · 正在查看`,
    })
    const current = result.artifacts.find(artifact => artifact.id === preview.artifact.id)
    if (current?.versionId) entries.set(current.versionId, { artifact: current, label: `${current.version || current.versionId} · 当前版本` })
    return [...entries.values()]
  }, [preview, knownDeliveries, resolved, selected, result.artifacts])
  const origin = preview ? deliveries.find(delivery => delivery.id === preview.artifact.runId) : undefined
  const selectId = useId()
  const selectDelivery = (id: string) => {
    if (!id) { returnToCurrent(); return }
    const delivery = deliveries.find(item => item.id === id)
    if (!delivery) return
    setMissingTarget(false)
    setLoaded(null)
    setSelected(delivery)
    requestAnimationFrame(() => container.current?.closest('.whiteboard-reader-content')?.scrollTo(0, 0))
  }
  const previewSections = preview ? artifactPreviewSections([viewResult,
    knownDeliveries.find(delivery => delivery.id === preview.artifact.runId)?.result,
    ...knownDeliveries.map(delivery => delivery.result), result], preview.artifact) : []

  return <ArtifactPreviewContext.Provider value={{ open: (artifact, trigger) => setPreview({ artifact, trigger }) }}>
    <div ref={container} className="result-delivery-shell">
      {deliveries.length > 1 && <div className="result-delivery-switch">
        <label htmlFor={selectId}>交付历史</label>
        <select id={selectId} value={selected?.id ?? ''} onChange={event => selectDelivery(event.target.value)}>
          <option value="">当前成果</option>
          {deliveries.map(delivery => <option key={delivery.id} value={delivery.id}>{label(delivery)}</option>)}
        </select>
      </div>}
      {selected && <div className="result-delivery-notice" role="status">
        <div><strong>历史交付 · {label(selected)}</strong><span>{formatResultTimestamp(selected.createdAt)} · 文档固定为当时版本。</span></div>
        <button type="button" onClick={returnToCurrent}>返回当前成果<ArrowRight size={13} /></button>
      </div>}
      {missingTarget && <div className="result-delivery-loading"><p role="alert">该次交付不在当前会话的可用目录中，未展示其他轮次内容。</p>
        <button type="button" onClick={returnToCurrent}>查看当前成果</button></div>}
      {selected && !viewResult && <div className="result-delivery-loading">
        {error ? <><p role="alert">{error} 没有展示其他轮次的内容。</p><button type="button" onClick={() => { setLoaded(null); setRetry(value => value + 1) }}>重新读取此交付</button></>
          : <p role="status"><LoaderCircle size={16} />正在读取指定交付…</p>}
      </div>}
      {viewResult && children(viewBoard, viewResult, historical, !historical || Boolean(resolved?.board))}
    </div>
    {preview && <ResultArtifactPreview key={JSON.stringify([preview.artifact.id, preview.artifact.versionId, preview.artifact.url])}
      artifact={preview.artifact} current={result.artifacts.find(artifact => artifact.id === preview.artifact.id)}
      sections={previewSections}
      catalogLoading={deliveries.some(delivery => !delivery.result) && !catalogReady}
      catalogFailed={catalogReady ? catalog.failed : 0} onRetryCatalog={() => setCatalogRetry(value => value + 1)}
      versions={versions} origin={origin ? label(origin) : historical ? '历史交付' : '当前成果'} trigger={preview.trigger}
      onClose={() => setPreview(null)} onSelect={artifact => setPreview({ ...preview, artifact })} />}
  </ArtifactPreviewContext.Provider>
}
