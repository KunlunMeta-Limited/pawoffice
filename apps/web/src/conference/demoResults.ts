import type { OfficeResultInput } from '@pawoffice/protocol/office-ui'
import type { DemoScenarioId } from './demoDialogue.ts'

const listingReport = `# 折叠电脑支架上架检查

## 核对结果

- 售价 79 元与商品资料一致，页面没有出现其他价格。
- 六档高度调节、折叠收纳说明与供应商参数一致。
- 适用范围标注 13–16 英寸，未承诺 17 英寸机型。
- 标题、主图、详情页与尺寸说明核对 4/4 项一致。

## 上架确认

负责人已确认按 79 元上架（仅模拟，不连接真实店铺、不扣费）。

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
    summary: '主图、卖点细节与尺寸图清单已复核：图片 4 张、详情 4 块，13–16 英寸适用范围在移动端清晰可读。',
    verdict: '素材与商品资料一致，可交付上架页面使用；折叠前后尺寸照片仍待补拍，补齐后再替换详情中的临时示意图。',
    metricsTitle: '素材核对',
    metricsCaption: '以商品资料为唯一基准',
    metrics: [
      { id: 'images', label: '图片清单', value: '4', unit: '张', change: '主图 1 / 卖点细节 2 / 尺寸说明 1' },
      { id: 'fit', label: '适用范围', value: '13–16', unit: '英寸', change: '未承诺 17 英寸机型' },
      { id: 'detail', label: '详情内容', value: '4', unit: '块', change: '场景、调节、收纳、尺寸' },
      { id: 'verdict', label: '审核结论', value: '通过', kind: 'status', tone: 'positive', change: '移动端字号与图文一致性已复核' },
    ],
    report: { title: '素材审核清单', description: '主图、详情与尺寸说明的核对结果。', content: `# 素材审核清单

## 主图与附图
- 主图展示展开状态的整体形态，附图分别说明六档调节与折叠收纳。

## 详情结构
- 使用场景 → 材质与尺寸 → 六档调节 → 折叠收纳 → 注意事项。

## 尺寸说明
- 独立尺寸图标注 13–16 英寸，未承诺 17 英寸机型；移动端字号需保持可读。

## 待补事项
- 折叠前后尺寸照片待补拍，补齐后替换详情中的临时示意图。
` },
    data: { title: '图片清单', description: '图片用途与数量。', content: `用途,数量,说明
商品主图,1,展开状态侧前视角
卖点细节,2,六档调节与折叠收纳
尺寸说明,1,13–16 英寸适用范围
` },
    checks: [
      { id: 'image-copy', label: '主图与附图覆盖商品形态与细节', status: 'passed' },
      { id: 'fit-copy', label: '13–16 英寸说明与商品资料一致', status: 'passed' },
      { id: 'mobile', label: '移动端字号与图文一致性已复核', status: 'passed' },
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

/** SEO 优化办公室：页面审查与优化清单。 */
function seoResult(producedAt: string): OfficeResultInput {
  return result({
    producedAt,
    team: 'SEO优化办公室',
    title: '产品页 SEO 优化清单',
    summary: '已完成标题、摘要、H1 与内链的检查，形成 3 项文案调整与 1 条内链建议；待实际修改并发布后再观察搜索表现。',
    verdict: '以上为检查结论与建议，不代表线上页面已经修改；请先按清单更新页面与内链，发布后观察搜索表现。',
    metricsTitle: '优化项统计',
    metricsCaption: '按影响范围排序',
    metrics: [
      { id: 'page', label: '待调整项', value: '3', unit: '项', change: '标题、摘要与 H1' },
      { id: 'keyword', label: '核心搜索词', value: '1', unit: '个', change: '折叠电脑支架' },
      { id: 'link', label: '内链建议', value: '1', unit: '条', change: '产品对比页 → 产品页' },
      { id: 'status', label: '检查状态', value: '已完成检查', kind: 'status', tone: 'positive', change: '修改与发布待执行' },
    ],
    report: { title: 'SEO 优化清单', description: '页面文案与内链的改动建议。', content: `# 产品页 SEO 优化清单

## 页面文案
- 标题与 H1 统一围绕「折叠电脑支架」，摘要补充六档调节、便携收纳与使用场景。

## 站内入口
- 在产品对比页增加一条指向产品页的链接，锚文本使用核心词。

## 观察方式
- 当前未接入收录与排名数据，发布后观察搜索表现再决定是否扩展关键词。
` },
    data: { title: '页面改动清单', description: '项目、现状与建议。', content: `项目,现状,建议
页面标题,未包含核心词,加入「折叠电脑支架」
页面摘要,缺少卖点,补充六档调节与便携收纳
H1,与标题不一致,统一核心词
内链,无入口,对比页加一条产品页链接
` },
    checks: [
      { id: 'theme', label: '标题、摘要与 H1 的建议已确认', status: 'passed' },
      { id: 'link', label: '内链建议已标注目标页', status: 'passed' },
      { id: 'order', label: '改动清单已按影响范围排序', status: 'passed' },
    ],
    risks: [{ id: 'data', title: '未接入收录与排名数据', level: 'low', status: 'open', owner: '王明 · 负责人', note: '无法预测排名变化，发布后需观察搜索表现。' }],
    tasks: [
      { id: 'page', title: '检查页面标题与描述', owner: '李研 · 页面审查', status: 'done', progress: 100 },
      { id: 'keyword', title: '整理关键词与内链', owner: '刘市 · 关键词分析', status: 'done', progress: 100 },
      { id: 'plan', title: '输出优化清单', owner: '陈书 · 优化方案', status: 'done', progress: 100 },
    ],
    next: ['先更新产品页标题、摘要与 H1。', '从产品对比页补一条指向产品页的内链。', '发布后观察搜索表现，再决定是否继续扩展关键词。'],
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

## 申报项目（模拟）

| 项目 | 本期数据 | 数据来源 | 状态 |
| --- | --- | --- | --- |
| 销售收入（不含税） | 86,400 元（模拟） | 收支台账 9 月汇总 | 已核对 |
| 销项税额 | 5,184 元（按 6% 模拟计算） | 销售收入 × 6% | 已核对 |
| 进项税额 | 3,200 元（模拟；P-04 待补 800 元） | 发票明细 | 待补凭证 |
| 本期应纳税额 | 1,984 元（模拟：5,184 − 3,200） | 销项税额 − 进项税额 | 待复核 |

## 缺失凭证的影响

- P-04 付款凭证：待补进项 800 元。补齐后进项税额为 4,000 元，本期应纳税额相应降为 1,184 元（模拟）。
- R-06 入账凭证：影响成本费用与原始发票的对应关系，补齐后复核入账口径。

## 复核状态

- 以上金额均为演示模拟值，来源于本期台账与发票明细的模拟数据，未接入真实税务系统。
- 草稿仅供内部复核，凭证补齐前不提交申报，也不代表任何真实申报行为。
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
    note: '以上为本地模拟数据，不接入真实税务系统，不产生申报行为。',
  })
}

/** 自媒体运营办公室：一周内容排期。 */
function socialResult(producedAt: string): OfficeResultInput {
  return result({
    producedAt,
    team: '自媒体运营办公室',
    title: '一周内容排期',
    summary: '一周 3 个发布节点已排定：周一短视频、周三图文、周五评论问答；每类内容对应复盘指标已定义。',
    verdict: '排期可执行；发布前需核对素材与封面，周五按形式分别回填完播、收藏与评论。',
    metricsTitle: '排期概览',
    metricsCaption: '按发布节点与内容形式组织',
    metrics: [
      { id: 'slots', label: '发布节点', value: '3', unit: '个', change: '周一、周三、周五' },
      { id: 'formats', label: '内容形式', value: '3', unit: '种', change: '短视频、图文、评论问答' },
      { id: 'review', label: '复盘维度', value: '3', unit: '项', change: '完播、收藏、评论' },
      { id: 'status', label: '排期状态', value: '已确认', kind: 'status', tone: 'positive', change: '发布前核对素材与封面' },
    ],
    report: { title: '一周内容排期', description: '选题、形式与复盘安排。', content: `# 一周内容排期

## 发布节点
- 周一：短视频，用三步整理法打开话题。
- 周三：图文，用前后对比展示结果。
- 周五：评论问答，整理高频问题并纳入下周选题。

## 复盘
- 按内容形式分别记录完播、收藏与评论，周五统一复盘。
` },
    data: { title: '发布排期', description: '日期、形式与内容重点。', content: `日期,形式,内容重点,复盘指标
周一,短视频,线材归置三步法,完播
周三,图文,前后对比展示,收藏
周五,评论问答,高频问题整理,评论
` },
    checks: [
      { id: 'audience', label: '选题与受众关注点对齐', status: 'passed' },
      { id: 'schedule', label: '三种内容形式已排期', status: 'passed' },
      { id: 'metrics', label: '复盘指标已按形式定义', status: 'passed' },
    ],
    risks: [{ id: 'manual', title: '平台数据需人工回填', level: 'low', status: 'open', owner: '王明 · 负责人', note: '完播、收藏与评论需发布后手动记录。' }],
    tasks: [
      { id: 'topic', title: '梳理受众与选题', owner: '刘市 · 选题策划', status: 'done', progress: 100 },
      { id: 'draft', title: '起草短视频和图文', owner: '陈书 · 内容制作', status: 'done', progress: 100 },
      { id: 'schedule', title: '整理发布排期', owner: '赵审 · 运营排期', status: 'done', progress: 100 },
    ],
    next: ['发布前核对素材与封面。', '按周一、周三、周五节点发布。', '周五按内容形式记录完播、收藏与评论并复盘。'],
  })
}

/** 信息采集办公室：公开资料采集、去重与来源校验。 */
function collectionResult(producedAt: string): OfficeResultInput {
  return result({
    producedAt,
    team: '信息采集办公室',
    title: '公开资料采集与校验',
    summary: '公开来源采集 18 条记录，合并重复后保留 15 条，其中 13 条出处已核验，2 条待核实。',
    verdict: '已核验记录可归档使用；2 条待核实记录单独标注来源，核对主办方公告后再合入正式清单。',
    metricsTitle: '采集与校验',
    metricsCaption: '按记录处理阶段统计',
    metrics: [
      { id: 'raw', label: '原始记录', value: '18', unit: '条', change: '公开活动页与订阅来源' },
      { id: 'kept', label: '去重后保留', value: '15', unit: '条', change: '合并 3 条重复记录', tone: 'positive' },
      { id: 'verified', label: '出处已核验', value: '13', unit: '条', change: '保留标题、日期与来源链接' },
      { id: 'pending', label: '待核实', value: '2', unit: '条', kind: 'text', change: '暂不并入正式清单', tone: 'negative' },
    ],
    report: { title: '采集与校验报告', description: '采集范围、去重规则与核验结果。', content: `# 公开资料采集与校验报告

## 采集范围
- 公开活动页与订阅来源，共 18 条记录。

## 处理过程
- 按标题、主办方与日期归并重复发布，合并 3 条后保留 15 条。

## 核验结果
- 13 条出处已核验；2 条暂无法确认，单独标注来源待核实。
` },
    data: { title: '记录处理清单', description: '各阶段数量与说明。', content: `阶段,数量,说明
原始提取,18,公开活动页与订阅来源
去重保留,15,合并 3 条重复发布
出处已核验,13,保留标题日期主办方链接
待核实,2,来源待主办方公告确认
` },
    checks: [
      { id: 'dedupe', label: '重复发布已合并', status: 'passed' },
      { id: 'source', label: '每条记录保留出处', status: 'passed' },
      { id: 'separate', label: '待核实记录已单列', status: 'passed' },
    ],
    risks: [{ id: 'pending', title: '2 条记录出处待核实', level: 'low', status: 'open', owner: '王明 · 负责人', note: '暂不并入正式清单，等主办方公告确认。' }],
    tasks: [
      { id: 'sources', title: '整理待采集来源', owner: '李研 · 来源检索', status: 'done', progress: 100 },
      { id: 'extract', title: '提取记录并去重', owner: '赵审 · 信息提取', status: 'done', progress: 100 },
      { id: 'verify', title: '复核来源并归档', owner: '周理 · 来源校验', status: 'done', progress: 100 },
    ],
    next: ['复核 2 条待确认记录。', '核对主办方公告。', '合入正式清单并保留出处链接。'],
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

## 已确认
- 交付时间：周三 15:00，以项目确认邮件为准。

## 变更请求
- 群聊提出改期到周四，保留为待确认建议，未采纳为结论。

## 待确认
- 封面设计需设计负责人确认。
- 表单中的验收人缺失，需项目负责人补齐。
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
    note: spec.note ?? '以上为本地模拟数据，不连接真实外部系统、不产生实际业务操作。',
  }
}

export function scenarioResult(id: DemoScenarioId, at: Date): OfficeResultInput | undefined {
  const producedAt = stamp(at)
  if (id === 'office-1') return listingResult(producedAt)
  if (id === 'office-content') return contentResult(producedAt)
  if (id === 'office-analysis') return analysisResult(producedAt)
  if (id === 'office-demo-seo') return seoResult(producedAt)
  if (id === 'office-demo-tax') return taxResult(producedAt)
  if (id === 'office-demo-social') return socialResult(producedAt)
  if (id === 'office-demo-collection') return collectionResult(producedAt)
  if (id === 'office-demo-digest') return digestResult(producedAt)
  return undefined
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
    note: '以上为本地模拟数据，不连接真实店铺、不产生费用。',
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
    note: '以上为本地模拟数据，不连接真实店铺、不产生费用；两轮窗口无对照组，结论仅用于演示。',
  }
}

/** True only when the scenario finishes with a readable result. */
export function hasScenarioResult(id: DemoScenarioId) {
  return scenarioResult(id, new Date()) !== undefined
}
