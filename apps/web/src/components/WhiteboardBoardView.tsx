import { WhiteboardDetail } from './WhiteboardDetail.tsx'

/** Shared body for the board tab: the authored detail page wins, the compact board is the fallback. */
export function WhiteboardBoardView({ detail, html }: { detail: string; html: string }) {
  return detail ? <WhiteboardDetail content={detail} /> : <div className="whiteboard-reader-fallback" dangerouslySetInnerHTML={{ __html: html }} />
}
