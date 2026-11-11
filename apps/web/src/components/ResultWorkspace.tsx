import type { ReactNode } from 'react'
import {
  ArrowRight, Check, CheckCircle2, CircleDashed, CircleX, Clock3, FileText,
  GitBranch, Info, ListChecks, ShieldAlert, UserRound, Users,
} from 'lucide-react'
import type {
  OfficeResult, ResultDecision, ResultRisk, ResultTask, ResultVersion, WhiteboardTaskBoardData,
} from '@pawoffice/protocol/office-ui'
import { ResultSectionCard } from './ResultSectionCard.tsx'
import { Chip, Track } from './ResultPrimitives.tsx'
import { ResultReader } from './ResultReader.tsx'
import { ResultDeliveryShell } from './ResultDeliveryShell.tsx'
import { ResultMetrics } from './ResultMetrics.tsx'
import { ResultArtifactList } from './ResultArtifactList.tsx'
import { WhiteboardBoardView } from './WhiteboardBoardView.tsx'
import { formatResultTimestamp, resultHasContent, resultTeamLabel } from '../results/format.ts'
import { boardStatusLabels, resultPresentation } from '../results/presentation.ts'
import {
  resultBoardChecks, resultBoardSections, resultChangedFileCount, resultCheckSummary,
  resultDocumentMetadata, resultSectionArtifact, resultStaleCheckDetail,
} from '../results/board.ts'
import './ResultWorkspace.css'

/** Kept for source compatibility with callers that still provide initialTab/onTabChange. No tabs are rendered. */
export type WorkspaceTab = 'overview' | 'deliverables' | 'process'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'
type StageState = 'done' | 'active' | 'pending'
type BoardStatus = NonNullable<WhiteboardTaskBoardData['status']>

const taskStatusLabels: Record<ResultTask['status'], string> = { todo: '待开始', doing: '进行中', blocked: '受阻', done: '已完成' }
const taskStatusTones: Record<ResultTask['status'], ChipTone> = { todo: 'pending', doing: 'active', blocked: 'danger', done: 'done' }
const versionStatusLabels: Record<ResultVersion['status'], string> = { draft: '草稿', released: '已发布', 'rolled-back': '已回滚' }
const riskLevelLabels: Record<ResultRisk['level'], string> = { high: '高', medium: '中', low: '低' }
const riskStatusLabels: Record<ResultRisk['status'], string> = { open: '待处理', mitigating: '处理中', closed: '已关闭' }
const checkStatusLabels = { passed: '已通过', pending: '待补充', failed: '未通过' } as const
const checkStatusIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const

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

function VersionRow({ version }: { version: ResultVersion }) {
  const meta = [version.author, version.at].filter(Boolean).join(' · ')
  return <li className="result-workspace-version" data-status={version.status}>
    <span className="result-workspace-version-tag">{version.version}</span>
    <span className="result-workspace-version-main">
      {version.note && <p>{version.note}</p>}
      {meta && <span className="result-workspace-version-meta">{meta}</span>}
    </span>
    <span className="result-workspace-version-state" data-status={version.status}>{versionStatusLabels[version.status]}</span>
  </li>
}

function RiskRow({ risk }: { risk: ResultRisk }) {
  return <li className="result-workspace-risk" data-level={risk.level} data-status={risk.status}>
    <div className="result-workspace-risk-head">
      <span className="result-workspace-risk-level" data-level={risk.level} title={`风险等级：${riskLevelLabels[risk.level]}`}>{riskLevelLabels[risk.level]}</span>
      <h4 className="result-workspace-risk-title">{risk.title}</h4>
      <span className="result-workspace-risk-state" data-status={risk.status}>{riskStatusLabels[risk.status]}</span>
    </div>
    {(risk.owner || risk.note) && <p className="result-workspace-risk-body">
      {risk.owner && <span className="result-workspace-risk-owner"><UserRound size={12} strokeWidth={2} aria-hidden="true" />{risk.owner} · </span>}
      {risk.note}
    </p>}
  </li>
}

function DecisionRow({ decision }: { decision: ResultDecision }) {
  return <li className="result-workspace-decision">
    <p className="result-workspace-decision-question">{decision.question}</p>
    <p className="result-workspace-decision-choice"><strong>{decision.choice}</strong>{decision.at && <time>{decision.at}</time>}</p>
  </li>
}

/** A quiet label row replaces the old per-block card header: one label, one count, no container. */
function LabelRow({ title, aside, note, children }: {
  title: string; aside?: string; note?: string; children?: ReactNode
}) {
  return <header className="result-workspace-label">
    <h3 className="result-workspace-label-title">{title}</h3>
    {aside && <p className="result-workspace-label-aside">{aside}</p>}
    {note && <p className="result-workspace-label-note">{note}</p>}
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
  const hasDelivery = artifacts.length > 0 || changeCount > 0
  const hasReview = checks.length > 0 || Boolean(result.verdict) || result.risks.length > 0
  const hasRecords = result.decisions.length > 0 || result.tasks.length > 0 || result.versions.length > 0
  const hasTrail = Boolean(board.detailSections?.length) || (statusKnown && board.steps.length > 0)
  const checkSummaryParts = [
    checkSummary.passed ? `${checkSummary.passed} 项标记通过` : '',
    checkSummary.pending ? `${checkSummary.pending} 项待处理` : '',
    checkSummary.failed ? `${checkSummary.failed} 项未通过` : '',
    checkSummary.stale ? `${checkSummary.stale} 项待补充验证` : '',
  ].filter(Boolean)
  const attentionParts = [
    checkSummary.pending ? `${checkSummary.pending} 项待处理检查` : '',
    checkSummary.failed ? `${checkSummary.failed} 项未通过检查` : '',
    checkSummary.stale ? `${checkSummary.stale} 项待补充验证` : '',
    openRisks ? `${openRisks} 项待处理风险` : '',
    blockedTasks ? `${blockedTasks} 项受阻任务` : '',
  ].filter(Boolean)
  const outsizedTitle = title.length > 48
  return <div className="result-workspace" data-result-status={presentation.key} data-status={boardStatus} data-historical={historical ? 'true' : undefined}>
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

    {hasDelivery && <section className="result-workspace-delivery" aria-label="本轮交付">
      <LabelRow title="本轮交付" aside={[
        artifacts.length ? `${artifacts.length} 份交付文件` : '',
        changeCount ? `${changeCount} 个文件变更` : '',
      ].filter(Boolean).join(' · ')} />
      {artifacts.length > 0
        ? <ResultArtifactList artifacts={artifacts} documentMeta={documentMeta} />
        : <p className="result-workspace-hint">本轮没有文件交付，工作成果以变更记录与正文呈现。</p>}
    </section>}

    {hasReview && <section className="result-workspace-review" aria-label="验证与验收">
      <LabelRow title="验证与验收">
        <p className="result-workspace-caption" data-state={presentation.key}>{presentation.description}</p>
      </LabelRow>
      {checks.length > 0 && <>
        <p className="result-workspace-check-summary">{`共 ${checkSummary.total} 项检查：${checkSummaryParts.join(' · ')}`}</p>
        {checkSummary.stale > 0 && <p className="result-workspace-check-hint">待补充验证项的原验证对象与当前交付版本不一致，不能按通过计。</p>}
        <ul className="result-workspace-checks">{checks.map(check => {
          const status = check.stale ? 'pending' : check.status
          const Icon = checkStatusIcons[status]
          return <li key={JSON.stringify([check.id, check.artifactId, check.versionId])} data-status={check.stale ? 'stale' : check.status}>
            <Icon size={15} strokeWidth={2} aria-hidden="true" />
            <span className="result-workspace-check-label">{check.label}</span>
            <em>{check.stale ? '待补充验证' : checkStatusLabels[status]}</em>
            {check.stale && <small>{resultStaleCheckDetail(result, check)}</small>}
          </li>
        })}</ul>
      </>}
      {result.risks.length > 0 && <div className="result-workspace-risks">
        <h4 className="result-workspace-subhead"><ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />风险记录<span>{result.risks.length}</span></h4>
        <ul className="result-workspace-risk-list">{result.risks.map(risk => <RiskRow key={risk.id} risk={risk} />)}</ul>
      </div>}
      {!hasReview && <p className="result-workspace-hint">本轮没有提供检查项或验收结论。</p>}
    </section>}

    {result.metrics.length > 0 && <section className="result-workspace-metric-band" aria-label={result.metricsTitle || '关键指标'}>
      <LabelRow title={result.metricsTitle || '关键指标'} aside={result.metricsCaption || undefined} />
      <ResultMetrics metrics={result.metrics} />
    </section>}

    {sections.length > 0 && <section className="result-workspace-detail" aria-label="详细内容">
      {sections.map(section => <ResultSectionCard key={section.id} section={section} artifacts={artifacts}
        sourceArtifact={resultSectionArtifact(result, section)} />)}
    </section>}

    {hasRecords && <section className="result-workspace-records" aria-label="工作过程">
      <LabelRow title="工作过程" aside={[
        result.decisions.length ? `决策 ${result.decisions.length}` : '',
        result.tasks.length ? `任务 ${result.tasks.length}` : '',
        result.versions.length ? `版本 ${result.versions.length}` : '',
      ].filter(Boolean).join(' · ')} />
      <div className="result-workspace-record-grid">
        {result.decisions.length > 0 && <div className="result-workspace-record">
          <h4 className="result-workspace-subhead"><ListChecks size={14} strokeWidth={2} aria-hidden="true" />决策记录</h4>
          <ol className="result-workspace-decisions">{result.decisions.map(decision => <DecisionRow key={decision.id} decision={decision} />)}</ol>
        </div>}
        {result.tasks.length > 0 && <div className="result-workspace-record">
          <h4 className="result-workspace-subhead"><UserRound size={14} strokeWidth={2} aria-hidden="true" />任务推进</h4>
          <ul className="result-workspace-tasks">{result.tasks.map(task => <TaskRow key={task.id} task={task} />)}</ul>
        </div>}
        {result.versions.length > 0 && <div className="result-workspace-record">
          <h4 className="result-workspace-subhead"><GitBranch size={14} strokeWidth={2} aria-hidden="true" />版本记录</h4>
          <ol className="result-workspace-versions">{result.versions.map(version => <VersionRow key={version.id} version={version} />)}</ol>
        </div>}
      </div>
    </section>}

    {result.next.length > 0 && <section className="result-workspace-next" aria-label="下一步">
      <LabelRow title="下一步" aside={`${result.next.length} 项行动`} />
      <ol className="result-workspace-next-list">{result.next.map((item, index) => <li key={`${index}-${item}`}>
        <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><p>{item}</p>
      </li>)}</ol>
    </section>}

    {hasTrail && <section className="result-workspace-trail" aria-label="执行过程与任务详情">
      {statusKnown && board.steps.length > 0 && <details className="result-workspace-disclosure">
        <summary><ArrowRight size={14} strokeWidth={2} aria-hidden="true" />执行阶段<span>{board.steps.length}</span></summary>
        <StageSteps steps={board.steps} status={boardStatus} />
      </details>}
      {Boolean(board.detailSections?.length) && <details className="result-workspace-disclosure">
        <summary><FileText size={14} strokeWidth={2} aria-hidden="true" />任务详情与协作</summary>
        <WhiteboardBoardView sections={board.detailSections ?? []} />
      </details>}
    </section>}

    {result.note && <p className="result-workspace-note"><Info size={14} strokeWidth={2} aria-hidden="true" /><span>{result.note}</span></p>}

    {!hasResult && <p className="result-workspace-empty">当前没有可阅读的成果内容。任务推进并交付后，结果会显示在这里。</p>}
  </div>
}
