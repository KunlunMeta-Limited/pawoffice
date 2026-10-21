export type ArtifactChartSpec = {
  type: 'bar' | 'bar3d' | 'line' | 'area' | 'pie' | 'donut' | 'radar'
  title: string
  subtitle?: string
  unit?: string
  categories: string[]
  series: Array<{ name: string; data: number[]; color?: string }>
}

export const ARTIFACT_CHART_COLORS = ['#ef6a58', '#2f9c95', '#4f76a6', '#d6a83c', '#7f72b2', '#dd7f45']

/** 解析 AI Office 通用图表产物；无效或过大的数据保持普通 JSON 预览。 */
export function parseArtifactChart(source: string): ArtifactChartSpec | null {
  let value: unknown
  try { value = JSON.parse(source) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const type = record.type === 'line'
    || record.type === 'area'
    || record.type === 'bar'
    || record.type === 'bar3d'
    || record.type === 'pie'
    || record.type === 'donut'
    || record.type === 'radar'
    ? record.type
    : null
  const rawCategories = Array.isArray(record.categories) ? record.categories : Array.isArray(record.labels) ? record.labels : null
  if (!type || typeof record.title !== 'string' || !rawCategories || !Array.isArray(record.series)) return null
  const categories = rawCategories.map(String).slice(0, 24)
  if (categories.length < 2) return null
  const series = record.series.slice(0, 6).flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const candidate = item as Record<string, unknown>
    if (typeof candidate.name !== 'string' || !Array.isArray(candidate.data)) return []
    const data = candidate.data.slice(0, categories.length).map(Number)
    if (data.length !== categories.length || data.some((entry) => !Number.isFinite(entry))) return []
    return [{
      name: candidate.name,
      data,
      ...(typeof candidate.color === 'string' && /^#[0-9a-f]{6}$/i.test(candidate.color) ? { color: candidate.color } : { color: ARTIFACT_CHART_COLORS[index] }),
    }]
  })
  if (!series.length) return null
  return {
    type,
    title: record.title.trim().slice(0, 120) || '数据图表',
    ...(typeof record.subtitle === 'string' && record.subtitle.trim() ? { subtitle: record.subtitle.trim().slice(0, 240) } : {}),
    ...(typeof record.unit === 'string' && record.unit.trim() ? { unit: record.unit.trim().slice(0, 20) } : {}),
    categories,
    series,
  }
}
