import { createContext } from 'react'
import type { ResultArtifact } from '@pawoffice/protocol/office-ui'

export const ArtifactPreviewContext = createContext<{
  open: (artifact: ResultArtifact, trigger: HTMLElement) => void
} | null>(null)
