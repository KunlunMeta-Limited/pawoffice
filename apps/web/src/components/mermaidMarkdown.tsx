import type { ComponentProps } from 'react'
import type { ExtraProps } from 'react-markdown'
import { MermaidDiagram } from './MermaidDiagram.tsx'

type PreProps = ComponentProps<'pre'> & ExtraProps
type HastNode = {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function classNameOf(node: HastNode): string {
  const value = node.properties?.className
  return Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : ''
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

/** Shared react-markdown `<pre>` override: ```mermaid fences become diagrams, everything else stays a code block. */
export function mermaidPre({ children, node }: PreProps) {
  const root = node as unknown as HastNode | undefined
  const code = root?.children?.find(child => child.tagName === 'code')
  if (code && /\blanguage-mermaid\b/.test(classNameOf(code))) return <MermaidDiagram source={textOf(code)} />
  return <pre>{children}</pre>
}
