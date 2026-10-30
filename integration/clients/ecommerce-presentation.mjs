// Authored business presentation data. Uses only the existing public protocol.
// Agent roles describe simulated collaboration, not a claim of real agent execution.
import { OFFICE_ROSTER } from '@pawoffice/scene-office/core/roster'

const roleActors = { lead: 'office-lead', planner: 'code-agent', organizer: 'file-agent', writer: 'app-agent', analyst: 'review-agent', reviewer: 'data-agent' }
const actorRoles = { lead: '项目统筹', planner: '信息检索与上市计划', organizer: '资料整理与构图', writer: '商品文案', analyst: '市场分析与预算', reviewer: '内容审核与资料复核' }
export const ecommerceAgents = Object.entries(roleActors).map(([role, id]) => {
  const actor = OFFICE_ROSTER.find(actor => actor.id === id)
  if (!actor) throw new Error(`电商演示绑定的人物不存在：${id}`)
  return { id, sceneActorId: id, name: actor.name, role: actorRoles[role], online: true }
})
const agentName = role => ecommerceAgents.find(agent => agent.id === roleActors[role]).name

const phaseProgress = [[100, 0, 0], [100, 70, 0], [100, 100, 0], [100, 100, 70], [100, 100, 100]]
const taskSpecs = [
  ['scope', '明确商品信息与任务边界', 'lead', 1, '任务书记录售价、库存、成本和缺失参数。'],
  ['plan', '编制14天上市计划', 'planner', 2, '当前计划保留首三天数据，后续安排不冒充已执行。'],
  ['copy', '交付标题与详情文案', 'writer', 2, '未知重量、尺寸和承重不填入可发布文案。'],
  ['budget', '分配并核对推广预算', 'analyst', 2, '预算从3000调整为1800元，已花费360元，剩余1440元。'],
  ['visual', '制作商品页构图示意', 'organizer', 2, '仅评审信息层次；示意图不能当成真实商品照片。'],
  ['observe', '复盘首三天经营数据', 'analyst', 4, '输入为商家提供的模拟数据，不代表系统已接入店铺。'],
  ['review', '复核当前资料版本', 'reviewer', 5, '只核对预算、当前版本和文案边界，不替代商家验收。'],
  ['approval', '补齐实测参数并确认上架', 'lead', 99, '等待商家提供实测重量、尺寸与承重，并明确上架授权。'],
]

const text = value => ({ type: 'text', text: value })
const table = (label, columns, rows) => ({ type: 'table', label, columns: columns.map(([key, label, format = 'text']) => ({ key, label, format })), rows })
const custom = (id, title, blocks, extra = {}) => ({ kind: 'custom', id, title, span: 'full', layout: 'stack', blocks, ...extra })
const money = n => n >= 3 ? 1800 : 3000

export function ecommercePresentation(number, current, now) {
  const observed = number >= 4, approved = number >= 5
  const tasks = taskSpecs.map(([id, title, ownerId, doneAt, note]) => {
    const done = number >= doneAt
    const status = done ? 'done' : id === 'approval' && number >= 2 ? 'blocked' : number + 1 >= doneAt ? 'doing' : 'todo'
    const taskNote = id === 'budget' && !observed ? `预算上限${money(number)}元；尚未收到消耗数据，不计算剩余额度。`
      : id === 'plan' && !observed ? '按14天安排准备与观察；未执行真实上架。' : note
    return { id, title, owner: agentName(ownerId), status, progress: done ? 100 : status === 'doing' ? 40 : 0, note: taskNote }
  })
  const doneCount = tasks.filter(task => task.status === 'done').length
  const summaries = [
    '任务范围已明确，六位办公室成员已分工。下一步制作上市计划、文案与预算；商品实测参数仍待商家补齐。',
    '首版上市资料和商品页构图已交付，预算上限3000元。参数实测与上架授权尚未完成，暂不可直接发布。',
    '已将预算降至1800元，删除直播备选及无依据承诺。沿用任务书与构图示意，下一步等待观察数据。',
    '首三天模拟数据已复盘：有效订单10单、收入790元、消耗360元。后续预算1440元；优先观察搜索流量，暂不扩大投放。',
    '资料复核完成，当前七份产物可查看。预算与文案检查通过；实测参数和商家授权仍缺失，因此上线任务继续受阻。',
  ]
  const metrics = observed ? [
    { id: 'orders', label: '有效订单', value: '10', unit: '单', kind: 'value', emphasis: 'primary', change: '支付12单，取消2单', tone: 'positive' },
    { id: 'conversion', label: '有效转化率', value: '1.67', unit: '%', kind: 'value', change: '有效订单 / 点击600次', tone: 'neutral' },
    { id: 'spend', label: '广告消耗', value: '360', unit: '元', kind: 'value', change: '预算1800元，剩余1440元' },
    { id: 'progress', label: '资料任务完成', value: `${doneCount}/8`, unit: '项', kind: 'target', progress: doneCount / 8 * 100, target: '资料核对后由商家确认上线', targetStatus: 'at-risk' },
  ] : [
    { id: 'price', label: '商品售价', value: '79', unit: '元', kind: 'value' },
    { id: 'inventory', label: '可用库存', value: '500', unit: '件', kind: 'value' },
    { id: 'budget', label: '预算上限', value: String(money(number)), unit: '元', kind: number >= 3 ? 'comparison' : 'value', ...(number >= 3 ? { previous: '3000 元', change: '-40%', trend: 'down' } : {}) },
    { id: 'progress', label: '资料任务完成', value: `${doneCount}/8`, unit: '项', kind: 'target', progress: doneCount / 8 * 100, target: '全部资料可核验', targetStatus: 'at-risk' },
  ]
  const risks = [
    { id: 'parameters', title: '实测参数缺失，商品页尚不能直接发布', level: 'high', status: 'open', owner: `商家 / ${agentName('lead')}`, note: '需要提供重量、展开与折叠尺寸、承重实测。不能用示意图补造真实参数。' },
    { id: 'authorization', title: '上架和广告投放尚未获得授权', level: 'high', status: 'open', owner: '商家', note: '当前仅交付资料与模拟复盘；所有外部操作等待明确授权。' },
    { id: 'cost', title: '利润口径不完整', level: 'medium', status: observed ? 'mitigating' : 'open', owner: agentName('analyst'), note: observed ? '790－10×32－360＝110元为估算贡献，未扣退款、税费及其他固定成本，不是净利润。' : '每件成本暂按32元估算；平台费用需按实际账单修正。' },
    ...(number >= 3 ? [{ id: 'claims', title: '夸大宣传风险已从文案中移除', level: 'medium', status: 'closed', owner: agentName('writer'), note: '本轮已删除治疗、排名等无依据承诺；新参数仍需复核。' }] : []),
  ]
  const decisions = [
    { id: 'scope', question: '本次任务是否直接执行真实店铺操作？', choice: '先交付准备资料；外部执行由商家另行授权', at: now },
    ...(number >= 3 ? [{ id: 'channel', question: '预算压缩后如何选择渠道？', choice: '仅保留搜索，预算1800元，取消直播备选', at: now }] : []),
    ...(observed ? [{ id: 'scale', question: '首三天数据能否支持扩大投放？', choice: '暂不扩大；样本仅10个有效订单，继续观察', at: now }] : []),
  ]
  const sections = []
  const source = id => {
    const file = current.find(item => item.id === id)
    return { artifactId: file.id, versionId: file.versionId }
  }
  if (number >= 2) {
    sections.push(custom('budget-allocation', '14天预算安排', [
      { type: 'chart', chart: 'pie', label: `预算分配 · 合计${money(number)}元`, unit: '元', series: (number >= 3 ? [360, 980, 460] : [600, 1750, 650]).map((value, i) => ({ label: ['首轮3天', '优化7天', '收尾4天'][i], value, tone: i === 0 ? 'positive' : 'neutral' })) },
      text(observed ? '总预算1800元，首三天消耗360元，后续额度1440元。预算上限不等于必须花完的目标。' : '尚未收到经营观察数据；这里显示预算方案，不将计划绘制成实际消耗。'),
    ], { purpose: 'analysis', ...source('budget') }))
    if (observed) sections.push(custom('business-observation', '首三天经营复盘', [
      { type: 'chart', chart: 'line', label: '首三天有效订单 · 模拟数据', unit: '单', series: [2, 3, 5].map((value, i) => ({ label: `第${i + 1}天`, value, tone: 'positive' })) },
      table('逐日观察明细', [['day', '观察日'], ['impressions', '曝光', 'number'], ['clicks', '点击', 'number'], ['orders', '有效订单', 'number'], ['spend', '消耗/元', 'number']], [
        { day: '第1天', impressions: '7000', clicks: '160', orders: '2', spend: '120' },
        { day: '第2天', impressions: '8000', clicks: '200', orders: '3', spend: '120' },
        { day: '第3天', impressions: '9000', clicks: '240', orders: '5', spend: '120' },
      ]),
      { type: 'callout', tone: 'warning', title: '观察不等于因果', text: '有效订单10单、有效转化率1.67%、收入/广告消耗2.19。样本较小，不能把增长归因于文案更新。' },
    ], { purpose: 'analysis', ...source('review') }))
    sections.push(custom('content-delivery', '商品文案内容', [
      text(current.find(item => item.id === 'listing').content),
    ], { purpose: 'artifact-preview', ...source('listing') }))
  }
  if (number === 1) sections.push(custom('project-scope', '本轮确认的任务范围', [
    { type: 'keyValue', items: [{ label: '商品', value: '79元折叠电脑支架 / 库存500件' }, { label: '周期', value: '14天上市准备与观察' }, { label: '预算', value: '初始上限3000元' }, { label: '执行边界', value: '不直接发布、不扣费、不进行真实投放' }] },
    { type: 'callout', tone: 'warning', title: '资料待补齐', text: '缺少重量、尺寸、承重实测，以及真实商品照片；先完成能够核验的资料。' },
  ], { purpose: 'analysis', ...source('brief') }))

  const detailSections = [
    { id: 'scope-detail', title: '任务背景与交付标准', blocks: [
      text('青禾桌面是一家新开店铺，希望用有限预算验证电脑支架的搜索流量与商品页转化。本任务把商品事实、内容交付、预算方案、经营观察和授权边界放在同一份工作流中。'),
      { type: 'keyValue', items: [{ label: '业务目标', value: '完成可评审的上市资料，并根据首轮数据提出优化建议' }, { label: '验收标准', value: '预算可核算、文案不夸大、产物可追溯、缺失信息明确' }, { label: '已知成本', value: '商品与包材21元＋运费6元＋平台暂估5元＝32元/件' }, { label: '当前边界', value: '真实上架与投放仍待商家授权' }] },
    ] },
    { id: 'agent-collaboration', title: 'Agent分工与交接', blocks: [
      table('办公室成员的协作职责', [['agent', 'Agent', 'owner'], ['role', '负责内容'], ['input', '输入依据'], ['output', '交付与交接']], [
        { agent: agentName('lead'), role: '统筹与边界', input: '商家目标、约束、每轮反馈', output: '任务拆解；向商家追问待补信息' },
        { agent: agentName('planner'), role: '14天运营计划', input: '任务书、预算与观察结论', output: `上市计划；交由${agentName('analyst')}核算预算` },
        { agent: agentName('organizer'), role: '资料整理与构图', input: '已确认商品事实与文案', output: `构图示意与资料目录；交由${agentName('reviewer')}检查` },
        { agent: agentName('writer'), role: '标题与详情文案', input: '商品已确认事实', output: `文案；交由${agentName('reviewer')}检查` },
        { agent: agentName('analyst'), role: '预算与数据复盘', input: observed ? '1800元预算、首三天模拟数据' : `${money(number)}元预算约束`, output: '预算表与经营口径；不保证销量' },
        { agent: agentName('reviewer'), role: '当前版本复核', input: '计划、预算、文案的指定版本', output: approved ? '3项资料检查通过；上线条件仍待补齐' : '按阶段检查资料；最终复核尚未完成' },
      ]),
      { type: 'diagram', alt: '从任务拆解到复核及商家确认的交接关系', source: `flowchart LR\n A[${agentName('lead')} 目标与边界] --> B[${agentName('planner')} 上市计划]\n A --> C[${agentName('writer')} 商品文案]\n C --> H[${agentName('organizer')} 资料与构图]\n B --> D[${agentName('analyst')} 预算与观察]\n C --> E[${agentName('reviewer')} 资料复核]\n H --> E\n D --> E\n E --> F{商家确认}\n F -->|补充参数| A\n F -->|授权后另行执行| G[真实上架与投放]` },
    ] },
    { id: 'acceptance-detail', title: '阶段验收与待确认事项', blocks: [
      { type: 'list', items: [
        { text: '商品事实与缺失信息已明确', status: 'passed' },
        { text: '计划、文案、预算、示意稿已交付', status: number >= 2 ? 'passed' : 'pending' },
        { text: '预算调整同步更新文案和计划', status: number >= 3 ? 'passed' : 'pending' },
        { text: '经营数据口径与计算可复核', status: observed ? 'passed' : 'pending' },
        { text: '对当前采用版本完成资料复核', status: approved ? 'passed' : 'pending' },
        { text: '商家提供实测参数和上架授权', status: 'pending' },
      ] },
      { type: 'callout', tone: 'warning', title: '资料通过与业务完成分开', text: '资料检查通过只说明已提供内容一致；参数缺失、真实图片和授权仍然阻塞实际上线。' },
    ] },
  ]
  return {
    board: { title: '青禾桌面 · 折叠支架上市项目', description: '以79元折叠电脑支架为对象，完成14天上市准备、内容制作、预算安排和首轮经营复盘；实测参数与外部执行由商家确认。',
      summary: summaries[number - 1], status: number >= 2 ? 'blocked' : 'running', tagline: '从商品事实到经营决策',
      steps: ['目标与拆解', '内容与预算', '观察与复核'].map((title, i) => ({ id: `phase-${i}`, title, progress: phaseProgress[number - 1][i] })), detailSections },
    result: { summary: summaries[number - 1], verdict: approved ? '资料一致性已验证，上线条件尚未满足。请先补齐参数、真实图片与授权。' : '先核验商品事实和预算，再由商家决定是否进入真实上线。',
      owner: `${agentName('lead')} · 项目统筹`, team: '电商协作 Agent', teamSize: ecommerceAgents.length, updatedAt: now, metricsTitle: observed ? '首三天经营观察' : '任务与资源', metricsCaption: observed ? '商家提供的模拟观察数据；取消订单已扣除' : '已确认事实与本轮约束；非实际经营数据',
      metrics, tasks, risks, decisions, sections,
      next: approved ? ['商家提供重量、尺寸、承重实测，并替换构图示意为实拍图。', '确认1800元预算和后续1440元安排，单独授权上架与投放。', '接入退款与实际费用后，再判断是否扩大投放。'] : ['继续发送下一轮需求，查看计划、文案和预算如何同步更新。', '请商家补齐真实商品参数和上架授权。'],
      note: '本案例的协作、经营数据和交付均为模拟。六位办公室成员用于展示后端分工数据；未调用真实模型，未接入或操作真实店铺。' },
    dashboardTasks: tasks.map(task => ({ id: task.id, title: task.title, assigneeId: roleActors[taskSpecs.find(spec => spec[0] === task.id)[2]], status: ({ todo: 'queued', doing: 'running', blocked: 'blocked', done: 'completed' })[task.status], progress: task.progress, updatedAt: now, summary: task.note })),
  }
}
