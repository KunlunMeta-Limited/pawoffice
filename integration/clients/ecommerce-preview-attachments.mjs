const budgetCode = `// 青禾桌面：预算一致性核对示例
// 仅供阅读，不在浏览器中执行。
type BudgetStage = {
  label: string
  days: number
  dailyCap: number
}

const stages: BudgetStage[] = [
  { label: '首轮观察', days: 3, dailyCap: 120 },
  { label: '优化期', days: 7, dailyCap: 140 },
  { label: '收尾期', days: 4, dailyCap: 115 },
]

export function checkBudget(limit: number) {
  const planned = stages.reduce(
    (total, stage) => total + stage.days * stage.dailyCap,
    0,
  )

  if (planned > limit) {
    return { passed: false, reason: '预算超过约定上限' }
  }

  const spent = 360
  const remaining = limit - spent

  return {
    passed: true,
    planned,
    spent,
    remaining,
    requiresMerchantAuthorization: true,
  }
}
`

const config = budget => JSON.stringify({
  shop: '青禾桌面', sku: '000079', budget,
  campaign: { channel: '淘宝搜索', days: 14, autoPublish: false, dailyCaps: [120, 140, 115] },
  review: { parameterEvidence: null, merchantAuthorized: false, notes: ['等待真实图片', '等待实测尺寸与承重'] },
  referenceOrder: '__exact_integer__',
}, null, 2).replace('"__exact_integer__"', '123456789012345678901')

const escapeCsv = value => `"${String(value).replaceAll('"', '""')}"`
const observations = ['记录编号,关键词,点击,有效订单,备注', ...Array.from({ length: 65 }, (_, i) => [
  String(i + 1).padStart(5, '0'), ['折叠电脑支架', '铝合金支架', '便携收纳'][i % 3], 10 + i, i % 4,
  i === 0 ? '客户反馈：轻便,易收纳\n需要补充尺寸图' : i === 1 ? '客户说"桌面更整洁"' : '模拟观察记录',
].map(escapeCsv).join(','))].join('\r\n') + '\r\n'

export function createEcommerceAttachments(artifact) {
  const oldRun = 'attachments-delivery-1', run = 'attachments-delivery-2'
  const csv = { ...artifact('attachments-observations', 'attachments-observations-v1', '搜索词观察明细.csv', observations, oldRun, 'text/csv'), kind: 'data' }
  const code = artifact('attachments-code', 'attachments-code-v1', '预算核对示例.ts', budgetCode, oldRun, 'text/typescript')
  const oldConfig = artifact('attachments-config', 'attachments-config-v1', '上市配置.json', config(3000), oldRun, 'application/json')
  const nextConfig = { ...artifact('attachments-config', 'attachments-config-v2', '上市配置.json', config(1800), run, 'application/json'), change: 'updated' }
  const result = { title: '上市技术附件 · 阅读与核对', status: 'ready', summary: '提供预算核对代码、65条模拟搜索词记录和上市配置，用于核对代码、表格、JSON及版本差异的阅读效果。',
    artifacts: [nextConfig, { ...csv, change: 'unchanged' }, { ...code, change: 'unchanged' }],
    sections: [{ kind: 'custom', purpose: 'analysis', id: 'attachments-notes', title: '使用说明与代码片段', span: 'full', blocks: [{ type: 'text', text: '这些附件均为模拟数据，代码不会在浏览器中执行。CSV含编号前导零、逗号、引号与跨行备注，可用搜索与分页检查。JSON含嵌套、空值和大整数，源文与下载保留原始内容。\n\n```typescript\nconst budget = 1800\nconst spent = 360\nconst remaining = budget - spent\n```\n\n```mermaid\nflowchart LR\n A[业务后端提供版本正文] --> B[成果页预览]\n B --> C[下载该版本原件]\n```' }] }],
    note: '此会话用于固定附件预览。五轮业务工作流请切回“79元折叠支架上市准备”。' }
  return { id: 'attachments', title: '成果预览 · 代码 / CSV / JSON', whiteboard: { title: result.title, status: 'completed', result: { ...result, runId: run }, deliveries: [
    { id: oldRun, sequence: 1, title: '首版技术附件', createdAt: code.producedAt, result: { runId: oldRun, title: result.title, status: 'ready', artifacts: [oldConfig, csv, code] } },
    { id: run, sequence: 2, title: '配置预算调整', createdAt: nextConfig.producedAt, result: { runId: run, title: result.title, status: 'ready', artifacts: [nextConfig] } },
  ] } }
}
