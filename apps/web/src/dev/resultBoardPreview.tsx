/**
 * DEV-ONLY entry for the result reading page preview (`/dev/result-board.html`).
 * Not part of the production Vite build input; the UI itself lives in `resultBoardPreviewApp.tsx`.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ResultBoardPreviewApp } from './resultBoardPreviewApp.tsx'
import './resultBoardPreview.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ResultBoardPreviewApp />
  </StrictMode>,
)
