import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  Check, CheckCircle2, CircleDashed, CircleX, ClipboardCheck, Clock3, File, FileArchive, FileBarChart,
  FileDiff, FileText, FolderOpen, Gauge, GitBranch, Images, Image as ImageIcon, Info, LayoutGrid, ListChecks, Server,
  ShieldAlert, UserRound, Users, Webhook, ArrowRight,
} from 'lucide-react'
import type {
  OfficeResult, ResultApiSection, ResultDocumentsSection, ResultEnvironmentsSection,
  ResultFilesSection, ResultGallerySection, ResultRisk, ResultSection, ResultTask, ResultTestsSection, ResultVersion,
  WhiteboardTaskBoardData,
} from '@pawoffice/protocol/office-ui'
import { CustomSectionBody } from './ResultBlocks.tsx'
import { ResultReader } from './ResultReader.tsx'
import { ResultDeliveryShell } from './ResultDeliveryShell.tsx'
import { ResultChanges } from './ResultChanges.tsx'
import { WhiteboardBoardView } from './WhiteboardBoardView.tsx'
import { renderWhiteboardContent } from '@pawoffice/scene-office/task-board'
import { formatResultTimestamp, resultHasContent } from '../results/format.ts'
import { boardStatusLabels, resultAttention, resultChecks, resultDeliveryLayout, resultPresentation } from '../results/presentation.ts'
import './ResultWorkspace.css'

export type WorkspaceTab = 'overview' | 'deliverables' | 'process'
type StageState = 'done' | 'active' | 'pending'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'
type BoardStatus = NonNullable<WhiteboardTaskBoardData['status']>

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
const taskStatusLabels: Record<ResultTask['status'], string> = {
  todo: '待开始', doing: '进行中', blocked: '受阻', done: '已完成',
}
const versionStatusLabels: Record<ResultVersion['status'], string> = {
  draft: '草稿', released: '已发布', 'rolled-back': '已回滚',
}
const riskLevelLabels: Record<ResultRisk['level'], string> = { high: '高', medium: '中', low: '低' }
const riskStatusLabels: Record<ResultRisk['status'], string> = { open: '待处理', mitigating: '处理中', closed: '已关闭' }
const checkStatusLabels: Record<ResultTestsSection['checks'][number]['status'], string> = {
  passed: '已通过', pending: '待补充', failed: '未通过',
}
const fileKindLabels: Record<ResultFilesSection['items'][number]['kind'], string> = {
  image: '图片', document: '文档', report: '报告', archive: '压缩包', other: '文件',
}

const galleryStatusTones: Record<ResultGallerySection['items'][number]['status'], ChipTone> = {
  done: 'done', active: 'active', pending: 'pending',
}
const documentStatusTones: Record<ResultDocumentsSection['items'][number]['status'], ChipTone> = {
  done: 'done', active: 'progress', pending: 'pending',
}
const apiStatusTones: Record<ResultApiSection['rows'][number]['status'], ChipTone> = {
  done: 'done', active: 'active', pending: 'pending',
}
const taskStatusTones: Record<ResultTask['status'], ChipTone> = {
  todo: 'pending', doing: 'active', blocked: 'danger', done: 'done',
}
const versionStatusTones: Record<ResultVersion['status'], ChipTone> = {
  draft: 'pending', released: 'done', 'rolled-back': 'danger',
}
const riskStatusTones: Record<ResultRisk['status'], ChipTone> = {
  open: 'progress', mitigating: 'active', closed: 'done',
}

const sectionIcons = {
  gallery: Images, documents: FileText, tests: ClipboardCheck, api: Webhook, environments: Server, files: FolderOpen,
  changes: FileDiff, custom: LayoutGrid,
} as const
const tabIcons = { overview: LayoutGrid, deliverables: FolderOpen, process: ListChecks } as const
const metricToneIcons = { positive: CheckCircle2, negative: CircleX, neutral: Gauge } as const
const checkIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const
const fileKindIcons = { image: ImageIcon, document: FileText, report: FileBarChart, archive: FileArchive, other: File } as const

function Chip({ tone, children }: { tone: ChipTone; children: string }) {
  return <span className="result-workspace-chip" data-tone={tone}>{children}</span>
}

/** Compact progress track shared by the stage stepper, tests and tasks. */
function Track({ value, label, tone = 'done', unknown = false }: {
  value: number; label: string; tone?: StageState | 'danger'; unknown?: boolean
}) {
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  return <div className="result-workspace-track" data-tone={tone} data-unknown={unknown ? true : undefined}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={unknown ? undefined : percent} aria-valuetext={unknown ? '暂无进度' : `${percent}%`}>
    <i style={{ width: unknown ? '0%' : `${percent}%` }} />
  </div>
}

function GalleryBody({ section }: { section: ResultGallerySection }) {
  return <ul className="result-workspace-gallery">
    {section.items.map(item => <li key={item.id} className="result-workspace-gallery-item" data-preview={Boolean(item.image)} title={item.title}>
      <div className="result-workspace-thumb">
        {item.image
          ? <a href={item.image} target="_blank" rel="noopener noreferrer" aria-label={`查看${item.title}原图（新窗口）`}><img src={item.image} alt={item.title} loading="lazy" /></a>
          : <ImageIcon size={22} aria-hidden="true" />}
      </div>
      <div className="result-workspace-gallery-meta">
        <span className="result-workspace-gallery-label">{item.meta || item.title}</span>
        {!item.image && <small>暂无预览</small>}
        <Chip tone={galleryStatusTones[item.status]}>{galleryStatusLabels[item.status]}</Chip>
      </div>
    </li>)}
  </ul>
}

function DocumentsBody({ section }: { section: ResultDocumentsSection }) {
  return <ul className="result-workspace-docs">
    {section.items.map(item => <li key={item.id} className="result-workspace-doc">
      <span className="result-workspace-doc-icon" aria-hidden="true"><FileText size={15} strokeWidth={1.9} /></span>
      <span className="result-workspace-doc-main">
        <span className="result-workspace-doc-title" title={item.title}>{item.title}</span>
        {(item.version || item.at) && <span className="result-workspace-doc-meta">{[item.version, item.at].filter(Boolean).join(' · ')}</span>}
      </span>
      <Chip tone={documentStatusTones[item.status]}>{documentStatusLabels[item.status]}</Chip>
    </li>)}
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

function FilesBody({ section }: { section: ResultFilesSection }) {
  return <ul className="result-workspace-files">
    {section.items.map(item => {
      const Icon = fileKindIcons[item.kind]
      const body = <>
        <span className="result-workspace-file-icon" data-kind={item.kind} aria-hidden="true"><Icon size={16} strokeWidth={1.9} /></span>
        <span className="result-workspace-file-name" title={item.name}>{item.name}</span>
        {item.size && <span className="result-workspace-file-size">{item.size}</span>}
      </>
      return <li key={item.id} className="result-workspace-file">
        {item.url
          ? <a className="result-workspace-file-card" href={item.url} target="_blank" rel="noopener noreferrer"
            aria-label={`${item.name}（${fileKindLabels[item.kind]}），在新窗口打开`}>{body}</a>
          : <div className="result-workspace-file-card" title={item.name}>{body}</div>}
      </li>
    })}
  </ul>
}

function SectionBody({ section }: { section: ResultSection }) {
  switch (section.kind) {
    case 'gallery': return <GalleryBody section={section} />
    case 'documents': return <DocumentsBody section={section} />
    case 'tests': return <TestsBody section={section} />
    case 'api': return <ApiBody section={section} />
    case 'environments': return <EnvironmentsBody section={section} />
    case 'files': return <FilesBody section={section} />
    case 'changes': return <ResultChanges section={section} />
    case 'custom': return <CustomSectionBody section={section} />
  }
}

function SectionCard({ section }: { section: ResultSection }) {
  const headingId = useId()
  const Icon = sectionIcons[section.kind]
  return <section className="result-workspace-card" data-kind={section.kind} data-column={section.column}
    data-span={section.span} data-emphasis={section.emphasis} aria-labelledby={headingId}>
    <header className="result-workspace-card-head">
      <span className="result-workspace-card-icon" aria-hidden="true"><Icon size={14} strokeWidth={2} /></span>
      <h3 id={headingId}>{section.title}</h3>
      {section.caption && !/^(查看全部|查看详情|上传文件)\s*[→↗]?$/.test(section.caption.trim()) && <small>{section.caption}</small>}
    </header>
    <SectionBody section={section} />
  </section>
}

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
  const { sections, documentMeta } = resultDeliveryLayout(result)
  return <div className="result-workspace-deliverables">
    {result.artifacts.length > 0 && <ResultReader result={result} view="deliverables" documentMeta={documentMeta} />}
    {sections.length > 0 && <div className="result-workspace-sections">
        {sections.map(section => section.kind === 'changes'
          ? <ResultChanges key={section.id} section={section} active={active} />
          : <SectionCard key={section.id} section={section.kind === 'tests' ? { ...section, checks: resultChecks({ ...result, checks: section.checks }) } : section} />)}
      </div>}
    {!result.sections.length && !result.artifacts.length && <p className="result-workspace-empty">当前没有可查看的交付物。产出后将显示在这里。</p>}
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

function ResultWorkspaceBody({ board, result, boardHtml, initialTab = 'overview', onTabChange, historical, executionKnown }: WorkspaceProps & { historical: boolean; executionKnown: boolean }) {
  const baseId = useId()
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab)
  const tabRefs = useRef<Partial<Record<WorkspaceTab, HTMLButtonElement | null>>>({})
  const title = board.title || result.title || '当前成果'
  const summaryLabel = historical ? '本次交付' : '成果概览'
  const boardStatus: BoardStatus = board.status ?? 'queued'
  const presentation = resultPresentation(board, result)
  const hasResult = resultHasContent(result)
  const hasDeliverables = result.artifacts.length > 0 || result.sections.length > 0
  const attention = resultAttention(result)
  const teamLabel = result.team ? (result.teamSize === undefined ? result.team : result.team + '（' + result.teamSize + '人）') : ''
  const updatedAt = result.updatedAt || result.producedAt
  const delivery = resultDeliveryLayout(result)
  const changes = delivery.sections.filter(section => section.kind === 'changes')
  const hasAside = result.metrics.length > 0 || board.steps.length > 0
  const tabId = (key: WorkspaceTab) => baseId + '-tab-' + key
  const panelId = (key: WorkspaceTab) => baseId + '-panel-' + key
  const switchTab = (key: WorkspaceTab, focus = false) => {
    setActiveTab(key)
    onTabChange?.(key)
    if (focus) requestAnimationFrame(() => tabRefs.current[key]?.focus())
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
        <div className="result-workspace-overview-main">
          <section className="result-workspace-summary" aria-label={summaryLabel}>
            <p className="result-workspace-eyebrow">{hasResult ? summaryLabel : '当前目标'}</p>
            {(result.summary || board.summary || board.description) && <p className="result-workspace-conclusion">{result.summary || board.summary || board.description}</p>}
            {result.title && result.title !== title && <p className="result-workspace-result-title">{result.title}</p>}
            {result.verdict && <p className="result-workspace-verdict">{result.verdict}</p>}
            <p className="result-workspace-state-description" data-state={presentation.key}>{presentation.description}</p>
            <div className="result-workspace-summary-actions">
              {!hasDeliverables && <button type="button" className="result-workspace-primary" onClick={() => switchTab('process', true)}>查看执行记录<ArrowRight size={14} aria-hidden="true" /></button>}
              {hasResult && <ResultReader result={result} view="actions" />}
            </div>
          </section>
          {attention.length > 0 && <section className="result-workspace-attention-preview" aria-label="待处理事项">
            <ShieldAlert size={17} strokeWidth={1.7} aria-hidden="true" />
            <div><h3>需要关注 <span>{attention.length} 项</span></h3><p title={attention[0].title}>{attention[0].title}</p></div>
            <button type="button" onClick={() => switchTab('process', true)} aria-label="查看全部待处理事项">查看<ArrowRight size={13} aria-hidden="true" /></button>
          </section>}
          {changes.map(section => <ResultChanges key={section.id} section={section} active={activeTab === 'overview'} />)}
          {hasDeliverables && <section className="result-workspace-featured" aria-label="主要交付物">
            <header><h3>交付内容</h3><button type="button" onClick={() => switchTab('deliverables', true)}>查看全部<ArrowRight size={13} aria-hidden="true" /></button></header>
            {result.artifacts.length > 0
              ? <ResultReader result={result} view="featured" documentMeta={delivery.documentMeta} />
              : <ul className="result-workspace-section-index">{delivery.sections.slice(0, 4).map(section => {
                const Icon = sectionIcons[section.kind]
                return <li key={section.id}><Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span>{section.title}</span></li>
              })}</ul>}
          </section>}
          {result.next.length > 0 && <ResultReader result={result} view="next" />}
        </div>
        {hasAside && <aside className="result-workspace-overview-aside" aria-label="成果指标与进度">
          {result.metrics.length > 0 && <ResultReader result={result} view="metrics" />}
          {board.steps.length > 0 && <section aria-label="执行进度" className="result-workspace-progress-section">
            <h3>执行进度</h3><StageSteps steps={board.steps} status={boardStatus} />
          </section>}
        </aside>}
      </div>
    </section>

    <section className="result-workspace-panel" id={panelId('deliverables')} role="tabpanel" aria-labelledby={tabId('deliverables')}
      hidden={activeTab !== 'deliverables'} tabIndex={0}><DeliverablesPane result={result} active={activeTab === 'deliverables'} /></section>

    <section className="result-workspace-panel" id={panelId('process')} role="tabpanel" aria-labelledby={tabId('process')}
      hidden={activeTab !== 'process'} tabIndex={0}>
      <div className="result-workspace-process">
        {attention.length > 0 && <section className="result-workspace-attention" aria-label="全部待处理事项">
          <header><ShieldAlert size={16} aria-hidden="true" /><h3>待处理事项</h3><span>{attention.length} 项</span></header>
          <ul>{attention.map(item => <li key={item.id}><span data-danger={item.danger}>{item.label}</span><p>{item.title}</p></li>)}</ul>
        </section>}
        {hasResult && <ResultReader result={result} view="process" />}
        {(result.risks.length > 0) && <details className="result-workspace-disclosure" open>
          <summary><ShieldAlert size={15} aria-hidden="true" />风险与备注<span>{result.risks.length}</span></summary><RisksPane result={{ ...result, note: '' }} />
        </details>}
        {result.tasks.length > 0 && <details className="result-workspace-disclosure" open>
          <summary><ListChecks size={15} aria-hidden="true" />任务明细<span>{result.tasks.length}</span></summary><TasksPane board={board} result={{ ...result, next: [] }} />
        </details>}
        {result.versions.length > 0 && <details className="result-workspace-disclosure">
          <summary><GitBranch size={15} aria-hidden="true" />版本记录<span>{result.versions.length}</span></summary><VersionsPane result={result} />
        </details>}
        <details className="result-workspace-disclosure" open>
          <summary><FileText size={15} aria-hidden="true" />任务白板</summary>
          <WhiteboardBoardView sections={board.detailSections ?? []} detail={board.detail} html={boardHtml ?? renderWhiteboardContent({ taskBoard: board })} />
        </details>
      </div>
    </section>
  </div>
}
