import { useId, type CSSProperties } from 'react'
import { ArtifactBar3D } from '@/components/ArtifactBar3D'
import { ARTIFACT_CHART_COLORS, type ArtifactChartSpec } from '@/components/artifactChartSpec'

function numberLabel(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, notation: Math.abs(value) >= 10000 ? 'compact' : 'standard' }).format(value)
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return ''
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index]
    const controlX = (previous.x + point.x) / 2
    return `${path} C ${controlX} ${previous.y}, ${controlX} ${point.y}, ${point.x} ${point.y}`
  }, `M ${points[0].x} ${points[0].y}`)
}

function polarPoint(centerX: number, centerY: number, radius: number, angle: number) {
  return { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }
}

function radialChart(spec: ArtifactChartSpec) {
  const width = 920
  const height = 520
  const centerX = 330
  const centerY = 260
  const radius = 182
  const unit = spec.unit || ''

  if (spec.type === 'pie' || spec.type === 'donut') {
    const data = spec.series[0].data.map((value) => Math.max(0, value))
    const total = data.reduce((sum, value) => sum + value, 0) || 1
    let cursor = -Math.PI / 2
    return <div className="artifact-chart-stage artifact-chart-radial-stage">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <g className="artifact-chart-pie">
          {data.map((value, index) => {
            const angle = value / total * Math.PI * 2
            const end = cursor + angle
            const startPoint = polarPoint(centerX, centerY, radius, cursor)
            const endPoint = polarPoint(centerX, centerY, radius, end)
            const largeArc = angle > Math.PI ? 1 : 0
            const path = `M ${centerX} ${centerY} L ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y} Z`
            cursor = end
            return <path key={spec.categories[index]} d={path} fill={ARTIFACT_CHART_COLORS[index % ARTIFACT_CHART_COLORS.length]} style={{ '--delay': `${index * 90}ms` } as CSSProperties}>
              <title>{spec.categories[index]}：{numberLabel(value)}{unit}</title>
            </path>
          })}
          {spec.type === 'donut' ? <circle cx={centerX} cy={centerY} r={radius * .52} fill="#fff" /> : null}
          {spec.type === 'donut' ? <g className="artifact-chart-donut-total"><text x={centerX} y={centerY - 8} textAnchor="middle">合计</text><text className="value" x={centerX} y={centerY + 30} textAnchor="middle">{numberLabel(total)}{unit}</text></g> : null}
        </g>
        <g className="artifact-chart-radial-legend">
          {spec.categories.map((category, index) => <g key={category} transform={`translate(600 ${105 + index * 44})`}>
            <rect width="13" height="13" rx="3" fill={ARTIFACT_CHART_COLORS[index % ARTIFACT_CHART_COLORS.length]} />
            <text x="24" y="11">{category}</text>
            <text className="value" x="250" y="11" textAnchor="end">{numberLabel(data[index])}{unit}</text>
          </g>)}
        </g>
      </svg>
    </div>
  }

  const values = spec.series.flatMap((series) => series.data)
  const maxValue = Math.max(...values, 1)
  const axes = spec.categories.map((category, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / spec.categories.length
    return { category, angle, point: polarPoint(centerX, centerY, radius, angle) }
  })
  return <div className="artifact-chart-stage artifact-chart-radial-stage">
    <svg viewBox={`0 0 ${width} ${height}`} role="img">
      <g className="artifact-chart-radar-grid">
        {[.25, .5, .75, 1].map((scale) => <polygon key={scale} points={axes.map(({ angle }) => { const point = polarPoint(centerX, centerY, radius * scale, angle); return `${point.x},${point.y}` }).join(' ')} />)}
        {axes.map(({ category, point }) => <g key={category}><line x1={centerX} y1={centerY} x2={point.x} y2={point.y} /><text x={point.x} y={point.y + (point.y < centerY ? -10 : 20)} textAnchor={Math.abs(point.x - centerX) < 10 ? 'middle' : point.x < centerX ? 'end' : 'start'}>{category}</text></g>)}
      </g>
      {spec.series.map((series, seriesIndex) => {
        const points = axes.map(({ angle }, index) => polarPoint(centerX, centerY, radius * Math.max(0, series.data[index]) / maxValue, angle))
        return <g className="artifact-chart-radar-series" key={series.name} style={{ '--chart-color': series.color || ARTIFACT_CHART_COLORS[seriesIndex], '--delay': `${seriesIndex * 140}ms` } as CSSProperties}>
          <polygon points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
          {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="5"><title>{series.name} · {spec.categories[index]}：{numberLabel(series.data[index])}{unit}</title></circle>)}
        </g>
      })}
      <g className="artifact-chart-radial-legend artifact-chart-radar-legend">
        {spec.series.map((series, index) => <g key={series.name} transform={`translate(660 ${150 + index * 48})`}><rect width="13" height="13" rx="3" fill={series.color || ARTIFACT_CHART_COLORS[index]} /><text x="24" y="11">{series.name}</text></g>)}
      </g>
    </svg>
  </div>
}

/** 使用 SVG 渲染带入场动画的柱状、折线和面积图，不执行产物中的脚本。 */
export function ArtifactChart({ spec }: { spec: ArtifactChartSpec }) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  if (spec.type === 'bar3d') return <section className="artifact-chart artifact-chart-is-3d" aria-label={`${spec.title}，三维柱状图`}>
    <header className="artifact-chart-heading">
      <div><span>IMMERSIVE DATA</span><h3>{spec.title}</h3>{spec.subtitle ? <p>{spec.subtitle}</p> : null}</div>
      <div className="artifact-chart-metrics">{spec.series.map((item, index) => <div key={item.name} style={{ '--chart-color': item.color || ARTIFACT_CHART_COLORS[index] } as CSSProperties}>
        <i /><span>{item.name}</span><strong>{numberLabel(item.data.at(-1) ?? 0)}{spec.unit || ''}</strong>
      </div>)}</div>
    </header>
    <ArtifactBar3D spec={spec} />
  </section>
  if (spec.type === 'pie' || spec.type === 'donut' || spec.type === 'radar') return <section className="artifact-chart" aria-label={`${spec.title}，${spec.type === 'pie' ? '饼图' : spec.type === 'donut' ? '环形图' : '雷达图'}`}>
    <header className="artifact-chart-heading">
      <div><span>DATA VISUAL</span><h3>{spec.title}</h3>{spec.subtitle ? <p>{spec.subtitle}</p> : null}</div>
      <div className="artifact-chart-metrics">{spec.series.map((item, index) => <div key={item.name} style={{ '--chart-color': item.color || ARTIFACT_CHART_COLORS[index] } as CSSProperties}>
        <i /><span>{item.name}</span><strong>{numberLabel(item.data.reduce((sum, value) => sum + value, 0))}{spec.unit || ''}</strong>
      </div>)}</div>
    </header>
    {radialChart(spec)}
  </section>
  const width = 960
  const height = 500
  const left = 78
  const right = 34
  const top = 36
  const bottom = 76
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const values = spec.series.flatMap((item) => item.data)
  const dataMin = Math.min(...values)
  const dataMax = Math.max(...values)
  const span = dataMax - dataMin || Math.max(Math.abs(dataMax), 1)
  const min = spec.type === 'bar' ? (dataMin < 0 ? dataMin - span * .08 : 0) : dataMin - span * .18
  const max = dataMax + span * (spec.type === 'bar' ? .12 : .18)
  const y = (value: number) => top + (max - value) / (max - min) * plotHeight
  const baselineY = y(spec.type === 'bar' ? 0 : min)
  const categoryStep = plotWidth / spec.categories.length
  const x = (index: number) => left + categoryStep * (index + .5)
  const ticks = Array.from({ length: 6 }, (_, index) => min + (max - min) * index / 5).reverse()
  const unit = spec.unit || ''

  return <section className="artifact-chart" aria-label={`${spec.title}，${spec.type === 'bar' ? '柱状图' : spec.type === 'line' ? '折线图' : '面积图'}`}>
    <header className="artifact-chart-heading">
      <div><span>DATA VISUAL</span><h3>{spec.title}</h3>{spec.subtitle ? <p>{spec.subtitle}</p> : null}</div>
      <div className="artifact-chart-metrics">{spec.series.map((item, index) => <div key={item.name} style={{ '--chart-color': item.color || ARTIFACT_CHART_COLORS[index] } as CSSProperties}>
        <i /><span>{item.name}</span><strong>{numberLabel(item.data.at(-1) ?? 0)}{unit}</strong>
      </div>)}</div>
    </header>
    <div className="artifact-chart-stage">
      <svg viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>{spec.series.map((item, index) => <linearGradient key={item.name} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={item.color} stopOpacity=".42" />
          <stop offset="100%" stopColor={item.color} stopOpacity=".02" />
        </linearGradient>)}</defs>
        {ticks.map((tick) => <g className="artifact-chart-grid" key={tick}>
          <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
          <text x={left - 14} y={y(tick) + 5} textAnchor="end">{numberLabel(tick)}{unit}</text>
        </g>)}
        <line className="artifact-chart-axis" x1={left} x2={width - right} y1={baselineY} y2={baselineY} />
        {spec.categories.map((category, index) => <text className="artifact-chart-category" key={`${category}-${index}`} x={x(index)} y={height - 36} textAnchor="middle">{category.length > 10 ? `${category.slice(0, 9)}…` : category}</text>)}
        {spec.type === 'bar' ? spec.series.flatMap((item, seriesIndex) => {
          const groupWidth = categoryStep * .7
          const barWidth = Math.max(5, Math.min(42, groupWidth / spec.series.length - 4))
          return item.data.map((value, categoryIndex) => {
            const valueY = y(value)
            const barY = Math.min(valueY, baselineY)
            const barHeight = Math.max(2, Math.abs(baselineY - valueY))
            const barX = x(categoryIndex) - groupWidth / 2 + seriesIndex * (groupWidth / spec.series.length) + (groupWidth / spec.series.length - barWidth) / 2
            return <g className="artifact-chart-bar" key={`${item.name}-${categoryIndex}`} style={{ '--bar-origin': `${baselineY}px`, '--delay': `${categoryIndex * 45 + seriesIndex * 70}ms` } as CSSProperties}>
              <rect x={barX} y={barY} width={barWidth} height={barHeight} rx="7" fill={item.color}><title>{item.name} · {spec.categories[categoryIndex]}：{numberLabel(value)}{unit}</title></rect>
            </g>
          })
        }) : spec.series.map((item, seriesIndex) => {
          const points = item.data.map((value, index) => ({ x: x(index), y: y(value), value }))
          const path = smoothPath(points)
          return <g className="artifact-chart-line" key={item.name} style={{ '--delay': `${seriesIndex * 160}ms` } as CSSProperties}>
            {spec.type === 'area' ? <path className="artifact-chart-area" d={`${path} L ${points.at(-1)?.x} ${baselineY} L ${points[0].x} ${baselineY} Z`} fill={`url(#${gradientId}-${seriesIndex})`} /> : null}
            <path className="artifact-chart-stroke" d={path} stroke={item.color} pathLength="1" />
            {points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="6" fill="#fff" stroke={item.color} strokeWidth="4">
              <title>{item.name} · {spec.categories[index]}：{numberLabel(point.value)}{unit}</title>
            </circle>)}
          </g>
        })}
      </svg>
    </div>
  </section>
}
