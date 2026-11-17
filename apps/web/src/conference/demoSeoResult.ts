import type { OfficeResultInput } from '@pawoffice/protocol/office-ui'

const product = '/products/foldable-laptop-stand'
const comparison = '/guides/laptop-stand-comparison'
const measurement = '/guides/measure-laptop-stand'
const title = '折叠电脑支架｜六档调节与便携收纳'
const description = '折叠电脑支架支持六档调节与折叠收纳，本款标注适用 13–16 英寸笔记本。查看支撑方式、桌面占地核对步骤和机型注意事项，购买前确认机身尺寸。'

const findings = [
  { id: 'SEO-01', priority: 'P1', area: '页面标题', before: '电脑支架', after: title, evidence: 'P01 产品页样稿的 title 只有品类名，未区分折叠款。', owner: '陈书', acceptance: '页面源代码中的 title 与校对稿一致，品牌后缀不重复。' },
  { id: 'SEO-02', priority: 'P1', area: '摘要描述', before: '品质好物，立即选购。', after: description, evidence: 'P01 的 description 未说明使用条件与适用范围。', owner: '陈书', acceptance: '包含六档、折叠、13–16 英寸及购买前核对提示。' },
  { id: 'SEO-03', priority: 'P1', area: '页面主标题', before: '桌面好物', after: '折叠电脑支架', evidence: 'P01 可见主标题未明确商品类型，与正文主题不一致。', owner: '陈书', acceptance: '首屏主标题明确产品主题，不改成重复堆词的长标题。' },
  { id: 'SEO-04', priority: 'P1', area: '购买前答疑', before: '只有功能列表，没有尺寸和桌面空间答疑。', after: '补齐适用机型、桌面占地、折叠收纳三组问答。', evidence: 'Q01 咨询摘录中的尺寸问题在 P01 没有对应答案。', owner: '李研', acceptance: '17 英寸不作适配承诺；未实测的尺寸和承重不补写。' },
  { id: 'SEO-05', priority: 'P2', area: '图片说明', before: '主图 alt 为 image01，其他图片没有用途说明。', after: '主图：折叠电脑支架展开状态与前挡板；收纳图：支架折叠后的侧面形态。', evidence: 'P01 的图片标签无法解释图片展示的具体内容。', owner: '陈书', acceptance: '逐图核对实际画面，装饰性图片不堆关键词。' },
  { id: 'SEO-06', priority: 'P2', area: '站内链接', before: '对比页没有该产品入口，产品页缺测量方法链接。', after: '对比页、尺寸指南与产品页之间新增 3 条上下文链接。', evidence: 'P01–P03 链接记录未形成选型—测量—产品的阅读路径。', owner: '刘市', acceptance: '每条使用带 href 的链接，锚文本与目标内容相符。' },
] as const

const keywords = [
  { term: '折叠电脑支架', intent: '了解产品并判断是否购买', page: product, placement: 'title、H1、首段', answer: '是什么、适用范围和折叠方式' },
  { term: '便携笔记本支架', intent: '了解携带和收纳', page: product, placement: '折叠收纳段落', answer: '如何收起；没有重量数据就不写轻至多少克' },
  { term: '六档调节支架', intent: '了解调节方式', page: product, placement: '调节说明与对应图注', answer: '六档结构；实际高度按资料补齐' },
  { term: '笔记本支架怎么选', intent: '比较类型与取舍', page: comparison, placement: '对比表、选购建议', answer: '桌面空间、收纳习惯与使用条件' },
  { term: '笔记本支架尺寸怎么量', intent: '获得测量步骤', page: measurement, placement: '步骤标题、测量清单', answer: '机身宽深、支架展开占地与操作区' },
  { term: '17英寸电脑能用支架吗', intent: '核对具体适配条件', page: product, placement: '适用机型 FAQ', answer: '本款只标注 13–16 英寸，17 英寸未验证' },
] as const

const links = [
  { from: comparison, position: '折叠款对比行后的说明段', anchor: '折叠电脑支架', to: product, purpose: '从选型进入具体产品' },
  { from: measurement, position: '完成测量后的下一步', anchor: '查看这款支架的适用范围', to: product, purpose: '拿测量结果核对产品资料' },
  { from: product, position: '购买前检查段落', anchor: '机身与桌面空间测量步骤', to: measurement, purpose: '帮助读者补齐购买前的信息' },
] as const

const csv = (head: string[], rows: readonly (readonly string[])[]) => [head, ...rows]
  .map(row => row.map(cell => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n')

const copy = `# 产品页改写稿 v1.0

## 页面标题
${title}

## 页面摘要
${description}

## H1
折叠电脑支架

## 首屏导语
这是一款支持六档调节、可折叠收起的电脑支架。选购时，除了查看 13–16 英寸的标注范围，也请核对电脑机身宽深、支撑位置以及桌面操作空间。需要外接键盘时，把键盘和鼠标的占地一起算进去。

## 六档调节，先找到适合自己桌面的摆放方式
六档结构提供不同的支撑位置。调整前先移开电脑，按产品说明确认卡位，再放回电脑检查前挡板和支撑面是否贴合。当前资料没有每档高度与承重测试值，页面先展示结构和使用步骤，数值待核验后补充。

## 折叠收纳，看日常是否真的方便
经常收桌面或需要携带时，可以先比较展开和折叠两种状态。请结合收纳位置的空间判断是否合适；资料没有折叠厚度、重量和承重测试，因此不使用“超轻”“不占空间”“稳如磐石”等未经验证的承诺。

## 购买前，先检查三件事
1. 电脑：记录机身宽深，核对挡板和支撑位置，不只看屏幕英寸。
2. 桌面：确认支架展开后的占地，保留键盘、鼠标及常用物品的位置。
3. 使用：按说明放置，发现不稳时停止使用并向客服提供机型和照片。

## 常见问题
### 17 英寸笔记本能用吗？
这款的资料标注适用 13–16 英寸，没有 17 英寸的适配结论。请先向客服核实具体机型，不按“只大一点”推断可用。

### 同样是 16 英寸，就一定适合吗？
不一定。屏幕尺寸相近，机身宽深、厚度和重心仍可能不同；需要结合支撑面与前挡板位置核对。

### 小桌面需要留多少位置？
先量支架展开占地，再预留自己的操作区。本案没有统一的桌面最小宽度，不把某张示意图的尺寸当成通用标准。

## 图片文字
- 展开主图 alt：折叠电脑支架展开状态与前挡板。
- 六档细节 alt：支架背面的六档调节卡位。
- 折叠收纳 alt：支架折叠后的侧面形态。
- 以上描述需与最终图片逐张对应，不能仅按文件名批量填入。

## 页面衔接
在“购买前检查”段落后加入“机身与桌面空间测量步骤”，目标为 ${measurement}。

## 编辑交接
陈书完成文稿；李研对照规格卡 S01 检查事实；王明确认终稿后由发布人更新页面。当前是已交付文稿，线上发布链接和时间尚未登记。
`

const release = `# 发布验收与观察计划

## 交付与上线分开登记
本轮已交付页面诊断、改写稿、关键词分配和链接清单。案例页面样稿可核对，线上环境尚未接入；以下是发布执行与验收安排，不代表真实网站已经部署。

## 执行顺序
| 阶段 | 负责人 | 动作 | 完成依据 |
| --- | --- | --- | --- |
| 终稿确认 | 王明 | 确认 13–16 英寸边界、三组 FAQ 与图片描述 | 批准的稿件版本 |
| 页面更新 | 陈书 | 替换 title、description、H1、正文与 alt | 更新后页面与源代码 |
| 链接接入 | 刘市 | 按清单接入 3 条上下文链接 | 实际 href、点击目标与响应记录 |
| 上线验收 | 李研 | 桌面与手机核对；检查误设 noindex、访问权限与 canonical | 页面截图、响应与标签记录 |
| 复盘登记 | 赵审 | 登记发布版本、时间及搜索观察口径 | 发布回执与按引擎拆分的台账 |

## 上线检查表
- [ ] 正文和源代码中的 title、摘要与主标题为同一版本。
- [ ] 三组问答可直接阅读，17 英寸未写成已验证适配。
- [ ] 图文对应，图片替换后 alt 没有沿用错误内容。
- [ ] 3 条内链均可点击，目标路径正确，无意外跳转或错误页。
- [ ] 正式产品页可正常访问；若用于公开搜索，确认未误设 noindex 或登录限制。
- [ ] canonical 与实际正式 URL 对齐，站内链接指向同一主版本。
- [ ] 手机首屏、目录和 FAQ 可读，无横向溢出。
- [ ] 发布人、版本、实际时间与回退稿已归档。

## 观察窗口
发布当日先记录页面版本。发布前后各取 28 天作为首轮观察窗口；同一搜索引擎、页面、设备、地区及查询词口径分别比较。新页面没有历史基线时只记录起始情况，不做前后提升百分比。

| 指标 | 记录方法 | 解读边界 |
| --- | --- | --- |
| 曝光与点击 | 按搜索平台后台原始字段记录 | 不合并不同搜索引擎的口径 |
| CTR | 点击 ÷ 曝光；曝光为 0 留空 | 不由总点击推算某个查询词的表现 |
| 页面有效访问 | 与站内统计的来源条件对齐 | 不把搜索点击直接当订单 |
| 购买前咨询 | 尺寸、机型、占地分别归类 | 判断内容是否减少重复追问 |

## 回退与后续
保留更新前文稿 v0 和本轮校对稿 v1。出现错误参数或错误链接时优先修正具体项目，记下回退原因与时间。查询表现需结合季节、渠道和收录情况判断，不承诺确定的排名或收录日期。

## 参考依据
- [Google：标题链接](https://developers.google.com/search/docs/appearance/title-link)
- [Google：摘要说明](https://developers.google.com/search/docs/appearance/snippet)
- [Google：可抓取链接与锚文本](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
这些规则用于本案的 Google 页面检查；其他搜索引擎需按其自身工具和规则单独验收。
`

/** A complete, local delivery sample. No live website or search-account data is claimed. */
export function seoResult(producedAt: string): OfficeResultInput {
  const report = `# 产品页 SEO 优化清单

## 执行摘要
围绕“读者能否判断这款支架适不适合自己”完成 3 个关联页面的样稿审查。确认 6 项改动：4 项 P1、2 项 P2；已交付完整产品页文稿、6 组查询词分配、3 条内链及发布验收计划。

## 审查范围与依据
| 编号 | 材料 | 用途 |
| --- | --- | --- |
| P01 | ${product}，产品页样稿 v0 | 标题、摘要、正文与图片说明 |
| P02 | ${comparison}，选型对比页 v0 | 产品入口与选购意图 |
| P03 | ${measurement}，测量指南 v0 | 测量步骤与产品衔接 |
| S01 | 支架规格卡 v2 | 六档调节、折叠收纳、适用 13–16 英寸 |
| Q01 | 购买咨询摘录 C01–C10 | 尺寸与机型问题的内容覆盖 |

以上为本地案例材料，不是对真实线上站点的抓取。核心搜索词来自产品与咨询主题，未附搜索量、竞争度或排名数据。

## 页面诊断
${findings.map(item => `### ${item.id} · ${item.priority} · ${item.area}\n${item.evidence}\n\n当前：${item.before}\n\n交付：${item.after}\n\n负责人：${item.owner}。验收：${item.acceptance}`).join('\n\n')}

## 页面分工
产品页回答“这款是什么、是否适配”；对比页回答“不同支架怎么选”；测量指南回答“买前怎么量”。将不同问题分配到对应页面，避免三个页面机械复用同一份标题和正文。

## 审核结论
文稿与执行清单已完成，规格口径和页面分工已复核。实际页面发布、技术验收以及搜索效果仍待执行；成果文件不等于线上生效回执。

## 交付包
诊断报告、问题台账、产品页完整改写稿、关键词—页面映射、内链配置表、发布验收与观察计划，共 6 份。
`
  const artifact = (id: string, name: string, content: string, type = 'text/markdown') => ({
    id, title: name, kind: type === 'text/csv' ? 'data' as const : 'document' as const,
    description: name === '产品页完整改写稿' ? 'title、摘要、H1、正文、FAQ 与图片说明，可直接阅读和下载' : '已归档的本轮交付文件',
    content, mimeType: type, change: 'added' as const, version: '1.0', producedAt,
  })
  return {
    template: 'result-v1', title: '产品页 SEO 优化清单', status: 'ready', producedAt,
    owner: '王明 · 负责人', team: 'SEO优化办公室', teamSize: 3,
    summary: '完成 3 个关联页面的审查，交付 6 项优化方案、6 组关键词映射、3 条内链及 6 份成果文件。产品页标题、摘要、正文与 FAQ 已写成可用稿件。',
    verdict: '诊断与文稿已交付；先实施 4 项 P1，再接入 2 项 P2。线上发布和搜索效果另行验收，当前不填写排名提升或流量增长。',
    metricsTitle: '本轮交付概览', metricsCaption: '页面样稿审查与文稿交付，发布待执行',
    metrics: [
      { id: 'pages', label: '审查页面', value: '3', unit: '页', change: '产品页、对比页、测量指南' },
      { id: 'issues', label: '优化方案', value: '6', unit: '项', change: 'P1 优先处理 4 项 · P2 配套 2 项' },
      { id: 'keywords', label: '核心搜索词与辅助词', value: '6', unit: '组', change: '按搜索意图分配，不虚构搜索量' },
      { id: 'links', label: '内链建议', value: '3', unit: '条', change: '选型—测量—产品的阅读路径' },
    ],
    artifacts: [
      artifact('report', 'SEO 诊断与优化报告', report),
      artifact('issues', '页面问题与执行台账', csv(['编号', '优先级', '项目', '原始依据', '修改前', '修改后', '负责人', '验收方式'], findings.map(item => [item.id, item.priority, item.area, item.evidence, item.before, item.after, item.owner, item.acceptance])), 'text/csv'),
      artifact('copy', '产品页完整改写稿', copy),
      artifact('keywords', '关键词与页面映射', csv(['查询词', '搜索意图', '目标页面', '放置位置', '需要回答的问题'], keywords.map(item => [item.term, item.intent, item.page, item.placement, item.answer])), 'text/csv'),
      artifact('links', '三条内链配置表', csv(['来源页面', '放置位置', '锚文本', '目标页面', '读者下一步'], links.map(item => [item.from, item.position, item.anchor, item.to, item.purpose])), 'text/csv'),
      artifact('release', '发布验收与观察计划', release),
    ],
    sections: [
      { id: 'diagnosis', kind: 'custom', title: '页面诊断与优先级', caption: '优先补齐标题、摘要、H1 与购买前答疑；同步整理图片说明及 3 条内链。6 项问题均有负责人和验收方式。', layout: 'stack', blocks: [
        { type: 'callout', tone: 'info', title: '先解决读者判断问题', text: '现有样稿没有清楚说明产品类型、适用条件与购买前测量。先交付完整答案，再补图片说明和站内阅读路径。' },
        { type: 'chart', label: '改动优先级 · P1 页面内容 / P2 图片与链接', chart: 'bar', unit: '项', series: [{ label: 'P1', value: 4 }, { label: 'P2', value: 2 }] },
        { type: 'table', columns: [{ key: 'id', label: '编号' }, { key: 'priority', label: '优先级' }, { key: 'area', label: '发现' }, { key: 'owner', label: '负责人' }], rows: findings.map(item => ({ id: item.id, priority: item.priority, area: `${item.area}：${item.before}`, owner: item.owner })) },
        { type: 'text', text: '范围：P01 产品页、P02 对比页、P03 测量指南的案例样稿。依据：规格卡 S01、咨询摘录 Q01。完整证据和验收方式见「页面问题与执行台账」。' },
      ] },
      { id: 'rewrite', kind: 'custom', title: '修改前后对照', caption: '“电脑支架” → “折叠电脑支架｜六档调节与便携收纳”。附完整正文、三组 FAQ 与图片说明。', layout: 'stack', blocks: [
        { type: 'heading', text: '页面标题' },
        { type: 'keyValue', items: [{ label: '修改前', value: findings[0].before }, { label: '修改后', value: title, tone: 'positive' }] },
        { type: 'heading', text: '搜索摘要文稿' },
        { type: 'text', text: description },
        { type: 'keyValue', items: [{ label: '原 H1', value: '桌面好物' }, { label: '新 H1', value: '折叠电脑支架', tone: 'positive' }] },
        { type: 'heading', text: '新增 FAQ 示例' },
        { type: 'text', text: '**17 英寸笔记本能用吗？**\n\n本款标注适用 13–16 英寸，没有 17 英寸适配结论。请先核实机型，不按“只大一点”推断可用。\n\n完整正文、三组 FAQ 与逐图说明已放入「产品页完整改写稿」。' },
        { type: 'callout', tone: 'info', title: '摘要是提交文稿', text: '搜索引擎可能根据查询与页面内容生成不同标题或摘要；此处展示文稿对照，不伪装成真实搜索结果截图。' },
      ] },
      { id: 'search-map', kind: 'custom', title: '关键词与内链布局', caption: '产品页承接购买意图，对比页支持选型，测量指南解答尺寸。6 组查询词分配到 3 页，补齐 3 条阅读路径。', layout: 'stack', blocks: [
        { type: 'table', label: '查询词分配', columns: [{ key: 'term', label: '查询词' }, { key: 'intent', label: '读者问题' }, { key: 'placement', label: '内容位置' }], rows: keywords.map(item => ({ term: item.term, intent: item.intent, placement: item.placement })) },
        { type: 'heading', text: '内链建议' },
        { type: 'list', ordered: true, items: links.map(item => ({ text: `${item.from} → ${item.to}；锚文本「${item.anchor}」。${item.purpose}。` })) },
        { type: 'callout', tone: 'info', title: '关键词不是堆词清单', text: '每个词对应一个真实问题和内容位置，不设机械的词频目标。搜索量、竞争度和排名数据未接入，表内不补造数值。' },
      ] },
    ],
    checks: [
      { id: 'scope', label: '3 个页面的样稿、角色和资料来源已标注', status: 'passed' },
      { id: 'copy', label: 'title、摘要、H1、正文与三组 FAQ 已交付', status: 'passed' },
      { id: 'facts', label: '六档调节、折叠与 13–16 英寸口径和规格卡一致', status: 'passed' },
      { id: 'mapping', label: '6 组查询词与 3 条内链均已明确位置和目标', status: 'passed' },
      { id: 'handoff', label: '执行台账包含负责人、优先级和验收方式', status: 'passed' },
      { id: 'publish', label: '正式页面发布及桌面、手机验收', status: 'pending' },
      { id: 'technical', label: '线上访问、索引指令、canonical 与实际链接检查', status: 'pending' },
      { id: 'measure', label: '按引擎、页面及设备建立搜索效果观察记录', status: 'pending' },
    ],
    risks: [{ id: 'online', title: '线上环境与搜索数据待接入', level: 'low', status: 'open', owner: '李研 · 页面审查', note: '本轮完成的是案例样稿审查与交付；上线后再核对索引指令和搜索表现。' }],
    decisions: [{ id: 'intent', question: '三个页面是否复用同一篇产品文案？', choice: '分别承担产品、选型与测量意图，不重复堆叠同一文稿。' }],
    tasks: [
      { id: 'page', title: '检查页面标题与描述', owner: '李研 · 页面审查', status: 'done', progress: 100, note: '审查 3 个样稿页面，定位 6 项问题并记录依据。' },
      { id: 'keyword', title: '整理关键词与内链', owner: '刘市 · 关键词分析', status: 'done', progress: 100, note: '完成 6 组查询词映射与 3 条内链配置。' },
      { id: 'plan', title: '输出优化清单', owner: '陈书 · 优化方案', status: 'done', progress: 100, note: '交付完整改写稿、执行台账与发布验收计划。' },
    ],
    next: ['王明确认终稿，陈书优先实施 SEO-01 至 SEO-04；保留发布前版本。', '陈书与刘市补齐图片说明和 3 条内链，李研按检查表验收并回填发布回执。', '赵审按搜索引擎、页面和设备分开记录发布前后 28 天数据，没有基线的页面先建立基线。'],
    note: '本地案例成果：资料编号与路径用于说明完整交付过程；未连接真实线上站点或搜索统计账号。',
  }
}
