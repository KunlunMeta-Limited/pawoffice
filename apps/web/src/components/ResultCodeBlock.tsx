import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { RootContent } from 'hast'
import { Check, Copy } from 'lucide-react'
import type { highlightCode } from '../results/highlight.ts'
import './ResultFilePreview.css'

function tokens(nodes: RootContent[]): ReactNode {
  return nodes.map((node, i) => node.type === 'text' ? node.value : node.type === 'element'
    ? <span key={i} className={Array.isArray(node.properties.className) ? node.properties.className.join(' ') : undefined}>{tokens(node.children)}</span> : null)
}

export function ResultCodeBlock({ text, language = '', copyLabel = '复制代码' }: { text: string; language?: string; copyLabel?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lines = text.split('\n')
  const long = lines.length > 18 || text.length > 8000
  const visible = long && !expanded ? lines.slice(0, 18).join('\n').slice(0, 8000) : text
  const normalized = language.toLowerCase()
  const [highlight, setHighlight] = useState<{ text: string; language: string; tree: ReturnType<typeof highlightCode> } | null>(null)
  useEffect(() => {
    if (!normalized || visible.length > 20000) return
    let active = true
    void import('../results/highlight.ts').then(module => {
      const tree = module.highlightCode(visible, normalized)
      if (active) setHighlight({ text: visible, language: normalized, tree })
    }).catch(() => { /* A code block remains readable when optional highlighting is unavailable. */ })
    return () => { active = false }
  }, [visible, normalized])
  useEffect(() => () => clearTimeout(timer.current), [])
  const tree = highlight?.text === visible && highlight.language === normalized ? highlight.tree : null
  const copy = async () => {
    setError('')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1800)
    } catch { setError('复制失败，请选择文本后手动复制。') }
  }
  return <div className="result-code-block">
    <div className="result-file-tools"><span>{language || '纯文本'} · {lines.length} 行</span>
      <button type="button" aria-pressed={wrap} onClick={() => setWrap(value => !value)}>自动换行</button>
      <button type="button" onClick={() => { void copy() }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : copyLabel}</button>
    </div>
    {error && <p className="result-file-error" role="alert">{error}</p>}
    <pre className="result-code-source" data-wrap={wrap} tabIndex={0} aria-label="代码内容"><code>{tree ? tokens(tree.children) : visible}</code></pre>
    {long && <button className="result-code-expand" type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起代码' : `展开全部 ${lines.length} 行`}</button>}
  </div>
}
