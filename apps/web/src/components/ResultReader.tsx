import { useContext, useEffect, useId, useRef, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, CalendarDays, Check, CheckCircle2, CircleDashed, CircleX,
  ClipboardCheck, Copy, Download, ExternalLink, FileText, Image as ImageIcon, Info, Link2, Minus,
  PackageCheck, PencilLine, Table2, Target, UserRound,
} from 'lucide-react'
import type { OfficeResult, ResultArtifact, ResultCheck, ResultMetric } from '@pawoffice/protocol/office-ui'
import { formatResultTimestamp, resultFileBase, resultHasContent, resultReport, resultStatusLabels, resultSummaryText } from '../results/format.ts'
import { ResultMarkdown } from './ResultMarkdown.tsx'
import type { ResultDocumentMetadata } from '../results/presentation.ts'
import { resultChecks } from '../results/presentation.ts'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import './ResultReader.css'

const statusIcons = { verified: BadgeCheck, ready: PackageCheck, draft: PencilLine, rejected: CircleX } as const
const trendIcons = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const
const toneIcons = { positive: CheckCircle2, negative: CircleX, neutral: CircleDashed } as const
const targetIcons = { met: CheckCircle2, missed: CircleX, 'at-risk': CircleDashed } as const
const targetLabels = { met: '已达标', missed: '未达标', 'at-risk': '有风险' } as const
const checkIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const
const checkLabels = { passed: '已通过', pending: '待补充', failed: '未通过' } as const
const artifactIcons = { document: FileText, image: ImageIcon, link: Link2, data: Table2 } as const

type ResolvedMetricKind = 'comparison' | 'value' | 'status' | 'target' | 'text'

function downloadText(filename: string, content: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** auto = comparison when a previous value exists, otherwise a plain value card. */
function resolveMetricKind(metric: ResultMetric): ResolvedMetricKind {
  if (metric.kind !== 'auto') return metric.kind
  return metric.previous ? 'comparison' : 'value'
}

function MetricHeader({ metric }: { metric: ResultMetric }) {
  return <div className="result-metric-top"><span>{metric.label}</span></div>
}

function ComparisonMetric({ metric }: { metric: ResultMetric }) {
  const TrendIcon = trendIcons[metric.trend]
  return <>
    <div className="result-metric-top">
      <span>{metric.label}</span>
      {metric.change && <span className={`result-delta is-${metric.tone}`}><TrendIcon size={12} strokeWidth={2.4} />{metric.change}</span>}
    </div>
    <p className="result-metric-value"><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.previous && <p className="result-metric-previous">首轮 {metric.previous}</p>}
  </>
}

function ValueMetric({ metric }: { metric: ResultMetric }) {
  return <>
    <MetricHeader metric={metric} />
    <p className="result-metric-value"><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.change && <p className="result-metric-previous">{metric.change}</p>}
  </>
}

function StatusMetric({ metric }: { metric: ResultMetric }) {
  const Icon = toneIcons[metric.tone]
  return <>
    <MetricHeader metric={metric} />
    <p className="result-metric-state" data-tone={metric.tone}><Icon size={17} strokeWidth={2} /><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.previous && <p className="result-metric-previous">首轮 {metric.previous}</p>}
  </>
}

function TargetMetric({ metric }: { metric: ResultMetric }) {
  const status = metric.targetStatus || ''
  const StatusIcon = status ? targetIcons[status] : Target
  return <>
    <div className="result-metric-top">
      <span>{metric.label}</span>
      {status ? <span className={`result-target-state is-${status}`}><StatusIcon size={12} strokeWidth={2.2} />{targetLabels[status]}</span> : <Target size={13} strokeWidth={2} />}
    </div>
    <p className="result-metric-value"><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.progress !== undefined && <div className="result-target-progress">
      <div className="result-target-track" role="progressbar" aria-label={`${metric.label}进度`} aria-valuenow={Math.round(metric.progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${metric.progress}%` }} /></div>
      <small>{Math.round(metric.progress)}%</small>
    </div>}
    {(metric.target || metric.change) && <p className="result-metric-previous">{metric.target ? `目标 ${metric.target}` : metric.change}</p>}
  </>
}

function TextMetric({ metric }: { metric: ResultMetric }) {
  return <>
    <MetricHeader metric={metric} />
    <p className="result-metric-text">{metric.value}{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.change && <p className="result-metric-previous">{metric.change}</p>}
  </>
}

function MetricCard({ metric }: { metric: ResultMetric }) {
  const kind = resolveMetricKind(metric)
  return <article className={`result-metric result-kind-${kind}`} data-kind={kind} data-tone={metric.tone} data-trend={metric.trend} data-emphasis={metric.emphasis}>
    {kind === 'status' ? <StatusMetric metric={metric} />
      : kind === 'target' ? <TargetMetric metric={metric} />
        : kind === 'text' ? <TextMetric metric={metric} />
          : kind === 'value' ? <ValueMetric metric={metric} />
            : <ComparisonMetric metric={metric} />}
  </article>
}

function ArtifactCard({ artifact, expanded, copied, onToggle, onCopy, onDownload, metadata }: {
  artifact: ResultArtifact; expanded: boolean; copied: string
  onToggle: () => void; onCopy: () => void; onDownload: () => void
  metadata?: ResultDocumentMetadata
}) {
  const Icon = artifactIcons[artifact.kind]
  const preview = useContext(ArtifactPreviewContext)
  const versioned = Boolean(preview && artifact.versionId)
  const isCopied = copied === artifact.id
  return <article className="result-artifact" data-kind={artifact.kind} data-expanded={expanded}>
    <div className="result-artifact-main">
      <span className="result-artifact-icon"><Icon size={18} strokeWidth={1.9} /></span>
      <div className="result-artifact-copy">
        <h4>{artifact.title}</h4>
        {artifact.description && <p>{artifact.description}</p>}
        {(metadata || artifact.versionId) && <p className="result-artifact-document-meta">{[
          artifact.version || metadata?.version || artifact.versionId,
          artifact.producedAt ? formatResultTimestamp(artifact.producedAt) : metadata?.at,
          metadata && { done: '已完成', active: '进行中', pending: '待开始' }[metadata.status],
        ].filter(Boolean).join(' · ')}</p>}
      </div>
    </div>
    {!versioned && expanded && artifact.content && <div className="result-artifact-preview">
      <ResultMarkdown content={artifact.content} />
    </div>}
    {(artifact.content || artifact.url || versioned) && <div className="result-artifact-actions">
      {versioned ? <button type="button" aria-haspopup="dialog" onClick={event => preview!.open(artifact, event.currentTarget)}><FileText size={13} />查看</button>
        : artifact.content && <button type="button" aria-expanded={expanded} onClick={onToggle}>{expanded ? <Minus size={13} /> : <FileText size={13} />}{expanded ? '收起' : '查看'}</button>}
      {artifact.content && <button type="button" onClick={onCopy}>{isCopied ? <Check size={13} /> : <Copy size={13} />}{isCopied ? '已复制' : '复制'}</button>}
      {artifact.content && <button type="button" onClick={onDownload}><Download size={13} />下载</button>}
      {artifact.url && !versioned && <a href={artifact.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />打开</a>}
    </div>}
  </article>
}

function CheckRow({ check }: { check: ResultCheck }) {
  const Icon = checkIcons[check.status]
  return <li data-status={check.status}><Icon size={15} strokeWidth={2} /><span>{check.label}</span><em>{checkLabels[check.status]}</em></li>
}

export function ResultReader({ result, onOpenBoard, view = 'full', documentMeta }: {
  result: OfficeResult; onOpenBoard?: () => void
  view?: 'full' | 'overview' | 'deliverables' | 'process' | 'metrics' | 'actions' | 'featured' | 'next'
  documentMeta?: ReadonlyMap<string, ResultDocumentMetadata>
}) {
  const baseId = useId()
  const [copied, setCopied] = useState('')
  const [expanded, setExpanded] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!resultHasContent(result)) return <p className="result-empty">本轮还没有可展示的成果。</p>

  const status = { label: resultStatusLabels[result.status], Icon: statusIcons[result.status] }
  const StatusIcon = status.Icon
  const checks = resultChecks(result)
  const passed = checks.filter(check => check.status === 'passed').length
  const metrics = result.metrics
  const kinds = metrics.map(resolveMetricKind)
  const metricsTitle = result.metricsTitle || '关键指标'
  const metricsCaption = result.metricsCaption || (kinds.length > 0 && kinds.every(kind => kind === 'comparison') ? '首轮观察 → 更新后观察' : '')
  const metricCount = metrics.length
  const hasPrimary = metrics.some(metric => metric.emphasis === 'primary')
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id); clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(''), 1800)
    } catch { setCopied('') }
  }
  const fileBase = resultFileBase(result)
  const overview = view === 'full' || view === 'overview'
  const deliverables = view === 'full' || view === 'deliverables' || view === 'featured'
  const process = view === 'full' || view === 'process'
  const artifacts = view === 'featured' ? result.artifacts.slice(0, 3) : result.artifacts

  return <div className="result-reader" data-status={result.status} data-view={view}>
    <span className="result-sr-only" role="status">{copied ? '已复制到剪贴板' : ''}</span>
    {(overview || view === 'actions') && <section className="result-hero" aria-label="成果摘要操作">
      {view === 'full' && <div className="result-hero-meta">
        <span className={`result-status is-${result.status}`}><StatusIcon size={14} strokeWidth={2.2} />{status.label}</span>
        {result.owner && <span className="result-meta-item"><UserRound size={13} />{result.owner}</span>}
        {result.producedAt && <span className="result-meta-item"><CalendarDays size={13} /><time dateTime={result.producedAt}
          title="产出时间（本地时区）">{formatResultTimestamp(result.producedAt)}</time></span>}
      </div>}
      {view === 'full' && result.summary && <p className="result-conclusion">{result.summary}</p>}
      {view === 'full' && result.verdict && <p className="result-verdict"><StatusIcon size={15} strokeWidth={2} />{result.verdict}</p>}
      <div className="result-hero-actions">
        {onOpenBoard && <button type="button" className="result-action is-primary" onClick={onOpenBoard}><ClipboardCheck size={15} />查看任务白板</button>}
        <button type="button" className="result-action" onClick={() => void copy('summary', resultSummaryText(result))}>
          {copied === 'summary' ? <Check size={15} /> : <Copy size={15} />}{copied === 'summary' ? '已复制' : '复制摘要'}
        </button>
        <button type="button" className="result-action" onClick={() => downloadText(`${fileBase}.md`, resultReport(result))}><Download size={15} />下载报告</button>
      </div>
      {view === 'full' && result.status === 'verified' && <span className="result-seal" aria-hidden="true">验收通过</span>}
    </section>}

    {(overview || view === 'metrics') && !!metricCount && <section className="result-section" aria-labelledby={`${baseId}-metrics`}>
      <header className="result-section-head">
        <h3 id={`${baseId}-metrics`}>{metricsTitle}</h3>
        {metricsCaption && <small>{metricsCaption}</small>}
      </header>
      <div className="result-metrics" data-count={String(Math.min(metricCount, 6))} data-lead={hasPrimary ? 'true' : undefined}>
        {metrics.map(metric => <MetricCard key={metric.id} metric={metric} />)}
      </div>
    </section>}

    {deliverables && !!result.artifacts.length && <section className="result-section" aria-labelledby={`${baseId}-artifacts`}>
      {view !== 'featured' && <header className="result-section-head"><h3 id={`${baseId}-artifacts`}>交付物</h3><small>{result.artifacts.length} 项</small></header>}
      <div className="result-artifacts">{artifacts.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact} metadata={documentMeta?.get(artifact.id)}
        expanded={expanded === artifact.id} copied={copied}
        onToggle={() => setExpanded(current => current === artifact.id ? '' : artifact.id)}
        onCopy={() => { void copy(artifact.id, artifact.content) }}
        onDownload={() => downloadText(`${fileBase}-${artifact.id}.md`, `# ${artifact.title}\n\n${artifact.content || artifact.description}`)} />)}</div>
    </section>}

    {process && (!!result.checks.length || !!result.decisions.length) && <div className={`result-columns${result.checks.length && result.decisions.length ? '' : ' is-single'}`}>
      {!!result.checks.length && <section className="result-card" aria-labelledby={`${baseId}-checks`}>
        <header className="result-card-head"><h3 id={`${baseId}-checks`}>验收清单</h3><span>{passed}/{result.checks.length} 通过</span></header>
        <ul className="result-check-list">{checks.map(check => <CheckRow key={check.id} check={check} />)}</ul>
      </section>}
      {!!result.decisions.length && <section className="result-card" aria-labelledby={`${baseId}-decisions`}>
        <header className="result-card-head"><h3 id={`${baseId}-decisions`}>过程决策</h3><span>{result.decisions.length} 项</span></header>
        <ol className="result-decision-list">{result.decisions.map(decision => <li key={decision.id}>
          <p className="result-decision-question">{decision.question}</p>
          <p className="result-decision-choice"><strong>{decision.choice}</strong>{decision.at && <time>{decision.at}</time>}</p>
        </li>)}</ol>
      </section>}
    </div>}

    {(overview || view === 'next') && !!result.next.length && <section className="result-section" aria-labelledby={`${baseId}-next`}>
      <header className="result-section-head"><h3 id={`${baseId}-next`}>下一步</h3><small>{result.next.length} 项行动</small></header>
      <ol className="result-next-list">{result.next.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
    </section>}

    {process && result.note && <p className="result-note"><Info size={14} strokeWidth={2} /><span>{result.note}</span></p>}
  </div>
}
