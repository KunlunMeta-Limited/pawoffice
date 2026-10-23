import type { DecisionRequest, DecisionRequester } from './DecisionSession.ts'

export function createDecisionPreview(teamId: string, requester: DecisionRequester): DecisionRequest[] {
  const createdAt = Date.now(), expiresAt = createdAt + 60000, deadline = performance.now() + 60000
  const timing = { createdAt, expiresAt, deadline }
  return [
    { teamId, id: 'preview-priority', kind: 'choice', allowCustom: true, requester, ...timing, title: '电脑支架下一步怎么优化？',
      description: '选择一项商品优化措施，不同时修改所有变量。', options: [
        { id: 'information', label: '补充尺寸说明，保持 79 元', description: '新增适用尺寸图并重排详情。' },
        { id: 'coupon', label: '试用 5 元优惠', description: '模拟成交价 74 元，关注单笔差额。' },
        { id: 'pause', label: '暂停推广，继续排查', description: '先核对购买顾虑，不追加推广。' },
      ] },
    { teamId, id: 'preview-review', kind: 'confirmation', requester, ...timing,
      title: '是否按 79 元上架电脑支架？', description: '核对商品标题、详情、图片与适用尺寸，仅模拟上架，不扣费。',
      confirmLabel: '确认上架', rejectLabel: '暂不上架' },
  ]
}
