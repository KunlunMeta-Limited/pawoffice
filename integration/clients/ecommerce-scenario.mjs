import { readFileSync } from 'node:fs'
import { ecommercePresentation } from './ecommerce-presentation.mjs'

export const ecommerceScenario = JSON.parse(readFileSync(new URL('../fixtures/ecommerce-workflow.json', import.meta.url), 'utf8'))
export const ecommerceConcept = readFileSync(new URL('../fixtures/ecommerce-listing-concept.svg', import.meta.url), 'utf8')

export function ecommerceResult(number, board, runId, artifact) {
  const round = ecommerceScenario.rounds[number - 1]
  if (!round) return null
  const previous = board.result.artifacts ?? []
  const items = round.files.map(file => ({ ...artifact(file.id, file.versionId, file.title, file.content, runId, file.mimeType), version: file.version,
    change: previous.some(item => item.id === file.id) ? 'updated' : 'added' }))
  if (number === 2) items.push({ ...artifact('concept', 'concept-v1', '商品页构图示意.svg', ecommerceConcept, runId, 'image/svg+xml'), kind: 'image', change: 'added', description: '用于评审首屏层次；非真实商品照片，实测参数待补齐。' })
  const current = [...previous.filter(old => !items.some(item => item.id === old.id)).map(item => ({ ...item, change: 'unchanged' })), ...items]
  const checks = []
  if (number === 5) {
    const budget = current.find(item => item.id === 'budget')
    const plan = current.find(item => item.id === 'plan')
    const listing = current.find(item => item.id === 'listing')
    const rows = budget.content.trim().split('\n').slice(1, -1)
    const sum = rows.reduce((total, row) => total + Number(row.split(',')[3]), 0)
    const definitions = [
      [budget, '预算合计为1800元', sum === 1800],
      [plan, '计划与预算采用当前版本且剩余1440元', plan.versionId === 'plan-v3' && budget.versionId === 'budget-v3' && plan.content.includes('1440')],
      [listing, '可发布文案未包含治疗或排名承诺', !/治疗颈椎病|全网第一/.test(listing.content.split('## 本次删除')[0])],
    ]
    for (const [file, label, passed] of definitions) {
      checks.push({ id: `review-${file.id}`, label, status: passed ? 'passed' : 'failed', artifactId: file.id, versionId: file.versionId })
      items.push({ ...file, change: 'unchanged' })
    }
  }
  const presentation = ecommercePresentation(number, current, new Date().toISOString())
  // A historical delivery includes exact source references even when those files were unchanged.
  for (const section of presentation.result.sections) {
    if (!section.artifactId || items.some(item => item.id === section.artifactId && item.versionId === section.versionId)) continue
    const file = current.find(item => item.id === section.artifactId && item.versionId === section.versionId)
    items.push({ ...file, change: 'unchanged' })
  }
  const changes = items.filter(item => item.change !== 'unchanged').map(item => {
    const before = previous.find(old => old.id === item.id)?.content ?? ''
    const oldLines = before ? before.replace(/\n$/, '').split('\n') : []
    const newLines = item.content.replace(/\n$/, '').split('\n')
    // Honest full-file replacement diff: the statistics describe exactly the supplied hunk.
    return { path: `青禾桌面/${item.title}`, status: before ? 'modified' : 'added', added: newLines.length, deleted: oldLines.length,
      diff: `--- ${before ? `a/青禾桌面/${item.title}` : '/dev/null'}\n+++ b/青禾桌面/${item.title}\n@@ -${oldLines.length ? '1' : '0'},${oldLines.length} +1,${newLines.length} @@\n${oldLines.map(line => `-${line}\n`).join('')}${newLines.map(line => `+${line}\n`).join('')}` }
  })
  if (changes.length) presentation.result.sections.unshift({ kind: 'changes', id: 'round-changes', title: '本轮文件变更', files: changes, span: 'full' })
  return { title: round.title, reply: round.reply,
    result: { runId, title: ecommerceScenario.title, status: checks.length ? checks.every(check => check.status === 'passed') ? 'verified' : 'rejected' : 'ready',
      ...presentation.result, artifacts: items, checks, producedAt: new Date().toISOString() }, current, board: presentation.board, dashboardTasks: presentation.dashboardTasks }
}
