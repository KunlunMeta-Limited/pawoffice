import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { whiteboardTaskBoard } from '@pawoffice/scene-office/whiteboard'
import type { WhiteboardProgress } from '@pawoffice/scene-office/whiteboard'
import { renderWhiteboardContent } from '@pawoffice/scene-office/task-board'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import { officeResultSchema } from '@pawoffice/protocol/office-ui'
import { ResultWorkspace } from './ResultWorkspace.tsx'
import { resultFileBase } from '../results/format.ts'
import './WhiteboardReader.css'

export function WhiteboardReader({ state, boardId, progress, onClose, initialDeliveryId }: {
  state: Record<string, unknown>; boardId: string; progress: WhiteboardProgress; onClose: () => void
  initialDeliveryId?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLElement>(null)
  const serialized = JSON.stringify(state)
  const board = useMemo(() => whiteboardTaskBoard(JSON.parse(serialized)), [serialized])
  const result = useMemo(() => officeResultSchema.parse(board?.result ?? {}), [board])
  const [frame, setFrame] = useState(0)
  const html = useMemo(() => {
    void frame
    return renderWhiteboardContent(board ? { taskBoard: progress.project(boardId, board) } : {})
  }, [board, boardId, progress, frame])
  useEffect(() => {
    if (board?.status !== 'running' || board.detail?.trim() || board.detailSections?.length) return
    const timer = setInterval(() => setFrame(value => value + 1), 250)
    return () => clearInterval(timer)
  }, [board?.status, board?.detail, board?.detailSections?.length])
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement
    element.showModal()
    return () => {
      element.close()
      requestAnimationFrame(() => {
        if (trigger instanceof HTMLElement && trigger.isConnected && !document.querySelector('dialog[open]')) trigger.focus()
      })
    }
  }, [])
  const download = () => {
    if (!board) return
    const url = URL.createObjectURL(new Blob([stringifyDocumentObject(board, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = resultFileBase({ ...result, title: board.title }) + '-whiteboard.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <dialog className="whiteboard-reader is-result" ref={dialog} aria-labelledby="whiteboard-reader-title" onCancel={onClose}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <header>
      <div className="whiteboard-reader-heading"><h2 id="whiteboard-reader-title">当前成果</h2></div>
      <div className="whiteboard-reader-actions">
        <button type="button" aria-label="下载完整成果与白板数据" title="下载完整成果与白板数据" disabled={!board} onClick={download}><Download size={18} /></button>
        <button type="button" aria-label="关闭当前成果" title="关闭" onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    <article className="whiteboard-reader-content is-result" ref={content} aria-label="当前成果内容">
      {board ? <ResultWorkspace key={boardId} board={board} result={result} initialDeliveryId={initialDeliveryId} boardHtml={html} onTabChange={() => content.current?.scrollTo(0, 0)} />
        : <p className="result-workspace-empty">当前没有可读取的任务信息。</p>}
    </article>
  </dialog>
}
