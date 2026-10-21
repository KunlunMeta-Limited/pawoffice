import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArtifactChart } from '@/components/ArtifactChart'
import { ArtifactHtmlPreview } from '@/components/ArtifactHtmlPreview'
import { ArtifactJsonPreview } from '@/components/ArtifactJsonPreview'
import { ArtifactMap } from '@/components/ArtifactMap'
import { ArtifactShelf } from '@/components/ArtifactShelf'
import { parseArtifactChart } from '@/components/artifactChartSpec'
import { parseArtifactJavaScript } from '@/components/artifactJavaScript'
import { parseArtifactMap } from '@/components/artifactMapData'
import { AssistantText, MermaidDiagram } from '@/components/AssistantText'
import {
  registerArtifactShelfOpener,
  removeArtifactShelfSnapshot,
  setArtifactShelfSnapshot,
} from '@/services/artifactShelfStore'
import { officeGatewayApi } from '@/services/officeGatewayApi'
import type { OfficeConversationArtifact } from '@/types/officeData'

function artifactIcon(kind: OfficeConversationArtifact['kind']) {
  if (kind === 'image') return '▧'
  if (kind === 'diagram') return '◇'
  if (kind === 'markdown' || kind === 'document') return '▤'
  if (kind === 'data') return '▦'
  return '□'
}

function artifactKindLabel(kind: OfficeConversationArtifact['kind']) {
  return ({ markdown: '文档', diagram: '图表', image: '图片', document: '文档', data: '数据', text: '文本', other: '文件' })[kind]
}

function artifactDisplayName(artifact: OfficeConversationArtifact) {
  const filename = (artifact.name || artifact.path.split('/').at(-1) || '未命名产物').trim()
  return filename
    .replace(/\.chart\.json$/i, '')
    .replace(/\.(?:md|markdown|mermaid|geojson|drawio|jpeg|html?|[cm]?jsx?|tsx?|json|csv|tsv|yaml|yml|xml|mmd|svg|png|jpg|gif|webp|kml|gpx|pdf|txt)$/i, '')
    || '未命名产物'
}

function artifactCategory(artifact: OfficeConversationArtifact) {
  const value = `${artifact.name} ${artifact.path}`.toLocaleLowerCase()
  if (/\.html?$/.test(value) && /(地图|路线|map|route|行程)/.test(value)) return '互动地图'
  if (/\.(?:geojson|kml|gpx)$/.test(value)) return '路线数据'
  if (/\.(?:csv|tsv)$/.test(value) && /(poi|核验|地点|坐标)/.test(value)) return '核验清单'
  if (/\.chart\.json$/.test(value) || artifact.kind === 'diagram' || /(流程图|关系图|数据流|预算图|对比图)/.test(value)) return '可视化'
  if (artifact.kind === 'markdown' && /(索引|index)/.test(value)) return '产物索引'
  if (artifact.kind === 'markdown' && /(规划|计划|报告|方案|行程)/.test(value)) return '规划文档'
  if (artifact.kind === 'document') return /\.html?$/.test(value) ? '互动页面' : '文档'
  if (artifact.kind === 'image') return '图片'
  if (/\.(?:[cm]?js|jsx|tsx?)$/.test(value)) return '脚本'
  if (artifact.kind === 'data') return /\.(?:csv|tsv)$/.test(value) ? '表格数据' : '结构化数据'
  return artifactKindLabel(artifact.kind)
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

type ArtifactDockProps = {
  sessionId: string | null
  pending: boolean
  generation: number
  officeHidden: boolean
  workspaceId?: string
  onOpen: (artifact: OfficeConversationArtifact) => void
}

function JavaScriptStructureRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return <div><dt>{label}</dt><dd>{values.join('、')}</dd></div>
}

/**
 * 功能：显示生成脚本的静态解析状态、顶层结构和原始源码。
 * 参数：`path` 为工作区相对路径，`content` 为受控文件接口返回的文本。
 * 返回：只读 React 预览；JS/MJS/CJS 使用 Acorn，TS/TSX/JSX 明确标注仅源码。
 * 错误：语法错误显示行列和消息，不向渲染边界抛出。
 * 状态：无持久状态，不执行也不改写脚本。
 * 并发与取消：解析为同步纯计算；文件请求取消由外层查看器负责。
 * 权限：禁止 eval、Function、动态 import、script 标签和 DOM 注入。
 * 关联：CHG-2026-0019、TEST-XCHG-009。
 */
export function ArtifactJavaScriptPreview({ path, content }: { path: string; content: string }) {
  const parseable = /\.(?:[cm]?js)$/i.test(path)
  const result = useMemo(() => parseable ? parseArtifactJavaScript(path, content) : null, [content, parseable, path])
  return <div className="javascript-artifact-preview">
    {result?.ok ? <section className="javascript-parse-summary" aria-label="JavaScript 解析结果">
      <p className="data-state data-state-success">JavaScript 解析通过 · {result.sourceType === 'module' ? 'ES Module' : result.commonJsExports.length ? 'CommonJS' : 'Script'}</p>
      <dl>
        <JavaScriptStructureRow label="导入" values={result.imports} />
        <JavaScriptStructureRow label="导出" values={[...result.exports, ...result.commonJsExports]} />
        <JavaScriptStructureRow label="函数" values={result.functions} />
        <JavaScriptStructureRow label="类" values={result.classes} />
        <JavaScriptStructureRow label="变量" values={result.variables} />
      </dl>
    </section> : result ? <p className="data-state data-state-error" role="alert">JavaScript 解析失败{result.line ? `（第 ${result.line} 行${result.column ? `，第 ${result.column} 列` : ''}）` : ''}：{result.message}</p>
      : <p className="data-state data-state-warning">TypeScript/JSX 当前仅提供安全源码预览，不执行也不宣称 JavaScript 语法解析成功。</p>}
    <pre><code>{content}</code></pre>
  </div>
}

/** 在办公室左侧提供可展开的产物货架；运行中的会话会低频刷新。 */
export function ConversationArtifactDock({ sessionId, pending, generation, officeHidden, workspaceId = 'main', onOpen }: ArtifactDockProps) {
  const [artifacts, setArtifacts] = useState<OfficeConversationArtifact[]>([])
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const dockRef = useRef<HTMLElement>(null)
  const previousPendingRef = useRef(pending)
  const snapshotSourceRef = useRef(Symbol('conversation-artifact-dock'))

  useEffect(() => {
    if (!sessionId) { setArtifacts([]); setFailed(false); return }
    let cancelled = false
    let controller: AbortController | null = null
    const justCompleted = previousPendingRef.current && !pending
    previousPendingRef.current = pending
    const delayedRefreshes: number[] = []
    const load = () => {
      controller?.abort()
      controller = new AbortController()
      void officeGatewayApi.conversationArtifacts(sessionId, workspaceId, controller.signal).then((items) => {
        if (!cancelled) { setArtifacts(items); setFailed(false) }
      }).catch((error: unknown) => {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) setFailed(true)
      })
    }
    load()
    const timer = pending ? window.setInterval(load, 1200) : undefined
    if (justCompleted) {
      for (const delay of [250, 800, 1600, 3000]) {
        delayedRefreshes.push(window.setTimeout(load, delay))
      }
    }
    return () => {
      cancelled = true
      controller?.abort()
      if (timer) window.clearInterval(timer)
      delayedRefreshes.forEach((refresh) => window.clearTimeout(refresh))
    }
  }, [sessionId, pending, generation, workspaceId])

  useEffect(() => setExpanded(false), [sessionId, workspaceId])
  useEffect(() => registerArtifactShelfOpener(
    () => setExpanded(true),
    workspaceId,
    () => Boolean(dockRef.current?.isConnected),
  ), [workspaceId])
  useEffect(() => {
    const source = snapshotSourceRef.current
    setArtifactShelfSnapshot({ count: artifacts.length, pending, available: Boolean(sessionId) }, workspaceId, source)
    return () => removeArtifactShelfSnapshot(workspaceId, source)
  }, [artifacts.length, pending, sessionId, workspaceId])
  useEffect(() => {
    if (!expanded) return
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !dockRef.current?.contains(event.target)) setExpanded(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [expanded])

  const artifactGroups = useMemo(() => {
    const groups = new Map<string, OfficeConversationArtifact[]>()
    for (const artifact of artifacts) {
      const category = artifactCategory(artifact)
      const items = groups.get(category) || []
      items.push(artifact)
      groups.set(category, items)
    }
    return [...groups]
  }, [artifacts])

  if (!sessionId) return null
  const content = <section ref={dockRef} className={officeHidden ? 'conversation-artifact-inline' : 'conversation-artifact-catalog-host'} aria-label="本次对话产物">
    {officeHidden ? <ArtifactShelf variant="inline" workspaceId={workspaceId} /> : null}
    {expanded ? <div className="artifact-catalog" role="dialog" aria-label="产物清单">
      <header><div><strong>产物</strong><span>{artifacts.length}</span></div><div><small>{pending ? '持续整理中' : '本次输出'}</small><button type="button" aria-label="关闭产物清单" onClick={() => setExpanded(false)}>×</button></div></header>
      {failed ? <p className="artifact-inline-error">产物暂时无法读取</p>
        : artifacts.length === 0 ? <p className="artifact-empty-state">本次对话暂无产物</p>
          : <div className="artifact-scroll-list">{artifactGroups.map(([category, items]) => <section key={category} className="artifact-category-group" aria-label={category}>
            <h3>{category}<span>{items.length}</span></h3>
            {items.map((artifact) => <button key={artifact.id} type="button" title={`打开${artifactDisplayName(artifact)}`} onClick={() => { setExpanded(false); onOpen(artifact) }}>
              <span className="artifact-kind-icon" aria-hidden="true">{artifactIcon(artifact.kind)}</span>
              <span><strong>{artifactDisplayName(artifact)}</strong><small>{category} · {formatBytes(artifact.size)}</small></span>
            </button>)}
          </section>)}</div>}
    </div> : null}
  </section>
  const officeTarget = !officeHidden ? document.querySelector<HTMLElement>('.office-main') : null
  return officeTarget ? createPortal(content, officeTarget) : content
}

/** 全屏产物查看器；打开时由 App 临时隐藏办公室和对话侧栏。 */
export function ArtifactViewer({ artifact, onClose, embedded = false }: { artifact: OfficeConversationArtifact; onClose: () => void; embedded?: boolean }) {
  const [content, setContent] = useState('')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(artifact.kind === 'image' ? 'ready' : 'loading')

  useEffect(() => {
    if (artifact.kind === 'image') { setState('ready'); setContent(''); return }
    const controller = new AbortController()
    setState('loading')
    void officeGatewayApi.fileContent(artifact.path, controller.signal).then((result) => {
      setContent(result.content)
      setState('ready')
    }).catch(() => setState('error'))
    return () => controller.abort()
  }, [artifact])

  const mermaidFile = /\.(?:mmd|mermaid)$/i.test(artifact.path)
  const htmlFile = /\.html?$/i.test(artifact.path) || artifact.mimeType.toLocaleLowerCase().startsWith('text/html')
  const jsonFile = /\.json$/i.test(artifact.path) || artifact.mimeType.toLocaleLowerCase().includes('json')
  const sourceCodeFile = /\.(?:[cm]?js|jsx|tsx?)$/i.test(artifact.path)
  const displayName = artifactDisplayName(artifact)
  const category = artifactCategory(artifact)
  const chart = useMemo(() => state === 'ready' ? parseArtifactChart(content) : null, [content, state])
  const map = useMemo(() => state === 'ready' && !htmlFile ? parseArtifactMap(artifact.path, content) : { document: null, error: null }, [artifact.path, content, htmlFile, state])
  return <main className={`artifact-focus-view${embedded ? ' is-workspace-artifact' : ''}`} aria-label={`查看产物 ${displayName}`}>
    <header className="artifact-viewer-header">
      <div><span className="artifact-kind-icon" aria-hidden="true">{artifactIcon(artifact.kind)}</span><div><h2>{displayName}</h2><p>{category} · {formatBytes(artifact.size)}</p></div></div>
      <button type="button" className="artifact-viewer-close" aria-label="关闭产物" title="返回对话" onClick={onClose}>×</button>
    </header>
    <section className={`artifact-viewer-body artifact-${artifact.kind}${sourceCodeFile ? ' source-code-preview' : ''}`}>
      {artifact.kind === 'image'
        ? <img src={officeGatewayApi.artifactImageUrl(artifact.path)} alt={displayName} />
        : state === 'loading' ? <p className="data-state">产物加载中…</p>
          : state === 'error' ? <p className="data-state data-state-error">产物读取失败</p>
            : htmlFile ? <ArtifactHtmlPreview key={artifact.path} html={content} />
            : map.document ? <ArtifactMap document={map.document} />
              : map.error ? <div className="artifact-data-fallback"><p className="data-state data-state-warning">{map.error}</p><pre>{content}</pre></div>
              : chart ? <ArtifactChart spec={chart} />
              : artifact.kind === 'markdown' ? <AssistantText text={content} />
              : mermaidFile ? <MermaidDiagram source={content} />
                : jsonFile ? <ArtifactJsonPreview content={content} />
                  : sourceCodeFile ? <ArtifactJavaScriptPreview path={artifact.path} content={content} />
                : artifact.mimeType === 'application/pdf' ? <p className="data-state">PDF 已生成，当前版本暂不在页面内嵌显示。</p>
                  : <pre>{content}</pre>}
    </section>
  </main>
}
