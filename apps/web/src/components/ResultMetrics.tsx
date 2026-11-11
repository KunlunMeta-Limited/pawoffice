import { ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDashed, CircleX, Minus, Target } from 'lucide-react'
import type { ResultMetric } from '@pawoffice/protocol/office-ui'
import { resultMetricKind } from '../results/format.ts'
import './ResultMetrics.css'

const trendIcons = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const
const toneIcons = { positive: CheckCircle2, negative: CircleX, neutral: CircleDashed } as const
const targetIcons = { met: CheckCircle2, missed: CircleX, 'at-risk': CircleDashed } as const
const targetLabels = { met: '已达标', missed: '未达标', 'at-risk': '有风险' } as const

function Unit({ unit }: { unit: string }) {
  return unit ? <span className="result-metric-unit">{unit}</span> : null
}

/** Value first, label under: the number is the figure, the label is its caption — not a KPI tile. */
function MetricFigure({ metric }: { metric: ResultMetric }) {
  return <p className="result-metric-value"><strong>{metric.value}</strong><Unit unit={metric.unit} /></p>
}

function MetricCaption({ metric }: { metric: ResultMetric }) {
  return <p className="result-metric-label">{metric.label}</p>
}

function ComparisonMetric({ metric }: { metric: ResultMetric }) {
  const Trend = trendIcons[metric.trend]
  return <>
    <MetricFigure metric={metric} />
    <MetricCaption metric={metric} />
    <p className="result-metric-foot">
      {metric.change && <span className="result-metric-change" data-tone={metric.tone}>
        <Trend size={12} strokeWidth={2.4} aria-hidden="true" />{metric.change}</span>}
      {metric.previous && <span className="result-metric-previous">首轮 {metric.previous}</span>}
    </p>
  </>
}

function StatusMetric({ metric }: { metric: ResultMetric }) {
  const Icon = toneIcons[metric.tone]
  return <>
    <p className="result-metric-state" data-tone={metric.tone}>
      <Icon size={15} strokeWidth={2} aria-hidden="true" /><strong>{metric.value}</strong><Unit unit={metric.unit} />
    </p>
    <MetricCaption metric={metric} />
    {metric.change && <p className="result-metric-foot"><span className="result-metric-previous">{metric.change}</span></p>}
  </>
}

function TargetMetric({ metric }: { metric: ResultMetric }) {
  const status = metric.targetStatus
  const StatusIcon = status ? targetIcons[status] : Target
  return <>
    <MetricFigure metric={metric} />
    <MetricCaption metric={metric} />
    {metric.progress !== undefined && <div className="result-metric-track" role="progressbar" aria-label={`${metric.label}进度`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(metric.progress)}><i style={{ width: `${Math.min(100, Math.max(0, metric.progress))}%` }} /></div>}
    <p className="result-metric-foot">
      {status && <span className="result-metric-target" data-status={status}><StatusIcon size={12} strokeWidth={2.2} aria-hidden="true" />{targetLabels[status]}</span>}
      {metric.target && <span className="result-metric-previous">目标 {metric.target}</span>}
      {!status && metric.change && <span className="result-metric-previous">{metric.change}</span>}
    </p>
  </>
}

function TextMetric({ metric }: { metric: ResultMetric }) {
  // A text metric is a fact, not a number: no unit or percent is appended by the reader.
  return <>
    <p className="result-metric-text">{metric.value}</p>
    <MetricCaption metric={metric} />
    {metric.change && <p className="result-metric-foot"><span className="result-metric-previous">{metric.change}</span></p>}
  </>
}

function MetricBody({ metric }: { metric: ResultMetric }) {
  const kind = resultMetricKind(metric)
  if (kind === 'comparison') return <ComparisonMetric metric={metric} />
  if (kind === 'status') return <StatusMetric metric={metric} />
  if (kind === 'target') return <TargetMetric metric={metric} />
  if (kind === 'text') return <TextMetric metric={metric} />
  return <>
    <MetricFigure metric={metric} />
    <MetricCaption metric={metric} />
    {metric.change && <p className="result-metric-foot"><span className="result-metric-previous">{metric.change}</span></p>}
  </>
}

function MetricCard({ metric }: { metric: ResultMetric }) {
  const kind = resultMetricKind(metric)
  return <article className="result-metric" data-kind={kind} data-tone={metric.tone} data-trend={metric.trend} data-emphasis={metric.emphasis}>
    <MetricBody metric={metric} />
  </article>
}

/** Metrics 7–12 become compact label/value data rows so twelve observations stay scannable. */
function CompactMetricRow({ metric }: { metric: ResultMetric }) {
  const kind = resultMetricKind(metric)
  const detail = kind === 'comparison'
    ? [metric.previous && `首轮 ${metric.previous}`, metric.change].filter(Boolean).join(' · ')
    : kind === 'target'
      ? [metric.targetStatus ? targetLabels[metric.targetStatus] : '', metric.target && `目标 ${metric.target}`,
        metric.progress !== undefined ? `${Math.round(metric.progress)}%` : ''].filter(Boolean).join(' · ')
      : metric.change
  const Icon = kind === 'status' ? toneIcons[metric.tone] : kind === 'target' && metric.targetStatus ? targetIcons[metric.targetStatus] : null
  return <li className="result-metric-row" data-kind={kind} data-tone={metric.tone} data-emphasis={metric.emphasis}>
    <span className="result-metric-row-label">{metric.label}</span>
    <span className="result-metric-row-value">
      {Icon && <Icon size={13} strokeWidth={2.2} aria-hidden="true" />}
      {kind === 'text' ? metric.value : <>{metric.value}<Unit unit={metric.unit} /></>}
    </span>
    {detail && <span className="result-metric-row-note">{detail}</span>}
  </li>
}

export function ResultMetrics({ metrics }: { metrics: readonly ResultMetric[] }) {
  if (!metrics.length) return null
  const dense = metrics.length >= 7
  return <div className="result-metrics" data-count={dense ? 'dense' : metrics.length}
    data-density={dense ? 'compact' : 'card'} data-lead={metrics.some(metric => metric.emphasis === 'primary') ? 'true' : undefined}>
    {dense
      ? <ul className="result-metric-rows">{metrics.map(metric => <CompactMetricRow key={metric.id} metric={metric} />)}</ul>
      : metrics.map(metric => <MetricCard key={metric.id} metric={metric} />)}
  </div>
}
