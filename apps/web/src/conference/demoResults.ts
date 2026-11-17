import type { OfficeResultInput } from '@pawoffice/protocol/office-ui'
import type { DemoScenarioId } from './demoDialogue.ts'
import { formatWorkItems } from './demoCycles.ts'
import type { DemoCase } from './demoCycles.ts'
import { editorialBriefMarkdown, editorialDraftMarkdown, editorialPageCount, editorialScheduleCsv } from './demoEditorial.ts'
import { seoResult } from './demoSeoResult.ts'

const listingReport = `# 折叠电脑支架上架检查

## 核对结果

- 售价 79 元与商品资料一致，页面没有出现其他价格。
- 六档高度调节、折叠收纳说明与供应商参数一致。
- 适用范围标注 13–16 英寸，未承诺 17 英寸机型。
- 标题、主图、详情页与尺寸说明核对 4/4 项一致。

## 上架确认

负责人已确认按 79 元上架，确认结果已登记。

## 交接记录

- 商品资料：规格卡 v2；页面稿：商品页校对稿 v3。陈书核对价格与参数，周理复核页面，赵审登记负责人确认。
- 本清单记录上架确认；实际发布后由运营回填商品链接、SKU、库存检查与发布时间，再开始计算观察窗口。
- 不用“任务完成”代替平台发布回执，缺少链接时继续保留待回填状态。

## 待观察事项

- 上架后首个 24 小时的访问、订单与购买咨询。
- 尺寸、机型相关咨询单列，下一轮对比数量。
- 承重、散热等缺少材料支持的描述不对外展示。
`

const listingData = `核对项,商品资料,上架页面,结论
售价,79 元,79 元,一致
适用范围,13–16 英寸,13–16 英寸,一致
高度调节,六档,六档,一致
标题与主图,已复核,已复核,一致
详情与尺寸说明,已复核,已复核,一致
`

const pad = (value: number) => String(value).padStart(2, '0')
const stamp = (at: Date) => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`

const report = `# 折叠电脑支架转化复盘

## 本轮范围

对比首轮与更新后两轮各 24 小时的同口径数据，判断「补充尺寸说明」这一方向是否值得继续验证。

来源为经营台账 W1、W2 和咨询归类表 C01–C10。两轮订单均按支付成功记录，退款与售后单独回收；广告来源与新老访客占比尚未齐全，不能视为严格对照实验。

## 观察结果

- 商品访问 360 → 350 次（-2.8%）。
- 订单 9 → 14 单（+5 单），访问成交率 2.5% → 4.0%（+1.5pp）。
- 首轮 10 条购买咨询中，6 条涉及适用尺寸或机型。

## 尚不能得出的结论

两轮窗口短、没有对照组，访问量还略有下降，不能把订单增长直接归因于尺寸说明。需要延长观察窗口，并核对退款与售后数据。

## 下一步

1. 延长第二个观察窗口至 72 小时，核对退款与售后数据。
2. 下一轮单独记录尺寸与机型咨询，与本轮 6/10 条对比。
3. 结论稳定后，再评估是否扩大推广或调整价格。
`

const data = `指标,首轮,更新后,变化
商品访问（次）,360,350,-2.8%
订单（单）,9,14,+5
访问成交率,2.5%,4.0%,+1.5pp
`

/**
 * Demo-only: the structured result a finished walkthrough leaves on the whiteboard.
 * Only scenarios whose story actually ends in a deliverable get one; the others keep the
 * honest "任务已结束，但尚未收到成果内容" empty state instead of inventing data.
 */
/** 商品视觉团队：素材审核后交付图片清单与审核结论。 */
function contentResult(producedAt: string): OfficeResultInput {
  return result({
    producedAt,
    team: '商品视觉团队',
    title: '折叠电脑支架素材审核',
    summary: '已交付 4 张图片的拍摄与审核清单，详情按场景、调节、收纳、尺寸编排。13–16 英寸文案与规格卡一致；收纳尺寸实拍及最终手机预览仍待补齐。',
    verdict: '清单可交设计与拍摄执行，尚不等于 4 张成品图片全部验收。周理补齐折叠尺寸实拍后，再由王明复核手机版页面并放行。',
    metricsTitle: '素材核对',
    metricsCaption: '以商品资料为唯一基准',
    metrics: [
      { id: 'images', label: '图片清单', value: '4', unit: '张', change: '主图 1 / 卖点细节 2 / 尺寸说明 1' },
      { id: 'fit', label: '适用范围', value: '13–16', unit: '英寸', change: '未承诺 17 英寸机型' },
      { id: 'detail', label: '详情内容', value: '4', unit: '块', change: '场景、调节、收纳、尺寸' },
      { id: 'verdict', label: '审核结论', value: '待补拍', kind: 'status', tone: 'neutral', change: '清单已交付，成品验收待完成' },
    ],
    report: { title: '素材审核清单', description: '主图、详情与尺寸说明的核对结果。', content: `# 素材审核清单

## 主图与附图
- 主图展示展开状态的整体形态，附图分别说明六档调节与折叠收纳。

## 详情结构
- 使用场景 → 六档调节 → 折叠收纳 → 适用尺寸与注意事项，共 4 块。

## 尺寸说明
- 独立尺寸图标注 13–16 英寸，未承诺 17 英寸机型；移动端字号需保持可读。

## 待补事项
- P03 折叠前后尺寸照片由周理周三 12:00 前补拍；尺子、主体与标注要同时可见，不把示意图当实测。
- 陈书替换详情稿 v3 的临时图，王明按手机实际预览确认字是否能读清，再登记验收版本。
- 本轮交付的是拍摄与审核清单，成品图片另行上传，不能用清单数量充当已交付图片数量。
` },
    data: { title: '图片清单', description: '图片编号、用途、依据及验收状态。', content: `图片编号,用途,数量,说明,责任人,状态
P01,商品主图,1,展开状态侧前视角与同款规格卡对应,李研,拍摄要求已确认
P02,卖点细节,1,六档调节位置逐档标注,陈书,待成品验收
P03,折叠收纳,1,补拍折叠前后带尺照片,周理,待补拍
P04,尺寸说明,1,13–16 英寸并保留机身核对提示,陈书,待手机预览
` },
    checks: [
      { id: 'image-copy', label: '主图与附图覆盖商品形态与细节', status: 'passed' },
      { id: 'fit-copy', label: '13–16 英寸说明与商品资料一致', status: 'passed' },
      { id: 'mobile', label: '补齐实拍后进行最终手机预览', status: 'pending' },
    ],
    risks: [{ id: 'photo', title: '折叠前后尺寸照片待补拍', level: 'low', status: 'open', owner: '王明 · 负责人', note: '当前详情使用临时示意图，未核验尺寸不对外承诺。' }],
    tasks: [
      { id: 'shoot', title: '梳理主图拍摄要求', owner: '李研 · 视觉策划', status: 'done', progress: 100 },
      { id: 'detail', title: '编排详情页与尺寸图', owner: '陈书 · 详情设计', status: 'done', progress: 100 },
      { id: 'check', title: '复核并交付图片清单', owner: '周理 · 素材校对', status: 'done', progress: 100 },
    ],
    next: ['补拍折叠前后尺寸照片，替换详情中的临时示意图。', '按主图、卖点细节、尺寸图顺序走查移动端页面。', '把审核清单交付上架页面制作使用。'],
  })
}


/** 报税办公室：申报前资料核对，凭证待补。 */
function taxResult(producedAt: string): OfficeResultInput {
  return result({
    producedAt,
    team: '报税办公室',
    title: '本期申报资料核对',
    summary: '收支台账与发票明细已归集：2 类资料、2 条待补凭证（P-04、R-06），申报草稿 1 份待复核。',
    verdict: '凭证补齐前不提交申报；补齐编号后交复核人核对草稿，再由业务人员确认是否提交。',
    metricsTitle: '申报前核对',
    metricsCaption: '以台账与发票明细为准',
    metrics: [
      { id: 'kinds', label: '资料类型', value: '2', unit: '类', change: '收支台账与发票明细' },
      { id: 'pending', label: '待补凭证', value: '2', unit: '条', change: 'P-04 与 R-06', tone: 'negative' },
      { id: 'draft', label: '申报草稿', value: '1', unit: '份', change: '待复核，凭证补齐前不提交' },
      { id: 'status', label: '复核状态', value: '待补件', kind: 'status', tone: 'negative', change: '补齐凭证编号后再复核' },
    ],
    report: { title: '申报资料核对报告', description: '归集、核对与待补项说明。', content: `# 本期申报资料核对报告

## 已归集
- 收支台账与发票明细按日期、来源整理。

## 待补凭证
- P-04：补付款凭证编号，并核对台账中的日期与金额。
- R-06：补入账凭证编号，保留与原始发票的对应关系。

## 处理方式
- 补齐前不提交申报；补齐后交复核人核对草稿，再由业务人员确认是否提交。
` },
    data: { title: '待补凭证清单', description: '凭证编号、类型与待补内容。', content: `凭证编号,类型,待补内容,状态
P-04,付款凭证,补编号并核对日期金额,待补
R-06,入账凭证,补编号并保留发票对应,待补
` },
    extraArtifacts: [{ id: 'draft', kind: 'document', title: '申报草稿（待复核）', description: '已归集资料与待补凭证的申报草稿，仅供内部复核。',
      change: 'added', version: '1.0', producedAt, mimeType: 'text/markdown', content: `# 本期申报草稿（待复核）

## 资料工作底稿

| 项目 | 当前记录 | 数据来源 | 状态 |
| --- | --- | --- | --- |
| 所属期 | 以会计确认的本期为准 | 任务单 | 待复核人确认 |
| 收入与支出台账 | 保留原始流水号与金额，不覆盖原记录 | 收支台账 v1 | 已归集 |
| P-04 支出 | 发票记录已找到，付款凭证编号缺失 | 台账 P-04 与发票明细 | 待补付款依据 |
| R-06 收入 | 对应入账凭证编号缺失 | 台账 R-06 与发票明细 | 待补入账依据 |
| 申报口径 | 主体、税种与适用口径未确认 | 复核交接单 | 暂不计算应纳税额 |

## 补件责任

- 周理今天 16:00 前向资料负责人索取 P-04 付款凭证编号与原件，保留原记录与补件的对应关系。
- 赵审核对 R-06 原始流水，补入账凭证编号并注明回填人、回填时间。
- 刘市接收补件后复核；不能仅凭有付款凭证就判断可抵扣，也不能从收支总额直接推算税额。

## 复核状态

- 本轮交付资料底稿及缺口清单。主体、所属期和申报口径由会计确认，完成复核后再决定是否提交；当前没有申报回执。
` }],
    checks: [
      { id: 'collect', label: '发票已按日期与来源归集', status: 'passed' },
      { id: 'ledger', label: '收支与凭证已逐项核对', status: 'passed' },
      { id: 'voucher', label: 'P-04 与 R-06 补件后复核', status: 'pending' },
    ],
    risks: [{ id: 'vouchers', title: 'P-04 与 R-06 凭证待补', level: 'medium', status: 'open', owner: '王明 · 负责人', note: '付款与入账凭证编号缺失，补齐前不提交申报。' }],
    tasks: [
      { id: 'collect', title: '归集本期发票', owner: '赵审 · 票据归集', status: 'done', progress: 100 },
      { id: 'check', title: '核对收支与凭证', owner: '周理 · 凭证核对', status: 'done', progress: 100 },
      { id: 'draft', title: '整理申报草稿', owner: '刘市 · 申报资料', status: 'done', progress: 100 },
    ],
    next: ['补齐 P-04 付款凭证编号，并核对日期与金额。', '补齐 R-06 入账凭证编号，保留与原始发票的对应关系。', '交复核人核对草稿，由业务人员确认是否提交。'],
  })
}

/** 多入口信息归纳办公室：跨入口项目简报。 */
function digestResult(producedAt: string): OfficeResultInput {
  return result({
    producedAt,
    team: '多入口信息归纳办公室',
    title: '跨入口项目简报',
    summary: '邮件、群聊、表单 3 个入口的消息已归并：交付时间以邮件确认为周三 15:00，另有 3 项待确认。',
    verdict: '按周三 15:00 准备交付；封面设计、改期建议与验收人仍需逐条确认，不能当作已确认结论。',
    metricsTitle: '归纳结果',
    metricsCaption: '以邮件确认信息为准',
    metrics: [
      { id: 'sources', label: '信息入口', value: '3', unit: '个', change: '邮件、群聊与表单' },
      { id: 'delivery', label: '交付时间', value: '周三 15:00', kind: 'text', change: '以项目确认邮件为准' },
      { id: 'pending', label: '待确认', value: '3', unit: '项', change: '封面、改期、验收人', tone: 'negative' },
      { id: 'status', label: '简报状态', value: '已整理', kind: 'status', tone: 'positive', change: '待逐条确认后更新' },
    ],
    report: { title: '项目简报', description: '跨入口信息归并后的时间、变更与待确认事项。', content: `# 跨入口项目简报

## 来源索引

| 编号 | 时间 | 来源 | 原始信息 |
| --- | --- | --- | --- |
| E01 | 周二 09:12 | 项目确认邮件 | 样品册周三 15:00 交付 |
| M02 | 周二 10:05 | 设计群 | 建议改用 B 版封面，未见终稿确认 |
| M03 | 周二 10:18 | 项目群 | 建议改到周四，未见负责人批准 |
| F04 | 周二 11:00 | 交付表单 | 验收人字段为空 |

## 已确认
- 交付时间：周三 15:00，以项目确认邮件为准。

## 变更请求
- 群聊提出改期到周四，保留为待确认建议，未采纳为结论。

## 待确认
- 李研周二 17:00 前收 B 版封面确认；确认前保留当前版本。
- 王明周二 17:30 前决定是否接受延期；无新确认仍按周三 15:00 执行。
- 陈书周三 10:00 前补齐验收人姓名与接收方式，回填 F04。
- 确认后在同一事项下追加记录，保留旧来源，不因群消息较晚就自动覆盖已确认时间。
` },
    data: { title: '待确认事项', description: '事项、来源与状态。', content: `事项,来源,状态
封面设计,群聊,待设计负责人确认
改期建议,群聊,待确认是否采纳
验收人,表单,待项目负责人补齐
` },
    checks: [
      { id: 'sources', label: '三个入口消息已登记', status: 'passed' },
      { id: 'merge', label: '同一事件已归并', status: 'passed' },
      { id: 'conflict', label: '冲突信息已标记待确认', status: 'passed' },
    ],
    risks: [{ id: 'pending', title: '封面、改期与验收人未确认', level: 'medium', status: 'open', owner: '王明 · 负责人', note: '群聊与表单中的差异保留为待确认事项，不写成结论。' }],
    tasks: [
      { id: 'gather', title: '汇集邮件、群聊和表单', owner: '周理 · 入口汇集', status: 'done', progress: 100 },
      { id: 'merge', title: '合并同一事件', owner: '刘市 · 事件归类', status: 'done', progress: 100 },
      { id: 'brief', title: '输出项目简报', owner: '陈书 · 简报整理', status: 'done', progress: 100 },
    ],
    next: ['按周三 15:00 准备交付。', '逐条确认封面设计、改期建议与验收人。', '为每条信息补记出处，确认后再更新简报。'],
  })
}

/** Common shape so each scenario only declares its content. */
function result(spec: {
  producedAt: string; team: string; title: string; summary: string; verdict: string
  metricsTitle: string; metricsCaption: string; metrics: NonNullable<OfficeResultInput['metrics']>
  report: { title: string; description: string; content: string }
  data: { title: string; description: string; content: string }
  extraArtifacts?: NonNullable<OfficeResultInput['artifacts']>
  checks: NonNullable<OfficeResultInput['checks']>
  risks?: NonNullable<OfficeResultInput['risks']>
  tasks: NonNullable<OfficeResultInput['tasks']>
  next: string[]
  note?: string
}): OfficeResultInput {
  return {
    template: 'result-v1', title: spec.title, status: 'ready', summary: spec.summary, verdict: spec.verdict,
    owner: '王明 · 负责人', producedAt: spec.producedAt, team: spec.team, teamSize: 3,
    metricsTitle: spec.metricsTitle, metricsCaption: spec.metricsCaption, metrics: spec.metrics,
    artifacts: [
      { id: 'report', kind: 'document', title: spec.report.title, description: spec.report.description,
        change: 'added', version: '1.0', producedAt: spec.producedAt, mimeType: 'text/markdown', content: spec.report.content },
      { id: 'data', kind: 'data', title: spec.data.title, description: spec.data.description,
        change: 'added', version: '1.0', producedAt: spec.producedAt, mimeType: 'text/csv', content: spec.data.content },
      ...(spec.extraArtifacts ?? []),
    ],
    checks: spec.checks, risks: spec.risks ?? [], decisions: [], tasks: spec.tasks, next: spec.next,
    note: spec.note,
  }
}

export function scenarioResult(id: DemoScenarioId, at: Date): OfficeResultInput | undefined {
  const producedAt = stamp(at)
  if (id === 'office-1') return listingResult(producedAt)
  if (id === 'office-content') return contentResult(producedAt)
  if (id === 'office-analysis') return analysisResult(producedAt)
  if (id === 'office-demo-seo') return seoResult(producedAt)
  if (id === 'office-demo-tax') return taxResult(producedAt)
  if (id === 'office-demo-digest') return digestResult(producedAt)
  return undefined
}

export function cycleResult(current: DemoCase, team: string, at: Date, tasks: NonNullable<OfficeResultInput['tasks']>) {
  if (current.editorial) {
    const plan = current.editorial, producedAt = stamp(at)
    return result({
      producedAt, team, title: current.title, summary: current.summary ?? current.request, verdict: current.next,
      metricsTitle: '本轮编辑交付', metricsCaption: '文稿与分镜已整理，图片与发布仍待完成',
      metrics: [
        { id: 'drafts', label: '分平台文稿', value: String(plan.drafts.length), unit: '份', change: '各平台分别编写，待终审' },
        { id: 'storyboards', label: '配图分镜', value: String(editorialPageCount(plan)), unit: '页', change: '制图说明，未视为成品图片' },
        { id: 'review', label: '审核状态', kind: 'status', value: '待审核', change: '补图后由王明终审' },
        { id: 'published', label: '本轮发布回执', value: '0', unit: '份', change: '实际链接与时间待回填' },
      ],
      report: { title: '选题与编辑交接单', description: '账号定位、来源、审核意见及回访安排',
        content: editorialBriefMarkdown(plan, current.title, current.summary ?? current.request, current.next) },
      data: { title: '三平台发布排期', description: '拟发布时间、待审核项和发布回执，未发布字段留空', content: editorialScheduleCsv(plan) },
      extraArtifacts: plan.drafts.map((draft, index) => ({ id: `draft-${index + 1}`, kind: 'document', title: `${draft.platform}｜${draft.title}`,
        description: `${draft.format}正文、配图分镜和审核交接；待审核`, change: 'added', version: '校对稿 v1', producedAt,
        mimeType: 'text/markdown', content: editorialDraftMarkdown(draft) })),
      checks: [
        { id: 'sources', label: '稿件中的规格与来源编号逐项对应', status: 'passed' },
        { id: 'formats', label: '各平台正文、标题与图文分镜分别交付', status: 'passed' },
        { id: 'images', label: '配图制作、来源确认及手机预览', status: 'pending' },
        { id: 'approval', label: '王明终审与发布回执登记', status: 'pending' },
      ],
      risks: plan.drafts.map((draft, index) => ({ id: `review-${index + 1}`, title: `${draft.platform}待审核`, level: 'low', status: 'open',
        owner: '王明 · 终审', note: draft.review })),
      tasks, next: [current.next],
    })
  }
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
  const rows = current.items.map(item => [item.label, item.status, item.detail, item.source].map(quote).join(','))
  return result({
    producedAt: stamp(at), team, title: current.title, summary: current.summary ?? current.items.map(item => `${item.label}：${item.status}`).join('；') + '。待确认项已保留来源，尚未代替负责人做决定。', verdict: current.next,
    metricsTitle: '事项与状态', metricsCaption: '每条记录附原始依据',
    metrics: current.items.map((item, index) => ({ id: `item-${index + 1}`, label: item.label, kind: 'status', value: item.status })),
    report: { title: '本轮工作简报', description: '委托、处理结果与后续事项',
      content: `# ${current.title}\n\n${current.request}\n\n${formatWorkItems(current.items)}\n\n## 下一步\n\n${current.next}` },
    data: { title: '事项明细', description: '逐条查看状态、说明与出处', content: ['事项,状态,说明,出处', ...rows].join('\n') },
    checks: [{ id: 'sources', label: '逐项标注依据及后续状态', status: 'passed' }],
    tasks, next: [current.next],
  })
}

/** 电商运营团队：核对资料与页面后确认上架，交付上架检查清单。 */
function listingResult(producedAt: string): OfficeResultInput {
  return {
    template: 'result-v1',
    title: '折叠电脑支架上架检查',
    status: 'ready',
    summary: '已按 79 元完成上架检查并确认上架：售价、六档调节与 13–16 英寸适用范围与商品资料一致，页面核对 4/4 项通过。',
    verdict: '上架前材料与页面已对齐；承重、散热等无材料支持的描述不对外展示。接下来按首个 24 小时观察访问、订单与咨询。',
    owner: '王明 · 负责人',
    producedAt,
    team: '电商运营团队',
    teamSize: 3,
    metricsTitle: '上架前核对',
    metricsCaption: '以商品资料为唯一基准',
    metrics: [
      { id: 'status', label: '上架状态', value: '已确认上架', kind: 'status', tone: 'positive', change: '负责人已确认按 79 元上架' },
      { id: 'price', label: '售价', value: '79', unit: '元', change: '与商品资料一致' },
      { id: 'fit', label: '适用尺寸', value: '13–16', unit: '英寸', change: '未承诺 17 英寸机型' },
      { id: 'page-check', label: '页面核对', value: '4 / 4', unit: '项', change: '标题、主图、详情、尺寸说明' },
    ],
    artifacts: [
      { id: 'listing-checklist', kind: 'document', title: '上架检查清单', description: '售价、规格、适用尺寸与页面一致性核对结果。',
        change: 'added', version: '1.0', producedAt, mimeType: 'text/markdown', content: listingReport },
      { id: 'listing-compare', kind: 'data', title: '商品资料核对表', description: '商品资料与上架页面的逐项对照。',
        change: 'added', version: '1.0', producedAt, mimeType: 'text/csv', content: listingData },
    ],
    checks: [
      { id: 'price', label: '售价 79 元与商品资料一致', status: 'passed' },
      { id: 'fit', label: '13–16 英寸适用范围已写明', status: 'passed' },
      { id: 'page', label: '标题、主图、详情与尺寸说明核对通过', status: 'passed' },
    ],
    risks: [
      { id: 'claims', title: '承重与散热缺少材料支持', level: 'low', status: 'open', owner: '王明 · 负责人',
        note: '相关描述不写入卖点；等测试材料补齐后再评估。' },
    ],
    decisions: [
      { id: 'listing', question: '是否按 79 元上架折叠电脑支架？', choice: '确认上架', at: producedAt },
    ],
    tasks: [
      { id: 'check-data', title: '核对商品资料与售价', owner: '陈书 · 商品运营', status: 'done', progress: 100 },
      { id: 'check-page', title: '复核上架页面', owner: '周理 · 上架质检', status: 'done', progress: 100 },
      { id: 'log-listing', title: '记录上架确认结果', owner: '赵审 · 发布登记', status: 'done', progress: 100 },
    ],
    next: [
      '按首个 24 小时观察访问、订单与购买咨询。',
      '把尺寸、机型相关咨询单列，下一轮对比数量。',
      '补拍折叠前后尺寸照片；承重与散热补齐测试材料后再作为卖点。',
    ],
  }
}

/** 经营分析团队：两轮同口径观察后的转化复盘。 */
function analysisResult(producedAt: string): OfficeResultInput {
  return {
    template: 'result-v1',
    title: '折叠电脑支架转化复盘',
    status: 'ready',
    summary: '两轮同口径 24 小时观察：商品访问 360 → 350 次，订单 9 → 14 单，访问成交率 2.5% → 4.0%。',
    verdict: '建议保持 79 元售价：尺寸说明是待验证假设，不能据此证明因果；延长观察并补齐退款、售后数据后，再评估推广与价格。',
    owner: '王明 · 负责人',
    producedAt,
    team: '经营分析团队',
    teamSize: 3,
    metricsTitle: '两轮经营观察',
    metricsCaption: '同一口径、各 24 小时；不是随机对照实验',
    metrics: [
      { id: 'visits', label: '商品访问', value: '350', unit: '次', kind: 'comparison', previous: '360 次', change: '-2.8%', trend: 'down', tone: 'neutral' },
      { id: 'orders', label: '订单', value: '14', unit: '单', kind: 'comparison', previous: '9 单', change: '+5 单', trend: 'up', tone: 'positive' },
      { id: 'conversion', label: '访问成交率', value: '4.0', unit: '%', kind: 'comparison', emphasis: 'primary', previous: '2.5%', change: '+1.5pp', trend: 'up', tone: 'positive' },
      { id: 'inquiries', label: '尺寸/机型咨询', value: '6 / 10 条', kind: 'text', change: '首轮 10 条咨询中 6 条涉及尺寸或机型', tone: 'neutral' },
    ],
    artifacts: [
      { id: 'conversion-report', kind: 'document', title: '转化复盘报告', description: '两轮观察、结论边界与下一步复核建议。',
        change: 'added', version: '1.0', producedAt, mimeType: 'text/markdown', content: report },
      { id: 'two-round-data', kind: 'data', title: '两轮观察数据', description: '首轮与更新后的访问、订单、成交率与咨询归类。',
        change: 'added', version: '1.0', producedAt, mimeType: 'text/csv', content: data },
    ],
    checks: [
      { id: 'window', label: '两轮观察窗口口径一致（各 24 小时）', status: 'passed' },
      { id: 'inquiry', label: '首轮 10 条咨询已按尺寸、机型归类', status: 'passed' },
      { id: 'recommendation', label: '复盘建议已复核，结论边界已写明', status: 'passed' },
    ],
    risks: [
      { id: 'causality', title: '观察窗口短，因果未证实', level: 'medium', status: 'open', owner: '王明 · 负责人',
        note: '两轮各 24 小时且无对照组，订单增长不能直接归因于尺寸说明。' },
    ],
    tasks: [
      { id: 'verify-data', title: '核对两轮访问和订单', owner: '赵审 · 数据核验', status: 'done', progress: 100 },
      { id: 'classify-inquiries', title: '分类尺寸与机型咨询', owner: '李研 · 咨询分析', status: 'done', progress: 100 },
      { id: 'review-recommendation', title: '整理经营复盘建议', owner: '刘市 · 策略复核', status: 'done', progress: 100 },
    ],
    next: [
      '延长第二个观察窗口至 72 小时，并核对退款与售后数据。',
      '下一轮单独统计尺寸与机型咨询，与本轮 6/10 条对比。',
      '观察结论稳定后，再评估是否扩大推广或调整价格。',
    ],
    note: '两轮观察缺少对照组，成交变化的原因仍待验证。',
  }
}

/** True only when the scenario finishes with a readable result. */
export function hasScenarioResult(id: DemoScenarioId) {
  return scenarioResult(id, new Date()) !== undefined
}
