import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, Clock3, FileText, FolderOpen, GitBranch, Info, LayoutGrid, ListChecks, ShieldAlert, UserRound, Users, ArrowRight } from 'lucide-react'
import type { OfficeResult, ResultRisk, ResultTask, ResultVersion, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { ResultSectionCard } from './ResultSectionCard.tsx'
import { Chip, Track } from './ResultPrimitives.tsx'
import { ResultReader } from './ResultReader.tsx'
import { ResultDeliveryShell } from './ResultDeliveryShell.tsx'
import { ResultChanges } from './ResultChanges.tsx'
import { WhiteboardBoardView } from './WhiteboardBoardView.tsx'
import { formatResultTimestamp, resultHasContent } from '../results/format.ts'
import { boardStatusLabels, resultAttention, resultContentLayout, resultPresentation } from '../results/presentation.ts'
import { resultEvidenceCheckInputs, resultEvidenceChecks } from '../results/checks.ts'
import './ResultWorkspace.css'

export type WorkspaceTab = 'overview' | 'deliverables' | 'process'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'
type StageState = 'done' | 'active' | 'pending'
type BoardStatus = NonNullable<WhiteboardTaskBoardData['status']>

const taskStatusLabels: Record<ResultTask['status'], string> = {
  todo: '待开始', doing: '进行中', blocked: '受阻', done: '已完成',
}
const versionStatusLabels: Record<ResultVersion['status'], string> = {
  draft: '草稿', released: '已发布', 'rolled-back': '已回滚',
}
const riskLevelLabels: Record<ResultRisk['level'], string> = { high: '高', medium: '中', low: '低' }
const riskStatusLabels: Record<ResultRisk['status'], string> = { open: '待处理', mitigating: '处理中', closed: '已关闭' }
const taskStatusTones: Record<ResultTask['status'], ChipTone> = {
  todo: 'pending', doing: 'active', blocked: 'danger', done: 'done',
}
const versionStatusTones: Record<ResultVersion['status'], ChipTone> = {
  draft: 'pending', released: 'done', 'rolled-back': 'danger',
}
const riskStatusTones: Record<ResultRisk['status'], ChipTone> = {
  open: 'progress', mitigating: 'active', closed: 'done',
}

const tabIcons = { overview: LayoutGrid, deliverables: FolderOpen, process: ListChecks } as const
/** The 3-step stage stepper on top of the 交付成果 tab. */
function StageSteps({ steps, status }: { steps: WhiteboardTaskBoardData['steps']; status?: BoardStatus }) {
  if (!steps.length) return null
  const values = steps.map(step => step.progress ?? -1)
  const firstOpen = values.findIndex(value => value < 100)
  return <div className="result-workspace-stage">
    <ol className="result-workspace-stage-list" data-count={steps.length}>
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
          <Track value={progress} label={`${step.title}进度`} tone={state} unknown={!known} />
        </li>
      })}
    </ol>
  </div>
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
    <Chip tone={versionStatusTones[version.status]}>{versionStatusLabels[version.status]}</Chip>
  </li>
}

function RiskRow({ risk }: { risk: ResultRisk }) {
  return <li className="result-workspace-risk">
    <div className="result-workspace-risk-head">
      <span className="result-workspace-risk-level" data-level={risk.level} title={`风险等级：${riskLevelLabels[risk.level]}`}>{riskLevelLabels[risk.level]}</span>
      <h4 className="result-workspace-risk-title">{risk.title}</h4>
      <Chip tone={riskStatusTones[risk.status]}>{riskStatusLabels[risk.status]}</Chip>
    </div>
    {(risk.owner || risk.note) && <div className="result-workspace-risk-body">
      {risk.owner && <span className="result-workspace-risk-owner"><UserRound size={12} strokeWidth={2} aria-hidden="true" />{risk.owner}</span>}
      {risk.note && <p>{risk.note}</p>}
    </div>}
  </li>
}

function DeliverablesPane({ result, active }: { result: OfficeResult; active: boolean }) {
  const { changes, documentMeta } = resultContentLayout(result)
  const sections = changes
  const targets = useRef(new Map<string, HTMLDivElement>())
  const contents = [...(result.artifacts.length ? [{ id: '@files', title: `文件 · ${result.artifacts.length}` }] : []), ...sections.map(section => ({ id: section.id, title: section.title }))]
  const locate = (id: string) => {
    const element = targets.current.get(id)
    element?.scrollIntoView({ block: 'start' })
    element?.focus({ preventScroll: true })
  }
  return <div className="result-workspace-deliverables">
    {contents.length > 1 && <nav className="result-workspace-contents" aria-label="交付物内容导航"><span>本页内容</span>
      <div>{contents.map(item => <button type="button" key={item.id} title={item.title} onClick={() => locate(item.id)}>{item.title}</button>)}</div>
    </nav>}
    {result.artifacts.length > 0 && <div ref={element => { if (element) targets.current.set('@files', element); else targets.current.delete('@files') }} tabIndex={-1} className="result-workspace-anchor">
      <ResultReader result={result} view="deliverables" documentMeta={documentMeta} /></div>}
    {sections.length > 0 && <div className="result-workspace-sections">
        {sections.map(section => <div key={section.id} className="result-workspace-anchor" tabIndex={-1}
          ref={element => { if (element) targets.current.set(section.id, element); else targets.current.delete(section.id) }}>
          <ResultChanges section={section} active={active} />
        </div>)}
      </div>}
    {!sections.length && !result.artifacts.length && <p className="result-workspace-empty">当前没有可查看的交付物。产出后将显示在这里。</p>}
  </div>
}

function TasksPane({ board, result }: { board: WhiteboardTaskBoardData; result: OfficeResult }) {
  return <div className="result-workspace-tasks-pane">
    {result.tasks.length > 0
      ? <ul className="result-workspace-tasks">{result.tasks.map(task => <TaskRow key={task.id} task={task} />)}</ul>
      : <StageSteps steps={board.steps} status={board.status} />}
    {result.next.length > 0 && <section className="result-workspace-next" aria-label="下一步">
      <header><ListChecks size={14} strokeWidth={2} aria-hidden="true" /><h3>下一步</h3></header>
      <ol>{result.next.map((item, index) => <li key={`${index}-${item}`}>
        <span aria-hidden="true">{index + 1}</span><p>{item}</p>
      </li>)}</ol>
    </section>}
  </div>
}

function VersionsPane({ result }: { result: OfficeResult }) {
  return <ol className="result-workspace-versions">
    {result.versions.map(version => <VersionRow key={version.id} version={version} />)}
  </ol>
}

function RisksPane({ result }: { result: OfficeResult }) {
  return <div className="result-workspace-risks-pane">
    {result.risks.length > 0 && <ul className="result-workspace-risks">
      {result.risks.map(risk => <RiskRow key={risk.id} risk={risk} />)}
    </ul>}
    {result.note && <p className="result-workspace-note"><Info size={14} strokeWidth={2} aria-hidden="true" /><span>{result.note}</span></p>}
  </div>
}

const tabs = [
  { key: 'overview' as const, label: '概览' },
  { key: 'deliverables' as const, label: '交付物' },
  { key: 'process' as const, label: '过程记录' },
]

type WorkspaceProps = {
  board: WhiteboardTaskBoardData; result: OfficeResult; boardHtml?: string; initialTab?: WorkspaceTab
  initialDeliveryId?: string
  onTabChange?: (tab: WorkspaceTab) => void
}

export function ResultWorkspace(props: WorkspaceProps) {
  return <ResultDeliveryShell board={props.board} result={props.result} initialDeliveryId={props.initialDeliveryId}>{(board, result, historical, executionKnown) =>
    <ResultWorkspaceBody {...props} board={board} result={result} historical={historical} executionKnown={executionKnown} boardHtml={historical ? undefined : props.boardHtml} />
  }</ResultDeliveryShell>
}

function ResultWorkspaceBody({ board, result, initialTab = 'overview', onTabChange, historical, executionKnown }: WorkspaceProps & { historical: boolean; executionKnown: boolean }) {
  const baseId = useId()
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab)
  const tabRefs = useRef<Partial<Record<WorkspaceTab, HTMLButtonElement | null>>>({})
  const title = board.title || result.title || '当前成果'
  const summaryLabel = historical ? '本次交付' : '成果概览'
  const boardStatus: BoardStatus = board.status ?? 'queued'
  const presentation = resultPresentation(board, result)
  const hasResult = resultHasContent(result)
  const delivery = resultContentLayout(result)
  const hasDeliverables = result.artifacts.length > 0 || delivery.changes.length > 0
  const attention = resultAttention(result)
  const teamLabel = result.team ? (result.teamSize === undefined ? result.team : result.team + '（' + result.teamSize + '人）') : ''
  const updatedAt = result.updatedAt || result.producedAt
  const changes = delivery.changes
  const evidenceChecks = resultEvidenceChecks(result)
  const processResult = { ...result, checks: resultEvidenceCheckInputs(result) }

  const hasAside = result.metrics.length > 0 || board.steps.length > 0
  const hasTaskDetails = Boolean(board.detailSections?.length || board.detail?.trim())
  const taskDetails = useRef<HTMLDetailsElement>(null)
  const taskList = useRef<HTMLDetailsElement>(null)
  const processTargets = useRef(new Map<string, HTMLElement>())
  const processItems = [
    ...(attention.length ? [{ id: 'attention', title: `待处理 · ${attention.length}` }] : []),
    ...(evidenceChecks.length || result.decisions.length || result.note || delivery.evidence.length ? [{ id: 'evidence', title: '验证与决策' }] : []),
    ...(result.tasks.length ? [{ id: 'tasks', title: `任务 · ${result.tasks.length}` }] : []),
    ...(result.risks.length ? [{ id: 'risks', title: `风险 · ${result.risks.length}` }] : []),
    ...(result.versions.length ? [{ id: 'versions', title: '版本记录' }] : []),
    ...(hasTaskDetails ? [{ id: 'details', title: '任务详情与协作' }] : []),
  ]
  const tabId = (key: WorkspaceTab) => baseId + '-tab-' + key
  const panelId = (key: WorkspaceTab) => baseId + '-panel-' + key
  const switchTab = (key: WorkspaceTab, focus = false) => {
    setActiveTab(key)
    onTabChange?.(key)
    if (focus) requestAnimationFrame(() => tabRefs.current[key]?.focus())
  }
  const openProcessSection = (target: string) => {
    switchTab('process')
    requestAnimationFrame(() => {
      const element = target === 'details' ? taskDetails.current : target === 'tasks' ? taskList.current : processTargets.current.get(target)
      if (!element) return
      if (element instanceof HTMLDetailsElement) element.open = true
      element.scrollIntoView({ block: 'start' })
      const focus = element.querySelector('summary') ?? element
      focus.focus({ preventScroll: true })
    })
  }
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = tabs.findIndex(tab => tab.key === activeTab)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    switchTab(tabs[next].key, true)
  }

  return <div className="result-workspace" data-status={boardStatus} data-result-status={presentation.key}>
    <header className="result-workspace-head">
      <div className="result-workspace-heading-icon" aria-hidden="true"><FolderOpen size={23} strokeWidth={1.5} /></div>
      <div className="result-workspace-heading-copy">
        <h2 className="result-workspace-title" title={title}>{title}</h2>
        <div className="result-workspace-meta">
          <span className="result-workspace-execution" data-status={executionKnown ? boardStatus : undefined}><i aria-hidden="true" />{executionKnown ? `任务 · ${boardStatusLabels[boardStatus]}` : '任务状态未提供'}</span>
          {result.owner && <span className="result-workspace-meta-item"><UserRound size={12} aria-hidden="true" />{result.owner}</span>}
          {teamLabel && <span className="result-workspace-meta-item"><Users size={12} aria-hidden="true" />{teamLabel}</span>}
          {updatedAt && <span className="result-workspace-meta-item"><Clock3 size={12} aria-hidden="true" /><time dateTime={updatedAt}
            title={`${result.updatedAt ? '更新时间' : '产出时间'}（本地时区）`}>{formatResultTimestamp(updatedAt)}</time></span>}
        </div>
      </div>
      <span className="result-workspace-result-status" data-status={presentation.key} role="status" title={presentation.description}>
        <i aria-hidden="true" />成果 · {presentation.label}
      </span>
    </header>

    <div className="result-workspace-tabs" role="tablist" aria-label="成果内容" onKeyDown={onTabKeyDown}>
      {tabs.map(item => {
        const Icon = tabIcons[item.key]
        const selected = item.key === activeTab
        return <button key={item.key} ref={element => { tabRefs.current[item.key] = element }} type="button"
          role="tab" id={tabId(item.key)} aria-selected={selected} aria-controls={panelId(item.key)} tabIndex={selected ? 0 : -1}
          onClick={() => switchTab(item.key)}><Icon size={14} aria-hidden="true" />{item.label}</button>
      })}
    </div>

    <section className="result-workspace-panel" id={panelId('overview')} role="tabpanel" aria-labelledby={tabId('overview')}
      hidden={activeTab !== 'overview'} tabIndex={0}>
      <div className="result-workspace-overview" data-aside={hasAside}>
        <div className="result-workspace-overview-lead">
          <section className="result-workspace-summary" aria-label={summaryLabel}>
            <p className="result-workspace-eyebrow">{hasResult ? summaryLabel : '当前目标'}</p>
            {(result.summary || board.summary || board.description) && <p className="result-workspace-conclusion">{result.summary || board.summary || board.description}</p>}
            {result.title && result.title !== title && <p className="result-workspace-result-title">{result.title}</p>}
            {result.verdict && <p className="result-workspace-verdict">{result.verdict}</p>}
            {(!result.verdict || presentation.key === 'conflict') && <p className="result-workspace-state-description" data-state={presentation.key}>{presentation.description}</p>}
            <div className="result-workspace-summary-actions">
              {!hasDeliverables && processItems.length > 0 && <button type="button" className="result-workspace-primary" onClick={() => switchTab('process', true)}>查看执行记录<ArrowRight size={14} aria-hidden="true" /></button>}
              {hasResult && <ResultReader result={result} view="actions" />}
            </div>
          </section>
        </div>
        {hasAside && <aside className="result-workspace-overview-aside" aria-label="成果指标与进度">
          {result.metrics.length > 0 && <ResultReader result={result} view="metrics" />}
          {board.steps.length > 0 && <section aria-label="执行进度" className="result-workspace-progress-section">
            <h3>阶段进度</h3><StageSteps steps={board.steps} status={boardStatus} />
          </section>}
        </aside>}
        <div className="result-workspace-overview-main">
          {board.description && board.description !== (result.summary || board.summary) && <section className="result-workspace-goal" aria-label="任务目标">
            <p className="result-workspace-eyebrow">任务目标</p><p>{board.description}</p>
            {hasTaskDetails && <button type="button" onClick={() => openProcessSection('details')}>查看任务详情与分工<ArrowRight size={13} aria-hidden="true" /></button>}
          </section>}
          {attention.length > 0 && <section className="result-workspace-attention-preview" aria-label="待处理事项">
            <ShieldAlert size={17} strokeWidth={1.7} aria-hidden="true" />
            <div><h3>需要关注 <span>{attention.length} 项</span></h3><p title={attention[0].title}>{attention[0].title}</p></div>
            <button type="button" onClick={() => openProcessSection('attention')} aria-label="查看全部待处理事项">查看<ArrowRight size={13} aria-hidden="true" /></button>
          </section>}
          {result.tasks.length > 0 && <section className="result-workspace-task-glance" aria-label="任务推进概况">
            <header><div><h3>任务推进</h3><span>{result.tasks.filter(task => task.status === 'done').length}/{result.tasks.length} 已完成</span></div>
              <button type="button" onClick={() => openProcessSection('tasks')}>全部任务<ArrowRight size={13} aria-hidden="true" /></button></header>
            <ul>{[...result.tasks].sort((a, b) => ({ blocked: 0, doing: 1, todo: 2, done: 3 })[a.status] - ({ blocked: 0, doing: 1, todo: 2, done: 3 })[b.status]).slice(0, 3).map(task => <li key={task.id}>
              <span>{task.title}<small>{task.owner}</small></span><Chip tone={taskStatusTones[task.status]}>{taskStatusLabels[task.status]}</Chip>
            </li>)}</ul>
          </section>}
          {changes.length > 0 && <section className="result-workspace-change-summary" aria-label="文件变化摘要">
            <div><FileText size={16} aria-hidden="true" /><span>本轮文件变更</span><strong>{changes.reduce((count, section) => count + section.files.length, 0)} 个文件</strong></div>
            <button type="button" onClick={() => switchTab('deliverables', true)}>查看变更<ArrowRight size={13} aria-hidden="true" /></button>
          </section>}
          {delivery.analysis.length > 0 && <section className="result-workspace-content-group" aria-label="分析与结论"><h3>分析与结论</h3>
            {delivery.analysis.map(section => <ResultSectionCard key={section.id} section={section} sourceArtifact={result.artifacts.find(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)} />)}
          </section>}
          {delivery.supplementary.length > 0 && <section className="result-workspace-content-group" aria-label="补充内容"><h3>补充内容</h3>
            {delivery.supplementary.map(section => <ResultSectionCard key={section.id} section={section} sourceArtifact={result.artifacts.find(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)} />)}
          </section>}
          {hasDeliverables && <section className="result-workspace-featured" aria-label="主要交付物">
            <header><h3>交付内容</h3><button type="button" onClick={() => switchTab('deliverables', true)}>查看全部<ArrowRight size={13} aria-hidden="true" /></button></header>
            {result.artifacts.length > 0
              ? <ResultReader result={result} view="featured" documentMeta={delivery.documentMeta} />
              : <p className="result-file-caption">本轮提供文件变更记录，可在交付物中查看。</p>}
          </section>}
          {result.next.length > 0 && <ResultReader result={result} view="next" />}
        </div>
      </div>
    </section>

    <section className="result-workspace-panel" id={panelId('deliverables')} role="tabpanel" aria-labelledby={tabId('deliverables')}
      hidden={activeTab !== 'deliverables'} tabIndex={0}><DeliverablesPane result={result} active={activeTab === 'deliverables'} /></section>

    <section className="result-workspace-panel" id={panelId('process')} role="tabpanel" aria-labelledby={tabId('process')}
      hidden={activeTab !== 'process'} tabIndex={0}>
      <div className="result-workspace-process">
        {processItems.length > 1 && <nav className="result-workspace-contents" aria-label="过程记录内容导航"><span>本页内容</span>
          <div>{processItems.map(item => <button type="button" key={item.id} onClick={() => openProcessSection(item.id)}>{item.title}</button>)}</div>
        </nav>}
        {!processItems.length && <p className="result-workspace-empty">当前暂无过程记录。</p>}
        {attention.length > 0 && <section tabIndex={-1} ref={element => { if (element) processTargets.current.set('attention', element) }} className="result-workspace-attention result-workspace-anchor" aria-label="全部待处理事项">
          <header><ShieldAlert size={16} aria-hidden="true" /><h3>待处理事项</h3><span>{attention.length} 项</span></header>
          <ul>{attention.map(item => <li key={item.id}><span data-danger={item.danger}>{item.label}</span><p>{item.title}</p></li>)}</ul>
        </section>}
        {(evidenceChecks.length > 0 || result.decisions.length > 0 || result.note || delivery.evidence.length > 0) && <div tabIndex={-1} className="result-workspace-anchor" ref={element => { if (element) processTargets.current.set('evidence', element) }}>
          <ResultReader result={processResult} view="process" />
          {delivery.evidence.map(section => <ResultSectionCard key={section.id} section={section} sourceArtifact={result.artifacts.find(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)} />)}
        </div>}
        {(result.risks.length > 0) && <details ref={element => { if (element) processTargets.current.set('risks', element) }} className="result-workspace-disclosure result-workspace-anchor" open>
          <summary><ShieldAlert size={15} aria-hidden="true" />风险与备注<span>{result.risks.length}</span></summary><RisksPane result={{ ...result, note: '' }} />
        </details>}
        {result.tasks.length > 0 && <details ref={taskList} className="result-workspace-disclosure result-workspace-anchor" open>
          <summary><ListChecks size={15} aria-hidden="true" />任务明细<span>{result.tasks.length}</span></summary><TasksPane board={board} result={{ ...result, next: [] }} />
        </details>}
        {result.versions.length > 0 && <details ref={element => { if (element) processTargets.current.set('versions', element) }} className="result-workspace-disclosure result-workspace-anchor">
          <summary><GitBranch size={15} aria-hidden="true" />版本记录<span>{result.versions.length}</span></summary><VersionsPane result={result} />
        </details>}
        {hasTaskDetails && <details ref={taskDetails} className="result-workspace-disclosure result-workspace-anchor" open>
          <summary><FileText size={15} aria-hidden="true" />任务详情与协作</summary>
          <WhiteboardBoardView sections={board.detailSections ?? []} detail={board.detail} />
        </details>}
      </div>
    </section>
  </div>
}
