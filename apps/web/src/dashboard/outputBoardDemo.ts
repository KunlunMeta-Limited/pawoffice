import type { OutputBoard } from '@pawoffice/protocol/office-ui'
import overview from '../whiteboard/templates/output-overview.html?raw'
import detail from '../whiteboard/templates/output-detail.html?raw'
import { fillTemplate } from '../whiteboard/templates.ts'

/** Only the explicit whiteboard-demo route uses these example numbers. */
export function createOutputBoardDemo(): OutputBoard {
  const values = { sales: '328', collection: '1,286', completed: '18', total: '24', completionPercent: '75', updatedAt: '14:32', summary: '商品信息 860 条 · 竞品信息 426 条' }
  return { title: '今日成果日报', overviewHtml: fillTemplate(overview, values), detail: { format: 'html', html: fillTemplate(detail, values) } }
}
