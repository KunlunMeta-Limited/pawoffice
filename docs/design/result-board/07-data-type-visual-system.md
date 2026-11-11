# 成果阅读页 · 数据类型专用视觉渲染体系设计（V2）

> 交付性质：本轮第一交付物（设计先行）。实施完成后再补「验收截图」列的实际路径与最终状态。
> 依据：`PawOffice_成果阅读页_前端渲染设计与验收规范_V1.0.md`（下称规范）+ 现有数据契约。
> 范围：仅前端表现层；不新增协议字段/接口/依赖；不改服务端与集成；不恢复 Tab；不改 Section 源顺序、状态语义、历史交付与安全回退。

---

## 0. 本轮要解决的问题

上一轮只完成了「三 Tab → 单页」和信息重组，虽然去掉了卡片墙，但本质仍是**同一套行/块样式套在不同数据上**：指标是数字、交付是文件行、检查是清单、版本是列表，彼此缺少「这是另一种数据」的辨识度。本轮目标是把**数据语义**翻译成**专用视觉语言**：

1. 6 种 metric、4 种 artifact、8 种 section、12 种 custom block 各自拥有与语义匹配的形态，而不是共用一个「标签 + 内容」模板。
2. 同一阅读器根据**已有字段组合**切换「交付型 / 说明型」两种阅读重心（纯前端派生，不新增字段）。
3. 优先重构五类核心内容：文件交付、指标、检查与风险、版本、代码变更。
4. 视觉继续沿用 PawOffice 的暖中性灰白 + 浅鼠尾草绿、细描边、柔和圆角与既有字体/图标，不引入第二套品牌、深色 IDE 或金融仪表盘风。
5. 保留已通过的：协议冻结、状态语义（ready≠verified、completed≠verified）、历史交付切换、无 Tab、Section 源顺序、安全回退（不可信 HTML/SVG、空 URL、不可预览格式、二进制 diff）。

---

## 1. 设计原则

| 原则 | 说明 |
| --- | --- |
| P1 语义决定形态 | 先问「这是什么数据、用户要拿它做什么」，再决定组件；同一字段集合不共享同一模板。 |
| P2 两种阅读重心 | 有交付物 → 以「拿到什么、能否直接读」为主；无交付物 → 以「结论与事实正文」为主。由字段组合派生，不写回数据。 |
| P3 五类专用语言 | 文件交付=文件语言；指标=数字语言；检查/风险=审查语言；版本=时间语言；代码变更=diff 语言。 |
| P4 统一但不单调 | 共用同一套 token（色板/字号/圆角/间距/动效），差异来自结构、密度、状态与交互，而非换主题。 |
| P5 交互匹配内容 | 文档→阅读器；diff→就地展开；版本→时间线；长清单→就地展开/折叠；状态→文字+语义色，绝不只靠颜色。 |

---

## 2. 两种阅读重心（纯前端派生）

派生函数（不新增协议字段）：`resultReadingMode(result)`。

| 判定输入 | 条件 | 结果 |
| --- | --- | --- |
| 有交付物 | `artifacts.length > 0` 或 `changedFileCount > 0` 或存在 `sections.kind ∈ {documents, files, changes, api, environments, gallery}` | `delivery` |
| 仅事实说明 | 以上都不满足，但存在 `summary` / `sections`（custom/文本）/ `decisions` / `next` / `note` | `fact` |
| 两者都有 | 同时满足 | 按 `delivery` 布局，但正文 section 仍保留文章节奏 |

布局差异：

| 区域 | `delivery` | `fact` |
| --- | --- | --- |
| 首屏主内容 | 结论后立刻出现「本轮交付」文件带 | 结论后直接进入正文（sections 源顺序），不出现「本轮交付」 |
| 指标位置 | 交付 → 审查 → 指标 → 详细内容 | 正文 → 指标 → 审查（如有） |
| 文案 | 「3 份交付文件 · 6 个文件变更」 | 正文标题使用文档语气（如「说明与结论」），不显示交付计数 |
| 空态 | 无交付时提示「本轮没有文件交付…」 | 不出现交付区域，避免误导性空框 |

> 说明：模式只影响区块顺序与文案，不改变任何数据；Section 之间的相对顺序在任何模式下都保持源数组顺序。

---

## 3. 数据类型 → 当前实现 → 新视觉形态 → 交互方式 → 验收截图

### 3.1 Metrics（6 种 `kind`）

| kind | 关键字段 | 当前实现 | 新视觉形态 | 交互 | 验收截图 |
| --- | --- | --- | --- | --- | --- |
| `value` | label/value/unit | 大数字 + 单位 + 标签 | **数字主视觉**：32–36px tabular 数字 + 小号单位，标签在下，无容器 | 静态；`title` 提供完整字段 | `type-01-metrics-kinds.png` |
| `comparison` | previous/change/trend/tone | 数字 + 小字「首轮 X」 | **双点对比**：当前值最大，前值/变化次级；数值可解析时叠加「前值/当前」双条形；趋势箭头颜色取 `tone`（up≠好） | 静态；悬停显示「首轮 X → 当前 Y」 | `type-01` |
| `status` | value/tone | 图标 + 大数字样式 | **状态灯 + 文字**：语义圆点/图标 + 状态文字，不用数字字号；tone 仅做语义色 | 静态 | `type-01` |
| `target` | value/target/targetStatus/progress | 数字 + 细进度条 | **目标刻度表**：当前值 + 目标 chip + 细刻度条（`progress` 有值才画；`target` 可解析为百分比时画目标刻线，否则只显示「目标 95%」文字，不推算） | 静态 | `type-01` |
| `text` | label/value | 小字号数字版 | **事实句**：18px 短句为主，标签做前缀小字；不加单位/百分号 | 静态 | `type-01` |
| `auto` | 实际字段 | 按 `previous` 回退为 comparison/value | 沿用既有 `resultMetricKind` 规则解析后渲染，不显示 `auto` 原始形态 | 静态 | `type-01` |

密度（保持既有 1/2/3/4/5–6/7–12 规则）：1 舒展单列；2–3 列；4 两列 2×2；5–6 三列；7–12 紧凑数据行，但每行仍保留 kind 语言（状态点 / 变化 chip / 迷你刻度 / 文本）。`emphasis=primary` 只放大与提高对比，不排序。

### 3.2 Artifacts（4 种 `kind`）

| kind | 关键字段 | 当前实现 | 新视觉形态 | 交互 | 验收截图 |
| --- | --- | --- | --- | --- | --- |
| `document` | title/description/version/content/mimeType | 统一文件行（图标 + 标题 + 动作） | **文档行**：文档字形 + 标题（15.5px）+ 版本 chip + 时间/状态 + 描述；主操作「阅读」 | 打开既有 `ResultArtifactPreview`（版本切换/对比/下载/校验） | `type-02-delivery-document.png` |
| `image` | url/content/version | 行内 40px 缩略图 | **图像卡位**：56px 比例缩略图（无图用统一占位，不造图），标题与版本在下；`查看大图` | 打开大图预览；无可用图时回退文件行 | `type-03-artifacts-mixed.png` |
| `link` | url/description | 常规行 + 外链按钮 | **外链行**：解析出的域名 chip（如 `example.com`）+ 标题 + 描述 + 外跳箭头；仅合法 http(s) 可打开 | 新窗口打开；空 URL 显示禁用文案，不造假跳转 | `type-03` |
| `data` | content/mimeType/version | 常规行（图标为表格） | **数据资源行**：表格字形 + 内容格式 chip（由既有 `mimeType` 派生：JSON/CSV/表格/文本）+ 标题；不臆造统计图 | 打开既有预览（表格/文本识别）；不可预览时下载/原文 | `type-03` |

### 3.3 Sections（8 种 `kind`）

| kind | 新视觉形态 | 交互 | 验收截图 |
| --- | --- | --- | --- |
| `gallery` | 自适应图片网格：缩略图 + 标题/元数据 + 状态；空图占位 | 有图可点开大图 | `type-03` |
| `documents` | **版本文件行**：文档字形 + 标题 + 版本 chip + 时间 + 完成状态；与 artifacts 精确同源时点开同一预览入口，不重复整份文件卡 | 打开共享预览入口 | `type-02` |
| `tests` | **质量报告**：顶部 2–4 个测试指标（数字 + 语义色）+ 进度条 + 逐行检查记录 | 无额外动作；状态文字可读 | `type-04-review.png` |
| `api` | 接口表：方法短标记（GET/POST/…）+ 等宽 endpoint + 状态 + 时间 | 不伪造「试请求」按钮 | `type-08-sections-machinery.png` |
| `environments` | 环境列表：状态灯 + 名称 + 版本 chip + 时间 + 状态文字；failed 轻警示 | 静态 | `type-08` |
| `files` | 附件列表：类型字形 + 文件名 + 类别 + 大小 + 有效链接 | 仅合法 URL 可下载/打开 | `type-08` |
| `changes` | **变更清单**：状态徽标 + 等宽路径 + 增删行数；见 3.5 | 行内就地展开真实 diff | `type-06-changes-inline-diff.png` |
| `custom` | 12 种 block 组合（见 3.4），尊重 layout 但不跨 section 排序 | 视 block 而定 | `type-07-custom-blocks.png` |

### 3.4 Custom blocks（12 种）

| block | 新视觉形态 | 交互 |
| --- | --- | --- |
| `heading` | h2/h3/h4 文档级字阶与上下间距 | — |
| `text` | 15–16px Markdown 正文，1.75 行高，表格/代码可读 | 表格横向滚动 |
| `keyValue` | 双列属性表：标签淡、值突出，tone 色仅用于值 | — |
| `stats` | 统计数字带（数字 + 单位 + 标签），非卡片 | — |
| `table` | 真表格：表头、行分隔、数字右对齐、方法/代码等宽 | 横向滚动；仅合法链接可点 |
| `list` | 状态列表：通过/待处理/未通过小图标 + 文本，不做卡片 | — |
| `progress` | 标签 + 数值 + 细进度条 | — |
| `chart` | bar/line/pie 专用 SVG；真实 series 值可读 | 无请求动作 |
| `image` | 原比例图片 + 说明；空 URL 统一占位 | 现有大图能力 |
| `diagram` | Mermaid 渲染；失败显示源文本，不执行脚本 | 复制源文本 |
| `callout` | 低饱和底 + 细边 + 小图标；info/success/warning/danger 克制区分 | — |
| `divider` | 细分隔线/留白 | — |

### 3.5 五类核心内容的组件规格

#### A. 文件交付（delivery language）
- 行高 64–76px；标题 15.5px、描述 12.5px、元信息 11.5–12px；版本用 chip，动作右对齐（阅读/查看大图/打开链接；复制/下载为次级）。
- 文件类型差异见 3.2；`change`（新增/更新/移除/沿用）为轻量徽标。
- 无交付物时**不渲染交付区**；文档区只有事实文本时走 `fact` 模式。
- 键盘：行内动作可 Tab、Enter 打开；预览/Escape/焦点恢复沿用既有实现。

#### B. 指标（number language）
- 6 种 kind 各有专属结构（见 3.1）；数字 tabular-nums；单位不换行拆行。
- 密度 1/2/3/4/5–6/7–12；7–12 行走紧凑数据行，但保留状态点/变化 chip/迷你刻度。
- `tone`、`trend`、`targetStatus` 只影响语义色与图标，不改变数值与顺序。

#### C. 检查与风险（review language）
- 顶部**验证结论带**：`通过 / 待处理 / 未通过 / 待补充验证` 四类计数 + 比例条（由计数派生）；禁止出现「3 项通过」这类把失效项算通过的口径。
- 检查行：状态图标 + 条目 + 状态文字；`passed` 降级为次要小字；`pending/failed/stale` 保留完整可读并高亮。
- 失效版本：显示「待补充验证」+「原验证版本 prd-v1，当前版本 v2.0」，不加绿通过态。
- 风险登记：等级（高/中/低）+ 状态（待处理/处理中/已关闭）+ 负责人 + 说明；已关闭项弱化并可归入可展开分组。

#### D. 版本（time language）
- 纵向时间线：节点（released 实心绿 / draft 空心 / rolled-back 红）+ 版本标识 chip + 说明 + 作者/时间 + 状态文字。
- 与「历史交付选择器」区分：后者仍是顶部下拉（既有能力），版本时间线只表达成果版本记录。

#### E. 代码变更（diff language）
- 头部：`已编辑 N 个文件` + 总增删行 + 按状态计数（新增/修改/删除/重命名）。
- 文件行：状态徽标 + 等宽路径（重命名显示旧路径）+ 增删行数 + 二进制/较大标记。
- 交互：**行内就地展开**真实 unified diff（按钮 `aria-expanded`，键盘可操作，Esc 收起）；二进制/超限不造假文本 diff。

### 3.6 说明型成果（fact mode）规格

- 结论（summary）作为文章导语；`verdict` 作为验收批注。
- 不出现「本轮交付」区域；正文 sections 按源顺序以文章节奏呈现（正文宽 760–860px）。
- 指标作为一条数字带（如果有）；检查/风险作为审查附录；决策/任务/下一步按记录呈现。
- 示例：只有 `summary + custom/text sections + decisions + next + note` 的成果。

---

## 4. 共用视觉语言

| Token | 取值 |
| --- | --- |
| 背景/面板 | 页面暖灰白；内容白底，无纸张纹理、无大面积高饱和底色 |
| 主文字 | `#26332b`（墨绿灰） |
| 正文 | `#4f5d53` |
| 辅助 | `#64736a`（对比度 ≥ 4.5） |
| 强调 | 柔和灰绿 `#3f6b53`；不使用金棕/霓虹/第二套主题 |
| 风险/失败 | 仅在语义需要时出现：琥珀 `#8a6b2f`、砖红 `#a25948`，克制使用 |
| 字号 | 标题 30；结论 26；区块标题 20；结构化标题 18；正文 15–15.5/1.75；辅助 11.5–12.5；核心数字 32/36 |
| 圆角 | 主阅读容器 16；文件行/表 0–10；chip/徽标 4–999；无大面积阴影 |
| 图标 | 既有 lucide-react，16–20px 为主 |
| 动效 | 展开/悬停 120–200ms；尊重 reduced-motion |
| 无障碍 | 状态文字化、非纯色；触控目标 ≥36–40px；键盘可达；弹层 Escape/焦点恢复 |

---

## 5. 验收样例（真实浏览器截图，≥6 种不同语义）— 已产出

截图目录：`docs/design/result-board/screenshots/`；全部为真实浏览器（Playwright + Chromium）1787×864 渲染，数据来源见 `screenshots/manifest.json`。既有 9 张验收截图同批保留（其中 03 完整长图更新为 1121×2588）。

| # | 截图（actual path） | 覆盖类型 | 生成方式 |
| --- | --- | --- | --- |
| 1 | `screenshots/type-01-metrics-kinds.png` | 6 种 metric kind（value/comparison/status/target/text/auto）+ emphasis | `?fixture=type-metrics` |
| 2 | `screenshots/type-02-delivery-document.png` | document artifact ×3 + documents section 精确同源 + 未关联项 | `?fixture=type-delivery` |
| 3 | `screenshots/type-03-artifacts-mixed.png` | document/image(有效+空)/link(有效+空)/data + gallery | `?fixture=type-artifacts` |
| 4 | `screenshots/type-04-review-checks-risks.png` | checks（passed/pending/failed/stale）+ risks（高/中/低 × 待处理/处理中/已关闭） | `?fixture=type-review` |
| 5 | `screenshots/type-05-versions-timeline.png` | versions（draft/released/rolled-back）纵向时间线 | `?fixture=type-versions` |
| 6 | `screenshots/type-06-changes-inline-diff.png` | changes 24 文件（新增/修改/删除/重命名/二进制/较大）+ 首行行内 diff | `?fixture=type-changes` |
| 7 | `screenshots/type-07-fact-mode.png` | 说明型成果（无 artifacts/changes）正文阅读 | `?fixture=type-fact` |
| 8 | `screenshots/type-08-sections-machinery.png` | api/environments/files/tests 四类区块机制 | `?fixture=type-sections` |

### 5.1 实施结果（与设计稿的对应）

- 阅读重心：`results/readingMode.ts` 纯前端派生 `delivery | fact`；根节点输出 `data-reading-mode`，fact 模式不渲染「本轮交付」、正文前置并显示「说明与结论」，delivery 模式保持交付优先。**未新增任何协议字段**。
- 指标：`ResultMetrics` 6 种 kind 各自结构（数字主视觉 / 双点对比+可选双条 / 状态灯+文字 / 目标 chip+刻线+进度 / 事实句 / auto 解析）；1/2/3/4/5–6/7–12 密度保留。
- 文件交付：`ResultArtifactList` 4 种 artifact 专用行（document 文档行、image 56px 缩略图或占位、link 域名 chip、data mimeType 派生格式 chip）；行高压缩到 74–77px（规范 64–76 区间附近）；图片加载失败回退为统一虚线占位。
- 检查与风险：`ResultReviewLog` 四类计数结论带 + 比例条（计数派生，无新数字）、passed 降级、failed/stale 高亮并给出「原验证版本 → 当前版本」；`风险记录` 等级/状态/负责人/说明，closed 弱化。
- 版本：`ResultVersionTimeline` 纵向时间线（released 实心绿 / draft 空心 / rolled-back 红），与历史交付下拉区分。
- 代码变更：`ResultChanges` 保留 24 行文件清单与真实 diff，交互从浮层改为**行内就地展开**（`aria-expanded`，Enter/Space 展开、Esc 收起），binary/oversized 不造假。
- 8 类 section / 12 种 block 的既有实现保留；`documents/files/gallery` 重做为交付语言的版本行/附件行/图片网格。

### 5.2 与设计稿的偏差（均已评估，不影响验收）

1. `link` 类型统一走外链新窗口（即使有 versionId 也不进预览 dialog），避免把外链当作本地文件；`document/image/data` 的版本预览/对比完全沿用既有能力。
2. `data` 的格式 chip 只由既有 `mimeType` 派生（JSON/CSV/表格/文本/未知），不猜扩展名或业务含义。
3. 已关闭风险采用「同列表弱化」而非折叠分组——若折叠会隐藏验收需要的 closed 状态证据（A18 要求三种风险状态可见）。
4. 指标对比双条仅在 value/previous 均可安全解析为数字时出现；散文式前值回退纯文本（不臆造）。
5. 图片缩略图在合法 URL 但加载失败时回退为占位（不显示破图）；`thumb` 仍只在合法 http(s) url 时进入 DOM。
6. 12 种 custom block 的视觉语言沿用上一轮实现（本轮优先五类核心内容），未新增依赖或图表库。

---

## 6. 本轮验收标准（替代「去掉 Tab / 功能通过 / 无卡片墙」）

对每一类数据（6 metric、4 artifact、8 section、12 block + 检查/风险、版本、代码变更、两种阅读模式）逐项判断：

1. **语义匹配**：形态是否由数据语义决定（例：comparison 有对比关系、target 有目标参照、status 不是数字、diff 是 diff）。
2. **信息层级**：主值/标题/辅助信息有明确层级，能一眼区分。
3. **视觉辨识度**：与其它类型并列时能否被认出是另一种数据，而非同一模板换字。
4. **交互适配**：阅读/展开/跳转/版本切换等方式与内容匹配，无假按钮。
5. **安全与回退**：空值/不可预览/不可信内容/二进制/超限有诚实回退。
6. **不变量**：协议零改动、无 Tab、Section 源顺序、状态语义、历史交付、无新依赖、与 PawOffice 风格一致。
7. **证据**：≥6 张真实浏览器类型样例 + 既有 9 张验收截图 + 测试/构建结果。

---

## 7. 实施拆分（本轮）

| 工作项 | 内容 | 负责 |
| --- | --- | --- |
| 设计文档 | 本文档 | Lead |
| 指标视觉体系 | `ResultMetrics` 6 kind 专用形态 + 密度 | 前端实现 |
| 交付视觉体系 | `ResultArtifactList` 4 kind 专用形态 + documents/files/gallery | 前端实现 |
| 审查/版本/变更体系 | `ResultReviewLog`、`ResultVersionTimeline`、`ResultChanges` 行内 diff | 前端实现 |
| 阅读重心 | `resultReadingMode` + `ResultWorkspace` 组合 | Lead |
| 类型样例夹具与截图 | type-* fixtures + 预览页 + 截图脚本 | 验收夹具实现 |
| 回归与证据 | 测试/构建/截图/材料更新 | Lead + 审核材料 |
