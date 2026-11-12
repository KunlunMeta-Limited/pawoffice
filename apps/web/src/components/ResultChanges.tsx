import { useEffect, useId, useState } from 'react'
import { ChevronRight, FileCode2 } from 'lucide-react'
import type { ResultChangesSection } from '@pawoffice/protocol/office-ui'
import { parseUnifiedDiff } from '../results/diff.ts'
import { ResultDiffTable } from './ResultDiffTable.tsx'
import './ResultChanges.css'

type ChangedFile = ResultChangesSection['files'][number]
const statusLabels = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' } as const
const statusOrder = ['added', 'modified', 'deleted', 'renamed'] as const

function LineCounts({ file }: { file: Pick<ChangedFile, 'added' | 'deleted' | 'binary'> }) {
  return <span className="result-change-counts">{file.binary ? <span>二进制 · 无法文本预览</span> : <>
    <span className="is-added">+{file.added}</span><span className="is-deleted">-{file.deleted}</span>
  </>}</span>
}

/** Honest fallbacks first: a binary, oversized or stat-only file never gets an invented text diff. */
function DiffBody({ file }: { file: ChangedFile }) {
  const parsed = parseUnifiedDiff(file.diff)
  const hasLines = parsed.lines.some(line => ['context', 'added', 'deleted'].includes(line.kind))
  const empty = file.oversized ? '文件较大，后端未提供可预览的差异。'
      : file.diff.trim() ? '未提供可解析的 unified diff 内容。' : '后端仅提供了变更统计，尚未提供逐行差异。'
  if (!hasLines) return <p className="result-diff-empty">{empty}</p>
  return <>
    {(file.diffTruncated || parsed.truncated) && <p className="result-diff-notice">当前显示部分差异，新增与删除统计为整个文件的行数。</p>}
    <ResultDiffTable lines={parsed.lines} label={`${file.path} 行差异`} />
  </>
}

/**
 * Diff language: a compact file list where every row toggles an inline real unified diff.
 * No top-layer popover and no hover preview — the file row is the disclosure control
 * (`aria-expanded`, Enter/Space native on the button, Esc collapses the current diff).
 */
export function ResultChanges({ section, active = true }: { section: ResultChangesSection; active?: boolean }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set())
  const baseId = useId()
  useEffect(() => { if (!active) setOpen(new Set()) }, [active])
  const toggle = (index: number) => setOpen(previous => {
    const next = new Set(previous)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    return next
  })
  const collapse = (index: number) => setOpen(previous => {
    if (!previous.has(index)) return previous
    const next = new Set(previous)
    next.delete(index)
    return next
  })
  const totals = section.files.reduce((sum, file) => ({
    added: sum.added + file.added, deleted: sum.deleted + file.deleted, binary: false,
  }), { added: 0, deleted: 0, binary: false })
  const statusCounts = statusOrder.map(status => ({
    status, count: section.files.filter(file => file.status === status).length,
  })).filter(entry => entry.count > 0)
  return <section className="result-changes" data-kind="changes" aria-label="文件变更清单">
    <header className="result-changes-head">
      <span className="result-changes-icon" aria-hidden="true"><FileCode2 size={22} strokeWidth={1.6} /></span>
      <div className="result-changes-head-main">
        <div className="result-changes-title">
          <h4>已编辑 {section.files.length} 个文件</h4>
          <LineCounts file={totals} />
        </div>
        <p className="result-changes-states">
          {statusCounts.map(entry => <span key={entry.status} data-status={entry.status}>
            {statusLabels[entry.status]}文件 {entry.count}
          </span>)}
        </p>
      </div>
      <p className="result-changes-hint">点击文件行展开逐行差异（Esc 收起）</p>
    </header>
    <ul className="result-changes-list">
      {section.files.map((file, index) => {
        const expanded = open.has(index)
        const panelId = `${baseId}-diff-${index}`
        const label = statusLabels[file.status]
        const rowLabel = `${expanded ? '收起' : '展开'} ${file.path} 的逐行差异，${label}，新增 ${file.added} 行，删除 ${file.deleted} 行`
        const fileSummary = <>
          <span className="result-change-status" data-status={file.status}>{label}</span>
          <span className="result-change-path">
            <code>{file.path}</code>
            {file.previousPath && <small>原路径：{file.previousPath}</small>}
          </span>
          {file.oversized && <span className="result-change-large">较大文件</span>}
          <LineCounts file={file} />
        </>
        return <li key={`${file.status}-${file.path}-${index}`}>
          {file.binary ? <div className="result-change-row" data-status={file.status} data-preview="unavailable">{fileSummary}</div>
            : <button type="button" className="result-change-row" data-status={file.status}
            aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} aria-label={rowLabel}
            onClick={() => toggle(index)}
            onKeyDown={event => {
              if (event.key !== 'Escape' || !expanded) return
              event.preventDefault()
              event.stopPropagation()
              collapse(index)
            }}>
            {fileSummary}
            <ChevronRight className="result-change-chevron" size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>}
          {expanded && <div className="result-change-diff" id={panelId} role="region"
            aria-label={`${file.path} 的逐行差异`}
            onKeyDown={event => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              event.stopPropagation()
              collapse(index)
              const row = event.currentTarget.previousElementSibling
              if (row instanceof HTMLElement) row.focus()
            }}>
            {file.previousPath && <p className="result-change-previous">原路径：{file.previousPath}</p>}
            <DiffBody file={file} />
          </div>}
        </li>
      })}
    </ul>
  </section>
}
