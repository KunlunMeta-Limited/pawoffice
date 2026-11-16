import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, ChartNoAxesColumn, ClipboardList, FileText, FolderOpen, ListChecks, Pin, X } from 'lucide-react'
import type { ResultBodyProps } from '../results/bodyPresentation.ts'
import './WhiteboardNotes.css'

type NoteTone = 'blue' | 'sand' | 'green' | 'lilac' | 'rose' | 'white' | 'folder'

function NoteDialog({ title, tone, icon, children, onClose }: {
  title: string; tone: NoteTone; icon: ReactNode; children: ReactNode; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const label = useId()
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  const close = () => {
    dialog.current?.close()
    onClose()
  }
  return <dialog ref={dialog} className="whiteboard-note-dialog" data-tone={tone} aria-labelledby={label}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close()
    }}>
    <header className="whiteboard-note-dialog-header">
      <span className="whiteboard-note-icon" aria-hidden="true">{icon}</span>
      <h3 id={label}>{title}</h3>
      <button type="button" aria-label="关闭便签" onClick={close}><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="whiteboard-note-body">{children}</div>
  </dialog>
}

function Note({ title, tone, icon, preview, children }: {
  title: string; tone: NoteTone; icon: ReactNode; preview?: ReactNode; children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const label = useId(), description = useId()
  return <>
    <button type="button" className="whiteboard-note" data-tone={tone} ref={trigger} aria-haspopup="dialog"
      aria-labelledby={label} aria-describedby={preview ? description : undefined} onClick={() => setOpen(true)}>
      <span className="whiteboard-note-icon" aria-hidden="true">{icon}</span>
      <span id={label} className="whiteboard-note-title">{title}</span>
      {preview && <span id={description} className="whiteboard-note-preview">{preview}</span>}
      <ArrowUpRight className="whiteboard-note-open" size={16} aria-hidden="true" />
    </button>
    {open && <NoteDialog title={title} tone={tone} icon={icon} onClose={() => {
      setOpen(false)
      trigger.current?.focus({ preventScroll: true })
    }}>{children}</NoteDialog>}
  </>
}

export function WhiteboardNotes({ board, result, readingMode, executionKnown, description, attentionCount, attentionParts, sectionTitles, blocks }: ResultBodyProps) {
  const processPreview = (executionKnown && board.steps.length ? board.steps : result.tasks)
    .slice(0, 3).map(step => step.title).join(' · ')
  const processCounts = [
    result.decisions.length ? `决策 ${result.decisions.length} 项` : '',
    result.versions.length ? `版本 ${result.versions.length} 项` : '',
  ].filter(Boolean).join(' · ')

  return <div className="whiteboard-notes">
    <Note title="本轮结论" tone="blue" icon={<Pin size={17} />}
      preview={result.summary.trim() || board.description?.trim() || result.verdict || description}>{blocks.conclusion}</Note>
    {blocks.delivery && <Note title="交付文件" tone="folder" icon={<FolderOpen size={17} />}
      preview={<><strong>{result.artifacts.length} 份文件</strong><span>{result.artifacts.slice(0, 2).map(file => file.title).join(' · ')}</span></>}>
      {blocks.delivery}
    </Note>}
    {blocks.metrics && <Note title={result.metricsTitle || '关键指标'} tone="green" icon={<ChartNoAxesColumn size={17} />}
      preview={result.metrics.slice(0, 2).map(metric => <span key={metric.id} className="whiteboard-note-metric"><strong>{metric.value}{metric.unit}</strong> {metric.label}</span>)}>
      {blocks.metrics}
    </Note>}
    {(blocks.records || blocks.stages || blocks.taskDetails) && <Note title="任务与过程" tone="lilac" icon={<ClipboardList size={17} />}
      preview={processPreview || processCounts || board.detailSections?.slice(0, 3).map(section => section.title).join(' · ')}>
      {blocks.stages}
      {blocks.records}
      {blocks.taskDetails}
    </Note>}
    {blocks.review && <Note title="验证与验收" tone={attentionCount ? 'rose' : 'sand'} icon={<ListChecks size={17} />}
      preview={attentionCount ? <><strong>{attentionCount} 项需要关注</strong><span>{attentionParts.join(' · ')}</span></> : result.verdict || description}>
      {blocks.review}
    </Note>}
    {blocks.sections && <Note title={readingMode === 'fact' ? '说明与结论' : '详细内容'} tone="white" icon={<FileText size={17} />}
      preview={sectionTitles.filter(Boolean).slice(0, 3).join(' · ')}>
      {blocks.sections}
    </Note>}
    {blocks.next && <Note title="下一步" tone="sand" icon={<ArrowRight size={17} />} preview={result.next[0]}>{blocks.next}</Note>}
  </div>
}
