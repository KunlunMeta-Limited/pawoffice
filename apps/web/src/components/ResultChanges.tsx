import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, FileCode2, Pin, X } from 'lucide-react'
import type { ResultChangesSection } from '@pawoffice/protocol/office-ui'
import { parseUnifiedDiff } from '../results/diff.ts'
import { ResultDiffTable } from './ResultDiffTable.tsx'
import './ResultChanges.css'

type ChangedFile = ResultChangesSection['files'][number]
type Preview = { file: ChangedFile; anchor: HTMLButtonElement; pinned: boolean }
const statusLabels = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' } as const

function LineCounts({ file }: { file: Pick<ChangedFile, 'added' | 'deleted' | 'binary'> }) {
  return <span className="result-change-counts">{file.binary ? <span>二进制</span> : <>
    <span className="is-added">+{file.added}</span><span className="is-deleted">-{file.deleted}</span>
  </>}</span>
}

function DiffBody({ file }: { file: ChangedFile }) {
  const parsed = parseUnifiedDiff(file.binary ? '' : file.diff)
  const hasLines = parsed.lines.some(line => ['context', 'added', 'deleted'].includes(line.kind))
  const empty = file.binary ? '二进制文件不支持逐行对比。'
    : file.oversized ? '文件较大，后端未提供可预览的差异。'
      : file.diff.trim() ? '未提供可解析的 unified diff 内容。' : '后端仅提供了变更统计，尚未提供逐行差异。'
  if (!hasLines) return <p className="result-diff-empty">{empty}</p>
  return <>
    {(file.diffTruncated || parsed.truncated) && <p className="result-diff-notice">当前显示部分差异，新增与删除统计为整个文件的行数。</p>}
    <ResultDiffTable lines={parsed.lines} label={`${file.path} 行差异`} />
  </>
}

function DiffPreview({ preview, id, onClose, onPin, onEnter, onLeave }: {
  preview: Preview; id: string; onClose: (restoreFocus?: boolean) => void; onPin: () => void
  onEnter: () => void; onLeave: () => void
}) {
  const popup = useRef<HTMLDivElement>(null)
  const anchorRect = useRef<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const element = popup.current!
    element.showPopover()
    const rect = preview.anchor.getBoundingClientRect()
    anchorRect.current = rect
    const width = Math.min(960, window.innerWidth - 24)
    element.style.width = `${width}px`
    const below = window.innerHeight - rect.bottom - 20
    const above = rect.top - 20
    element.style.maxHeight = `${Math.min(500, Math.max(160, Math.max(below, above)))}px`
    const height = element.getBoundingClientRect().height
    const top = rect.bottom + 8 + height <= window.innerHeight - 12 ? rect.bottom + 8
      : rect.top - 8 - height >= 12 ? rect.top - 8 - height : Math.max(12, window.innerHeight - height - 12)
    element.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`
    element.style.top = `${top}px`
    return () => { element.hidePopover() }
  }, [preview.file, preview.anchor])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !popup.current?.contains(event.target) && !preview.anchor.contains(event.target)) onClose()
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation()
      onClose(true)
    }
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return
      const rect = preview.anchor.getBoundingClientRect()
      // A queued scroll event from focusing/revealing the file must not dismiss a new preview.
      if (!anchorRect.current || Math.abs(rect.top - anchorRect.current.top) > 1 || Math.abs(rect.left - anchorRect.current.left) > 1) onClose()
    }
    const resize = () => onClose()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', resize)
    }
  }, [onClose, preview.anchor])

  return <div ref={popup} id={id} popover="manual" className="result-diff-popover" role="dialog"
    aria-label={`文件差异：${preview.file.path}`} onMouseEnter={onEnter} onMouseLeave={onLeave}>
    <header className="result-diff-head">
      <div><span className="result-change-status" data-status={preview.file.status}>{statusLabels[preview.file.status]}</span>
        <code>{preview.file.path}</code></div>
      <LineCounts file={preview.file} />
      {!preview.pinned && <button type="button" aria-label="固定差异预览" title="固定预览" onClick={onPin}><Pin size={15} /></button>}
      <button type="button" aria-label="关闭差异预览" title="关闭预览（Esc）" onClick={() => onClose(true)}><X size={17} /></button>
    </header>
    {preview.file.previousPath && <p className="result-diff-previous">原路径：{preview.file.previousPath}</p>}
    <DiffBody file={preview.file} />
    <footer className="result-diff-footer">{preview.pinned ? '预览已固定，可滚动查看 · Esc 关闭' : '悬停预览 · 点击文件可固定 · Esc 关闭'}</footer>
  </div>
}

/** File summary plus a top-layer diff preview, shared by overview and deliverables. */
export function ResultChanges({ section, active = true }: { section: ResultChangesSection; active?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressFocus = useRef(false)
  const popupId = useId()
  const current = preview && section.files.includes(preview.file) && active ? preview : null
  const clearTimer = () => { clearTimeout(timer.current) }
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (active) return
    clearTimeout(timer.current)
    setPreview(null)
  }, [active])
  const close = (restoreFocus = false) => {
    clearTimer()
    if (restoreFocus && preview?.anchor.isConnected) {
      suppressFocus.current = true
      preview.anchor.focus()
      queueMicrotask(() => { suppressFocus.current = false })
    }
    setPreview(null)
  }
  const leave = () => {
    clearTimer()
    if (!current?.pinned) timer.current = setTimeout(() => setPreview(null), 180)
  }
  const schedule = (file: ChangedFile, anchor: HTMLButtonElement) => {
    clearTimer()
    if (suppressFocus.current || current?.pinned) return
    timer.current = setTimeout(() => setPreview({ file, anchor, pinned: false }), 240)
  }
  const totals = section.files.reduce((sum, file) => ({ added: sum.added + file.added, deleted: sum.deleted + file.deleted, binary: false }), { added: 0, deleted: 0, binary: false })
  const shown = expanded ? section.files : section.files.slice(0, 4)
  return <section className="result-changes" data-kind="changes" aria-label="文件变更清单">
    <header className="result-changes-head">
      <span className="result-changes-icon" aria-hidden="true"><FileCode2 size={23} strokeWidth={1.6} /></span>
      <div><h4>已编辑 {section.files.length} 个文件</h4><LineCounts file={totals} />
        <p>{(['added', 'modified', 'deleted', 'renamed'] as const).map(status => {
          const count = section.files.filter(file => file.status === status).length
          return count ? <span key={status}>{statusLabels[status]}文件 {count}</span> : null
        })}</p>
      </div>
    </header>
    <ul className="result-changes-list">{shown.map(file => <li key={`${file.status}-${file.path}`}>
      <button type="button" className="result-change-row" data-status={file.status}
        aria-label={`查看 ${file.path} 差异，${statusLabels[file.status]}，新增 ${file.added} 行，删除 ${file.deleted} 行`}
        aria-haspopup="dialog" aria-expanded={current?.file === file} aria-controls={current?.file === file ? popupId : undefined}
        onMouseEnter={event => schedule(file, event.currentTarget)} onMouseLeave={leave}
        onFocus={event => schedule(file, event.currentTarget)}
        onBlur={event => { if (!event.relatedTarget || !(event.relatedTarget instanceof Node) || !document.getElementById(popupId)?.contains(event.relatedTarget)) leave() }}
        onClick={event => {
          clearTimer()
          setPreview(current?.file === file && current.pinned ? null : { file, anchor: event.currentTarget, pinned: true })
          if (event.detail === 0) requestAnimationFrame(() => document.getElementById(popupId)?.querySelector<HTMLElement>('.result-diff-scroll')?.focus())
        }}>
        <span className="result-change-status" data-status={file.status}>{statusLabels[file.status]}</span>
        <span className="result-change-path"><code>{file.path}</code>{file.previousPath && <small>原路径：{file.previousPath}</small>}</span>
        {file.oversized && <span className="result-change-large">较大文件</span>}
        <LineCounts file={file} />
      </button>
    </li>)}</ul>
    {section.files.length > 4 && <button type="button" className="result-changes-toggle" aria-expanded={expanded}
      onClick={() => { close(); setExpanded(value => !value) }}>{expanded ? '收起文件列表' : `全部 ${section.files.length} 个文件`}<ChevronDown size={15} aria-hidden="true" /></button>}
    {current && <DiffPreview preview={current} id={popupId} onClose={close} onPin={() => setPreview({ ...current, pinned: true })} onEnter={clearTimer} onLeave={leave} />}
  </section>
}
