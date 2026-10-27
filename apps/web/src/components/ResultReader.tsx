import { useEffect, useId, useRef, useState } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, CalendarDays, Check, CheckCircle2, CircleDashed, CircleX,
  ClipboardCheck, Copy, Download, ExternalLink, FileText, Image as ImageIcon, Info, Link2, Minus,
  PackageCheck, PencilLine, Table2, UserRound,
} from 'lucide-react'
import type { OfficeResult, ResultArtifact, ResultCheck, ResultMetric } from '@pawoffice/protocol/office-ui'
import { resultFileBase, resultHasContent, resultReport, resultStatusLabels, resultSummaryText } from '../results/format.ts'
import './ResultReader.css'

const statusIcons = { verified: BadgeCheck, ready: PackageCheck, draft: PencilLine, rejected: CircleX } as const
const trendIcons = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const
const checkIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const
const checkLabels = { passed: '已通过', pending: '待补充', failed: '未通过' } as const
const artifactIcons = { document: FileText, image: ImageIcon, link: Link2, data: Table2 } as const

const markdownComponents: Components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
  table: ({ children }) => <div className="result-artifact-table" role="region" aria-label="交付物表格" tabIndex={0}><table>{children}</table></div>,
  img: ({ src, alt, title }) => typeof src === 'string' && src ? <img src={src} alt={alt ?? ''} title={title} loading="lazy" /> : <span>{alt}</span>,
}

function downloadText(filename: string, content: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ArtifactCard({ artifact, expanded, copied, onToggle, onCopy, onDownload }: {
  artifact: ResultArtifact; expanded: boolean; copied: string
  onToggle: () => void; onCopy: () => void; onDownload: () => void
}) {
  const Icon = artifactIcons[artifact.kind]
  const isCopied = copied === artifact.id
  return <article className="result-artifact" data-kind={artifact.kind} data-expanded={expanded}>
    <div className="result-artifact-main">
      <span className="result-artifact-icon"><Icon size={18} strokeWidth={1.9} /></span>
      <div className="result-artifact-copy">
        <h4>{artifact.title}</h4>
        {artifact.description && <p>{artifact.description}</p>}
      </div>
    </div>
    {expanded && artifact.content && <div className="result-artifact-preview">
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>{artifact.content}</Markdown>
    </div>}
    {(artifact.content || artifact.url) && <div className="result-artifact-actions">
      {artifact.content && <button type="button" aria-expanded={expanded} onClick={onToggle}>{expanded ? <Minus size={13} /> : <FileText size={13} />}{expanded ? '收起' : '查看'}</button>}
      {artifact.content && <button type="button" onClick={onCopy}>{isCopied ? <Check size={13} /> : <Copy size={13} />}{isCopied ? '已复制' : '复制'}</button>}
      {artifact.content && <button type="button" onClick={onDownload}><Download size={13} />下载</button>}
      {artifact.url && <a href={artifact.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />打开</a>}
    </div>}
  </article>
}

function MetricCard({ metric }: { metric: ResultMetric }) {
  const TrendIcon = trendIcons[metric.trend]
  return <article className="result-metric" data-tone={metric.tone} data-trend={metric.trend}>
    <div className="result-metric-top">
      <span>{metric.label}</span>
      {metric.change && <span className={`result-delta is-${metric.tone}`}><TrendIcon size={12} strokeWidth={2.4} />{metric.change}</span>}
    </div>
    <p className="result-metric-value"><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.previous && <p className="result-metric-previous">首轮 {metric.previous}</p>}
  </article>
}

function CheckRow({ check }: { check: ResultCheck }) {
  const Icon = checkIcons[check.status]
  return <li data-status={check.status}><Icon size={15} strokeWidth={2} /><span>{check.label}</span><em>{checkLabels[check.status]}</em></li>
}

export function ResultReader({ result, onOpenBoard }: { result: OfficeResult; onOpenBoard?: () => void }) {
  const baseId = useId()
  const [copied, setCopied] = useState('')
  const [expanded, setExpanded] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!resultHasContent(result)) return <p className="result-empty">本轮还没有可展示的成果。</p>

  const status = { label: resultStatusLabels[result.status], Icon: statusIcons[result.status] }
  const StatusIcon = status.Icon
  const passed = result.checks.filter(check => check.status === 'passed').length
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id); clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(''), 1800)
    } catch { setCopied('') }
  }
  const fileBase = resultFileBase(result)

  return <div className="result-reader" data-status={result.status}>
    <span className="result-sr-only" role="status">{copied ? '已复制到剪贴板' : ''}</span>
    <section className="result-hero" aria-label="成果摘要">
      <div className="result-hero-meta">
        <span className={`result-status is-${result.status}`}><StatusIcon size={14} strokeWidth={2.2} />{status.label}</span>
        {result.owner && <span className="result-meta-item"><UserRound size={13} />{result.owner}</span>}
        {result.producedAt && <span className="result-meta-item"><CalendarDays size={13} />{result.producedAt}</span>}
      </div>
      {result.summary && <p className="result-conclusion">{result.summary}</p>}
      {result.verdict && <p className="result-verdict"><StatusIcon size={15} strokeWidth={2} />{result.verdict}</p>}
      <div className="result-hero-actions">
        {onOpenBoard && <button type="button" className="result-action is-primary" onClick={onOpenBoard}><ClipboardCheck size={15} />查看任务白板</button>}
        <button type="button" className="result-action" onClick={() => void copy('summary', resultSummaryText(result))}>
          {copied === 'summary' ? <Check size={15} /> : <Copy size={15} />}{copied === 'summary' ? '已复制' : '复制摘要'}
        </button>
        <button type="button" className="result-action" onClick={() => downloadText(`${fileBase}.md`, resultReport(result))}><Download size={15} />下载报告</button>
      </div>
      {result.status === 'verified' && <span className="result-seal" aria-hidden="true">验收通过</span>}
    </section>

    {!!result.metrics.length && <section className="result-section" aria-labelledby={`${baseId}-metrics`}>
      <header className="result-section-head"><h3 id={`${baseId}-metrics`}>关键指标</h3><small>首轮观察 → 更新后观察</small></header>
      <div className="result-metrics">{result.metrics.map(metric => <MetricCard key={metric.id} metric={metric} />)}</div>
    </section>}

    {!!result.artifacts.length && <section className="result-section" aria-labelledby={`${baseId}-artifacts`}>
      <header className="result-section-head"><h3 id={`${baseId}-artifacts`}>交付物</h3><small>{result.artifacts.length} 项</small></header>
      <div className="result-artifacts">{result.artifacts.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact}
        expanded={expanded === artifact.id} copied={copied}
        onToggle={() => setExpanded(current => current === artifact.id ? '' : artifact.id)}
        onCopy={() => { void copy(artifact.id, artifact.content) }}
        onDownload={() => downloadText(`${fileBase}-${artifact.id}.md`, `# ${artifact.title}\n\n${artifact.content || artifact.description}`)} />)}</div>
    </section>}

    {(!!result.checks.length || !!result.decisions.length) && <div className={`result-columns${result.checks.length && result.decisions.length ? '' : ' is-single'}`}>
      {!!result.checks.length && <section className="result-card" aria-labelledby={`${baseId}-checks`}>
        <header className="result-card-head"><h3 id={`${baseId}-checks`}>验收清单</h3><span>{passed}/{result.checks.length} 通过</span></header>
        <ul className="result-check-list">{result.checks.map(check => <CheckRow key={check.id} check={check} />)}</ul>
      </section>}
      {!!result.decisions.length && <section className="result-card" aria-labelledby={`${baseId}-decisions`}>
        <header className="result-card-head"><h3 id={`${baseId}-decisions`}>过程决策</h3><span>{result.decisions.length} 项</span></header>
        <ol className="result-decision-list">{result.decisions.map(decision => <li key={decision.id}>
          <p className="result-decision-question">{decision.question}</p>
          <p className="result-decision-choice"><strong>{decision.choice}</strong>{decision.at && <time>{decision.at}</time>}</p>
        </li>)}</ol>
      </section>}
    </div>}

    {!!result.next.length && <section className="result-section" aria-labelledby={`${baseId}-next`}>
      <header className="result-section-head"><h3 id={`${baseId}-next`}>下一步</h3><small>{result.next.length} 项行动</small></header>
      <ol className="result-next-list">{result.next.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
    </section>}

    {result.note && <p className="result-note"><Info size={14} strokeWidth={2} /><span>{result.note}</span></p>}
  </div>
}
