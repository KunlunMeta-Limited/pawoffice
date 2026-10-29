import type { WhiteboardDetailSectionInput } from '@pawoffice/protocol/office-ui'
import { WhiteboardDetail } from './WhiteboardDetail.tsx'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { mermaidPre } from './mermaidMarkdown.tsx'

/** Shared body for the board tab: structured detail sections win, the compact board is the fallback. */
export function WhiteboardBoardView({ sections, html, detail = '' }: { sections: WhiteboardDetailSectionInput[]; html: string; detail?: string }) {
  if (sections.length) return <WhiteboardDetail sections={sections} />
  if (detail.trim()) return <div className="whiteboard-detail whiteboard-detail-markdown">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      pre: mermaidPre,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      table: ({ children }) => <div className="result-artifact-table" tabIndex={0} role="region" aria-label="白板详情表格"><table>{children}</table></div>,
    }}>{detail}</Markdown>
  </div>
  return <div className="whiteboard-reader-fallback" dangerouslySetInnerHTML={{ __html: html }} />
}
