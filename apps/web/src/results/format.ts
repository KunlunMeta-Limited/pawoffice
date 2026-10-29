import type { OfficeResult, ResultBlock, ResultSection } from '@pawoffice/protocol/office-ui'
import { resultChecks } from './checks.ts'

type ResultMetric = OfficeResult['metrics'][number]
type ResolvedKind = 'comparison' | 'value' | 'status' | 'target' | 'text'

export const resultStatusLabels: Record<OfficeResult['status'], string> = {
  verified: '已验证', ready: '已交付', draft: '草稿', rejected: '未通过',
}

/** Backend event time, displayed to seconds in the viewer's timezone. Never substitutes the current time. */
export function formatResultTimestamp(value: string, timeZone?: string) {
  const source = value.trim()
  if (!source) return ''
  // Legacy values have no timezone: preserve their wall-clock meaning instead of inventing an offset.
  const legacy = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(source)
  if (legacy) return legacy[2] ? `${legacy[1]} ${legacy[2]}:${legacy[3] ?? '00'}` : legacy[1]
  // PowerShell's round-trip format may contain seven fraction digits; JS guarantees millisecond precision.
  const normalized = source.replace(/\.(\d+)(?=Z|[+-]\d{2}:\d{2}$)/, (_, fraction: string) => `.${fraction.slice(0, 3).padEnd(3, '0')}`)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) return '—'
  const instant = new Date(normalized)
  if (!Number.isFinite(instant.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...(timeZone ? { timeZone } : {}), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (key: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === key)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

const targetStatusLabels = { met: '已达标', missed: '未达标', 'at-risk': '有风险' } as const
const sectionStatusLabels = { done: '已完成', active: '进行中', pending: '待开始' } as const
const taskStatusLabels = { todo: '待开始', doing: '进行中', blocked: '受阻', done: '已完成' } as const
const versionStatusLabels = { draft: '草稿', released: '已发布', 'rolled-back': '已回滚' } as const
const environmentStatusLabels = { running: '运行中', pending: '待发布', stopped: '已停止', failed: '需关注' } as const
const riskLevelLabels = { high: '高', medium: '中', low: '低' } as const
const riskStatusLabels = { open: '待处理', mitigating: '处理中', closed: '已关闭' } as const

/** True when the result carries 任务详情工作台 data instead of only the compact result page. */
export function resultHasWorkspace(result: OfficeResult | undefined): result is OfficeResult {
  if (!result) return false
  return Boolean(result.sections.length || result.tasks.length || result.versions.length || result.risks.length)
}

/** Display string for the optional team header field, e.g. 前端组（3人）. */
export function resultTeamLabel(result: OfficeResult) {
  if (!result.team) return ''
  return result.teamSize === undefined ? result.team : `${result.team}（${result.teamSize}人）`
}

export function resultHasContent(result: OfficeResult | undefined): boolean {
  if (!result) return false
  return Boolean(result.title.trim() || result.summary.trim() || result.verdict.trim()
    || result.metrics.length || result.artifacts.length || result.checks.length || result.decisions.length
    || result.sections.length || result.tasks.length || result.versions.length || result.risks.length
    || result.next.length || result.note.trim())
}

export function resultFileBase(result: OfficeResult) {
  const base = `${result.title || '成果'}`.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return base || 'result'
}

function resolvedKind(metric: ResultMetric): ResolvedKind {
  if (metric.kind !== 'auto') return metric.kind
  return metric.previous ? 'comparison' : 'value'
}

function metricValue(metric: ResultMetric) {
  if (!metric.unit) return metric.value
  return `${metric.value}${metric.unit === '%' ? '' : ' '}${metric.unit}`
}

function metricLine(metric: ResultMetric) {
  const kind = resolvedKind(metric)
  if (kind === 'comparison') return `${metric.label}：${metric.previous ? `${metric.previous} → ` : ''}${metricValue(metric)}${metric.change ? `（${metric.change}）` : ''}`
  if (kind === 'target') return `${metric.label}：${metricValue(metric)}${metric.target ? ` / 目标 ${metric.target}` : ''}${metric.targetStatus ? `（${targetStatusLabels[metric.targetStatus]}${metric.progress !== undefined ? `，${Math.round(metric.progress)}%` : ''}）` : ''}`
  if (kind === 'status' || kind === 'text') return `${metric.label}：${metric.value}`
  return `${metric.label}：${metricValue(metric)}${metric.change ? `（${metric.change}）` : ''}`
}

/** Markdown lines for one primitive block of a composed section. */
function blockLines(block: ResultBlock): string[] {
  switch (block.type) {
    case 'heading': return [`#### ${block.text}`, '']
    case 'text': return [block.text, '']
    case 'keyValue': return block.items.map(item => `- ${item.label}：${item.value}`)
    case 'stats': return block.items.map(item => `- ${item.label}：${item.value}${item.unit ? ` ${item.unit}` : ''}`)
    case 'table': {
      const header = `| ${block.columns.map(column => column.label).join(' | ')} |`
      const divider = `| ${block.columns.map(() => '---').join(' | ')} |`
      return [header, divider, ...block.rows.map(row => `| ${block.columns.map(column => row[column.key] || '—').join(' | ')} |`)]
    }
    case 'list':
      return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item.text}${item.status === 'passed' ? '（已通过）' : item.status === 'failed' ? '（未通过）' : item.status === 'pending' ? '（待处理）' : ''}`)
    case 'progress': return [`- ${block.label}：${Math.round(block.value)}%`]
    case 'chart': return [`- ${block.label || '图表'}（${block.chart}）：${block.series.map(item => `${item.label} ${item.value}${block.unit}`).join('、')}`]
    case 'image': return [`- 图片：${block.caption || block.alt || block.url || '待补充'}`]
    case 'diagram': return ['```mermaid', ...block.source.split('\n'), '```', ...(block.caption ? [`*${block.caption}*`] : [])]
    case 'callout': return [`> ${block.title ? `**${block.title}** · ` : ''}${block.text}`]
    case 'divider': return ['---']
  }
}

/** Markdown lines for one semantic section of the 交付成果 workspace. */
function sectionLines(section: ResultSection): string[] {
  const lines: string[] = [`### ${section.title}`, '']
  switch (section.kind) {
    case 'gallery':
      for (const item of section.items) lines.push(`- **${item.title}**${item.meta ? `（${item.meta}）` : ''} · ${sectionStatusLabels[item.status]}`)
      break
    case 'documents':
      for (const item of section.items) lines.push(`- **${item.title}**${item.version ? ` ${item.version}` : ''}${item.at ? ` · ${item.at}` : ''} · ${sectionStatusLabels[item.status]}`)
      break
    case 'tests':
      for (const metric of section.metrics) lines.push(`- ${metric.label}：${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`)
      if (section.progress !== undefined) lines.push(`- ${section.progressLabel}：${Math.round(section.progress)}%`)
      for (const check of section.checks) lines.push(`- [${check.status === 'passed' ? 'x' : ' '}] ${check.label}${check.status === 'failed' ? '（未通过）' : check.status === 'pending' ? '（待补充）' : ''}`)
      break
    case 'api':
      lines.push('| 接口地址 | 方法 | 状态 | 更新时间 |', '| --- | --- | --- | --- |')
      for (const row of section.rows) lines.push(`| ${row.endpoint} | ${row.method} | ${sectionStatusLabels[row.status]} | ${row.at || '—'} |`)
      break
    case 'environments':
      for (const item of section.items) lines.push(`- ${item.name}：${environmentStatusLabels[item.status]}${item.version ? ` · ${item.version}` : ''}${item.at ? ` · ${item.at}` : ''}`)
      break
    case 'files':
      for (const item of section.items) lines.push(`- **${item.name}**${item.size ? ` · ${item.size}` : ''}`)
      break
    case 'changes': {
      const statusLabels = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名' } as const
      const added = section.files.reduce((sum, file) => sum + file.added, 0)
      const deleted = section.files.reduce((sum, file) => sum + file.deleted, 0)
      lines.push(`共 ${section.files.length} 个文件 · +${added} / -${deleted}`, '')
      lines.push('| 状态 | 文件 | 新增 | 删除 |', '| --- | --- | --- | --- |')
      for (const file of section.files) {
        const path = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path
        const counts = file.binary ? ['二进制', '—'] : file.oversized ? ['过大', '—'] : [`+${file.added}`, `-${file.deleted}`]
        lines.push(`| ${statusLabels[file.status]} | ${path} | ${counts[0]} | ${counts[1]} |`)
      }
      for (const file of section.files) {
        if (file.binary || !file.diff) continue
        const longestFence = Math.max(2, ...(file.diff.match(/`+/g) ?? []).map(run => run.length))
        const fence = '`'.repeat(longestFence + 1)
        lines.push('', `### ${file.path}`, '')
        if (file.diffTruncated) lines.push('> 以下为部分差异，行数统计为整个文件的变更。', '')
        lines.push(`${fence}diff`, file.diff.trimEnd(), fence, '')
      }
      break
    }
    case 'custom':
      for (const block of section.blocks) lines.push(...blockLines(block))
      break
  }
  lines.push('')
  return lines
}

/** A compact read-aloud summary for the copy button. */
export function resultSummaryText(result: OfficeResult) {
  const lines = [result.title, result.summary, result.verdict].filter(Boolean)
  const meta = [result.owner && `负责人：${result.owner}`, resultTeamLabel(result) && `团队：${resultTeamLabel(result)}`, result.updatedAt && `更新时间：${result.updatedAt}`].filter(Boolean)
  if (meta.length) lines.push('', meta.join(' · '))
  if (result.metrics.length) lines.push('', ...result.metrics.map(metricLine))
  if (result.next.length) lines.push('', '下一步：', ...result.next.map((item, index) => `${index + 1}. ${item}`))
  return `${lines.join('\n').trim()}\n`
}

/** A portable Markdown report for download. */
export function resultReport(source: OfficeResult) {
  const result: OfficeResult = { ...source, checks: resultChecks(source), sections: source.sections.map(section =>
    section.kind === 'tests' ? { ...section, checks: resultChecks({ ...source, checks: section.checks }) } : section) }
  const lines: string[] = [`# ${result.title || '成果'}`, '']
  if (result.status) {
    const meta = [resultStatusLabels[result.status], result.owner, resultTeamLabel(result) && `团队：${resultTeamLabel(result)}`, result.updatedAt].filter(Boolean)
    lines.push(`> ${meta.join(' · ')}${result.producedAt && result.producedAt !== result.updatedAt ? ` · 产出 ${result.producedAt}` : ''}`, '')
  }
  if (result.summary) lines.push(result.summary, '')
  if (result.verdict) lines.push(result.verdict, '')
  if (result.metrics.length) {
    lines.push(`## ${result.metricsTitle || '关键指标'}`, '')
    if (result.metricsCaption) lines.push(`*${result.metricsCaption}*`, '')
    if (result.metrics.every(metric => resolvedKind(metric) === 'comparison')) {
      lines.push('| 指标 | 首轮 | 当前 | 变化 |', '| --- | ---: | ---: | ---: |')
      for (const metric of result.metrics) lines.push(`| ${metric.label} | ${metric.previous || '—'} | ${metricValue(metric)} | ${metric.change || '—'} |`)
    } else {
      for (const metric of result.metrics) lines.push(`- ${metricLine(metric)}`)
    }
    lines.push('')
  }
  if (result.artifacts.length) {
    lines.push('## 交付物', '')
    for (const artifact of result.artifacts) {
      lines.push(`- **${artifact.title}**${artifact.description ? `：${artifact.description}` : ''}${artifact.url ? `（${artifact.url}）` : ''}`)
      if (artifact.versionId) lines.push(`  - 版本：${artifact.version || artifact.versionId}（${artifact.versionId}）${artifact.runId ? ` · 来源交付：${artifact.runId}` : ''}`)
      if (artifact.content) lines.push('', '  ```', ...artifact.content.split('\n').map(line => `  ${line}`), '  ```', '')
    }
    lines.push('')
  }
  if (result.sections.length) {
    lines.push('## 交付成果', '')
    for (const section of result.sections) lines.push(...sectionLines(section))
  }
  if (result.checks.length) {
    lines.push('## 验收', '')
    for (const check of result.checks) lines.push(`- [${check.status === 'passed' ? 'x' : ' '}] ${check.label}${check.status === 'failed' ? '（未通过）' : check.status === 'pending' ? '（待补充）' : ''}`)
    lines.push('')
  }
  if (result.decisions.length) {
    lines.push('## 过程决策', '')
    for (const decision of result.decisions) lines.push(`- ${decision.question} → **${decision.choice}**${decision.at ? `（${decision.at}）` : ''}`)
    lines.push('')
  }
  if (result.tasks.length) {
    lines.push('## 任务明细', '')
    for (const task of result.tasks) lines.push(`- [${task.status === 'done' ? 'x' : ' '}] ${task.title}${task.owner ? ` · ${task.owner}` : ''}${task.status !== 'done' ? ` · ${taskStatusLabels[task.status]}` : ''}${task.progress !== undefined ? `（${Math.round(task.progress)}%）` : ''}${task.note ? ` — ${task.note}` : ''}`)
    lines.push('')
  }
  if (result.versions.length) {
    lines.push('## 版本记录', '')
    for (const version of result.versions) lines.push(`- **${version.version}** ${version.note}${version.author ? ` · ${version.author}` : ''}${version.at ? ` · ${version.at}` : ''}（${versionStatusLabels[version.status]}）`)
    lines.push('')
  }
  if (result.risks.length) {
    lines.push('## 风险与备注', '')
    for (const risk of result.risks) lines.push(`- [${riskLevelLabels[risk.level]}] ${risk.title} · ${riskStatusLabels[risk.status]}${risk.owner ? ` · ${risk.owner}` : ''}${risk.note ? ` — ${risk.note}` : ''}`)
    lines.push('')
  }
  if (result.next.length) {
    lines.push('## 下一步', '')
    result.next.forEach((item, index) => lines.push(`${index + 1}. ${item}`))
    lines.push('')
  }
  if (result.note) lines.push('---', '', result.note)
  return `${lines.join('\n').trim()}\n`
}
