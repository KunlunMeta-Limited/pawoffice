import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTestServer } from './helpers/vite.mjs'

let server, schema, resultSchema, ResultWorkspace, ResultReader, format, preview, cases, createResultDemoBoard

before(async () => {
  server = await createTestServer()
  ;({ whiteboardTaskBoardSchema: schema, officeResultSchema: resultSchema } = await server.ssrLoadModule('/packages/protocol/src/office-ui.ts'))
  ;({ ResultWorkspace } = await server.ssrLoadModule('/apps/web/src/components/ResultWorkspace.tsx'))
  ;({ ResultReader } = await server.ssrLoadModule('/apps/web/src/components/ResultReader.tsx'))
  ;({ createResultDemoBoard } = await server.ssrLoadModule('/apps/web/src/dashboard/resultDemo.ts'))
  format = await server.ssrLoadModule('/apps/web/src/results/format.ts')
  preview = await server.ssrLoadModule('/apps/web/src/dev/resultPreviewData.ts')
  cases = preview.parseResultPreviewPayload(JSON.parse(await readFile(new URL('../apps/web/src/dev/mock/result-preview.json', import.meta.url), 'utf8')))
})
after(() => server?.close())

const workspaceResult = () => resultSchema.parse({
  template: 'result-v1',
  title: '登录模块开发',
  status: 'ready',
  summary: '登录、注册、找回密码核心功能已完成开发，测试通过率 96%。',
  verdict: '主流程与异常场景已通过测试，3 个缺陷待修复后进入生产发布。',
  owner: '王明',
  team: '前端组',
  teamSize: 3,
  producedAt: '2024-06-20 14:30',
  updatedAt: '2024-06-20 14:30',
  metrics: [{ id: 'cases', label: '用例总数', value: '86', unit: '个', kind: 'value' }],
  artifacts: [{ id: 'prd', kind: 'document', title: '登录模块 PRD', content: '## 已确认\n\n双通道登录。' }],
  checks: [{ id: 'flow', label: '主流程可用', status: 'passed' }],
  decisions: [{ id: 'sms', question: '是否采用短信验证码登录？', choice: '采用短信验证码 + 密码双通道', at: '06-12 10:00' }],
  sections: [
    { kind: 'gallery', id: 'pages', title: '页面原型 / 页面预览', caption: '查看全部 →', items: [
      { id: 'login', title: '登录页原型', meta: '登录页', status: 'done' },
      { id: 'reset', title: '忘记密码页原型', meta: '忘记密码', status: 'active' },
    ] },
    { kind: 'documents', id: 'documents', title: '产品文档', caption: '查看全部 →', items: [
      { id: 'prd', title: '登录模块 PRD', version: 'v1.2', at: '2024-06-10', status: 'done' },
      { id: 'acceptance', title: '验收标准', version: 'v1.0', at: '2024-06-08', status: 'active' },
    ] },
    { kind: 'tests', id: 'tests', title: '测试与验收', caption: '查看详情 →', metrics: [
      { id: 'cases', label: '用例总数', value: '86', unit: '个' },
      { id: 'pass', label: '通过率', value: '96', unit: '%', tone: 'positive' },
      { id: 'defects', label: '缺陷数', value: '3', unit: '个', tone: 'negative' },
    ], progress: 96, progressLabel: '测试进度', checks: [
      { id: 'login', label: '登录功能测试', status: 'passed' },
      { id: 'interaction', label: '界面交互验收', status: 'pending' },
    ] },
    { kind: 'api', id: 'api', title: '接口交付', caption: '查看全部 →', rows: [
      { id: 'login', endpoint: '/login', method: 'POST', status: 'done', at: '06-18 10:20' },
      { id: 'send', endpoint: '/send-code', method: 'POST', status: 'active', at: '06-20 14:10' },
    ] },
    { kind: 'environments', id: 'deployments', title: '部署与发布', caption: '查看详情 →', items: [
      { id: 'dev', name: '开发环境', status: 'running', version: 'v1.2.0', at: '06-18 10:20' },
      { id: 'prod', name: '生产环境', status: 'pending', version: 'v1.2.0' },
    ] },
    { kind: 'files', id: 'files', title: '文件与附件', caption: '上传文件 →', items: [
      { id: 'design', name: '登录页设计稿', kind: 'image', size: '12.5 MB' },
      { id: 'report', name: '测试报告', kind: 'report', size: '1.8 MB' },
    ] },
  ],
  tasks: [
    { id: 'login-page', title: '登录页开发', owner: '王明', status: 'doing', progress: 80 },
    { id: 'release', title: '生产环境灰度发布', owner: '张曦', status: 'blocked', note: '等待运维审批' },
  ],
  versions: [
    { id: 'v12', version: 'v1.2', note: '找回密码与个人中心', author: '王明', at: '06-20', status: 'released' },
  ],
  risks: [
    { id: 'sms', title: '生产环境依赖第三方短信服务，尚未完成压力验证', level: 'high', status: 'open', owner: '周理', note: '发布前补充压测与降级方案' },
  ],
  next: ['完成 /send-code 接口开发与联调。'],
  note: '以上为本地模拟数据，不连接真实账号服务。',
})

const board = (result) => schema.parse({
  template: 'task-board-v1',
  title: '登录模块开发',
  status: 'running',
  tagline: '前端组 · 登录与认证',
  summary: '完成登录、注册、找回密码等核心功能的开发与上线。',
  steps: [
    { id: 'plan', title: '登录与方案', progress: 99, state: 'done' },
    { id: 'develop', title: '功能开发', progress: 90, state: 'active' },
    { id: 'verify', title: '测试与审查', progress: 75, state: 'pending' },
  ],
  result,
})
const renderWorkspace = (result = workspaceResult(), taskBoard = board(result)) => renderToStaticMarkup(createElement(ResultWorkspace, { board: taskBoard, result }))

test('workspace fields are optional, null-free and bounded on result-v1', () => {
  const empty = resultSchema.parse({})
  assert.deepEqual(empty.sections, [])
  assert.deepEqual(empty.tasks, [])
  assert.deepEqual(empty.versions, [])
  assert.deepEqual(empty.risks, [])
  assert.equal(empty.team, '')
  assert.equal(empty.teamSize, undefined)
  assert.equal(empty.updatedAt, '')
  assert.equal(resultSchema.safeParse({ sections: null }).success, false)
  assert.equal(resultSchema.safeParse({ teamSize: -1 }).success, false)
  assert.equal(resultSchema.safeParse({ teamSize: 1.5 }).success, false)
  assert.equal(resultSchema.safeParse({ team: null }).success, false)
  const many = Array.from({ length: 9 }, (_, index) => ({ kind: 'documents', id: `doc-${index}`, title: '文档', items: [{ id: 'one', title: '文档' }] }))
  assert.equal(resultSchema.safeParse({ sections: many }).success, false, 'at most 8 sections')
  assert.equal(resultSchema.safeParse({ sections: [{ kind: 'documents', id: 'doc', title: '文档', items: [] }] }).success, false, 'a section needs items')
  assert.equal(resultSchema.safeParse({ sections: [{ kind: 'unknown', id: 'block', title: '未知', items: [] }] }).success, false)
})

test('every section kind validates its own semantic fields', () => {
  const parsed = resultSchema.parse({ sections: workspaceResult().sections })
  assert.deepEqual(parsed.sections.map(section => section.kind), ['gallery', 'documents', 'tests', 'api', 'environments', 'files'])
  const invalid = [
    { kind: 'gallery', id: 'g', title: '页面', items: [{ id: 'item', title: '页面', status: 'almost' }] },
    { kind: 'documents', id: 'd', title: '文档', items: [{ id: 'item', title: '文档', url: 'https://example.com' }] },
    { kind: 'tests', id: 't', title: '测试', metrics: [{ id: 'm', label: '总数', value: '1' }], progress: 101 },
    { kind: 'api', id: 'a', title: '接口', rows: [{ id: 'r', endpoint: '/login', method: 'post' }] },
    { kind: 'environments', id: 'e', title: '部署', items: [{ id: 'i', name: '生产', status: 'deploying' }] },
    { kind: 'files', id: 'f', title: '文件', items: [{ id: 'i', name: '设计稿', kind: 'zip' }] },
  ]
  for (const section of invalid) assert.equal(resultSchema.safeParse({ sections: [section] }).success, false, JSON.stringify(section))
  assert.equal(resultSchema.safeParse({ sections: [{ kind: 'gallery', id: 'g', title: '页面', items: [{ id: 'i', title: '页面', image: 'javascript:alert(1)' }] }] }).success, false)
  assert.equal(resultSchema.safeParse({ sections: [{ kind: 'gallery', id: 'g', title: '页面', items: [{ id: 'i', title: '页面', unknown: 'x' }] }] }).success, false)
  assert.equal(resultSchema.safeParse({ sections: [{ kind: 'documents', id: 'd', title: '文档', items: [{ id: 'i', title: '文档' }], layout: 'left' }] }).success, false, 'layout is the reader decision, not backend data')
})

test('resultHasWorkspace only opens the task-detail workspace for workspace data', () => {
  assert.equal(format.resultHasWorkspace(resultSchema.parse({})), false)
  assert.equal(format.resultHasWorkspace(workspaceResult()), true)
  assert.equal(format.resultHasWorkspace(resultSchema.parse({ metrics: [{ id: 'm', label: '指标', value: '1' }] })), false)
  assert.equal(format.resultHasWorkspace(resultSchema.parse({ tasks: [{ id: 't', title: '任务' }] })), true)
  assert.equal(format.resultHasWorkspace(undefined), false)
  assert.equal(format.resultTeamLabel(workspaceResult()), '前端组（3人）')
  assert.equal(format.resultTeamLabel(resultSchema.parse({ team: '前端组' })), '前端组')
  assert.equal(format.resultTeamLabel(resultSchema.parse({})), '')
})

test('stage steps prefer the backend state and fall back to progress', () => {
  const explicit = renderWorkspace()
  assert(explicit.includes('data-state="done"'), 'explicit done state wins over 99% progress')
  assert(explicit.includes('data-state="active"'))
  assert(explicit.includes('data-state="pending"'))
  const derived = schema.parse({
    template: 'task-board-v1', title: '任务', status: 'running',
    steps: [{ id: 'one', title: '第一步', progress: 100 }, { id: 'two', title: '第二步', progress: 40 }, { id: 'three', title: '第三步', progress: 0 }],
  })
  const derivedHtml = renderWorkspace(resultSchema.parse({ sections: workspaceResult().sections }), derived)
  assert(derivedHtml.includes('data-state="done"'))
  assert(derivedHtml.includes('data-state="active"'))
  assert(derivedHtml.includes('data-state="pending"'))
  for (const status of ['blocked', 'failed', 'completed']) {
    const stopped = renderWorkspace(resultSchema.parse({}), { ...derived, status })
    assert(!stopped.includes('class="result-workspace-stage-step" data-state="active"'), `${status} must not invent an active stage`)
  }
  assert.equal(schema.safeParse({ template: 'task-board-v1', title: '任务', steps: [{ id: 's', title: '阶段', state: 'almost' }] }).success, false)
  assert.equal(schema.parse({ template: 'task-board-v1', title: '任务', steps: [{ id: 's', title: '阶段', progress: 100 }] }).steps[0].state, undefined)
})

test('the task-detail workspace renders its header, tabs and semantic sections', () => {
  const html = renderWorkspace()
  for (const text of ['登录模块开发', '执行中', '王明', '前端组（3人）', '2024-06-20 14:30',
    '概览', '交付物', '过程记录', '任务明细', '版本记录', '风险与备注',
    '登录与方案', '功能开发', '测试与审查',
    '页面原型 / 页面预览', '产品文档', '测试与验收', '接口交付', '部署与发布', '文件与附件',
    '/login', 'POST', '已完成', '06-18 10:20', '/send-code', '开发中',
    '86', '96', '测试进度', '登录功能测试', '待补充',
    '开发环境', '运行中', '生产环境', '待发布', 'v1.2.0',
    '登录页设计稿', '12.5 MB', '测试报告', '1.8 MB',
    '忘记密码页原型', '验收标准']) {
    assert(html.includes(text), text)
  }
  assert(html.includes('role="tablist"'))
  assert(html.includes('aria-selected="true"'))
  assert(html.includes('role="progressbar"'))
  assert(html.includes('data-kind="gallery"'))
  assert(html.includes('data-kind="files"'))
  assert(html.includes('role="tabpanel"'))
  for (const section of workspaceResult().sections) assert(html.includes(`data-kind="${section.kind}"`), section.kind)
})

test('navigation stays stable while optional process sections follow the available data', () => {
  const sectionsOnly = resultSchema.parse({ sections: workspaceResult().sections })
  const html = renderWorkspace(sectionsOnly)
  assert(html.includes('交付物'))
  assert(!html.includes('任务明细'))
  assert(!html.includes('版本记录'))
  assert(!html.includes('风险与备注'))
  const tabsOnly = resultSchema.parse({ versions: workspaceResult().versions, risks: workspaceResult().risks })
  const tabbed = renderWorkspace(tabsOnly)
  assert(tabbed.includes('版本记录'))
  assert(tabbed.includes('风险与备注'))
  assert(tabbed.includes('交付物'))
  assert(tabbed.includes('当前没有可查看的交付物'))
  assert(!tabbed.includes('任务明细'))
})

test('workspace text is escaped and rendered as text, never as markup', () => {
  const hostile = resultSchema.parse({
    sections: [{ kind: 'documents', id: 'doc', title: '<img src=x onerror=alert(1)>', items: [{ id: 'item', title: '<script>alert(2)</script>' }] }],
    tasks: [{ id: 'task', title: '<b>注入</b>', owner: '" onmouseover="alert(3)' }],
  })
  const html = renderWorkspace(hostile)
  assert(!html.includes('<img src=x'))
  assert(!html.includes('<script>alert(2)'))
  assert(html.includes('&lt;img src=x'))
  assert(html.includes('&lt;script&gt;'))
})

test('legacy results keep the compact reader and never grow workspace-only sections', () => {
  const legacy = workspaceResult()
  legacy.sections = []
  legacy.tasks = []
  legacy.versions = []
  legacy.risks = []
  const compact = renderToStaticMarkup(createElement(ResultReader, { result: legacy }))
  assert(compact.includes('result-conclusion'))
  assert(!compact.includes('任务详情'))
  const demo = createResultDemoBoard('verified').result
  assert.equal(format.resultHasWorkspace(demo), false)
})

test('the login mock case drives the workspace end to end', () => {
  const login = cases.find(item => item.id === 'login-module')
  assert(login, 'login-module mock case exists')
  assert.equal(login.board.title, '登录模块开发')
  assert.equal(login.board.status, 'running')
  assert.equal(login.result.team, '前端组')
  assert.equal(login.result.teamSize, 3)
  assert.deepEqual(login.result.sections.map(section => section.kind), ['changes', 'gallery', 'documents', 'tests', 'api', 'environments', 'files'])
  assert.equal(login.result.tasks.length >= 6, true)
  assert.equal(login.result.versions.length, 3)
  assert.equal(login.result.risks.length, 3)
  const html = renderWorkspace(login.result)
  for (const text of ['登录模块开发', '执行中', '王明', '前端组（3人）', '页面原型 / 页面预览', '接口交付', '部署与发布', '文件与附件']) {
    assert(html.includes(text), text)
  }
  assert.equal(format.resultHasWorkspace(login.result), true)
})

test('the workspace report exports sections, tasks, versions and risks as Markdown', () => {
  const result = workspaceResult()
  const report = format.resultReport(result)
  assert(report.includes('## 交付成果'))
  assert(report.includes('### 页面原型 / 页面预览'))
  assert(report.includes('### 接口交付'))
  assert(report.includes('| /login | POST | 已完成 | 06-18 10:20 |'))
  assert(report.includes('## 任务明细'))
  assert(report.includes('- [ ] 登录页开发 · 王明 · 进行中（80%）'))
  assert(report.includes('## 版本记录'))
  assert(report.includes('**v1.2** 找回密码与个人中心'))
  assert(report.includes('## 风险与备注'))
  assert(report.includes('[高] 生产环境依赖第三方短信服务'))
  assert(report.includes('团队：前端组（3人）'), 'report header carries the team')
  assert(format.resultSummaryText(result).includes('团队：前端组（3人）'))
})

const customResult = () => resultSchema.parse({
  title: '安全审查',
  summary: '原语组合演示',
  sections: [{
    kind: 'custom',
    id: 'custom',
    title: '自定义摘要',
    span: 'full',
    column: 'aside',
    layout: 'grid',
    blocks: [
      { type: 'heading', text: '审查结论', level: 'h2' },
      { type: 'text', text: '## Markdown 标题\n\n这是 **加粗** 文本。' },
      { type: 'keyValue', label: '信息', items: [{ label: '范围', value: '认证 / 授权' }] },
      { type: 'stats', label: '问题分布', items: [{ label: '高危', value: '0', unit: '个', tone: 'positive' }] },
      { type: 'table', columns: [{ key: 'issue', label: '问题' }, { key: 'level', label: '等级', format: 'status' }], rows: [{ issue: '验证码可重放', level: 'medium' }] },
      { type: 'list', label: '下一步', ordered: true, items: [{ text: '关闭中危问题', status: 'pending' }] },
      { type: 'progress', label: '修复进度', value: 66 },
      { type: 'chart', label: '问题分布', chart: 'bar', unit: '个', series: [{ label: '登录', value: 3, tone: 'negative' }] },
      { type: 'image', alt: '认证链路架构图' },
      { type: 'diagram', alt: '认证链路图', caption: '登录流程图', source: 'flowchart LR\n  A[登录] --> B[发布]' },
      { type: 'callout', tone: 'warning', title: '发布前必须关闭', text: '中危问题需在发布前关闭。' },
      { type: 'divider' },
    ],
  }, {
    kind: 'custom',
    id: 'notes',
    title: '补充说明',
    column: 'aside',
    blocks: [{ type: 'callout', tone: 'info', text: '低危问题不阻塞发布。' }],
  }],
})

test('custom sections compose the primitive catalogue without a new component per business case', () => {
  const html = renderWorkspace(customResult())
  for (const text of ['自定义摘要', '审查结论', 'Markdown 标题', '加粗', '范围', '认证 / 授权', '高危', '验证码可重放',
    '关闭中危问题', '修复进度', '66%', '发布前必须关闭', '认证链路架构图', '认证链路图']) {
    assert(html.includes(text), text)
  }
  assert(html.includes('data-kind="custom"'))
  assert(html.includes('data-span="full"'))
  assert(html.includes('data-column="aside"'))
  assert(html.includes('result-blocks result-blocks-grid'))
  assert(html.includes('<table'))
  assert(html.includes('<ol'))
  assert(html.includes('role="progressbar"'))
  assert(html.includes('role="img"'))
  assert(html.includes('aria-label="问题分布'))
  assert(html.includes('<hr'))
  // SSR renders the Mermaid source as a placeholder; the browser replaces it after mount.
  assert(html.includes('data-block-type="diagram"'))
  assert(html.includes('mermaid-placeholder'))
  assert(html.includes('flowchart LR'))
  assert(html.includes('A[登录] --&gt; B[发布]'))
})

test('file changes group new and edited files and flow full width', () => {
  const result = resultSchema.parse({ sections: [{
    kind: 'changes', id: 'changes', title: '文件变更', files: [
      { path: 'src/a.ts', status: 'added', added: 12 },
      { path: 'src/b.ts', status: 'modified', added: 3, deleted: 9 },
      { path: 'src/c.png', status: 'added', binary: true },
      { path: 'src/d.ts', status: 'deleted', deleted: 4 },
    ],
  }] })
  const html = renderWorkspace(result)
  assert(html.includes('data-kind="changes"'))
  assert(html.includes('已编辑 4 个文件'))
  assert(html.includes('新增文件'))
  assert(html.includes('修改文件'))
  assert(html.includes('删除文件'))
  assert(html.includes('src/a.ts'))
  assert(html.includes('+12'))
  assert(html.includes('-9'))
  assert(html.includes('二进制'))
  assert(!html.includes('result-workspace-row'), 'sections no longer pair into left/right rows')
})

test('changes sections validate status, counts and limits', () => {
  const parsed = resultSchema.parse({ sections: [{
    kind: 'changes', id: 'changes', title: '文件变更', files: [{ path: 'src/a.ts' }],
  }] })
  const section = parsed.sections[0]
  assert.equal(section.kind, 'changes')
  assert.equal(section.files[0].status, 'modified')
  assert.equal(section.files[0].added, 0)
  assert.equal(section.files[0].binary, false)
  assert.equal(section.files[0].previousPath, '')
  const files = Array.from({ length: 25 }, (_, index) => ({ path: `src/${index}.ts` }))
  const invalid = [
    { sections: [{ kind: 'changes', id: 'c', title: '变更', files: [] }] },
    { sections: [{ kind: 'changes', id: 'c', title: '变更', files }] },
    { sections: [{ kind: 'changes', id: 'c', title: '变更', files: [{ path: '' }] }] },
    { sections: [{ kind: 'changes', id: 'c', title: '变更', files: [{ path: 'a', status: 'copied' }] }] },
    { sections: [{ kind: 'changes', id: 'c', title: '变更', files: [{ path: 'a', added: -1 }] }] },
    { sections: [{ kind: 'changes', id: 'c', title: '变更', files: [{ path: 'a', extra: true }] }] },
  ]
  for (const value of invalid) assert.equal(resultSchema.safeParse(value).success, false, JSON.stringify(value).slice(0, 90))
})

test('custom sections and layout tokens validate strictly', () => {
  const parsed = resultSchema.parse({ sections: [{ kind: 'custom', id: 'c', title: '自定义', blocks: [{ type: 'divider' }] }] })
  const custom = parsed.sections[0]
  assert.equal(custom.span, 'half')
  assert.equal(custom.column, 'auto')
  assert.equal(custom.emphasis, 'normal')
  assert.equal(custom.layout, 'stack')
  assert.equal(custom.blocks.length, 1)
  const preset = resultSchema.parse({ sections: [{ kind: 'documents', id: 'd', title: '文档', items: [{ id: 'i', title: '文档' }] }] }).sections[0]
  assert.equal(preset.span, 'half')
  assert.equal(preset.column, 'auto')
  assert.equal(preset.emphasis, 'normal')
  const invalid = [
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', blocks: [] }] },
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', blocks: [{ type: 'unknown' }] }] },
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', layout: 'masonry', blocks: [{ type: 'divider' }] }] },
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', blocks: Array.from({ length: 25 }, () => ({ type: 'divider' })) }] },
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', span: 'wide', blocks: [{ type: 'divider' }] }] },
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', blocks: [{ type: 'chart', series: [] }] }] },
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', blocks: [{ type: 'table', columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }] }] }] },
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', blocks: [{ type: 'diagram', source: '' }] }] },
    { sections: [{ kind: 'custom', id: 'c', title: '自定义', blocks: [{ type: 'diagram', source: 'x'.repeat(8001) }] }] },
  ]
  for (const value of invalid) assert.equal(resultSchema.safeParse(value).success, false, JSON.stringify(value).slice(0, 90))
})

test('the security-audit mock case demonstrates composed primitives end to end', () => {
  const audit = cases.find(item => item.id === 'security-audit')
  assert(audit, 'security-audit mock case exists')
  assert.equal(audit.result.sections.length, 7)
  assert.deepEqual(audit.result.sections.map(section => section.kind), ['custom', 'custom', 'changes', 'custom', 'custom', 'documents', 'tests'])
  const blockTypes = new Set(audit.result.sections.filter(section => section.kind === 'custom').flatMap(section => section.blocks.map(block => block.type)))
  for (const type of ['text', 'stats', 'callout', 'keyValue', 'table', 'progress', 'list', 'chart', 'image', 'diagram', 'divider']) assert(blockTypes.has(type), type)
  const html = renderWorkspace(audit.result)
  for (const text of ['审查概览', '认证链路', '文件变更', '问题清单', '风险分布', '审查文档', '回归验证', '验证码可重放', '发布前必须关闭', '修复进度']) {
    assert(html.includes(text), text)
  }
  assert(html.includes('已编辑 8 个文件'))
  assert(html.includes('+762'))
  assert(html.includes('-181'))
  assert(html.includes('WhiteboardDetail.css'))
  assert(html.includes('mermaid-placeholder'))
  assert(html.includes('flowchart LR'))
  assert.equal(format.resultHasWorkspace(audit.result), true)
  const report = format.resultReport(audit.result)
  assert(report.includes('### 审查概览'))
  assert(report.includes('### 文件变更'))
  assert(report.includes('| 新增 | apps/web/src/components/WhiteboardDetail.css | +49 | -0 |'))
  assert(report.includes('| 验证码可重放 |'))
  assert(report.includes('- 修复进度：66%'))
  assert(report.includes('问题按链路分布'))
  assert(report.includes('```mermaid'))
})

