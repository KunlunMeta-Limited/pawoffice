import { describe, expect, it } from 'vitest'
import { parseArtifactChart } from '@/components/artifactChartSpec'

describe('parseArtifactChart', () => {
  it('解析三维柱状图并保留受控颜色和完整数据', () => {
    expect(parseArtifactChart(JSON.stringify({
      type: 'bar3d',
      title: '多 Agent 交付能力矩阵',
      subtitle: '真实任务产物',
      unit: '%',
      categories: ['研究', '设计', '实现'],
      series: [
        { name: '旅行研究 Agent', data: [78, 92, 86], color: '#ef6a58' },
        { name: '文档架构 Agent', data: [65, 88, 96], color: '#2f9c95' },
      ],
    }))).toEqual({
      type: 'bar3d',
      title: '多 Agent 交付能力矩阵',
      subtitle: '真实任务产物',
      unit: '%',
      categories: ['研究', '设计', '实现'],
      series: [
        { name: '旅行研究 Agent', data: [78, 92, 86], color: '#ef6a58' },
        { name: '文档架构 Agent', data: [65, 88, 96], color: '#2f9c95' },
      ],
    })
  })

  it('拒绝未知三维类型和无效数据', () => {
    expect(parseArtifactChart('{"type":"3d","title":"x","categories":["a","b"],"series":[]}')).toBeNull()
    expect(parseArtifactChart('{"type":"bar3d","title":"x","categories":["a","b"],"series":[{"name":"s","data":[1]}]}')).toBeNull()
  })

  it.each(['pie', 'donut', 'radar'] as const)('解析 %s 图表', (type) => {
    expect(parseArtifactChart(JSON.stringify({ type, title: '能力分布', categories: ['研究', '实现', '验证'], series: [{ name: '得分', data: [72, 91, 84] }] }))).toMatchObject({
      type,
      title: '能力分布',
      categories: ['研究', '实现', '验证'],
    })
  })
})
