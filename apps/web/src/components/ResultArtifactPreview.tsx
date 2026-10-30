import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Download, ExternalLink, FileDiff, X } from 'lucide-react'
import type { ResultArtifact, ResultSection } from '@pawoffice/protocol/office-ui'
import { formatResultTimestamp } from '../results/format.ts'
import { artifactIsText, readArtifactVersion } from '../results/resources.ts'
import { compareArtifactText } from '../results/diff.ts'
import { ResultTextPreview } from './ResultTextPreview.tsx'
import { ResultSectionCard } from './ResultSectionCard.tsx'
import { ResultDiffTable } from './ResultDiffTable.tsx'
import { downloadArtifact } from '../results/download.ts'
import './ResultArtifactPreview.css'
import './ResultChanges.css'

type VersionOption = { artifact: ResultArtifact; label: string }

function useVersionBytes(artifact: ResultArtifact | undefined, enabled = true) {
  const [state, setState] = useState<{ artifact: ResultArtifact; bytes?: Uint8Array; error?: string } | null>(null)
  useEffect(() => {
    if (!artifact || !enabled) return
    const controller = new AbortController()
    readArtifactVersion(artifact, controller.signal).then(bytes => {
      if (!controller.signal.aborted) setState({ artifact, bytes })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ artifact, error: error instanceof TypeError ? '无法读取此版本，请检查文件地址、跨域配置及访问权限。' : error instanceof Error ? error.message : '无法读取文档版本。' })
    })
    return () => controller.abort()
  }, [artifact, enabled])
  return state?.artifact === artifact ? state : null
}

function VersionBody({ artifact, bytes }: { artifact: ResultArtifact; bytes: Uint8Array }) {
  const [imageUrl, setImageUrl] = useState('')
  const mime = artifact.mimeType.toLowerCase().split(';')[0]
  const image = artifact.kind === 'image' || mime.startsWith('image/')
  useEffect(() => {
    if (!image) return
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: mime.startsWith('image/') ? mime : 'application/octet-stream' }))
    setImageUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [bytes, image, mime])
  if (image) return imageUrl ? <img className="result-version-image" src={imageUrl} alt={artifact.title} /> : <p>正在读取图片…</p>
  if (!artifactIsText(artifact)) return <p className="result-version-unsupported">此格式暂不支持内嵌预览，请下载该版本或打开原始文件查看。</p>
  const text = new TextDecoder().decode(bytes)
  return <ResultTextPreview text={text} mimeType={mime} title={artifact.title} />
}

export function ResultArtifactPreview({ artifact, current, versions, origin, trigger, onClose, onSelect, catalogLoading, catalogFailed, onRetryCatalog, sections = [] }: {
  artifact: ResultArtifact; current?: ResultArtifact; versions: VersionOption[]; origin: string
  trigger: HTMLElement; onClose: () => void; onSelect: (artifact: ResultArtifact) => void
  catalogLoading?: boolean; catalogFailed?: number; onRetryCatalog?: () => void
  sections?: ResultSection[]
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [compare, setCompare] = useState(false)
  const [showRich, setShowRich] = useState(true)
  const structuredOnly = !artifact.content && !artifact.url && sections.length > 0
  const version = useVersionBytes(artifact, !structuredOnly)
  const different = Boolean(current?.versionId && artifact.versionId && current.versionId !== artifact.versionId)
  const latest = useVersionBytes(current, compare && different)
  const canCompare = different && !structuredOnly && artifactIsText(artifact) && current && Boolean(current.content || current.url) && artifactIsText(current)
  const diff = useMemo(() => compare && version?.bytes && latest?.bytes
    ? compareArtifactText(new TextDecoder().decode(version.bytes), new TextDecoder().decode(latest.bytes)) : null, [compare, version, latest])
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => {
      element.close()
      requestAnimationFrame(() => { if (trigger.isConnected) trigger.focus() })
    }
  }, [trigger])
  const [downloadError, setDownloadError] = useState('')
  const download = () => { setDownloadError(''); void downloadArtifact(artifact).catch(error => setDownloadError(error instanceof Error ? error.message : '下载失败')) }
  return <dialog ref={dialog} className="result-version-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose() }}>
    <header className="result-version-head"><div><h2 id={titleId}>{artifact.title}</h2>
      <p>{artifact.version || artifact.versionId || '未标注版本'}{origin && ` · ${origin}`}{artifact.producedAt && ` · ${formatResultTimestamp(artifact.producedAt)}`}</p>
    </div><button type="button" aria-label="关闭文档预览" onClick={onClose}><X size={20} /></button></header>
    <div className="result-version-toolbar">
      {versions.length > 1 && <label>版本<select aria-label="文档版本" value={artifact.versionId}
        onChange={event => { const selected = versions.find(item => item.artifact.versionId === event.target.value); if (selected) onSelect(selected.artifact) }}>
        {versions.map(item => <option key={item.artifact.versionId} value={item.artifact.versionId}>{item.label}</option>)}
      </select></label>}
      <button type="button" disabled={!version?.bytes} onClick={download}><Download size={14} />{structuredOnly ? '未提供原件' : '下载该版本'}</button>
      {artifact.url && <a href={artifact.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />原始文件</a>}
      {sections.length > 0 && !compare && !structuredOnly && <><button type="button" aria-pressed={showRich} onClick={() => setShowRich(true)}>内容预览</button><button type="button" aria-pressed={!showRich} onClick={() => setShowRich(false)}>文件正文</button></>}
      {canCompare && <button type="button" aria-pressed={compare} onClick={() => { setShowRich(false); setCompare(value => !value) }}><FileDiff size={14} />{compare ? '返回正文' : '与当前版本比较'}</button>}
    </div>
    {catalogLoading && <p className="result-version-notice" role="status">正在读取历史版本目录…</p>}
    {Boolean(catalogFailed) && <p className="result-version-notice" role="status">部分历史版本目录读取失败，当前仅列出可用版本。<button type="button" onClick={onRetryCatalog}>重试版本目录</button></p>}
    {different && <div className="result-version-notice" role="status">正在查看历史版本 {artifact.version || artifact.versionId}，当前采用版本 {current!.version || current!.versionId}。
      <button type="button" onClick={() => onSelect(current!)}>查看当前版本<ArrowUpRight size={13} /></button></div>}
    {!current && artifact.versionId && <p className="result-version-notice">该产物已不在当前成果集中，正在查看保留的历史版本。</p>}
    <article className="result-version-body" aria-label={compare ? '版本差异' : '文档正文'}>
      {downloadError && <p role="alert">{downloadError}</p>}
      {!version && !structuredOnly && <p role="status">正在读取指定版本…</p>}
      {version?.error && !structuredOnly && <p className="result-version-error" role="alert">{version.error} 未切换到其他版本。</p>}
      {!compare && (version?.bytes || structuredOnly) && ((showRich || structuredOnly) && sections.length > 0
        ? <div className="result-workspace result-artifact-rich-preview" aria-label="文件内容预览">{sections.map(section => <ResultSectionCard key={section.id} section={section} />)}</div>
        : version?.bytes ? <VersionBody artifact={artifact} bytes={version.bytes} /> : null)}
      {compare && version?.bytes && <>
        <p className="result-version-compare-label">{artifact.version || artifact.versionId} → {current?.version || current?.versionId} · 对比两份版本正文</p>
        {!latest && <p role="status">正在读取用于比较的当前版本…</p>}
        {latest?.error && <p role="alert" className="result-version-error">{latest.error}</p>}
        {diff?.tooLarge && <p>文档较大，请分别下载两个版本进行比较。</p>}
        {diff && !diff.tooLarge && <>
          {diff.coarse && <p className="result-version-notice">改动范围较大，以下按整段替换展示。</p>}
          {diff.truncated && <p className="result-version-notice">当前仅显示部分差异。</p>}
          {diff.lines.length ? <ResultDiffTable lines={diff.lines} label="文档版本差异" /> : <p>两个版本正文相同。</p>}
        </>}
      </>}
    </article>
    <footer className="result-version-footer">{artifact.versionId ? `版本标识：${artifact.versionId}` : '此产物未提供版本标识'}{artifact.sha256 && version?.bytes && ' · 原件 SHA-256 校验通过'}</footer>
  </dialog>
}
