import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { whiteboardTaskBoard } from '@pawoffice/scene-office/whiteboard'
import type { WhiteboardProgress } from '@pawoffice/scene-office/whiteboard'
import { renderWhiteboardContent } from '@pawoffice/scene-office/task-board'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import type { OutputBoard, WhiteboardMode } from '@pawoffice/protocol/office-ui'
import { WhiteboardDetail } from './WhiteboardDetail.tsx'
import { ResultDocument } from './ResultDocument.tsx'
import './WhiteboardReader.css'

export function WhiteboardReader({ state, boardId, progress, mode = 'collaboration', outputBoard, onClose }: { state: Record<string, unknown>; boardId: string; progress: WhiteboardProgress; mode?: WhiteboardMode; outputBoard?: OutputBoard; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const serialized = JSON.stringify(state)
  const board = useMemo(() => whiteboardTaskBoard(JSON.parse(serialized)), [serialized])
  const detail = board?.detail?.trim() ? board.detail : ''
  const output = mode === 'output'
  const content = useRef<HTMLElement>(null)
  const [frame, setFrame] = useState(0)
  const html = useMemo(() => {
    void frame
    return renderWhiteboardContent(board ? { taskBoard: progress.project(boardId, board) } : {})
  }, [board, boardId, progress, frame])
  useEffect(() => {
    if (output || detail || board?.status !== 'running') return
    const timer = setInterval(() => setFrame(value => value + 1), 250)
    return () => clearInterval(timer)
  }, [board?.status, detail, output])
  // Live detail updates should not interrupt someone reading farther down the board.
  useEffect(() => { content.current?.scrollTo(0, 0) }, [boardId])
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => { element.close() }
  }, [])
  const download = () => {
    const data = output ? outputBoard : board
    if (!data) return
    const url = URL.createObjectURL(new Blob([stringifyDocumentObject(data, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = output ? 'office-results.json' : 'whiteboard.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <dialog className="whiteboard-reader" ref={dialog} aria-labelledby="whiteboard-reader-title" onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose() } }}>
    <header><h2 id="whiteboard-reader-title">{output ? '结果白板' : detail ? '白板详情' : '协作白板'}</h2><div>
      <button type="button" aria-label="下载白板数据" title="下载白板数据" disabled={output ? !outputBoard : !board} onClick={download}><Download size={18} /></button>
      <button type="button" aria-label="关闭白板" title="关闭白板" onClick={onClose}><X size={20} /></button>
    </div></header>
    <article className={`whiteboard-reader-content${output ? ' whiteboard-reader-result' : ''}`} ref={content} tabIndex={0} aria-label="白板内容">
      {output ? <ResultDocument board={outputBoard} /> : detail ? <WhiteboardDetail content={detail} /> : <div className="whiteboard-reader-fallback" dangerouslySetInnerHTML={{ __html: html }} />}
    </article>
  </dialog>
}
