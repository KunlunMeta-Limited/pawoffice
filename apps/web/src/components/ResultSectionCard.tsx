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
            ? <a href={item.image} target="_blank" rel="noopener noreferrer" aria-label={`放大查看${item.title}原图（新窗口）`}>
              <img src={item.image} alt={item.title} loading="lazy" onError={() => markFailed(item.id)} />
              <span className="result-gallery-open" aria-hidden="true">放大查看 <ExternalLink size={12} /></span>
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
