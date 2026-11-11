# PawOffice 成果阅读页重构 · 审核材料 B（源码 + 真实样例 + 变更证明）

> 审核对象：feat/result-board-design。本文件含本轮新增/重写的类型组件源码、两份用户真实样例（逐字节复制）、样式 token 摘要与「协议零改动」git 证明。
> 样式文件较大未内嵌（ResultWorkspace.css / ResultMetrics.css / ResultArtifactList.css / ResultSectionKinds.css / ResultReviewLog.css / ResultVersionTimeline.css / ResultChanges.css），需要时可在仓库查看。

## 1. 源码文件职责

| 文件 | 作用 |
| --- | --- |
| `apps/web/src/components/ResultWorkspace.tsx` | 页面组合：阅读模式（delivery/fact）、封面/结论/交付/审查/指标/sections/记录/追溯 |
| `apps/web/src/results/readingMode.ts` | 阅读重心派生（纯前端，不写回数据） |
| `apps/web/src/components/ResultMetrics.tsx` | 6 种 metric kind 专用形态 + 密度 |
| `apps/web/src/components/ResultArtifactList.tsx` | 4 种 artifact 交付语言 + 诚实回退 |
| `apps/web/src/components/ResultSectionCard.tsx` | 8 类 section；documents/files/gallery 重做 |
| `apps/web/src/components/ResultReviewLog.tsx` | 检查结论带/比例条/风险登记 |
| `apps/web/src/components/ResultVersionTimeline.tsx` | 版本时间线 |
| `apps/web/src/components/ResultChanges.tsx` | 代码变更清单 + 行内 diff |
| `apps/web/src/components/ResultDeliveryShell.tsx` | 历史交付切换/文件预览 Provider |
| `apps/web/src/components/WhiteboardReader.tsx` | 阅读器容器（dialog/Escape/焦点/导出） |
| `apps/web/src/results/board.ts` | 展示层派生（检查摘要/版本失效/精确文档关联/section 顺序） |
| `tests/resultBoard.test.mjs` | 既有 24 项 SSR 验收测试 |
| `tests/resultTypeVisual.test.mjs` | 本轮新增 8 项数据类型视觉测试 |

## 2. 关键源码

### `apps/web/src/components/ResultWorkspace.tsx`

```tsx
import type { ReactNode } from 'react'
import {
  ArrowRight, Check, Clock3, FileText, GitBranch, Info, ListChecks, ShieldAlert, UserRound, Users,
} from 'lucide-react'
import type {
  OfficeResult, ResultDecision, ResultTask, WhiteboardTaskBoardData,
} from '@pawoffice/protocol/office-ui'
import { ResultSectionCard } from './ResultSectionCard.tsx'
import { Chip, Track } from './ResultPrimitives.tsx'
import { ResultReader } from './ResultReader.tsx'
import { ResultDeliveryShell } from './ResultDeliveryShell.tsx'
import { ResultMetrics } from './ResultMetrics.tsx'
import { ResultArtifactList } from './ResultArtifactList.tsx'
import { ResultReviewLog } from './ResultReviewLog.tsx'
import { ResultVersionTimeline } from './ResultVersionTimeline.tsx'
import { WhiteboardBoardView } from './WhiteboardBoardView.tsx'
import { formatResultTimestamp, resultHasContent, resultTeamLabel } from '../results/format.ts'
import { boardStatusLabels, resultPresentation } from '../results/presentation.ts'
import {
  resultBoardChecks, resultBoardSections, resultChangedFileCount, resultCheckSummary,
  resultDocumentMetadata, resultSectionArtifact,
} from '../results/board.ts'
import { resultReadingMode } from '../results/readingMode.ts'
import './ResultWorkspace.css'

/** Kept for source compatibility with callers that still provide initialTab/onTabChange. No tabs are rendered. */
export type WorkspaceTab = 'overview' | 'deliverables' | 'process'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'
type StageState = 'done' | 'active' | 'pending'
type BoardStatus = NonNullable<WhiteboardTaskBoardData['status']>

const taskStatusLabels: Record<ResultTask['status'], string> = { todo: '待开始', doing: '进行中', blocked: '受阻', done: '已完成' }
const taskStatusTones: Record<ResultTask['status'], ChipTone> = { todo: 'pending', doing: 'active', blocked: 'danger', done: 'done' }

type WorkspaceProps = {
  board: WhiteboardTaskBoardData; result: OfficeResult; boardHtml?: string
  initialTab?: WorkspaceTab
  initialDeliveryId?: string
  onTabChange?: (tab: WorkspaceTab) => void
}

/** Three-stage board progress; the backend state wins, progress only fills the gap. */
function StageSteps({ steps, status }: { steps: WhiteboardTaskBoardData['steps']; status?: BoardStatus }) {
  if (!steps.length) return null
  const values = steps.map(step => step.progress ?? -1)
  const firstOpen = values.findIndex(value => value < 100)
  return <ol className="result-workspace-stage-list" data-count={steps.length}>
    {steps.map((step, index) => {
      const progress = values[index]
      const state: StageState = step.state ?? (progress >= 100 ? 'done' : status === 'running' && index === firstOpen ? 'active' : 'pending')
      const known = progress >= 0
      return <li key={step.id} className="result-workspace-stage-step" data-state={state}>
        <div className="result-workspace-stage-head">
          <span className="result-workspace-stage-dot" aria-hidden="true">
            {state === 'done' ? <Check size={12} strokeWidth={2.8} /> : index + 1}
          </span>
          <span className="result-workspace-stage-title" title={step.title}>{step.title}</span>
          <span className="result-workspace-stage-value">{known ? `${Math.round(progress)}%` : '—'}</span>
        </div>
        <Track value={progress} label={`${step.title}进度`} tone={state === 'done' ? 'done' : state} unknown={!known} />
      </li>
    })}
  </ol>
}

function TaskRow({ task }: { task: ResultTask }) {
  return <li className="result-workspace-task" data-status={task.status}>
    <div className="result-workspace-task-head">
      <span className="result-workspace-task-title" title={task.title}>{task.title}</span>
      {task.owner && <span className="result-workspace-task-owner"><UserRound size={12} strokeWidth={2} aria-hidden="true" />{task.owner}</span>}
      <Chip tone={taskStatusTones[task.status]}>{taskStatusLabels[task.status]}</Chip>
    </div>
    {task.progress !== undefined && <div className="result-workspace-task-progress">
      <Track value={task.progress} label={`${task.title}进度`} tone={task.status === 'blocked' ? 'danger' : task.status === 'done' ? 'done' : task.status === 'todo' ? 'pending' : 'active'} />
      <small>{Math.round(task.progress)}%</small>
    </div>}
    {task.note && <p className="result-workspace-task-note">{task.note}</p>}
  </li>
}

function DecisionRow({ decision }: { decision: ResultDecision }) {
  return <li className="result-workspace-decision">
    <p className="result-workspace-decision-question">{decision.question}</p>
    <p className="result-workspace-decision-choice"><strong>{decision.choice}</strong>{decision.at && <time>{decision.at}</time>}</p>
  </li>
}

/** A quiet label row replaces the old per-block card header: one label, one count, no container. */
function LabelRow({ title, aside, children }: {
  title: string; aside?: string; children?: ReactNode
}) {
  return <header className="result-workspace-label">
    <h3 className="result-workspace-label-title">{title}</h3>
    {aside && <p className="result-workspace-label-aside">{aside}</p>}
    {children}
  </header>
}

export function ResultWorkspace(props: WorkspaceProps) {
  return <ResultDeliveryShell board={props.board} result={props.result} initialDeliveryId={props.initialDeliveryId}>
    {(board, result, historical, executionKnown) =>
      <ResultWorkspaceBody board={board} result={result} historical={historical} executionKnown={executionKnown} boardHtml={historical ? undefined : props.boardHtml} />}
  </ResultDeliveryShell>
}

function ResultWorkspaceBody({ board, result, historical, executionKnown }: WorkspaceProps & { historical: boolean; executionKnown: boolean }) {
  const statusKnown = executionKnown && typeof board.status === 'string'
  const boardStatus: BoardStatus = board.status ?? 'queued'
  const presentation = resultPresentation(board, result)
  const hasResult = resultHasContent(result)
  const checks = resultBoardChecks(result)
  const checkSummary = resultCheckSummary(checks)
  const openRisks = result.risks.filter(risk => risk.status !== 'closed').length
  const blockedTasks = result.tasks.filter(task => task.status === 'blocked').length
  const attentionCount = checkSummary.pending + checkSummary.failed + checkSummary.stale + openRisks + blockedTasks
  const artifacts = result.artifacts
  const documentMeta = resultDocumentMetadata(result)
  const sections = resultBoardSections(result)
  const changeCount = resultChangedFileCount(result)
  const title = result.title || board.title || '当前成果'
  const teamLabel = resultTeamLabel(result)
  const summary = result.summary.trim()
  const goal = (board.description ?? '').trim()
  const showGoal = Boolean(goal && goal !== summary && goal !== result.verdict.trim())
  const readingMode = resultReadingMode(result)
  const hasDelivery = artifacts.length > 0
  const hasReview = checks.length > 0 || Boolean(result.verdict) || result.risks.length > 0
  const hasRecords = result.decisions.length > 0 || result.tasks.length > 0
  const hasTrail = Boolean(board.detailSections?.length) || (statusKnown && board.steps.length > 0)
  const attentionParts = [
    checkSummary.pending ? `${checkSummary.pending} 项待处理检查` : '',
    checkSummary.failed ? `${checkSummary.failed} 项未通过检查` : '',
    checkSummary.stale ? `${checkSummary.stale} 项待补充验证` : '',
    openRisks ? `${openRisks} 项待处理风险` : '',
    blockedTasks ? `${blockedTasks} 项受阻任务` : '',
  ].filter(Boolean)
  const outsizedTitle = title.length > 48

  const deliveryBlock = hasDelivery ? <section className="result-workspace-delivery" aria-label="本轮交付">
    <LabelRow title="本轮交付" aside={[
      artifacts.length ? `${artifacts.length} 份交付文件` : '',
      changeCount ? `${changeCount} 个文件变更` : '',
    ].filter(Boolean).join(' · ')} />
    {artifacts.length > 0
      ? <ResultArtifactList artifacts={artifacts} documentMeta={documentMeta} />
      : <p className="result-workspace-hint">本轮没有文件交付，工作成果以变更记录与正文呈现。</p>}
  </section> : null

  const reviewBlock = hasReview ? <section className="result-workspace-review" aria-label="验证与验收">
    <LabelRow title="验证与验收">
      <p className="result-workspace-caption" data-state={presentation.key}>{presentation.description}</p>
    </LabelRow>
    <ResultReviewLog result={result} />
  </section> : null

  const metricsBlock = result.metrics.length > 0 ? <section className="result-workspace-metric-band" aria-label={result.metricsTitle || '关键指标'}>
    <LabelRow title={result.metricsTitle || '关键指标'} aside={result.metricsCaption || undefined} />
    <ResultMetrics metrics={result.metrics} />
  </section> : null

  const sectionsBlock = sections.length > 0 ? <section className="result-workspace-detail" data-reading-mode={readingMode} aria-label={readingMode === 'fact' ? '说明与结论' : '详细内容'}>
    {readingMode === 'fact' && <LabelRow title="说明与结论" aside={`${sections.length} 项`} />}
    {sections.map(section => <ResultSectionCard key={section.id} section={section} artifacts={artifacts}
      sourceArtifact={resultSectionArtifact(result, section)} />)}
  </section> : null

  const recordsBlock = (hasRecords || result.versions.length > 0) ? <section className="result-workspace-records" aria-label="工作过程">
    <LabelRow title="工作过程" aside={[
      result.decisions.length ? `决策 ${result.decisions.length}` : '',
      result.tasks.length ? `任务 ${result.tasks.length}` : '',
      result.versions.length ? `版本 ${result.versions.length}` : '',
    ].filter(Boolean).join(' · ')} />
    {hasRecords && <div className="result-workspace-record-grid">
      {result.decisions.length > 0 && <div className="result-workspace-record">
        <h4 className="result-workspace-subhead"><ListChecks size={14} strokeWidth={2} aria-hidden="true" />决策记录</h4>
        <ol className="result-workspace-decisions">{result.decisions.map(decision => <DecisionRow key={decision.id} decision={decision} />)}</ol>
      </div>}
      {result.tasks.length > 0 && <div className="result-workspace-record">
        <h4 className="result-workspace-subhead"><UserRound size={14} strokeWidth={2} aria-hidden="true" />任务推进</h4>
        <ul className="result-workspace-tasks">{result.tasks.map(task => <TaskRow key={task.id} task={task} />)}</ul>
      </div>}
    </div>}
    {result.versions.length > 0 && <div className="result-workspace-record result-workspace-record-versions">
      <h4 className="result-workspace-subhead"><GitBranch size={14} strokeWidth={2} aria-hidden="true" />版本记录</h4>
      <ResultVersionTimeline result={result} />
    </div>}
  </section> : null

  const nextBlock = result.next.length > 0 ? <section className="result-workspace-next" aria-label="下一步">
    <LabelRow title="下一步" aside={`${result.next.length} 项行动`} />
    <ol className="result-workspace-next-list">{result.next.map((item, index) => <li key={`${index}-${item}`}>
      <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{item}</p>
    </li>)}</ol>
  </section> : null

  const trailBlock = hasTrail ? <section className="result-workspace-trail" aria-label="执行过程与任务详情">
    {statusKnown && board.steps.length > 0 && <details className="result-workspace-disclosure">
      <summary><ArrowRight size={14} strokeWidth={2} aria-hidden="true" />执行阶段<span>{board.steps.length}</span></summary>
      <StageSteps steps={board.steps} status={boardStatus} />
    </details>}
    {Boolean(board.detailSections?.length) && <details className="result-workspace-disclosure">
      <summary><FileText size={14} strokeWidth={2} aria-hidden="true" />任务详情与协作</summary>
      <WhiteboardBoardView sections={board.detailSections ?? []} />
    </details>}
  </section> : null

  return <div className="result-workspace" data-result-status={presentation.key} data-status={boardStatus}
    data-reading-mode={readingMode} data-historical={historical ? 'true' : undefined}>
    <header className="result-workspace-head">
      <div className="result-workspace-head-main">
        <h2 className="result-workspace-title" data-long={outsizedTitle ? 'true' : undefined} title={title}>{title}</h2>
      </div>
      {hasResult && <div className="result-workspace-actions"><ResultReader result={result} view="actions" /></div>}
    </header>
    <p className="result-workspace-meta">
      <span className="result-workspace-result-status" data-status={presentation.key} role="status" title={presentation.description}>
        <i aria-hidden="true" />成果 · {presentation.label}
      </span>
      {result.owner && <span className="result-workspace-meta-item"><UserRound size={12} aria-hidden="true" />{result.owner}</span>}
      {teamLabel && <span className="result-workspace-meta-item"><Users size={12} aria-hidden="true" />{teamLabel}</span>}
      {(result.producedAt || result.updatedAt) && <span className="result-workspace-meta-item">
        {result.producedAt && <><Clock3 size={12} aria-hidden="true" /><span className="result-workspace-meta-label">产出</span>
          <time dateTime={result.producedAt} title="产出时间（本地时区）">{formatResultTimestamp(result.producedAt)}</time></>}
        {result.producedAt && result.updatedAt && <span className="result-workspace-meta-dot" aria-hidden="true" />}
        {result.updatedAt && <><span className="result-workspace-meta-label">更新</span>
          <time dateTime={result.updatedAt} title="更新时间（本地时区）">{formatResultTimestamp(result.updatedAt)}</time></>}
      </span>}
      <span className="result-workspace-execution" data-status={statusKnown ? boardStatus : undefined}>
        <i aria-hidden="true" />{statusKnown ? `任务 · ${boardStatusLabels[boardStatus]}` : '任务状态未提供'}
      </span>
    </p>

    <section className="result-workspace-abstract" aria-label="本轮结论">
      {summary
        ? <p className="result-workspace-conclusion">{summary}</p>
        : <p className="result-workspace-conclusion is-neutral">
          {hasResult ? '本轮成果未提供摘要，请从下方的交付内容与验证记录开始阅读。' : presentation.description}
        </p>}
      {showGoal && <p className="result-workspace-goal"><span>任务目标</span>{goal}</p>}
      {result.verdict && <p className="result-workspace-verdict" data-state={presentation.key}>
        <span className="result-workspace-verdict-label">验收意见</span>{result.verdict}
      </p>}
      {attentionCount > 0 && <p className="result-workspace-glance">
        <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />
        <span><strong>需要关注 {attentionCount} 项</strong>：{attentionParts.join(' · ')}</span>
      </p>}
    </section>

    {readingMode === 'delivery'
      ? <>{deliveryBlock}{reviewBlock}{metricsBlock}{sectionsBlock}{recordsBlock}{nextBlock}</>
      : <>{sectionsBlock}{metricsBlock}{reviewBlock}{recordsBlock}{nextBlock}</>}

    {trailBlock}
    {result.note && <p className="result-workspace-note"><Info size={14} strokeWidth={2} aria-hidden="true" /><span>{result.note}</span></p>}
    {!hasResult && <p className="result-workspace-empty">当前没有可阅读的成果内容。任务推进并交付后，结果会显示在这里。</p>}
  </div>
}
```

### `apps/web/src/results/readingMode.ts`

```ts
import type { OfficeResult } from '@pawoffice/protocol/office-ui'
import { resultChangedFileCount } from './board.ts'

/** Two reading focuses derived from the existing fields; nothing is stored or sent back. */
export type ResultReadingMode = 'delivery' | 'fact'

const deliverySectionKinds = new Set(['documents', 'files', 'changes', 'api', 'environments', 'gallery'])

/** Delivery-first when the result actually carries files or structured deliverables. */
export function resultHasDeliverables(result: OfficeResult) {
  return result.artifacts.length > 0
    || resultChangedFileCount(result) > 0
    || result.sections.some(section => deliverySectionKinds.has(section.kind))
}

/**
 * `delivery`: the reader leads with what was handed over.
 * `fact`: there are no deliverables, so the conclusion and prose sections carry the reading.
 */
export function resultReadingMode(result: OfficeResult): ResultReadingMode {
  return resultHasDeliverables(result) ? 'delivery' : 'fact'
}

export const readingModeLabels: Record<ResultReadingMode, string> = {
  delivery: '交付型成果',
  fact: '说明型成果',
}
```

### `apps/web/src/components/ResultMetrics.tsx`

```tsx
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
```

### `apps/web/src/components/ResultArtifactList.tsx`

```tsx
import { useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, Download, ExternalLink, FileText, Image as ImageIcon, Link2, Table2 } from 'lucide-react'
import type { ResultArtifact } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { artifactIsText } from '../results/resources.ts'
import { downloadArtifact } from '../results/download.ts'
import { formatResultTimestamp } from '../results/format.ts'
import type { ResultDocumentMetadata } from '../results/board.ts'
import { ResultMarkdown } from './ResultMarkdown.tsx'
import './ResultArtifactList.css'

const artifactGlyphs = { document: FileText, image: ImageIcon, link: Link2, data: Table2 } as const
const changeLabels = { added: '本次新增', updated: '本次更新', removed: '本次移除（保留历史版本）', unchanged: '沿用已有版本' } as const
const documentStatusLabels = { done: '已完成', active: '进行中', pending: '待开始' } as const

/** Content format shown for `data` artifacts, derived only from the existing mimeType. */
const dataFormatLabels = { json: 'JSON', csv: 'CSV', sheet: '表格', text: '文本', unknown: '未知' } as const
type DataFormat = keyof typeof dataFormatLabels

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function isDisplayableImage(artifact: ResultArtifact) {
  return artifact.kind === 'image' && isHttpUrl(artifact.url)
}

function dataFormatOf(mimeType: string): DataFormat {
  const mime = mimeType.toLowerCase().split(';')[0].trim()
  if (mime === 'application/json' || mime.endsWith('+json')) return 'json'
  if (mime === 'text/csv') return 'csv'
  if (mime === 'text/tab-separated-values' || mime.includes('spreadsheet') || mime.includes('ms-excel') || mime.includes('excel') || mime.includes('sheet')) return 'sheet'
  if (mime.startsWith('text/')) return 'text'
  return 'unknown'
}

/** Domain chip for the existing link URL, never a second source of truth. */
function linkDomain(url: string) {
  if (!isHttpUrl(url)) return ''
  try { return new URL(url).hostname.replace(/^www\./i, '') } catch { return '' }
}

function artifactVersionLabel(artifact: ResultArtifact, metadata?: ResultDocumentMetadata) {
  return artifact.version || metadata?.version || artifact.versionId || ''
}

/** One moment only: the explicit document record time wins, producedAt is a fallback (no duplicate time). */
function artifactTimeLabel(artifact: ResultArtifact, metadata?: ResultDocumentMetadata) {
  if (metadata?.at) return metadata.at
  return artifact.producedAt ? formatResultTimestamp(artifact.producedAt) : ''
}

export function ResultArtifactList({ artifacts, documentMeta }: {
  artifacts: readonly ResultArtifact[]
  documentMeta?: ReadonlyMap<string, ResultDocumentMetadata>
}) {
  const preview = useContext(ArtifactPreviewContext)
  const [expanded, setExpanded] = useState('')
  const [copied, setCopied] = useState('')
  const [downloadError, setDownloadError] = useState('')
  // A legal URL can still 404; the row then falls back to the same dashed placeholder as an empty image.
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!artifacts.length) return null

  const markImageFailed = (id: string) => {
    setFailedImages(current => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      return next
    })
  }

  const copy = async (artifact: ResultArtifact) => {
    try {
      await navigator.clipboard.writeText(artifact.content)
      setCopied(artifact.id)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(''), 1800)
    } catch { setCopied('') }
  }

  return <div className="result-deliverables">
    {downloadError && <p className="result-deliverable-error" role="alert">{downloadError}</p>}
    <span className="result-sr-only" role="status">{copied ? '已复制到剪贴板' : ''}</span>
    <ul className="result-deliverable-list">
      {artifacts.map(artifact => {
        const metadata = documentMeta?.get(artifact.id)
        // Preview only when the exact version actually has inline text or a legal http(s) source.
        const versioned = Boolean(preview && artifact.versionId && (artifact.content || isHttpUrl(artifact.url)))
        const canExpand = !versioned && Boolean(artifact.content) && artifactIsText(artifact)
        const open = expanded === artifact.id
        const legalUrl = isHttpUrl(artifact.url)
        const hasImageUrl = isDisplayableImage(artifact)
        const showImage = hasImageUrl && !failedImages.has(artifact.id)
        const versionLabel = artifactVersionLabel(artifact, metadata)
        const timeLabel = artifactTimeLabel(artifact, metadata)
        const stateLabel = metadata ? documentStatusLabels[metadata.status] : ''
        const dataFormat = artifact.kind === 'data' ? dataFormatOf(artifact.mimeType) : undefined
        const domain = artifact.kind === 'link' ? linkDomain(artifact.url) : ''
        const KindIcon = artifactGlyphs[artifact.kind]

        const primaryAction = (): ReactNode => {
          if (artifact.kind === 'image') {
            if (versioned && preview) {
              return <button type="button" className="result-deliverable-action is-primary" aria-haspopup="dialog"
                onClick={event => preview.open(artifact, event.currentTarget)}>查看大图</button>
            }
            if (legalUrl) {
              return <a className="result-deliverable-action is-primary" href={artifact.url} target="_blank" rel="noopener noreferrer">
                打开原图<ExternalLink size={12} aria-hidden="true" /></a>
            }
            return <span className="result-deliverable-action is-disabled" aria-disabled="true">暂无图片可预览</span>
          }
          if (artifact.kind === 'link') {
            if (legalUrl) {
              return <a className="result-deliverable-action is-primary" href={artifact.url} target="_blank" rel="noopener noreferrer">
                打开链接<ExternalLink size={12} aria-hidden="true" /></a>
            }
            if (versioned && preview) {
              return <button type="button" className="result-deliverable-action is-primary" aria-haspopup="dialog"
                onClick={event => preview.open(artifact, event.currentTarget)}>阅读</button>
            }
            return <span className="result-deliverable-action is-disabled" aria-disabled="true">未提供可用链接</span>
          }
          if (versioned && preview) {
            return <button type="button" className="result-deliverable-action is-primary" aria-haspopup="dialog"
              onClick={event => preview.open(artifact, event.currentTarget)}>阅读</button>
          }
          if (canExpand) {
            return <button type="button" className="result-deliverable-action is-primary" aria-expanded={open}
              onClick={() => setExpanded(current => current === artifact.id ? '' : artifact.id)}>{open ? '收起正文' : '阅读'}</button>
          }
          if (legalUrl) {
            return <a className="result-deliverable-action is-primary" href={artifact.url} target="_blank" rel="noopener noreferrer">
              打开<ExternalLink size={12} aria-hidden="true" /></a>
          }
          return <span className="result-deliverable-action is-disabled" aria-disabled="true">暂无正文或文件地址</span>
        }

        return <li key={artifact.id} className="result-deliverable" data-kind={artifact.kind}
          data-change={artifact.change || undefined} data-status={metadata?.status || undefined}
          data-format={dataFormat} data-source={artifact.kind === 'link' ? (legalUrl ? 'url' : 'none') : undefined}>
          {artifact.kind === 'image' && <div className="result-deliverable-media" data-placeholder={showImage ? undefined : 'true'}>
            {showImage
              ? <img className="result-deliverable-thumb" src={artifact.url} alt="" loading="lazy" aria-hidden="true"
                onError={() => markImageFailed(artifact.id)} />
              : <ImageIcon size={21} strokeWidth={1.7} aria-hidden="true" />}
          </div>}
          <div className="result-deliverable-main">
            <div className="result-deliverable-heading">
              {artifact.kind !== 'image' && <span className="result-deliverable-glyph" aria-hidden="true">
                <KindIcon size={17} strokeWidth={1.9} />
              </span>}
              <span className="result-deliverable-title" title={artifact.title}>{artifact.title}</span>
              {versionLabel && <span className="result-deliverable-version" title="版本">{versionLabel}</span>}
              {domain && <span className="result-deliverable-domain" title={artifact.url}>
                {domain}<ExternalLink size={11} aria-hidden="true" /></span>}
              {dataFormat && <span className="result-deliverable-format" data-format={dataFormat}>{dataFormatLabels[dataFormat]}</span>}
              {artifact.change && <span className="result-deliverable-change" data-change={artifact.change}>{changeLabels[artifact.change]}</span>}
            </div>
            {(timeLabel || stateLabel || artifact.description) && <p className="result-deliverable-line">
              {timeLabel && <span className="result-deliverable-time">{timeLabel}</span>}
              {stateLabel && <span className="result-deliverable-state" data-status={metadata?.status}>{stateLabel}</span>}
              {artifact.description && <span className="result-deliverable-description" title={artifact.description}>{artifact.description}</span>}
            </p>}
            {canExpand && open && <div className="result-deliverable-body"><ResultMarkdown content={artifact.content} /></div>}
          </div>
          <div className="result-deliverable-actions">
            {primaryAction()}
            {artifact.content && <button type="button" className="result-deliverable-action" onClick={() => { void copy(artifact) }}>
              {copied === artifact.id ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{copied === artifact.id ? '已复制' : '复制'}</button>}
            {(artifact.content || legalUrl) && <button type="button" className="result-deliverable-action"
              onClick={() => { setDownloadError(''); void downloadArtifact(artifact).catch(error => setDownloadError(error instanceof Error ? error.message : '下载失败')) }}>
              <Download size={12} aria-hidden="true" />下载</button>}
          </div>
        </li>
      })}
    </ul>
  </div>
}
```

### `apps/web/src/components/ResultSectionCard.tsx`

```tsx
import { useContext, useId, useState } from 'react'
import { CheckCircle2, CircleDashed, CircleX, ClipboardCheck, ExternalLink, File, FileArchive, FileBarChart, FileDiff, FileText, FolderOpen, Gauge, Images, Image as ImageIcon, LayoutGrid, Server, Webhook } from 'lucide-react'
import type { ResultArtifact, ResultApiSection, ResultDocumentsSection, ResultEnvironmentsSection, ResultFilesSection, ResultGallerySection, ResultSection, ResultTestsSection } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { CustomSectionBody } from './ResultBlocks.tsx'
import { ResultChanges } from './ResultChanges.tsx'
import { Chip, Track } from './ResultPrimitives.tsx'
import './ResultSectionKinds.css'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'
const galleryStatusLabels: Record<ResultGallerySection['items'][number]['status'], string> = {
  done: '已完成', active: '开发中', pending: '待开始',
}
const documentStatusLabels: Record<ResultDocumentsSection['items'][number]['status'], string> = {
  done: '已完成', active: '进行中', pending: '待开始',
}
const apiStatusLabels: Record<ResultApiSection['rows'][number]['status'], string> = {
  done: '已完成', active: '开发中', pending: '待发布',
}
const environmentStatusLabels: Record<ResultEnvironmentsSection['items'][number]['status'], string> = {
  running: '运行中', pending: '待发布', stopped: '已停止', failed: '需关注',
}
const galleryStatusTones: Record<ResultGallerySection['items'][number]['status'], ChipTone> = {
  done: 'done', active: 'active', pending: 'pending',
}
const apiStatusTones: Record<ResultApiSection['rows'][number]['status'], ChipTone> = {
  done: 'done', active: 'active', pending: 'pending',
}
const checkStatusLabels: Record<ResultTestsSection['checks'][number]['status'], string> = {
  passed: '已通过', pending: '待补充', failed: '未通过',
}
const fileKindLabels: Record<ResultFilesSection['items'][number]['kind'], string> = {
  image: '图片', document: '文档', report: '报告', archive: '压缩包', other: '文件',
}

const sectionIcons = {
  gallery: Images, documents: FileText, tests: ClipboardCheck, api: Webhook, environments: Server, files: FolderOpen,
  changes: FileDiff, custom: LayoutGrid,
} as const
const metricToneIcons = { positive: CheckCircle2, negative: CircleX, neutral: Gauge } as const
const checkIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const
const fileKindIcons = { image: ImageIcon, document: FileText, report: FileBarChart, archive: FileArchive, other: File } as const

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

/**
 * Gallery: an adaptive image grid. A legal image URL becomes a real thumbnail that opens the source
 * in a new window; anything else keeps a neutral placeholder and says 暂无预览 instead of inventing an
 * image. Item order is the source order — the grid only reflows, it never sorts.
 */
function GalleryBody({ section }: { section: ResultGallerySection }) {
  // A legal URL can still fail to load; that item then uses the same dashed placeholder as an empty one.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const markFailed = (id: string) => {
    setFailed(current => {
      if (current.has(id)) return current
      const next = new Set(current)
      next.add(id)
      return next
    })
  }
  return <ul className="result-workspace-gallery">
    {section.items.map(item => {
      const hasImage = isHttpUrl(item.image) && !failed.has(item.id)
      return <li key={item.id} className="result-workspace-gallery-item" data-status={item.status}
        data-preview={hasImage ? 'true' : undefined} title={item.title}>
        <div className="result-workspace-thumb" data-placeholder={hasImage ? undefined : 'true'}>
          {hasImage
            ? <a href={item.image} target="_blank" rel="noopener noreferrer" aria-label={`查看${item.title}原图（新窗口）`}>
              <img src={item.image} alt={item.title} loading="lazy" onError={() => markFailed(item.id)} />
            </a>
            : <span className="result-workspace-thumb-placeholder" aria-hidden="true"><ImageIcon size={22} strokeWidth={1.7} /></span>}
        </div>
        <div className="result-workspace-gallery-meta">
          <span className="result-workspace-gallery-label">{item.title}</span>
          {item.meta && <span className="result-workspace-gallery-note">{item.meta}</span>}
          {!hasImage && <small className="result-workspace-gallery-empty">暂无预览</small>}
          <span className="result-workspace-kind-chip" data-tone={galleryStatusTones[item.status]}>{galleryStatusLabels[item.status]}</span>
        </div>
      </li>
    })}
  </ul>
}

/**
 * Documents: version file rows. A row opens the shared preview entry only when the counterpart in
 * 本轮交付 is the same artifactId + versionId — titles never create a link. Unmatched rows stay as
 * honest plain text with the reason they cannot open.
 */
function DocumentsBody({ section, artifacts }: { section: ResultDocumentsSection; artifacts?: readonly ResultArtifact[] }) {
  const preview = useContext(ArtifactPreviewContext)
  return <ul className="result-workspace-docs">
    {section.items.map(item => {
      const matched = artifacts?.find(artifact => artifact.id === item.artifactId
        && item.versionId !== '' && artifact.versionId === item.versionId)
      const openable = Boolean(matched && preview)
      const meta = [item.version, item.at, documentStatusLabels[item.status]].filter(Boolean).join(' · ')
      return <li key={item.id} className="result-workspace-doc" data-status={item.status}
        data-linked={openable ? 'true' : 'false'}>
        <span className="result-workspace-doc-glyph" aria-hidden="true"><FileText size={16} strokeWidth={1.9} /></span>
        {openable
          ? <button type="button" className="result-workspace-doc-open" aria-haspopup="dialog" title={[item.title, meta].filter(Boolean).join(' · ')}
            onClick={event => preview!.open(matched!, event.currentTarget)}>
            <span className="result-workspace-doc-title">{item.title}</span>
            {item.version && <span className="result-workspace-doc-version">{item.version}</span>}
          </button>
          : <span className="result-workspace-doc-plain" title={[item.title, meta].filter(Boolean).join(' · ')}>
            <span className="result-workspace-doc-title">{item.title}</span>
            {item.version && <span className="result-workspace-doc-version">{item.version}</span>}
            <small className="result-workspace-doc-reason">{item.artifactId ? '关联文件不在本轮交付中' : '文档说明（未关联文件）'}</small>
          </span>}
        {item.at && <time className="result-workspace-doc-time">{item.at}</time>}
        <span className="result-workspace-doc-state" data-status={item.status}>{documentStatusLabels[item.status]}</span>
      </li>
    })}
  </ul>
}

function TestsBody({ section }: { section: ResultTestsSection }) {
  return <div className="result-workspace-tests">
    {section.metrics.length > 0 && <div className="result-workspace-stats">
      {section.metrics.map(metric => {
        const Icon = metricToneIcons[metric.tone]
        return <div key={metric.id} className="result-workspace-stat" data-tone={metric.tone}>
          <span className="result-workspace-stat-label"><Icon size={12} strokeWidth={2} aria-hidden="true" />{metric.label}</span>
          <span className="result-workspace-stat-value">{metric.value}{metric.unit && <em>{metric.unit}</em>}</span>
        </div>
      })}
    </div>}
    {section.progress !== undefined && <div className="result-workspace-tests-progress">
      <div className="result-workspace-progress-head">
        <span>{section.progressLabel || '测试进度'}</span>
        <strong>{Math.round(section.progress)}%</strong>
      </div>
      <Track value={section.progress} label={section.progressLabel || '测试进度'} />
    </div>}
    {section.checks.length > 0 && <ul className="result-workspace-checks">
      {section.checks.map(check => {
        const Icon = checkIcons[check.status]
        return <li key={check.id} data-status={check.status}>
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
          <span>{check.label}</span>
          <em>{checkStatusLabels[check.status]}</em>
        </li>
      })}
    </ul>}
  </div>
}

function ApiBody({ section }: { section: ResultApiSection }) {
  return <div className="result-workspace-table-wrap">
    <table className="result-workspace-table">
      <caption className="result-workspace-sr-only">{section.title}接口列表</caption>
      <thead>
        <tr><th scope="col">接口地址</th><th scope="col">方法</th><th scope="col">状态</th><th scope="col">更新时间</th></tr>
      </thead>
      <tbody>
        {section.rows.map(row => <tr key={row.id}>
          <td><code className="result-workspace-endpoint">{row.endpoint}</code></td>
          <td><span className="result-workspace-method" data-method={row.method}>{row.method}</span></td>
          <td><Chip tone={apiStatusTones[row.status]}>{apiStatusLabels[row.status]}</Chip></td>
          <td className="result-workspace-time">{row.at || '—'}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

function EnvironmentsBody({ section }: { section: ResultEnvironmentsSection }) {
  return <ul className="result-workspace-envs">
    {section.items.map(item => <li key={item.id} className="result-workspace-env" data-status={item.status}>
      <span className="result-workspace-dot" aria-hidden="true" />
      <span className="result-workspace-env-name" title={item.name}>{item.name}</span>
      {item.version && <span className="result-workspace-version-chip">{item.version}</span>}
      <span className="result-workspace-env-time">{item.at || '—'}</span>
      <span className="result-workspace-env-state">{environmentStatusLabels[item.status]}</span>
    </li>)}
  </ul>
}

/**
 * Files: attachment rows in the delivery language — type glyph, name, category and size. Only a legal
 * http(s) URL opens; an attachment bound to an artifact stays a plain row instead of a fake download.
 */
function FilesBody({ section }: { section: ResultFilesSection }) {
  return <ul className="result-workspace-files">
    {section.items.map(item => {
      const Icon = fileKindIcons[item.kind]
      const openable = isHttpUrl(item.url) && !item.artifactId
      const body = <>
        <span className="result-workspace-file-icon" data-kind={item.kind} aria-hidden="true"><Icon size={16} strokeWidth={1.9} /></span>
        <span className="result-workspace-file-name" title={item.name}>{item.name}</span>
        <span className="result-workspace-file-kind" data-kind={item.kind}>{fileKindLabels[item.kind]}</span>
        {item.size && <span className="result-workspace-file-size">{item.size}</span>}
        {openable && <ExternalLink className="result-workspace-file-open" size={13} strokeWidth={2} aria-hidden="true" />}
      </>
      return <li key={item.id} className="result-workspace-file" data-kind={item.kind} data-linked={openable ? 'true' : undefined}>
        {openable
          ? <a className="result-workspace-file-card" href={item.url} target="_blank" rel="noopener noreferrer"
            aria-label={`${item.name}（${fileKindLabels[item.kind]}），在新窗口打开`}>{body}</a>
          : <div className="result-workspace-file-card" title={item.name}>{body}</div>}
      </li>
    })}
  </ul>
}

function SectionBody({ section, artifacts }: { section: ResultSection; artifacts?: readonly ResultArtifact[] }) {
  switch (section.kind) {
    case 'gallery': return <GalleryBody section={section} />
    case 'documents': return <DocumentsBody section={section} artifacts={artifacts} />
    case 'tests': return <TestsBody section={section} />
    case 'api': return <ApiBody section={section} />
    case 'environments': return <EnvironmentsBody section={section} />
    case 'files': return <FilesBody section={section} />
    case 'changes': return <ResultChanges section={section} />
    case 'custom': return <CustomSectionBody section={section} />
  }
}

export function ResultSectionCard({ section, sourceArtifact, artifacts }: {
  section: ResultSection; sourceArtifact?: ResultArtifact; artifacts?: readonly ResultArtifact[]
}) {
  const preview = useContext(ArtifactPreviewContext)
  const headingId = useId()
  const Icon = sectionIcons[section.kind]
  return <section className="result-workspace-card" data-kind={section.kind} data-column={section.column}
    data-span={section.span} data-emphasis={section.emphasis} aria-labelledby={headingId}>
    <header className="result-workspace-card-head">
      <span className="result-workspace-card-icon" aria-hidden="true"><Icon size={14} strokeWidth={2} /></span>
      <h3 id={headingId}>{section.title}</h3>
      {section.caption && !/^(查看全部|查看详情|上传文件)\s*[→↗]?$/.test(section.caption.trim()) && <small>{section.caption}</small>}
    </header>
    {sourceArtifact && <button className="result-section-source" type="button" onClick={event => preview?.open(sourceArtifact, event.currentTarget)} disabled={!preview}>来源：{sourceArtifact.title} · {sourceArtifact.version || sourceArtifact.versionId}</button>}
    <SectionBody section={section} artifacts={artifacts} />
  </section>
}
```

### `apps/web/src/components/ResultReviewLog.tsx`

```tsx
import { CheckCircle2, CircleDashed, CircleX, Clock3, ShieldAlert, UserRound } from 'lucide-react'
import type { OfficeResult, ResultRisk } from '@pawoffice/protocol/office-ui'
import {
  resultBoardChecks, resultCheckSummary, resultStaleCheckDetail,
} from '../results/board.ts'
import type { ResultAnnotatedCheck } from '../results/board.ts'
import './ResultReviewLog.css'

type CheckDisplayState = 'passed' | 'pending' | 'failed' | 'stale'

const checkStatusLabels = { passed: '已通过', pending: '待补充', failed: '未通过' } as const
const checkStatusIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const
const riskLevelLabels: Record<ResultRisk['level'], string> = { high: '高', medium: '中', low: '低' }
const riskStatusLabels: Record<ResultRisk['status'], string> = { open: '待处理', mitigating: '处理中', closed: '已关闭' }

function checkState(check: ResultAnnotatedCheck): CheckDisplayState {
  return check.stale ? 'stale' : check.status
}

function CheckRow({ check, result }: { check: ResultAnnotatedCheck; result: OfficeResult }) {
  const state = checkState(check)
  const Icon = state === 'stale' ? Clock3 : checkStatusIcons[state]
  const stateText = state === 'stale' ? '待补充验证' : checkStatusLabels[state]
  return <li data-status={state}>
    <Icon size={15} strokeWidth={2} aria-hidden="true" />
    <span className="result-workspace-check-label">{check.label}</span>
    <em>{stateText}</em>
    {state === 'stale' && <small>{resultStaleCheckDetail(result, check)}</small>}
  </li>
}

function RiskRow({ risk }: { risk: ResultRisk }) {
  return <li className="result-workspace-risk" data-level={risk.level} data-status={risk.status}>
    <div className="result-workspace-risk-head">
      <span className="result-workspace-risk-level" data-level={risk.level} title={`风险等级：${riskLevelLabels[risk.level]}`}>
        {riskLevelLabels[risk.level]}
      </span>
      <h4 className="result-workspace-risk-title">{risk.title}</h4>
      <span className="result-workspace-risk-state" data-status={risk.status}>{riskStatusLabels[risk.status]}</span>
    </div>
    {(risk.owner || risk.note) && <p className="result-workspace-risk-body">
      {risk.owner && <span className="result-workspace-risk-owner"><UserRound size={12} strokeWidth={2} aria-hidden="true" />{risk.owner}</span>}
      {risk.owner && risk.note && <span className="result-workspace-risk-sep" aria-hidden="true"> · </span>}
      {risk.note}
    </p>}
  </li>
}

/**
 * Review language: one verdict band (counts + a count-derived ratio bar), ordered check rows where
 * passed items recede and pending/failed/stale keep full weight, then the risk register.
 * A passed check bound to an older artifact version is never counted as passed: it stays stale.
 * Closed risks stay in the same list (weakened, not hidden) so the SSR text is always readable.
 */
export function ResultReviewLog({ result }: { result: OfficeResult }) {
  const checks = resultBoardChecks(result)
  const summary = resultCheckSummary(checks)
  const ratio = [
    { status: 'passed' as const, count: summary.passed },
    { status: 'pending' as const, count: summary.pending },
    { status: 'failed' as const, count: summary.failed },
    { status: 'stale' as const, count: summary.stale },
  ]
  const summaryParts = [
    summary.passed ? `${summary.passed} 项标记通过` : '',
    summary.pending ? `${summary.pending} 项待处理` : '',
    summary.failed ? `${summary.failed} 项未通过` : '',
    summary.stale ? `${summary.stale} 项待补充验证` : '',
  ].filter(Boolean)
  return <div className="result-workspace-review-log">
    {checks.length > 0 && <div className="result-workspace-check-band">
      <p className="result-workspace-check-summary">{`共 ${summary.total} 项检查：${summaryParts.join(' · ')}`}</p>
      <div className="result-workspace-check-ratio" aria-hidden="true">
        {ratio.filter(part => part.count > 0).map(part =>
          <span key={part.status} className="result-workspace-check-ratio-seg" data-status={part.status} style={{ flexGrow: part.count }} />)}
      </div>
    </div>}
    {summary.stale > 0 && <p className="result-workspace-check-hint">待补充验证项的原验证对象与当前交付版本不一致，不能按通过计。</p>}
    {checks.length > 0 && <ul className="result-workspace-checks">
      {checks.map(check => <CheckRow key={JSON.stringify([check.id, check.artifactId, check.versionId])}
        check={check} result={result} />)}
    </ul>}
    {result.risks.length > 0 && <div className="result-workspace-risks">
      <h4 className="result-workspace-subhead">
        <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />风险记录<span>{result.risks.length}</span>
      </h4>
      <ul className="result-workspace-risk-list">
        {result.risks.map(risk => <RiskRow key={risk.id} risk={risk} />)}
      </ul>
    </div>}
    {checks.length === 0 && result.risks.length === 0
      && <p className="result-workspace-hint">本轮未提供检查项与风险记录。</p>}
  </div>
}
```

### `apps/web/src/components/ResultVersionTimeline.tsx`

```tsx
import type { OfficeResult, ResultVersion } from '@pawoffice/protocol/office-ui'
import './ResultVersionTimeline.css'

const versionStatusLabels: Record<ResultVersion['status'], string> = {
  draft: '草稿', released: '已发布', 'rolled-back': '已回滚',
}

/**
 * Time language: one vertical node per result revision. The node shape carries the state
 * (released solid / draft hollow / rolled-back red) and the state text always repeats it.
 * The current delivery picker stays a separate top-level control; this is only the record.
 */
export function ResultVersionTimeline({ result }: { result: OfficeResult }) {
  if (!result.versions.length) return null
  return <ol className="result-workspace-versions" data-count={result.versions.length} aria-label="成果版本记录">
    {result.versions.map(version => {
      const meta = [version.author, version.at].filter(Boolean).join(' · ')
      return <li className="result-workspace-version" data-status={version.status} key={version.id}>
        <span className="result-workspace-version-tag" title={`版本 ${version.version}`}>{version.version}</span>
        <span className="result-workspace-version-main">
          {version.note && <p>{version.note}</p>}
          {meta && <span className="result-workspace-version-meta">{meta}</span>}
        </span>
        <span className="result-workspace-version-state" data-status={version.status}>
          {versionStatusLabels[version.status]}
        </span>
      </li>
    })}
  </ol>
}
```

### `apps/web/src/components/ResultChanges.tsx`

```tsx
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
  return <span className="result-change-counts">{file.binary ? <span>二进制</span> : <>
    <span className="is-added">+{file.added}</span><span className="is-deleted">-{file.deleted}</span>
  </>}</span>
}

/** Honest fallbacks first: a binary, oversized or stat-only file never gets an invented text diff. */
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
        const rowLabel = `${expanded ? '收起' : '展开'} ${file.path} 的逐行差异，${label}，新增 ${file.added} 行，删除 ${file.deleted} 行${file.binary ? '，二进制文件' : ''}`
        return <li key={`${file.status}-${file.path}-${index}`}>
          <button type="button" className="result-change-row" data-status={file.status}
            aria-expanded={expanded} aria-controls={expanded ? panelId : undefined} aria-label={rowLabel}
            onClick={() => toggle(index)}
            onKeyDown={event => {
              if (event.key !== 'Escape' || !expanded) return
              event.preventDefault()
              event.stopPropagation()
              collapse(index)
            }}>
            <span className="result-change-status" data-status={file.status}>{label}</span>
            <span className="result-change-path">
              <code>{file.path}</code>
              {file.previousPath && <small>原路径：{file.previousPath}</small>}
            </span>
            {file.oversized && <span className="result-change-large">较大文件</span>}
            <LineCounts file={file} />
            <ChevronRight className="result-change-chevron" size={14} strokeWidth={2.2} aria-hidden="true" />
          </button>
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
```

### `apps/web/src/components/ResultDeliveryShell.tsx`

```tsx
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import type { OfficeResult, ResultArtifact, ResultDelivery, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { resultDeliverySchema } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { formatResultTimestamp } from '../results/format.ts'
import { readDeliverySnapshot } from '../results/resources.ts'
import { artifactPreviewSections } from '../results/sections.ts'
import { ResultArtifactPreview } from './ResultArtifactPreview.tsx'
import './ResultDeliveryShell.css'

const label = (delivery: ResultDelivery) => delivery.title || `第 ${delivery.sequence} 次交付`

export function ResultDeliveryShell({ board, result, children, initialDeliveryId }: {
  board: WhiteboardTaskBoardData; result: OfficeResult
  initialDeliveryId?: string
  children: (board: WhiteboardTaskBoardData, result: OfficeResult, historical: boolean, executionKnown: boolean) => ReactNode
}) {
  const deliveries = useMemo(() => (board.deliveries ?? []).map(item => resultDeliverySchema.parse(item)).sort((a, b) => b.sequence - a.sequence), [board.deliveries])
  const [selected, setSelected] = useState<ResultDelivery | null>(() => deliveries.find(item => item.id === initialDeliveryId) ?? null)
  const [missingTarget, setMissingTarget] = useState(() => Boolean(initialDeliveryId && !deliveries.some(item => item.id === initialDeliveryId)))
  const [loaded, setLoaded] = useState<{ record: ResultDelivery; snapshot?: ResultDelivery; error?: string } | null>(null)
  const [preview, setPreview] = useState<{ artifact: ResultArtifact; trigger: HTMLElement } | null>(null)
  const [retry, setRetry] = useState(0)
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [catalog, setCatalog] = useState<{ records: ResultDelivery[]; retry: number; snapshots: ResultDelivery[]; failed: number } | null>(null)
  const previewId = preview?.artifact.id
  const container = useRef<HTMLDivElement>(null)
  // The file menu remains a history entry even when chat messages have not loaded.
  // Only read backend-owned snapshot metadata when a file preview is open.
  useEffect(() => {
    if (!previewId || catalog?.records === deliveries && catalog.retry === catalogRetry) return
    const external = deliveries.filter(delivery => !delivery.result)
    if (!external.length) return
    const controller = new AbortController()
    const snapshots: ResultDelivery[] = []
    let cursor = 0, failed = 0
    const worker = async () => {
      while (cursor < external.length && !controller.signal.aborted) {
        const record = external[cursor++]
        try { snapshots.push(await readDeliverySnapshot(record, controller.signal)) }
        catch { if (!controller.signal.aborted) failed++ }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, external.length) }, worker)).then(() => {
      if (!controller.signal.aborted) setCatalog({ records: deliveries, retry: catalogRetry, snapshots, failed })
    })
    return () => controller.abort()
  }, [previewId, deliveries, catalog, catalogRetry])
  useEffect(() => {
    if (!selected || selected.result) return
    const controller = new AbortController()
    readDeliverySnapshot(selected, controller.signal).then(snapshot => {
      if (!controller.signal.aborted) setLoaded({ record: selected, snapshot })
    }).catch(error => {
      if (!controller.signal.aborted) setLoaded({ record: selected, error: error instanceof Error ? error.message : '读取历史交付失败。' })
    })
    return () => controller.abort()
  }, [selected, retry])
  const resolved = selected?.result ? selected : loaded?.record === selected ? loaded.snapshot : undefined
  const error = loaded?.record === selected ? loaded.error : ''
  const historical = Boolean(selected || missingTarget)
  const viewResult = historical ? resolved?.result : result
  const viewBoard: WhiteboardTaskBoardData = resolved && viewResult ? {
    template: 'task-board-v1', title: viewResult.title || board.title, status: 'completed', steps: [],
    ...resolved.board, result: viewResult,
  } : board
  const returnToCurrent = () => {
    setSelected(null)
    setMissingTarget(false)
    setLoaded(null)
    container.current?.closest('.whiteboard-reader-content')?.scrollTo(0, 0)
  }
  const catalogReady = catalog?.records === deliveries && catalog.retry === catalogRetry
  const knownDeliveries = useMemo(() => deliveries.map(delivery => delivery.result ? delivery
    : (catalog?.records === deliveries ? catalog.snapshots.find(snapshot => snapshot.id === delivery.id) : undefined) ?? delivery), [deliveries, catalog])
  const versions = useMemo(() => {
    if (!preview) return []
    const entries = new Map<string, { artifact: ResultArtifact; label: string }>()
    for (const delivery of [...knownDeliveries].reverse()) for (const artifact of delivery.result?.artifacts ?? []) {
      if (artifact.id === preview.artifact.id && artifact.versionId) entries.set(artifact.versionId, { artifact, label: `${artifact.version || artifact.versionId} · ${label(delivery)}` })
    }
    for (const artifact of resolved?.result?.artifacts ?? []) {
      if (artifact.id === preview.artifact.id && artifact.versionId) entries.set(artifact.versionId, { artifact, label: `${artifact.version || artifact.versionId} · ${selected ? label(selected) : '历史交付'}` })
    }
    if (preview.artifact.versionId && !entries.has(preview.artifact.versionId)) entries.set(preview.artifact.versionId, {
      artifact: preview.artifact, label: `${preview.artifact.version || preview.artifact.versionId} · 正在查看`,
    })
    const current = result.artifacts.find(artifact => artifact.id === preview.artifact.id)
    if (current?.versionId) entries.set(current.versionId, { artifact: current, label: `${current.version || current.versionId} · 当前版本` })
    return [...entries.values()]
  }, [preview, knownDeliveries, resolved, selected, result.artifacts])
  const origin = preview ? deliveries.find(delivery => delivery.id === preview.artifact.runId) : undefined
  const selectId = useId()
  const selectDelivery = (id: string) => {
    if (!id) { returnToCurrent(); return }
    const delivery = deliveries.find(item => item.id === id)
    if (!delivery) return
    setMissingTarget(false)
    setLoaded(null)
    setSelected(delivery)
    requestAnimationFrame(() => container.current?.closest('.whiteboard-reader-content')?.scrollTo(0, 0))
  }
  const previewSections = preview ? artifactPreviewSections([viewResult,
    knownDeliveries.find(delivery => delivery.id === preview.artifact.runId)?.result,
    ...knownDeliveries.map(delivery => delivery.result), result], preview.artifact) : []

  return <ArtifactPreviewContext.Provider value={{ open: (artifact, trigger) => setPreview({ artifact, trigger }) }}>
    <div ref={container} className="result-delivery-shell">
      {deliveries.length > 1 && <div className="result-delivery-switch">
        <label htmlFor={selectId}>交付历史</label>
        <select id={selectId} value={selected?.id ?? ''} onChange={event => selectDelivery(event.target.value)}>
          <option value="">当前成果</option>
          {deliveries.map(delivery => <option key={delivery.id} value={delivery.id}>{label(delivery)}</option>)}
        </select>
      </div>}
      {selected && <div className="result-delivery-notice" role="status">
        <div><strong>历史交付 · {label(selected)}</strong><span>{formatResultTimestamp(selected.createdAt)} · 文档固定为当时版本。</span></div>
        <button type="button" onClick={returnToCurrent}>返回当前成果<ArrowRight size={13} /></button>
      </div>}
      {missingTarget && <div className="result-delivery-loading"><p role="alert">该次交付不在当前会话的可用目录中，未展示其他轮次内容。</p>
        <button type="button" onClick={returnToCurrent}>查看当前成果</button></div>}
      {selected && !viewResult && <div className="result-delivery-loading">
        {error ? <><p role="alert">{error} 没有展示其他轮次的内容。</p><button type="button" onClick={() => { setLoaded(null); setRetry(value => value + 1) }}>重新读取此交付</button></>
          : <p role="status"><LoaderCircle size={16} />正在读取指定交付…</p>}
      </div>}
      {viewResult && children(viewBoard, viewResult, historical, !historical || Boolean(resolved?.board))}
    </div>
    {preview && <ResultArtifactPreview key={JSON.stringify([preview.artifact.id, preview.artifact.versionId, preview.artifact.url])}
      artifact={preview.artifact} current={result.artifacts.find(artifact => artifact.id === preview.artifact.id)}
      sections={previewSections}
      catalogLoading={deliveries.some(delivery => !delivery.result) && !catalogReady}
      catalogFailed={catalogReady ? catalog.failed : 0} onRetryCatalog={() => setCatalogRetry(value => value + 1)}
      versions={versions} origin={origin ? label(origin) : historical ? '历史交付' : '当前成果'} trigger={preview.trigger}
      onClose={() => setPreview(null)} onSelect={artifact => setPreview({ ...preview, artifact })} />}
  </ArtifactPreviewContext.Provider>
}
```

### `apps/web/src/components/WhiteboardReader.tsx`

```tsx
import { useEffect, useMemo, useRef } from 'react'
import { Download, X } from 'lucide-react'
import { whiteboardTaskBoard, whiteboardTaskBoardSchema } from '@pawoffice/scene-office/whiteboard'
import type { WhiteboardProgress } from '@pawoffice/scene-office/whiteboard'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import { officeResultSchema } from '@pawoffice/protocol/office-ui'
import type { OfficeResult, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { ResultWorkspace } from './ResultWorkspace.tsx'
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
```

### `apps/web/src/results/board.ts`

```ts
import type { OfficeResult, ResultArtifact, ResultCheck, ResultDocumentsSection, ResultSection } from '@pawoffice/protocol/office-ui'
import { resultChecks } from './checks.ts'

export type ResultDocumentMetadata = ResultDocumentsSection['items'][number]
export type ResultAnnotatedCheck = ReturnType<typeof resultChecks>[number]

/** Checks for one result, with old-version bindings already resolved by the existing reader rule. */
export function resultBoardChecks(result: OfficeResult) {
  return resultChecks(result)
}

const checkKey = (check: Pick<ResultCheck, 'id' | 'artifactId' | 'versionId'>) => JSON.stringify([check.id, check.artifactId, check.versionId])

/**
 * Display groups derived from the existing stale-version rule. `passed` never includes a check whose
 * evidence was bound to an older artifact version; those stay in `stale` and read as 待补充验证.
 */
export function resultCheckSummary(checks: readonly ResultAnnotatedCheck[]) {
  const fresh = checks.filter(check => !check.stale)
  return {
    total: checks.length,
    passed: fresh.filter(check => check.status === 'passed').length,
    pending: fresh.filter(check => check.status === 'pending').length,
    failed: fresh.filter(check => check.status === 'failed').length,
    stale: checks.filter(check => check.stale).length,
  }
}

/** The current artifact version a stale check was originally bound to, for an honest explanation. */
export function resultStaleCheckDetail(result: OfficeResult, check: ResultAnnotatedCheck) {
  if (!check.stale) return ''
  const current = result.artifacts.find(artifact => artifact.id === check.artifactId)
  const bound = check.versionId || '未标注版本'
  if (!current) return `原验证版本 ${bound} 已不在本轮交付中`
  return `原验证版本 ${bound}，当前版本 ${current.version || current.versionId || '未标注版本'}`
}

/**
 * Metadata for one artifact, only through explicit artifactId + versionId identity.
 * Titles are display text; a similar title never creates a link.
 */
export function resultDocumentMetadata(result: OfficeResult) {
  const metadata = new Map<string, ResultDocumentMetadata>()
  const documents = result.sections.flatMap(section => section.kind === 'documents' && !section.purpose ? section.items : [])
  for (const artifact of result.artifacts) {
    const matches = documents.filter(item => item.artifactId === artifact.id
      && (!item.versionId || item.versionId === artifact.versionId))
    if (matches.length === 1) metadata.set(artifact.id, matches[0])
  }
  return metadata
}

/** The artifact a section points at through its exact routing identity, never by title. */
export function resultSectionArtifact(result: OfficeResult, section: ResultSection) {
  if (!section.artifactId) return undefined
  return result.artifacts.find(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)
}

/**
 * Every section stays in the source order from the contract. Only display data changes:
 * the top-level check panel and a `tests` section never show the same check twice.
 */
export function resultBoardSections(result: OfficeResult) {
  const topLevel = new Set(result.checks.map(checkKey))
  return result.sections.map<ResultSection>(section => {
    if (section.kind !== 'tests') return section
    const own = section.checks.filter(check => !topLevel.has(checkKey(check)))
    if (own.length === section.checks.length) return section
    if (!own.length) return { ...section, checks: [] }
    // Keep the exact backend check fields; only the reader's stale-version label/status is display-only.
    return { ...section, checks: resultChecks({ ...result, checks: own }).map(check => ({
      id: check.id, label: check.label, status: check.status, artifactId: check.artifactId, versionId: check.versionId,
    })) }
  })
}

/** A changed-file count for the delivery summary, without inventing extra metrics. */
export function resultChangedFileCount(result: OfficeResult) {
  return result.sections.reduce((count, section) => count + (section.kind === 'changes' ? section.files.length : 0), 0)
}

export function resultArtifactVersionLabel(artifact: ResultArtifact) {
  return artifact.version || artifact.versionId
}
```

### `tests/resultBoard.test.mjs`

```js
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

/**
 * Acceptance tests for the single-page result reading flow (result-board redesign).
 *
 * The data comes from the dev-only acceptance fixtures:
 * - `sample` / `history` are byte-for-byte copies of the user-supplied sample JSON.
 * - `matrix` / `layouts` / `limits` / `resultBoardStates` are schema-checked front-end fixtures.
 * No fixture is a protocol addition; every value is parsed by the frozen protocol schema first.
 *
 * Structure-only assertions are used here because these tests render static HTML (SSR):
 * dialogs, Escape, focus restoration, clipboard and download are covered by screenshots/manual steps.
 */

let server, resultSchema, boardSchema, emptyResult, ResultWorkspace, fixtures, presentation, format
before(async () => {
  server = await createTestServer()
  ;({ officeResultSchema: resultSchema, whiteboardTaskBoardSchema: boardSchema, emptyResult } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  ;({ ResultWorkspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  fixtures = await server.ssrLoadModule('/apps/web/src/dev/resultBoardFixtures.ts')
  presentation = await server.ssrLoadModule('/apps/web/src/results/presentation.ts')
  format = await server.ssrLoadModule('/apps/web/src/results/format.ts')
})
after(() => server?.close())

const render = (board, result) => renderToStaticMarkup(createElement(ResultWorkspace, { board, result }))
const boardFor = result => boardSchema.parse({ template: 'task-board-v1', title: '任务', status: 'completed', result })
const renderResult = result => render(boardFor(result), result)
const countOf = (html, needle) => html.split(needle).length - 1

const assertNoTabs = html => {
  assert(!html.includes('role="tablist"'), 'no tablist')
  assert(!html.includes('role="tab"'), 'no tab role')
  assert(!html.includes('aria-selected'), 'no aria-selected')
  assert(!/>(概览|交付物|过程记录)</.test(html), 'no legacy tab labels')
}

/* ------------------------------------------------------------------------------------------------
 * A03 / A05 / A06 / A10 — real sample first screen
 * ---------------------------------------------------------------------------------------------- */

test('the real sample is one reading flow with summary, verdict and note kept separate', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  assertNoTabs(html)
  // A05: ready is delivered, never "verified".
  assert(html.includes('data-result-status="ready"'))
  assert(html.includes('成果 · 已交付'))
  assert(!html.includes('成果 · 已验证'))
  assert(!html.includes('验收通过'))
  // A06: summary is the lead, verdict is a separate acceptance block.
  const summaryIndex = html.indexOf('result-workspace-conclusion')
  const verdictIndex = html.indexOf('result-workspace-verdict')
  assert(summaryIndex > 0 && verdictIndex > summaryIndex, 'summary before verdict')
  assert(html.includes(fixtures.sampleResult.summary))
  assert(html.includes(fixtures.sampleResult.verdict))
  // Identity / meta from the sample only.
  assert(html.includes('登录模块交付成果'))
  assert(html.includes('任务状态未提供'), 'isolated sample has no whiteboard.status')
  assert(html.includes('王明'))
  assert(html.includes('研发组（2人）'))
  // A10: the disclaimer is not optimised away.
  assert(html.includes('result-workspace-note'))
  assert(html.includes('以上内容均为本地模拟业务数据。'))
  // First-screen reminder and delivery total are visible.
  assert(html.includes('需要关注 3 项'))
  assert(html.includes('3 份交付文件'))
})

test('the real sample shows 2 passed / 1 pending / 1 stale instead of 3 passed', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  assert(html.includes('result-workspace-check-summary'))
  assert(html.includes('共 4 项检查：2 项标记通过 · 1 项待处理 · 1 项待补充验证'))
  assert(!html.includes('3 项标记通过'))
  assert(!html.includes('3/4 通过'))
  // A07: the stale row explains the old/current version without mutating data.
  assert(html.includes('data-status="stale"'))
  assert(html.includes('需求范围检查'))
  assert(html.includes('待补充验证'))
  assert(html.includes('原验证版本 prd-v1，当前版本 v2.0'))
  assert(html.includes('待补充验证项的原验证对象与当前交付版本不一致'))
  // The stale rule lives in checks.ts; the source check itself is still passed.
  const stale = presentation.resultChecks(fixtures.sampleResult).find(check => check.id === 'scope-review')
  assert.equal(stale.status, 'pending')
  assert.equal(fixtures.sampleResult.checks.find(check => check.id === 'scope-review').status, 'passed')
})

/* ------------------------------------------------------------------------------------------------
 * A08 / A09 / A16 — real sample deliveries and section order
 * ---------------------------------------------------------------------------------------------- */

test('the real sample keeps changes before documents and links documents to one preview entry', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  const changes = html.indexOf('data-kind="changes"')
  const documents = html.indexOf('data-kind="documents"')
  assert(changes > 0 && documents > changes, 'source order changes -> documents')
  assert(html.includes('已编辑 6 个文件'))
  // §7: all six file rows stay visible as compact rows; no diff is dumped into the first screen.
  assert.equal(countOf(html, 'class="result-change-row"'), 6)
  assert(html.includes('src/features/auth/LoginForm.tsx'))
  assert(html.includes('src/features/auth/useLogin.ts'))
  assert(html.includes('tests/auth/login.test.ts'))
  assert(html.includes('src/features/auth/legacyLogin.ts'))
  assert(html.includes('src/features/auth/session.ts'))
  assert(html.includes('原路径：src/features/auth/storage.ts'))
  assert(html.includes('docs/login-flow.png'))
  assert(html.includes('二进制'), 'binary file is labelled, not given a fake text diff')
  assert(!html.includes('全部 6 个文件'), 'no legacy first-four-file toggle')
  // All three documents match artifacts by exact artifactId + versionId.
  assert.equal(countOf(html, 'result-workspace-doc-open'), 3)
  assert.equal(countOf(html, 'class="result-deliverable"'), 3)
  assert(html.includes('登录模块需求说明'))
  assert(html.includes('登录接口文档'))
  assert(html.includes('验收报告'))
  assert(!html.includes('指定产物版本未提供'))
  assert(!html.includes('关联文件不在本轮交付中'))
  // The real files are Markdown with content; no invented file format.
  assert(!html.includes('.pdf'))
  assert(!html.includes('.docx'))
})

test('all three real Markdown deliverables are readable through the shared artifact preview', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  for (const artifact of fixtures.sampleResult.artifacts) {
    assert(html.includes(artifact.title), artifact.title)
    assert(html.includes(artifact.version), artifact.version)
  }
  assert(html.includes('阅读'))
  assert(html.includes('复制'))
  assert(html.includes('下载'))
  // The copy/download actions come from the reader actions view, not fake buttons.
  assert(html.includes('复制摘要'))
  assert(html.includes('下载报告'))
})

test('documents only open the exact artifactId + versionId pair, never a similar title', () => {
  const mismatched = resultSchema.parse({
    title: '版本不匹配', summary: '文档项绑定旧版本',
    artifacts: [{ id: 'doc', title: '需求说明', versionId: 'doc-v2', version: 'v2.0', content: '新版正文' }],
    sections: [{ kind: 'documents', id: 'docs', title: '交付文档', items: [
      { id: 'old', artifactId: 'doc', versionId: 'doc-v1', title: '需求说明', version: 'v1.0', status: 'done' },
      { id: 'plain', title: '同名但未绑定', version: 'v2.0', status: 'done' },
    ] }],
  })
  const html = renderResult(mismatched)
  assert.equal(countOf(html, 'result-workspace-doc-open'), 0)
  assert(html.includes('关联文件不在本轮交付中'))
  assert(html.includes('文档说明（未关联文件）'))
})

/* ------------------------------------------------------------------------------------------------
 * A11 — six metric kinds and the 1/2/3/4/6 -> cards, 7–12 -> compact density rule
 * ---------------------------------------------------------------------------------------------- */

test('all six metric kinds have a readable, semantically distinct form', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  assert(html.includes('result-metrics'))
  assert(html.includes('data-density="compact"'), '12 metrics use the compact data-row density')
  for (const kind of ['comparison', 'value', 'status', 'target', 'text']) {
    assert(html.includes(`data-kind="${kind}"`), kind)
  }
  assert(!html.includes('data-kind="auto"'), 'auto is resolved to comparison/value, not rendered raw')
  assert(html.includes('仅覆盖登录模块'), 'text metric renders the fact without inventing a unit')
  assert(html.includes('data-emphasis="primary"'))
  // Dense rows keep the same semantics as cards: target status, target and progress are still readable.
  assert(html.includes('已达标'))
  assert(html.includes('有风险'))
  assert(html.includes('目标 95%'))
  assert(html.includes('首轮 2.9% · +0.9pp'))

  // Card-mode semantics: comparison keeps previous/trend, target keeps target/targetStatus/progress.
  const pick = kind => fixtures.matrixResult.metrics.find(metric => metric.kind === kind)
  const targets = fixtures.matrixResult.metrics.filter(metric => metric.kind === 'target')
  const statuses = fixtures.matrixResult.metrics.filter(metric => metric.kind === 'status')
  const cardMetrics = resultSchema.parse({
    metrics: [pick('comparison'), targets[0], targets[1], statuses[0], statuses[1], pick('text')],
  })
  const cards = renderResult(cardMetrics)
  assert(cards.includes('data-density="card"'))
  assert(cards.includes('首轮 2.9%'), 'comparison keeps the previous value')
  assert(cards.includes('+0.9pp'))
  assert(cards.includes('已达标'))
  assert(cards.includes('有风险'))
  assert(cards.includes('目标 95%'))
  assert(cards.includes('role="progressbar"'), 'target progress is visible')
  assert(cards.includes('aria-valuenow="96"'))
  assert(cards.includes('待发布'), 'status metric keeps its value')
  assert(cards.includes('需复核'))
})

test('metric density is 1/2/3/4/6 cards and 7–12 compact rows, in source order', () => {
  for (const amount of [1, 2, 3, 4, 6]) {
    const result = resultSchema.parse({ metrics: fixtures.matrixResult.metrics.slice(0, amount) })
    const html = renderResult(result)
    assert(html.includes(`data-count="${amount}"`), `count ${amount}`)
    assert(html.includes('data-density="card"'), `cards at ${amount}`)
    assert.equal(countOf(html, 'class="result-metric"'), amount)
    assert(!html.includes('result-metric-row'), 'no compact rows at small counts')
    assert(html.includes('data-kind="'), 'each card keeps its resolved kind')
  }
  for (const amount of [7, 12]) {
    const result = resultSchema.parse({ metrics: fixtures.matrixResult.metrics.slice(0, amount) })
    const html = renderResult(result)
    assert(html.includes('data-count="dense"'), `dense count at ${amount}`)
    assert(html.includes('data-density="compact"'), `compact at ${amount}`)
    assert.equal(countOf(html, 'class="result-metric-row"'), amount)
    const labels = [...html.matchAll(/result-metric-row-label">([^<]+)/g)].map(match => match[1])
    assert.deepEqual(labels, fixtures.matrixResult.metrics.slice(0, amount).map(metric => metric.label))
  }
})

/* ------------------------------------------------------------------------------------------------
 * A13 / A14 / A15 — section kinds, custom blocks, layouts
 * ---------------------------------------------------------------------------------------------- */

test('all eight section kinds render in their source order', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  const kinds = fixtures.matrixResult.sections.map(section => section.kind)
  assert.deepEqual(kinds, ['gallery', 'documents', 'tests', 'api', 'environments', 'files', 'changes', 'custom'])
  let previous = -1
  for (const kind of kinds) {
    const index = html.indexOf(`data-kind="${kind}"`)
    assert(index > previous, `${kind} keeps source order`)
    previous = index
    assert(html.includes(`data-kind="${kind}"`), kind)
  }
  assert.equal(countOf(html, 'class="result-workspace-card"'), 8)
  for (const title of ['页面画廊', '交付文档', '质量报告', '接口清单', '运行环境', '附件清单', '文件变更', '自定义区块矩阵']) {
    assert(html.includes(title), title)
  }
})

test('section bodies use semantic rows instead of a generic card wall', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  // gallery
  assert(html.includes('result-workspace-gallery-item'))
  assert(html.includes('暂无预览'))
  // tests
  assert(html.includes('回归测试进度'))
  assert(html.includes('82%'))
  assert(html.includes('data-status="failed"'))
  // api
  assert(html.includes('/api/auth/login'))
  assert(html.includes('data-method="PATCH"'))
  // environments
  for (const text of ['运行中', '待发布', '已停止', '需关注']) assert(html.includes(text), text)
  // files
  assert(html.includes('登录页截图.png'))
  assert(html.includes('248 KB'))
  // changes
  assert(html.includes('已编辑 4 个文件'))
  assert(html.includes('docs/login-flow.png'))
})

test('all twelve custom blocks render with safe source fallbacks', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  const types = ['heading', 'text', 'keyValue', 'stats', 'table', 'list', 'progress', 'chart', 'image', 'diagram', 'callout', 'divider']
  for (const type of types) assert(html.includes(`data-block-type="${type}"`), type)
  assert(html.includes('自定义区块矩阵'))
  assert(html.includes('<strong>Markdown</strong>'), 'Markdown emphasis is rendered')
  assert(html.includes('result-block-table-el'), 'real table')
  assert(html.includes('data-method="POST"'), 'method format cell')
  assert(html.includes('role="progressbar"'), 'progress primitive')
  assert(html.includes('role="img"'), 'chart image role')
  assert(html.includes('柱状图'))
  assert(html.includes('登录流程图占位'), 'empty image falls back to a placeholder')
  assert(html.includes('mermaid-placeholder'))
  assert(html.includes('flowchart TD'), 'diagram source text is preserved')
  assert(html.includes('result-block-callout'))
  assert(html.includes('数据说明'))
  assert(html.includes('<hr'))
})

test('four custom layouts stay inside their own section', () => {
  const html = render(fixtures.layoutsBoard, fixtures.layoutsResult)
  for (const layout of ['stack', 'columns', 'grid', 'cards']) {
    assert(html.includes(`result-blocks-${layout}`), layout)
  }
  const titles = ['连续文档', '并排短内容', '网格内容', '轻卡片内容']
  let previous = -1
  for (const title of titles) {
    const index = html.indexOf(title)
    assert(index > previous, `${title} keeps order`)
    previous = index
  }
  assert(html.includes('所有 12 种 block 均已在本 fixture 与 matrix 中出现。'))
})

/* ------------------------------------------------------------------------------------------------
 * A18 — business record state text
 * ---------------------------------------------------------------------------------------------- */

test('risks, tasks, versions and check states use the contract text and keep state attributes', () => {
  const html = render(fixtures.matrixBoard, fixtures.matrixResult)
  // checks: 1 passed + 1 pending + 1 failed + 1 stale
  assert(html.includes('共 4 项检查：1 项标记通过 · 1 项待处理 · 1 项未通过 · 1 项待补充验证'))
  // risks
  assert(html.includes('风险记录'))
  assert(html.includes('短信验证码频率限制待复核'))
  assert(html.includes('data-level="high"'))
  assert(html.includes('旧版本文档已归档'))
  assert(html.includes('data-status="closed"'))
  assert(html.includes('已关闭'))
  assert(html.includes('待处理'))
  // tasks: todo / doing / blocked / done
  for (const text of ['待开始', '进行中', '受阻', '已完成']) assert(html.includes(text), text)
  assert(html.includes('data-status="blocked"'))
  assert(html.includes('灰度节点排查'))
  // versions: draft / released / rolled-back
  for (const text of ['草稿', '已发布', '已回滚']) assert(html.includes(text), text)
  assert(html.includes('data-status="rolled-back"'))
})

test('production result status text is never derived from task or check state', () => {
  const states = fixtures.resultBoardStates
  assert.equal(presentation.resultPresentation(states.ready.board, states.ready.result).key, 'ready')
  assert.equal(presentation.resultPresentation(states.verified.board, states.verified.result).key, 'verified')
  assert.equal(presentation.resultPresentation(states.conflict.board, states.conflict.result).key, 'conflict')
  // ready fixture has no checks; the label must still be delivered, not verified.
  const ready = render(states.ready.board, states.ready.result)
  assert(ready.includes('成果 · 已交付'))
  assert(!ready.includes('成果 · 已验证'))
  const verified = render(states.verified.board, states.verified.result)
  assert(verified.includes('成果 · 已验证'))
  const conflict = render(states.conflict.board, states.conflict.result)
  assert(conflict.includes('成果 · 验证待核对'))
})

/* ------------------------------------------------------------------------------------------------
 * A21 — empty / short results
 * ---------------------------------------------------------------------------------------------- */

test('empty, summary-only and artifact-only results avoid fake blocks', () => {
  const emptyBoard = boardSchema.parse({ template: 'task-board-v1', title: '空任务', status: 'queued' })
  const emptyHtml = render(emptyBoard, emptyResult())
  assert(emptyHtml.includes('result-workspace-empty'))
  assert(emptyHtml.includes('成果 · 暂无成果'))
  assert(!emptyHtml.includes('result-metrics'))
  assert(!emptyHtml.includes('result-deliverable'))

  const summaryOnly = resultSchema.parse({ title: '短成果', status: 'ready', summary: '只交付了一句结论。' })
  const summaryHtml = renderResult(summaryOnly)
  assert(summaryHtml.includes('result-workspace-conclusion'))
  assert(summaryHtml.includes('只交付了一句结论。'))
  assert(!summaryHtml.includes('result-workspace-empty'))
  assert(!summaryHtml.includes('result-metrics'))
  assert(!summaryHtml.includes('本轮没有可查看的交付物'))
  assert(!summaryHtml.includes('缺少交付物'))

  const artifactOnly = resultSchema.parse({
    title: '只有交付物', status: 'ready',
    artifacts: [{ id: 'only', title: '唯一交付', content: '# 正文', versionId: 'only-v1' }],
  })
  const artifactHtml = renderResult(artifactOnly)
  assert.equal(countOf(artifactHtml, 'class="result-deliverable"'), 1)
  assert(artifactHtml.includes('唯一交付'))
  assert(!artifactHtml.includes('result-metrics'))
  assert(!artifactHtml.includes('缺少交付物'))
  assert(!artifactHtml.includes('result-workspace-empty'))
})

/* ------------------------------------------------------------------------------------------------
 * A22 — untrusted content safety and source preservation
 * ---------------------------------------------------------------------------------------------- */

test('untrusted HTML, scripts and SVG are never executed while source text is preserved', () => {
  const hostile = resultSchema.parse({
    title: '<img src=x onerror=alert(1)>',
    summary: '<script>alert(2)</script>',
    note: '<svg onload=alert(3)></svg>',
    checks: [{ id: 'c', label: '<script>alert(4)</script>', status: 'passed' }],
    risks: [{ id: 'r', title: '<b>风险</b>', level: 'high', status: 'open' }],
    sections: [{
      kind: 'custom', id: 'custom', title: '安全', layout: 'stack', blocks: [
        { type: 'text', text: '<script>alert(5)</script>\n\n**安全正文**' },
        { type: 'diagram', source: 'flowchart TD\n  A["<script>alert(6)</script>"] --> B[结束]' },
        { type: 'table', columns: [{ key: 'link', label: '地址', format: 'link' }], rows: [{ link: 'javascript:alert(7)' }] },
        { type: 'callout', tone: 'danger', text: '<svg onload=alert(8)></svg>' },
      ],
    }],
  })
  const html = renderResult(hostile)
  assert(!html.includes('<script'))
  assert(!html.includes('<svg onload'))
  assert(!html.includes('<img src=x'))
  assert(!/<(?:img|svg|script)[^>]*\son[a-z]+\s*=/i.test(html), 'no unescaped event-handler attribute')
  assert(!html.includes('href="javascript:'))
  // Escaped/plain text survives as data, not markup.
  assert(html.includes('&lt;script&gt;'))
  assert(html.includes('&lt;img src=x'))
  assert(html.includes('安全正文'))
  assert(html.includes('mermaid-placeholder'))
  assert(html.includes('flowchart TD'))
  // Invalid link cells stay plain text instead of becoming clickable.
  assert(!html.includes('href="javascript:'))
})

test('chart values and diagram source remain readable when a graph cannot be drawn', () => {
  const html = render(fixtures.layoutsBoard, fixtures.layoutsResult)
  assert(html.includes('aria-label="图表（饼图）：通过 68，待复核 32"'))
  assert(html.includes('result-block-chart-legend'))
  assert(html.includes('68'))
  assert(html.includes('32'))
  assert(html.includes('flowchart LR'))
  assert(html.includes('A[输入]'))
})

/* ------------------------------------------------------------------------------------------------
 * A12 — four artifact kinds and empty fallbacks
 * ---------------------------------------------------------------------------------------------- */

test('four artifact kinds expose the right reading action and honest empty fallbacks', () => {
  const result = resultSchema.parse({
    title: '交付类型', status: 'ready', summary: '四种交付物',
    artifacts: [
      { id: 'doc', kind: 'document', title: '文档产物', versionId: 'doc-v1', content: '# 文档正文' },
      { id: 'img', kind: 'image', title: '图片产物', versionId: 'img-v1', url: 'https://example.com/a.png' },
      { id: 'img-empty', kind: 'image', title: '空图片产物', versionId: 'img-v2' },
      { id: 'doc-empty', kind: 'document', title: '空文档产物', versionId: 'doc-empty-v1' },
      { id: 'lnk', kind: 'link', title: '外链产物', url: 'https://example.com/spec' },
      { id: 'lnk-empty', kind: 'link', title: '空外链产物' },
      { id: 'dat', kind: 'data', title: '数据产物', versionId: 'dat-v1', content: '| 行 | 值 |\n| --- | --- |\n| 1 | 10 |' },
    ],
  })
  const html = renderResult(result)
  for (const title of ['文档产物', '图片产物', '空图片产物', '空文档产物', '外链产物', '空外链产物', '数据产物']) assert(html.includes(title), title)
  // document/data: reading action; image: large-picture action; link without versionId: real anchor.
  assert(html.includes('阅读'))
  assert(html.includes('查看大图'))
  assert(html.includes('打开链接'))
  assert(html.includes('href="https://example.com/spec"'))
  assert(html.includes('未提供可用链接'), 'empty link never becomes a fake navigation')
  // A12: versions with no readable body/URL expose a disabled fallback instead of a failing preview button.
  assert(html.includes('暂无图片可预览'), 'empty image shows an honest disabled fallback')
  assert(html.includes('暂无正文或文件地址'), 'empty document shows an honest disabled fallback')
  assert(html.includes('aria-disabled="true"'))
  assert.equal(countOf(html, '查看大图'), 1, 'only the real image offers a preview')
  // Empty image URL never invents an <img>; the row keeps an icon fallback.
  assert.equal(countOf(html, 'result-deliverable-thumb'), 1)
})

test('the sample deliverable directory never fabricates file size or format', () => {
  const html = render(fixtures.sampleBoard, fixtures.sampleResult)
  assert(!/\d+(\.\d+)?\s?(KB|MB|GB)/.test(html), 'no invented file size')
  assert(!html.includes('application/pdf'))
  assert(!html.includes('image/png'))
})

/* ------------------------------------------------------------------------------------------------
 * A19 — history deliveries
 * ---------------------------------------------------------------------------------------------- */

test('history deliveries switch through the existing shell without borrowing current data', () => {
  const current = render(fixtures.historyBoard, fixtures.historyResult)
  assert(current.includes('result-delivery-switch'))
  assert(current.includes('交付历史'))
  assert(current.includes('当前成果</option>'))
  assert(current.includes('第 2 轮 · 首次文档交付'))

  const historical = renderToStaticMarkup(createElement(ResultWorkspace, {
    board: fixtures.historyBoard, result: fixtures.historyResult, initialDeliveryId: 'delivery-2',
  }))
  assert(historical.includes('历史交付 · 第 2 轮 · 首次文档交付'))
  assert(historical.includes('文档固定为当时版本'))
  assert(historical.includes('返回当前成果'))
  assert(historical.includes('登录模块开发与验收'))
  assert(historical.includes('data-historical="true"'))
  // Historical content is the requested record, not the current v2.0 result.
  assert(historical.includes('首次交付需求说明 v1.0 与接口文档 v1.0。'))

  const missing = renderToStaticMarkup(createElement(ResultWorkspace, {
    board: fixtures.historyBoard, result: fixtures.historyResult, initialDeliveryId: 'does-not-exist',
  }))
  assert(missing.includes('该次交付不在当前会话的可用目录中，未展示其他轮次内容。'))
  assert(missing.includes('查看当前成果'))
})

test('historical delivery keeps its own checks and does not report the current stale state', () => {
  const historical = renderToStaticMarkup(createElement(ResultWorkspace, {
    board: fixtures.historyBoard, result: fixtures.historyResult, initialDeliveryId: 'delivery-2',
  }))
  // delivery-2 predates the prd-v2 update, so its own check is not stale.
  assert(!historical.includes('原验证版本 prd-v1，当前版本 v2.0'))
})

/* ------------------------------------------------------------------------------------------------
 * A20 — extreme counts
 * ---------------------------------------------------------------------------------------------- */

test('extreme counts keep every item and switch metrics to compact rows', () => {
  const html = render(fixtures.limitsBoard, fixtures.limitsResult)
  assert(html.includes('data-count="dense"'))
  assert.equal(countOf(html, 'class="result-metric-row"'), 12)
  assert.equal(countOf(html, 'class="result-deliverable"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-card"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-gallery-item"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-file"'), 12)
  assert(html.includes('/api/limit/resource-12'))
  assert(html.includes('环境 8'))
  assert(html.includes('已编辑 24 个文件'))
  assert.equal(countOf(html, 'class="result-change-row"'), 24)
  assert.equal(countOf(html, 'data-block-type='), 24)
  assert(html.includes('共 12 项检查：'))
  assert.equal(countOf(html, 'class="result-workspace-task"'), 12)
  assert.equal(countOf(html, 'class="result-workspace-version"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-risk"'), 8)
  assert.equal(countOf(html, 'class="result-workspace-decision"'), 8)
  assert.equal(countOf(html, '后续行动 '), 8)
})

/* ------------------------------------------------------------------------------------------------
 * §9.2 — the ten existing presentation states
 * ---------------------------------------------------------------------------------------------- */

test('all ten presentation states render the existing label and no invented state', () => {
  for (const key of fixtures.presentationKeys) {
    const state = fixtures.resultBoardStates[key]
    assert.equal(presentation.resultPresentation(state.board, state.result).key, key, `fixture state ${key}`)
    const html = render(state.board, state.result)
    assert(html.includes(`data-result-status="${key}"`), key)
    assert(html.includes(`成果 · ${state.label}`), `${key} label`)
  }
  // Empty-ish states keep the empty container; no fake content is rendered.
  for (const key of ['producing', 'blocked', 'failed', 'missing', 'empty']) {
    const state = fixtures.resultBoardStates[key]
    assert(render(state.board, state.result).includes('result-workspace-empty'), `${key} empty state`)
  }
})

test('a result with only a note still renders a complete short report', () => {
  const result = resultSchema.parse({ note: '只有一句免责声明。' })
  const html = renderResult(result)
  assert(html.includes('只有一句免责声明。'))
  assert(html.includes('result-workspace-note'))
  assert(!html.includes('result-workspace-empty'))
})

test('the summary copy and report exports stay available for the single-page reader', () => {
  const summary = format.resultSummaryText(fixtures.sampleResult)
  assert(summary.includes('登录模块交付成果'))
  assert(summary.includes('需求说明更新至 v2.0'))
  const report = format.resultReport(fixtures.sampleResult)
  assert(report.includes('## 文件变更'))
  assert(report.includes('需求范围检查（验证版本已更新，需重新验证）'))
  assert(report.includes('以上内容均为本地模拟业务数据。'))
})
```

### `tests/resultTypeVisual.test.mjs`

```js
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, Workspace, fixtures, presentation
before(async () => {
  server = await createTestServer()
  ;({ ResultWorkspace: Workspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  fixtures = await server.ssrLoadModule('/apps/web/src/dev/resultBoardFixtures.ts')
  presentation = await server.ssrLoadModule('/apps/web/src/results/presentation.ts')
})
after(() => server?.close())

const render = (board, result) => renderToStaticMarkup(createElement(Workspace, { board, result }))
const countOf = (html, text) => html.split(text).length - 1

/* ------------------------------------------------------------------------------------------------
 * Data-type visual system — one dedicated form per semantic type (round after the single-page layout)
 * ---------------------------------------------------------------------------------------------- */

test('reading focus switches with field composition without new protocol fields', () => {
  const delivery = render(fixtures.sampleBoard, fixtures.sampleResult)
  assert(delivery.includes('data-reading-mode="delivery"'))
  assert(delivery.includes('本轮交付'))
  assert(delivery.includes('result-workspace-delivery'))

  const fact = render(fixtures.typeFactBoard, fixtures.typeFactResult)
  assert(fact.includes('data-reading-mode="fact"'))
  assert(!fact.includes('本轮交付'), 'fact results never render a deliverable block')
  assert(!fact.includes('result-workspace-delivery'))
  assert(fact.includes('说明与结论'))
  assert(fact.includes(fixtures.typeFactResult.summary))

  // Both modes keep the no-tabs promise.
  for (const html of [delivery, fact]) {
    assert(!html.includes('role="tablist"'))
    assert(!html.includes('role="tab"'))
    assert(!html.includes('aria-selected'))
  }
})

test('six metric kinds keep distinct semantics instead of one numeric template', () => {
  const html = render(fixtures.typeMetricsBoard, fixtures.typeMetricsResult)
  for (const kind of ['value', 'comparison', 'status', 'target', 'text']) {
    assert(html.includes(`data-kind="${kind}"`), kind)
  }
  assert(!html.includes('data-kind="auto"'), 'auto is resolved, never shown as a raw kind')
  // Comparison gets the two-point bars; status is a lamp + words; target gets a target line.
  assert.equal(countOf(html, 'class="result-metric-bars"'), 2, 'comparison + auto-with-previous both get bars')
  assert(html.includes('result-metric-status-dot'))
  assert(html.includes('result-metric-status-text'))
  assert(html.includes('result-metric-target-line'))
  assert(html.includes('result-metric-caption'))
  assert.equal(countOf(html, 'class="result-metric"'), 6)
  assert(html.includes('data-emphasis="primary"'))
  // No invented numbers: only values supplied by the fixture.
  assert(html.includes('首轮 120 次') || html.includes('首轮 2.9%'))
})

test('four artifact kinds have their own delivery form and honest fallbacks', () => {
  const html = render(fixtures.typeArtifactsBoard, fixtures.typeArtifactsResult)
  for (const kind of ['document', 'image', 'link', 'data']) {
    assert(html.includes(`data-kind="${kind}"`), kind)
  }
  // Document rows, image media slots, link domains and data formats are different structures.
  assert(html.includes('result-deliverable-media'))
  assert.equal(countOf(html, 'class="result-deliverable-thumb"'), 1, 'only the legal http(s) image renders an <img>')
  assert(html.includes('result-deliverable-domain'))
  assert(html.includes('example.com'))
  assert(html.includes('result-deliverable-format'))
  assert(html.includes('JSON'))
  // Empty URL fallbacks stay honest.
  assert(html.includes('未提供可用链接'))
  assert(html.includes('暂无图片可预览'))
})

test('documents with the exact artifact identity share the preview entry instead of duplicating cards', () => {
  const html = render(fixtures.typeDeliveryBoard, fixtures.typeDeliveryResult)
  assert.equal(countOf(html, 'class="result-deliverable"'), 3)
  assert.equal(countOf(html, 'result-workspace-doc-open'), 3)
  assert(html.includes('data-kind="documents"'))
  assert(html.includes('本次更新'))
  assert(html.includes('本次新增'))
  assert(!html.includes('关联文件不在本轮交付中'))
})

test('checks and risks use a review ledger: tally, ratio segments, stale evidence and severity register', () => {
  const html = render(fixtures.typeReviewBoard, fixtures.typeReviewResult)
  assert(html.includes('result-workspace-check-band'))
  assert(html.includes('共 4 项检查：1 项标记通过 · 1 项待处理 · 1 项未通过 · 1 项待补充验证'))
  assert.equal(countOf(html, 'class="result-workspace-check-ratio-seg"'), 4)
  for (const status of ['passed', 'pending', 'failed', 'stale']) {
    assert(html.includes(`data-status="${status}"`), status)
  }
  assert(html.includes('待补充验证'))
  assert(html.includes('原验证版本 type-review-doc-v1，当前版本 v2.0'))
  assert(html.includes('风险记录'))
  assert.equal(countOf(html, 'class="result-workspace-risk"'), 3)
  for (const level of ['high', 'medium', 'low']) assert(html.includes(`data-level="${level}"`), level)
  for (const status of ['open', 'mitigating', 'closed']) assert(html.includes(`data-status="${status}"`), status)
})

test('version records are a timeline with three contract states', () => {
  const html = render(fixtures.typeVersionsBoard, fixtures.typeVersionsResult)
  assert.equal(countOf(html, 'class="result-workspace-version"'), 3)
  for (const status of ['draft', 'released', 'rolled-back']) {
    assert(html.includes(`data-status="${status}"`), status)
  }
  for (const label of ['草稿', '已发布', '已回滚']) assert(html.includes(label), label)
  assert(html.includes('result-workspace-versions'))
})

test('code changes are a diff list with inline expansion and no fake diffs', () => {
  const html = render(fixtures.typeChangesBoard, fixtures.typeChangesResult)
  assert.equal(countOf(html, 'class="result-change-row"'), 24)
  assert(html.includes('已编辑 24 个文件'))
  assert(!html.includes('result-diff-popover'), 'inline expansion replaced the top-layer popover')
  assert(html.includes('aria-expanded="false"'), 'diff stays collapsed on first render')
  assert(html.includes('二进制'))
  assert(html.includes('较大文件'))
  assert(html.includes('原路径：'))
})

test('api, environments, files and tests each keep their own report shape', () => {
  const html = render(fixtures.typeSectionsBoard, fixtures.typeSectionsResult)
  assert(html.includes('data-kind="api"'))
  assert(html.includes('data-kind="environments"'))
  assert(html.includes('data-kind="files"'))
  assert(html.includes('data-kind="tests"'))
  assert(html.includes('result-workspace-method'))
  assert(html.includes('result-workspace-env'))
  assert(html.includes('result-workspace-file'))
  assert(html.includes('result-workspace-stat'))
  // Source order of sections is preserved.
  const kinds = fixtures.typeSectionsResult.sections.map(section => section.kind)
  let previous = -1
  for (const kind of kinds) {
    const index = html.indexOf(`data-kind="${kind}"`)
    assert(index > previous, `${kind} keeps source order`)
    previous = index
  }
  // Presentation contract still drives status labels only.
  assert.equal(presentation.resultPresentation(fixtures.typeSectionsBoard, fixtures.typeSectionsResult).key, 'ready')
})
```

## 3. 用户真实样例（逐字节复制）

### `result-ready-round3.json`（isolated result，ready 状态）

```json
{
  "artifacts": [
    {
      "id": "prd",
      "kind": "document",
      "title": "登录模块需求说明",
      "description": "功能范围、交互规则和验收标准。",
      "versionId": "prd-v2",
      "version": "v2.0",
      "runId": "delivery-3",
      "producedAt": "2026-10-28T12:00:00+08:00",
      "mimeType": "text/markdown",
      "sha256": "cf375c1fe73f99fb76fb203299eb11bdd82055c6a9d1141352c7e336cf69713c",
      "content": "# 登录模块需求说明\n\n## 功能范围\n- 账号密码登录\n- 短信验证码登录\n- 退出登录与角色权限校验\n\n## 验收要求\n验证码 5 分钟内有效。\n登录失败给出明确提示。\n连续失败 5 次后限制请求 10 分钟。\n退出后清除会话。\n"
    },
    {
      "id": "api",
      "kind": "document",
      "title": "登录接口文档",
      "description": "请求字段、返回值与错误处理约定。",
      "versionId": "api-v1",
      "version": "v1.0",
      "runId": "delivery-2",
      "producedAt": "2026-10-28T11:00:00+08:00",
      "mimeType": "text/markdown",
      "sha256": "73e5dd2b3ede4f5d04098a323da378863217bf88dd4d2456531f325f465bfa62",
      "content": "# 登录接口文档\n\n## POST /api/auth/login\n请求字段：account、password。\n成功返回：accessToken、expiresIn。\n错误反馈：账号密码错误、验证码过期、请求过于频繁。\n\n本文件在第三轮未修改，当前成果仍保留第二轮的交付版本。\n"
    },
    {
      "id": "report",
      "kind": "document",
      "title": "验收报告",
      "description": "验证对象与结论，保留对应的产物版本。",
      "versionId": "report-v1",
      "version": "v1.0",
      "runId": "delivery-3",
      "producedAt": "2026-10-28T12:00:00+08:00",
      "mimeType": "text/markdown",
      "sha256": "5dd2c232287bca661107d021887ab0a0a4f53d50c9c24c225e8003f2a971499d",
      "content": "# 验收报告\n\n原需求说明 prd-v1 的范围检查已通过。\n第三轮新增频率限制要求，需要针对 prd-v2 重新验证。\n"
    }
  ],
  "verdict": "模拟数据：交付文档已准备好，等待负责人完成上线验收。",
  "summary": "需求说明更新至 v2.0，新增验收报告；接口文档 v1.0 继续保留。",
  "risks": [
    {
      "level": "medium",
      "status": "open",
      "title": "短信验证码频率限制待复核",
      "id": "sms-limit",
      "owner": "周宁",
      "note": "发布前检查同一手机号及 IP 的频率限制。"
    }
  ],
  "title": "登录模块交付成果",
  "checks": [
    {
      "label": "登录与退出主流程",
      "status": "passed",
      "id": "main-flow"
    },
    {
      "label": "关键角色权限校验",
      "status": "passed",
      "id": "permission"
    },
    {
      "label": "短信验证码频率限制复核",
      "status": "pending",
      "id": "rate-limit"
    },
    {
      "id": "scope-review",
      "label": "需求范围检查",
      "status": "passed",
      "artifactId": "prd",
      "versionId": "prd-v1"
    }
  ],
  "versions": [
    {
      "author": "王明",
      "at": "2026-10-28 11:00:00",
      "note": "首次交付需求说明 v1.0 与接口文档 v1.0。",
      "id": "delivery-2",
      "status": "released",
      "version": "第 2 轮交付"
    },
    {
      "author": "王明",
      "at": "2026-10-28 12:00:00",
      "note": "需求说明更新至 v2.0，新增验收报告；接口文档 v1.0 继续保留。",
      "id": "delivery-3",
      "status": "released",
      "version": "第 3 轮交付"
    }
  ],
  "next": [
    "完成验证码频率限制复核，再进行最终验收。"
  ],
  "note": "以上内容均为本地模拟业务数据。",
  "producedAt": "2026-10-28T12:00:00+08:00",
  "teamSize": 2,
  "runId": "delivery-3",
  "tasks": [
    {
      "owner": "王明",
      "status": "done",
      "title": "登录功能开发",
      "id": "implementation",
      "progress": 100
    },
    {
      "status": "doing",
      "progress": 92,
      "title": "发布前验收",
      "id": "testing",
      "owner": "周宁",
      "note": "复核验证码频率限制。"
    }
  ],
  "updatedAt": "2026-11-11T19:09:17.9134305+08:00",
  "template": "result-v1",
  "status": "ready",
  "metrics": [
    {
      "label": "测试用例",
      "id": "cases",
      "unit": "个",
      "value": "86"
    },
    {
      "targetStatus": "met",
      "tone": "positive",
      "value": "96",
      "progress": 96,
      "unit": "%",
      "id": "rate",
      "label": "测试通过率",
      "target": "95%"
    },
    {
      "label": "待处理问题",
      "tone": "negative",
      "id": "issues",
      "unit": "项",
      "value": "1"
    }
  ],
  "team": "研发组",
  "owner": "王明",
  "decisions": [
    {
      "at": "2026-11-11",
      "choice": "账号密码 + 短信验证码",
      "id": "auth-method",
      "question": "本轮支持哪些登录方式？"
    }
  ],
  "sections": [
    {
      "kind": "changes",
      "id": "code-changes",
      "title": "文件变更",
      "files": [
        {
          "path": "src/features/auth/LoginForm.tsx",
          "status": "modified",
          "added": 6,
          "deleted": 2,
          "diff": "diff --git a/src/features/auth/LoginForm.tsx b/src/features/auth/LoginForm.tsx\n--- a/src/features/auth/LoginForm.tsx\n+++ b/src/features/auth/LoginForm.tsx\n@@ -12,6 +12,10 @@\n export function LoginForm() {\n   const [error, setError] = useState('')\n-  const submit = () => login()\n+  const [submitting, setSubmitting] = useState(false)\n+  const submit = async () => {\n+    setSubmitting(true)\n+    try { await login() } finally { setSubmitting(false) }\n+  }\n   return (\n-    <button onClick={submit}>登录</button>\n+    <button disabled={submitting} onClick={submit}>登录</button>\n   )\n"
        },
        {
          "path": "src/features/auth/useLogin.ts",
          "status": "added",
          "added": 7,
          "deleted": 0,
          "diff": "--- /dev/null\n+++ b/src/features/auth/useLogin.ts\n@@ -0,0 +1,7 @@\n+import { api } from '../../api'\n+\n+export async function login() {\n+  const response = await api.post('/auth/login')\n+  if (!response.ok) throw new Error('登录失败')\n+  return response.json()\n+}\n"
        },
        {
          "path": "tests/auth/login.test.ts",
          "status": "added",
          "added": 5,
          "deleted": 0,
          "diff": "--- /dev/null\n+++ b/tests/auth/login.test.ts\n@@ -0,0 +1,5 @@\n+test('提交过程中禁用登录按钮', async () => {\n+  render(<LoginForm />)\n+  await user.click(screen.getByRole('button', { name: '登录' }))\n+  expect(screen.getByRole('button')).toBeDisabled()\n+})\n"
        },
        {
          "path": "src/features/auth/legacyLogin.ts",
          "status": "deleted",
          "added": 0,
          "deleted": 3,
          "diff": "--- a/src/features/auth/legacyLogin.ts\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-export function legacyLogin() {\n-  return window.localStorage.getItem('legacy-token')\n-}\n"
        },
        {
          "path": "src/features/auth/session.ts",
          "previousPath": "src/features/auth/storage.ts",
          "status": "renamed",
          "added": 1,
          "deleted": 1,
          "diff": "rename from src/features/auth/storage.ts\nrename to src/features/auth/session.ts\n--- a/src/features/auth/storage.ts\n+++ b/src/features/auth/session.ts\n@@ -1,3 +1,3 @@\n-export const sessionKey = 'legacy-token'\n+export const sessionKey = 'access-token'\n export const readSession = () => localStorage.getItem(sessionKey)\n export const clearSession = () => localStorage.removeItem(sessionKey)\n"
        },
        {
          "path": "docs/login-flow.png",
          "status": "added",
          "added": 0,
          "deleted": 0,
          "binary": true
        }
      ]
    },
    {
      "items": [
        {
          "artifactId": "prd",
          "versionId": "prd-v2",
          "status": "done",
          "title": "登录模块需求说明",
          "id": "prd-meta",
          "at": "2026-10-28 12:00:00",
          "version": "v2.0"
        },
        {
          "artifactId": "api",
          "versionId": "api-v1",
          "status": "done",
          "title": "登录接口文档",
          "id": "api-meta",
          "at": "2026-10-28 11:00:00",
          "version": "v1.0"
        },
        {
          "artifactId": "report",
          "versionId": "report-v1",
          "status": "done",
          "title": "验收报告",
          "id": "report-meta",
          "at": "2026-10-28 12:00:00",
          "version": "v1.0"
        }
      ],
      "title": "交付文档",
      "id": "docs",
      "kind": "documents"
    }
  ]
}
```

### `whiteboard-ready-round3.json`（含 3 个历史交付）

```json
{
  "detailSections": [
    {
      "title": "任务范围与交付要求",
      "id": "scope",
      "blocks": [
        {
          "type": "text",
          "text": "本轮交付包含**账号密码登录、短信验证码登录、退出与角色权限校验**。当前内容由 PowerShell 通过真实 HTTP 接口发送。"
        },
        {
          "items": [
            {
              "label": "负责人",
              "value": "王明"
            },
            {
              "label": "测试负责人",
              "value": "周宁"
            },
            {
              "label": "发布条件",
              "value": "全部验收项通过，并归档测试报告"
            }
          ],
          "type": "keyValue"
        }
      ],
      "caption": "来自模拟后端的结构化详情"
    },
    {
      "title": "执行步骤与进度",
      "id": "execution",
      "blocks": [
        {
          "label": "任务拆解",
          "columns": [
            {
              "key": "task",
              "label": "工作项"
            },
            {
              "label": "负责人",
              "format": "owner",
              "key": "owner"
            },
            {
              "label": "状态",
              "format": "status",
              "key": "status"
            }
          ],
          "rows": [
            {
              "owner": "王明",
              "task": "登录流程与接口实现",
              "status": "done"
            },
            {
              "owner": "周宁",
              "task": "异常路径与权限测试",
              "status": "done"
            },
            {
              "owner": "周宁",
              "task": "发布前验收",
              "status": "active"
            }
          ],
          "type": "table"
        },
        {
          "label": "验收进度",
          "type": "progress",
          "value": 92
        }
      ]
    },
    {
      "title": "发布前检查",
      "id": "acceptance",
      "blocks": [
        {
          "items": [
            {
              "status": "passed",
              "text": "登录与退出主流程可用"
            },
            {
              "status": "passed",
              "text": "登录失败和权限不足有明确反馈"
            },
            {
              "status": "pending",
              "text": "短信验证码频率限制复核"
            }
          ],
          "type": "list"
        },
        {
          "title": "验收说明",
          "tone": "warning",
          "text": "模拟数据：交付文档已准备好，等待负责人完成上线验收。",
          "type": "callout"
        }
      ]
    }
  ],
  "title": "登录模块开发与验收 · PowerShell 联调",
  "description": "完成账号登录、短信验证、退出登录与权限校验。",
  "result": {
    "artifacts": [
      {
        "id": "prd",
        "kind": "document",
        "title": "登录模块需求说明",
        "description": "功能范围、交互规则和验收标准。",
        "versionId": "prd-v2",
        "version": "v2.0",
        "runId": "delivery-3",
        "producedAt": "2026-10-28T12:00:00+08:00",
        "mimeType": "text/markdown",
        "sha256": "cf375c1fe73f99fb76fb203299eb11bdd82055c6a9d1141352c7e336cf69713c",
        "content": "# 登录模块需求说明\n\n## 功能范围\n- 账号密码登录\n- 短信验证码登录\n- 退出登录与角色权限校验\n\n## 验收要求\n验证码 5 分钟内有效。\n登录失败给出明确提示。\n连续失败 5 次后限制请求 10 分钟。\n退出后清除会话。\n"
      },
      {
        "id": "api",
        "kind": "document",
        "title": "登录接口文档",
        "description": "请求字段、返回值与错误处理约定。",
        "versionId": "api-v1",
        "version": "v1.0",
        "runId": "delivery-2",
        "producedAt": "2026-10-28T11:00:00+08:00",
        "mimeType": "text/markdown",
        "sha256": "73e5dd2b3ede4f5d04098a323da378863217bf88dd4d2456531f325f465bfa62",
        "content": "# 登录接口文档\n\n## POST /api/auth/login\n请求字段：account、password。\n成功返回：accessToken、expiresIn。\n错误反馈：账号密码错误、验证码过期、请求过于频繁。\n\n本文件在第三轮未修改，当前成果仍保留第二轮的交付版本。\n"
      },
      {
        "id": "report",
        "kind": "document",
        "title": "验收报告",
        "description": "验证对象与结论，保留对应的产物版本。",
        "versionId": "report-v1",
        "version": "v1.0",
        "runId": "delivery-3",
        "producedAt": "2026-10-28T12:00:00+08:00",
        "mimeType": "text/markdown",
        "sha256": "5dd2c232287bca661107d021887ab0a0a4f53d50c9c24c225e8003f2a971499d",
        "content": "# 验收报告\n\n原需求说明 prd-v1 的范围检查已通过。\n第三轮新增频率限制要求，需要针对 prd-v2 重新验证。\n"
      }
    ],
    "verdict": "模拟数据：交付文档已准备好，等待负责人完成上线验收。",
    "summary": "需求说明更新至 v2.0，新增验收报告；接口文档 v1.0 继续保留。",
    "risks": [
      {
        "level": "medium",
        "status": "open",
        "title": "短信验证码频率限制待复核",
        "id": "sms-limit",
        "owner": "周宁",
        "note": "发布前检查同一手机号及 IP 的频率限制。"
      }
    ],
    "title": "登录模块交付成果",
    "checks": [
      {
        "label": "登录与退出主流程",
        "status": "passed",
        "id": "main-flow"
      },
      {
        "label": "关键角色权限校验",
        "status": "passed",
        "id": "permission"
      },
      {
        "label": "短信验证码频率限制复核",
        "status": "pending",
        "id": "rate-limit"
      },
      {
        "id": "scope-review",
        "label": "需求范围检查",
        "status": "passed",
        "artifactId": "prd",
        "versionId": "prd-v1"
      }
    ],
    "versions": [
      {
        "author": "王明",
        "at": "2026-10-28 11:00:00",
        "note": "首次交付需求说明 v1.0 与接口文档 v1.0。",
        "id": "delivery-2",
        "status": "released",
        "version": "第 2 轮交付"
      },
      {
        "author": "王明",
        "at": "2026-10-28 12:00:00",
        "note": "需求说明更新至 v2.0，新增验收报告；接口文档 v1.0 继续保留。",
        "id": "delivery-3",
        "status": "released",
        "version": "第 3 轮交付"
      }
    ],
    "next": [
      "完成验证码频率限制复核，再进行最终验收。"
    ],
    "note": "以上内容均为本地模拟业务数据。",
    "producedAt": "2026-10-28T12:00:00+08:00",
    "teamSize": 2,
    "runId": "delivery-3",
    "tasks": [
      {
        "owner": "王明",
        "status": "done",
        "title": "登录功能开发",
        "id": "implementation",
        "progress": 100
      },
      {
        "status": "doing",
        "progress": 92,
        "title": "发布前验收",
        "id": "testing",
        "owner": "周宁",
        "note": "复核验证码频率限制。"
      }
    ],
    "updatedAt": "2026-11-11T19:09:17.9134305+08:00",
    "template": "result-v1",
    "status": "ready",
    "metrics": [
      {
        "label": "测试用例",
        "id": "cases",
        "unit": "个",
        "value": "86"
      },
      {
        "targetStatus": "met",
        "tone": "positive",
        "value": "96",
        "progress": 96,
        "unit": "%",
        "id": "rate",
        "label": "测试通过率",
        "target": "95%"
      },
      {
        "label": "待处理问题",
        "tone": "negative",
        "id": "issues",
        "unit": "项",
        "value": "1"
      }
    ],
    "team": "研发组",
    "owner": "王明",
    "decisions": [
      {
        "at": "2026-11-11",
        "choice": "账号密码 + 短信验证码",
        "id": "auth-method",
        "question": "本轮支持哪些登录方式？"
      }
    ],
    "sections": [
      {
        "kind": "changes",
        "id": "code-changes",
        "title": "文件变更",
        "files": [
          {
            "path": "src/features/auth/LoginForm.tsx",
            "status": "modified",
            "added": 6,
            "deleted": 2,
            "diff": "diff --git a/src/features/auth/LoginForm.tsx b/src/features/auth/LoginForm.tsx\n--- a/src/features/auth/LoginForm.tsx\n+++ b/src/features/auth/LoginForm.tsx\n@@ -12,6 +12,10 @@\n export function LoginForm() {\n   const [error, setError] = useState('')\n-  const submit = () => login()\n+  const [submitting, setSubmitting] = useState(false)\n+  const submit = async () => {\n+    setSubmitting(true)\n+    try { await login() } finally { setSubmitting(false) }\n+  }\n   return (\n-    <button onClick={submit}>登录</button>\n+    <button disabled={submitting} onClick={submit}>登录</button>\n   )\n"
          },
          {
            "path": "src/features/auth/useLogin.ts",
            "status": "added",
            "added": 7,
            "deleted": 0,
            "diff": "--- /dev/null\n+++ b/src/features/auth/useLogin.ts\n@@ -0,0 +1,7 @@\n+import { api } from '../../api'\n+\n+export async function login() {\n+  const response = await api.post('/auth/login')\n+  if (!response.ok) throw new Error('登录失败')\n+  return response.json()\n+}\n"
          },
          {
            "path": "tests/auth/login.test.ts",
            "status": "added",
            "added": 5,
            "deleted": 0,
            "diff": "--- /dev/null\n+++ b/tests/auth/login.test.ts\n@@ -0,0 +1,5 @@\n+test('提交过程中禁用登录按钮', async () => {\n+  render(<LoginForm />)\n+  await user.click(screen.getByRole('button', { name: '登录' }))\n+  expect(screen.getByRole('button')).toBeDisabled()\n+})\n"
          },
          {
            "path": "src/features/auth/legacyLogin.ts",
            "status": "deleted",
            "added": 0,
            "deleted": 3,
            "diff": "--- a/src/features/auth/legacyLogin.ts\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-export function legacyLogin() {\n-  return window.localStorage.getItem('legacy-token')\n-}\n"
          },
          {
            "path": "src/features/auth/session.ts",
            "previousPath": "src/features/auth/storage.ts",
            "status": "renamed",
            "added": 1,
            "deleted": 1,
            "diff": "rename from src/features/auth/storage.ts\nrename to src/features/auth/session.ts\n--- a/src/features/auth/storage.ts\n+++ b/src/features/auth/session.ts\n@@ -1,3 +1,3 @@\n-export const sessionKey = 'legacy-token'\n+export const sessionKey = 'access-token'\n export const readSession = () => localStorage.getItem(sessionKey)\n export const clearSession = () => localStorage.removeItem(sessionKey)\n"
          },
          {
            "path": "docs/login-flow.png",
            "status": "added",
            "added": 0,
            "deleted": 0,
            "binary": true
          }
        ]
      },
      {
        "items": [
          {
            "artifactId": "prd",
            "versionId": "prd-v2",
            "status": "done",
            "title": "登录模块需求说明",
            "id": "prd-meta",
            "at": "2026-10-28 12:00:00",
            "version": "v2.0"
          },
          {
            "artifactId": "api",
            "versionId": "api-v1",
            "status": "done",
            "title": "登录接口文档",
            "id": "api-meta",
            "at": "2026-10-28 11:00:00",
            "version": "v1.0"
          },
          {
            "artifactId": "report",
            "versionId": "report-v1",
            "status": "done",
            "title": "验收报告",
            "id": "report-meta",
            "at": "2026-10-28 12:00:00",
            "version": "v1.0"
          }
        ],
        "title": "交付文档",
        "id": "docs",
        "kind": "documents"
      }
    ]
  },
  "template": "task-board-v1",
  "deliveries": [
    {
      "id": "delivery-1",
      "sequence": 1,
      "title": "第 1 轮 · 确认目标",
      "createdAt": "2026-10-28T10:00:00+08:00",
      "board": {
        "title": "登录模块开发与验收",
        "status": "running",
        "steps": [
          {
            "id": "scope",
            "title": "需求对齐",
            "progress": 100
          }
        ]
      },
      "result": {
        "runId": "delivery-1",
        "title": "登录模块开发与验收",
        "status": "draft",
        "owner": "王明",
        "producedAt": "2026-10-28T10:00:00+08:00",
        "updatedAt": "2026-10-28T10:00:00+08:00",
        "summary": "已确认登录模块的目标与交付范围，尚未产生文档。",
        "note": "本轮为范围确认，没有创建空文档。"
      }
    },
    {
      "id": "delivery-2",
      "sequence": 2,
      "title": "第 2 轮 · 首次文档交付",
      "createdAt": "2026-10-28T11:00:00+08:00",
      "board": {
        "title": "登录模块开发与验收",
        "status": "running",
        "steps": [
          {
            "id": "docs",
            "title": "文档交付",
            "progress": 100
          }
        ],
        "detail": "第二轮已交付需求说明和接口文档，后续根据反馈继续修改。"
      },
      "result": {
        "runId": "delivery-2",
        "title": "登录模块开发与验收",
        "status": "ready",
        "owner": "王明",
        "team": "研发组",
        "teamSize": 2,
        "producedAt": "2026-10-28T11:00:00+08:00",
        "updatedAt": "2026-10-28T11:00:00+08:00",
        "summary": "首次交付需求说明 v1.0 与接口文档 v1.0。",
        "verdict": "本轮需求范围检查通过。",
        "artifacts": [
          {
            "id": "prd",
            "kind": "document",
            "title": "登录模块需求说明",
            "description": "功能范围、交互规则和验收标准。",
            "versionId": "prd-v1",
            "version": "v1.0",
            "runId": "delivery-2",
            "producedAt": "2026-10-28T11:00:00+08:00",
            "mimeType": "text/markdown",
            "sha256": "1a53d5d7ab8ee13105d84d451e33f5d18eca5b795e024681f9ae7cb457005f82",
            "content": "# 登录模块需求说明\n\n## 功能范围\n- 账号密码登录\n- 短信验证码登录\n\n## 验收要求\n验证码 5 分钟内有效。\n登录失败给出明确提示。\n"
          },
          {
            "id": "api",
            "kind": "document",
            "title": "登录接口文档",
            "description": "请求字段、返回值与错误处理约定。",
            "versionId": "api-v1",
            "version": "v1.0",
            "runId": "delivery-2",
            "producedAt": "2026-10-28T11:00:00+08:00",
            "mimeType": "text/markdown",
            "sha256": "73e5dd2b3ede4f5d04098a323da378863217bf88dd4d2456531f325f465bfa62",
            "content": "# 登录接口文档\n\n## POST /api/auth/login\n请求字段：account、password。\n成功返回：accessToken、expiresIn。\n错误反馈：账号密码错误、验证码过期、请求过于频繁。\n\n本文件在第三轮未修改，当前成果仍保留第二轮的交付版本。\n"
          }
        ],
        "checks": [
          {
            "id": "scope-review",
            "label": "需求范围检查",
            "status": "passed",
            "artifactId": "prd",
            "versionId": "prd-v1"
          }
        ],
        "next": [
          "根据反馈补充异常处理与请求限制。"
        ]
      }
    },
    {
      "id": "delivery-3",
      "sequence": 3,
      "title": "第 3 轮 · 更新需求与验收",
      "createdAt": "2026-10-28T12:00:00+08:00",
      "board": {
        "title": "登录模块开发与验收",
        "status": "running",
        "steps": [
          {
            "id": "docs",
            "title": "文档交付",
            "progress": 100
          },
          {
            "id": "review",
            "title": "变更复核",
            "progress": 40
          }
        ],
        "detail": "第三轮新增请求限制与退出清理要求。第二轮未修改的接口文档继续保留。"
      },
      "result": {
        "runId": "delivery-3",
        "title": "登录模块开发与验收",
        "status": "ready",
        "owner": "王明",
        "team": "研发组",
        "teamSize": 2,
        "producedAt": "2026-10-28T12:00:00+08:00",
        "updatedAt": "2026-10-28T12:00:00+08:00",
        "summary": "需求说明更新至 v2.0，新增验收报告；接口文档 v1.0 继续保留。",
        "verdict": "需求新增了请求限制与退出清理要求，旧版检查不能验证当前版本。",
        "artifacts": [
          {
            "id": "prd",
            "kind": "document",
            "title": "登录模块需求说明",
            "description": "功能范围、交互规则和验收标准。",
            "versionId": "prd-v2",
            "version": "v2.0",
            "runId": "delivery-3",
            "producedAt": "2026-10-28T12:00:00+08:00",
            "mimeType": "text/markdown",
            "sha256": "cf375c1fe73f99fb76fb203299eb11bdd82055c6a9d1141352c7e336cf69713c",
            "content": "# 登录模块需求说明\n\n## 功能范围\n- 账号密码登录\n- 短信验证码登录\n- 退出登录与角色权限校验\n\n## 验收要求\n验证码 5 分钟内有效。\n登录失败给出明确提示。\n连续失败 5 次后限制请求 10 分钟。\n退出后清除会话。\n"
          },
          {
            "id": "report",
            "kind": "document",
            "title": "验收报告",
            "description": "验证对象与结论，保留对应的产物版本。",
            "versionId": "report-v1",
            "version": "v1.0",
            "runId": "delivery-3",
            "producedAt": "2026-10-28T12:00:00+08:00",
            "mimeType": "text/markdown",
            "sha256": "5dd2c232287bca661107d021887ab0a0a4f53d50c9c24c225e8003f2a971499d",
            "content": "# 验收报告\n\n原需求说明 prd-v1 的范围检查已通过。\n第三轮新增频率限制要求，需要针对 prd-v2 重新验证。\n"
          }
        ],
        "checks": [
          {
            "id": "scope-review",
            "label": "需求范围检查",
            "status": "passed",
            "artifactId": "prd",
            "versionId": "prd-v1"
          }
        ],
        "next": [
          "针对需求说明 v2.0 重新完成范围检查。"
        ]
      }
    }
  ],
  "note": "本次推送包含结构化任务详情与成果，可从“当前成果”进入查看。",
  "steps": [
    {
      "id": "docs",
      "title": "文档交付",
      "progress": 100
    },
    {
      "id": "review",
      "title": "变更复核",
      "progress": 40
    }
  ],
  "summary": "需求说明更新至 v2.0，新增验收报告；接口文档 v1.0 继续保留。",
  "tagline": "本地联调 · 模拟数据",
  "status": "running"
}
```

## 4. 视觉语言 token 摘要

- 色板：墨绿灰 `#26332b` / 正文 `#4f5d53` / 辅助 `#64736a`；强调柔和灰绿 `#3f6b53`；风险仅语义时用琥珀 `#8a6b2f`、砖红 `#a25948`。
- 字号：标题 30 / 结论 26 / 区块标题 20 / 结构化标题 18 / 正文 15–15.5 / 辅助 11.5–12.5 / 核心数字 32–36。
- 圆角：阅读容器 16；文件行无卡片；chip 4–999；无大面积阴影。
- 布局：阅读列 940（内容 852）；1787×864 阅读器 1120×824；断点 900/860/760/520；无横向溢出。
- 依赖：无新增（图标仍为既有 lucide-react）。

# 附：变更清单与「协议零改动」证明（git 自动生成）

- 分支：`feat/result-board-design`
- 最新提交：`893e493 docs(result-board): add ChatGPT review package (prompt, upload list, merged evidence)`
- 基线：`b69f24f`

命令：`git diff --stat b69f24f..HEAD -- packages server integration package.json package-lock.json`

```text
(空 —— 协议层/服务端/集成契约/依赖无任何改动)
```

改动统计：

```text
 apps/web/dev/result-board.html                     |   15 +
 apps/web/src/components/MermaidDiagram.css         |    2 +-
 apps/web/src/components/ResultArtifactList.css     |  140 ++
 apps/web/src/components/ResultArtifactList.tsx     |   99 +
 apps/web/src/components/ResultArtifactPreview.css  |   11 +-
 apps/web/src/components/ResultBlocks.css           |   37 +-
 apps/web/src/components/ResultChanges.css          |    8 +-
 apps/web/src/components/ResultChanges.tsx          |    8 +-
 apps/web/src/components/ResultDeliveryShell.css    |   30 +-
 apps/web/src/components/ResultDeliveryShell.tsx    |   19 +-
 apps/web/src/components/ResultFilePreview.css      |    2 +-
 apps/web/src/components/ResultMetrics.css          |  252 ++
 apps/web/src/components/ResultMetrics.tsx          |  122 +
 apps/web/src/components/ResultSectionCard.tsx      |   49 +-
 apps/web/src/components/ResultWorkspace.css        | 1671 +++++--------
 apps/web/src/components/ResultWorkspace.tsx        |  505 ++--
 apps/web/src/components/WhiteboardDetail.css       |    2 +-
 apps/web/src/components/WhiteboardReader.css       |    4 +-
 apps/web/src/components/WhiteboardReader.tsx       |   37 +-
 apps/web/src/dev/fixtures/result-ready-round3.json |  246 ++
 .../src/dev/fixtures/whiteboard-ready-round3.json  |  548 +++++
 apps/web/src/dev/resultBoardFixtures.ts            |  623 +++++
 apps/web/src/dev/resultBoardPreview.css            |   50 +
 apps/web/src/dev/resultBoardPreview.tsx            |   14 +
 apps/web/src/dev/resultBoardPreviewApp.tsx         |  100 +
 apps/web/src/results/board.ts                      |   84 +
 apps/web/src/results/format.ts                     |    5 +-
 .../result-board/01-affected-files-and-reuse.md    |  291 +++
 .../result-board/02-acceptance-self-check.md       |   74 +
 docs/design/result-board/03-test-report.md         |  168 ++
 docs/design/result-board/04-data-matrix.md         |  117 +
 docs/design/result-board/05-open-issues.md         |   58 +
 docs/design/result-board/06-screenshot-index.md    |   57 +
 docs/design/result-board/README.md                 |   76 +
 ...256\241\346\240\270\346\235\220\346\226\231.md" | 1620 ++++++++++++
 ...270\216\347\234\237\346\240\267\344\276\213.md" | 2591 ++++++++++++++++++++
 ...217\230\346\233\264\350\257\201\346\230\216.md" |  153 ++
 ...240\270\346\217\220\347\244\272\350\257\215.md" |   72 +
 ...270\212\344\274\240\346\270\205\345\215\225.md" |   67 +
 .../result-board/screenshots/01-home-1787x864.png  |  Bin 0 -> 747887 bytes
 .../02-result-first-screen-1787x864.png            |  Bin 0 -> 106812 bytes
 .../result-board/screenshots/03-result-full.png    |  Bin 0 -> 198715 bytes
 .../screenshots/04-markdown-reading.png            |  Bin 0 -> 58874 bytes
 .../result-board/screenshots/05-changes-diff.png   |  Bin 0 -> 56484 bytes
 .../result-board/screenshots/06-stale-check.png    |  Bin 0 -> 74529 bytes
 .../result-board/screenshots/07-mobile-390x844.png |  Bin 0 -> 68865 bytes
 .../screenshots/08-history-version-compare.png     |  Bin 0 -> 49778 bytes
 .../screenshots/09-history-delivery.png            |  Bin 0 -> 90050 bytes
 docs/design/result-board/screenshots/manifest.json |  285 +++
 scripts/result-board/capture.mjs                   |  564 +++++
 tests/resultBoard.test.mjs                         |  549 +++++
 tests/resultPresentation.test.mjs                  |   16 +-
 tests/resultReader.test.mjs                        |   21 +-
 tests/resultWorkspace.test.mjs                     |   53 +-
 tests/whiteboardDetails.test.mjs                   |   10 +-
 55 files changed, 10056 insertions(+), 1469 deletions(-)
```