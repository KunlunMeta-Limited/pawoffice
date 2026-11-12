import { z } from 'zod'
import type { DemoScenarioId } from './demoDialogue.ts'

const label = z.string().min(1).max(80)
const text = z.string().min(1).max(500)
const reportSchema = z.object({
  scope: label,
  title: label,
  status: label,
  summary: text,
  tone: z.enum(['blue', 'teal', 'amber']),
  metrics: z.array(z.object({ label, value: label, detail: label })).min(1).max(3),
  chart: z.object({
    title: label,
    unit: label,
    rows: z.array(z.object({ label, value: z.number().min(0).max(100000000) })).min(1).max(4),
  }),
  findings: z.array(z.object({ title: label, detail: text })).min(1).max(3),
  next: text,
  note: text,
})

export type DemoReport = z.infer<typeof reportSchema>

const reportStart = '```office-report\n'
const reportEnd = '\n```'

function encodeReport(report: DemoReport) {
  return reportStart + JSON.stringify(report) + reportEnd
}

export function readDemoReport(content: string): DemoReport | undefined {
  if (!content.startsWith(reportStart) || !content.endsWith(reportEnd)) return
  try {
    const result = reportSchema.safeParse(JSON.parse(content.slice(reportStart.length, -reportEnd.length)))
    if (result.success) return result.data
  } catch { /* An incomplete or unrecognized block falls back to Markdown. */ }
}

export function demoReportMarkdown(report: DemoReport) {
  return [
    `# ${report.title}`, `**${report.scope} · ${report.status}**`, report.summary,
    '## 关键指标', report.metrics.map(item => `- **${item.label}** ${item.value}（${item.detail}）`).join('\n'),
    `## ${report.chart.title}`, report.chart.rows.map(row => `- ${row.label} ${row.value} ${report.chart.unit}`).join('\n'),
    '## 主要发现', report.findings.map(item => `- **${item.title}** ${item.detail}`).join('\n'),
    '## 下一步', report.next, report.note,
  ].join('\n\n')
}

export function isDemoReportQuestion(question: string) {
  return /汇总|报告|业绩|报表|复盘|简报|成果预览|交付预览/.test(question.normalize('NFKC').replace(/\s+/g, ''))
}

const scenarioReports = {
  'office-1': {
    scope: '电商运营 · 上架准备',
    title: '折叠电脑支架上架检查报告',
    tone: 'blue',
    metrics: [
      { label: '拟定售价', value: '79 元', detail: '按商品资料复核' },
      { label: '页面核对', value: '04 项', detail: '标题、主图、详情和尺寸说明' },
      { label: '观察窗口', value: '24 小时', detail: '登记上架后开始观察' },
    ],
    chart: { title: '页面检查清单', unit: '项', rows: [
      { label: '标题与主图', value: 2 }, { label: '详情与尺寸', value: 2 },
    ] },
    findings: [
      { title: '商品信息统一', detail: '核对 79 元定价、六档调节与 13–16 英寸适用范围。标题、主图和详情以同一版商品资料为准。' },
      { title: '上架结果需登记', detail: '页面复核后提交确认。上架后按首个 24 小时记录访问、订单和购买咨询。' },
    ],
    next: '核对上架状态，按统一时间窗口登记访问与订单，并单列尺寸和机型咨询。',
  },
  'office-content': {
    scope: '商品视觉 · 素材审核',
    title: '折叠电脑支架商品素材审核报告',
    tone: 'amber',
    metrics: [
      { label: '图片清单', value: '04 张', detail: '主图、调节、收纳、尺寸' },
      { label: '适用范围', value: '13–16 英寸', detail: '独立尺寸图' },
      { label: '详情内容', value: '04 块', detail: '场景、调节、收纳、尺寸' },
    ],
    chart: { title: '图片用途分布', unit: '张', rows: [
      { label: '商品主图', value: 1 }, { label: '卖点细节', value: 2 }, { label: '尺寸说明', value: 1 },
    ] },
    findings: [
      { title: '主图优先展示商品形态', detail: '用侧前视角展示展开后的支架，调节和收纳细节分配给附图。' },
      { title: '尺寸说明在手机上直接可读', detail: '独立尺寸图标注 13–16 英寸，校对标题、详情文案和图片标注是否一致。' },
    ],
    next: '按主图、卖点细节和尺寸图顺序走查移动端页面，再交付审核清单。',
  },
  'office-analysis': {
    scope: '经营分析 · 转化复盘',
    title: '折叠电脑支架转化表现复盘报告',
    tone: 'teal',
    metrics: [
      { label: '商品访问', value: '360 → 350 次', detail: '两轮各 24 小时' },
      { label: '订单', value: '9 → 14 单', detail: '同一商品，售价 79 元' },
      { label: '尺寸与机型咨询', value: '6 / 10 条', detail: '首轮咨询记录' },
    ],
    chart: { title: '商品访问成交率', unit: '%', rows: [
      { label: '首轮 24 小时', value: 2.5 }, { label: '更新后 24 小时', value: 4.0 },
    ] },
    findings: [
      { title: '同口径对照成交', detail: '订单除以商品访问量，成交率从 2.5% 变为 4.0%。继续观察才能判断尺寸说明改动的效果。' },
      { title: '跟踪适用尺寸咨询', detail: '首轮 10 条咨询中 6 条涉及尺寸或机型。下一轮单列这类咨询，同时记录退款和售后。' },
    ],
    next: '维持 79 元售价，延长观察并补齐售后数据，再评估是否调整推广或价格。',
  },
  'office-demo-seo': {
    scope: '搜索表现 · 页面审查',
    title: '产品页 SEO 优化调研报告',
    tone: 'blue',
    metrics: [
      { label: '待调整项', value: '03 项', detail: '标题、摘要与 H1' },
      { label: '核心搜索词', value: '01 个', detail: '折叠电脑支架' },
      { label: '内链建议', value: '01 条', detail: '产品对比页 → 产品页' },
    ],
    chart: { title: '优化项分布', unit: '项', rows: [
      { label: '页面文案', value: 3 }, { label: '主词定位', value: 1 }, { label: '站内链接', value: 1 },
    ] },
    findings: [
      { title: '统一页面主题', detail: '产品标题和 H1 都围绕「折叠电脑支架」。摘要补充六档调节、便携收纳和使用场景。' },
      { title: '补齐站内入口', detail: '从产品对比页增加一条指向产品页的链接，把尺寸和使用场景的辅助词放到对应卖点。' },
    ],
    next: '先更新产品页，再补充内链。发布前逐页核对标题、摘要和链接目标。',
  },
  'office-demo-tax': {
    scope: '财务资料 · 申报前核对',
    title: '本期申报资料核对报告',
    tone: 'teal',
    metrics: [
      { label: '资料类型', value: '02 类', detail: '收支台账与发票明细' },
      { label: '待补凭证', value: '02 条', detail: 'P-04 与 R-06' },
      { label: '申报草稿', value: '01 份', detail: '待复核，凭证补齐前不提交' },
    ],
    chart: { title: '补件分布', unit: '条', rows: [
      { label: '付款凭证', value: 1 }, { label: '入账凭证', value: 1 },
    ] },
    findings: [
      { title: '付款凭证待补', detail: 'P-04 需补付款凭证编号，并对照台账里的日期与金额。' },
      { title: '入账凭证待补', detail: 'R-06 需补入账凭证编号，保留与原始发票的对应关系。' },
    ],
    next: '补齐两条编号后交复核人核对草稿，再由业务人员确认是否提交。',
  },
  'office-demo-social': {
    scope: '内容运营 · 一周排期',
    title: '工作台整理内容运营报告',
    tone: 'amber',
    metrics: [
      { label: '发布节点', value: '03 个', detail: '周一、周三、周五' },
      { label: '内容形式', value: '03 种', detail: '短视频、图文、评论问答' },
      { label: '复盘维度', value: '03 项', detail: '完播、收藏、评论' },
    ],
    chart: { title: '本周发布安排', unit: '项', rows: [
      { label: '周一 · 短视频', value: 1 }, { label: '周三 · 图文', value: 1 }, { label: '周五 · 问答', value: 1 },
    ] },
    findings: [
      { title: '教程负责打开话题', detail: '短视频用三步整理法介绍线材归置，周中图文用前后对比展示结果。' },
      { title: '问答用于收集需求', detail: '周五整理高频评论，把用户提到的空间和收纳限制纳入下周选题。' },
    ],
    next: '发布前核对素材和封面。周五按内容形式分别记录完播、收藏和评论反馈。',
  },
  'office-demo-collection': {
    scope: '公开信息 · 采集与校验',
    title: '公开活动信息采集报告',
    tone: 'teal',
    metrics: [
      { label: '原始记录', value: '18 条', detail: '公开活动页与订阅来源' },
      { label: '去重后保留', value: '15 条', detail: '合并 3 条重复记录' },
      { label: '出处已核验', value: '13 条', detail: '另有 2 条待核实' },
    ],
    chart: { title: '记录处理漏斗', unit: '条', rows: [
      { label: '原始提取', value: 18 }, { label: '去重保留', value: 15 }, { label: '已核验', value: 13 },
    ] },
    findings: [
      { title: '重复发布合并', detail: '按活动标题、主办方和日期对照重复发布，保留信息更完整的一条。' },
      { title: '出处随记录保留', detail: '每条记录保留标题、日期、主办方和来源链接。暂时无法确认的两条单列。' },
    ],
    next: '复核待确认的两条记录，核对主办方公告后再合入正式清单。',
  },
  'office-demo-digest': {
    scope: '跨入口归纳 · 项目简报',
    title: '样品册项目多入口汇总报告',
    tone: 'blue',
    metrics: [
      { label: '信息入口', value: '03 个', detail: '邮件、群聊与表单' },
      { label: '确认交付', value: '周三 15:00', detail: '以项目确认邮件为准' },
      { label: '待确认', value: '03 项', detail: '封面、改期、验收人' },
    ],
    chart: { title: '归纳后事项分布', unit: '项', rows: [
      { label: '已确认', value: 1 }, { label: '变更请求', value: 1 }, { label: '其他待确认', value: 2 },
    ] },
    findings: [
      { title: '交付时间有明确出处', detail: '邮件确认周三 15:00，群聊提出的周四建议保留为待确认事项。' },
      { title: '设计与验收仍待明确', detail: 'B 版封面交设计负责人确认，表单中缺失的验收人由项目负责人补齐。' },
    ],
    next: '按周三交付时间准备，逐条确认封面、改期建议与验收人，并补记出处。',
  },
} satisfies Record<DemoScenarioId, Omit<DemoReport, 'status' | 'summary' | 'note'>>

export function scenarioDemoReport(id: DemoScenarioId, status: string, progress: string) {
  return encodeReport({
    ...scenarioReports[id], status, summary: progress,
    note: '指标与结论来自此案例的预设资料。上方进度反映当前办公室的任务状态。',
  })
}

