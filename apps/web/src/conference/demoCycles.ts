type WorkItem = {
  label: string
  source: string
  detail: string
  status: string
}

import type { DemoScenarioId } from './demoDialogue.ts'
import type { EditorialPlan } from './demoEditorial.ts'
import { socialCases } from './demoSocialCases.ts'

export type DemoCase = {
  title: string
  request: string
  summary?: string
  handoffs?: readonly [string, string, string]
  editorial?: EditorialPlan
  items: readonly WorkItem[]
  next: string
}

export type CycleOfficeId = 'office-demo-social' | 'office-demo-collection'

const collectionCases: readonly DemoCase[] = [
  {
    title: '周四彩排 · 会前准备简报',
    request: '帮我汇总周四彩排的时间、地点和要带的材料。',
    summary: '周四 14:00 彩排已确认，地点 A201 与 B105 存在未决变更；签到表已齐，演示稿仍缺最终版。场地周三 17:00 前、材料周四 12:00 前分别收口。',
    handoffs: ['先把会务邮件、群消息和任务表按时间排好，场地的调整建议不要当成通知。', '核对 A201 与 B105 的冲突，请会务负责人确认；演示稿要区分评审稿和最终版。', '把时间、地点和材料分栏，写明负责人、截止时间和来源，缺的先标待确认。'],
    items: [
      { label: '彩排时间', source: 'E01：周二 09:20 项目组邮件《周四彩排安排》',
        detail: '周四 14:00 开始，参演人员提前 10 分钟到场。', status: '已确认' },
      { label: '彩排地点', source: 'E01 邮件写 A201；M02 周二 14:10 会务群留言提到可能改到 B105',
        detail: '会务组还没有发出确认改场通知，请会务负责人周三 17:00 前确认。', status: '待确认' },
      { label: '演示材料', source: 'T03：筹备任务表《彩排材料》周二 16:00 版本',
        detail: '签到表已齐。演示稿只有评审稿，请陈书在周四 12:00 前给最终版。', status: '待补齐' },
    ],
    next: '先向会务组确认场地，再把最终版演示稿和签到表打包。',
  },
  {
    title: '项目碰头会 · 进度和待拍板事项',
    request: '帮我整理明天开会要讲的进度，还有哪些事需要我拍板。',
    summary: '页面与测试资料已交付，联调卡在测试账号权限。会上需要决定主流程验收范围；若中午仍未开权限，再决定是否启用预录备用方案。',
    items: [
      { label: '当前进度', source: '项目周报、联调任务表',
        detail: '页面和测试资料已交付。联调仍卡在测试账号权限，李研明早 10:00 前补进展。', status: '已核对' },
      { label: '验收范围', source: '上次会议纪要第 2 项',
        detail: '需要你决定本周验收是否先覆盖主流程。王明在明天会上收结论。', status: '待你决定' },
      { label: '备用演示方案', source: '风险表第 3 项',
        detail: '如果明天中午权限仍未开通，需要你决定是否改用预录画面。', status: '待你决定' },
    ],
    next: '会上先报交付和权限卡点，再逐项确认验收范围及备用方案。',
  },
  {
    title: '来访接待 · 人员和动线确认',
    request: '帮我确认周五来访名单、前台登记和现场接待安排。',
    summary: '周五 10:30 南门接待已确认；来访 4 人、前台仅录入 3 人，仍缺 1 人登记。展厅预约冲突，接待路线尚未确定。',
    items: [
      { label: '来访时间', source: '访客确认邮件和接待日历',
        detail: '周五 10:30 到南门前台，陈书在前台接应。', status: '已确认' },
      { label: '访客名单', source: '外部联系人邮件附件、前台预约表',
        detail: '邮件列了 4 人，前台表已录 3 人，请陈书周四下班前补登最后一位。', status: '待补齐' },
      { label: '讲解路线', source: '接待群记录和展厅预约表',
        detail: '原计划先到展厅，遇到同时间预约。请会务组确认是否先去会议室。', status: '待确认' },
    ],
    next: '优先补全登记，再把确认后的路线发给现场接待人。',
  },
  {
    title: '供应商报价 · 价格和交期汇总',
    request: '把演示物料的两家报价和交期整理一下，告诉我还差什么。',
    summary: '按同规格 20 件对齐：甲 2400 元、乙 2280 元。乙方税费与运费口径尚缺，交期起算条件也需核对，目前不能据 120 元差额直接选供应商。',
    items: [
      { label: '供应商甲', source: '供应商甲报价单第 2 版',
        detail: '同规格 20 件共 2400 元，含税含运费，确认稿件及付款后 5 个工作日到货。', status: '已核对' },
      { label: '供应商乙', source: '供应商乙邮件及附件报价单',
        detail: '同规格 20 件报价 2280 元，写有 4 个工作日；含税、运费及交期从何时起算都未写清。', status: '待确认' },
      { label: '报价比较', source: '采购需求单和两份报价',
        detail: '同以 20 件比较，甲的交付口径完整。请周理今天 16:00 前补问乙方含税及运费条件。', status: '待补齐' },
    ],
    next: '补齐乙方报价条件后再比较总价，并把两家的到货日期对齐。',
  },
  {
    title: '本周待办 · 会议行动项核对',
    request: '看一下纪要和任务表，整理本周谁要做什么、什么时候交。',
    summary: '演示稿由陈书周三 18:00 前交；周理仍缺一份图片授权回执；周五复盘时间已发，但主持人未定，需王明周四下班前确认。',
    items: [
      { label: '演示稿复核', source: '周一纪要第 1 项与任务表',
        detail: '陈书周三 18:00 前交复核稿，王明周四上午给修改意见。', status: '已确认' },
      { label: '素材授权回执', source: '素材群消息和授权登记表',
        detail: '周理负责，登记表里少一份图片授权回执，周五发布前补齐。', status: '待补齐' },
      { label: '周五复盘主持', source: '会议纪要写待定，日历已有会议邀请',
        detail: '会议时间已发出，主持人仍无确认记录，请王明周四下班前指定。', status: '待确认' },
    ],
    next: '把两个待跟进项分别发给负责人，周四下班前收一次状态。',
  },
]

export const demoCycles = {
  'office-demo-social': { cases: socialCases, startupDelayMs: 0, startPhrases: ['开始维护', '开始排期', '开始做内容计划', '开始写稿', '开始做图文'] },
  'office-demo-collection': { cases: collectionCases, startupDelayMs: 10_500, startPhrases: ['开始采集', '整理资料', '开始整理简报'] },
} satisfies Record<CycleOfficeId, { cases: readonly DemoCase[]; startupDelayMs: number; startPhrases: readonly string[] }>

export function isCycleOffice(id: DemoScenarioId): id is CycleOfficeId {
  return id === 'office-demo-social' || id === 'office-demo-collection'
}

export function demoCycle(id: DemoScenarioId) {
  return isCycleOffice(id) ? demoCycles[id] : undefined
}

export function cycleQuestions(id: DemoScenarioId, current: DemoCase) {
  return id === 'office-demo-social'
    ? [`给我看${current.editorial?.drafts[0].platform ?? '小红书'}正文`, '配图每页写什么？', '哪些内容还没发布？']
    : ['先给我重点', `${current.items[0].label}是什么情况？`, '还有什么没确认？']
}

export function formatWorkItems(items: readonly WorkItem[]) {
  return items.map(item => `- **${item.label}（${item.status}）** ${item.detail}\n  依据：${item.source}。`).join('\n')
}
