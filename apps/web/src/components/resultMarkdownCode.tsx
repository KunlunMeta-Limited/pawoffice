import type { Components } from 'react-markdown'
import { ResultCodeBlock } from './ResultCodeBlock.tsx'
import { mermaidPre } from './mermaidMarkdown.tsx'

type MarkdownNode = { type?: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: MarkdownNode[] }
const nodeText = (node: MarkdownNode): string => node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(nodeText).join('')

/** Results share the code renderer; chat retains its existing Markdown behavior. */
export const resultCodePre: Components['pre'] = props => {
  const node = props.node as MarkdownNode | undefined
  const code = node?.children?.find(child => child.tagName === 'code')
  const classes = code?.properties?.className
  const language = /\blanguage-([^\s]+)/.exec(Array.isArray(classes) ? classes.join(' ') : String(classes ?? ''))?.[1] ?? ''
  if (language === 'mermaid') return mermaidPre(props)
  return code ? <ResultCodeBlock text={nodeText(code).replace(/\n$/, '')} language={language} /> : <pre>{props.children}</pre>
}
