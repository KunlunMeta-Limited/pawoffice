import { z } from 'zod'
import { idSchema } from './schema.ts'

const resultUrl = z.union([z.literal(''), z.url().refine(value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
})]).default('')
const resultOptionalId = z.union([z.literal(''), idSchema]).default('')

export const resultMetricKinds = ['auto', 'comparison', 'value', 'status', 'target', 'text'] as const

export const resultMetricSchema = z.strictObject({
  id: idSchema,
  label: z.string().trim().min(1).max(40),
  value: z.string().trim().min(1).max(40),
  unit: z.string().trim().max(12).default(''),
  /** auto picks comparison when a previous value exists, otherwise value. */
  kind: z.enum(resultMetricKinds).default('auto'),
  emphasis: z.enum(['normal', 'primary']).default('normal'),
  previous: z.string().trim().max(40).default(''),
  change: z.string().trim().max(40).default(''),
  trend: z.enum(['up', 'down', 'flat']).default('flat'),
  tone: z.enum(['positive', 'negative', 'neutral']).default('neutral'),
  target: z.string().trim().max(40).default(''),
  targetStatus: z.union([z.literal(''), z.enum(['met', 'missed', 'at-risk'])]).default(''),
  progress: z.number().min(0).max(100).optional(),
})

export const resultArtifactSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(['document', 'image', 'link', 'data']).default('document'),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).default(''),
  content: z.string().max(8000).default(''),
  url: resultUrl,
  /** Stable artifact id + immutable version id identify the content, independently of a working path. */
  versionId: resultOptionalId,
  version: z.string().trim().max(24).default(''),
  runId: resultOptionalId,
  producedAt: z.string().max(40).default(''),
  mimeType: z.string().trim().min(1).max(100).default('text/markdown'),
  sha256: z.union([z.literal(''), z.string().regex(/^[a-f0-9]{64}$/)]).default(''),
})

export const resultCheckSchema = z.strictObject({
  id: idSchema,
  label: z.string().trim().min(1).max(120),
  status: z.enum(['passed', 'pending', 'failed']).default('pending'),
  /** Optional evidence binding. A passed check for an old artifact version must not validate a newer version. */
  artifactId: resultOptionalId,
  versionId: resultOptionalId,
}).superRefine((check, context) => {
  if (Boolean(check.artifactId) !== Boolean(check.versionId)) context.addIssue({ code: 'custom', message: '验证对象须同时提供 artifactId 与 versionId', path: ['versionId'] })
})

export const resultDecisionSchema = z.strictObject({
  id: idSchema,
  question: z.string().trim().min(1).max(120),
  choice: z.string().trim().min(1).max(80),
  at: z.string().trim().max(40).default(''),
})

/** Shared state vocabulary for the compact rows of the result workspace. */
export const resultSectionStatuses = ['done', 'active', 'pending'] as const
const resultSectionStatus = z.enum(resultSectionStatuses).default('pending')

/**
 * Validated layout hints. The backend may say how important a block is and which column it prefers,
 * but never sends CSS, pixel values or arbitrary style objects; the reader maps these to design tokens.
 */
export const resultSectionSpans = ['half', 'full'] as const
export const resultSectionColumns = ['auto', 'main', 'aside'] as const
export const resultSectionEmphases = ['normal', 'primary'] as const

export const resultGalleryItemSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  /** Short label under the thumbnail, e.g. 登录页. Falls back to the title in the reader. */
  meta: z.string().trim().max(40).default(''),
  status: resultSectionStatus,
  /** Optional HTTPS preview image; the reader draws a wireframe placeholder when empty. */
  image: resultUrl,
})

export const resultDocumentItemSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(80),
  version: z.string().trim().max(24).default(''),
  at: z.string().trim().max(24).default(''),
  status: resultSectionStatus,
})

export const resultTestMetricSchema = z.strictObject({
  id: idSchema,
  label: z.string().trim().min(1).max(20),
  value: z.string().trim().min(1).max(16),
  unit: z.string().trim().max(8).default(''),
  tone: z.enum(['positive', 'negative', 'neutral']).default('neutral'),
})

export const resultApiRowSchema = z.strictObject({
  id: idSchema,
  endpoint: z.string().trim().min(1).max(80),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  status: resultSectionStatus,
  at: z.string().trim().max(24).default(''),
})

export const resultEnvironmentItemSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1).max(40),
  status: z.enum(['running', 'pending', 'stopped', 'failed']).default('pending'),
  version: z.string().trim().max(24).default(''),
  at: z.string().trim().max(24).default(''),
})

export const resultFileItemSchema = z.strictObject({
  id: idSchema,
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['image', 'document', 'report', 'archive', 'other']).default('document'),
  size: z.string().trim().max(16).default(''),
  url: resultUrl,
})

export const resultGallerySectionSchema = z.strictObject({
  kind: z.literal('gallery'),
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(60).default(''),
  span: z.enum(resultSectionSpans).default('half'),
  column: z.enum(resultSectionColumns).default('auto'),
  emphasis: z.enum(resultSectionEmphases).default('normal'),
  items: z.array(resultGalleryItemSchema).min(1).max(8),
})

export const resultDocumentsSectionSchema = z.strictObject({
  kind: z.literal('documents'),
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(60).default(''),
  span: z.enum(resultSectionSpans).default('half'),
  column: z.enum(resultSectionColumns).default('auto'),
  emphasis: z.enum(resultSectionEmphases).default('normal'),
  items: z.array(resultDocumentItemSchema).min(1).max(8),
})

export const resultTestsSectionSchema = z.strictObject({
  kind: z.literal('tests'),
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(60).default(''),
  span: z.enum(resultSectionSpans).default('half'),
  column: z.enum(resultSectionColumns).default('auto'),
  emphasis: z.enum(resultSectionEmphases).default('normal'),
  metrics: z.array(resultTestMetricSchema).max(4).default([]),
  /** 0–100, omitted when the backend has no progress figure. */
  progress: z.number().min(0).max(100).optional(),
  progressLabel: z.string().trim().max(40).default('测试进度'),
  checks: z.array(resultCheckSchema).max(12).default([]),
})

export const resultApiSectionSchema = z.strictObject({
  kind: z.literal('api'),
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(60).default(''),
  span: z.enum(resultSectionSpans).default('half'),
  column: z.enum(resultSectionColumns).default('auto'),
  emphasis: z.enum(resultSectionEmphases).default('normal'),
  rows: z.array(resultApiRowSchema).min(1).max(12),
})

export const resultEnvironmentsSectionSchema = z.strictObject({
  kind: z.literal('environments'),
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(60).default(''),
  span: z.enum(resultSectionSpans).default('half'),
  column: z.enum(resultSectionColumns).default('auto'),
  emphasis: z.enum(resultSectionEmphases).default('normal'),
  items: z.array(resultEnvironmentItemSchema).min(1).max(8),
})

export const resultFilesSectionSchema = z.strictObject({
  kind: z.literal('files'),
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(60).default(''),
  span: z.enum(resultSectionSpans).default('half'),
  column: z.enum(resultSectionColumns).default('auto'),
  emphasis: z.enum(resultSectionEmphases).default('normal'),
  items: z.array(resultFileItemSchema).min(1).max(12),
})

export const resultChangesSectionSchema = z.strictObject({
  kind: z.literal('changes'),
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(60).default(''),
  span: z.enum(resultSectionSpans).default('half'),
  column: z.enum(resultSectionColumns).default('auto'),
  emphasis: z.enum(resultSectionEmphases).default('normal'),
  /** One entry per changed file; the reader sums the line counts and groups by status. */
  files: z.array(z.strictObject({
    path: z.string().trim().min(1).max(200),
    status: z.enum(['added', 'modified', 'deleted', 'renamed']).default('modified'),
    /** Set only for renames; the reader shows "old → new". */
    previousPath: z.string().trim().max(200).default(''),
    added: z.number().int().min(0).max(1_000_000).default(0),
    deleted: z.number().int().min(0).max(1_000_000).default(0),
    binary: z.boolean().default(false),
    oversized: z.boolean().default(false),
    /** Single-file unified diff from the backend; rendered as escaped text, never as HTML. */
    diff: z.string().max(16000).default(''),
    /** Counts describe the whole file even when only a bounded diff excerpt is supplied. */
    diffTruncated: z.boolean().default(false),
  })).min(1).max(24),
})

/** Cell renderers a table may ask for; the reader owns the actual formatting and colours. */
export const resultTableFormats = ['text', 'number', 'percent', 'date', 'code', 'status', 'method', 'owner', 'link'] as const

/** The finite primitive catalogue the reader implements once and every custom section composes from. */
export const resultBlockTypes = [
  'heading', 'text', 'keyValue', 'stats', 'table', 'list', 'progress', 'chart', 'image', 'diagram', 'callout', 'divider',
] as const

export const resultHeadingBlockSchema = z.strictObject({
  type: z.literal('heading'),
  text: z.string().trim().min(1).max(80),
  level: z.enum(['h2', 'h3', 'h4']).default('h3'),
})

export const resultTextBlockSchema = z.strictObject({
  type: z.literal('text'),
  /** Markdown, rendered by the same reader as the board detail page; raw HTML is ignored. */
  text: z.string().max(4000),
})

export const resultKeyValueBlockSchema = z.strictObject({
  type: z.literal('keyValue'),
  label: z.string().trim().max(40).default(''),
  items: z.array(z.strictObject({
    label: z.string().trim().min(1).max(40),
    value: z.string().trim().min(1).max(160),
    tone: z.enum(['positive', 'negative', 'neutral']).default('neutral'),
  })).min(1).max(8),
})

export const resultStatsBlockSchema = z.strictObject({
  type: z.literal('stats'),
  label: z.string().trim().max(40).default(''),
  items: z.array(z.strictObject({
    label: z.string().trim().min(1).max(20),
    value: z.string().trim().min(1).max(16),
    unit: z.string().trim().max(8).default(''),
    tone: z.enum(['positive', 'negative', 'neutral']).default('neutral'),
  })).min(1).max(4),
})

export const resultTableColumnSchema = z.strictObject({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(20),
  format: z.enum(resultTableFormats).default('text'),
  align: z.enum(['left', 'right']).default('left'),
})

export const resultTableBlockSchema = z.strictObject({
  type: z.literal('table'),
  label: z.string().trim().max(40).default(''),
  columns: z.array(resultTableColumnSchema).min(1).max(6),
  /** Row keys should match column keys; missing cells render as — and unknown keys are ignored. */
  rows: z.array(z.record(z.string().min(1).max(40), z.string().max(300))).min(1).max(12),
})

export const resultListBlockSchema = z.strictObject({
  type: z.literal('list'),
  label: z.string().trim().max(40).default(''),
  ordered: z.boolean().default(false),
  items: z.array(z.strictObject({
    text: z.string().trim().min(1).max(200),
    status: z.union([z.literal(''), z.enum(['passed', 'pending', 'failed'])]).default(''),
  })).min(1).max(12),
})

export const resultProgressBlockSchema = z.strictObject({
  type: z.literal('progress'),
  label: z.string().trim().max(40).default('进度'),
  value: z.number().min(0).max(100),
  tone: z.enum(['positive', 'negative', 'neutral']).default('positive'),
})

export const resultChartBlockSchema = z.strictObject({
  type: z.literal('chart'),
  label: z.string().trim().max(40).default(''),
  chart: z.enum(['bar', 'line', 'pie']).default('bar'),
  unit: z.string().trim().max(8).default(''),
  series: z.array(z.strictObject({
    label: z.string().trim().min(1).max(20),
    value: z.number().min(0).max(1_000_000_000),
    tone: z.enum(['positive', 'negative', 'neutral']).default('neutral'),
  })).min(1).max(8),
})

export const resultImageBlockSchema = z.strictObject({
  type: z.literal('image'),
  url: resultUrl,
  alt: z.string().trim().max(80).default(''),
  caption: z.string().trim().max(60).default(''),
})

/**
 * Mermaid text rendered to SVG by the reader. The backend sends source text only; it must never
 * send HTML or SVG. Supported diagram types are Pele's (Mermaid 12 compatible syntax).
 */
export const resultDiagramBlockSchema = z.strictObject({
  type: z.literal('diagram'),
  source: z.string().trim().min(1).max(8000),
  caption: z.string().trim().max(60).default(''),
  alt: z.string().trim().max(120).default(''),
})

export const resultCalloutBlockSchema = z.strictObject({
  type: z.literal('callout'),
  tone: z.enum(['info', 'success', 'warning', 'danger']).default('info'),
  title: z.string().trim().max(40).default(''),
  text: z.string().trim().min(1).max(300),
})

export const resultDividerBlockSchema = z.strictObject({ type: z.literal('divider') })

/**
 * A primitive block. The backend composes these to cover long-tail layouts without shipping a new
 * React component per business case; the reader owns the layout, icons, colours and formatting.
 */
export const resultBlockSchema = z.discriminatedUnion('type', [
  resultHeadingBlockSchema, resultTextBlockSchema, resultKeyValueBlockSchema, resultStatsBlockSchema,
  resultTableBlockSchema, resultListBlockSchema, resultProgressBlockSchema, resultChartBlockSchema,
  resultImageBlockSchema, resultDiagramBlockSchema, resultCalloutBlockSchema, resultDividerBlockSchema,
])

export const resultLayouts = ['stack', 'columns', 'grid', 'cards'] as const

/**
 * Composed long-tail section: a layout plus primitive blocks. Internal layouts are part of the
 * reader (stack/columns/grid/cards), not arbitrary JSON layout objects.
 */
export const resultCustomSectionSchema = z.strictObject({
  kind: z.literal('custom'),
  id: idSchema,
  title: z.string().trim().min(1).max(40),
  caption: z.string().trim().max(60).default(''),
  span: z.enum(resultSectionSpans).default('half'),
  column: z.enum(resultSectionColumns).default('auto'),
  emphasis: z.enum(resultSectionEmphases).default('normal'),
  layout: z.enum(resultLayouts).default('stack'),
  blocks: z.array(resultBlockSchema).min(1).max(24),
})

/**
 * Semantic blocks of the 交付成果 workspace. The backend picks the kind and supplies content;
 * the reader owns layout, icons and colours and renders one known component per kind. High-frequency
 * business shapes stay as typed presets; `custom` composes primitives for everything else.
 */
export const resultSectionSchema = z.discriminatedUnion('kind', [
  resultGallerySectionSchema, resultDocumentsSectionSchema, resultTestsSectionSchema,
  resultApiSectionSchema, resultEnvironmentsSectionSchema, resultFilesSectionSchema,
  resultChangesSectionSchema,
  resultCustomSectionSchema,
])
export const resultSectionKinds = [
  'gallery', 'documents', 'tests', 'api', 'environments', 'files', 'changes', 'custom',
] as const

export const resultTaskSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(80),
  owner: z.string().trim().max(40).default(''),
  status: z.enum(['todo', 'doing', 'blocked', 'done']).default('todo'),
  progress: z.number().min(0).max(100).optional(),
  note: z.string().trim().max(80).default(''),
})

export const resultVersionSchema = z.strictObject({
  id: idSchema,
  version: z.string().trim().min(1).max(24),
  note: z.string().trim().max(120).default(''),
  at: z.string().trim().max(24).default(''),
  author: z.string().trim().max(40).default(''),
  status: z.enum(['draft', 'released', 'rolled-back']).default('released'),
})

export const resultRiskSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(100),
  level: z.enum(['high', 'medium', 'low']).default('medium'),
  status: z.enum(['open', 'mitigating', 'closed']).default('open'),
  owner: z.string().trim().max(40).default(''),
  note: z.string().trim().max(160).default(''),
})

/** A structured result attached to the current goal. The reader renders it as a standalone page. */
export const officeResultSchema = z.strictObject({
  template: z.literal('result-v1').default('result-v1'),
  runId: resultOptionalId,
  title: z.string().max(160).default(''),
  status: z.enum(['draft', 'ready', 'verified', 'rejected']).default('draft'),
  summary: z.string().max(300).default(''),
  verdict: z.string().max(300).default(''),
  owner: z.string().max(40).default(''),
  producedAt: z.string().max(40).default(''),
  /** Workspace header additions. Empty strings keep the reader on the compact result page. */
  team: z.string().max(40).default(''),
  teamSize: z.number().int().min(0).max(99).optional(),
  updatedAt: z.string().max(40).default(''),
  metrics: z.array(resultMetricSchema).max(12).default([]),
  /** Optional section heading override, e.g. 审核结论 or 调研完成度. */
  metricsTitle: z.string().max(40).default(''),
  /** Optional caption for the metric group, e.g. the observation window. */
  metricsCaption: z.string().max(60).default(''),
  artifacts: z.array(resultArtifactSchema).max(8).default([]),
  /** Semantic blocks for the 交付成果 tab. Order controls column order within each column. */
  sections: z.array(resultSectionSchema).max(8).default([]),
  checks: z.array(resultCheckSchema).max(12).default([]),
  decisions: z.array(resultDecisionSchema).max(8).default([]),
  /** 任务明细 tab. */
  tasks: z.array(resultTaskSchema).max(12).default([]),
  /** 版本记录 tab. */
  versions: z.array(resultVersionSchema).max(8).default([]),
  /** 风险与备注 tab. */
  risks: z.array(resultRiskSchema).max(8).default([]),
  next: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  note: z.string().max(300).default(''),
})
export const emptyResult = () => officeResultSchema.parse({})
export type OfficeResult = z.infer<typeof officeResultSchema>
export type OfficeResultInput = z.input<typeof officeResultSchema>
export type ResultMetric = z.infer<typeof resultMetricSchema>
export type ResultMetricInput = z.input<typeof resultMetricSchema>
export type ResultArtifact = z.infer<typeof resultArtifactSchema>
export type ResultCheck = z.infer<typeof resultCheckSchema>
export type ResultDecision = z.infer<typeof resultDecisionSchema>
export type ResultSection = z.infer<typeof resultSectionSchema>
export type ResultSectionKind = ResultSection['kind']
export type ResultGallerySection = z.infer<typeof resultGallerySectionSchema>
export type ResultDocumentsSection = z.infer<typeof resultDocumentsSectionSchema>
export type ResultTestsSection = z.infer<typeof resultTestsSectionSchema>
export type ResultApiSection = z.infer<typeof resultApiSectionSchema>
export type ResultEnvironmentsSection = z.infer<typeof resultEnvironmentsSectionSchema>
export type ResultFilesSection = z.infer<typeof resultFilesSectionSchema>
export type ResultChangesSection = z.infer<typeof resultChangesSectionSchema>
export type ResultCustomSection = z.infer<typeof resultCustomSectionSchema>
export type ResultSectionLayout = ResultCustomSection['layout']
export type ResultBlock = z.infer<typeof resultBlockSchema>
export type ResultBlockKind = ResultBlock['type']
export type ResultTableColumn = z.infer<typeof resultTableColumnSchema>
export type ResultTask = z.infer<typeof resultTaskSchema>
export type ResultVersion = z.infer<typeof resultVersionSchema>
export type ResultRisk = z.infer<typeof resultRiskSchema>

export const whiteboardDetailSectionSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(80),
  caption: z.string().trim().max(60).default(''),
  layout: z.enum(resultLayouts).default('stack'),
  blocks: z.array(resultBlockSchema).min(1).max(24),
})
export type WhiteboardDetailSection = z.infer<typeof whiteboardDetailSectionSchema>
export type WhiteboardDetailSectionInput = z.input<typeof whiteboardDetailSectionSchema>

const whiteboardBaseSchema = z.strictObject({
  template: z.literal('task-board-v1').default('task-board-v1'), title: z.string().max(160).default(''),
  status: z.enum(['queued', 'running', 'blocked', 'completed', 'failed']).default('queued'),
  tagline: z.string().max(40).default(''), description: z.string().max(300).default(''), note: z.string().max(160).default(''),
  summary: z.string().max(300).default(''),
  /** Structured page shown when the board is expanded. Replaces the legacy Markdown `detail`. */
  detailSections: z.array(whiteboardDetailSectionSchema).max(8).default([]),
  /** @deprecated Legacy Markdown detail; rendered as a fallback when detailSections is empty. */
  detail: z.string().max(16000).default(''),
  link: z.strictObject({ label: z.string().max(40).default(''), url: z.union([z.literal(''), z.url().refine(value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
  })]).default('') }).default({ label: '', url: '' }),
  steps: z.array(z.strictObject({
    id: idSchema, title: z.string().min(1).max(160),
    progress: z.union([z.literal(-1), z.number().min(0).max(100)]).default(-1),
    /** Optional semantic phase state; omitted means the reader derives it from the progress value. */
    state: z.enum(['done', 'active', 'pending']).optional(),
  })).max(3).default([]),
})

/** One delivery is immutable. Larger historical snapshots can be read from a backend-owned version URL. */
export const resultDeliverySchema = z.strictObject({
  id: idSchema,
  /** Explicit chat association, scoped to the containing conversation; never inferred from arrival order. */
  turnId: z.string().max(100).default(''),
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().max(100).default(''),
  createdAt: z.string().trim().min(1).max(40),
  board: whiteboardBaseSchema.optional(),
  result: officeResultSchema.optional(),
  snapshotUrl: resultUrl,
}).superRefine((delivery, context) => {
  if (Boolean(delivery.result) === Boolean(delivery.snapshotUrl)) context.addIssue({ code: 'custom', message: '交付须提供 result 或 snapshotUrl，且只能提供一个', path: ['result'] })
  if (delivery.result?.runId && delivery.result.runId !== delivery.id) context.addIssue({ code: 'custom', message: '交付 result.runId 须与交付 id 一致', path: ['result', 'runId'] })
  delivery.result?.artifacts.forEach((artifact, index) => {
    if (!artifact.versionId) context.addIssue({ code: 'custom', message: '历史交付的产物须绑定 versionId', path: ['result', 'artifacts', index, 'versionId'] })
  })
})
export type ResultDelivery = z.infer<typeof resultDeliverySchema>

export const whiteboardTaskBoardSchema = whiteboardBaseSchema.extend({
  /** Authoritative current aggregate; omitted artifacts are not silently restored from history. */
  result: officeResultSchema.default(emptyResult()),
  deliveries: z.array(resultDeliverySchema).max(20).default([]),
}).superRefine((board, context) => {
  const ids = new Set<string>(), sequences = new Set<number>()
  board.deliveries.forEach((delivery, index) => {
    if (ids.has(delivery.id)) context.addIssue({ code: 'custom', message: '交付 id 重复', path: ['deliveries', index, 'id'] })
    if (sequences.has(delivery.sequence)) context.addIssue({ code: 'custom', message: '交付序号重复', path: ['deliveries', index, 'sequence'] })
    ids.add(delivery.id); sequences.add(delivery.sequence)
  })
  const revisions = new Map<string, { content: string; url: string; mimeType: string; sha256: string }>()
  const results = [board.result, ...board.deliveries.flatMap(delivery => delivery.result ? [delivery.result] : [])]
  for (const result of results) for (const artifact of result.artifacts) {
    if (!artifact.versionId) continue
    const key = JSON.stringify([artifact.id, artifact.versionId])
    const previous = revisions.get(key)
    if (previous && (previous.content !== artifact.content || previous.mimeType !== artifact.mimeType || previous.sha256 !== artifact.sha256
      || (!artifact.sha256 && previous.url !== artifact.url))) {
      context.addIssue({ code: 'custom', message: '同一产物版本不能对应不同内容；修改内容必须创建新 versionId', path: ['deliveries'] })
    }
    revisions.set(key, artifact)
  }
})
type WhiteboardInput = z.input<typeof whiteboardTaskBoardSchema>
export type WhiteboardTaskBoardData = WhiteboardInput & Required<Pick<WhiteboardInput, 'template' | 'title' | 'status' | 'steps'>>
export const emptyWhiteboard = () => whiteboardTaskBoardSchema.parse({ template: 'task-board-v1', title: '', status: 'queued', tagline: '', steps: [] })

export const officeUiManifest = {
  slots: [
    { id: 'whiteboard', content: 'task-board-v1', persistent: true, update: 'office.snapshot' },
    { id: 'dialog', content: 'detail-v1', persistent: false, update: 'ui.respond' },
    { id: 'computer.task', content: 'task', persistent: true, update: 'office.snapshot' },
    { id: 'decision', content: 'confirmation-or-choice', persistent: false, update: 'decision.request' },
  ],
  actions: ['office.create', 'actor.inspect', 'employee.inspect', 'employee.create', 'task.start', 'task.block', 'task.complete', 'task.assign', 'dialog.action', 'conversation.delete'],
} as const
