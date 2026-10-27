import { useMemo, useState } from 'react'
import { Download, FileText, Sparkles, X } from 'lucide-react'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import { renderWhiteboardContent } from '@pawoffice/scene-office/task-board'
import { createResultDemo, createResultDemoBoard, resultDemoStatuses } from '../dashboard/resultDemo.ts'
import type { OfficeResult } from '@pawoffice/protocol/office-ui'
import { resultFileBase, resultStatusLabels } from '../results/format.ts'
import { ResultReader } from '../components/ResultReader.tsx'
import { WhiteboardBoardView } from '../components/WhiteboardBoardView.tsx'
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
  const [status, setStatus] = useState<OfficeResult['status']>('verified')
  const [view, setView] = useState<PreviewView>('result')
  const result = useMemo(() => createResultDemo(status), [status])
  const board = useMemo(() => createResultDemoBoard(status), [status])
  const boardHtml = useMemo(() => renderWhiteboardContent({ taskBoard: board }), [board])
  const showResult = view === 'result'
  const download = () => downloadJson(showResult ? `${resultFileBase(result)}-result.json` : 'whiteboard.json', showResult ? result : board)
  return <div className="result-preview-page">
    <div className="result-preview-bar">
      <div className="result-preview-title"><span>成果阅读页</span><small>前端设计预览 · 仅开发环境</small></div>
      <div className="result-preview-variants" role="group" aria-label="成果状态">
        {resultDemoStatuses.map(item => <button key={item} type="button" aria-pressed={item === status} onClick={() => setStatus(item)}>{resultStatusLabels[item]}</button>)}
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
  </div>
}
