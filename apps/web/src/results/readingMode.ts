import type { OfficeResult } from '@pawoffice/protocol/office-ui'
import { resultChangedFileCount } from './board.ts'

/** Two reading focuses derived from the existing fields; nothing is stored or sent back. */
export type ResultReadingMode = 'delivery' | 'fact'

const deliverySectionKinds = new Set(['documents', 'files', 'changes', 'api', 'environments', 'gallery'])

/** Delivery-first when the result actually carries files or structured deliverables. */
export function resultHasDeliverables(result: OfficeResult) {
  return result.artifacts.length > 0
    || resultChangedFileCount(result) > 0
    || result.sections.some(section => deliverySectionKinds.has(section.kind))
}

/**
 * `delivery`: the reader leads with what was handed over.
 * `fact`: there are no deliverables, so the conclusion and prose sections carry the reading.
 */
export function resultReadingMode(result: OfficeResult): ResultReadingMode {
  return resultHasDeliverables(result) ? 'delivery' : 'fact'
}

export const readingModeLabels: Record<ResultReadingMode, string> = {
  delivery: '交付型成果',
  fact: '说明型成果',
}
