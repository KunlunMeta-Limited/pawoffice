import { createContext } from 'react'
import type { ReactNode } from 'react'
import type { OfficeResult, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import type { ResultReadingMode } from './readingMode.ts'

export type ResultBodyProps = {
  board: WhiteboardTaskBoardData
  result: OfficeResult
  readingMode: ResultReadingMode
  executionKnown: boolean
  description: string
  attentionCount: number
  attentionParts: string[]
  sectionTitles: string[]
  blocks: {
    conclusion: ReactNode; delivery: ReactNode; metrics: ReactNode; review: ReactNode
    records: ReactNode; stages: ReactNode; taskDetails: ReactNode; sections: ReactNode; next: ReactNode
  }
}

export const ResultBodyPresentation = createContext<((props: ResultBodyProps) => ReactNode) | null>(null)
