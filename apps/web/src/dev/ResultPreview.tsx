import { useMemo, useState } from 'react'
import { Braces, Check, Copy, Download, FileText, Sparkles, X } from 'lucide-react'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import { renderWhiteboardContent } from '@pawoffice/scene-office/task-board'
import type { OfficeResult } from '@pawoffice/protocol/office-ui'
import { resultFileBase, resultStatusLabels } from '../results/format.ts'
import { ResultReader } from '../components/ResultReader.tsx'
import { WhiteboardBoardView } from '../components/WhiteboardBoardView.tsx'
import { findResultPreviewCase, resultPreviewCases, resultPreviewStatuses } from './resultPreviewData.ts'
import '../components/WhiteboardReader.css'
import './ResultPreview.css'

type PreviewView = 'board' | 'result'

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([stringifyDocumentObject(value, 2)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ResultPreview() {
  const initialCase = findResultPreviewCase(new URLSearchParams(location.search).get('case'))
  const [caseId, setCaseId] = useState(initialCase.id)
  const [status, setStatus] = useState<OfficeResult['status']>(initialCase.result.status)
  const [view, setView] = useState<PreviewView>('result')
  const [dataOpen, setDataOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const current = findResultPreviewCase(caseId)
  const result = useMemo<OfficeResult>(() => ({ ...current.result, status }), [current, status])
  const board = useMemo(() => ({ ...current.board, result }), [current.board, result])
  const boardHtml = useMemo(() => renderWhiteboardContent({ taskBoard: board }), [board])
  const showResult = view === 'result'
  const download = () => downloadJson(showResult ? `${resultFileBase(result)}-result.json` : 'whiteboard.json', showResult ? result : board)
  const selectCase = (id: string) => {
    const next = findResultPreviewCase(id)
    setCaseId(next.id); setStatus(next.result.status); setView('result')
    const url = new URL(location.href)
    url.searchParams.set('case', next.id)
    history.replaceState(null, '', url)
  }
  const copyData = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ whiteboard: board }, null, 2))
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    } catch { setCopied(false) }
  }
  return <div className="result-preview-page">
    <div className="result-preview-bar">
      <div className="result-preview-title"><span>成果阅读页</span><small>数据驱动预览 · 仅开发环境</small></div>
      <div className="result-preview-cases" role="group" aria-label="任务样例">
        {resultPreviewCases.map(item => <button key={item.id} type="button" aria-pressed={item.id === caseId} onClick={() => selectCase(item.id)}>{item.label}</button>)}
      </div>
      <button type="button" className="result-preview-data-toggle" aria-pressed={dataOpen} onClick={() => setDataOpen(open => !open)}><Braces size={14} />{dataOpen ? '收起数据' : '查看驱动数据'}</button>
    </div>
    <div className="result-preview-subbar">
      <p>{current.description}</p>
      <div className="result-preview-statuses" role="group" aria-label="成果状态">
        {resultPreviewStatuses.map(item => <button key={item} type="button" aria-pressed={item === status} onClick={() => setStatus(item)}>{resultStatusLabels[item]}</button>)}
      </div>
    </div>
    <div className={`whiteboard-reader result-preview-panel${showResult ? ' is-result' : ''}`} data-view={showResult ? 'result' : 'board'}>
      <header>
        <div className="whiteboard-reader-heading">
          <h2 title={showResult ? result.title : board.detail ? '白板详情' : '协作白板'}>{showResult ? result.title : board.detail ? '白板详情' : '协作白板'}</h2>
          <div className="whiteboard-reader-switch" role="tablist" aria-label="白板视图">
            <button type="button" role="tab" aria-selected={!showResult} tabIndex={showResult ? -1 : 0} onClick={() => setView('board')}><FileText size={13} strokeWidth={2} />任务白板</button>
            <button type="button" role="tab" aria-selected={showResult} tabIndex={showResult ? 0 : -1} onClick={() => setView('result')}><Sparkles size={13} strokeWidth={2} />成果</button>
          </div>
        </div>
        <div className="whiteboard-reader-actions">
          <button type="button" aria-label={showResult ? '下载成果数据' : '下载白板数据'} title={showResult ? '下载成果数据' : '下载白板数据'} onClick={download}><Download size={18} /></button>
          <button type="button" aria-label="关闭" title="关闭" onClick={() => window.location.assign(import.meta.env.BASE_URL)}><X size={20} /></button>
        </div>
      </header>
      <article className={`whiteboard-reader-content${showResult ? ' is-result' : ''}`} tabIndex={0} aria-label={showResult ? '成果内容' : '白板内容'}>
        {showResult ? <ResultReader result={result} onOpenBoard={() => setView('board')} /> : <WhiteboardBoardView detail={board.detail ?? ''} html={boardHtml} />}
      </article>
    </div>
    {dataOpen && <aside className="result-preview-data" aria-label="驱动数据">
      <header><div><strong>驱动数据</strong><small>当前成果页读取的结构化数据</small></div>
        <div><button type="button" onClick={() => { void copyData() }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button>
          <button type="button" aria-label="关闭数据" onClick={() => setDataOpen(false)}><X size={16} /></button></div>
      </header>
      <pre>{JSON.stringify({ whiteboard: board }, null, 2)}</pre>
    </aside>}
  </div>
}
