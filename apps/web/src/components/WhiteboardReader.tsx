import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Download, FileText, Sparkles, X } from 'lucide-react'
import { whiteboardTaskBoard } from '@pawoffice/scene-office/whiteboard'
import type { WhiteboardProgress } from '@pawoffice/scene-office/whiteboard'
import { renderWhiteboardContent } from '@pawoffice/scene-office/task-board'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import { officeResultSchema } from '@pawoffice/protocol/office-ui'
import { WhiteboardDetail } from './WhiteboardDetail.tsx'
import { ResultReader } from './ResultReader.tsx'
import { resultFileBase, resultHasContent } from '../results/format.ts'
import './WhiteboardReader.css'

type ReaderView = 'board' | 'result'

export function WhiteboardReader({ state, boardId, progress, onClose }: { state: Record<string, unknown>; boardId: string; progress: WhiteboardProgress; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLElement>(null)
  const boardTab = useRef<HTMLButtonElement>(null)
  const resultTab = useRef<HTMLButtonElement>(null)
  const serialized = JSON.stringify(state)
  const board = useMemo(() => whiteboardTaskBoard(JSON.parse(serialized)), [serialized])
  const result = useMemo(() => board?.result ? officeResultSchema.parse(board.result) : undefined, [board])
  const hasResult = resultHasContent(result)
  const completed = board?.status === 'completed'
  const [view, setView] = useState<ReaderView>(() => resultHasContent(result) && board?.status === 'completed' ? 'result' : 'board')
  const showResult = view === 'result' && hasResult && Boolean(board)
  const detail = board?.detail?.trim() ? board.detail : ''
  const [frame, setFrame] = useState(0)
  const html = useMemo(() => {
    void frame
    return renderWhiteboardContent(board ? { taskBoard: progress.project(boardId, board) } : {})
  }, [board, boardId, progress, frame])

  // A goal that finishes while the board is open reveals its result once; manual switches are preserved.
  const autoRevealed = useRef(false)
  useEffect(() => {
    if (!completed || !hasResult) { autoRevealed.current = false; return }
    if (autoRevealed.current) return
    autoRevealed.current = true
    setView('result')
  }, [completed, hasResult])
  useEffect(() => {
    if (showResult || detail || board?.status !== 'running') return
    const timer = setInterval(() => setFrame(value => value + 1), 250)
    return () => clearInterval(timer)
  }, [board?.status, detail, showResult])
  // Live updates should not interrupt someone reading farther down the board.
  useEffect(() => { content.current?.scrollTo(0, 0) }, [boardId])
  useEffect(() => { content.current?.scrollTo(0, 0) }, [view])
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { element.close() }
  }, [])

  const switchView = (next: ReaderView) => {
    setView(next)
    requestAnimationFrame(() => (next === 'result' ? resultTab : boardTab).current?.focus())
  }
  const onTabKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      switchView(showResult ? 'board' : 'result')
    }
    if (event.key === 'Home') { event.preventDefault(); switchView('board') }
    if (event.key === 'End') { event.preventDefault(); switchView('result') }
  }
  const download = () => {
    if (!board) return
    const value = showResult && result ? result : board
    const filename = showResult && result ? `${resultFileBase(result)}-result.json` : 'whiteboard.json'
    const url = URL.createObjectURL(new Blob([stringifyDocumentObject(value, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = filename; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const title = showResult ? (result?.title || '成果阅读') : detail ? '白板详情' : '协作白板'
  return <dialog className={`whiteboard-reader${showResult ? ' is-result' : ''}`} ref={dialog} aria-labelledby="whiteboard-reader-title" data-view={showResult ? 'result' : 'board'} onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }}>
    <header>
      <div className="whiteboard-reader-heading">
        <h2 id="whiteboard-reader-title" title={title}>{title}</h2>
        {hasResult && <div className="whiteboard-reader-switch" role="tablist" aria-label="白板视图" onKeyDown={onTabKeyDown}>
          <button ref={boardTab} type="button" role="tab" aria-selected={!showResult} tabIndex={showResult ? -1 : 0} onClick={() => switchView('board')}><FileText size={13} strokeWidth={2} />任务白板</button>
          <button ref={resultTab} type="button" role="tab" aria-selected={showResult} tabIndex={showResult ? 0 : -1} onClick={() => switchView('result')}><Sparkles size={13} strokeWidth={2} />成果</button>
        </div>}
      </div>
      <div className="whiteboard-reader-actions">
        <button type="button" aria-label={showResult ? '下载成果数据' : '下载白板数据'} title={showResult ? '下载成果数据' : '下载白板数据'} disabled={!board} onClick={download}><Download size={18} /></button>
        <button type="button" aria-label="关闭白板" title="关闭白板" onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    <article className={`whiteboard-reader-content${showResult ? ' is-result' : ''}`} ref={content} tabIndex={0} aria-label={showResult ? '成果内容' : '白板内容'}>
      {showResult && result ? <ResultReader result={result} onOpenBoard={() => switchView('board')} /> : detail ? <WhiteboardDetail content={detail} /> : <div className="whiteboard-reader-fallback" dangerouslySetInnerHTML={{ __html: html }} />}
    </article>
  </dialog>
}
