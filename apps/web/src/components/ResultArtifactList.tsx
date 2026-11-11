import { useContext, useEffect, useRef, useState } from 'react'
import { Check, Copy, Download, ExternalLink, FileText, Image as ImageIcon, Link2, Table2 } from 'lucide-react'
import type { ResultArtifact } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { artifactIsText } from '../results/resources.ts'
import { downloadArtifact } from '../results/download.ts'
import { formatResultTimestamp } from '../results/format.ts'
import type { ResultDocumentMetadata } from '../results/board.ts'
import { ResultMarkdown } from './ResultMarkdown.tsx'
import './ResultArtifactList.css'

const artifactIcons = { document: FileText, image: ImageIcon, link: Link2, data: Table2 } as const
const changeLabels = { added: '本次新增', updated: '本次更新', removed: '本次移除（保留历史版本）', unchanged: '沿用已有版本' } as const
const documentStatusLabels = { done: '已完成', active: '进行中', pending: '待开始' } as const

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function isDisplayableImage(artifact: ResultArtifact) {
  return artifact.kind === 'image' && isHttpUrl(artifact.url)
}

function documentMetaLine(artifact: ResultArtifact, metadata?: ResultDocumentMetadata) {
  const version = artifact.version || metadata?.version || artifact.versionId || ''
  const producedAt = artifact.producedAt ? formatResultTimestamp(artifact.producedAt) : ''
  return [...new Set([version, producedAt, metadata?.at, metadata ? documentStatusLabels[metadata.status] : ''].filter(Boolean))].join(' · ')
}

export function ResultArtifactList({ artifacts, documentMeta }: {
  artifacts: readonly ResultArtifact[]
  documentMeta?: ReadonlyMap<string, ResultDocumentMetadata>
}) {
  const preview = useContext(ArtifactPreviewContext)
  const [expanded, setExpanded] = useState('')
  const [copied, setCopied] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!artifacts.length) return null
  const Icon = (artifact: ResultArtifact) => artifactIcons[artifact.kind]
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
        const metaLine = documentMetaLine(artifact, metadata)
        const KindIcon = Icon(artifact)
        return <li key={artifact.id} className="result-deliverable" data-kind={artifact.kind} data-change={artifact.change || undefined}>
          <div className="result-deliverable-main">
            <div className="result-deliverable-heading">
              {isDisplayableImage(artifact)
                ? <img className="result-deliverable-thumb" src={artifact.url} alt="" loading="lazy" aria-hidden="true" />
                : <KindIcon className="result-deliverable-glyph" size={16} strokeWidth={1.9} aria-hidden="true" />}
              <span className="result-deliverable-title" title={artifact.title}>{artifact.title}</span>
              {artifact.change && <span className="result-deliverable-change" data-change={artifact.change}>{changeLabels[artifact.change]}</span>}
              {metaLine && <span className="result-deliverable-meta">{metaLine}</span>}
            </div>
            {artifact.description && <p className="result-deliverable-description">{artifact.description}</p>}
            {canExpand && open && <div className="result-deliverable-body"><ResultMarkdown content={artifact.content} /></div>}
          </div>
          <div className="result-deliverable-actions">
            {versioned && <button type="button" className="result-deliverable-action is-primary" aria-haspopup="dialog"
              onClick={event => preview!.open(artifact, event.currentTarget)}>
              {artifact.kind === 'image' ? '查看大图' : artifact.kind === 'link' ? '查看链接' : '阅读'}
            </button>}
            {canExpand && <button type="button" className="result-deliverable-action is-primary" aria-expanded={open}
              onClick={() => setExpanded(current => current === artifact.id ? '' : artifact.id)}>{open ? '收起正文' : artifact.kind === 'image' ? '查看说明' : '阅读'}</button>}
            {artifact.kind === 'link' && !versioned && (isHttpUrl(artifact.url)
              ? <a className="result-deliverable-action is-primary" href={artifact.url} target="_blank" rel="noopener noreferrer">打开链接<ExternalLink size={12} aria-hidden="true" /></a>
              : <span className="result-deliverable-action is-disabled" aria-disabled="true">未提供可用链接</span>)}
            {!versioned && artifact.kind !== 'link' && !canExpand && isHttpUrl(artifact.url)
              && <a className="result-deliverable-action is-primary" href={artifact.url} target="_blank" rel="noopener noreferrer">打开<ExternalLink size={12} aria-hidden="true" /></a>}
            {!versioned && !canExpand && artifact.kind !== 'link' && !isHttpUrl(artifact.url)
              && <span className="result-deliverable-action is-disabled" aria-disabled="true">{artifact.kind === 'image' ? '暂无图片可预览' : '暂无正文或文件地址'}</span>}
            {artifact.content && <button type="button" className="result-deliverable-action" onClick={() => { void copy(artifact) }}>
              {copied === artifact.id ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}{copied === artifact.id ? '已复制' : '复制'}</button>}
            {(artifact.content || isHttpUrl(artifact.url)) && <button type="button" className="result-deliverable-action"
              onClick={() => { setDownloadError(''); void downloadArtifact(artifact).catch(error => setDownloadError(error instanceof Error ? error.message : '下载失败')) }}>
              <Download size={12} aria-hidden="true" />下载</button>}
          </div>
        </li>
      })}
    </ul>
  </div>
}
