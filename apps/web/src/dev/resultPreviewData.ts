import { whiteboardTaskBoardSchema } from '@pawoffice/protocol/office-ui'
import type { OfficeResult, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'

export type ResultPreviewCase = {
  id: string
  label: string
  description: string
  board: WhiteboardTaskBoardData
  result: OfficeResult
}

/** Dev-only mock endpoint registered in apps/web/vite.config.ts. */
export const resultPreviewMockUrl = '/mock/result-preview.json'

export const resultPreviewStatuses = ['verified', 'ready', 'draft', 'rejected'] as const

function readString(value: unknown, field: string, max: number) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`mock 数据缺少 ${field}`)
  const text = value.trim()
  if (text.length > max) throw new Error(`mock 数据 ${field} 超过 ${max} 字符`)
  return text
}

/**
 * Validate the mock payload and normalize every whiteboard through the same schema as production data.
 * The preview fetches this payload at runtime; changing the JSON is enough to change the page.
 */
export function parseResultPreviewPayload(value: unknown): ResultPreviewCase[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { cases?: unknown }).cases)) {
    throw new Error('mock 数据必须是 { cases: [...] } 结构')
  }
  const source = (value as { cases: unknown[] }).cases
  if (!source.length) throw new Error('mock 数据至少需要一个案例')
  const seen = new Set<string>()
  return source.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`mock 数据第 ${index + 1} 条不是对象`)
    const record = entry as Record<string, unknown>
    const id = readString(record.id, 'id', 60)
    if (seen.has(id)) throw new Error(`mock 数据存在重复的案例 id：${id}`)
    seen.add(id)
    let board
    try {
      board = whiteboardTaskBoardSchema.parse(record.whiteboard)
    } catch (error) {
      throw new Error(`mock 数据第 ${index + 1} 条的 whiteboard 无效：${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    return {
      id,
      label: readString(record.label, 'label', 40),
      description: readString(record.description, 'description', 200),
      board,
      result: board.result,
    }
  })
}
