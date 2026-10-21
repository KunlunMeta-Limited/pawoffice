import { memo } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const remarkPlugins = [remarkGfm]
const components: Components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
  table: ({ children }) => <div className="office-chat-table-scroll"><table>{children}</table></div>,
}

export const OfficeChatMarkdown = memo(function OfficeChatMarkdown({ content, pending = false }: { content: string; pending?: boolean }) {
  return <div className="office-chat-markdown">
    <Markdown remarkPlugins={remarkPlugins} components={components}>{content}</Markdown>
    {pending && <span className="office-chat-caret" aria-hidden="true" />}
  </div>
})
