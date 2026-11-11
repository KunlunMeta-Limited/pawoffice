/**
 * DEV-ONLY acceptance fixtures for the result reading page.
 *
 * These are front-end verification data, NOT protocol fields, NOT backend APIs and NOT production
 * data. Every fixture is parsed by the frozen protocol schemas below; a failed parse throws
 * immediately so a broken fixture can never be mistaken for a rendered result.
 *
 * `sample` is the user-supplied `result-ready-round3.json`, copied byte-for-byte into
 * `./fixtures/result-ready-round3.json` (see the SHA-256 reported with the screenshot manifest).
 * All other fixtures are hand-authored legal protocol values used only to exercise rendering
 * branches that the real sample does not contain.
 */
import {
  emptyResult, officeResultSchema, whiteboardTaskBoardSchema,
} from '@pawoffice/protocol/office-ui'
import type {
  OfficeResult, OfficeResultInput, WhiteboardTaskBoardData,
} from '@pawoffice/protocol/office-ui'
import { resultPresentation } from '../results/presentation.ts'
import sampleSource from './fixtures/result-ready-round3.json?raw'
import historySource from './fixtures/whiteboard-ready-round3.json?raw'

/* -------------------------------------------------------------------------------------------------
 * Schema-checked constructors
 * ----------------------------------------------------------------------------------------------- */

function checkedResult(input: OfficeResultInput, label: string): OfficeResult
function checkedResult(input: unknown, label: string): OfficeResult
function checkedResult(input: unknown, label: string): OfficeResult {
  const parsed = officeResultSchema.safeParse(input)
  if (!parsed.success) throw new Error(`[dev fixture] ${label} 未通过 officeResultSchema 校验：${JSON.stringify(parsed.error.issues)}`)
  return parsed.data
}

function checkedBoard(input: unknown, label: string): WhiteboardTaskBoardData {
  const parsed = whiteboardTaskBoardSchema.safeParse(input)
  if (!parsed.success) throw new Error(`[dev fixture] ${label} 未通过 whiteboardTaskBoardSchema 校验：${JSON.stringify(parsed.error.issues)}`)
  return parsed.data
}

type BoardStatus = NonNullable<WhiteboardTaskBoardData['status']>

/** Build a legal task board around a result. Execution status is always explicit here. */
function boardFor(result: OfficeResult, status: BoardStatus, title = result.title || '当前成果', steps: WhiteboardTaskBoardData['steps'] = []): WhiteboardTaskBoardData {
  return checkedBoard({
    template: 'task-board-v1', title, status, tagline: '前端验收夹具', summary: result.summary,
    description: '', note: '', detailSections: [], detail: '', link: { label: '', url: '' },
    steps, result, deliveries: [],
  }, `board:${title}`)
}

const runningSteps: WhiteboardTaskBoardData['steps'] = [
  { id: 'step-scope', title: '确认范围', progress: 100 },
  { id: 'step-produce', title: '产出成果', progress: 60 },
]
const blockedSteps: WhiteboardTaskBoardData['steps'] = [
  { id: 'step-scope', title: '确认范围', progress: 100 },
  { id: 'step-produce', title: '产出成果', progress: 40 },
]
const completedSteps: WhiteboardTaskBoardData['steps'] = [
  { id: 'step-scope', title: '确认范围', progress: 100 },
  { id: 'step-produce', title: '产出成果', progress: 100 },
]

const range = (count: number) => Array.from({ length: count }, (_, index) => index)

type MetricInput = NonNullable<OfficeResultInput['metrics']>[number]
type ArtifactInput = NonNullable<OfficeResultInput['artifacts']>[number]
type SectionInput = NonNullable<OfficeResultInput['sections']>[number]
type BlockInput = Extract<SectionInput, { kind: 'custom' }>['blocks'][number]
type ChangeFileInput = Extract<SectionInput, { kind: 'changes' }>['files'][number]

/* -------------------------------------------------------------------------------------------------
 * 1. Real sample — user-supplied result-ready-round3.json (byte-for-byte copy)
 * ----------------------------------------------------------------------------------------------- */

export const realSampleSha256 = '7C090985EE937F5073002F954B530D960B1375A5CFB33CB34254D20285EAA0FE'
export const realSampleFile = 'apps/web/src/dev/fixtures/result-ready-round3.json'

/** Parsed straight from the raw file text so no hand-written shape can drift from the sample. */
export const sampleResult = checkedResult(JSON.parse(sampleSource) as OfficeResultInput, 'sample.result')

/**
 * The real sample only contains a `result` object: it has no `whiteboard.status`.
 * We validate the wrapper board first (status supplied only so the schema accepts it), then remove
 * the status property. The reader therefore shows "任务状态未提供" instead of inventing an
 * execution state that the sample never provided.
 */
const sampleBoardChecked = checkedBoard({
  template: 'task-board-v1', title: sampleResult.title, status: 'queued', tagline: '真实样例',
  summary: sampleResult.summary, description: '', note: '', detailSections: [], detail: '',
  link: { label: '', url: '' }, steps: [], result: sampleResult, deliveries: [],
}, 'sample.board')
delete (sampleBoardChecked as Partial<WhiteboardTaskBoardData>).status
export const sampleBoard: WhiteboardTaskBoardData = sampleBoardChecked

/**
 * Second real sample: `whiteboard-ready-round3.json` (byte-for-byte copy). Unlike the isolated
 * result sample it contains a task board with an explicit status and three `deliveries`, so it is
 * the only fixture that can exercise history switching, version selection and version comparison
 * without inventing data.
 */
export const realHistorySampleSha256 = '9B1A6602ABB98A83DEA31C42616569C8EE69C8089A2FD7DFC8789F5BEF8D9958'
export const realHistorySampleFile = 'apps/web/src/dev/fixtures/whiteboard-ready-round3.json'
export const historyBoard = checkedBoard(JSON.parse(historySource) as unknown, 'history.board')
export const historyResult = checkedResult(historyBoard.result ?? {}, 'history.result')

/* -------------------------------------------------------------------------------------------------
 * 2. Matrix — one composite result covering every legal shape
 * ----------------------------------------------------------------------------------------------- */

const matrixMetrics: MetricInput[] = [
  // auto resolves to comparison because a previous value exists
  { id: 'metric-auto', kind: 'auto', label: '自动识别（含前值）', value: '128', unit: '次', previous: '120 次', change: '+8', trend: 'up', tone: 'positive' },
  // auto resolves to value because no previous value exists
  { id: 'metric-auto-value', kind: 'auto', label: '自动回退数值', value: '42', unit: '个' },
  { id: 'metric-comparison', kind: 'comparison', label: '访问成交率', value: '3.8', unit: '%', previous: '2.9%', change: '+0.9pp', trend: 'up', tone: 'positive' },
  { id: 'metric-comparison-down', kind: 'comparison', label: '待处理问题', value: '12', unit: '项', previous: '18 项', change: '-6', trend: 'down', tone: 'neutral' },
  { id: 'metric-value', kind: 'value', label: '测试用例', value: '86', unit: '个' },
  { id: 'metric-value-primary', kind: 'value', label: '用户满意度', value: '4.8', unit: '/5', emphasis: 'primary', tone: 'positive' },
  { id: 'metric-status', kind: 'status', label: '发布状态', value: '待发布', tone: 'neutral' },
  { id: 'metric-status-warn', kind: 'status', label: '评审状态', value: '需复核', tone: 'negative' },
  { id: 'metric-target', kind: 'target', label: '测试通过率', value: '96', unit: '%', target: '95%', targetStatus: 'met', progress: 96, tone: 'positive', emphasis: 'primary' },
  { id: 'metric-target-risk', kind: 'target', label: '首屏响应', value: '1.8', unit: 's', target: '≤2s', targetStatus: 'at-risk', progress: 78, tone: 'neutral' },
  { id: 'metric-text', kind: 'text', label: '覆盖范围', value: '仅覆盖登录模块' },
  { id: 'metric-text-note', kind: 'text', label: '口径说明', value: '两轮观察窗口一致' },
]

const matrixArtifacts: ArtifactInput[] = [
  {
    id: 'doc-prd', kind: 'document', title: '需求说明 v2.0', description: '含标题、列表、表格与代码块的 Markdown 正文。',
    change: 'updated', versionId: 'doc-prd-v2', version: 'v2.0', runId: 'run-matrix',
    producedAt: '2026-11-11T09:00:00+08:00', mimeType: 'text/markdown',
    content: `# 需求说明 v2.0

## 功能范围
- 账号密码登录
- 短信验证码登录
- 退出登录与权限校验

## 验收要求

| 项目 | 要求 | 状态 |
| --- | --- | --- |
| 验证码有效期 | 5 分钟 | 已确认 |
| 连续失败限制 | 5 次后限制 10 分钟 | 待复核 |

\`\`\`ts
const submit = async () => { await login() }
\`\`\`

> 本文档为前端验收 fixture，不是真实业务正文。`,
  },
  {
    id: 'shot-login', kind: 'image', title: '登录页截图', description: '带合法 https URL 的图片产物。',
    change: 'added', url: 'https://example.com/pawoffice/login-page.png', versionId: 'shot-login-v1',
    version: 'v1.0', runId: 'run-matrix', producedAt: '2026-11-11T09:10:00+08:00', mimeType: 'image/png',
  },
  {
    id: 'shot-empty', kind: 'image', title: '待补截图', description: 'URL 为空时的统一占位回退。',
    versionId: 'shot-empty-v1', version: 'v1.0', mimeType: 'image/png',
  },
  {
    id: 'link-spec', kind: 'link', title: '接口规范（外链）', description: '仅合法 https 地址可打开。',
    url: 'https://example.com/pawoffice/api-spec', versionId: 'link-spec-v1', version: 'v1.0', mimeType: 'text/html',
  },
  {
    id: 'link-empty', kind: 'link', title: '待补外链', description: '空 URL 不生成假跳转。',
    change: 'added', versionId: 'link-empty-v1', version: 'v1.0',
  },
  {
    id: 'data-cases', kind: 'data', title: '测试用例数据', description: '数据型产物，保留原始表格正文。',
    versionId: 'data-cases-v1', version: 'v1.0', mimeType: 'text/csv',
    content: `| 用例 | 通道 | 结果 |
| --- | --- | --- |
| 密码登录成功 | 账号密码 | 通过 |
| 验证码过期 | 短信 | 待复核 |
| 连续失败限制 | 账号密码 | 未通过 |`,
  },
]

const matrixCustomBlocks: BlockInput[] = [
  { type: 'heading', text: '自定义区块矩阵', level: 'h2' },
  { type: 'text', text: '正文使用 **Markdown** 渲染：段落、列表、引用与代码块保持原结构。\n\n- 第一项\n- 第二项\n\n> 引用内容不应被改写成结论。\n\n```json\n{ "kind": "text" }\n```\n\n原始 HTML 仅作为文本：<b>不执行</b>。' },
  { type: 'keyValue', label: '关键属性', items: [
    { label: '负责人', value: '王明' }, { label: '团队', value: '研发组（2 人）' },
    { label: '交付轮次', value: '第 3 轮' }, { label: '发布状态', value: '待发布', tone: 'negative' },
  ] },
  { type: 'stats', label: '关键数字', items: [
    { label: '用例', value: '86', unit: '个' }, { label: '通过率', value: '96', unit: '%', tone: 'positive' },
    { label: '问题', value: '1', unit: '项', tone: 'negative' }, { label: '目标', value: '95', unit: '%' },
  ] },
  { type: 'table', label: '接口清单', columns: [
    { key: 'method', label: '方法', format: 'method' }, { key: 'endpoint', label: '地址', format: 'code' },
    { key: 'status', label: '状态', format: 'status' }, { key: 'owner', label: '负责人', format: 'owner' },
  ], rows: [
    { method: 'POST', endpoint: '/api/auth/login', status: 'done', owner: '王明' },
    { method: 'GET', endpoint: '/api/auth/session', status: 'active', owner: '周宁' },
    { method: 'DELETE', endpoint: '/api/auth/logout', status: 'pending', owner: '王明' },
  ] },
  { type: 'list', label: '检查项', items: [
    { text: '主流程冒烟', status: 'passed' }, { text: '异常路径回归', status: 'failed' },
    { text: '性能基线复核', status: 'pending' }, { text: '文档完整性人工复核' },
  ] },
  { type: 'progress', label: '回归测试进度', value: 76, tone: 'positive' },
  { type: 'chart', label: '各模块用例数', chart: 'bar', unit: '个', series: [
    { label: '登录', value: 32, tone: 'positive' }, { label: '权限', value: 18 },
    { label: '验证码', value: 22 }, { label: '退出', value: 14 },
  ] },
  { type: 'image', url: '', alt: '登录流程图占位', caption: '无地址时显示统一占位' },
  { type: 'diagram', source: 'flowchart TD\n  A[打开成果] --> B[阅读交付]\n  B --> C{需要复核?}\n  C -->|是| D[查看验证缺口]\n  C -->|否| E[完成]', caption: 'Mermaid 源文本' },
  { type: 'callout', tone: 'warning', title: '数据说明', text: '以上为前端验收 fixture，不连接真实业务数据。' },
  { type: 'divider' },
]

const matrixSections: SectionInput[] = [
  {
    kind: 'gallery', id: 'section-gallery', title: '页面画廊', caption: '有图与无图占位',
    span: 'full', emphasis: 'primary', items: [
      { id: 'gallery-1', title: '登录页', meta: '登录', status: 'done', image: 'https://example.com/pawoffice/login.png' },
      { id: 'gallery-2', title: '验证码页', meta: '短信', status: 'active', image: 'https://example.com/pawoffice/code.png' },
      { id: 'gallery-3', title: '权限提示', meta: '权限', status: 'pending' },
      { id: 'gallery-4', title: '退出确认', meta: '退出', status: 'pending' },
    ],
  },
  {
    kind: 'documents', id: 'section-documents', title: '交付文档', caption: '精确关联 artifactId + versionId',
    items: [
      { id: 'document-prd', artifactId: 'doc-prd', versionId: 'doc-prd-v2', title: '需求说明 v2.0', version: 'v2.0', at: '2026-11-11 09:00', status: 'done' },
      { id: 'document-data', artifactId: 'data-cases', versionId: 'data-cases-v1', title: '测试用例数据', version: 'v1.0', at: '2026-11-11 09:20', status: 'active' },
      { id: 'document-unlinked', title: '会议纪要（未关联文件）', status: 'pending' },
    ],
  },
  {
    kind: 'tests', id: 'section-tests', title: '质量报告', caption: 'metrics / progress / checks',
    metrics: [
      { id: 'test-metric-cases', label: '用例', value: '86', unit: '个' },
      { id: 'test-metric-rate', label: '通过率', value: '96', unit: '%', tone: 'positive' },
      { id: 'test-metric-failed', label: '失败', value: '1', unit: '项', tone: 'negative' },
    ],
    progress: 82, progressLabel: '回归测试进度',
    checks: [
      { id: 'test-check-main', label: '主流程冒烟', status: 'passed' },
      { id: 'test-check-failed', label: '异常路径回归', status: 'failed' },
      { id: 'test-check-pending', label: '性能基线复核', status: 'pending' },
    ],
  },
  {
    kind: 'api', id: 'section-api', title: '接口清单', caption: '方法短标记 + 等宽 endpoint',
    rows: [
      { id: 'api-row-1', endpoint: '/api/auth/login', method: 'POST', status: 'done', at: '2026-11-11 09:00' },
      { id: 'api-row-2', endpoint: '/api/auth/session', method: 'GET', status: 'active', at: '2026-11-11 09:05' },
      { id: 'api-row-3', endpoint: '/api/auth/login', method: 'PATCH', status: 'pending' },
      { id: 'api-row-4', endpoint: '/api/auth/logout', method: 'DELETE', status: 'done', at: '2026-11-11 09:10' },
    ],
  },
  {
    kind: 'environments', id: 'section-environments', title: '运行环境', caption: '四种环境状态',
    items: [
      { id: 'env-dev', name: '本地开发', status: 'running', version: 'v2.0', at: '2026-11-11 09:00' },
      { id: 'env-staging', name: '预发布', status: 'pending', version: 'v2.0-rc1' },
      { id: 'env-legacy', name: '旧版灰度', status: 'stopped', version: 'v1.0', at: '2026-11-01 10:00' },
      { id: 'env-canary', name: '灰度节点', status: 'failed', at: '2026-11-11 08:40' },
    ],
  },
  {
    kind: 'files', id: 'section-files', title: '附件清单', caption: '文件名、种类、大小与有效 URL',
    items: [
      { id: 'file-1', name: '登录页截图.png', kind: 'image', size: '248 KB', url: 'https://example.com/pawoffice/login.png' },
      { id: 'file-2', name: '验收报告.md', kind: 'report', size: '12 KB' },
      { id: 'file-3', name: '需求说明.docx', kind: 'document', size: '64 KB' },
      { id: 'file-4', name: '测试数据.zip', kind: 'archive', size: '1.2 MB', url: 'https://example.com/pawoffice/cases.zip' },
      { id: 'file-5', name: '会议录音', kind: 'other', size: '3.4 MB' },
    ],
  },
  {
    kind: 'changes', id: 'section-changes', title: '文件变更', caption: '真实 diff、二进制与重命名',
    files: [
      {
        path: 'src/features/auth/LoginForm.tsx', status: 'modified', added: 4, deleted: 2,
        diff: 'diff --git a/src/features/auth/LoginForm.tsx b/src/features/auth/LoginForm.tsx\n--- a/src/features/auth/LoginForm.tsx\n+++ b/src/features/auth/LoginForm.tsx\n@@ -12,6 +12,8 @@\n export function LoginForm() {\n   const [error, setError] = useState(\'\')\n-  const submit = () => login()\n+  const [submitting, setSubmitting] = useState(false)\n+  const submit = async () => { await login() }\n   return (\n-    <button onClick={submit}>登录</button>\n+    <button disabled={submitting} onClick={submit}>登录</button>\n   )\n',
      },
      {
        path: 'src/features/auth/useLogin.ts', status: 'added', added: 4, deleted: 0,
        diff: '--- /dev/null\n+++ b/src/features/auth/useLogin.ts\n@@ -0,0 +1,4 @@\n+export async function login() {\n+  const response = await api.post(\'/auth/login\')\n+  return response.json()\n+}\n',
      },
      {
        path: 'src/features/auth/session.ts', status: 'renamed', previousPath: 'src/features/auth/storage.ts',
        added: 1, deleted: 1,
        diff: 'rename from src/features/auth/storage.ts\nrename to src/features/auth/session.ts\n--- a/src/features/auth/storage.ts\n+++ b/src/features/auth/session.ts\n@@ -1,1 +1,1 @@\n-export const sessionKey = \'legacy-token\'\n+export const sessionKey = \'access-token\'\n',
      },
      { path: 'docs/login-flow.png', status: 'added', added: 0, deleted: 0, binary: true },
    ],
  },
  {
    kind: 'custom', id: 'section-custom', title: '自定义区块矩阵', caption: '12 种 block · stack 布局',
    layout: 'stack', span: 'full', blocks: matrixCustomBlocks,
  },
]

export const matrixResult = checkedResult({
  template: 'result-v1', runId: 'run-matrix', title: '全类型渲染验收矩阵', status: 'ready',
  summary: '覆盖 6 类指标、4 类交付物、8 类区块与 12 种自定义区块的前端验收矩阵。',
  verdict: '前端验收 fixture：全部数据为人工构造的合法协议样例，不代表真实业务结论。',
  owner: '验收夹具', team: 'P9 验收组', teamSize: 3,
  producedAt: '2026-11-11T09:00:00+08:00', updatedAt: '2026-11-11T10:30:00+08:00',
  metricsTitle: '指标类型矩阵', metricsCaption: '6 种 kind · 7–12 项密度 · emphasis=primary',
  metrics: matrixMetrics, artifacts: matrixArtifacts, sections: matrixSections,
  checks: [
    { id: 'check-stale', label: '需求范围检查（旧版本绑定）', status: 'passed', artifactId: 'doc-prd', versionId: 'doc-prd-v1' },
    { id: 'check-failed', label: '异常路径回归', status: 'failed' },
    { id: 'check-pending', label: '性能基线复核', status: 'pending' },
    { id: 'check-passed', label: '主流程冒烟', status: 'passed' },
  ],
  risks: [
    { id: 'risk-sms', title: '短信验证码频率限制待复核', level: 'high', status: 'open', owner: '周宁', note: '发布前检查同一手机号与 IP 的频率限制。' },
    { id: 'risk-doc', title: '旧版本文档已归档', level: 'low', status: 'closed', owner: '王明', note: '归档完成，不再作为验收依据。' },
  ],
  tasks: [
    { id: 'task-todo', title: '补充性能基线', status: 'todo', owner: '周宁' },
    { id: 'task-doing', title: '发布前验收', status: 'doing', owner: '周宁', progress: 92 },
    { id: 'task-blocked', title: '灰度节点排查', status: 'blocked', owner: '王明', note: '等待运维恢复节点。' },
    { id: 'task-done', title: '登录功能开发', status: 'done', owner: '王明', progress: 100 },
  ],
  versions: [
    { id: 'version-1', version: '第 1 轮交付', note: '首轮需求草稿。', at: '2026-11-10 10:00', author: '王明', status: 'draft' },
    { id: 'version-2', version: '第 2 轮交付', note: '补充接口文档。', at: '2026-11-11 09:00', author: '王明', status: 'released' },
    { id: 'version-3', version: '第 3 轮交付', note: '范围调整后回滚。', at: '2026-11-11 10:00', author: '周宁', status: 'rolled-back' },
  ],
  decisions: [
    { id: 'decision-1', question: '本轮支持哪些登录方式？', choice: '账号密码 + 短信验证码', at: '2026-11-11' },
    { id: 'decision-2', question: '验收依据采用哪个版本？', choice: '以 v2.0 需求说明为准', at: '2026-11-11' },
  ],
  next: ['完成验证码频率限制复核，再进行最终验收。', '补齐性能基线后更新质量报告。'],
  note: '以上为前端验收 fixture，非真实业务数据。',
}, 'matrix.result')
export const matrixBoard = boardFor(matrixResult, 'completed', matrixResult.title, completedSteps)

/* -------------------------------------------------------------------------------------------------
 * 3. Layouts — four custom layouts (a single result can hold at most 8 sections, so the four
 *    custom layouts live in their own result instead of displacing a section kind in `matrix`).
 * ----------------------------------------------------------------------------------------------- */

const stackBlocks: BlockInput[] = [
  { type: 'heading', text: '连续文档布局', level: 'h3' },
  { type: 'text', text: 'stack 布局按连续文档排布，标题与正文保持文档节奏。' },
  { type: 'keyValue', items: [{ label: '布局', value: 'stack' }, { label: '用途', value: '连续文档' }] },
]
const columnsBlocks: BlockInput[] = [
  { type: 'stats', items: [{ label: '模块', value: '4', unit: '个' }, { label: '进度', value: '76', unit: '%' }] },
  { type: 'table', columns: [{ key: 'name', label: '模块' }, { key: 'state', label: '状态', format: 'status' }],
    rows: [{ name: '登录', state: '已完成' }, { name: '验证码', state: '进行中' }] },
  { type: 'list', items: [{ text: 'columns 布局用于短内容并排', status: '' }, { text: '窄屏折叠为单列', status: 'pending' }] },
]
const gridBlocks: BlockInput[] = [
  { type: 'progress', value: 48, label: 'grid 进度' },
  { type: 'chart', chart: 'pie', series: [{ label: '通过', value: 68, tone: 'positive' }, { label: '待复核', value: 32, tone: 'neutral' }] },
  { type: 'image', url: '', alt: '网格图片占位' },
  { type: 'diagram', source: 'flowchart LR\n  A[输入] --> B[渲染] --> C[验收]' },
]
const cardsBlocks: BlockInput[] = [
  { type: 'callout', tone: 'info', title: 'cards 布局', text: '浅卡片只影响当前 custom 内部，不跨 section 排序。' },
  { type: 'divider' },
  { type: 'text', text: '所有 12 种 block 均已在本 fixture 与 matrix 中出现。' },
]

export const layoutsResult = checkedResult({
  template: 'result-v1', runId: 'run-layouts', title: '自定义布局验收', status: 'ready',
  summary: '四种 custom 布局与 12 种 block 的渲染验收。',
  verdict: '前端验收 fixture：仅用于验证布局，不代表真实交付。',
  owner: '验收夹具', team: 'P9 验收组', teamSize: 2,
  producedAt: '2026-11-11T11:00:00+08:00',
  sections: [
    { kind: 'custom', id: 'layout-stack', title: '连续文档', caption: 'layout=stack', layout: 'stack', blocks: stackBlocks },
    { kind: 'custom', id: 'layout-columns', title: '并排短内容', caption: 'layout=columns', layout: 'columns', blocks: columnsBlocks },
    { kind: 'custom', id: 'layout-grid', title: '网格内容', caption: 'layout=grid', layout: 'grid', blocks: gridBlocks },
    { kind: 'custom', id: 'layout-cards', title: '轻卡片内容', caption: 'layout=cards', layout: 'cards', blocks: cardsBlocks },
  ],
  checks: [{ id: 'check-layout', label: '四种布局顺序与内容完整', status: 'passed' }],
  note: '以上为前端验收 fixture，非真实业务数据。',
}, 'layouts.result')
export const layoutsBoard = boardFor(layoutsResult, 'completed', layoutsResult.title, completedSteps)

/* -------------------------------------------------------------------------------------------------
 * 4. Limits — every protocol array at its declared maximum
 * ----------------------------------------------------------------------------------------------- */

const limitMetricKinds = ['auto', 'comparison', 'value', 'status', 'target', 'text'] as const

function limitMetric(index: number): MetricInput {
  const kind = limitMetricKinds[index % limitMetricKinds.length]
  const base = { id: `limit-metric-${index + 1}`, kind, label: `极限指标 ${index + 1}`, value: String(10 + index), tone: index % 4 === 0 ? 'positive' as const : 'neutral' as const }
  if (kind === 'comparison' || kind === 'auto') return { ...base, unit: '次', previous: String(8 + index), change: index % 2 ? '+2' : '-1', trend: index % 2 ? 'up' as const : 'down' as const }
  if (kind === 'status') return { ...base, value: index % 2 ? '进行中' : '待复核' }
  if (kind === 'target') return { ...base, unit: '%', target: '95%', targetStatus: index % 3 ? 'met' as const : 'at-risk' as const, progress: 40 + index * 4 }
  if (kind === 'text') return { ...base, value: '文字型指标保留原始事实' }
  return { ...base, unit: '个' }
}

const limitArtifacts: ArtifactInput[] = range(8).map(index => {
  const kinds = ['document', 'image', 'link', 'data'] as const
  const kind = kinds[index % kinds.length]
  const id = `limit-artifact-${index + 1}`
  if (kind === 'document') return { id, kind, title: `交付文档 ${index + 1}`, change: 'added', versionId: `${id}-v1`, version: 'v1.0', mimeType: 'text/markdown', content: `# 交付文档 ${index + 1}\n\n用于验证 8 个 artifacts 的密度与顺序。` }
  if (kind === 'image') return { id, kind, title: `截图 ${index + 1}`, versionId: `${id}-v1`, version: 'v1.0', mimeType: 'image/png', url: index === 1 ? 'https://example.com/pawoffice/limit.png' : '' }
  if (kind === 'link') return { id, kind, title: `外链 ${index + 1}`, versionId: `${id}-v1`, version: 'v1.0', mimeType: 'text/html', url: index === 2 ? 'https://example.com/pawoffice/spec' : '' }
  return { id, kind, title: `数据 ${index + 1}`, versionId: `${id}-v1`, version: 'v1.0', mimeType: 'text/csv', content: `| 行 | 值 |\n| --- | --- |\n| ${index + 1} | ${index * 10} |` }
})

const limitBlocks: BlockInput[] = [
  { type: 'heading', text: '24 个区块', level: 'h3' },
  { type: 'text', text: '极限数量下每个 block 仍按顺序完整渲染。' },
  { type: 'keyValue', items: [{ label: 'block 数', value: '24' }] },
  { type: 'stats', items: [{ label: '区块', value: '24', unit: '个' }] },
  { type: 'table', columns: [{ key: 'n', label: '序号', format: 'number' }, { key: 'v', label: '值', format: 'number' }],
    rows: range(6).map(row => ({ n: String(row + 1), v: String((row + 1) * 10) })) },
  { type: 'list', items: [{ text: '第一项', status: 'passed' }, { text: '第二项', status: 'pending' }] },
  { type: 'progress', value: 90 },
  { type: 'chart', chart: 'line', series: [{ label: 'A', value: 4 }, { label: 'B', value: 8 }] },
  { type: 'image', url: '', alt: '极限占位' },
  { type: 'diagram', source: 'flowchart TD\n  A[开始] --> B[结束]' },
  { type: 'callout', tone: 'info', text: '极限区块保持完整。' },
  { type: 'divider' },
]
const limitBlockCycle: BlockInput[] = range(24).map(index => limitBlocks[index % limitBlocks.length])
const limitChanges: ChangeFileInput[] = range(24).map(index => {
  const statuses = ['modified', 'added', 'deleted', 'renamed'] as const
  const status = statuses[index % statuses.length]
  return {
    path: `src/module-${index + 1}/index.ts`, status,
    previousPath: status === 'renamed' ? `src/legacy-${index + 1}.ts` : '',
    added: index % 5, deleted: index % 3, binary: index === 7,
    diff: index < 5
      ? `--- a/src/module-${index + 1}/index.ts\n+++ b/src/module-${index + 1}/index.ts\n@@ -1,2 +1,2 @@\n-export const value = ${index}\n+export const value = ${index + 1}\n`
      : '',
  }
})

const limitSections: SectionInput[] = [
  {
    kind: 'gallery', id: 'limit-gallery', title: '8 张画廊', span: 'full',
    items: range(8).map(index => ({
      id: `limit-gallery-${index + 1}`, title: `页面 ${index + 1}`, meta: `视图 ${index + 1}`,
      status: (['done', 'active', 'pending'] as const)[index % 3],
      image: index < 2 ? `https://example.com/pawoffice/gallery-${index + 1}.png` : '',
    })),
  },
  {
    kind: 'documents', id: 'limit-documents', title: '8 份文档',
    items: range(8).map(index => ({
      id: `limit-document-${index + 1}`, artifactId: `limit-artifact-${index + 1}`,
      versionId: `limit-artifact-${index + 1}-v1`, title: `文档条目 ${index + 1}`, version: 'v1.0',
      at: '2026-11-11 09:00', status: (['done', 'active', 'pending'] as const)[index % 3],
    })),
  },
  {
    kind: 'tests', id: 'limit-tests', title: '12 项检查', progress: 66, progressLabel: '极限测试进度',
    metrics: [
      { id: 'limit-test-cases', label: '用例', value: '120', unit: '个' },
      { id: 'limit-test-rate', label: '通过率', value: '92', unit: '%', tone: 'positive' },
      { id: 'limit-test-failed', label: '失败', value: '3', unit: '项', tone: 'negative' },
      { id: 'limit-test-blocked', label: '阻塞', value: '1', unit: '项' },
    ],
    checks: range(12).map(index => ({
      id: `limit-test-check-${index + 1}`, label: `测试检查 ${index + 1}`,
      status: (['passed', 'pending', 'failed'] as const)[index % 3],
    })),
  },
  {
    kind: 'api', id: 'limit-api', title: '12 个接口',
    rows: range(12).map(index => ({
      id: `limit-api-${index + 1}`, endpoint: `/api/limit/resource-${index + 1}`,
      method: (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)[index % 5],
      status: (['done', 'active', 'pending'] as const)[index % 3], at: '2026-11-11 09:00',
    })),
  },
  {
    kind: 'environments', id: 'limit-environments', title: '8 个环境',
    items: range(8).map(index => ({
      id: `limit-env-${index + 1}`, name: `环境 ${index + 1}`,
      status: (['running', 'pending', 'stopped', 'failed'] as const)[index % 4],
      version: `v${index + 1}.0`, at: '2026-11-11 09:00',
    })),
  },
  {
    kind: 'files', id: 'limit-files', title: '12 个附件',
    items: range(12).map(index => ({
      id: `limit-file-${index + 1}`, name: `附件 ${index + 1}.dat`,
      kind: (['image', 'document', 'report', 'archive', 'other'] as const)[index % 5],
      size: `${index + 1} KB`, url: index % 3 === 0 ? `https://example.com/pawoffice/file-${index + 1}` : '',
    })),
  },
  { kind: 'changes', id: 'limit-changes', title: '24 个文件变更', span: 'full', files: limitChanges },
  { kind: 'custom', id: 'limit-custom', title: '24 个区块', layout: 'grid', span: 'full', blocks: limitBlockCycle },
]

export const limitsResult = checkedResult({
  template: 'result-v1', runId: 'run-limits', title: '极限数据密度验收', status: 'ready',
  summary: 'metrics 12、artifacts 8、sections 8、custom blocks 24、checks 12、tasks 12、changes 24 files、gallery 8 items、files 12 items。',
  verdict: '前端验收 fixture：用于验证极限数量下不溢出、不丢项。',
  owner: '验收夹具', team: 'P9 验收组', teamSize: 4,
  producedAt: '2026-11-11T12:00:00+08:00', updatedAt: '2026-11-11T12:30:00+08:00',
  metricsTitle: '极限指标密度', metricsCaption: '12 项紧凑多列数据行',
  metrics: range(12).map(limitMetric),
  artifacts: limitArtifacts, sections: limitSections,
  checks: range(12).map(index => ({
    id: `limit-check-${index + 1}`, label: `验收检查 ${index + 1}`,
    status: (['passed', 'pending', 'failed'] as const)[index % 3],
    ...(index === 0 ? { artifactId: 'limit-artifact-1', versionId: 'limit-artifact-1-v0' } : {}),
  })),
  risks: range(8).map(index => ({
    id: `limit-risk-${index + 1}`, title: `风险记录 ${index + 1}`,
    level: (['high', 'medium', 'low'] as const)[index % 3],
    status: (['open', 'mitigating', 'closed'] as const)[index % 3],
    owner: `负责人 ${index + 1}`, note: '极限数量下的风险记录。',
  })),
  tasks: range(12).map(index => ({
    id: `limit-task-${index + 1}`, title: `工作任务 ${index + 1}`, owner: `负责人 ${index + 1}`,
    status: (['todo', 'doing', 'blocked', 'done'] as const)[index % 4], progress: (index * 8) % 101,
  })),
  versions: range(8).map(index => ({
    id: `limit-version-${index + 1}`, version: `第 ${index + 1} 轮交付`, note: '极限版本记录。',
    at: '2026-11-11 09:00', author: '王明',
    status: (['draft', 'released', 'rolled-back'] as const)[index % 3],
  })),
  decisions: range(8).map(index => ({
    id: `limit-decision-${index + 1}`, question: `决策问题 ${index + 1}？`,
    choice: `决策结论 ${index + 1}`, at: '2026-11-11',
  })),
  next: range(8).map(index => `后续行动 ${index + 1}：按顺序完整展示。`),
  note: '以上为前端验收 fixture，非真实业务数据。',
}, 'limits.result')
export const limitsBoard = boardFor(limitsResult, 'completed', limitsResult.title, completedSteps)

/* -------------------------------------------------------------------------------------------------
 * 5. Presentation states — all ten existing `resultPresentation` states
 * ----------------------------------------------------------------------------------------------- */

export const presentationKeys = [
  'draft', 'ready', 'verified', 'rejected', 'conflict', 'producing', 'blocked', 'failed', 'missing', 'empty',
] as const
export type ResultPresentationKey = typeof presentationKeys[number]

type StateFixture = {
  key: ResultPresentationKey; label: string; board: WhiteboardTaskBoardData; result: OfficeResult
}

function stateFixture(key: ResultPresentationKey, label: string, result: OfficeResult, status: BoardStatus, steps: WhiteboardTaskBoardData['steps']): StateFixture {
  const board = boardFor(result, status, result.title || `成果状态：${label}`, steps)
  const presentation = resultPresentation(board, result)
  if (presentation.key !== key) throw new Error(`[dev fixture] 状态 ${key} 实际解析为 ${presentation.key}（${presentation.label}）`)
  return { key, label, board, result }
}

const minimalResult = (status: OfficeResult['status'], extra: Partial<OfficeResultInput> = {}) => checkedResult({
  title: `成果状态验收 · ${status}`, status, summary: '状态验收 fixture 的成果摘要。', ...extra,
}, `state.${status}`)

const emptyBoardResult = () => emptyResult()

export const resultBoardStates: Record<ResultPresentationKey, StateFixture> = {
  draft: stateFixture('draft', '草稿', minimalResult('draft'), 'running', runningSteps),
  ready: stateFixture('ready', '已交付', minimalResult('ready'), 'completed', completedSteps),
  verified: stateFixture('verified', '已验证', minimalResult('verified', { verdict: '验收通过。' }), 'completed', completedSteps),
  rejected: stateFixture('rejected', '未通过', minimalResult('rejected', { verdict: '验收未通过：缺少退款数据。' }), 'completed', completedSteps),
  conflict: stateFixture('conflict', '验证待核对', minimalResult('verified', {
    verdict: '后端标记已验证，但检查存在失效项。',
    checks: [
      { id: 'conflict-stale', label: '需求范围检查', status: 'passed', artifactId: 'prd', versionId: 'prd-v1' },
      { id: 'conflict-failed', label: '异常路径回归', status: 'failed' },
    ],
  }), 'completed', completedSteps),
  producing: stateFixture('producing', '正在产出', emptyBoardResult(), 'running', runningSteps),
  blocked: stateFixture('blocked', '产出受阻', emptyBoardResult(), 'blocked', blockedSteps),
  failed: stateFixture('failed', '尚无成果', emptyBoardResult(), 'failed', blockedSteps),
  missing: stateFixture('missing', '尚未交付', emptyBoardResult(), 'completed', completedSteps),
  empty: stateFixture('empty', '暂无成果', emptyBoardResult(), 'queued', []),
}

/* -------------------------------------------------------------------------------------------------
 * Fixture catalogue consumed by the dev preview page
 * ----------------------------------------------------------------------------------------------- */

export type ResultBoardFixtureName = 'sample' | 'history' | 'matrix' | 'layouts' | 'limits'

export type ResultBoardFixture = {
  name: ResultBoardFixtureName
  title: string
  dataSource: 'real-sample' | 'real-sample-history' | 'frontend-fixture'
  note: string
  board: WhiteboardTaskBoardData
  result: OfficeResult
}

export const resultBoardFixtures: Record<ResultBoardFixtureName, ResultBoardFixture> = {
  sample: {
    name: 'sample', title: '真实样例 · 登录模块交付成果', dataSource: 'real-sample',
    note: '用户真实样例 result-ready-round3.json（逐字节复制）。样例只有 result 对象，board 不带 status。',
    board: sampleBoard, result: sampleResult,
  },
  history: {
    name: 'history', title: '真实样例 · 历史交付与版本对比', dataSource: 'real-sample-history',
    note: '用户真实样例 whiteboard-ready-round3.json（逐字节复制）。board 含 status 与 3 个 deliveries，用于历史交付切换、文件版本选择与对比。',
    board: historyBoard, result: historyResult,
  },
  matrix: {
    name: 'matrix', title: '全类型矩阵（前端验收 fixture）', dataSource: 'frontend-fixture',
    note: '6 metric / 4 artifact / 8 section / 12 block / 全部业务记录类型。',
    board: matrixBoard, result: matrixResult,
  },
  layouts: {
    name: 'layouts', title: '自定义布局（前端验收 fixture）', dataSource: 'frontend-fixture',
    note: 'custom 四种 layout：stack / columns / grid / cards。',
    board: layoutsBoard, result: layoutsResult,
  },
  limits: {
    name: 'limits', title: '极限数量（前端验收 fixture）', dataSource: 'frontend-fixture',
    note: '所有数组取协议上限，验证不溢出、不丢项。',
    board: limitsBoard, result: limitsResult,
  },
}

export const resultBoardFixtureNames = ['sample', 'history', 'matrix', 'layouts', 'limits'] as const
