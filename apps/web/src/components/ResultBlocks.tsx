import type { ReactElement, ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle, CheckCircle2, CircleDashed, CircleX, Image as ImageIcon, Info, UserRound,
} from 'lucide-react'
import type {
  ResultBlock, ResultBlockKind, ResultSectionLayout, ResultTableColumn,
} from '@pawoffice/protocol/office-ui'
import { MermaidDiagram } from './MermaidDiagram.tsx'
import { resultCodePre } from './resultMarkdownCode.tsx'
import './ResultBlocks.css'

/** One member of the block discriminator union; renderers stay narrow instead of re-parsing. */
type BlockOf<K extends ResultBlockKind> = Extract<ResultBlock, { type: K }>

/** Status cell vocabulary — the reader owns the Chinese labels, the backend only sends the code. */
const statusLabels = {
  done: '已完成', active: '进行中', pending: '待开始', passed: '已通过', failed: '未通过',
  running: '运行中', blocked: '受阻', open: '待处理', closed: '已关闭', mitigating: '处理中',
  stopped: '已停止', todo: '待开始', doing: '进行中', released: '已发布', draft: '草稿',
  // 风险等级复用同一列格式：high 红 / medium 琥珀 / low 灰。
  high: '高', medium: '中', low: '低',
} as const
type KnownStatus = keyof typeof statusLabels

const statusTones: Record<KnownStatus, 'positive' | 'active' | 'pending' | 'warning' | 'danger'> = {
  done: 'positive', passed: 'positive', released: 'positive', closed: 'positive',
  active: 'active', running: 'active', doing: 'active', mitigating: 'active',
  pending: 'pending', todo: 'pending', open: 'pending', draft: 'pending',
  low: 'pending', high: 'danger', medium: 'warning',
  failed: 'danger', blocked: 'danger', stopped: 'danger',
}

const listStatusIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const
const listStatusLabels = { passed: '已通过', pending: '待补充', failed: '未通过' } as const
const calloutIcons = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: CircleX } as const

/** Raw HTML is ignored; links open in a new tab and GFM tables scroll inside their own box. */
const markdownComponents: Components = {
  a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
  table: ({ children }) => <div className="result-block-md-table" role="region" aria-label="表格" tabIndex={0}>
    <table>{children}</table>
  </div>,
  img: ({ src, alt, title }) => typeof src === 'string' && src
    ? <img src={src} alt={alt ?? ''} title={title} loading="lazy" />
    : <span>{alt}</span>,
  pre: resultCodePre,
}

function shorten(text: string, max: number): string {
  const value = text.trim()
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

/** Inline label above a primitive's body; ommitted for empty canonical labels. */
function BlockLabel({ text }: { text: string }) {
  return text ? <p className="result-block-label">{text}</p> : null
}

/* ---------- heading ---------- */

function HeadingBlock({ block }: { block: BlockOf<'heading'> }) {
  const Tag = block.level
  return <Tag className="result-block-heading" data-level={block.level}>{block.text}</Tag>
}

/* ---------- text (Markdown) ---------- */

function TextBlock({ block }: { block: BlockOf<'text'> }) {
  return <div className="result-block-text">
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} skipHtml>{block.text}</Markdown>
  </div>
}

/* ---------- keyValue ---------- */

function KeyValueBlock({ block }: { block: BlockOf<'keyValue'> }) {
  return <div className="result-block-keyvalue">
    <BlockLabel text={block.label} />
    <dl className="result-block-kv-list">
      {block.items.map((item, index) => <div className="result-block-kv-row" key={`${index}-${item.label}`}>
        <dt>{item.label}</dt>
        <dd data-tone={item.tone}>{item.value}</dd>
      </div>)}
    </dl>
  </div>
}

/* ---------- stats ---------- */

function StatsBlock({ block }: { block: BlockOf<'stats'> }) {
  return <div className="result-block-stats">
    <BlockLabel text={block.label} />
    <div className="result-block-stat-grid" data-count={block.items.length}>
      {block.items.map((item, index) => <div className="result-block-stat" data-tone={item.tone} key={`${index}-${item.label}`}>
        <span className="result-block-stat-label">{item.label}</span>
        <span className="result-block-stat-value">
          {item.value}{item.unit && <em>{item.unit}</em>}
        </span>
      </div>)}
    </div>
  </div>
}

/* ---------- table ---------- */

function columnAlign(column: ResultTableColumn): 'left' | 'right' {
  // Numbers read as a column no matter what the backend hint says.
  return column.format === 'number' || column.format === 'percent' ? 'right' : column.align
}

function TableCell({ column, raw }: { column: ResultTableColumn; raw: string | undefined }) {
  const value = (raw ?? '').trim()
  if (!value) return <span className="result-block-cell-empty">—</span>
  switch (column.format) {
    case 'number':
    case 'percent':
      return <span className="result-block-cell-number">{value}</span>
    case 'date':
      return <span className="result-block-cell-date">{value}</span>
    case 'code':
      return <code className="result-block-cell-code">{value}</code>
    case 'status': {
      const code = value.toLowerCase()
      if (!(code in statusLabels)) return <span className="result-block-status-chip" data-tone="unknown">{value}</span>
      const known = code as KnownStatus
      return <span className="result-block-status-chip" data-tone={statusTones[known]}>{statusLabels[known]}</span>
    }
    case 'method': {
      const method = value.toUpperCase()
      return <span className="result-block-method" data-method={method}>{method}</span>
    }
    case 'owner':
      return <span className="result-block-cell-owner">
        <UserRound size={12} strokeWidth={2} aria-hidden="true" />{value}
      </span>
    case 'link':
      return isHttpUrl(value)
        ? <a className="result-block-cell-link" href={value} target="_blank" rel="noopener noreferrer">{value}</a>
        : <span className="result-block-cell-link is-plain">{value}</span>
    default:
      return <span>{value}</span>
  }
}

function TableBlock({ block }: { block: BlockOf<'table'> }) {
  return <div className="result-block-table">
    <BlockLabel text={block.label} />
    <div className="result-block-table-wrap">
      <table className="result-block-table-el">
        <caption className="result-block-sr-only">{block.label || '数据表格'}</caption>
        <thead>
          <tr>{block.columns.map(column => <th key={column.key} scope="col" data-align={columnAlign(column)}>
            {column.label}
          </th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => <tr key={rowIndex}>
            {block.columns.map(column => <td key={column.key} data-align={columnAlign(column)}>
              <TableCell column={column} raw={row[column.key]} />
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>
}

/* ---------- list ---------- */

function ListBlock({ block }: { block: BlockOf<'list'> }) {
  const Tag = block.ordered ? 'ol' : 'ul'
  return <div className="result-block-list">
    <BlockLabel text={block.label} />
    <Tag className="result-block-list-items" data-ordered={block.ordered}>
      {block.items.map((item, index) => {
        const status = item.status
        const Icon = status ? listStatusIcons[status] : null
        return <li key={`${index}-${item.text}`} data-status={status || undefined}>
          {Icon && <Icon size={14} strokeWidth={2} aria-hidden="true" />}
          <span>{item.text}</span>
          {status && <span className="result-block-sr-only">{listStatusLabels[status]}</span>}
        </li>
      })}
    </Tag>
  </div>
}

/* ---------- progress ---------- */

function ProgressBlock({ block }: { block: BlockOf<'progress'> }) {
  const value = Math.max(0, Math.min(100, Math.round(block.value)))
  const label = block.label || '进度'
  return <div className="result-block-progress" data-tone={block.tone}>
    <div className="result-block-progress-head">
      <span>{label}</span>
      <strong>{value}%</strong>
    </div>
    <div className="result-block-progress-track" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={`${value}%`}>
      <i style={{ width: `${value}%` }} />
    </div>
  </div>
}

/* ---------- chart (hand-drawn SVG, no chart dependency) ---------- */

function chartAriaLabel(block: BlockOf<'chart'>): string {
  const kind = block.chart === 'bar' ? '柱状图' : block.chart === 'line' ? '折线图' : '饼图'
  const summary = block.series.map(item => `${item.label} ${formatNumber(item.value)}${block.unit}`).join('，')
  return `${block.label || '图表'}（${kind}）：${summary}`
}

function tickLabel(label: string, count: number): string {
  return shorten(label, count > 5 ? 4 : 6)
}

function BarChart({ block }: { block: BlockOf<'chart'> }) {
  const width = 320, height = 138, padX = 8, padTop = 20, padBottom = 24
  const plotHeight = height - padTop - padBottom
  const series = block.series
  const allZero = series.every(item => item.value <= 0)
  const max = Math.max(...series.map(item => item.value), 1)
  const step = (width - padX * 2) / series.length
  const barWidth = Math.min(30, step * 0.46)
  const baseline = padTop + plotHeight
  return <svg className="result-block-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img"
    aria-label={chartAriaLabel(block)} preserveAspectRatio="xMidYMid meet">
    <line className="result-block-chart-axis" x1={padX} y1={baseline} x2={width - padX} y2={baseline} />
    {series.map((item, index) => {
      const center = padX + step * index + step / 2
      const barHeight = allZero ? 0 : (item.value / max) * plotHeight
      const y = baseline - barHeight
      return <g key={`${index}-${item.label}`}>
        <rect className="result-block-chart-bar" data-tone={item.tone} x={center - barWidth / 2}
          y={Math.min(y, baseline - 1)} width={barWidth} height={Math.max(barHeight, 1)} rx={3} />
        <text className="result-block-chart-value" x={center} y={y - 5} textAnchor="middle">{formatNumber(item.value)}</text>
        <text className="result-block-chart-tick" x={center} y={height - 8} textAnchor="middle">{tickLabel(item.label, series.length)}</text>
      </g>
    })}
    {allZero && <text className="result-block-chart-empty" x={width / 2} y={padTop + plotHeight / 2} textAnchor="middle">暂无数据</text>}
  </svg>
}

function LineChart({ block }: { block: BlockOf<'chart'> }) {
  const width = 320, height = 138, padX = 14, padTop = 22, padBottom = 24
  const plotWidth = width - padX * 2
  const plotHeight = height - padTop - padBottom
  const series = block.series
  const allZero = series.every(item => item.value <= 0)
  const max = Math.max(...series.map(item => item.value), 1)
  const baseline = padTop + plotHeight
  const points = series.map((item, index) => ({
    item,
    x: series.length === 1 ? width / 2 : padX + (plotWidth * index) / (series.length - 1),
    y: baseline - (allZero ? 0 : (item.value / max) * plotHeight),
  }))
  return <svg className="result-block-chart-svg" viewBox={`0 0 ${width} ${height}`} role="img"
    aria-label={chartAriaLabel(block)} preserveAspectRatio="xMidYMid meet">
    <line className="result-block-chart-axis" x1={padX} y1={baseline} x2={width - padX} y2={baseline} />
    {!allZero && <polyline className="result-block-chart-line"
      points={points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" />}
    {points.map((point, index) => <g key={`${index}-${point.item.label}`}>
      <circle className="result-block-chart-point" data-tone={point.item.tone} cx={point.x} cy={point.y} r={3.4} />
      <text className="result-block-chart-value" x={point.x} y={point.y - 9} textAnchor="middle">
        {formatNumber(point.item.value)}
      </text>
      <text className="result-block-chart-tick" x={point.x} y={height - 8} textAnchor="middle">
        {tickLabel(point.item.label, series.length)}
      </text>
    </g>)}
    {allZero && <text className="result-block-chart-empty" x={width / 2} y={padTop + plotHeight / 2} textAnchor="middle">暂无数据</text>}
  </svg>
}

function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
}

function donutSlicePath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const [outerStartX, outerStartY] = polar(cx, cy, outer, start)
  const [outerEndX, outerEndY] = polar(cx, cy, outer, end)
  const [innerEndX, innerEndY] = polar(cx, cy, inner, end)
  const [innerStartX, innerStartY] = polar(cx, cy, inner, start)
  const largeArc = end - start > Math.PI ? 1 : 0
  return `M ${outerStartX} ${outerStartY} A ${outer} ${outer} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`
    + ` L ${innerEndX} ${innerEndY} A ${inner} ${inner} 0 ${largeArc} 0 ${innerStartX} ${innerStartY} Z`
}

function formatShare(share: number): string {
  if (share > 0 && share < 0.01) return '<1%'
  return `${Math.round(share * 100)}%`
}

function PieChart({ block }: { block: BlockOf<'chart'> }) {
  const size = 148, cx = size / 2, cy = size / 2, outer = 62, inner = 40
  const values = block.series.map(item => item.value)
  const total = values.reduce((sum, value) => sum + value, 0)
  const slices = block.series.map((item, index) => {
    const share = total > 0 ? item.value / total : 0
    const before = values.slice(0, index).reduce((sum, value) => sum + value, 0)
    const start = -Math.PI / 2 + (total > 0 ? (before / total) * Math.PI * 2 : 0)
    return { item, share, start, end: start + share * Math.PI * 2 }
  }).filter(slice => slice.share > 0)
  return <div className="result-block-chart-pie">
    <svg className="result-block-chart-svg is-donut" viewBox={`0 0 ${size} ${size}`} role="img"
      aria-label={chartAriaLabel(block)} preserveAspectRatio="xMidYMid meet">
      {total <= 0
        ? <>
          <circle className="result-block-chart-ring-empty" cx={cx} cy={cy} r={(outer + inner) / 2} fill="none" />
          <text className="result-block-chart-empty" x={cx} y={cy + 4} textAnchor="middle">暂无数据</text>
        </>
        : slices.length === 1
          ? <circle className="result-block-chart-ring" data-tone={slices[0]!.item.tone}
            cx={cx} cy={cy} r={(outer + inner) / 2} fill="none" />
          : slices.map((slice, index) => <path className="result-block-chart-slice" data-tone={slice.item.tone}
            key={`${index}-${slice.item.label}`} d={donutSlicePath(cx, cy, outer, inner, slice.start, slice.end)} />)}
    </svg>
    <ul className="result-block-chart-legend">
      {block.series.map((item, index) => <li key={`${index}-${item.label}`}>
        <i className="result-block-chart-swatch" data-tone={item.tone} aria-hidden="true" />
        <span className="result-block-chart-legend-label">{item.label}</span>
        <em className="result-block-chart-legend-value">{formatNumber(item.value)}{block.unit}</em>
        <span className="result-block-chart-legend-share">{formatShare(total > 0 ? item.value / total : 0)}</span>
      </li>)}
    </ul>
  </div>
}

function ChartBlock({ block }: { block: BlockOf<'chart'> }) {
  return <div className="result-block-chart">
    <BlockLabel text={block.label} />
    {block.chart === 'line' ? <LineChart block={block} />
      : block.chart === 'pie' ? <PieChart block={block} />
        : <BarChart block={block} />}
  </div>
}

/* ---------- image ---------- */

function ImageBlock({ block }: { block: BlockOf<'image'> }) {
  return <div className="result-block-image">
    {block.url
      ? <img className="result-block-image-el" src={block.url} alt={block.alt} loading="lazy" />
      : <div className="result-block-image-empty">
        <ImageIcon size={20} strokeWidth={1.6} aria-hidden="true" />
        <span>{block.alt || '暂无图片'}</span>
      </div>}
    {block.caption && <p className="result-block-image-caption">{block.caption}</p>}
  </div>
}

/* ---------- diagram ---------- */

function DiagramBlock({ block }: { block: BlockOf<'diagram'> }) {
  return <MermaidDiagram source={block.source} caption={block.caption} ariaLabel={block.alt || block.caption || '图表'} />
}

/* ---------- callout ---------- */

function CalloutBlock({ block }: { block: BlockOf<'callout'> }) {
  const Icon = calloutIcons[block.tone]
  return <div className="result-block-callout" data-tone={block.tone} role="note">
    <span className="result-block-callout-icon" aria-hidden="true"><Icon size={15} strokeWidth={2} /></span>
    <div className="result-block-callout-body">
      {block.title && <p className="result-block-callout-title">{block.title}</p>}
      <p className="result-block-callout-text">{block.text}</p>
    </div>
  </div>
}

/* ---------- divider ---------- */

function DividerBlock() {
  return <hr className="result-block-divider" />
}

/* ---------- runtime fallback for primitives this client does not know yet ---------- */

type UnknownBlock = { type?: unknown; text?: unknown; label?: unknown; title?: unknown }

/** Never dumps raw JSON: a newer backend must not turn an old client into a blank screen. */
function FallbackBlock({ block }: { block: ResultBlock }) {
  const raw = block as unknown as UnknownBlock
  const kind = typeof raw.type === 'string' && raw.type ? raw.type : '未知内容'
  const summary = [raw.text, raw.label, raw.title].find(value => typeof value === 'string' && value.trim() !== '')
  return <div className="result-block-fallback">
    <Info size={14} strokeWidth={2} aria-hidden="true" />
    <span>暂不支持的内容（{kind}）</span>
    {typeof summary === 'string' && <em>{shorten(summary, 60)}</em>}
  </div>
}

/* ---------- registry: one renderer per published primitive, keyed by the wire `type` ---------- */

type BlockRenderer<K extends ResultBlockKind> = (block: BlockOf<K>) => ReactNode

/** Narrow once, so every individual renderer receives its exact block variant. */
function register<K extends ResultBlockKind>(kind: K, render: BlockRenderer<K>): [string, (block: ResultBlock) => ReactNode] {
  return [kind, block => render(block as BlockOf<K>)]
}

const blockRenderers = new Map<string, (block: ResultBlock) => ReactNode>([
  register('heading', block => <HeadingBlock block={block} />),
  register('text', block => <TextBlock block={block} />),
  register('keyValue', block => <KeyValueBlock block={block} />),
  register('stats', block => <StatsBlock block={block} />),
  register('table', block => <TableBlock block={block} />),
  register('list', block => <ListBlock block={block} />),
  register('progress', block => <ProgressBlock block={block} />),
  register('chart', block => <ChartBlock block={block} />),
  register('image', block => <ImageBlock block={block} />),
  register('diagram', block => <DiagramBlock block={block} />),
  register('callout', block => <CalloutBlock block={block} />),
  register('divider', () => <DividerBlock />),
])

/**
 * Renders a composed section: the layout belongs to the reader, the backend only composes
 * primitives. Used by result `custom` sections and by structured whiteboard detail sections;
 * unknown `type` values degrade to an inline notice instead of throwing.
 */
export function CustomSectionBody({ section }: { section: { layout: ResultSectionLayout; blocks: ResultBlock[] } }): ReactElement {
  return <div className={`result-blocks result-blocks-${section.layout}`}>
    {section.blocks.map((block, index) => {
      const render = blockRenderers.get(block.type)
      return <div className="result-block" data-block-type={block.type} key={`${index}-${block.type}`}>
        {render ? render(block) : <FallbackBlock block={block} />}
      </div>
    })}
  </div>
}
