import type { WhiteboardDetailSectionInput } from '@pawoffice/protocol/office-ui'
import { WhiteboardDetail } from './WhiteboardDetail.tsx'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { resultCodePre } from './resultMarkdownCode.tsx'

/** Only authored details belong in the reader; the wall thumbnail is never a fallback. */
export function WhiteboardBoardView({ sections, detail = '' }: { sections: WhiteboardDetailSectionInput[]; html?: string; detail?: string }) {
  if (sections.length) return <WhiteboardDetail sections={sections} />
  if (detail.trim()) return <div className="whiteboard-detail whiteboard-detail-markdown">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      pre: resultCodePre,
      a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      table: ({ children }) => <div className="result-artifact-table" tabIndex={0} role="region" aria-label="白板详情表格"><table>{children}</table></div>,
    }}>{detail}</Markdown>
  </div>
  return null
}
