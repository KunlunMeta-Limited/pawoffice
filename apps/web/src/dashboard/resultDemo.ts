import type { OfficeResult, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'

const metrics: OfficeResult['metrics'] = [
  { id: 'impressions', label: '曝光', value: '10,000', unit: '次', previous: '10,000 次', change: '+0.0%', trend: 'flat', tone: 'neutral' },
  { id: 'visits', label: '商品访问', value: '350', unit: '次', previous: '360 次', change: '-2.8%', trend: 'down', tone: 'neutral' },
  { id: 'orders', label: '订单', value: '14', unit: '单', previous: '9 单', change: '+5 单', trend: 'up', tone: 'positive' },
  { id: 'conversion', label: '访问成交率', value: '4.0', unit: '%', previous: '2.5%', change: '+1.5pp', trend: 'up', tone: 'positive' },
  { id: 'revenue', label: '成交额', value: '1,106', unit: '元', previous: '711 元', change: '+55.6%', trend: 'up', tone: 'positive' },
  { id: 'price', label: '成交单价', value: '79', unit: '元', previous: '79 元', change: '保持不变', trend: 'flat', tone: 'neutral' },
]

const artifacts: OfficeResult['artifacts'] = [
  {
    id: 'page-changes', kind: 'document', title: '商品页改动清单',
    description: '标题、主图、尺寸说明与详情顺序的 6 项改动。',
    url: '',
    content: `## 已完成的改动

| 位置 | 改动 | 状态 |
| --- | --- | --- |
| 商品标题 | 补充“六档调节・便携收纳” | 已上线 |
| 主图 | 首图展示完整商品，去掉遮挡装饰 | 已上线 |
| 尺寸说明 | 新增 13–16 英寸适用范围 | 已上线 |
| 详情顺序 | 尺寸信息移到材质说明之前 | 已上线 |
| 折叠说明 | 增加折叠前后尺寸测量图 | 待补拍 |
| 注意事项 | 说明摆放与收纳要求 | 已上线 |

> 所有对外参数必须与供应商资料一致；未核验的承重与散热描述不对外展示。`,
  },
  {
    id: 'comparison', kind: 'data', title: '两轮经营对比',
    description: '同一口径的两个模拟 24 小时观察窗口。',
    url: '',
    content: `| 指标 | 首轮 | 更新后 | 变化 |
| --- | ---: | ---: | ---: |
| 曝光 | 10,000 | 10,000 | 0.0% |
| 商品访问 | 360 | 350 | -2.8% |
| 订单 | 9 | 14 | +5 单 |
| 访问成交率 | 2.5% | 4.0% | +1.5pp |
| 成交额 | 711 元 | 1,106 元 | +55.6% |

两个窗口不是随机对照实验，访问量还略有下降。结论仅描述本次样例，不证明因果。`,
  },
  {
    id: 'size-guide', kind: 'image', title: '尺寸图与适用说明',
    description: '13–16 英寸适用 / 不适用机型清单，随主图一起发布。',
    url: '',
    content: `## 尺寸图交付说明

- 标注折叠前：长 26 cm × 宽 4.5 cm。
- 标注展开后：最高 14 cm，六档可调。
- 明确适用 13–16 英寸笔记本，不承诺 17 英寸机型。
- 图片与文字使用同一组尺寸，测量误差 ±0.5 cm。

图片文件由商品视觉团队提供，本页仅保留交付说明。`,
  },
  {
    id: 'review-report', kind: 'document', title: '经营复盘报告',
    description: '问题、假设、动作与下一轮观察计划。',
    url: '',
    content: `## 复盘摘要

首轮 10 条购买咨询中有 6 条涉及适用尺寸，说明商品页的尺寸信息不足是一个待验证假设。本轮选择补充尺寸图与适用说明，售价保持 79 元。

## 观察结果

- 订单从 9 单增加到 14 单，成交率从 2.5% 提升到 4.0%。
- 访问量从 360 次降到 350 次，曝光没有变化。
- 成交额从 711 元增加到 1,106 元，未计入广告、退货与固定成本。

## 尚不能得出的结论

样本窗口短、没有对照组，不能把订单增长直接归因于尺寸说明。需要延长观察窗口，并核对退款与售后数据。`,
  },
]

const checks: OfficeResult['checks'] = [
  { id: 'copy', label: '标题、主图、详情与价格完成复核', status: 'passed' },
  { id: 'size', label: '13–16 英寸适用范围已补齐', status: 'passed' },
  { id: 'window', label: '两轮观察窗口口径一致', status: 'passed' },
  { id: 'refund', label: '退款与售后数据接入', status: 'pending' },
  { id: 'extend', label: '延长观察窗口后再决定是否扩大推广', status: 'pending' },
]

const decisions: OfficeResult['decisions'] = [
  { id: 'listing', question: '是否按 79 元上架电脑支架？', choice: '确认上架', at: '10-19 14:02' },
  { id: 'strategy', question: '电脑支架下一步怎么优化？', choice: '补充尺寸说明，保持 79 元', at: '10-19 14:18' },
]

export const resultDemoStatuses = ['verified', 'ready', 'draft', 'rejected'] as const

export function createResultDemo(status: OfficeResult['status'] = 'verified'): OfficeResult {
  const base: OfficeResult = {
    template: 'result-v1',
    title: '电脑支架首轮经营复盘',
    status,
    summary: '尺寸说明补齐后，订单从 9 单增至 14 单，成交率 2.5% → 4.0%。',
    verdict: '标题、主图、详情与价格已复核；两轮为同口径模拟窗口，尚不能证明因果关系。',
    owner: '王明 · 电商运营负责人',
    producedAt: '2026-10-19 14:32',
    metrics,
    artifacts,
    checks,
    decisions,
    next: [
      '延长第二个观察窗口至 72 小时，核对退款与售后数据。',
      '补拍折叠前后尺寸照片，替换详情页中的临时示意图。',
      '下周复盘后，再决定是否扩大投放或调整价格。',
    ],
    note: '以上为本地模拟数据，不连接真实店铺，不产生费用。两个观察窗口不是随机对照实验，不能据此证明优化效果。',
  }
  if (status === 'ready') {
    base.verdict = '成果已提交给电商运营负责人，等待最终验收。'
    base.checks = checks.map(check => check.id === 'copy' ? { ...check, status: 'pending' } : check)
    base.note = '以上为本地模拟数据。成果标记为“已交付”时，验收清单可能仍有待确认项。'
  } else if (status === 'draft') {
    base.verdict = '尺寸说明已更新，经营观察仍在进行；指标与交付物尚未复核。'
    base.metrics = metrics.map(metric => metric.id === 'orders' ? { ...metric, change: '待观察', trend: 'flat', tone: 'neutral' } : metric)
    base.checks = checks.map(check => check.id === 'copy' || check.id === 'size' ? { ...check, status: 'passed' } : { ...check, status: 'pending' })
    base.next = ['完成第二个观察窗口，补齐退款与售后数据。', '复核详情页中的尺寸图与临时示意图。']
    base.note = '这是一份尚未定稿的成果草稿，数据会随观察窗口继续更新。'
  } else if (status === 'rejected') {
    base.title = '电脑支架经营复盘（未通过）'
    base.summary = '订单提升明显，但缺少退款与售后数据，本轮验收未通过。'
    base.verdict = '验收未通过：不支持把订单增长归因于尺寸说明，暂不扩大推广。'
    base.checks = checks.map(check => check.id === 'refund' ? { ...check, status: 'failed' } : check)
    base.next = ['补齐退款与售后数据后重新提交验收。', '延长观察窗口，保留当前商品与价格。']
    base.note = '以上为本地模拟数据。验收未通过不表示商品不可继续销售，只表示本轮证据不足。'
  }
  return base
}

/** A completed board that carries the demo result, for the reader preview and whiteboard demo. */
export function createResultDemoBoard(status: OfficeResult['status'] = 'verified'): WhiteboardTaskBoardData {
  return {
    template: 'task-board-v1',
    title: '折叠电脑支架上架与优化',
    status: status === 'rejected' ? 'blocked' : status === 'verified' || status === 'ready' ? 'completed' : 'running',
    tagline: '电商运营 · 模拟数据',
    summary: '统一商品参数，补齐尺寸说明，完成上架、观察与优化。',
    description: '按首轮约定复核商品内容，补齐尺寸说明后再观察一轮。',
    note: '点击白板查看执行详情与本轮成果。',
    detail: `# 折叠电脑支架上架与优化 · 执行详情

> 墙上只展示目标与阶段进度；这里是完整的执行说明、交付要求和验收标准。

## 当前目标

完成折叠电脑支架的商品资料核验、内容制作、上架授权与经营观察。所有对外图片与文案统一使用已确认参数：售价 **79 元**，适用 **13–16 英寸**笔记本，六档高度调节。

## 执行步骤

1. 核对商品参数与供应商资料，保留参数来源。
2. 制作标题、主图、尺寸图与详情文案，保持参数一致。
3. 完成上架检查，等待负责人授权后模拟上架。
4. 观察首个 24 小时窗口，汇总访问、订单与购买咨询。
5. 根据用户选择补充尺寸说明或验证优惠，再观察第二个窗口。

## 阶段交付物

| 阶段 | 交付物 | 验收要求 |
| --- | --- | --- |
| 商品与上架 | 标题、主图、详情、价格 | 参数一致，无夸大描述 |
| 销量与反馈 | 首轮经营数据与咨询分类 | 保留统计口径与起止时间 |
| 优化与复盘 | 改动清单、两轮对比、复盘结论 | 改动有依据，结论不夸大因果 |

## 验收要求

- [x] 标题、主图、详情与价格完成复核。
- [x] 13–16 英寸适用范围已补齐。
- [ ] 退款与售后数据接入。
- [ ] 延长观察窗口后再决定是否扩大推广。

## 注意事项

- 所有店铺操作与经营数据均为本地模拟，不连接真实店铺，不产生费用。
- 两个观察窗口不是随机对照实验，不能把订单增长直接归因于单次改动。
- 未核验的承重、散热和销量描述不对外展示。`,
    steps: [
      { id: 'listing', title: '商品与上架', progress: 100 },
      { id: 'observation', title: '销量与反馈', progress: 100 },
      { id: 'improvement', title: '优化与复盘', progress: status === 'draft' ? 60 : 100 },
    ],
    result: createResultDemo(status),
  }
}
