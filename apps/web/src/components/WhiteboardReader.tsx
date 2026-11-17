import { useEffect, useMemo, useRef } from 'react'
import { Download, X } from 'lucide-react'
import { whiteboardTaskBoard, whiteboardTaskBoardSchema } from '@pawoffice/scene-office/whiteboard'
import type { WhiteboardProgress } from '@pawoffice/scene-office/whiteboard'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import { officeResultSchema } from '@pawoffice/protocol/office-ui'
import type { OfficeResult, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { ResultWorkspace } from './ResultWorkspace.tsx'
import { OfficeWhiteboardSurface } from './OfficeWhiteboardSurface.tsx'
import { resultFileBase } from '../results/format.ts'
import './WhiteboardReader.css'

/**
 * The single result-reading container. It keeps the existing `<dialog>` open/close, Escape behaviour,
 * focus restoration and raw-data export while hosting the one-page reader. The dev-only acceptance
 * preview mounts the same component, so screenshots never show a simplified mock.
 */
export function ResultReaderDialog({ board, result, boardId = 'result-reader', initialDeliveryId, onClose, exportable = true }: {
  board: WhiteboardTaskBoardData; result: OfficeResult; boardId?: string; initialDeliveryId?: string
  onClose: () => void; exportable?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLElement>(null)
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
    if (!exportable) return
    const url = URL.createObjectURL(new Blob([stringifyDocumentObject(board, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = resultFileBase({ ...result, title: board.title || result.title }) + '-whiteboard.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <dialog className="whiteboard-reader is-result" ref={dialog} aria-labelledby="whiteboard-reader-title" onCancel={onClose}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <OfficeWhiteboardSurface />
    <header>
      <div className="whiteboard-reader-heading"><h2 id="whiteboard-reader-title">{initialDeliveryId ? '历史交付' : '本轮成果'}</h2></div>
      <div className="whiteboard-reader-actions">
        <button type="button" aria-label="导出全部轮次原始数据" title="导出全部轮次原始数据" disabled={!exportable} onClick={download}><Download size={18} /></button>
        <button type="button" aria-label="关闭当前成果" title="关闭" onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    <article className="whiteboard-reader-content is-result" ref={content} aria-label="当前成果内容">
      {board ? <ResultWorkspace key={boardId} board={board} result={result} initialDeliveryId={initialDeliveryId} />
        : <p className="result-workspace-empty">当前没有可读取的任务信息。</p>}
    </article>
  </dialog>
}

export function WhiteboardReader({ state, boardId, onClose, initialDeliveryId }: {
  state: Record<string, unknown>; boardId: string; progress: WhiteboardProgress; onClose: () => void
  initialDeliveryId?: string
}) {
  const serialized = JSON.stringify(state)
  const board = useMemo(() => whiteboardTaskBoard(JSON.parse(serialized)) ?? whiteboardTaskBoardSchema.parse({}), [serialized])
  const result = useMemo(() => officeResultSchema.parse(board.result), [board])
  return <ResultReaderDialog board={board} result={result} boardId={boardId} initialDeliveryId={initialDeliveryId} onClose={onClose} />
}
