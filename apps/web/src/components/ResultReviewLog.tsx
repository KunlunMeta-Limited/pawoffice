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
