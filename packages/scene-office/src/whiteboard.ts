import { whiteboardTaskBoardSchema } from '@pawoffice/protocol/office-ui'
import type { WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
export { whiteboardTaskBoardSchema }
export type { WhiteboardTaskBoardData }
export { WhiteboardProgress } from './whiteboardProgress.ts'

export function whiteboardTaskBoard(state: Record<string, unknown>): WhiteboardTaskBoardData | null {
  const result = whiteboardTaskBoardSchema.safeParse(state.taskBoard)
  return result.success ? result.data : null
}
