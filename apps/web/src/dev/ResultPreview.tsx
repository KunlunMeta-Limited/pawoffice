import { useEffect, useMemo, useState } from 'react'
import { Braces, Check, Copy, Download, LoaderCircle, RotateCcw, X } from 'lucide-react'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import type { OfficeResult } from '@pawoffice/protocol/office-ui'
import { resultFileBase, resultStatusLabels } from '../results/format.ts'
import { ResultWorkspace, type WorkspaceTab } from '../components/ResultWorkspace.tsx'
import { parseResultPreviewPayload, resultPreviewMockUrl, resultPreviewStatuses } from './resultPreviewData.ts'
import type { ResultPreviewCase } from './resultPreviewData.ts'
import '../components/WhiteboardReader.css'
import './ResultPreview.css'

type PreviewView = WorkspaceTab

function initialView(): PreviewView {
  const value = new URLSearchParams(location.search).get('view')
  return value === 'board' || value === 'process' ? 'process' : value === 'detail' || value === 'deliverables' ? 'deliverables' : 'overview'
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([stringifyDocumentObject(value, 2)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ResultPreview() {
  const [cases, setCases] = useState<ResultPreviewCase[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [caseId, setCaseId] = useState(() => new URLSearchParams(location.search).get('case') ?? '')
  const [status, setStatus] = useState<OfficeResult['status']>('verified')
  const [view, setView] = useState<PreviewView>(initialView)
  const [dataOpen, setDataOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let active = true
    setCases(null); setLoadError(null)
    fetch(`${import.meta.env.BASE_URL}mock/result-preview.json`, { headers: { accept: 'application/json' } })
      .then(async response => {
        if (!response.ok) throw new Error(`mock 数据请求失败（${response.status}）`)
        return parseResultPreviewPayload(await response.json())
      })
      .then(value => {
        if (!active) return
        setCases(value)
        setCaseId(previous => value.some(item => item.id === previous) ? previous : value[0].id)
      })
      .catch(error => {
        if (!active) return
        const message = error instanceof TypeError ? '无法连接 mock 数据接口，请确认开发服务器已启动' : error instanceof Error ? error.message : String(error)
        setLoadError(message)
      })
    return () => { active = false }
  }, [reloadKey])

  const current = cases ? cases.find(item => item.id === caseId) ?? cases[0] : undefined
  useEffect(() => { if (current) setStatus(current.result.status) }, [current])

  const result = useMemo<OfficeResult | null>(() => current ? { ...current.result, status } : null, [current, status])
  const board = useMemo(() => current && result ? { ...current.board, result } : null, [current, result])
  const switchView = (next: PreviewView) => {
    setView(next)
    const url = new URL(location.href)
    if (next === 'overview') url.searchParams.delete('view')
    else url.searchParams.set('view', next)
    history.replaceState(null, '', url)
  }
  const download = () => {
    if (!board || !result) return
    downloadJson(resultFileBase(result) + '-whiteboard.json', board)
  }
  const selectCase = (id: string) => {
    setCaseId(id)
    const nextView: PreviewView = 'overview'
    setView(nextView)
    const url = new URL(location.href)
    url.searchParams.set('case', id)
    if (nextView === 'overview') url.searchParams.delete('view')
    else url.searchParams.set('view', nextView)
    history.replaceState(null, '', url)
  }
  const copyData = async () => {
    if (!board) return
    try {
      await navigator.clipboard.writeText(JSON.stringify({ source: resultPreviewMockUrl, case: current?.id, whiteboard: board }, null, 2))
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    } catch { setCopied(false) }
  }
  return <div className="result-preview-page">
    <div className="result-preview-bar">
      <div className="result-preview-title"><span>成果阅读页</span><small>Mock 数据驱动 · 仅开发环境</small></div>
      <div className="result-preview-cases" role="group" aria-label="任务样例">
        {cases ? cases.map(item => <button key={item.id} type="button" aria-pressed={item.id === current?.id} onClick={() => selectCase(item.id)}>{item.label}</button>)
          : <span className="result-preview-mock-label">{loadError ? 'mock 数据加载失败' : 'mock 数据加载中…'}</span>}
      </div>
      <button type="button" className="result-preview-data-toggle" aria-pressed={dataOpen} disabled={!board} onClick={() => setDataOpen(open => !open)}><Braces size={14} />{dataOpen ? '收起数据' : '查看驱动数据'}</button>
    </div>
    <div className="result-preview-subbar">
      <p className="result-preview-source">数据源：<code>{resultPreviewMockUrl}</code>{current && <span> · {current.description}</span>}</p>
      {current && <div className="result-preview-statuses" role="group" aria-label="成果状态">
        {resultPreviewStatuses.map(item => <button key={item} type="button" aria-pressed={item === status} onClick={() => setStatus(item)}>{resultStatusLabels[item]}</button>)}
      </div>}
    </div>
    {!current || !board || !result
      ? <div className={`result-preview-message${loadError ? ' is-error' : ''}`} role={loadError ? 'alert' : 'status'}>
        {loadError ? <><p>{loadError}</p><button type="button" onClick={() => setReloadKey(value => value + 1)}><RotateCcw size={14} />重新加载 mock 数据</button></>
          : <><LoaderCircle size={20} className="is-spin" /><p>正在读取 mock 数据…</p><small>{resultPreviewMockUrl}</small></>}
      </div>
      : <div className="whiteboard-reader result-preview-panel is-result">
        <header>
          <div className="whiteboard-reader-heading"><h2>当前成果</h2></div>
          <div className="whiteboard-reader-actions">
            <button type="button" aria-label="下载完整成果与白板数据" title="下载完整成果与白板数据" onClick={download}><Download size={18} /></button>
            <button type="button" aria-label="关闭" title="关闭" onClick={() => window.location.assign(import.meta.env.BASE_URL)}><X size={20} /></button>
          </div>
        </header>
        <article className="whiteboard-reader-content is-result" aria-label="当前成果内容">
          <ResultWorkspace key={current.id} board={board} result={result} initialTab={view} onTabChange={switchView} />
        </article>
      </div>}
    {dataOpen && board && current && <aside className="result-preview-data" aria-label="驱动数据">
      <header><div><strong>Mock 驱动数据</strong><small>{resultPreviewMockUrl} · {current.id}</small></div>
        <div><button type="button" onClick={() => setReloadKey(value => value + 1)}><RotateCcw size={14} />重新加载</button>
          <button type="button" onClick={() => { void copyData() }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button>
          <button type="button" aria-label="关闭数据" onClick={() => setDataOpen(false)}><X size={16} /></button></div>
      </header>
      <pre>{JSON.stringify({ source: resultPreviewMockUrl, case: current.id, whiteboard: board }, null, 2)}</pre>
    </aside>}
  </div>
}
