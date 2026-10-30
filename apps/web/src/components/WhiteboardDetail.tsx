import { whiteboardDetailSectionSchema } from '@pawoffice/protocol/office-ui'
import type { WhiteboardDetailSectionInput } from '@pawoffice/protocol/office-ui'
import { CustomSectionBody } from './ResultBlocks.tsx'
import './WhiteboardDetail.css'

/**
 * Expanded whiteboard detail: structured sections rendered from protocol data.
 * The reader owns typography/layout; the backend only composes primitive blocks.
 */
export function WhiteboardDetail({ sections }: { sections: WhiteboardDetailSectionInput[] }) {
  return <div className="whiteboard-detail">
    {sections.map((section, index) => {
      const normalized = whiteboardDetailSectionSchema.parse(section)
      const headingId = `whiteboard-detail-${index}`
      return <section className="whiteboard-detail-section" key={`${index}-${normalized.id}`} aria-labelledby={headingId}>
        <header className="whiteboard-detail-section-head">
          <h2 id={headingId}>{normalized.title}</h2>
          {normalized.caption && <small>{normalized.caption}</small>}
        </header>
        <CustomSectionBody section={normalized} />
      </section>
    })}
  </div>
}
