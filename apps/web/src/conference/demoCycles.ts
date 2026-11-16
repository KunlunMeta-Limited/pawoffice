type WorkItem = {
  label: string
  source: string
  detail: string
  status: string
}

import type { DemoScenarioId } from './demoDialogue.ts'

export type DemoCase = {
  title: string
  request: string
  items: readonly WorkItem[]
  next: string
}

export type CycleOfficeId = 'office-demo-social' | 'office-demo-collection'

const socialCases: readonly DemoCase[] = [
  {
    title: '折叠电脑支架 · 适用尺寸更新',
    request: '检查三个平台的支架内容，把容易误解的适用尺寸补齐。',
    items: [
      { label: '抖音', source: '「支架展开演示」旧视频评论集中追问能否放 17 英寸电脑',
        detail: '补拍 13 英寸和 16 英寸机型的放置镜头，字幕标注适用 13–16 英寸。', status: '待审核' },
      { label: '小红书', source: '「小桌面支架选购」旧笔记只写了适合笔记本',
        detail: '把「适用 13–16 英寸」移到选购清单首项，提醒读者核对实际机身尺寸。', status: '待审核' },
      { label: '微信公众号', source: '产品说明页缺少尺寸常见问题',
        detail: '补充「17 英寸能用吗？」问答，注明 17 英寸不在本款标注的适用范围内。', status: '待审核' },
    ],
    next: '负责人对照商品规格复核三份稿件，审核通过后再安排更新。',
  },
  {
    title: '桌面补光灯 · 留言答疑',
    request: '按各平台留言整理补光灯摆位和屏幕反光的答疑。',
    items: [
      { label: '抖音', source: '「视频会议补光」评论询问灯应该放在什么位置',
        detail: '拍摄正面和侧前方摆位对比，展示灯头略高于视线时的画面。', status: '待审核' },
      { label: '小红书', source: '「小桌面照明」笔记留言反馈显示器反光',
        detail: '补一张灯头角度对照图，提示先向外转动灯头，再检查屏幕反光。', status: '待审核' },
      { label: '微信公众号', source: '后台留言同时问到灯位和摄像头曝光',
        detail: '整理视频会议设置步骤，从调整灯位开始，再检查摄像头曝光。', status: '待审核' },
    ],
    next: '复核三份答疑能否用同一组实拍还原，再安排更新。',
  },
  {
    title: '显示器增高架 · 旧内容参数校对',
    request: '根据新版规格卡，统一三个平台仍在使用旧参数的内容。',
    items: [
      { label: '抖音', source: '旧口播提到 50 厘米，新版规格卡标注 48 厘米',
        detail: '补录口播并同步字幕，将新版桌面增高架的宽度标为 48 厘米。', status: '待审核' },
      { label: '小红书', source: '旧图文的尺寸图沿用了 50 厘米样品',
        detail: '替换为新版尺寸图，并在笔记首段区分旧款和新版。', status: '待审核' },
      { label: '微信公众号', source: '购买指南把两个版本写在同一规格表',
        detail: '分两行标注旧版 50 厘米、新版 48 厘米，提醒按购买版本核对。', status: '待审核' },
    ],
    next: '逐条对照新版规格卡核验数字，留存改稿记录。',
  },
  {
    title: '桌面理线夹 · 售后问题答疑',
    request: '把常见的安装留言整理成各平台可复用的回复稿。',
    items: [
      { label: '抖音', source: '安装视频下最常见的问题是粘贴前怎么处理桌面',
        detail: '补拍清洁并晾干桌面、按压胶贴的过程，供评论区回复引用。', status: '待审核' },
      { label: '小红书', source: '安装笔记留言问粗线和细线能否放在同一个槽',
        detail: '补充先量线径再选择槽位的图示，提醒不要硬塞超过槽宽的线。', status: '待审核' },
      { label: '微信公众号', source: '售后摘要里有用户询问胶贴脱落怎么处理',
        detail: '补充排查步骤，先看表面清洁情况和胶贴是否受损，再引导联系售后。', status: '待审核' },
    ],
    next: '让售后负责人复核操作步骤，再将答疑稿加入各平台维护清单。',
  },
  {
    title: '桌面收纳 · 平台反馈与下一批更新',
    request: '汇总三端回访反馈，给下一批内容排出修改优先级。',
    items: [
      { label: '抖音', source: '近一批留言重复询问整理前后差异',
        detail: '在下一条视频开头先放同机位的整理前后对照，再讲过程。', status: '待排期' },
      { label: '小红书', source: '清单笔记的留言主要追问收纳盒选型',
        detail: '新增一张按桌面宽度选择收纳盒的对照表，并补选型示例。', status: '待排期' },
      { label: '微信公众号', source: '往期文章的读者问答已有多篇内容可复用',
        detail: '整理一页桌面收纳问答索引，按线材、桌面分区和工具选型分类。', status: '待排期' },
    ],
    next: '先排三端都反馈过的示例不够清楚一项，再逐平台补资料。',
  },
]

const collectionCases: readonly DemoCase[] = [
  {
    title: '周四彩排 · 会前准备简报',
    request: '帮我汇总周四彩排的时间、地点和要带的材料。',
    items: [
      { label: '彩排时间', source: '项目组邮件《周四彩排安排》',
        detail: '周四 14:00 开始，参演人员提前 10 分钟到场。', status: '已确认' },
      { label: '彩排地点', source: '邮件写 A201；会务群留言提到可能改到 B105',
        detail: '会务组还没有发出确认改场通知，请会务负责人周三 17:00 前确认。', status: '待确认' },
      { label: '演示材料', source: '筹备任务表《彩排材料》',
        detail: '签到表已齐。演示稿只有评审稿，请陈书在周四 12:00 前给最终版。', status: '待补齐' },
    ],
    next: '先向会务组确认场地，再把最终版演示稿和签到表打包。',
  },
  {
    title: '项目碰头会 · 进度和待拍板事项',
    request: '帮我整理明天开会要讲的进度，还有哪些事需要我拍板。',
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
    items: [
      { label: '供应商甲', source: '供应商甲报价单第 2 版',
        detail: '同规格 20 件共 2400 元，含税，到货需 5 个工作日。', status: '已核对' },
      { label: '供应商乙', source: '供应商乙邮件及附件报价单',
        detail: '同规格 20 件报价 2280 元，预计 4 个工作日。报价单没有写是否含运费。', status: '待确认' },
      { label: '报价比较', source: '采购需求单和两份报价',
        detail: '同以 20 件比较，甲的交付口径完整。请周理今天 16:00 前补问乙方含税及运费条件。', status: '待补齐' },
    ],
    next: '补齐乙方报价条件后再比较总价，并把两家的到货日期对齐。',
  },
  {
    title: '本周待办 · 会议行动项核对',
    request: '看一下纪要和任务表，整理本周谁要做什么、什么时候交。',
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
  'office-demo-social': { cases: socialCases, startupDelayMs: 0, startPhrases: ['开始维护', '开始排期', '开始做内容计划'] },
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
    ? [`这轮维护哪些${current.title.split(' · ')[0]}内容？`, '小红书这条具体改了什么？', '哪些内容还没发布？']
    : ['先给我重点', `${current.items[0].label}是什么情况？`, '还有什么没确认？']
}

export function formatWorkItems(items: readonly WorkItem[]) {
  return items.map(item => `- **${item.label}（${item.status}）** ${item.detail}\n  依据：${item.source}。`).join('\n')
}
