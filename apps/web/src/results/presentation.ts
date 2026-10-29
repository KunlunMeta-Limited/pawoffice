import type { OfficeResult, ResultDocumentsSection, ResultSection, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { resultHasContent, resultStatusLabels } from './format.ts'
import { resultChecks } from './checks.ts'
export { resultChecks } from './checks.ts'

export const boardStatusLabels = {
  queued: '待开始', running: '执行中', blocked: '执行受阻', completed: '已完成', failed: '执行失败',
} as const

export function resultPresentation(board: WhiteboardTaskBoardData, result: OfficeResult) {
  // An explicit delivery/verification state remains meaningful even before its content arrives.
  if (resultHasContent(result) || result.status !== 'draft') {
    const descriptions = {
      draft: '当前为阶段草稿，后续可能继续更新。',
      ready: '成果已交付，尚未标记为验证通过。',
      verified: '成果已标记为验证通过，可查看交付内容与验收依据。',
      rejected: '成果未通过验证，请先查看结论与待处理项。',
    }
    return { key: result.status, label: resultStatusLabels[result.status], description: descriptions[result.status] }
  }
  if (board.status === 'running') return { key: 'producing', label: '正在产出', description: '任务正在执行，成果内容将在产出后显示。' }
  if (board.status === 'blocked') return { key: 'blocked', label: '产出受阻', description: '任务执行受阻，当前尚无成果。请查看过程记录。' }
  if (board.status === 'failed') return { key: 'failed', label: '尚无成果', description: '任务执行失败，当前没有可查看的成果。' }
  if (board.status === 'completed') return { key: 'missing', label: '尚未交付', description: '任务已结束，但尚未收到成果内容。' }
  return { key: 'empty', label: '暂无成果', description: '任务尚未开始，交付内容将在这里汇总。' }
}

export function resultAttention(result: OfficeResult) {
  const checks = [
    ...resultChecks(result).map(check => ({ ...check, key: `check-${check.id}` })),
    ...result.sections.flatMap(section => section.kind === 'tests'
      ? resultChecks({ ...result, checks: section.checks }).map(check => ({ ...check, key: `${section.id}-${check.id}` })) : []),
  ].filter(check => check.status !== 'passed').map(check => ({
    id: check.key, title: check.label, label: check.status === 'failed' ? '未通过' : '待补充',
    danger: check.status === 'failed',
  }))
  const risks = result.risks.filter(risk => risk.status !== 'closed').map(risk => ({
    id: `risk-${risk.id}`, title: risk.title, label: risk.level === 'high' ? '高风险' : '风险', danger: risk.level === 'high',
  }))
  const tasks = result.tasks.filter(task => task.status === 'blocked').map(task => ({
    id: `task-${task.id}`, title: task.title, label: '任务受阻', danger: false,
  }))
  return [...checks, ...risks, ...tasks].sort((a, b) => Number(b.danger) - Number(a.danger))
}

export type ResultDocumentMetadata = ResultDocumentsSection['items'][number]

/** Merge only unambiguous document titles; preserve metadata and the original export payload. */
export function resultDeliveryLayout(result: OfficeResult) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
  const documents = result.sections.flatMap(section => section.kind === 'documents' ? section.items : [])
  const documentMeta = new Map<string, ResultDocumentMetadata>()
  const merged = new Set<ResultDocumentMetadata>()
  for (const artifact of result.artifacts) {
    const title = normalize(artifact.title)
    const matches = documents.filter(item => normalize(item.title) === title)
    if (matches.length !== 1 || result.artifacts.filter(item => normalize(item.title) === title).length !== 1) continue
    if (artifact.kind === 'image') continue
    documentMeta.set(artifact.id, matches[0])
    merged.add(matches[0])
  }
  const sections = result.sections.flatMap<ResultSection>(section => {
    if (section.kind !== 'documents') return [section]
    const items = section.items.filter(item => !merged.has(item))
    return items.length ? [{ ...section, items }] : []
  })
  return { sections, documentMeta }
}
