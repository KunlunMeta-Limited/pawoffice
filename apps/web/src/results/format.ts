import type { OfficeResult } from '@pawoffice/protocol/office-ui'

type ResultMetric = OfficeResult['metrics'][number]
type ResolvedKind = 'comparison' | 'value' | 'status' | 'target' | 'text'

export const resultStatusLabels: Record<OfficeResult['status'], string> = {
  verified: '已验证', ready: '已交付', draft: '草稿', rejected: '未通过',
}

const targetStatusLabels = { met: '已达标', missed: '未达标', 'at-risk': '有风险' } as const

export function resultHasContent(result: OfficeResult | undefined): result is OfficeResult {
  if (!result) return false
  return Boolean(result.title.trim() || result.summary.trim() || result.verdict.trim()
    || result.metrics.length || result.artifacts.length || result.checks.length || result.decisions.length)
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

/** A compact read-aloud summary for the copy button. */
export function resultSummaryText(result: OfficeResult) {
  const lines = [result.title, result.summary, result.verdict].filter(Boolean)
  if (result.metrics.length) lines.push('', ...result.metrics.map(metricLine))
  if (result.next.length) lines.push('', '下一步：', ...result.next.map((item, index) => `${index + 1}. ${item}`))
  return `${lines.join('\n').trim()}\n`
}

/** A portable Markdown report for download. */
export function resultReport(result: OfficeResult) {
  const lines: string[] = [`# ${result.title || '成果'}`, '']
  if (result.status) lines.push(`> ${resultStatusLabels[result.status]}${result.owner ? ` · ${result.owner}` : ''}${result.producedAt ? ` · ${result.producedAt}` : ''}`, '')
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
      if (artifact.content) lines.push('', '  ```', ...artifact.content.split('\n').map(line => `  ${line}`), '  ```', '')
    }
    lines.push('')
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
  if (result.next.length) {
    lines.push('## 下一步', '')
    result.next.forEach((item, index) => lines.push(`${index + 1}. ${item}`))
    lines.push('')
  }
  if (result.note) lines.push('---', '', result.note)
  return `${lines.join('\n').trim()}\n`
}
