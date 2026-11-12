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

- 商品访问 360 → 350 次（-2.8%），曝光没有变化。
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
尺寸/机型咨询（条）,6,10,"首轮 10 条咨询中 6 条"
`

/**
 * Demo-only: the structured result a finished walkthrough leaves on the whiteboard.
 * Only scenarios whose story actually ends in a deliverable get one; the others keep the
 * honest "任务已结束，但尚未收到成果内容" empty state instead of inventing data.
 */
export function scenarioResult(id: DemoScenarioId, at: Date): OfficeResultInput | undefined {
  const producedAt = stamp(at)
  if (id === 'office-1') return listingResult(producedAt)
  if (id === 'office-analysis') return analysisResult(producedAt)
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
