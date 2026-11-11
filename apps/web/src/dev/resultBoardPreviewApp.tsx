/**
 * DEV-ONLY result reading page preview application.
 *
 * URL: /dev/result-board.html?fixture=sample|history|matrix|layouts|limits
 *      /dev/result-board.html?fixture=type-metrics|type-delivery|type-artifacts|type-review|type-versions|type-changes|type-fact|type-sections
 *      /dev/result-board.html?state=draft|ready|verified|rejected|conflict|producing|blocked|failed|missing|empty
 *      /dev/result-board.html?fixture=history&delivery=<deliveryId>
 *
 * Renders the real production reader container so screenshots match the product:
 *  - prefers the `ResultReaderDialog` export (single-flow rewrite);
 *  - until that export exists, falls back to the existing `WhiteboardReader` for boards that do
 *    carry a status, and to a structurally identical dialog wrapper for the real sample whose
 *    board has no status (so no execution state is fabricated).
 */
import { useEffect, useMemo, useRef } from 'react'
import type { ComponentType } from 'react'
import { WhiteboardProgress } from '@pawoffice/scene-office/whiteboard'
import type { OfficeResult, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { ResultWorkspace } from '../components/ResultWorkspace.tsx'
import * as readerModule from '../components/WhiteboardReader.tsx'
import {
  presentationKeys, resultBoardFixtureNames, resultBoardFixtures, resultBoardStates,
} from './resultBoardFixtures.ts'
import type { ResultBoardFixture, ResultPresentationKey } from './resultBoardFixtures.ts'

type ReaderDialogProps = {
  board: WhiteboardTaskBoardData
  result: OfficeResult
  initialDeliveryId?: string
  progress?: WhiteboardProgress
  onClose: () => void
}

/** The single-flow rewrite exposes this export; it is optional so the preview works before it lands. */
const ResultReaderDialog = (readerModule as unknown as { ResultReaderDialog?: ComponentType<ReaderDialogProps> }).ResultReaderDialog

function FallbackDialog({ board, result }: { board: WhiteboardTaskBoardData; result: OfficeResult }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (!element.open) element.showModal()
    return () => { if (element.open) element.close() }
  }, [])
  return <dialog className="whiteboard-reader is-result" aria-labelledby="result-board-preview-title" ref={dialog}>
    <header>
      <div className="whiteboard-reader-heading"><h2 id="result-board-preview-title">成果阅读器</h2></div>
      <div className="whiteboard-reader-actions">
        <button type="button" aria-label="关闭当前成果" title="关闭" onClick={() => dialog.current?.close()}>×</button>
      </div>
    </header>
    <article className="whiteboard-reader-content is-result" aria-label="当前成果内容">
      <ResultWorkspace board={board} result={result} />
    </article>
  </dialog>
}

function FallbackWhiteboardReader({ board, boardId }: { board: WhiteboardTaskBoardData; boardId: string }) {
  const progress = useMemo(() => new WhiteboardProgress(), [])
  return <readerModule.WhiteboardReader state={{ taskBoard: board }} boardId={boardId} progress={progress}
    onClose={() => { /* dev preview keeps the dialog open for capture */ }} />
}

function PreviewError({ message }: { message: string }) {
  useEffect(() => { document.body.dataset.previewError = message }, [message])
  return <div className="result-board-preview-error" role="alert">
    <strong>无法渲染该验收 fixture</strong>
    <p>{message}</p>
  </div>
}

function resolveSelection(search: string): { fixture?: ResultBoardFixture; error?: string } {
  const params = new URLSearchParams(search)
  const fixtureParam = params.get('fixture')
  const stateParam = params.get('state')
  if (stateParam) {
    if (!(presentationKeys as readonly string[]).includes(stateParam)) return { error: `未知 state：${stateParam}（可用：${presentationKeys.join(' / ')}）` }
    const state = resultBoardStates[stateParam as ResultPresentationKey]
    return { fixture: {
      name: 'sample', title: `成果状态 · ${state.label}`, dataSource: 'frontend-fixture',
      note: 'resultPresentation 十种展示态的前端验收 fixture。', board: state.board, result: state.result,
    } }
  }
  const name = fixtureParam ?? 'sample'
  if (!(resultBoardFixtureNames as readonly string[]).includes(name)) return { error: `未知 fixture：${name}（可用：${resultBoardFixtureNames.join(' / ')}）` }
  return { fixture: resultBoardFixtures[name as (typeof resultBoardFixtureNames)[number]] }
}

export function ResultBoardPreviewApp() {
  const { fixture, error } = resolveSelection(location.search)
  const deliveryId = new URLSearchParams(location.search).get('delivery') ?? undefined
  useEffect(() => {
    document.body.dataset.fixture = fixture?.name ?? 'invalid'
    document.body.dataset.presentation = new URLSearchParams(location.search).get('state') ?? ''
    void document.fonts.ready.then(() => document.body.classList.add('preview-fonts-ready'))
  }, [fixture])
  if (!fixture) return <PreviewError message={error ?? '未知错误'} />
  if (ResultReaderDialog) return <ResultReaderDialog board={fixture.board} result={fixture.result} initialDeliveryId={deliveryId} onClose={() => {}} />
  if ('status' in fixture.board) return <FallbackWhiteboardReader board={fixture.board} boardId={fixture.name} />
  return <FallbackDialog board={fixture.board} result={fixture.result} />
}
