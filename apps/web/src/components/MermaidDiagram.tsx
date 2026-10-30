import { useEffect, useId, useRef, useState } from 'react'
import type { RenderResult } from 'pele'
import './MermaidDiagram.css'

/**
 * Pele (Mermaid syntax -> themeable SVG) is lazily loaded in the browser only.
 * SSR and tests render the source as a `<pre>` placeholder because text measurement
 * needs a canvas; the client replaces it after mount.
 */
const MERMAID_FONT = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif'
const CACHE_LIMIT = 40
const renderCache = new Map<string, { svg: string; height: number }>()

type LazyPele = typeof import('pele/lazy')
let peleLoader: Promise<LazyPele> | null = null
function loadPele(): Promise<LazyPele> {
  peleLoader ??= import('pele/lazy')
  return peleLoader
}

/** The only inline SVG we accept: produced by Pele itself, with no script/event handlers. */
function isSafeRenderedSvg(svg: string): boolean {
  return /^\s*<svg[\s>]/i.test(svg)
    && !/<script[\s>]/i.test(svg)
    && !/\son[a-z]+\s*=/i.test(svg)
    && !/javascript:/i.test(svg)
}

export function MermaidDiagram({ source, caption = '', ariaLabel = '' }: {
  source: string
  caption?: string
  ariaLabel?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const idPrefix = `pele-${baseId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [width, setWidth] = useState(0)
  const [rendered, setRendered] = useState<{ svg: string; height: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const label = ariaLabel || caption || 'Mermaid 图表'

  useEffect(() => {
    const element = host.current
    if (!element) return
    const measure = () => {
      const next = Math.round(element.clientWidth)
      if (next > 0) setWidth(current => (Math.abs(current - next) < 4 ? current : next))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (width <= 0) return
    let active = true
    const key = `${idPrefix}|${width}|${source}`
    const cached = renderCache.get(key)
    if (cached) {
      setRendered(cached)
      setFailed(false)
      return
    }
    void loadPele()
      .then(({ renderAsync }) => renderAsync(source, {
        maxWidth: width,
        idPrefix,
        fontFamily: MERMAID_FONT,
        fontSize: 14,
        responsive: true,
      }))
      .then((result: RenderResult) => {
        if (!active) return
        if (!isSafeRenderedSvg(result.svg)) throw new Error('unexpected SVG output')
        const entry = { svg: result.svg, height: result.height }
        renderCache.set(key, entry)
        if (renderCache.size > CACHE_LIMIT) renderCache.delete(renderCache.keys().next().value as string)
        setRendered(entry)
        setFailed(false)
      })
      .catch(() => {
        if (!active) return
        setRendered(null)
        setFailed(true)
      })
    return () => { active = false }
  }, [width, source, idPrefix])

  return <figure className="mermaid-diagram" ref={host} data-rendered={rendered ? 'true' : 'false'}>
    {rendered
      // Pele generated this SVG from text; backend/LLM HTML or SVG is never inserted here.
      ? <div className="mermaid-diagram-svg" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: rendered.svg }} />
      : <pre className={`mermaid-placeholder${failed ? ' is-error' : ''}`} aria-label={label}>{source}</pre>}
    {failed && <figcaption className="mermaid-diagram-note">图表渲染失败，已显示原始语法。</figcaption>}
    {caption && !failed && <figcaption className="mermaid-diagram-caption">{caption}</figcaption>}
  </figure>
}

