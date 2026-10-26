import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]
const components: Components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
  table: ({ children }) => <div className="whiteboard-detail-table" role="region" aria-label="详情表格" tabIndex={0}><table>{children}</table></div>,
}

export function WhiteboardDetail({ content }: { content: string }) {
  return <div className="whiteboard-detail"><Markdown remarkPlugins={plugins} components={components} skipHtml>{content}</Markdown></div>
}
