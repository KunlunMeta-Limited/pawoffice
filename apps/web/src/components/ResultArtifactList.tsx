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
