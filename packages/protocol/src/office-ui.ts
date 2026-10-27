import { z } from 'zod'
import { idSchema } from './schema.ts'

const resultUrl = z.union([z.literal(''), z.url().refine(value => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
})]).default('')

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
})

export const resultCheckSchema = z.strictObject({
  id: idSchema,
  label: z.string().trim().min(1).max(120),
  status: z.enum(['passed', 'pending', 'failed']).default('pending'),
})

export const resultDecisionSchema = z.strictObject({
  id: idSchema,
  question: z.string().trim().min(1).max(120),
  choice: z.string().trim().min(1).max(80),
  at: z.string().trim().max(40).default(''),
})

/** A structured result attached to the current goal. The reader renders it as a standalone page. */
export const officeResultSchema = z.strictObject({
  template: z.literal('result-v1').default('result-v1'),
  title: z.string().max(160).default(''),
  status: z.enum(['draft', 'ready', 'verified', 'rejected']).default('draft'),
  summary: z.string().max(300).default(''),
  verdict: z.string().max(300).default(''),
  owner: z.string().max(40).default(''),
  producedAt: z.string().max(40).default(''),
  metrics: z.array(resultMetricSchema).max(12).default([]),
  /** Optional section heading override, e.g. 审核结论 or 调研完成度. */
  metricsTitle: z.string().max(40).default(''),
  /** Optional caption for the metric group, e.g. the observation window. */
  metricsCaption: z.string().max(60).default(''),
  artifacts: z.array(resultArtifactSchema).max(8).default([]),
  checks: z.array(resultCheckSchema).max(12).default([]),
  decisions: z.array(resultDecisionSchema).max(8).default([]),
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

export const whiteboardTaskBoardSchema = z.strictObject({
  template: z.literal('task-board-v1').default('task-board-v1'), title: z.string().max(160).default(''),
  status: z.enum(['queued', 'running', 'blocked', 'completed', 'failed']).default('queued'),
  tagline: z.string().max(40).default(''), description: z.string().max(300).default(''), note: z.string().max(160).default(''),
  summary: z.string().max(300).default(''), detail: z.string().max(16000).default(''),
  link: z.strictObject({ label: z.string().max(40).default(''), url: z.union([z.literal(''), z.url().refine(value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
  })]).default('') }).default({ label: '', url: '' }),
  steps: z.array(z.strictObject({ id: idSchema, title: z.string().min(1).max(160), progress: z.union([z.literal(-1), z.number().min(0).max(100)]).default(-1) })).max(3).default([]),
  /** Optional structured result of the current goal. Empty when the goal has not produced one yet. */
  result: officeResultSchema.default(emptyResult()),
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
