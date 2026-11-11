import { ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDashed, CircleX, Minus } from 'lucide-react'
import type { ResultMetric } from '@pawoffice/protocol/office-ui'
import { resultMetricKind } from '../results/format.ts'
import './ResultMetrics.css'

/**
 * Six data types, six shapes — the metric band is a typographic observation strip, not a KPI wall.
 *
 *   value      number first, unit small, label as caption
 *   comparison current figure, previous/change second, optional two-bar contrast
 *   status     state light + state text (never the number size)
 *   target     value + 目标 chip + optional thin scale with a target tick
 *   text       a fact sentence at 18px, never a number with an invented unit
 *   auto       resolved by resultMetricKind() before rendering — no raw auto shell
 *
 * `tone`/`trend`/`targetStatus` only choose semantic colour and an arrow direction; they never
 * reorder metrics or change a value. Density (1 / 2–3 / 4 / 5–6 / 7–12 rows) is pure presentation.
 */

type MetricKind = ReturnType<typeof resultMetricKind>

const trendIcons = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const
const targetIcons = { met: CheckCircle2, missed: CircleX, 'at-risk': CircleDashed } as const
const targetLabels = { met: '已达标', missed: '未达标', 'at-risk': '有风险' } as const

function Unit({ unit }: { unit: string }) {
  return unit ? <span className="result-metric-unit" data-tight={unit === '%' ? 'true' : undefined}>{unit}</span> : null
}

/**
 * Parses only plain observations such as "3.8", "2.9%" or "18 项" for a purely visual ratio.
 * Prose, ranges or anything ambiguous returns null, so no invented number can leak into the UI.
 */
function parseMetricNumber(value: string): number | null {
  const match = /^([+-]?\d+(?:\.\d+)?)\s*([^\d\s].{0,11})?$/.exec(value.trim())
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

/** A target tick is drawn only for a self-describing 0–100 percentage; "≤2s" gets no invented scale. */
function targetPercent(target: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*%$/.exec(target.trim())
  if (!match) return null
  const parsed = Number(match[1])
  return parsed >= 0 && parsed <= 100 ? parsed : null
}

function metricWithUnit(metric: ResultMetric) {
  if (!metric.unit) return metric.value
  return `${metric.value}${metric.unit === '%' ? '' : ' '}${metric.unit}`
}

function Figure({ metric, size }: { metric: ResultMetric; size: 'value' | 'comparison' }) {
  return <p className="result-metric-figure" data-size={size}>
    <strong className="result-metric-number">{metric.value}</strong><Unit unit={metric.unit} />
  </p>
}

function Caption({ metric }: { metric: ResultMetric }) {
  return <p className="result-metric-caption">{metric.label}</p>
}

/** Direction comes from `trend`; colour comes only from the backend `tone`, so "up" is not "good". */
function ChangeChip({ metric, size = 12 }: { metric: ResultMetric; size?: number }) {
  if (!metric.change) return null
  const Trend = trendIcons[metric.trend]
  return <span className="result-metric-change" data-tone={metric.tone} data-trend={metric.trend}>
    <Trend size={size} strokeWidth={2.4} aria-hidden="true" />{metric.change}
  </span>
}

/** Two thin bars are an extra visual read of the same two observations — no third number is shown. */
function ComparisonBars({ previous, current }: { previous: number; current: number }) {
  const max = Math.max(previous, current)
  if (!(max > 0)) return null
  const width = (value: number) => `${(Math.round(value / max * 1000) / 10)}%`
  return <div className="result-metric-bars" aria-hidden="true">
    <span className="result-metric-bar-row">
      <span className="result-metric-bar-label">前值</span>
      <span className="result-metric-bar"><i style={{ width: width(previous) }} /></span>
    </span>
    <span className="result-metric-bar-row">
      <span className="result-metric-bar-label">当前</span>
      <span className="result-metric-bar" data-current="true"><i style={{ width: width(current) }} /></span>
    </span>
  </div>
}

function ValueMetric({ metric }: { metric: ResultMetric }) {
  return <>
    <Figure metric={metric} size="value" />
    <Caption metric={metric} />
    {metric.change && <p className="result-metric-note">{metric.change}</p>}
  </>
}

function ComparisonMetric({ metric }: { metric: ResultMetric }) {
  const previousNumber = parseMetricNumber(metric.previous)
  const currentNumber = parseMetricNumber(metric.value)
  const showBars = previousNumber !== null && currentNumber !== null
    && previousNumber >= 0 && currentNumber >= 0 && Math.max(previousNumber, currentNumber) > 0
  return <>
    <Figure metric={metric} size="comparison" />
    <Caption metric={metric} />
    <div className="result-metric-compare" title={metric.previous ? `首轮 ${metric.previous} → 当前 ${metricWithUnit(metric)}` : undefined}>
      <ChangeChip metric={metric} size={13} />
      {metric.previous && <span className="result-metric-previous">首轮 {metric.previous}</span>}
    </div>
    {showBars && previousNumber !== null && currentNumber !== null && <ComparisonBars previous={previousNumber} current={currentNumber} />}
  </>
}

function StatusMetric({ metric }: { metric: ResultMetric }) {
  // A status is a state: light + word. It deliberately does not borrow the numeric figure size.
  return <>
    <p className="result-metric-status" data-tone={metric.tone}>
      <span className="result-metric-status-dot" aria-hidden="true" />
      <span className="result-metric-status-text">{metric.value}</span>
      <Unit unit={metric.unit} />
    </p>
    <Caption metric={metric} />
    {metric.change && <p className="result-metric-note">{metric.change}</p>}
  </>
}

function TargetMetric({ metric }: { metric: ResultMetric }) {
  const status = metric.targetStatus
  const StatusIcon = status ? targetIcons[status] : null
  const tick = metric.target ? targetPercent(metric.target) : null
  return <>
    <Figure metric={metric} size="value" />
    <Caption metric={metric} />
    <div className="result-metric-target-line">
      {metric.target && <span className="result-metric-target-chip">目标 {metric.target}</span>}
      {status && StatusIcon && <span className="result-metric-target-status" data-status={status}>
        <StatusIcon size={12} strokeWidth={2.2} aria-hidden="true" />{targetLabels[status]}
      </span>}
    </div>
    {metric.progress !== undefined && <div className="result-metric-scale" role="progressbar" aria-label={`${metric.label}进度`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(metric.progress)}>
      <i className="result-metric-scale-fill" data-tone={metric.tone}
        style={{ width: `${Math.min(100, Math.max(0, metric.progress))}%` }} />
      {tick !== null && <span className="result-metric-scale-tick" style={{ left: `${tick}%` }} aria-hidden="true" />}
    </div>}
    {!status && metric.change && <p className="result-metric-note">{metric.change}</p>}
  </>
}

function TextMetric({ metric }: { metric: ResultMetric }) {
  // A fact, not a figure: the reader never appends a unit or a percent sign to it.
  return <>
    <p className="result-metric-fact">{metric.value}</p>
    <Caption metric={metric} />
    {metric.change && <p className="result-metric-note">{metric.change}</p>}
  </>
}

function MetricBody({ metric }: { metric: ResultMetric }) {
  const kind: MetricKind = resultMetricKind(metric)
  if (kind === 'comparison') return <ComparisonMetric metric={metric} />
  if (kind === 'status') return <StatusMetric metric={metric} />
  if (kind === 'target') return <TargetMetric metric={metric} />
  if (kind === 'text') return <TextMetric metric={metric} />
  return <ValueMetric metric={metric} />
}

/** The card class string is exactly `result-metric`; per-kind state lives in data-* attributes. */
function MetricCard({ metric }: { metric: ResultMetric }) {
  const kind = resultMetricKind(metric)
  return <article className="result-metric" data-kind={kind} data-tone={metric.tone} data-trend={metric.trend} data-emphasis={metric.emphasis}>
    <MetricBody metric={metric} />
  </article>
}

/** 7–12 observations collapse to rows, but every row still speaks its own kind's language. */
function CompactMetricRow({ metric }: { metric: ResultMetric }) {
  const kind = resultMetricKind(metric)
  const Trend = trendIcons[metric.trend]
  const detail = kind === 'comparison'
    ? [metric.previous && `首轮 ${metric.previous}`, metric.change].filter(Boolean).join(' · ')
    : kind === 'target'
      ? [metric.targetStatus ? targetLabels[metric.targetStatus] : '', metric.target && `目标 ${metric.target}`,
        metric.progress !== undefined ? `${Math.round(metric.progress)}%` : ''].filter(Boolean).join(' · ')
      : metric.change
  return <li className="result-metric-row" data-kind={kind} data-tone={metric.tone} data-emphasis={metric.emphasis}>
    <span className="result-metric-row-label">{metric.label}</span>
    <span className="result-metric-row-value">
      {kind === 'status' && <span className="result-metric-row-dot" data-tone={metric.tone} aria-hidden="true" />}
      {kind === 'text' ? metric.value : <>{metric.value}<Unit unit={metric.unit} /></>}
      {kind === 'comparison' && metric.change && <Trend size={11} strokeWidth={2.4} aria-hidden="true" />}
      {kind === 'target' && metric.progress !== undefined && <span className="result-metric-row-scale" aria-hidden="true">
        <i style={{ width: `${Math.min(100, Math.max(0, metric.progress))}%` }} />
      </span>}
    </span>
    {detail && <span className="result-metric-row-note">{detail}</span>}
  </li>
}

export function ResultMetrics({ metrics }: { metrics: readonly ResultMetric[] }) {
  if (!metrics.length) return null
  const dense = metrics.length >= 7
  return <div className="result-metrics" data-count={dense ? 'dense' : String(metrics.length)}
    data-density={dense ? 'compact' : 'card'} data-lead={metrics.some(metric => metric.emphasis === 'primary') ? 'true' : undefined}>
    {dense
      ? <ul className="result-metric-rows">{metrics.map(metric => <CompactMetricRow key={metric.id} metric={metric} />)}</ul>
      : metrics.map(metric => <MetricCard key={metric.id} metric={metric} />)}
  </div>
}
