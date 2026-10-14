import { useEffect, useId, useState, type ReactNode } from 'react'
import { ArtifactHtmlPreview } from '@/components/ArtifactHtmlPreview'

let mermaidModule: Promise<typeof import('mermaid')> | null = null

/** 将 Mermaid 源码按需渲染为严格安全级别的 SVG，失败时保留可读源码。 */
export function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSvg('')
    setFailed(false)
    mermaidModule ||= import('mermaid')
    void mermaidModule.then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: {
          fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", sans-serif',
          primaryColor: '#eef4f8',
          primaryBorderColor: '#6f8da5',
          primaryTextColor: '#1f2a33',
          lineColor: '#71808b',
          secondaryColor: '#f6f1e8',
          tertiaryColor: '#edf3ec',
        },
      })
      return mermaid.render(`office-mermaid-${reactId}-${Date.now()}`, source)
    }).then((result) => {
      if (!cancelled) setSvg(result.svg)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => { cancelled = true }
  }, [reactId, source])

  if (failed) return <pre className="mermaid-source"><code>{source}</code></pre>
  if (!svg) return <div className="mermaid-loading" role="status">图表渲染中…</div>
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />
}

/** 将常见 Markdown 行内语法转换成安全展示节点，不执行 HTML。 */
function inlineAssistantMarkdown(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g).filter(Boolean).map((chunk, index) => {
    if (chunk.startsWith('**') && chunk.endsWith('**')) return <strong key={index}>{chunk.slice(2, -2)}</strong>
    if (chunk.startsWith('`') && chunk.endsWith('`')) return <code key={index}>{chunk.slice(1, -1)}</code>
    const link = chunk.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/)
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    return <span key={index}>{chunk}</span>
  })
}

/** 渲染标题、列表、表格、代码和 Mermaid；供对话、文件与产物预览复用。 */
export function AssistantText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  const paragraph: string[] = []
  let list: string[] = []
  let orderedList: string[] = []
  let code: string[] = []
  let codeLanguage = ''
  let tableRows: string[][] = []
  let inCode = false
  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(<p key={`p-${blocks.length}`}>{inlineAssistantMarkdown(paragraph.join(' '))}</p>)
    paragraph.length = 0
  }
  const flushList = () => {
    if (!list.length) return
    blocks.push(<ul key={`ul-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inlineAssistantMarkdown(item)}</li>)}</ul>)
    list = []
  }
  const flushOrderedList = () => {
    if (!orderedList.length) return
    blocks.push(<ol key={`ol-${blocks.length}`}>{orderedList.map((item, index) => <li key={index}>{inlineAssistantMarkdown(item)}</li>)}</ol>)
    orderedList = []
  }
  const flushCode = () => {
    if (codeLanguage === 'mermaid') blocks.push(<MermaidDiagram key={`diagram-${blocks.length}`} source={code.join('\n')} />)
    else if (codeLanguage === 'html' || codeLanguage === 'htm') blocks.push(<ArtifactHtmlPreview key={`html-${blocks.length}`} html={code.join('\n')} compact />)
    else blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join('\n')}</code></pre>)
    code = []
    codeLanguage = ''
  }
  const flushTable = () => {
    if (tableRows.length < 2) {
      tableRows.forEach((row) => blocks.push(<p key={`p-${blocks.length}`}>{inlineAssistantMarkdown(row.join(' | '))}</p>))
      tableRows = []
      return
    }
    const separator = tableRows[1]
    const validSeparator = separator.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, '')))
    if (!validSeparator) {
      tableRows.forEach((row) => blocks.push(<p key={`p-${blocks.length}`}>{inlineAssistantMarkdown(row.join(' | '))}</p>))
      tableRows = []
      return
    }
    const [head, , ...body] = tableRows
    blocks.push(<div className="markdown-table-wrap" key={`table-${blocks.length}`}><table><thead><tr>{head.map((cell, index) => <th key={index}>{inlineAssistantMarkdown(cell)}</th>)}</tr></thead><tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{head.map((_, cellIndex) => <td key={cellIndex}>{inlineAssistantMarkdown(row[cellIndex] || '')}</td>)}</tr>)}</tbody></table></div>)
    tableRows = []
  }
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (inCode) flushCode()
      else codeLanguage = trimmed.slice(3).trim().toLowerCase()
      inCode = !inCode; flushParagraph(); flushList(); flushOrderedList(); flushTable(); return
    }
    if (inCode) { code.push(line); return }
    if (/^\|.*\|$/.test(trimmed)) {
      flushParagraph(); flushList(); flushOrderedList()
      tableRows.push(trimmed.slice(1, -1).split('|').map((cell) => cell.trim()))
      return
    }
    flushTable()
    if (!trimmed) { flushParagraph(); flushList(); flushOrderedList(); return }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { flushParagraph(); flushList(); flushOrderedList(); blocks.push(<hr key={`hr-${blocks.length}`} />); return }
    const quote = trimmed.match(/^>\s?(.*)$/)
    if (quote) { flushParagraph(); flushList(); flushOrderedList(); blocks.push(<blockquote key={`quote-${blocks.length}`}>{inlineAssistantMarkdown(quote[1])}</blockquote>); return }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      flushParagraph(); flushList(); flushOrderedList()
      const level = Math.min(heading[1].length, 4)
      const Heading = `h${level}` as keyof React.JSX.IntrinsicElements
      blocks.push(<Heading key={`h-${blocks.length}`}>{inlineAssistantMarkdown(heading[2])}</Heading>)
      return
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    if (bullet) { flushParagraph(); list.push(bullet[1]); return }
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/)
    if (ordered) { flushParagraph(); flushList(); orderedList.push(ordered[1]); return }
    if (list.length) flushList()
    if (orderedList.length) flushOrderedList()
    paragraph.push(trimmed)
  })
  if (inCode) flushCode()
  flushParagraph(); flushList(); flushOrderedList(); flushTable()
  return <div className="assistant-rich-text">{blocks}</div>
}
