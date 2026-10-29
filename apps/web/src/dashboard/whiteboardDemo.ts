import type { WhiteboardDetailSectionInput } from '@pawoffice/protocol/office-ui'
import { ExampleOfficeDataSource } from './demoSource.ts'
import { createResultDemoBoard } from './resultDemo.ts'

const detailSections: WhiteboardDetailSectionInput[] = [
  {
    id: 'goal', title: '目标与范围', caption: '执行说明', layout: 'stack', blocks: [
      { type: 'text', text: '本轮目标是完成折叠电脑支架的商品资料核验、内容制作与上架审核。统一使用已确认的商品参数：售价 **79 元**，适用于 **13–16 英寸笔记本电脑**，提供六档高度调节。\n\n所有图片与文案应使用同一套参数。对承重、散热效果、销量等没有材料支持的描述，不作为卖点对外展示。' },
      { type: 'stats', items: [
        { label: '售价', value: '79', unit: '元' },
        { label: '适用', value: '13–16', unit: '英寸' },
        { label: '调节', value: '6', unit: '档' },
      ] },
      { type: 'callout', tone: 'info', title: '信息缺失时', text: '记录待确认事项，再交由负责人处理，不要自行补全。' },
    ],
  },
  {
    id: 'deliverables', title: '阶段与交付物', caption: '3 个阶段', layout: 'stack', blocks: [
      { type: 'table', columns: [
        { key: 'stage', label: '阶段' },
        { key: 'owner', label: '负责人' },
        { key: 'artifact', label: '交付物' },
        { key: 'accept', label: '验收要求' },
      ], rows: [
        { stage: '商品资料核验', owner: '信息检索', artifact: '参数清单与来源记录', accept: '尺寸、材质、价格相互一致' },
        { stage: '内容制作', owner: '文案撰写', artifact: '商品标题、主图说明、详情文案', accept: '描述准确，场景清楚，无夸大用语' },
        { stage: '上架审核', owner: '内容审核', artifact: '审核记录与待确认清单', accept: '逐项核对后再提交上架' },
      ] },
    ],
  },
  {
    id: 'flow', title: '上架流程', caption: 'Mermaid · Pele 渲染', layout: 'stack', blocks: [
      { type: 'diagram', alt: '商品上架流程图', caption: '从资料核验到经营观察', source: 'flowchart LR\n  A[资料核验] --> B[内容制作]\n  B --> C{上架审核}\n  C -->|通过| D[模拟上架]\n  C -->|退回| B\n  D --> E[经营观察]' },
    ],
  },
  {
    id: 'research', title: '商品资料核验', layout: 'stack', blocks: [
      { type: 'text', text: '收集商品尺寸、适用范围、材质和折叠方式，保留原始材料；将供应商参数与现有图片逐项核对，发现冲突时注明来源及差异。' },
      { type: 'list', ordered: true, items: [
        { text: '收集商品尺寸、适用范围、材质和折叠方式，保留原始材料。' },
        { text: '将供应商参数与现有图片逐项核对，发现冲突时注明来源及差异。' },
        { text: '检查售价、优惠和售后说明是否一致，避免多个页面出现不同口径。' },
        { text: '将没有依据的信息列入待确认清单，交付时明确标注。' },
      ] },
      { type: 'heading', text: '本阶段检查清单', level: 'h3' },
      { type: 'list', items: [
        { text: '确认商品名称与基础售价。', status: 'passed' },
        { text: '确认适用设备尺寸为 13–16 英寸。', status: 'passed' },
        { text: '补齐折叠前后尺寸的测量照片。', status: 'pending' },
        { text: '由负责人确认最终参数版本。', status: 'pending' },
      ] },
    ],
  },
  {
    id: 'content', title: '内容制作', layout: 'stack', blocks: [
      { type: 'text', text: '商品详情按“使用场景 → 材质与尺寸 → 六档调节 → 折叠收纳 → 注意事项”的顺序组织。每个部分都应有明确的图片说明与对应文字。\n\n主图重点展示商品整体形态，尺寸图标注测量方式；不得通过视觉比例暗示未经核验的适用范围，也不得省略影响购买判断的限制条件。' },
      { type: 'heading', text: '文案交付标准', level: 'h3' },
      { type: 'list', items: [
        { text: '标题包含商品类型与主要特征，避免堆叠同义词。' },
        { text: '参数区采用统一单位，注明测量误差说明。' },
        { text: '使用场景基于真实功能，不暗示医疗或专业效果。' },
        { text: '注意事项说明摆放、调节及收纳时的操作要求。' },
      ] },
    ],
  },
  {
    id: 'review', title: '审核与异常处理', layout: 'stack', blocks: [
      { type: 'text', text: '审核人员对标题、主图、详情、价格、适用尺寸与售后承诺逐项核对。出现参数冲突、图片缺失或描述超出证据范围时，退回对应环节并写明原因。' },
      { type: 'callout', tone: 'warning', title: '需要负责人决策', text: '列出问题、可选方案与影响；未获得确认前保持待处理状态。' },
    ],
  },
  {
    id: 'observation', title: '完成后的观察计划', layout: 'stack', blocks: [
      { type: 'text', text: '商品获批上架后再建立经营观察窗口。记录访问量、订单数、成交价与购买咨询，保留统计起止时间；同口径对比后，再决定是否修改图片、补充尺寸说明或调整优惠。' },
      { type: 'list', ordered: true, items: [
        { text: '用户是否理解商品的适用尺寸和使用方式？' },
        { text: '购买咨询中是否反复出现同一类参数问题？' },
        { text: '页面内容能否回答购买前的主要顾虑？' },
        { text: '计划修改的内容是否有数据或用户反馈支持？' },
      ] },
    ],
  },
  {
    id: 'acceptance', title: '最终验收', layout: 'stack', blocks: [
      { type: 'list', items: [
        { text: '所有对外参数有来源，图片与文字一致。', status: 'passed' },
        { text: '标题、主图、详情和价格完成审核。', status: 'passed' },
        { text: '待确认事项已关闭，或明确记录处理人。', status: 'pending' },
        { text: '上架后观察计划已安排。', status: 'pending' },
      ] },
      { type: 'divider' },
      { type: 'text', text: '**详情结束。** 关闭窗口后，墙上仍展示简短概览。' },
    ],
  },
]

const shortDetailSections: WhiteboardDetailSectionInput[] = [
  {
    id: 'today', title: '今天要完成的事', layout: 'stack', blocks: [
      { type: 'list', items: [
        { text: '核对商品尺寸与适用范围。' },
        { text: '整理主图所需的拍摄素材。' },
        { text: '将缺失信息交给负责人确认。' },
      ] },
      { type: 'callout', tone: 'info', title: '交付时间', text: '今天下班前。' },
      { type: 'text', text: '这段详情与墙上概览分别维护，可以独立更新。' },
    ],
  },
]

export function createWhiteboardDemoSource() {
  const base = { template: 'task-board-v1' as const, title: '商品上架计划', status: 'blocked' as const,
    tagline: '对齐目标，分步推进', summary: '核对商品资料，完成内容制作与上架审核。', note: '点击白板查看完整执行说明。',
    steps: [{ id: 'collect', title: '商品资料核验', progress: 100 }, { id: 'write', title: '内容制作', progress: 65 }, { id: 'review', title: '上架审核', progress: 0 }] }
  return new ExampleOfficeDataSource(new Date(), {
    workspace: { id: 'office-whiteboard-demo', name: '白板验收办公室' }, tasks: [],
    conversationTitle: '长详情 · 滚动阅读', whiteboard: { ...base, detailSections },
    conversations: [
      { id: 'short-detail', title: '短详情 · 独立内容', employees: [], tasks: [], events: [], whiteboard: { ...base,
        title: '本周工作安排', summary: '本周先核验资料，再制作商品内容。',
        detailSections: shortDetailSections } },
      { id: 'legacy', title: '旧数据 · Markdown 已停用', employees: [], tasks: [], events: [], whiteboard: { ...base,
        summary: '', description: '这是一块只有旧版 Markdown 详情的白板。新读者不再解析 Markdown，而是回退展示墙上概览；内容需要由后端改为 detailSections。'.repeat(3),
        detail: '# 旧版 Markdown 详情\n\n这段文字不会再被解析或渲染，只用于验证旧快照仍能通过 schema 校验。',
        note: '此示例只有旧版 Markdown 详情，展开后回退显示概览内容。'.repeat(3) } },
      { id: 'result', title: '成果阅读 · 验收通过', employees: [], tasks: [], events: [], whiteboard: createResultDemoBoard('verified') },
    ],
  })
}
