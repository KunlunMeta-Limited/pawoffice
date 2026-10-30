import { useContext, useId } from 'react'
import { CheckCircle2, CircleDashed, CircleX, ClipboardCheck, File, FileArchive, FileBarChart, FileDiff, FileText, FolderOpen, Gauge, Images, Image as ImageIcon, LayoutGrid, Server, Webhook } from 'lucide-react'
import type { ResultArtifact, ResultApiSection, ResultDocumentsSection, ResultEnvironmentsSection, ResultFilesSection, ResultGallerySection, ResultSection, ResultTestsSection } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { CustomSectionBody } from './ResultBlocks.tsx'
import { ResultChanges } from './ResultChanges.tsx'
import { Chip, Track } from './ResultPrimitives.tsx'
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
const documentStatusTones: Record<ResultDocumentsSection['items'][number]['status'], ChipTone> = {
  done: 'done', active: 'progress', pending: 'pending',
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
        <span className="result-workspace-doc-title" title={item.title}>{item.title}</span><small>{item.artifactId ? '指定产物版本未提供' : '文档说明（未关联文件）'}</small>
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
        {item.url && !item.artifactId
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

export function ResultSectionCard({ section, sourceArtifact }: { section: ResultSection; sourceArtifact?: ResultArtifact }) {
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
    <SectionBody section={section} />
  </section>
}
