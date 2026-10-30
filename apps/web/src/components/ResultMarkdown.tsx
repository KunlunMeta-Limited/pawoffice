import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { resultCodePre } from './resultMarkdownCode.tsx'

const components: Components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
  table: ({ children }) => <div className="result-artifact-table" role="region" aria-label="交付物表格" tabIndex={0}><table>{children}</table></div>,
  img: ({ src, alt, title }) => typeof src === 'string' && src ? <img src={src} alt={alt ?? ''} title={title} loading="lazy" /> : <span>{alt}</span>,
  pre: resultCodePre,
}

export function ResultMarkdown({ content }: { content: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>{content}</Markdown>
}
