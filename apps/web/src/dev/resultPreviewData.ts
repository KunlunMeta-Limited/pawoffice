import { officeResultSchema, whiteboardTaskBoardSchema } from '@pawoffice/protocol/office-ui'
import type { OfficeResult, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { createResultDemo, createResultDemoBoard } from '../dashboard/resultDemo.ts'

const board = (value: unknown): WhiteboardTaskBoardData => whiteboardTaskBoardSchema.parse(value)
const result = (value: unknown): OfficeResult => officeResultSchema.parse(value)

const operationsResult = result({
  ...createResultDemo('verified'),
  metrics: createResultDemo('verified').metrics.map(metric => metric.id === 'orders' ? { ...metric, emphasis: 'primary' } : metric),
  metricsTitle: '关键指标',
  metricsCaption: '首轮观察 → 更新后观察',
})

const operationsBoard = board({ ...createResultDemoBoard('verified'), result: operationsResult })

const contentResult = result({
  template: 'result-v1',
  status: 'ready',
  title: '新品文案交付复盘',
  summary: '3 篇文案与 1 套详情页已交付，品牌调性校验通过。',
  verdict: '内容已按品牌规范验收；等待运营确认最终投放版本。',
  owner: '陈书 · 文案撰写',
  producedAt: '2026-10-19 16:05',
  metrics: [],
  artifacts: [
    { id: 'titles', kind: 'document', title: '标题文案 3 版', description: '场景型、功能型、价格型各一版。', url: '',
      content: '## 备选标题\n\n1. 六档调节，桌面终于清爽了\n2. 折叠收纳的铝合金电脑支架\n3. 79 元价位的桌面升级方案\n\n投放前需运营确认主标题。' },
    { id: 'detail', kind: 'document', title: '详情页文案', description: '使用场景、材质尺寸、调节收纳与注意事项。', url: '',
      content: '## 详情结构\n\n- 使用场景：办公、宿舍、出差\n- 材质与尺寸：铝合金，13–16 英寸\n- 六档调节与折叠收纳\n- 注意事项：摆放与收纳要求' },
    { id: 'tone', kind: 'document', title: '品牌调性检查', description: '语气、用词与禁用表达检查结果。', url: '',
      content: '## 检查结果\n\n- [x] 语气与品牌一致\n- [x] 无绝对化用语\n- [x] 未出现未经核验的承重与销量\n- [ ] 运营确认最终投放版本' },
  ],
  checks: [
    { id: 'tone', label: '品牌调性一致', status: 'passed' },
    { id: 'claim', label: '无夸大或未验证卖点', status: 'passed' },
    { id: 'version', label: '运营确认最终投放版本', status: 'pending' },
  ],
  decisions: [
    { id: 'headline', question: '主标题用哪一版？', choice: '用场景型标题', at: '10-19 15:40' },
  ],
  next: ['等运营确认投放版本后更新商品页。', '补充一条 15 秒短视频脚本。'],
  note: '本轮交付物为文本内容，不包含点击与成交指标。',
})

const auditResult = result({
  template: 'result-v1',
  status: 'verified',
  title: '内容审核复盘',
  summary: '审核完成：12 项通过，2 项高风险退回。',
  verdict: '通过项已放行，高风险项退回修改；修改后再复核一次。',
  owner: '赵审 · 内容审核',
  producedAt: '2026-10-19 17:20',
  metricsTitle: '审核结论',
  metricsCaption: '本轮审核',
  metrics: [
    { id: 'result', label: '审核结果', value: '通过（有条件）', kind: 'status', tone: 'positive' },
    { id: 'high', label: '高风险项', value: '2', unit: '项', kind: 'value', tone: 'negative' },
    { id: 'passed', label: '通过项', value: '12', unit: '项', kind: 'value', tone: 'positive' },
    { id: 'rate', label: '一次通过率', value: '86', unit: '%', kind: 'target', target: '90%', targetStatus: 'at-risk', progress: 86, tone: 'neutral' },
  ],
  artifacts: [
    { id: 'records', kind: 'document', title: '审核记录', description: '14 项检查的逐条结果。', url: '',
      content: '| 检查项 | 结果 |\n| --- | --- |\n| 标题规范 | 通过 |\n| 主图与文字一致 | 通过 |\n| 尺寸说明 | 通过 |\n| 价格与优惠 | 高风险退回 |\n| 售后承诺 | 高风险退回 |' },
    { id: 'returns', kind: 'document', title: '退回清单', description: '2 项高风险的具体原因与处理人。', url: '',
      content: '- 价格与优惠：券后价与页面价不一致，退回定价负责人。\n- 售后承诺：缺少退换说明，退回运营负责人。' },
  ],
  checks: [
    { id: 'title', label: '标题与主图符合规范', status: 'passed' },
    { id: 'size', label: '尺寸说明完整', status: 'passed' },
    { id: 'price', label: '价格与优惠口径一致', status: 'failed' },
    { id: 'service', label: '售后承诺可核验', status: 'failed' },
  ],
  decisions: [
    { id: 'risk', question: '高风险项是否直接驳回？', choice: '退回修改后再复核', at: '10-19 17:05' },
  ],
  next: ['定价负责人修正券后价后重新提交。', '运营补充退换说明，进入二次复核。'],
  note: '审核结论为本地演示数据，不连接真实审核系统。',
})

const researchResult = result({
  template: 'result-v1',
  status: 'draft',
  title: '用户调研结论',
  summary: '18 位用户完成访谈，价格敏感度高于预期。',
  verdict: '样本接近目标，但价格结论仍需在更大样本中验证。',
  owner: '李研 · 用户研究',
  producedAt: '2026-10-19 18:10',
  metricsTitle: '调研完成度',
  metricsCaption: '本轮 20 个目标样本',
  metrics: [
    { id: 'samples', label: '完成访谈', value: '18', unit: '位', kind: 'target', target: '20 位', targetStatus: 'at-risk', progress: 90 },
    { id: 'feedback', label: '有效反馈', value: '42', unit: '条', kind: 'value' },
    { id: 'price', label: '价格敏感度', value: '高于预期', kind: 'text', tone: 'neutral' },
    { id: 'intent', label: '推荐意愿', value: '7.2', unit: '/10', kind: 'value', tone: 'positive' },
  ],
  artifacts: [
    { id: 'notes', kind: 'document', title: '访谈记录摘要', description: '18 位用户的关键原话与问题归类。', url: '',
      content: '## 主要问题\n\n1. 折叠后尺寸是否适合背包？\n2. 六档调节是否稳定？\n3. 79 元是否包含收纳袋？\n\n## 价格反馈\n\n12 位用户主动提到价格，其中 7 位认为需要对比竞品后再决定。' },
    { id: 'plan', kind: 'document', title: '后续验证计划', description: '扩大样本与价格测试的设计草案。', url: '',
      content: '- 追加 20 位目标用户访谈。\n- 用两个价格锚点做小范围测试。\n- 观察咨询中的价格异议比例。' },
  ],
  checks: [
    { id: 'samples', label: '完成目标样本量', status: 'pending' },
    { id: 'bias', label: '访谈提纲未引导价格答案', status: 'passed' },
    { id: 'verify', label: '价格结论扩大样本验证', status: 'pending' },
  ],
  decisions: [
    { id: 'next', question: '是否现在启动价格测试？', choice: '先补样本再测试', at: '10-19 18:00' },
  ],
  next: ['追加 20 位目标用户访谈。', '补充竞品价格对比后再设计价格测试。'],
  note: '调研数据为本地模拟，不包含真实用户隐私信息。',
})

const contentBoard = board({
  template: 'task-board-v1', title: '新品文案交付', status: 'completed',
  tagline: '内容交付 · 模拟数据', summary: '完成 3 篇文案与详情页，等待运营确认。',
  description: '按品牌规范撰写标题与详情文案，完成调性检查。', note: '本任务以交付物和验收为主，不设量化指标。',
  steps: [{ id: 'brief', title: '需求对齐', progress: 100 }, { id: 'write', title: '文案撰写', progress: 100 }, { id: 'check', title: '品牌校验', progress: 100 }],
  result: contentResult,
})

const auditBoard = board({
  template: 'task-board-v1', title: '内容审核', status: 'completed',
  tagline: '内容审核 · 模拟数据', summary: '14 项检查完成，2 项高风险退回。',
  description: '按规范逐项审核，记录通过项与高风险项。', note: '审核类任务以状态和清单为主，不强行做前后对比。',
  steps: [{ id: 'receive', title: '接收材料', progress: 100 }, { id: 'review', title: '逐项审核', progress: 100 }, { id: 'return', title: '退回处理', progress: 100 }],
  result: auditResult,
})

const researchBoard = board({
  template: 'task-board-v1', title: '用户调研', status: 'running',
  tagline: '用户研究 · 模拟数据', summary: '18/20 位用户完成访谈，价格结论待验证。',
  description: '围绕折叠电脑支架的使用场景与价格预期开展访谈。', note: '调研仍在进行，结论为草稿。',
  steps: [{ id: 'design', title: '访谈设计', progress: 100 }, { id: 'interview', title: '用户访谈', progress: 90 }, { id: 'analyze', title: '结论整理', progress: 60 }],
  result: researchResult,
})

export type ResultPreviewCase = { id: string; label: string; description: string; board: WhiteboardTaskBoardData; result: OfficeResult }

export const resultPreviewCases: readonly ResultPreviewCase[] = [
  { id: 'operations', label: '电商复盘', description: '前后对比指标：订单、成交率、成交额。', board: operationsBoard, result: operationsResult },
  { id: 'content', label: '文案交付', description: '没有量化指标，页面以交付物和验收为主。', board: contentBoard, result: contentResult },
  { id: 'audit', label: '内容审核', description: '状态指标与达标进度，而不是数字对比。', board: auditBoard, result: auditResult },
  { id: 'research', label: '用户调研', description: '目标、单值与定性指标混合。', board: researchBoard, result: researchResult },
]

export function findResultPreviewCase(id: string | null | undefined) {
  return resultPreviewCases.find(item => item.id === id) ?? resultPreviewCases[0]
}

export const resultPreviewStatuses = ['verified', 'ready', 'draft', 'rejected'] as const
