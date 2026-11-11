# PawOffice 成果阅读页重构 · 审核材料 A（规范 + 设计 + 自查 + 测试 + 数据矩阵 + 截图索引）

> 审核对象：feat/result-board-design（commit 以 git log 为准），只做前端表现层重构，协议层冻结。本轮新增「数据类型专用视觉渲染体系」（见 07 文档）。
> 材料：规范全文、审核 README、01 改动与复用、02 A01–A28 自查、03 测试报告、04 数据矩阵、05 未完成、06 截图索引、07 数据类型视觉体系设计、截图 manifest（17 张）。

---

# 一、验收规范 V1.0（唯一验收依据）

# PawOffice 成果阅读页：前端渲染设计与验收规范 V1.0

**交付给：DSH（实施）**  
**审核方：产品与视觉验收**  
**基准材料：** `后端到前端数据契约.md`、`result-ready-round3.json`、用户提供的 PawOffice 当前首页截图 `PawOffice_当前首页视觉基准.png`。  
**范围：** 只做产品与前端表现层重构，不调整任何服务端、数据契约或集成行为。  
**本稿性质：** 可直接用于实施的产品设计与验收文件；文中的尺寸是前端视觉设计建议，不是新增协议字段。

---

## 0. DSH 执行指令（必须先读）

本次工作不是“重新设计一个成果管理后台”，而是升级 **PawOffice 现有成果阅读页的数据驱动渲染能力**。用户从当前 2D 办公室的已有成果入口进入，首先理解 AI 本轮完成的结果，随后立即找到并使用交付内容，最后查看验证、风险和过程证据。新页面必须与现有首页风格一致、没有 Tab、没有顶部分类导航或替代性的分段切换，也不能把六个字段组变成六张等权重卡片。

### 红线——任何一项违反即验收失败

1. **协议层冻结。** 禁止修改字段名、字段集合、类型、枚举、长度、Schema、序列化结构、默认值；禁止修改 `packages/protocol`、服务端、集成契约和数据推送接口。不得要求后端添加信息或新接口。
2. **仅前端。** 使用现有前端技术栈和已有 UI/预览/版本能力，不引入新依赖；可增加前端内部的派生视图状态和纯展示逻辑，但不能把它回写成协议数据。
3. **一页完整阅读。** 不出现“概览 / 交付物 / 过程记录”Tab、segmented control、顶部分类导航、分类侧栏或按类别切换的不同内容页。局部长内容允许折叠展开，但重要成果、交付、验证提醒默认可见。
4. **操作零回归。** 保留历史交付切换、文件正文预览、已有版本对比、复制摘要、下载报告与原本可用的下载/外链操作。不得使用假按钮。
5. **状态独立。** `whiteboard.status` 是任务执行，`result.status` 是成果状态；`completed ≠ verified`。复用现有 `resultPresentation` 与检查版本失效判定，不自创另一套规则。
6. **场景零冲突。** 不改首页两侧导航、顶部统计、2D 办公室、员工角色、任务流、聊天输入区、当前交互位置；只调整成果入口打开后的阅读内容与其容器样式，入口/关闭/返回流程保持已有行为。
7. **禁止伪信息。** 不创造“高优先级指标”“验收通过率”“自动结论”“报告文件后缀”“文件与段落关联”等不存在的业务信息。展示文案能转换枚举，但不能改写原始结论。

### 源码调查动作

正式修改前先定位当前 `WhiteboardReader → ResultDeliveryShell → ResultWorkspace`、`ResultReader`、`ResultArtifactPreview`、`presentation.ts`、`checks.ts`、`sections.ts` 和现有主题 token/响应式样式，确认可复用点。它们是契约文档列出的现有消费位置，而非指令必须新建同名组件。先提交一份简短的“受影响前端文件清单 + 现有复用能力表”，再改 UI。不要为了重构视觉顺手改动历史加载、缓存、SSE 或 API 机制。

---

## 1. 产品体验：什么叫完成

### 1.1 五秒理解原则

用户打开成果，默认第一屏的阅读路线必须是：

**① 是哪份成果 → ② AI 本轮做成了什么（`result.summary`） → ③ 拿到了什么（`artifacts` 或事实正文） → ④ 是否已经验证/还欠什么（`result.status` + `checks`）**。

用户不能先研究数据卡、再寻找文件、最后才能发现“未验证”。`verdict` 是**验收结论**，不得替代 `summary` 作为默认主摘要。`title` 是成果标题，不是宣传式改写。

### 1.2 融合式阅读而非字段堆积

每一种内容都有它适合的形态：结论以排版表达；指标直接以数字表达；可预览交付以可阅读的文件表达；长代码以 diff 阅读表达；检查项以审查记录表达。**一个字段集合不等于一张卡片；一个 section 不等于一个大容器。**

### 1.3 一次交付两种结果都成立

- **有 `artifacts`：** 主区域提供文件目录与直接阅读入口；支持文档、图片、链接、数据型产物。
- **无 `artifacts`：** 由 `summary`、`sections`、`decisions`、已有事实说明构成正式文字成果；不可显示“缺少交付物”的误导性空框。
- **只有少量文本：** 允许页面短且留白，不强行补齐指标/卡片或重复文案。

---

## 2. 现有视觉基准：与 PawOffice 首页一致

截图观察：左侧约 250px 的白色导航栏，中间为主场景、顶部一排圆角统计块，右侧为任务流；整体为暖中性灰白+浅鼠尾草绿，轻描边、柔和阴影、大圆角；办公室本体为明亮的 2D/等距工作场景。**这不是要换成深色 IDE、金融仪表盘、暖金奢侈品报告，也不应在成果页出现一套新的品牌。**

### 2.1 视觉 Token 要求

优先复用当前项目真实变量（由 DSH 检查代码确认）。下面是目标视觉尺度，并非强制新增常量：

| 项目 | 目标表现 |
|---|---|
| 背景 | 当前页面的浅灰白；内容面板白底，禁止泛黄纸张覆盖 |
| 强调色 | 现有柔和灰绿；禁止自创金棕、霓虹或第二套主题 |
| 主要文字 | 深灰，避免全纯黑；一级对比度足够高 |
| 辅助文字 | 中性灰，不可淡到难以阅读 |
| 风险/失败 | 克制的琥珀/红色，仅有语义时出现，不泛化满屏色块 |
| 边框/阴影 | 现有细描边、极浅阴影；报告正文不强制套卡 |
| 圆角 | 主阅读容器约 18–24px，独立文件/预览容器约 10–14px；跟随现有系统 |
| 图标 | 复用项目已有图标体系，16–20px 为主；不使用不一致的彩色插画 |
| 动效 | 展开/悬停 120–200ms，轻量，尊重 reduced-motion |

### 2.2 排版参数

| 内容 | 建议字号/节奏 |
|---|---|
| 成果标题 `title` | 28–32px；最长 160 字自然换行，禁止截断主标题 |
| 首屏结论 `summary` | 22–26px，字重 550–650，行高 1.4–1.5 |
| 区块标题 | 18–20px；没有大面积标题底色 |
| 正文/Markdown | 15–16px，行高约 1.65–1.8，段落距 12–20px |
| 辅助信息/版本/时间 | 12–13px，仍需保证清晰 |
| 核心数字 | 28–36px，tabular numbers；不因单位被挤到另一行 |
| 文件条目 | 常规约 64–76px，每条只给一个轻容器或分隔线 |
| 主阅读正文 | 760–860px；宽表格、图表、代码预览可拓展到约 1000px |
| 区域间距 | 32–48px；相邻标题与正文距离 8–16px |

### 2.3 阅读容器与已有办公场景的关系

**首选**现有成果详情的承载方式：如果项目当前已经使用浮层/弹窗，不要改路由和打开机制，仅将其整理为居中的沉浸式阅读面板；桌面端建议最大宽度约 1080–1160px，视口上下留白约 24–40px，内部单一主滚动区。若当前是独立阅读路由，应保留现有路由和返回能力，仅统一其内部呈现；**不得为了效果强制重写入口机制**。不管采用哪种现有承载，顶部只保留工具操作，不设置分类导航。小屏下可使用全屏阅读面板。

容器工具行：关闭/返回；成果名称或“本轮成果”；现有历史切换入口；复制摘要；下载报告。较低频操作可并入“更多”菜单，但一级操作必须可发现。禁止使用“预览/交付/记录”分类按钮充当新 Tab。

### 2.4 用户从办公室到阅读器的连续性

用户点击现有电脑成果气泡或“当前成果”入口后，办公室场景不改、数据不重置；阅读器保持同套字体、图标和微绿状态强调。关闭恢复原来办公室的滚动和焦点；不在成果页复制首页的顶部 KPI 栏和右侧任务流。

---

## 3. 整体信息编排（不等于固定卡片数）

本轮阅读顺序是**呈现优先级**，不是要求每类数据另开一块卡，也不是强行重新排序 `sections` 数组。

| 阅读优先级 | 内容 | 数据来源 | 默认表现 |
|---|---|---|---|
| 1 | 身份与结论 | `result.title`, `summary`, `status`, `owner`, `team`, `teamSize`, `producedAt` | 标题＋醒目结论＋轻元数据 |
| 2 | 本轮实际交付 | `artifacts`，精确相关 `sections.documents` | 轻量可操作文件索引／事实内容 |
| 3 | 验证是否仍有缺口 | `result.status`, `verdict`, `checks`, `risks`，必要时 `whiteboard.status` | 明确状态、待补项提示；不得说“已验证”若只是 ready |
| 4 | 指标和详细工作成果 | `metrics`, `metricsTitle`, `metricsCaption`, `sections` | 数字/文章/文件/表格/图表/代码的原生形态 |
| 5 | 过程、后续与历史 | `decisions`, `tasks`, `next`, `versions`, `note`, `updatedAt`, `steps`, `deliveries` | 精简列表、追溯时间线、局部可展开 |

**首屏响应式条件：** 对于本次真实样例，1440×900 或 1787×864 桌面视口打开后应看到成果标题、完整或可读的 `summary`、ready 状态与至少首个真实交付文件（以及交付总数）；需要复核的信息应在首屏有可见的简短提示。不要为了把全部东西塞进第一屏而缩小字号；其余内容自然向下滚动。

**独立内容与重复内容：** 首屏可以展示文件目录的快捷摘要，正文中的 `sections.documents` 与同一 `artifacts` 精确匹配时，应让点击行为指向同一产物阅读入口，而不是生成重复的完整文件卡片。若结构化 section 还有独有说明，则保留说明。不可依据标题相似执行去重。

**Section 原始顺序：** `result.sections` 内所有成员必须按源数组单列流式展示；`span/column` 不参与排版。同一 section 内可以因 `kind` 使用专业布局；`purpose` 和 `emphasis` 仅用来确定区块的呈现方式与强调强度，不得颠倒同级 section 顺序。

---

## 4. 字段到视觉形态：Result 顶层

| 字段 | 显示方式 | 缺失/边界处理 |
|---|---|---|
| `template`, `runId` | 内部识别、版本关联；默认不作为正文文案 | 禁止将机器 ID 当作用户标题 |
| `title` | 唯一报告主标题 | 空时用中性固定界面提示，不伪造具体成果 |
| `status` | 独立成果状态标识 | `draft/ready/verified/rejected` 含义准确；仅 verified 或契约展示态可称已验证 |
| `summary` | 第一阅读焦点，最多 300 字；自然换行 | 空时不编造总结，从已有正文承接阅读 |
| `verdict` | 验收判定/验收意见，以正文或轻量审查区表达 | 不复制为新的 summary；与 status 并行显示，不互相替代 |
| `owner`, `team`, `teamSize` | 次级元数据单行；人数存在时展示 | 没人数不显示“0 人”（除非实际明确 0） |
| `producedAt`, `updatedAt` | 产出/更新两个独立时间文案；ISO 时间按查看者时区格式化 | 无值即隐藏；绝不拿本地当前时间填补 |
| `metricsTitle`, `metricsCaption` | 数字区标题与辅助说明 | 无值可使用通用视觉标签；不擅自改原文 |
| `note` | 末尾附注或免责声明（需要说明模拟属性时保持可见） | 不把免责声明删除为“冗余信息” |

---

## 5. 指标 Metrics：6 种语义 + 自适应密度

| `kind` | 渲染方案 | 必须读取字段 | 禁忌 |
|---|---|---|---|
| `value` | 大数字＋短单位＋下方标签；无需 KPI 容器 | `label/value/unit` | 不拆单位成新指标 |
| `comparison` | 当前数值为主，前值/变化次级，趋势小箭头 | `previous/change/trend/tone` | `up` 不等于“好”，好坏取 `tone` |
| `status` | 文字为主，状态点/图标作为辅助 | `label/value/tone` | 不强制变成数字或进度条 |
| `target` | 目标与现值并排，`progress` 存在才显示细进度条，目标达成状态由字段决定 | `target/targetStatus/progress` | 不用数值擅自计算达标结论 |
| `text` | 重点事实/短文案，字号比正文略高 | `label/value` | 不加 `%`、单位或符号 |
| `auto` | 优先使用已有有效语义信息；不足则回退为最普通的 label/value | 实际存在的字段 | 不做 NLP 业务推断 |

布局数量：0 项隐藏；1 项舒展单列；2 项两列；3 项三列；4 项 2×2；5–6 项三列；7–12 项转紧凑的多列数据行/表，原始顺序不变；窄屏最多两列、再窄则一列。`emphasis=primary` 放大/提高对比度但**不得排序**。`tone`、`trend`、`targetStatus` 只控制语义颜色/图标，不改变原数值。

**真实样例验收：** 测试用例 `86 个`；测试通过率 `96%` 且目标 `95%`、`targetStatus=met`；待处理问题 `1 项`。不生成“通过 82 个”之类样例未提供的推算值。

---

## 6. 交付 Artifacts：4 种产物及正文阅读

共同基础：以文件名/内容本身为主，不以巨型文件类型图标为主。列表一行可包含：类型图标、`title`、`description`、存在时的 `version`、可用操作。`content` 非空优先于 `url`；按已有逻辑处理 `mimeType`、`sha256` 校验、`runId`、`producedAt`、`change`。`id` 为产物稳定身份，`versionId` 为正文身份，展示版号 `version` 不参与版本身份比较。

| `kind` | 视觉设计 | 阅读/操作设计 |
|---|---|---|
| `document` | 轻量文件行 + 内联/现有预览容器；正文使用高级 Markdown 排版 | 正文标题、列表、段落、表格、代码保持原结构；已有版本对比与下载继续可用 |
| `image` | 图片优先的比例自适应缩略图；附标题与版本信息 | 有效图像可展开大图；不可预览时回退为文件条目 |
| `link` | 外链标题、描述和明显的外跳识别 | 仅已有合法 HTTP(S) URL 可打开，空 URL 不生成假跳转 |
| `data` | 数据资源条目，若已有能力识别内容类型则使用已有表格/文本预览 | 不将任意数据文件臆造为统计图；无法安全预览时显示信息和现有可用下载动作 |

**Markdown 排版：** H1/H2/H3 有明显级差；正文 15–16px、行高 1.65；列表缩进合理；内联代码浅灰底；代码块允许水平滚动；Markdown 表格可横向滚动；原始 HTML 不执行或渲染为任意网页。URL 和内容不能跳过现有完整性与访问限制。

**版本操作：** 复用 `ResultArtifactPreview` 的现有预览、历史版本切换及对比能力；切换历史不偷偷取当前文件；对比只在已有真实版本可用时激活。`change` 的 added/updated/removed/unchanged 是轻量状态文字，不依靠颜色单独表达。

**真实样例：** 恰好有 `登录模块需求说明 v2.0`、`登录接口文档 v1.0`、`验收报告 v1.0` 三份 `text/markdown`，均提供 `content`；不能擅自改成 `.pdf`、`.docx` 或文件大小。目录点击后应能看到原 Markdown 正文，且需求说明 v2.0 为当前版本。

---

## 7. Sections：8 种类型专用渲染（不重新排序）

所有 Section 公共字段：`id/kind/title/caption/emphasis/purpose`；`span/column` 仅旧兼容字段。标题默认中等字号；caption 低权重；`emphasis=primary` 仅增强视觉。无标题时不产生空标题条。

| `kind` | 前端必须长成什么样 | 行为、边界和来源 |
|---|---|---|
| `gallery` | 有主次间距的图片画廊：缩略图、标题、元数据、状态，不是文本卡墙 | `items[].image/title/meta/status`；空 image 显示统一占位，有 URL 可查看大图；保持 items 顺序 |
| `documents` | 文件目录/版本行，极简图标 + 标题、版本、时间、完成状态 | `items[].title/version/at/status`；若 `artifactId+versionId` 精确匹配 artifacts，使用同一预览入口；无精确匹配不假装已有正文 |
| `tests` | 质量报告：顶部精简 metrics/进度，下面逐行 checks | 使用既有 `metrics/progress/progressLabel/checks`；与顶层 `result.checks` 不按标题相似去重，也不据此推断 result.verified |
| `api` | 开发工具式接口表：方法短标记 + 等宽 endpoint + 状态/时间 | `rows[].method/endpoint/status/at`；方法 enum 原样，不制造模拟请求按钮 |
| `environments` | 运行环境列表：环境名称 + status + version/at，失败的项目有轻量警示 | `items[].name/status/version/at`；不凭名字推断真实部署健康度 |
| `files` | 紧凑附件列表：文件名、文件种类、大小和有效 URL | `items[].name/kind/size/url`；不得与 artifact 仅凭文件名合并，也不加虚拟文件大小 |
| `changes` | Git 风格变更清单：状态、路径、+/- 行数；展开真实 diff | `files[].path/status/added/deleted/diff/diffTruncated`；二进制不显示虚假文本 diff；renamed 存在旧路径才呈现对照 |
| `custom` | 由 12 种 block 组合的可读内容组 | 尊重 `layout`，但不跨 section 排序，不将所有 block 变成同一张大卡 |

特别要求：当 `changes` 包含 24 个文件时，默认紧凑文件行、各行就地展开，不默认将全部 diff 放在首页；当 `gallery` 有 8 张图时可以在区块内部自适应缩略图密度，但不改 item 顺序。`purpose` 不用于重新编排 Section 数据序列。`changes` 禁止 purpose、`tests` 的 purpose 只能 evidence——只消费契约合法数据，不要求更改。

**真实样例：** `sections[0]` 是 `changes`，共六条：modified、added、added、deleted、renamed、binary 图片；`sections[1]` 是 `documents`，三项与三份 artifacts 精确匹配。必须能展开可用文本 diff；`docs/login-flow.png` 是 binary 条目，不生成虚假 diff；两个 section 的相对次序不得颠倒。

---

## 8. Custom Blocks：12 种原语完整样式

`sections.kind=custom` 的 `layout` 只影响当前 custom 内部，不影响其与其他 sections 的顺序。四种 layout：`stack`（连续文档）、`columns`（短内容并排）、`grid`（网格）、`cards`（仅当前 custom 内的浅卡片）。宽内容（长表格、Mermaid、代码）始终应获得可读宽度；移动端 columns/grid/cards 转单列或少列，不能把字体压小。

| `blocks[].type` | 设计要求 | 依赖字段／特性 |
|---|---|---|
| `heading` | H2/H3/H4 不同字阶、上下间距，像文档章节而非按钮 | `text/level` |
| `text` | 原生文章式 Markdown；段落、清单、引用、代码语法可读；忽略 HTML | `text`（≤4000） |
| `keyValue` | 标签淡、值突出，双列属性表；小屏上下堆叠 | `items[].label/value/tone` |
| `stats` | 1–4 个紧凑统计数字，使用指标数字语言 | `items[].label/value/unit` |
| `table` | 真实表格，有表头、行分隔、足够列宽；`number/percent` 按格式对齐；`code/method` 等宽；`link` 仅有效地址可点击 | `columns/rows/format`；≤6列≤12行；表格横向滚动 |
| `list` | 默认使用轻量无序或状态列表，状态项用小图标；不凭不存在的序号字段自动编号，不把每行做卡 | `items[].text/status`（passed/pending/failed 或空） |
| `progress` | 细进度条＋已有数值，不将其擅自称为完成率 | `value`（0–100） |
| `chart` | bar/line/pie 各自专用图表；标题、坐标、图例保持清晰，真实值可读取 | `chart/series`；不推断不存在的聚合、不改变类型 |
| `image` | 原始比例自适应图片，点击现有可用预览；无 URL 统一占位 | `url`（空串或有效 HTTP(S)） |
| `diagram` | Mermaid 图形阅读区；无法安全渲染时显示可复制源文本 | `source`；不得执行 HTML/SVG 或不可信脚本 |
| `callout` | 轻底、细边、短图标、文字；info/success/warning/danger 区别明确且克制 | `text/tone` |
| `divider` | 细分隔线/留白，只有分段作用 | 无额外业务字段 |

**实施限制：** 优先复用当前项目已经具备的 Markdown、表格、图表、Mermaid 等渲染能力。若缺失且不加新依赖无法完整实现，则以可读、安全、完整的源内容回退并明确标注“本地暂不支持图形预览”；**不可空白、不可静默丢失源信息、不可偷偷安装依赖**。对于 chart 的真实 `series` 内部结构，需从现有 Schema/项目消费代码确认，不能依照外部图表库习惯臆造字段。

---

## 9. Checks / Risks / Tasks / Decisions / Versions / Next：业务记录

| 数据 | 视觉 | 规则与字段来源 |
|---|---|---|
| `checks` ≤12 | 单列审查记录，小图标+条目+状态；关键待补项首屏摘要 | `label/status/artifactId/versionId`；passed/pending/failed；版本失效按现有 checks.ts 显示待补充，不修改源数据 |
| `risks` ≤8 | 风险记录而非警报墙：title 主、level/status 小、owner/note 次 | high/medium/low 与 open/mitigating/closed 分别展示；关闭风险不再使用开放式警报样式 |
| `tasks` ≤12 | 工作任务清单：title、owner、status、progress/note；与办公室大任务流样式相协调但更紧凑 | todo/doing/blocked/done；progress 无值不造百分比，0 可以明确显示 0 |
| `decisions` ≤8 | 会议纪要式问答：question 弱、choice 强、at 辅助 | 不将 choice 改写为“下一步”或当成待办 |
| `versions` ≤8 | 细线时间轴/版本列表：version、note、author、at、status | draft/released/rolled-back；不等于历史交付 `deliveries` |
| `next` ≤8 | 结尾“接下来”文字列表，紧凑且清楚 | 仅原字符串；不能伪造负责人和期限 |
| `note` | 备注/免责声明：低权重但完整可读 | 样例 `以上内容均为本地模拟业务数据。` 必须保留 |

### 9.1 检查失效——真实样例硬性验收

样例中原始 4 项 checks：3 项 `passed`、1 项 `pending`；其中“需求范围检查”绑定 `artifactId=prd`、`versionId=prd-v1`，但当前 `prd` 为 `prd-v2`。所以前端的**当前有效状态**应清楚呈现为：

- 2 项标记通过（注意：未绑定产物版本的检查无法判断版本有效性）；
- 1 项待处理（短信验证码频率限制复核）；
- 1 项因旧版本绑定而待补充验证（需求范围检查）。

这里的数字仅是**前端由既有契约计算的展示分组**，不写回、不生成新协议字段；不能显示“3 项当前有效通过”，不能把 result.status=ready 当 verified。样例中 1 个 `risks` 为 `level=medium/status=open`，负责人周宁，说明必须可读。

### 9.2 任务与成果状态同时出现

`whiteboard.status` 只表达任务执行，`result.status` 只表达成果状态。任务 completed 时不自动变成 verified；检查失效导致的 presentation conflict 要醒目。只有单独的 result JSON 时没有 whiteboard.status，不能假设任务已完成。`resultPresentation` 十种既有展示态（draft/ready/verified/rejected/conflict/producing/blocked/failed/missing/empty）沿用已有实现与文字规范。

---

## 10. History、Whiteboard、Conversation、Snapshot 的视觉边界

| 层级 | 读取哪些既有字段 | 成果页如何使用 |
|---|---|---|
| `whiteboard` | `title/status/tagline/description/summary/note/steps/detailSections/link/result/deliveries` | 只给出任务背景、独立进度和历史切换；结果正文来自 `result`；`detail` 已废弃不渲染 |
| `deliveries` | `id/sequence/turnId/title/createdAt/board/result/snapshotUrl` | 原历史交付选择器，按 sequence；`turnId` 有值且存在合法关联时才链接轮次 |
| `conversation` | `id/title/employees/tasks/events/whiteboard` | 用户正在查看哪个办公室/会话的上下文；不把成员和事件日志通通搬到成果阅读页 |
| `workspace` | `id/name` | 办公室身份；仅有需要时出现在轻标题 |
| `system` | CPU/内存/网络 | 留在首页系统资源区域，不当成果 KPI |
| `schemaVersion/seq` | 协议版本、更新序号 | 内部同步身份，不显示为报告指标 |

历史交付以当前已存在的交付选择与版本菜单为准；历史 `result` 内联或 `snapshotUrl` 异步读取按现有协议运行。外部历史加载失败只影响被请求的记录，保留错误信息和重试，不回退到当前版本伪装；不将历史中的文件自动并入 `whiteboard.result`。禁止修改后台 64KiB、15 秒、并发上限、SSE/缓存/seq 规则。

---

## 11. 排版密度与异常处理

| 条件 | 前端行为 |
|---|---|
| 0 项 / 空文本 | 不输出“空卡片”，必要时显示统一简短空态；最少保留结果状态和关闭入口 |
| 1 项 | 可用更舒展的单项布局，不强行补齐网格 |
| 2–4 项 | 轻量网格或连续列表，优先扫描效率 |
| 5–8 项 | 紧凑列表/索引，可就地展开内容，但不隐藏交付入口 |
| 9 项以上 | 表格/密集行列表，保持每项都能访问 |
| 300 字 summary / 160 字 title | 完整换行、合理字距，不以省略号藏掉关键信息 |
| 超长 Markdown / diff | 文档正文滚动，代码水平滚动；按需折叠长片段，但原始内容仍可访问 |
| 6 列 table / 大 Mermaid | 可横向滚动或适配容器的预览，不缩小至无法阅读 |
| 空图片 URL / 不可显示图像 | 显示统一图片占位及可用文本，不造图 |
| 版本失效检查 | 不以绿色通过态代表当前版本有效；显示待补充状态 |
| 外链/预览失败 | 局部错误与可重试状态，不让整个成果页变白 |
| 全部只有事实文本 | 正式短报告，无“无文件交付”空块 |
| 只有 artifacts | 文件清单承担主要内容，不编造总结和指标 |
| 不完整/未就绪结果 | 使用 existing resultPresentation 的正确状态与空态 |
| 黑名单内容/不可信 Markdown | 不执行任意脚本、HTML、SVG，使用安全文本或已有安全预览机制 |

无障碍要求：状态不能只靠红绿；所有按钮有可读名称、可用键盘操作；浮层（若现有即浮层）应有合理焦点与 Escape 关闭语义；触控点击区域至少接近 40px；减少动效模式下关闭非必要动画。对比度要保证辅助文字可阅读。

---

## 12. 页面级规范：真实样例的实际阅读路径

DSH 必须用用户提供的 `result-ready-round3.json` 做第一份视觉基准，不允许先用自编造的漂亮假数据替代。

**本数据真实事实：**

- `title=登录模块交付成果`，`status=ready`，`owner=王明`，`team=研发组`，`teamSize=2`。
- `summary=需求说明更新至 v2.0，新增验收报告；接口文档 v1.0 继续保留。`
- `verdict=模拟数据：交付文档已准备好，等待负责人完成上线验收。`
- `metrics` 三项：86 个、96%、1 项；目标 95%。
- `artifacts` 三项：登录模块需求说明 v2.0、登录接口文档 v1.0、验收报告 v1.0；均为 Markdown 文本正文。
- `checks` 四项：2 项标记通过，1 项 pending，1 项旧版本待补充验证（按现有失效规则）。
- `risks` 一项：短信验证码频率限制待复核，medium/open，负责人周宁。
- `sections` 顺序：changes（6 文件）→ documents（3 条，与 artifacts 精确关联）。
- `decisions` 一项：支持账号密码 + 短信验证码。
- `tasks` 两项：登录功能开发 done/100；发布前验收 doing/92。
- `versions` 两项：第 2 轮交付、第 3 轮交付。
- `next` 一项：完成验证码频率限制复核，再进行最终验收。
- `note=以上内容均为本地模拟业务数据。`
- **本文件只有 result 对象，没有 whiteboard.status 与 deliveries；不能在这个孤立样例中虚构执行状态或历史选择项。** 若要完整验证历史切换，需要项目已有合法的白板样例/运行场景。

**视觉优先级：**

1. 标题和成果状态：非常明确是“已交付但未验证”。
2. Summary：最大且最易读的工作结论。Verdict 在验收信息中独立呈现。
3. 三份交付：直达可读 Markdown 原文；目录轻量、操作清晰。
4. 待补充验证：不能藏到折叠深处，首屏至少可见简短提醒。
5. 三个指标、文件变更详情、决策/任务/版本：进入连续正文后清晰查看，不用同权重卡片堆叠。

---

## 13. 实施任务拆分与优先级（仅前端）

### P0：先解决用户真正痛点——视觉主次与真实样例

- 确认并复用现有入口与 Result 阅读承载，不改 2D 首页。
- 移除所有 Tab/分段导航，建立单一阅读流；保留现有操作。
- title + summary 主视觉、status/verdict 正确拆分。
- metrics 三项改为数字排版，不再三张大型 KPI 卡片。
- artifacts 真正可阅读；documents 精确关联不重复造卡。
- changes 用紧凑文件列表和真实 diff；checks 处理旧版本待补充；risks 紧凑清楚。
- 用真实 JSON 出桌面截图 + 录屏，验证首屏与完整滚动体验。

**P0 的完成定义：** 用户不需要找 Tab 就能一眼看到“交付了什么、还没验什么”；原有历史/文件操作没有丢失。

### P1：覆盖协议全部数据类型

- 6 种 metric kinds、4 种 artifact kinds、8 种 section kinds、12 种 custom block types。
- custom 四种 layout；所有状态/风险/任务/版本/历史。
- 依合同新增或复用**合法的前端测试 fixture** 覆盖不同类型；fixtures 仅用于前端验收，不是新后端字段或接口。
- 不能安全绘制的类型必须按第 8 节提供完整可读回退；不要为“效果好”引入新依赖。

**P1 的完成定义：** 每一种合法数据形态都拥有对应的可读表现，不混成通用卡墙，不因布局破坏顺序或内容。

### P2：视觉统一、极限量与交互打磨

- 大量指标、文件、blocks、长表格/长代码的密度与响应式。
- 1280×800、1440×900、用户给定尺寸 1787×864、390×844；无横向溢出（复杂表格/代码内部滚动除外）。
- 键盘、焦点、失败状态、empty、历史切换加载、关闭恢复。
- 清理重复容器、过度阴影、过小文字；做一次全页截图对比与设计回归。

**P2 的完成定义：** 视觉不冲突、极限数据不崩坏、操作与状态保持正确。

---

## 14. 可执行的验收标准（DSH 必须逐项自查）

判定等级：**P0 红线**：任意失败不予验收；**P1 核心**：必须全部完成才称“全类型完成”；**P2 质量**：影响最终视觉评分和是否需要返工。

| 编号 | 等级 | 验收项 | 明确通过条件 |
|---|---|---|---|
| A01 | P0 | 协议零改动 | `packages/protocol`、服务端、Schema、集成契约无改动；没有新增字段、接口、依赖 |
| A02 | P0 | 首页零冲突 | 2D 场景、顶部状态卡、左右侧栏、聊天区与原有交互布局不变 |
| A03 | P0 | 无分类导航 | 成果页 0 个 Tab、0 个 segmented 分类切换、0 个分类侧栏；单一滚动阅读流 |
| A04 | P0 | 操作零回归 | 历史交付切换、文件预览、版本对比、复制摘要、下载报告均有实际可验证行为 |
| A05 | P0 | 状态正确 | `result.ready` 不显示“已验证”；`whiteboard.completed` 不推导验证通过 |
| A06 | P0 | Summary / Verdict 正确 | summary 作为首屏结论，verdict 作为验收结论分别呈现，无任意改写或相互替代 |
| A07 | P0 | 旧版本检查失效 | 样例中的 prd-v1 检查在 prd-v2 当前产物下显示“待补充验证” |
| A08 | P0 | 真实文件内容 | 3 份样例 Markdown 文档可按原内容阅读；文件标题、版本、格式没有被伪造 |
| A09 | P0 | 正文顺序 | sections[0] changes 在 sections[1] documents 之前；任何 section 不能被重新排序 |
| A10 | P0 | 免责声明完整 | 样例“本地模拟业务数据”说明存在、可读，不被优化掉 |
| A11 | P1 | 6 类 metric | auto/comparison/value/status/target/text 各有可读且语义准确的表现 |
| A12 | P1 | 4 类 artifact | document/image/link/data 可读、可用，URL/内容为空有正确回退 |
| A13 | P1 | 8 类 section | gallery/documents/tests/api/environments/files/changes/custom 全覆盖 |
| A14 | P1 | 12 类 block | heading/text/keyValue/stats/table/list/progress/chart/image/diagram/callout/divider 全覆盖或安全的完整信息回退 |
| A15 | P1 | Custom 布局 | stack/columns/grid/cards 在区块内部有效，窄屏不破坏阅读 |
| A16 | P1 | 版本关联 | 匹配 artifactId + versionId 的文档共享预览入口；不按标题猜关联 |
| A17 | P1 | 比较与校验 | versionId 真正决定版本身份；已有对比、hash 校验流程继续有效；失败不伪装成功 |
| A18 | P1 | 风险与任务状态 | 风险等级/处置状态、任务 4 态、版本 3 态、检查 3 态文案均正确 |
| A19 | P1 | 历史一致性 | 使用现有白板/历史样例验证：失败局部显示且不拿当前版本冒充历史 |
| A20 | P1 | 极限数量 | metrics12、artifacts8、sections8、custom blocks24、checks12、tasks12 等不溢出、不丢项 |
| A21 | P1 | 空态与短成果 | summary-only、artifact-only、空结果、部分字段为空均无死白块和虚假占位 |
| A22 | P1 | 安全与源数据 | 不执行不可信 HTML/脚本/SVG，不丢弃不能渲染的 Mermaid/chart 源信息 |
| A23 | P2 | 视觉一致 | 字体/颜色/圆角/阴影/图标统一沿用现有 PawOffice，不出现新品牌风格 |
| A24 | P2 | 视觉主次 | 首屏 title + summary 最醒目，文件入口清楚，验证缺口可见，其余信息降权 |
| A25 | P2 | 阅读密度 | 不出现 5–8 张等权重卡片组成的组块；长内容默认可控、并能完整阅读 |
| A26 | P2 | 响应式 | 1280、1440、1787 桌面与 390 手机适配；无非预期全页横向滚动 |
| A27 | P2 | 无障碍交互 | 操作可键盘触达，状态非纯色区分，文本可读，浮层焦点/关闭正确 |
| A28 | P2 | 视觉回归 | 在指定尺寸提交“首页未改 + 成果首屏 + 完整页 + 文件预览 + 检查异常”证据 |

### 14.1 建议的主观体验验收

对至少 3 位未参与开发的人展示真实样例成果首屏 5 秒，询问：本轮做了什么？有几份交付？是否已经完成验证？其中至少 2 位能准确复述 **“需求说明升级 + 新增验收报告 / 三份文档 / 已交付未验证”**；这项不代替上述任何客观断言，但可检验是否真正解决“不知道先看什么”。

---

## 15. DSH 必须提交的审核材料

只汇报“已完成/截图看着不错”不算交付。请提交：

1. **实际改动文件清单**、关键前端改动摘要，以及“禁止改动范围未改”的自检结果；说明是否新增依赖（必须为否）。
2. **运行方式及可访问路径**（以项目实际命令/路由为准），不发虚构地址。
3. **截图**：① PawOffice 首页（证明未改）② 成果详情首屏（1787×864）③ 成果详情完整长图 ④ 展开需求说明正文 ⑤ 展开 changes diff ⑥ 旧版本检查待补充状态 ⑦ 390×844 手机成果页。截图请注明数据来源。
4. **录屏或复现步骤**：从办公室已有入口打开、浏览交付、文件预览、文件版本对比、复制摘要、下载报告、切换历史、返回办公室。
5. **数据矩阵结果**：上述 6 metric、4 artifact、8 section、12 block、10 presentation states 的测试覆盖表，标注真实样例与合法前端 fixture 的区别；没有真实 fixture 的类型必须明示。
6. **测试结果**：现有项目 lint/typecheck/build/tests 的实际命令与结果；无法执行时明示阻塞原因，不声称通过。
7. **未完成清单**：列出不能实现的能力、原因、是否因现有前端渲染能力不足；禁止自行请求改协议。必须说明每一项采用的安全回退形式。

---

## 16. 评审顺序与通过标准

我后续审核将采用四层门槛：

**门槛一：协议与功能。** A01–A10 全通过，否则直接退回，不做视觉评分。

**门槛二：真实样例视觉。** 判断 1787×864 首屏与完整长图：是否仍是卡片墙，是否做到“结论最醒目、交付容易使用、未验证明确”。不能仅给局部裁图。

**门槛三：全类型覆盖。** A11–A22 全通过或对不可安全图形渲染项有符合本文件要求的明确回退；不接受“先只做当前两个 Section 就算全部完成”。

**门槛四：现有产品融合。** A23–A28 评判 UI 细节、移动端与无障碍；允许根据实图提出最后一轮排版、间距、色彩、字体整改，但不得为了好看突破红线。

**最终成功定义：** 同一 PawOffice 首页和交互不受影响；任意合法成果数据由前端选择专业视觉表达；用户第一眼看到“完成了什么、交付了什么、是否可验收”，而不是在多个 Tab 与同权重卡片中寻找答案。

---

## 17. 需协议支持的能力（本次不做）

**本次没有任何必须新增的协议能力。** 下列潜在增强如果仅靠现有字段不成立，则直接放弃，不可偷加字段：

- 缺少可靠关联时，自动认定某一文件对应某个特定章节；
- 缺少 `emphasis` 等语义时，智能判断“最重要指标”并重排数据；
- 在没有验收逻辑的前提下，从检查数量自动推导“结果已验证”；
- 将任意数据文件自动变成业务图表并产生新的结论；
- 在 `turnId` 缺失时，按时间猜测对应的聊天轮次；
- 从历史交付自动合并已被当前结果删除的产物。

**实施结束后，本文件作为逐项审核依据；如源码现状与文稿设想不符，DSH 应标记具体差异并优先复用既有前端能力，不得私自突破协议约束。**


---

# 二、审核材料 README

# PawOffice 成果阅读页（单页阅读流）验收材料索引

本目录是「成果阅读页只前端重构」任务的验收与文档材料。产品与验收依据为用户提供的规范
`PawOffice_成果阅读页_前端渲染设计与验收规范_V1.0.md`（下称「规范」），以及只读的原始材料目录
`docs/design/chatgpt-result-board-handoff/`（下称「handoff 原始材料」）。

- 任务分支：`feat/result-board-design`（已检出；**不切换、不合并、不提交**）
- 改动性质：仅前端表现层。协议层、服务端、Schema、集成契约、数据推送接口、依赖均冻结。
- 本目录中的文档由 `verification-docs` 编写；`screenshots/` 由 `fixtures-harness` 产出，本文档不写入该目录。

**当前状态（2026-11-11）：主实现已冻结；本目录 7 份文档均为最终版。** 7 份相关测试 80/80 通过，
`tsc`/`eslint` exit 0，9 张截图与 manifest 已产出；A01–A28 结论见 `02-acceptance-self-check.md`，
未完成/部分项见 `05-open-issues.md`。

## 1. 材料编号与含义

| 文件 | 内容 | 何时完成 |
| --- | --- | --- |
| `README.md` | 本索引：编号含义、运行方式、分支与禁止改动声明 | 第一阶段 |
| `01-affected-files-and-reuse.md` | **改动前**源码调查：受影响前端文件清单、现有复用能力表、协议冻结声明 | 第一阶段（改动前） |
| `02-acceptance-self-check.md` | A01–A28 逐项自查表：等级/通过条件/证据/结论，不虚报 | 主实现与测试完成后 |
| `03-test-report.md` | 实际执行的命令、真实输出、阻塞原因与权限说明 | 主实现与测试完成后 |
| `04-data-matrix.md` | 6 metric / 4 artifact / 8 section / 12 block / 10 presentation state 覆盖矩阵 | 第一阶段建模板，验收前更新为最终版 |
| `05-open-issues.md` | 未完成清单、原因、安全回退形式（禁止请求改协议） | 验收前 |
| `06-screenshot-index.md` | 截图索引：既有 9 张验收图 + 本轮 8 张数据类型视觉样张（路径、验收项、数据来源） | 截图产出后 |
| `07-data-type-visual-system.md` | **本轮设计先行文档**：数据类型（6 metric/4 artifact/8 section/12 block）→ 当前实现 → 新视觉形态 → 交互方式 → 验收截图；含两种阅读重心与五类核心内容规格 | 本轮实施前 |
| `screenshots/` | 截图产物与 `manifest.json`（17 张：既有 9 + type-01…08） | 验收夹具脚本产出 |

编号不连续（无 `00`）是有意保留：`02`–`06` 对应规范 §14/§15 的验收与提交材料顺序，`01` 为前置源码调查。

## 2. 如何运行与复现

工作目录为仓库根 `D:\kunlunmeta\ai-office-react`（Windows / pwsh）。以下命令均为本任务实际使用或计划使用的命令：

```powershell
# 单份测试（直接 node 执行，避免 node --test 的 spawn 行为；SSR 测试复用 tests/helpers/vite.mjs）
node tests/resultWorkspace.test.mjs
node tests/resultBoard.test.mjs
node tests/resultReader.test.mjs
node tests/resultPresentation.test.mjs
node tests/resultSectionRouting.test.mjs

# 一次跑多份（node --test 支持多文件）
node --test tests/resultWorkspace.test.mjs tests/resultBoard.test.mjs

# 类型检查与 lint
npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile .tmp/app.tsbuildinfo
npx eslint apps/web/src tests
```

说明：

- SSR 测试通过 `tests/helpers/vite.mjs` 创建 Vite middleware 服务器，把 `packages/*` 的 `dist` 导出
  重定向到 `src/*.ts` 后 `ssrLoadModule`，因此不需要先构建协议包。
- 测试是 React `renderToStaticMarkup` 的静态 HTML 断言；客户端行为（Escape、焦点恢复、diff 预览
  popover、Mermaid 客户端渲染）无法由 SSR 覆盖，只能由截图/人工复现或 Playwright 补充。
- 实际执行结果与失败项以 `03-test-report.md` 为准；未执行的项目不会写成“通过”。

规范要求的 7 张截图（首页、成果首屏 1787×864、完整长图、需求说明正文、changes diff、旧版本检查待补充、
390×844 手机页）由 `fixtures-harness` 的 dev-only 预览页与 Playwright 脚本产出，索引见 `06-screenshot-index.md`。

## 3. 分支与禁止改动声明

本任务自始至终遵守以下约束，并在 `03-test-report.md` 记录校验命令与结果：

1. 分支固定 `feat/result-board-design`；不切换、不建分支、不合并、不提交、不 push。
2. **只改** `tests/**` 与 `docs/design/result-board/**`（本文档目录，`screenshots/` 除外）。
3. **不改**产品源码 `apps/web/src/**`、协议 `packages/**`、服务端 `server/**`、集成 `integration/**`、
   依赖清单 `package.json`/lockfile、Schema 与 handoff 原始材料 `docs/design/chatgpt-result-board-handoff/**`。
4. 不新增字段、不新增接口、不新增依赖、不请求后端补数据；展示所需的分组/排序/状态全部由前端既有契约数据派生。
5. `whiteboard.status` 与 `result.status` 分离；`completed ≠ verified`；复用 `resultPresentation` 与
   `checks.ts` 的版本失效判定，不自创另一套规则。

## 4. 状态标记约定

文档中的结论统一使用：`通过` / `部分` / `未做（原因）` / `待补（依赖项）`。凡未实际执行的测试、
未产出的截图、未验证的交互，一律不写“通过”。真实样例与前端 fixture 在 `04-data-matrix.md` 中分列标注。


---

# 三、07 数据类型视觉体系设计（本轮设计先行文档）

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


---

# 四、01–06 审核材料

# 01 改动前源码调查：受影响前端文件清单 + 现有复用能力表

> 调查时间：2026-11-11（主实现尚未开始，`ResultWorkspace.tsx` 仍为三 Tab 旧结构）。
> 依据：规范 §0「源码调查动作」、`后端到前端数据契约.md`、`sample/*.json` 与仓库当前源码。
> 本文所有描述均来自实际读取的源码（附文件:行号），未编造组件或能力；不存在的能力在第 5 节如实列出。

## 0. 调查方法与基线

- 基线：`git log -1` = `b69f24f`；`git status --short` 仅有未跟踪的 `docs/design/`（原始材料与本目录），
  `git diff --stat HEAD` 为空。即工作区尚无任何前端改动。
- 已读取的源码（全部为当前分支工作区版本）：
  - 承载链路：`apps/web/src/components/OfficeCanvas.tsx`、`WhiteboardReader.tsx`、`ResultDeliveryShell.tsx`、
    `ResultWorkspace.tsx`、`ResultReader.tsx`、`ResultArtifactPreview.tsx`、`ResultChanges.tsx`、
    `ResultSectionCard.tsx`、`ResultBlocks.tsx`、`ResultPrimitives.tsx`、`ResultMarkdown.tsx`、
    `MermaidDiagram.tsx`、`ResultTextPreview.tsx`、`ResultDiffTable.tsx`、`ResultCodeBlock.tsx`、
    `WhiteboardBoardView.tsx`。
  - 纯逻辑层：`apps/web/src/results/{presentation,checks,sections,format,resources,diff,download,filePreview}.ts`、
    `apps/web/src/results/artifactContext.ts`。
  - 样式：`ResultWorkspace.css`、`ResultReader.css`、`ResultChanges.css`、`ResultBlocks.css`、
    `ResultArtifactPreview.css`、`ResultDeliveryShell.css`、`WhiteboardReader.css`、`ResultFilePreview.css`、
    `apps/web/src/index.css`。
  - 数据与测试：`apps/web/src/dashboard/resultDemo.ts`、`tests/helpers/vite.mjs`、
    `tests/{resultWorkspace,resultReader,resultPresentation,resultSectionRouting}.test.mjs`、
    `packages/protocol/src/office-ui.ts`（只读，核对枚举与字段）。
- 数据基线：`docs/design/chatgpt-result-board-handoff/sample/result-ready-round3.json`（主样例）、
  `result-{verified,rejected}-round3.json`、`result-draft-round1.json`、`whiteboard-*-round3.json`、
  `whiteboard-draft-round1.json`。

## 1. 当前承载链路（改动前）

```text
OfficeCanvas.tsx:6        lazy(() => import('./WhiteboardReader.tsx'))
OfficeCanvas.tsx:22       <WhiteboardReader … state={controller.whiteboard.state} onClose={controller.closeWhiteboard} />
  └─ WhiteboardReader.tsx:15   <dialog showModal()> 复用为成果阅读器浮层
       ├─ WhiteboardReader.tsx:52  <ResultWorkspace board result initialDeliveryId onTabChange={scrollTo(0,0)} />
       │    └─ ResultWorkspace.tsx:175  <ResultDeliveryShell board result initialDeliveryId>
       │         └─ ResultDeliveryShell.tsx:111  children(viewBoard, viewResult, historical, executionKnown)
       │              └─ ResultWorkspaceBody.tsx（同文件）:256  role="tablist" 三个 Tab
       │                   ├─ overview : 结论 + metrics 卡片 + 阶段进度 + 交付摘要 + 任务摘要
       │                   ├─ deliverables : ResultReader(view=deliverables) + ResultChanges
       │                   └─ process : attention + ResultReader(view=process) + 风险/任务/版本 <details>
       ├─ ResultDeliveryShell.tsx:113  <ResultArtifactPreview>（版本选择 / 对比 / 下载 / sha256 校验）
       └─ ResultDeliveryShell.tsx:99   <ArtifactPreviewContext.Provider>
```

要点：

- 入口与关闭机制是**原生 `<dialog>` 浮层**，不是独立路由；`WhiteboardReader.tsx:20-30` 使用
  `showModal()`，关闭时 `close()` 并在下一帧把焦点还给触发元素（`trigger.focus()`），点击遮罩也可关闭
  （`:39-43`），Escape 走原生 `onCancel` → `onClose`（`:38`）。规范 §2.3/§2.4 要求保留该机制，只整理内部呈现。
- 顶部工具行已有：导出全部轮次原始数据（`:31-37`、`:47`）、关闭（`:48`）。复制摘要/下载报告在
  `ResultReader.tsx:199-206`（`resultSummaryText` / `resultReport`）。历史切换在 `ResultDeliveryShell.tsx:20-23,101-110`。
- 当前三 Tab 的切换逻辑集中在 `ResultWorkspace.tsx:162-166`（tabs 常量）、`:182`（`activeTab`）、
  `:229-236`（方向键）、`:256-264`（tablist 按钮）、`:266-358`（三个 `role="tabpanel"`），
  以及 `ResultWorkspace.css:117-177`、`:1078-1080`、`:1156-1158` 等 Tab 样式。这是本次要被替换的核心。

## 2. 受影响文件清单

### 2.1 计划修改（产品源码，Lead 实现）

| 文件 | 改动性质 | 职责与注意点 |
| --- | --- | --- |
| `apps/web/src/components/ResultWorkspace.tsx` | 重写为单页阅读流 | 删除 tabs 常量/`activeTab`/tablist/tabpanel/方向键；按“身份与结论 → 交付 → 验证缺口 → 指标与正文 → 过程/历史”连续排版；sections 必须按源数组顺序（见 §4.10）；保留 `ResultDeliveryShell` 包裹、复制摘要、下载报告、文件预览入口、历史入口 |
| `apps/web/src/components/ResultWorkspace.css` | 重写/收敛 | 删除 `.result-workspace-tabs{,-panel}` 相关规则（`:117-177`、`:1078-1080`、`:1156-1158`、`:1253-1255`）；保留 `.result-workspace` 的 `--result-*` token（`:2-11`）、圆角/阴影/响应式基准（`:1039-1063`、`:1237-1265`、`:1065-1067` reduced-motion） |
| `apps/web/src/components/ResultSectionCard.tsx` | 增强 | `documents` 的 `items[]` 当 `artifactId+versionId` 精确命中 artifacts 时必须指向**同一预览入口**（走 `ArtifactPreviewContext`），当前 `DocumentsBody`（`:62-73`）在存在 `artifactId` 时只显示“指定产物版本未提供”，不打开预览 → A16 不满足，需补 |
| `apps/web/src/components/WhiteboardReader.tsx` | 小改 | 三 Tab 移除后 `onTabChange`（`:52`）不再有语义；删除该 prop 或改为“打开时的滚动归零”的一次性行为。**不得改 `<dialog>` 打开/关闭、Escape、焦点恢复、导出 JSON** |
| `apps/web/src/components/WhiteboardReader.css` | 可能微调 | 当前成果浮层宽度 `min(960px, …)`（`:1-2`）、移动端全屏（`:24-28`）。规范 §2.3 建议桌面 1080–1160px；调整宽度属于容器样式，可改但需保证移动端与 Escape/焦点不变 |

### 2.2 计划新增（产品源码，Lead 实现）

| 文件 | 职责 |
| --- | --- |
| `apps/web/src/components/ResultMetrics.tsx` + `.css` | 6 种 metric kind 的数字排版（`value/comparison/status/target/text/auto`）、按数量自适应密度、`emphasis` 只强调不排序；**替换** `ResultReader` 的 KPI 卡片墙（`ResultReader.tsx:209-217` + `ResultReader.css` 的 `.result-metric` 卡样式）。`ResultReader.tsx` 不在 Lead 声明写入范围内，因此新组件独立于它 |
| `apps/web/src/components/ResultArtifactList.tsx` + `.css` | 4 种 artifact kind 的交付目录/文件行；`content` 优先于 `url`；点击交给 `ArtifactPreviewContext.open`（版本预览/对比），保留复制/下载/外链；只做目录与操作，不复制完整文件卡片正文 |
| `apps/web/src/results/board.ts` | 单页阅读流所需的纯展示派生（如验证状态分组、section 顺序辅助、展示用摘要计数等）；**不得**把派生结果写回协议数据，不得改 `presentation.ts/checks.ts/sections.ts` 既有规则 |

> Lead 的任务描述提到 `ResultVerification` 等展示组件可能拆分；以 `task-1` 的 `write_scopes` 为准，
> 若新增文件超出该范围需 Lead 确认，本文不假设。

### 2.3 明确复用、计划不改的组件

`ResultDeliveryShell.tsx`、`ResultArtifactPreview.tsx`、`ResultChanges.tsx`、`ResultBlocks.tsx`、
`ResultPrimitives.tsx`、`ResultMarkdown.tsx`、`MermaidDiagram.tsx`、`ResultTextPreview.tsx`、
`ResultDiffTable.tsx`、`ResultCodeBlock.tsx`、`WhiteboardBoardView.tsx`，以及
`apps/web/src/results/{presentation,checks,format,resources,diff,download,filePreview}.ts`。
`ResultReader.tsx` 计划只使用其 `view="actions"`/`view="next"` 等局部视图（见 §4.4），不改文件；
`results/sections.ts` 的 `resultContentLayout` 只可谨慎复用（见 §5.2）。

### 2.4 验收与文档侧（本次任务自身）

| 文件 | 动作 |
| --- | --- |
| `tests/resultWorkspace.test.mjs` | 改断言：移除 tablist/aria-selected/概览/交付物/过程记录；改为单页流、源顺序、检查失效摘要、ready≠verified、metrics 密度、空态等 |
| `tests/resultBoard.test.mjs` | 新增 SSR 测试，覆盖 A07/A09/A11/A13/A14/A16/A18/A21/A22 |
| `tests/resultReader.test.mjs`、`tests/resultPresentation.test.mjs` | **当前含 tablist 断言，重构后会失败**：`resultReader.test.mjs:132,147-153`；`resultPresentation.test.mjs:86-88`。需同步更新（属 `tests/**` 允许范围），否则测试报告无法只归因于本次实现 |
| `docs/design/result-board/*.md` | 文档（本目录） |
| `apps/web/src/dev/resultBoardFixtures.ts`、`apps/web/dev/result-board.html`、`scripts/result-board/capture.mjs` | 由 `fixtures-harness` 产出，本任务只引用路径，不写入 |

## 3. 现有复用能力表（逐条对应规范要求）

| 能力 | 现有实现位置 | 可复用结论 | 与规范条款的对应 |
| --- | --- | --- | --- |
| 浮层打开/关闭/Escape/焦点恢复 | `WhiteboardReader.tsx:20-30,38-43`；`WhiteboardReader.css`；`OfficeCanvas.tsx:6,22` | **直接复用**，只删 `onTabChange` 回调 | A02、A27、§2.3/§2.4 |
| 导出全部轮次原始数据（JSON） | `WhiteboardReader.tsx:31-37`（`stringifyDocumentObject` + Blob 下载） | 直接复用 | A04 |
| 历史交付切换（含加载/失败/重试/返回当前） | `ResultDeliveryShell.tsx:20-23,32-62,69-77,101-110` | **直接复用**；按 `sequence` 倒序目录、`snapshotUrl` 按需读取、失败只影响该记录、`missingTarget` 不冒充其他轮次 | A04、A19、§10 |
| 文件版本预览对话框（版本下拉/正文/下载/原始文件/sha256） | `ResultArtifactPreview.tsx:16-29,74-114`；`resources.ts:8-42`（8 MiB、15s、同源、sha256 校验） | **直接复用** | A04、A08、A17、§6 |
| 历史版本对比（只比较两份真实正文） | `ResultArtifactPreview.tsx:59-63,87,101-111`；`diff.ts:40-81`（200k 上限、240 行、粗粒度回退） | **直接复用**；`versionId` 决定身份，无真实版本不激活 | A17 |
| 文件变更清单 + diff 预览 | `ResultChanges.tsx:99-164`（前 4 行 + 展开全部；行数/状态；binary 不伪造 diff；oversized/truncated 文案）；`diff.ts:9-37` | **直接复用**；注意 `active` 参数用于 tab 场景（`:100-112`），单页流传 `active` 恒真或删参 | A09、A13、A18、§7 |
| 12 种 custom block 渲染 + 未知类型回退 | `ResultBlocks.tsx:412-425` 注册表、`:387-401` 回退、`:432-440` 四种 layout | **直接复用**，无需新依赖 | A14、A15、A22 |
| Markdown/GMF 表格/代码块（忽略原始 HTML） | `ResultMarkdown.tsx:5-13`（`skipHtml`）；`ResultBlocks.tsx:39-49` | **直接复用** | A08、A22、§6/§8 |
| Mermaid 图形 + 源码回退 | `MermaidDiagram.tsx:56-98`（pele 懒加载、`isSafeRenderedSvg` 拒绝 script/on*/javascript:、失败显示源文本、SSR 输出 `<pre>` 源码） | **直接复用**；SSR 测试可断言源文本保留 | A14、A22 |
| 手绘 chart（bar/line/pie，无图表依赖） | `ResultBlocks.tsx:215-346` | **直接复用**；真实值可读、`aria-label` 汇总 series | A11（部分）、A14 |
| 8 种 section kind 渲染 | `ResultSectionCard.tsx:156-167` | **复用**；但 `documents` 精确关联预览需改（见 §2.1） | A13、A16 |
| 文件预览格式识别（Markdown/CSV/TSV/JSON/code/unsupported） | `filePreview.ts:8-23,25-59`；`ResultTextPreview.tsx` | **直接复用**；`artifactIsText`（`resources.ts:54-56`）决定能否内嵌预览 | A12、A17 |
| 下载（扩展名/MIME/版本后缀） | `download.ts:4-16`；`ResultReader.tsx:139`；`ResultArtifactPreview.tsx:84` | **直接复用** | A04 |
| 复制摘要 / 下载报告 | `ResultReader.tsx:199-206`；`format.ts:163-247`（`resultSummaryText`、`resultReport` 含 sections/checks/stale 文案） | **复用**：可直接用 `ResultReader view="actions"` 或调用纯函数 | A04、§2.3 |
| 状态推导（10 种展示态） | `presentation.ts:10-27`（conflict 优先、ready 文案“尚未标记为验证通过”）；`format.ts:8-12` | **直接复用**，不自创规则 | A05、A06、§9.2 |
| 面板状态文案（任务 5 态） | `presentation.ts:6-8` `boardStatusLabels` | 直接复用 | A18 |
| 检查版本失效（旧版本 → 待补充） | `checks.ts:4-11`（`stale` → `status:'pending'` + 文案“（验证版本已更新，需重新验证）”）；`:13-15` conflict；`:18-31` tests section 去重合并 | **直接复用**；真实样例应呈现 2 通过 / 1 待处理 / 1 待补充 | A07、A05、§9.1 |
| 需要关注项（失败检查/未关闭风险/受阻任务） | `presentation.ts:29-41` `resultAttention` | 直接复用 | A18、§9 |
| 文档与 artifact 精确匹配（按 `artifactId+versionId`，不按标题） | `sections.ts:6-28` `resultDeliveryLayout`：仅当匹配唯一且非 image 时合并元数据，并过滤已合并的 documents 条目；顺序保持不变 | **部分复用**：元数据合并与“不按标题去重”可复用；但被过滤后的 documents section 是否保留说明由实现决定，需保证 A09 顺序与 A16 入口一致 | A16、§3 |
| 区块语义归位（analysis/evidence/supplementary/preview） | `sections.ts:31-46` `resultContentLayout` | **不建议用于单页流**：它把 sections 分成四组，会破坏源数组顺序（见 §5.2）；只可用于导出报告等非顺序场景 | A09 |
| 富文本预览区块（`purpose=artifact-preview`） | `sections.ts:49-55` `artifactPreviewSections`；`ResultArtifactPreview.tsx:95-100` | 直接复用 | A17、§6 |
| 时间格式化（带时区、legacy、不补当前时间） | `format.ts:15-32` | 直接复用 | A24、§4 |
| 结果有无内容判定 / 文件基名 / 团队标签 | `format.ts:43-52,54-65` | 直接复用 | A21、§11 |
| 主题 token / 圆角 / 阴影 / 响应式 | `ResultWorkspace.css:2-11`（`--result-ink/body/muted/line/green/green-soft/amber/red/blue`）、`:13`（max-width 1040）、`:1039-1063`（880/620 断点）、`:1237-1265`（760/620 断点）、`:1065-1067`（reduced-motion）；`ResultReader.css:1-9`、`ResultBlocks.css:4-16` 同套 token；仓库**无全局 CSS 变量**（`index.css` 只有 reset/字体） | 复用并统一；新增组件沿用同名 token，不自造品牌色 | A23、A26、§2.1 |
| 主题字体 | `apps/web/src/index.css:15-23`（PingFang SC/Microsoft YaHei/system-ui） | 直接继承 | A23 |
| 深色/浮层容器 | `WhiteboardReader.css:1-6`（960px 浮层、16px 圆角、backdrop blur）、`:24-28`（≤620px 全屏 + 安全区） | 复用，可把成果态宽度调到 1080–1160（规范建议，非协议） | A23、A26、A28 |
| 无依赖状态 | `package.json:63-93` 现有依赖（react/react-dom/zod/lucide/pixi/pele/jsonc-parser/papaparse/fastify 等） | **不得新增**；Mermaid 已有 `pele`，图表为手绘 SVG，无图表库 | A01 |

## 4. 关键数据消费现状（供单页流实现核对）

1. **顶层身份**：`ResultWorkspace.tsx:239-254` 标题取 `board.title || result.title || '当前成果'`，
   状态用 `presentation.label/description`（`:251-253`），元数据 `owner/team/teamSize/updatedAt||producedAt`
   （`:244-249`）。注意当前标题优先取 `board.title`，规范 §4 要求 `result.title` 是唯一报告主标题，单页流应纠正。
2. **summary/verdict**：`ResultWorkspace.tsx:270-280` 当前把 summary、result.title、verdict、state-description
   依次放在同一区域，verdic 文案沿用旧逻辑；单页流需要 summary 为第一阅读焦点、verdict 独立成验收区（A06）。
3. **metrics**：`ResultReader.tsx:209-217` 用 `.result-metrics` 网格 + `.result-metric` 卡片；
   6 种 kind 的渲染在 `:34-107`，`auto` 解析为 comparison/value（`:34-38`）；
   真实样例三条 metric 都没有显式 `kind`、也没有 `previous`，因此都会渲染成 value 型（其中“测试通过率”带
   `target/targetStatus/progress`，只有显式 `kind:'target'` 才会走 TargetMetric）。规范 §5 要求不得变成 KPI 卡墙，
   故新增 `ResultMetrics` 重做排版；kind 语义判定可参考 `resolveMetricKind` 但不要复制到协议层。
4. **artifacts**：`ResultReader.tsx:109-143` 的 `ArtifactCard` 已有：类型图标、标题/描述、`change` 文案、
   版本文档元数据（`ResultDocumentMetadata`，来自 documents 精确匹配）、查看/复制/下载/打开；
   `versioned = Boolean(preview && versionId)`（`:116`）时“查看”走 `ArtifactPreviewContext`。
   单页流复用该行为但改目录形态（轻量行 + 统一预览入口），不要在 `ResultArtifactList` 内再次展开完整卡片。
5. **sections**：当前 `ResultWorkspace` 只在交付物面板渲染 `changes`（`:123-128`），
   `documents` 被合并进 artifact 元数据；analysis/supplementary/evidence 分散在概览与过程面板
   （`:309-314,340-343`）。单页流必须直接遍历 `result.sections` 保序渲染，`changes` 用 `ResultChanges`，
   其余用 `ResultSectionCard`；`documents` 的精确匹配项共享 artifact 预览入口（A16），必要时以“来源”按钮
   或行点击实现，不生成重复完整文件卡片。
6. **checks**：`ResultWorkspace.tsx:195-196` 已用 `resultEvidenceChecks(result)`，processResult 用
   `resultEvidenceCheckInputs(result)` 作为 `ResultReader` 的 checks 输入；`ResultReader.tsx:145-148` 只渲染
   传入的 check（不重新判 stale）。单页流应继续用 `resultEvidenceChecks` 产出“2 通过 / 1 待处理 / 1 待补充”，
   并保留原 check 数据不变。
7. **risks/tasks/versions/decisions/next/note**：`ResultWorkspace.tsx:21-38` 有中英文标签与 tone 映射；
   `:66-105` 有 TaskRow/VersionRow/RiskRow；`ResultReader.tsx:232-251` 有 checks/decisions/note/next。
   单页流可复用这些行组件或迁移到新组件，但状态文案须与 `presentation.ts`/规范 §9 一致。
8. **attention**：`presentation.ts:29-41` 汇总“检查未通过/待补 + 未关闭风险 + 受阻任务”，
   当前在概览有首屏提醒、过程面板有完整列表（`ResultWorkspace.tsx:293-297,336-339`）。单页流应保留首屏可见提醒。
9. **history**：`ResultDeliveryShell` 已把历史选择、加载、失败隔离做好；`ResultWorkspaceBody` 收到 `historical`
   与 `executionKnown`，当前用它们调整文案（`:184-185,244`）。单页流需保留“历史交付 · 第 N 次”提示与返回当前入口，
   并且历史数据不得并入当前 `whiteboard.result`（规范 §10）。
10. **section 顺序**：`resultContentLayout` 会把 sections 重排分组（analysis/evidence/supplementary/preview），
    **不满足 A09**；`resultDeliveryLayout` 只过滤 items、不移动 section 相对顺序，可作为“去重+元数据”步骤使用。
11. **空态**：`ResultReader.tsx:161` 在 `!resultHasContent` 时输出“本轮还没有可展示的成果。”；
    `ResultWorkspace.tsx:129` 交付物面板有空态；`presentation.ts` 处理 10 种无内容/未就绪状态（A21）。
12. **导出报告**：`format.ts:174-246` 的 `resultReport` 已按 analysis/supplementary/changes/evidence/previews 输出，
    并合并 stale checks；`resultSummaryText`（`:163-171`）供复制摘要。单页流保留两个按钮即可，无需改导出逻辑。

## 5. 明确不可复用 / 需替换的部分

### 5.1 三 Tab 结构（必须删除）

- `ResultWorkspace.tsx:16` `WorkspaceTab`、`:39` `tabIcons`、`:162-166` tabs、`:182` `activeTab`、
  `:183` `tabRefs`、`:211-236` tabId/panelId/switchTab/方向键、`:256-264` tablist、`:266-358` 三个 tabpanel、
  `:198-210` 过程侧内容分组依赖 tab 定位。
- `ResultWorkspace.css:117-177`（tabs 样式）、`:1078-1080`（tabs 覆盖）、`:1156-1158`（tabs 覆盖）、
  `:1253-1255`（移动端 tabs）、`:180-182`（panel focus 样式）。
- 结论：该结构不可局部复用，按规范 §0/§3 必须整体替换为单一滚动阅读流；局部折叠（`<details>`）允许。

### 5.2 `resultContentLayout` 的分类重排

- `sections.ts:31-46` 按 purpose 分组：`analysis/evidence/supplementary/previews/changes`，并在
  `format.ts:204` 的导出报告中按固定分组输出。它适用于“导出报告”，但用于页面会改变源顺序 → **A09 风险**。
- 建议：页面直接遍历源 `result.sections`；仅用 `resultDeliveryLayout` 处理 documents/artifacts 精确合并。
  不得修改 `sections.ts` 既有导出（不在写入范围），也不得为排序新增协议字段。

### 5.3 `ResultReader` 的指标卡片墙

- `ResultReader.tsx:209-217` + `ResultReader.css` 的 `.result-metric` 卡片（每指标一张浅卡）属于规范 §5
  明确禁止的“KPI 卡墙”形态；且 `ResultReader.tsx` 不在 Lead 写入范围。
- 建议：新增 `ResultMetrics` 取代其指标渲染；`ResultReader` 仅保留 `view="actions"`（复制/下载）与
  `view="next"`（下一步）等不冲突的局部视图。

### 5.4 `ResultSectionCard` 的 documents 关联缺口

- `ResultSectionCard.tsx:62-73` 的 `DocumentsBody` 对任何带 `artifactId` 的条目都显示“指定产物版本未提供”，
  既不校验 `versionId` 是否命中 artifacts，也不提供预览入口 → **A16 不满足**。需在同文件内补：
  用 `result.artifacts` 精确匹配 `artifactId+versionId`，命中时通过 `ArtifactPreviewContext.open` 提供同一预览入口；
  未命中时保持现有保守文案，不得凭标题猜测。

### 5.5 `WhiteboardReader` 的 `onTabChange`

- `WhiteboardReader.tsx:52` 把 `onTabChange` 绑到 `content.scrollTo(0,0)`，只为 tab 切换服务；三 Tab 删除后
  该回调无意义。删除它时**不要**顺手改 dialog 生命周期、滚动容器或焦点恢复逻辑。

### 5.6 既有测试中的 Tab 断言（测试侧需同步）

- `tests/resultWorkspace.test.mjs:174-180`（tablist/aria-selected/tabpanel）、`:186`（交付物文案）、
  `tests/resultReader.test.mjs:132-139,147-153`、`tests/resultPresentation.test.mjs:86-88` 均断言 1 个
  tablist / 3 个 tab。单页流实现后这些必然失败；属于测试基线的**有意变更**，需在 `tests/**` 内同步更新，
  并在 `03-test-report.md` 中区分“本次实现导致的有意断言变更”与“真实回归”。

## 6. 协议冻结与禁止改动范围声明

截至本文档写作时（主实现开始前），以下范围**均未改动**，并将在验收时再次核验：

| 范围 | 声明 |
| --- | --- |
| `packages/protocol/**`（含 `office-ui.ts`、Schema、类型、枚举） | 未改；字段名/字段集合/类型/枚举/长度/Schema/序列化结构/默认值一律冻结 |
| `server/**`（服务端校验、缓存、SSE、API、64 KiB/15s/并发上限） | 未改 |
| `integration/**`（集成契约、示例客户端、数据推送接口） | 未改 |
| `docs/design/chatgpt-result-board-handoff/protocol/schemas/*.json` | 未改（原始材料，只读） |
| `package.json` / lockfile / 依赖 | 未改；不新增依赖 |
| `apps/web/src/results/{presentation,checks,sections,format,resources,diff,download,filePreview}.ts` | 本次不计划改；展示派生只允许放在新增 `results/board.ts`，且不回写协议数据 |
| `apps/web/src/components/{ResultDeliveryShell,ResultArtifactPreview,ResultChanges,ResultBlocks,ResultPrimitives,ResultMarkdown,MermaidDiagram,ResultTextPreview,ResultDiffTable,ResultCodeBlock,WhiteboardBoardView}.tsx` | 本次不计划改；仅按既有 API 复用 |
| 首页 2D 场景/顶部统计/左右侧栏/聊天区/任务流/入口位置 | 不改；仅成果浮层内部呈现变化 |

数据一致性口径：

- `whiteboard.status`（任务执行）与 `result.status`（成果状态）独立；`completed ≠ verified`，
  继续使用 `presentation.ts` 的 10 种展示态与 `checks.ts` 的版本失效规则，不自创规则、不写回。
- 页面需要的“2 通过 / 1 待处理 / 1 待补充”“交付总数”“风险数量”等均为**前端由契约数据派生的展示分组**，
  不新增协议字段、不要求后端补信息。
- 历史交付只通过既有 `deliveries`/`snapshotUrl` 读取；失败只影响该记录，不以当前版本冒充历史（规范 §10）。
- 不允许把 `template`/`runId`/`versionId`/`sha256` 等机器标识当作用户标题或宣传文案；不得伪造文件后缀、
  文件大小、段落关联、验收通过率等不存在的业务信息（规范 §0 红线 7）。

## 7. 风险与待确认（改动前）

1. **测试基线冲突**：`resultReader`/`resultPresentation` 既有 tab 断言需同步修改；若不改，测试报告会把预期变更
   误报为回归。需 Lead 确认允许更新这两份测试（仅断言，不动协议校验部分）。
2. **A16 实现位置**：`documents` 精确关联的预览入口落在 `ResultSectionCard.tsx`（在 `task-1` 写入范围），
   但若 Lead 改由 `ResultArtifactList` 承担目录、`documents` 仍由 `ResultSectionCard` 渲染，则两处入口必须使用
   同一 `ArtifactPreviewContext`，不能出现“目录可点、文档行不可点”。
3. **浮层宽度**：`WhiteboardReader.css` 当前成果浮层 960px，规范建议 1080–1160px；属容器样式调整，不涉及协议。
4. **真实样例没有 `whiteboard.status`**：单独的 `result-ready-round3.json` 不得虚构任务状态或历史选择项（规范 §12）；
   历史切换须用 `whiteboard-*.json` 或项目运行场景验证。
5. **不可用 SSR 覆盖的交互**：Escape、焦点恢复、diff popover、Mermaid 客户端渲染、复制/下载（需要浏览器 API）
   只能通过 Playwright/人工复现；SSR 测试只断言静态结构与文案，不声称覆盖这些交互。

## 8. 实现后回补（2026-11-11，冻结后核对）

> 本文件第 1–7 节是**改动前**的源码调查，保持原样。以下记录实现落地后与本调查报告的差异，
> 供验收时对照；不影响 01 作为“改动前基线”的用途。

1. **`WhiteboardReader.tsx`**：拆出 `ResultReaderDialog`（仍为原生 `<dialog>` + `showModal` + Escape + 焦点恢复 + 导出 JSON），
   `WhiteboardReader` 变为数据适配层；dev 验收预览页复用同一个 `ResultReaderDialog`，截图不是简化 mock。
   原 `onTabChange` 回调随三 Tab 一起删除，符合 §5.5 预判。
2. **`apps/web/src/results/format.ts`**：新增导出 `resultMetricKind`（原内部 `resolvedKind` 改名导出），
   仅纯展示派生，未改 `resultReport`/`resultSummaryText` 等既有行为；不涉及协议（A01 不受影响）。
   本文件不在 task-1 的逐文件写入清单中，但属于 `apps/web/src/results` 目录范围且只改前端展示层。
3. **`ResultDeliveryShell.tsx`**：新增“交付历史”下拉（`deliveries.length > 1` 时出现）与 `selectDelivery`；
   历史提示、返回当前成果、快照加载/失败隔离、版本目录、预览对比逻辑均保持原实现。
4. **`ResultChanges.tsx`**：按规范 §7 移除“仅前 4 个 + 全部 N 个文件”折叠，`.result-changes-list` 始终渲染全部文件行；
   binary 仍不生成文本 diff，diff 仍在 top-layer popover 中就地展开。属有意行为变更（见 05 §4）。
5. **新增文件**（与计划一致）：`ResultMetrics.tsx/.css`、`ResultArtifactList.tsx/.css`、`apps/web/src/results/board.ts`；
   另外新增 dev-only 夹具与截图脚本（`apps/web/src/dev/*`、`apps/web/dev/*`、`scripts/result-board/*`），不属于产品运行路径。
6. **`ResultWorkspace.css`**：整体重写阅读流样式，保留并统一 `--result-*` token/圆角/阴影/响应式断点；
   删除 tabs/tabpanel 规则（与 §5.1 一致）。
7. **`ResultSectionCard.tsx`**：`DocumentsBody` 增加 `artifacts` 入参，按 `artifactId+versionId` 精确匹配后
   通过 `ArtifactPreviewContext` 提供 `.result-workspace-doc-open` 预览入口；未匹配时保持保守文案。满足 A16（§5.4 的缺口已补）。
8. **测试侧实际变更**：更新 `tests/{resultWorkspace,resultReader,resultPresentation,whiteboardDetails}.test.mjs`
   的旧 Tab/legacy detail 断言，并新增 `tests/resultBoard.test.mjs`；协议 Schema 校验测试未动。详见 `03-test-report.md`。

## 实现后回补（第二轮：组合式排版重构）

第一轮只完成了"去 Tab + 单页流"，结构上仍是"字段块顺序堆叠"，实测整页 3334px、首屏只见首份交付。第二轮按规范 §1.2「一个字段集合不等于一张卡片」「结论以排版表达」重做了信息组合（仍是纯前端展示层）：

| 区域 | 重构前（单页堆叠） | 重构后（组合式） | 影响文件 |
| --- | --- | --- | --- |
| 抬头 | 标题 + 角落独立状态胶囊 + 独立动作条 | 标题、状态并入 byline 行内，动作收进抬头右侧 | `ResultWorkspace.tsx/.css` |
| 结论 | summary 在 hero 区、verdict 在后面的"验证与验收"大块 | summary 为封面结论，verdict 紧随其下作为"验收意见"批注，需要关注压成一行 | 同上 |
| 交付 | 带 38px 图标方块的 3 行卡片 + `documents` 再重复一份文件列表 | 无卡片文件带（15px 内联 Glyph、70px 行高、动作右对齐）；`documents` 精确同源时改为单行文档索引指向同一预览入口 | `ResultArtifactList.*`、`ResultSectionCard.tsx` |
| 指标 | 3 个带分隔线的数字格（仍是 KPI 观感） | 无边框数字带：数字在上、标签在下，7–12 项转紧凑数据行 | `ResultMetrics.*` |
| 验证 | 4 项检查等权、verdict 重复出现 | 通过项降级（小字灰）、失败/失效项高亮并带版本差异说明 | `ResultWorkspace.*` |
| 过程 | 决策/任务/版本三个整宽纵向块 | 三栏紧凑记录（窄屏单列） | `ResultWorkspace.css` |
| 尺寸 | 整页 3334px，首屏只见首份交付的一部分 | 整页 2220px（-33%），首屏可见全部 3 份交付（418–630px，行高 70–71px） | 截图 02/03 |

约束未变：协议、服务端、集成、依赖零改动；复用的既有能力（`ResultDeliveryShell` 历史切换、`ResultArtifactPreview` 预览/版本对比、`ResultChanges` diff、`ResultBlocks` 原语、`presentation/checks/sections` 判定）均未重写。

# 02 A01–A28 验收自查表

> 判定依据：规范 §14；执行证据来自 `03-test-report.md`（命令与真实输出）、`04-data-matrix.md`（类型覆盖）与
> `06-screenshot-index.md`（9 张截图 + manifest）。
>
> 判定口径：`通过` 仅指有实际证据满足通过条件；`部分` 指功能已实现但证据或边界未完全满足；
> `未做` 指明确未完成并给出原因/安全回退。**没有任何一项是凭“看起来不错”判定的。**
> 说明：本代理无法读取图片（模型不支持图像输入），截图类判定只基于截图文件存在性、manifest 记录的数据来源与
> 视口/尺寸/哈希，以及对应的代码/测试证据；视觉主观项由审核方按截图最终判定，已在 05 标注。

## 汇总

| 等级 | 通过 | 部分 | 未做 |
| --- | --- | --- | --- |
| P0（A01–A10） | 10 | 0 | 0 |
| P1（A11–A22） | 12 | 0 | 0 |
| P2（A23–A28） | 3（A26/A27/A28 自动化证据） | 3（A23/A24/A25 视觉主观） | 0 |

> 2026-11-11 最新更新：A12 已修复并补测试（空 `versionId` 且无 `content`/合法 URL 的 artifact 显示禁用回退，
> 不再打开失败预览）；A26/A27 由 Lead 的 Playwright 核查与 `scripts/result-board/capture.mjs` 自动断言提供证据；
> A28 已完成最终重截（`manifest.json` generatedAt `2026-11-11T12:45:00Z`，9 张截图 + `fixtureSmoke` 全部 ok）。
> 最终冻结代码上 `npm run build` exit 0、`eslint apps/web/src tests scripts` exit 0、`tsc --noEmit` exit 0（见 03 §2.7）。
> **P2 仅剩 A23–A25 三项视觉主观判定**，由审核方按截图完成；其余各项均有测试/截图/自动化证据。

## P0 红线

| 编号 | 等级 | 通过条件 | 证据 | 结论 |
| --- | --- | --- | --- | --- |
| A01 | P0 | `packages/protocol`、服务端、Schema、集成契约无改动；无新增字段/接口/依赖 | `git diff --stat HEAD -- packages server integration package.json` 为空；`git status --short` 在这些路径无输出；未改 `package.json`；新增文件仅 `apps/web/src/components/{ResultMetrics,ResultArtifactList}.*`、`apps/web/src/results/board.ts`、dev 夹具与测试/文档 | **通过** |
| A02 | P0 | 2D 场景、顶部状态卡、左右侧栏、聊天区与原有交互布局不变 | `git status` 未触及首页/场景/侧栏/聊天组件（`OfficeCanvas.tsx`、`OfficeChat*`、`OfficeConversations*`、scene 包等均未改）；截图 `screenshots/01-home-1787x864.png` 存在（manifest：首页 / 1787×864 / home 数据来源） | **通过** |
| A03 | P0 | 成果页 0 Tab、0 segmented 分类切换、0 分类侧栏；单一滚动阅读流 | 测试断言无 `role="tablist"`/`role="tab"`/`aria-selected`/`role="tabpanel"`，且无「概览/交付物/过程记录」文案：`tests/resultBoard.test.mjs`、`tests/resultWorkspace.test.mjs`、`tests/resultReader.test.mjs`、`tests/resultPresentation.test.mjs`；截图 02/03 | **通过** |
| A04 | P0 | 历史交付切换、文件预览、版本对比、复制摘要、下载报告、下载/外链均有实际可验证行为 | 历史切换：`tests/resultBoard.test.mjs`「history deliveries switch…」+截图 09；文件预览：截图 04；版本对比：截图 08 + `tests/resultHistory.test.mjs`（diff/sha256）；复制摘要/下载报告按钮由 `ResultReader view="actions"` 保留（SSR 断言存在）；导出全部轮次 JSON 由 `WhiteboardReader` 保留（`tests/resultReader.test.mjs` 断言按钮） | **通过**（复制/下载为原有逻辑未改，未单独录屏） |
| A05 | P0 | `result.ready` 不显示“已验证”；`whiteboard.completed` 不推导验证通过 | `tests/resultBoard.test.mjs`「real sample … ready not verified」「production result status text is never derived…」「ten presentation states」；`tests/resultPresentation.test.mjs` 10 展示态独立；截图 02 | **通过** |
| A06 | P0 | summary 作首屏结论、verdict 作验收结论分别呈现、无改写/替代 | 真实样例断言 `.result-workspace-conclusion` 在 `.result-workspace-verdict` 之前，两段原文分别出现（`tests/resultBoard.test.mjs`）；截图 02 | **通过** |
| A07 | P0 | 样例中 prd-v1 检查在 prd-v2 当前产物下显示“待补充验证” | 断言检查摘要精确为 `共 4 项检查：2 项标记通过 · 1 项待处理 · 1 项待补充验证`，且 `li[data-status="stale"]` 含 `待补充验证` 与 `原验证版本 prd-v1，当前版本 v2.0`，不得出现“3 项通过”：`tests/resultBoard.test.mjs`；截图 06 | **通过** |
| A08 | P0 | 3 份样例 Markdown 可按原内容阅读；标题、版本、格式未伪造 | SSR 断言 3 份标题/版本/`阅读`/复制/下载与无 `.pdf`/`.docx`/文件大小：`tests/resultBoard.test.mjs`；`ResultTextPreview`/`ResultMarkdown` 原实现复用；截图 04 | **通过** |
| A09 | P0 | `sections[0] changes` 在 `sections[1] documents` 之前；任何 section 不被重排 | `tests/resultBoard.test.mjs` 断言真实样例 changes 索引 < documents 索引，且 matrix 8 个 section 按源数组顺序递增；截图 03 | **通过** |
| A10 | P0 | 样例“本地模拟业务数据”说明存在、可读、未被优化掉 | `.result-workspace-note` 断言含 `以上内容均为本地模拟业务数据。`：`tests/resultBoard.test.mjs`；截图 03（完整长图） | **通过** |

## P1 核心

| 编号 | 等级 | 通过条件 | 证据 | 结论 |
| --- | --- | --- | --- | --- |
| A11 | P1 | 6 类 metric 各有可读且语义准确表现 | **本轮改为 6 种 kind 各自专用形态**：value 数字主视觉 / comparison 当前值+前值+变化+可选双条 / status 状态灯+文字（不借数字字号）/ target 目标 chip+进度+可解析时的目标刻线 / text 事实句 / auto 按既有规则解析；1/2/3/4/5–6/7–12 密度保留，emphasis 只放大不排序。测试：`tests/resultTypeVisual.test.mjs`（kind 结构、bars、status dot、target line）、`tests/resultBoard.test.mjs`（密度/锚点）；截图 `type-01-metrics-kinds.png` |
| A12 | P1 | 4 类 artifact 可读可用；URL/内容为空有正确回退 | **本轮 4 种 artifact 有不同交付形态**：document 文档行 / image 56px 媒体位（合法 URL 才渲染 `<img>`，加载失败回退虚线占位）/ link 域名 chip + 外跳 / data 由既有 mimeType 派生格式 chip；空 URL/空图/空外链禁用文案与 `aria-disabled` 保留。测试：`tests/resultTypeVisual.test.mjs`「four artifact kinds…」+ `tests/resultBoard.test.mjs`；截图 `type-03-artifacts-mixed.png` |
| A13 | P1 | 8 类 section 全覆盖 | 8 类 section 全部有专用形态：gallery 图片网格 / documents 版本文件行（精确同源进同一预览）/ tests 质量报告 / api 接口表 / environments 环境列表 / files 附件行 / changes 变更清单（行内 diff）/ custom 原语组合；源顺序由 `tests/resultTypeVisual.test.mjs` 与 `tests/resultBoard.test.mjs` 断言；截图 `type-08-sections-machinery.png`、`type-06-changes-inline-diff.png` |
| A14 | P1 | 12 类 block 全覆盖或安全信息回退 | 12 种 block 由既有 `ResultBlocks` 渲染（heading/text/keyValue/stats/table/list/progress/chart/image/diagram/callout/divider），本轮未改其安全回退；`tests/resultBoard.test.mjs` 断言 12 种 `data-block-type`、未知类型 `FallbackBlock`、Mermaid 源文本保留；截图 `type-07-fact-mode.png`（text 正文）与 `type-08`（区块机制） |
| A15 | P1 | stack/columns/grid/cards 在区块内部有效、窄屏不破坏阅读 | `tests/resultBoard.test.mjs`「four custom layouts…」+ matrix 8 section 顺序；CSS 复用 `ResultBlocks.css` 既有四种 layout | **通过** |
| A16 | P1 | 匹配 artifactId+versionId 的文档共享预览入口；不按标题猜关联 | `tests/resultBoard.test.mjs`：真实样例 3 个 `.result-workspace-doc-open`；matrix 2 个；错误版本/同名未绑定共 0 个且显示“关联文件不在本轮交付中”；截图 04 | **通过** |
| A17 | P1 | `versionId` 决定版本身份；对比、hash 校验继续有效；失败不伪装成功 | 既有 `tests/resultHistory.test.mjs`（sha256 校验失败、版本对比边界）；`ResultArtifactPreview` 未改；截图 08（版本下拉 + 与当前版本比较） | **通过** |
| A18 | P1 | 风险等级/处置状态、任务 4 态、版本 3 态、检查 3 态文案正确 | **本轮改为审查语言与版本时间线**：checks 结论带 + 四类计数比例条、passed 降级、failed/stale 高亮并给出版本差异；风险登记（高/中/低 × 待处理/处理中/已关闭）；版本纵向时间线（草稿空心/已发布实心绿/已回滚红）。测试：`tests/resultTypeVisual.test.mjs`（checks/risks/versions）、`tests/resultBoard.test.mjs`（文案与 data-*）；截图 `type-04-review-checks-risks.png`、`type-05-versions-timeline.png` |
| A19 | P1 | 现有白板/历史样例验证；失败局部显示且不拿当前版本冒充历史 | 真实 `whiteboard-ready-round3.json` 夹具：`tests/resultBoard.test.mjs` 历史切换（delivery-2 提示/返回当前成果/历史正文）、缺失目标只显示局部 alert；截图 09；`tests/resultHistory.test.mjs` 校验失败隔离 | **通过** |
| A20 | P1 | metrics12、artifacts8、sections8、blocks24、checks12、tasks12 等不溢出不丢项 | `tests/resultBoard.test.mjs`「extreme counts…」：12 指标紧凑行、8 artifacts、8 sections、8 gallery、12 files、24 changes、24 blocks、12 checks、12 tasks、8 versions/risks/decisions/next | **通过**（无极限密度截图，见 05） |
| A21 | P1 | summary-only、artifact-only、空结果、部分字段为空均无死白块/虚假占位 | `tests/resultBoard.test.mjs`「empty, summary-only and artifact-only…」「a result with only a note…」「ten presentation states」 | **通过** |
| A22 | P1 | 不执行不可信 HTML/脚本/SVG；不丢弃 Mermaid/chart 源信息 | `tests/resultBoard.test.mjs`：无未转义事件属性/`<script>`/`<svg onload>`/`href="javascript:`；`&lt;script&gt;` 作为文本存在；Mermaid 源文本、chart series/aria-label 保留 | **通过** |

## P2 质量

| 编号 | 等级 | 通过条件 | 证据 | 结论 |
| --- | --- | --- | --- | --- |
| A23 | P2 | 字体/颜色/圆角/阴影/图标统一沿用 PawOffice，不出现新品牌 | 新组件沿用 `--result-*` token（`ResultWorkspace.css:2-11` 等）；未引入新依赖/字体/第二套主题；仅成果域 CSS 变化；截图 02/03 | **部分**：代码层面未创新品牌；视觉统一性需审核方按截图判定（本代理无法读图） |
| A24 | P2 | 首屏 title+summary 最醒目、文件入口清楚、验证缺口可见、其余降权 | 实测（Playwright 几何 + 本轮视觉复核）：1787×864 首屏内依次出现标题(96–135)、成果状态(147–171)、结论(211–248)、验收意见(264–287)、需要关注 3 项(301–321) 与 **3 份交付文件**(约 418–640，行高 74–77px)，验证结论带在首屏底部可见；`需要关注 3 项`/`3 份交付文件` 有测试断言；截图 02 | **通过（结构/几何/视觉复核证据）**；最终视觉评分仍由审核方判定 |
| A25 | P2 | 不出现 5–8 张等权重卡片；长内容可控可读 | 本轮建立数据类型专用视觉体系：交付文件带（74–77px 行、无卡片）、无边框指标带（6 kind 专属形态、1/2/3/4/5–6/7–12 密度）、审查结论带+四段比例条、版本时间线、行内 diff、说明型/交付型两种阅读模式；沿用首页暖灰白+浅鼠尾草绿，无新品牌/无新依赖；截图 type-01…type-08 + 03 | **通过（类型形态/结构/视觉复核证据）**；最终视觉评分仍由审核方判定 |
| A26 | P2 | 1280/1440/1787/390 适配；无预期外全页横向滚动 | `scripts/result-board/capture.mjs` 在桌面与手机视口对每个 fixture 断言 `scrollWidth - clientWidth <= 0`（无横向溢出）；截图 1787×864 与 390×844 存在；移动端点击区域断言 38/36/40px（Lead 的 Playwright 核查）。**注：为自动化脚本断言，非人工视觉评分** | **通过（自动化证据）** |
| A27 | P2 | 键盘可触达、状态非纯色、文本可读、浮层焦点/关闭正确 | Lead 用 Playwright 实测：Tab 焦点可达「阅读」、Enter 打开预览、Escape 关闭且焦点返回触发按钮、无重复 id、状态均有文字标签、正文对比度脚本检查 0 项 < 4.5；测试同时断言状态文案（非纯色）与 `<dialog>` 关闭/焦点恢复实现保留 | **通过（自动化证据）** |
| A28 | P2 | 指定尺寸提交“首页未改 + 成果首屏 + 完整页 + 文件预览 + 检查异常”证据 | 最终重截：`manifest.json` 记录 **17 张**（既有 9 张 + `type-01…type-08`），`interrupted: null`、`consoleErrors: []`、`fixtureSmoke 23/23`；03 完整长图 1121×2588；type-* 覆盖 6 metric kind / 4 artifact kind / checks+risks / versions / changes+inline diff / fact mode / section machinery；截图 01–09 与 type-01–type-08 | **通过**（材料齐备；视觉评分由审核方完成） |


## 本轮补充（第三轮：数据类型专用视觉体系）

> 设计文档：`07-data-type-visual-system.md`（映射表：数据类型 → 当前实现 → 新视觉形态 → 交互方式 → 验收截图）。

| 验收点（本轮新增） | 实现 | 证据 |
| --- | --- | --- |
| 6 种 metric 各有专属形态（不是同一模板换字） | `ResultMetrics`：数字主视觉 / 双点对比+可选双条 / 状态灯+文字 / 目标 chip+刻线+进度 / 事实句 / auto 解析 | `tests/resultTypeVisual.test.mjs`；`type-01-metrics-kinds.png` |
| 4 种 artifact 各有交付语言 | `ResultArtifactList`：文档行 / 56px 媒体位 / 域名 chip / 格式 chip；空值诚实回退 | `tests/resultTypeVisual.test.mjs`；`type-02`、`type-03` |
| 检查与风险 = 审查语言 | `ResultReviewLog`：四类计数结论带+比例条、stale 版本差异、passed 降级、风险登记（等级/状态/负责人） | `tests/resultTypeVisual.test.mjs`；`type-04` |
| 版本 = 时间语言 | `ResultVersionTimeline`：纵向节点（draft 空心 / released 实心 / rolled-back 红）+ 版本 chip + 作者/时间 + 状态 | `tests/resultTypeVisual.test.mjs`；`type-05` |
| 代码变更 = diff 语言 | `ResultChanges`：文件状态/增删行/路径；点击**行内就地展开**真实 unified diff（`aria-expanded`、Esc 收起），二进制/超限不造假 | `tests/resultTypeVisual.test.mjs` + Playwright 交互实测；`type-06` |
| 两种阅读重心 | `results/readingMode.ts` 由字段组合派生 `delivery/fact`；`data-reading-mode`；fact 模式不渲染交付区、正文前置并显示「说明与结论」 | `tests/resultTypeVisual.test.mjs`；`type-07`、`sample` 02/03 |
| 既有不变量保持 | 协议零改动、无 Tab、Section 源顺序、历史交付、安全回退、无新依赖 | A01/A03/A09/A19/A22 既有证据 + `git diff` 证明 |

已知偏差（均已在 07 §5.2 说明）：link 统一外链新窗口；data 格式只由 mimeType 派生；closed 风险采用同列表弱化而非折叠；comparison 双条仅在可安全解析数字时出现；图片/画廊加载失败回退占位。
## 结论

- **门槛一（A01–A10）：全部通过**，可进入视觉评审。
- **门槛二（真实样例视觉）：截图重截后复核**（最终以 fixtures-harness 的 `manifest.json` 为准），视觉判断待审核方。
- **门槛三（A11–A22）：全部通过**（A12 已修复并补测试；其余由 SSR 测试覆盖）。
- **门槛四（A23–A28）：A26/A27 通过（自动化脚本/Playwright 证据）、A28 通过（最终 9 张截图 + manifest）；
  A23–A25 为“部分”**，原因是视觉主观判定需审核方完成（本代理无法读图），已在 05 列出补充方式，不虚报为通过。


# 03 测试报告（实际执行记录）

> 本报告只记录实际运行过的命令与真实输出；未执行的项目明确写“未执行”。
> 执行时间：2026-11-11 晚；执行环境：`D:\kunlunmeta\ai-office-react`（Windows，pwsh）。
> 会话为 danger-full-access，**不需要也不允许**再申请 `sandbox_permissions`；`node --test` 直接运行成功，
> 未出现沙箱 EPERM。

## 1. 环境

| 项目 | 值 |
| --- | --- |
| 分支 | `feat/result-board-design`（未切换/未合并/未提交） |
| Node | `v22.22.2` |
| 基线提交 | `b69f24f`（改动前 `git log -1`） |
| 主实现状态 | Lead 已冻结（`npm run build` / `tsc` / `eslint` 由 Lead 执行通过） |
| 测试数据 | `docs/design/chatgpt-result-board-handoff/sample/*.json` 的逐字节复制 + 前端验收 fixture |

## 2. 测试命令与结果

### 2.1 一次性回归（Lead 指定的 7 份）

```powershell
node --test tests/resultWorkspace.test.mjs tests/resultBoard.test.mjs tests/resultReader.test.mjs `
  tests/resultPresentation.test.mjs tests/resultSectionRouting.test.mjs `
  tests/whiteboardDetails.test.mjs tests/resultHistory.test.mjs
```

真实输出摘要：

```text
# tests 80
# suites 0
# pass 80
# fail 0
# cancelled 0
# skipped 0
# duration_ms 2626.6279
```

（该命令在实现冻结后多次运行均为 80/80；历史记录：`2450.1687`、`4643.176`、`2626.6279`、最终复核 `3056.5854`。A12 修复与最后字号对齐后重新运行仍 80/80。）

### 2.2 逐份执行（便于定位）

| 文件 | tests | pass | fail | duration_ms |
| --- | --- | --- | --- | --- |
| `tests/resultWorkspace.test.mjs` | 13 | 13 | 0 | 1175.34 |
| `tests/resultBoard.test.mjs`（新增） | 24 | 24 | 0 | 1472.43 |
| `tests/resultReader.test.mjs` | 14 | 14 | 0 | 1128.93 |
| `tests/resultPresentation.test.mjs` | 10 | 10 | 0 | 1047.54 |
| `tests/resultSectionRouting.test.mjs` | 6 | 6 | 0 | 1072.52 |
| `tests/whiteboardDetails.test.mjs` | 4 | 4 | 0 | 1246.42 |
| `tests/resultHistory.test.mjs` | 9 | 9 | 0 | 1040.22 |

### 2.3 类型检查

```powershell
npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile .tmp/app.tsbuildinfo
# exit code 0，无输出
```

### 2.4 Lint

```powershell
npx eslint apps/web/src tests
# exit code 0，无输出
```

> 最终复核以 `npx eslint apps/web/src tests scripts`（含 dev 夹具/截图脚本）执行，同样 exit 0。
> Lead 另执行过同一命令，均 exit 0。

### 2.5 冻结范围核验

```powershell
git diff --stat HEAD -- packages server integration package.json package-lock.json
# 空输出
git status --short -- packages server integration package.json pnpm-lock.yaml package-lock.json
# 空输出
git branch --show-current
# feat/result-board-design
```

结论：A01 的“协议/服务端/Schema/集成/依赖零改动”有实际命令证据。

### 2.6 全量测试：`npm test` 环境阻塞与替代命令（如实记录）

`npm test` **未通过**，但阻塞发生在 `pretest` 阶段，与本次前端改动无关：

```text
> pretest
> npm run packages:build && npm run server:build && npm run licenses:check && npm run assets:build
...
> licenses:check
> node scripts/third-party-notices.mjs --check
Outdated license notice: public/THIRD_PARTY_NOTICES.txt
```

- 原因：`public/THIRD_PARTY_NOTICES.txt` 的依赖声明漂移（构建的 `licenses:generate` 会重写它，Lead 已还原保持干净 diff），
  **改动前基线（clean tree）同样失败**，不是本次单页阅读流改动引入的回归；`packages/*`/`server/*`/依赖均未改动（见 §2.5）。
- 替代命令（Lead 执行，绕过 `pretest`）：`node --test tests/*.test.mjs`（全部测试文件）。
  实际结果：**1019 tests / 1015 pass / 2 fail / 2 skipped**。两个失败均为**改动前基线问题、与本次前端改动无关**：
  1. `tests/teamOverview.test.mjs:91`「the scene trigger suspends presentation without stopping the team host」：
     对 `ConnectedOfficeWorkspace` 源码做正则匹配，期望的写法与当前仓库源码不一致；该文件本次未改
     （`git status` 无 `apps/web/src/ui/**`），单独运行同样失败 → 基线。
  2. `tests/thirdPartyNotices.test.mjs:94`：`Outdated license notice: public/THIRD_PARTY_NOTICES.txt`，
     依赖声明漂移基线（`npm run licenses:check` 在 clean tree 同样失败）。
- 本报告**不声称 `npm test` 通过**；也不把上述两个基线失败写成回归。

### 2.7 构建

- 最终冻结代码上执行 `npm run build`（= prebuild：`packages:build`、`licenses:generate`、`assets:build` + `tsc -b` + `vite build`）：
  **exit code 0**，末尾输出 `✓ built in 930ms`；产物包含 `dist/assets/WhiteboardReader-DN_i-vVg.js`、
  `dist/assets/home-Bp8f7mqm.js` 等。
- 说明：构建过程的 `licenses:generate` 会重写 `public/THIRD_PARTY_NOTICES.txt`；Lead 在构建后已用
  `git checkout -- public/THIRD_PARTY_NOTICES.txt` 还原，保持与基线的干净 diff。这正是 §2.6 中
  `licenses:check` 基线漂移的来源，与本次前端改动无关。
- 最终冻结代码上复跑：`npx eslint apps/web/src tests scripts` exit 0、`npx tsc -p tsconfig.app.json --noEmit` exit 0。

## 3. 测试变更：有意行为变更 vs 回归

单页阅读流移除三 Tab、legacy `detail` 不再渲染，属于规范要求的有意行为变更。以下测试预期同步更新；
**协议 Schema 校验类断言全部保留未动**。

| 文件 | 变更 | 依据 | 分类 |
| --- | --- | --- | --- |
| `tests/resultWorkspace.test.mjs` | 删除 `role=tablist`/`aria-selected`/`tabpanel`/「概览·交付物·过程记录」断言；改为单页流、无 Tab、sections 源顺序、`result-metrics` 计数、完整读取字段与 note | 规范 §0 红线 3、§14 A03/A09/A10 | 有意变更 |
| `tests/resultReader.test.mjs` | 删除 tablist/3 tab 断言；新增无 Tab、dialog 工具行、`任务详情与协作`/`执行阶段` 保留断言 | 同上 | 有意变更 |
| `tests/resultPresentation.test.mjs` | 删除 1 tablist/3 tab 断言；`全部待处理事项` 改为首屏 `需要关注 N 项` 摘要；补充“nested tests 检查仍驱动 conflict”断言 | 规范 §9/§14 A03/A18 | 有意变更 |
| `tests/whiteboardDetails.test.mjs` | legacy `detail` Markdown 不再渲染（规范 §10 已废弃）；仅保留 `detailSections` 渲染断言，并新增“无结构化详情即无详情折叠块” | 规范 §10；Lead 确认 | 有意变更 |
| `tests/resultBoard.test.mjs` | 新增 24 项 SSR 验收测试（A05/A07/A08/A09/A11/A12/A13/A14/A15/A16/A18/A19/A20/A21/A22 与 10 展示态） | 规范 §14 | 新增 |

### 3.1 改动前基线（用于区分回归）

- 重构后、测试更新前：`node tests/resultWorkspace.test.mjs` → **11 pass / 2 fail**，失败点均为旧的三 Tab
  断言（`role="tablist"`、`aria-selected`、`交付物` 文案等），不是产品缺陷。
- `node tests/resultPresentation.test.mjs` → **8 pass / 2 fail**，失败点为旧 tablist/3 tab 与
  `全部待处理事项` 断言。
- `node tests/whiteboardDetails.test.mjs` → **3 pass / 1 fail**，失败点为 legacy Markdown `detail` 仍被断言的旧行为。
- 测试按新单页流更新后：以上 3 份全部通过（见 §2）。

## 4. 阻塞与未执行项

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 沙箱 EPERM | **未发生** | 会话为 danger-full-access，`node --test` 正常；无需升级权限 |
| 浏览器交互自动化（Escape/焦点恢复/复制/下载/版本对比点击） | 未执行自动化 | SSR 测试不能覆盖；由 fixtures-harness 的 Playwright 截图 04/08/09 与人工复现补充 |
| 全仓测试 `npm test` | **失败（基线阻塞）** | `pretest` 的 `licenses:check` 报 `Outdated license notice: public/THIRD_PARTY_NOTICES.txt`；改动前 clean tree 同样失败。替代 `node --test tests/*.test.mjs` → 1019 tests / 1015 pass / 2 fail / 2 skipped，两个失败均为基线问题（`teamOverview.test.mjs:91` 源码正则漂移、`thirdPartyNotices.test.mjs:94` license 声明漂移），与本次无关 |
| 多视口横向溢出自动化 | 未执行 | 只有 1787×864 与 390×844 截图；见 05 |
| 无障碍键盘/焦点自动化 | 未执行 | 依赖真实浏览器；实现层面保留 `<dialog>` 原生语义 |

## 5. 局限

- 本报告不能替代视觉验收：截图由 fixtures-harness 产出（含 manifest/hash/像素统计），本代理无法读图，
  视觉判断由审核方完成。
- 下载/复制/剪贴板/Blob 等依赖浏览器 API 的行为只验证了按钮与既有实现存在，未在自动化中点击。

## 6. 第二轮（组合式排版重构）复跑记录

第二轮重写的是前端组合方式（`ResultWorkspace.tsx/.css`、`ResultMetrics.*`、`ResultArtifactList.*`、`ResultSectionCard.tsx` 的 documents 分支），协议、服务端、测试语义均未变。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 相关测试 7 份 | `node --test tests/{resultWorkspace,resultBoard,resultReader,resultPresentation,resultSectionRouting,whiteboardDetails,resultHistory}.test.mjs` | **80/80 pass，exit 0** |
| 类型检查 | `npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile .tmp/app.tsbuildinfo` | exit 0 |
| Lint | `npx eslint apps/web/src tests scripts` | exit 0 |
| 构建 | `npm run build` | **exit 0**（`✓ built in 1.11s`，产物 `dist/assets/home-UKsS3xHq.js`） |
| 截图 | `node scripts/result-board/capture.mjs` | 9 张重新产出，`fixtureSmoke` 15/15 ok，`consoleErrors: []`；03 完整长图 1121×2220 |
| 交互回归（Playwright 实测） | 打开预览 / Escape 关闭且焦点回到「阅读」/ 复制摘要写入剪贴板 / 下载报告 `登录模块交付成果.md` / diff 13 行 / 文档索引打开同一预览入口 | 全部通过，无 console 错误 |
| 对比度 | 脚本遍历 4 个 fixture 的可见文本，检查 CSS 颜色与等效背景对比度 | 0 项低于 4.5 |
## 7. 第三轮（数据类型专用视觉体系）执行记录

> 设计：`07-data-type-visual-system.md`。本轮只改前端表现层（新增/重写类型组件与 dev-only 夹具），协议/服务端/依赖未变。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 新增类型视觉测试 | `node tests/resultTypeVisual.test.mjs` | **8/8 pass，exit 0**（阅读模式、6 metric、4 artifact、documents 同源、review/risks、versions、inline changes、sections 机制） |
| 既有 + 新增结果测试 | `node --test tests/resultTypeVisual.test.mjs tests/resultBoard.test.mjs tests/resultWorkspace.test.mjs tests/resultReader.test.mjs tests/resultPresentation.test.mjs tests/whiteboardDetails.test.mjs tests/resultHistory.test.mjs tests/resultSectionRouting.test.mjs` | **88/88 pass，exit 0** |
| 类型检查 | `npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile .tmp/final.tsbuildinfo` | exit 0 |
| Lint | `npx eslint apps/web/src tests scripts` | exit 0 |
| 构建 | `npm run build` | **exit 0**（`✓ built in 920ms`） |
| 类型截图 | `node scripts/result-board/capture.mjs` | **17 张**（既有 9 + type-01…08），`consoleErrors: []`、`fixtureSmoke 23/23`、`interrupted: null`；连续重跑幂等 |
| 浏览器交互（Playwright 实测） | 点击 changes 首行 → inline diff、`aria-expanded=true`；Esc 收起并回焦；图片加载失败 → 虚线占位（无破图）；gallery 失败项占位 | 通过，无 console error |

已知限制（与 05 一致）：link 统一外链新窗口；data 格式只由 `mimeType` 派生；closed 风险同列表弱化；12 种 custom block 视觉沿用既有实现（本轮优先五类核心内容）；视觉主观评分仍由审核方按截图判定。

# 04 数据覆盖矩阵（最终版）

> 目的：逐一核对规范 §15.5 要求的 **6 metric / 4 artifact / 8 section / 12 block / 10 presentation state** 的渲染能力与证据。
>
> 数据口径（务必区分）：
> - **用户真实样例**：`docs/design/chatgpt-result-board-handoff/sample/*.json`，由后端演示脚本
>   `integration/clients/send-result-demo.ps1 -DryRun` 真实打印的请求体，不是手写数据。
>   主样例 `result-ready-round3.json` 与 `whiteboard-ready-round3.json` 已**逐字节复制**到
>   `apps/web/src/dev/fixtures/`（SHA-256 见 `screenshots/manifest.json`）。本列只统计这些真实样例是否出现该类型。
> - **前端 fixture**：`apps/web/src/dev/resultBoardFixtures.ts`（dev-only，全部经冻结协议 Schema 校验）。
>   `matrix` 覆盖全类型、`layouts` 覆盖四种 custom 布局、`limits` 覆盖数组上限、`resultBoardStates` 覆盖 10 展示态、
>   `history` 是真实白板样例。fixture 仅用于前端验收，不是新协议字段或接口。
> - 证据：测试用例（`tests/resultBoard.test.mjs` 等）与截图（`screenshots/` + manifest）。
>
> 状态：**最终版**（2026-11-11）。真实样例未覆盖的类型均已明示为“否”，只用 fixture 覆盖。

## 1. 指标 Metrics（6 种 kind，规范 §5）

| 类型 | 合法字段 | 渲染组件 | 真实样例覆盖？ | 前端 fixture | 证据 |
| --- | --- | --- | --- | --- | --- |
| `auto` | 实际存在字段；有有效 `previous` → comparison，否则 value | `ResultMetrics` / `resultMetricKind` | **是**：主样例 3 条 metric 均未写 `kind`（默认 auto），且无 `previous` → 呈现为 value | `matrix`（auto→comparison 与 auto→value 各 1） | `tests/resultBoard.test.mjs`「all six metric kinds…」 |
| `value` | `label/value/unit`，可选 `change` | `ResultMetrics`（`MetricCard`） | **是（间接）**：经 auto 回退得到 value 形态，无显式 `kind:'value'` | `matrix`（显式 value + `emphasis:'primary'`） | 同上；截图 02（真实样例 3 个数字） |
| `comparison` | `previous/change/trend/tone` | `ResultMetrics`（`ComparisonMetric`） | **否**：所有真实样例 metric 均无 `previous/change` | `matrix`（2 条，含 up/down、tone） | `tests/resultBoard.test.mjs`（卡与 dense 行均断言 `首轮 …`/变化） |
| `status` | `label/value/tone` | `ResultMetrics`（`StatusMetric`） | **否** | `matrix`（2 条，neutral/negative） | 同上（断言「待发布」「需复核」） |
| `target` | `target/targetStatus/progress` | `ResultMetrics`（`TargetMetric` / dense note） | **否**：主样例“测试通过率”带 target 字段但 `kind` 省略 → 归入 auto→value，**未触发 target 渲染分支** | `matrix`（2 条：met + at-risk） | 同上（`已达标`/`有风险`/`目标 95%`/progressbar） |
| `text` | `label/value`（不加 %/单位） | `ResultMetrics`（`TextMetric`） | **否** | `matrix`（2 条） | 同上（断言「仅覆盖登录模块」不追加单位） |

布局与密度（`tests/resultBoard.test.mjs`「metric density…」）：
0 隐藏 / 1、2、3、4、6 项卡式（`data-density="card"`，`data-count` 为数量）；7–12 项紧凑数据行
（`data-density="compact"`，`data-count="dense"`，`.result-metric-row`），顺序不变；窄屏两列/单列沿用 CSS。
真实样例不得推算“通过 82 个”这类未提供值。

## 2. 交付物 Artifacts（4 种 kind，规范 §6）

| 类型 | 合法字段 | 渲染组件 | 真实样例覆盖？ | 前端 fixture | 证据 |
| --- | --- | --- | --- | --- | --- |
| `document` | `title/description/content/url/versionId/version/mimeType/sha256/change` | `ResultArtifactList` + `ResultArtifactPreview` + `ResultTextPreview`/`ResultMarkdown` | **是**：3 份 `text/markdown`，都有 `content`/`versionId`/`version`/`sha256`；`prd` 当前 v2.0 | `matrix`（Markdown 正文）、`limits`（8 个上限） | 测试 A08/A12/A16；截图 04（需求说明正文） |
| `image` | 同上；可预览需有效 URL 或内容 | `ResultArtifactPreview` 图片分支；目录用图标/缩略图 | **否** | `matrix`（有 URL 图片 + 空 URL 图片）、`limits` | `tests/resultBoard.test.mjs`「four artifact kinds…」；空图不伪造 `<img>`；`见 05` 空版本回退备注 |
| `link` | 合法 HTTP(S) `url`；空 URL 不生成假跳转 | `ResultArtifactList` 外链入口 / 预览 | **否** | `matrix`（有效外链 + 空外链） | 同上（`打开链接` 仅真实 https，空 URL 为「未提供可用链接」） |
| `data` | `content`/`url`，复用文本预览 | `ResultArtifactList` + `ResultTextPreview`（CSV/JSON） | **否** | `matrix`（`text/csv` 表格正文）、`limits` | 同上 |

真实样例硬性要求（A08）：只有 3 份 Markdown，不得改成 `.pdf`/`.docx`/伪造文件大小；测试断言无这些内容。

## 3. 区块 Sections（8 种 kind，规范 §7；源数组顺序）

| 类型 | 合法字段 | 渲染组件 | 真实样例覆盖？ | 前端 fixture | 证据 |
| --- | --- | --- | --- | --- | --- |
| `gallery` | `items[].image/title/meta/status` | `ResultSectionCard` → `GalleryBody` | **否** | `matrix`（有图/无图/三状态）、`limits`（8 项） | `tests/resultBoard.test.mjs`「all eight section kinds…」「section bodies…」 |
| `documents` | `items[].title/version/at/status/artifactId/versionId` | `ResultSectionCard` → `DocumentsBody`（`.result-workspace-doc-open`） | **是**：1 个 section、3 条与 3 份 artifacts 精确匹配 | `matrix`（2 精确匹配 + 1 未绑定）、`limits`（8 条） | A16 测试；截图 04/03 |
| `tests` | `metrics/progress/progressLabel/checks` | `ResultSectionCard` → `TestsBody` | **否** | `matrix`、`limits`（12 checks） | 同上 |
| `api` | `rows[].method/endpoint/status/at` | `ResultSectionCard` → `ApiBody` | **否** | `matrix`（4 方法）、`limits`（12 行） | 同上 |
| `environments` | `items[].name/status/version/at` | `ResultSectionCard` → `EnvironmentsBody` | **否** | `matrix`（4 状态）、`limits`（8 项） | 同上 |
| `files` | `items[].name/kind/size/url` | `ResultSectionCard` → `FilesBody` | **否** | `matrix`（5 种 kind）、`limits`（12 项） | 同上 |
| `changes` | `files[].path/status/added/deleted/diff/diffTruncated/previousPath/binary` | `ResultChanges`（全部文件行默认可展开，diff 用 top-layer popover） | **是**：1 个 section、6 文件（modified/added/added/deleted/renamed/binary），含真实 unified diff | `matrix`（4 文件含 binary）、`limits`（24 文件） | A09 测试（changes 在 documents 前，6 行全部可见、无「全部 N 个文件」折叠）；截图 05 |
| `custom` | `layout` + `blocks`（12 原语） | `ResultSectionCard` → `CustomSectionBody`（`ResultBlocks`） | **否**：真实样例 sections 仅 changes/documents | `matrix`（12 blocks, stack）、`layouts`（四种布局）、`limits`（24 blocks） | A14/A15 测试 |

注：`whiteboard-*.json` 的 `detailSections` 含 text/keyValue/table/progress/list/callout 原语，但属于**白板任务详情**
（`WhiteboardBoardView`），不等同 `result.sections.custom`，不计入 A13/A14 的真实样例覆盖。

## 4. 自定义区块 Blocks（12 种 type，规范 §8）

| 类型 | 依赖字段 | 渲染组件 | 真实样例覆盖？ | 前端 fixture | 证据 |
| --- | --- | --- | --- | --- | --- |
| `heading` | `text/level` | `ResultBlocks` → `HeadingBlock` | **否** | `matrix`、`layouts`、`limits` | `tests/resultBoard.test.mjs`「all twelve custom blocks…」 |
| `text` | Markdown `text`（忽略原始 HTML） | `TextBlock`（`skipHtml`） | **否** | `matrix`（含原始 HTML 文本）、`layouts` | 同上 + A22 安全测试 |
| `keyValue` | `items[].label/value/tone` | `KeyValueBlock` | **否** | `matrix`、`layouts`、`limits` | 同上 |
| `stats` | `items[].label/value/unit` | `StatsBlock` | **否** | `matrix`、`layouts`、`limits` | 同上 |
| `table` | `columns/rows/format` | `TableBlock` | **否** | `matrix`（status/method/code/owner 格式）、`limits` | 同上（`result-block-table-el`、`data-method`） |
| `list` | `items[].text/status` | `ListBlock` | **否** | `matrix`、`layouts`、`limits` | 同上 |
| `progress` | `value` 0–100 | `ProgressBlock` | **否** | `matrix`、`layouts`、`limits` | 同上（`role="progressbar"`） |
| `chart` | `chart(bar/line/pie)/series` | `ChartBlock`（手绘 SVG） | **否** | `matrix`（bar）、`layouts`（pie）、`limits`（line） | 同上 + chart 值/aria-label 测试 |
| `image` | `url`（空则占位） | `ImageBlock` | **否** | `matrix`/`layouts`/`limits`（空 URL） | 同上（统一占位与 alt 文案） |
| `diagram` | Mermaid `source` | `DiagramBlock` → `MermaidDiagram` | **否** | `matrix`/`layouts`/`limits` | 同上（SSR 保留源文本、失败回退） |
| `callout` | `text/tone` | `CalloutBlock` | **否** | `matrix`/`layouts`/`limits` | 同上 |
| `divider` | 无 | `DividerBlock` | **否** | `matrix`/`layouts`/`limits` | 同上（`<hr`） |

四种 layout（stack/columns/grid/cards）仅作用于 custom 内部：`layouts` fixture + `tests/resultBoard.test.mjs`
「four custom layouts…」。未知 block `type` 由 `FallbackBlock` 回退（不空白、不丢源信息）。

## 5. 展示状态 Presentation（10 种，规范 §9.2）

| 类型 | 判定来源（`presentation.ts`） | 渲染组件 | 真实样例覆盖？ | 前端 fixture | 证据 |
| --- | --- | --- | --- | --- | --- |
| `draft` | `result.status=draft` 且有内容 | `ResultWorkspace` 状态标识/文案 | **是**：`result-draft-round1.json`（2 任务 + 1 下一步，无指标/交付） | `resultBoardStates.draft` | `tests/resultBoard.test.mjs`「ten presentation states…」 |
| `ready` | `result.status=ready` | 同上 | **是**：`result-ready-round3.json`（主样例，必须显示“已交付”而非“已验证”） | `resultBoardStates.ready` | A05 测试；截图 02 |
| `verified` | verified 且无冲突 | 同上 | **是**：`result-verified-round3.json`（4 项检查全 passed，scope-review 绑定 prd-v2） | `resultBoardStates.verified` | 同上 |
| `rejected` | `status=rejected` | 同上 | **是**：`result-rejected-round3.json`（rate-limit failed，scope-review 旧版） | `resultBoardStates.rejected` | 同上；截图 06 覆盖旧版检查 |
| `conflict` | verified 但证据检查存在非 passed/失效 | 同上（“验证待核对”） | **否**：verified 样例全通过；rejected 不会进 conflict | `resultBoardStates.conflict`（verified + 失效 + failed） | 同上 + `tests/resultPresentation.test.mjs` 冲突测试 |
| `producing` | 无内容且 board running | 同上 + 空态 | **否**（draft 样例仍有内容，不进入 producing） | `resultBoardStates.producing` | 同上（`.result-workspace-empty`） |
| `blocked` | 无内容且 board blocked | 同上 | **否** | `resultBoardStates.blocked` | 同上 |
| `failed` | 无内容且 board failed | 同上 | **否** | `resultBoardStates.failed` | 同上 |
| `missing` | 无内容且 board completed | 同上 | **否** | `resultBoardStates.missing` | 同上 |
| `empty` | 无内容且 queued/未开始 | 同上 | **否** | `resultBoardStates.empty` | 同上 |

注意：`whiteboard-rejected-round3.json` 的 `board.status=blocked`，但 `result.status=rejected` 且有内容，
展示态为 `rejected`；任务状态与成果状态分别渲染，`completed ≠ verified`。

## 6. 其他随矩阵核对的数据（规范 §9/§10）

| 数据 | 真实样例覆盖？ | 说明 | 前端 fixture / 证据 |
| --- | --- | --- | --- |
| `checks` 版本失效（A07） | **是** | 主样例 4 项：2 passed、1 pending、1 passed 但绑定 prd-v1（当前 prd-v2）→ 前端显示 2 通过 / 1 待处理 / 1 待补充验证；不得“3 项通过” | `tests/resultBoard.test.mjs` + 截图 06 |
| `risks` 三态（A18） | **部分**：主样例仅 medium/open | high/low、mitigating/closed 未覆盖 | `matrix`（high+closed、low）、`limits`（8 条三态循环）+ 测试 |
| `tasks` 四态（A18） | **部分**：done/doing | todo/blocked 未覆盖 | `matrix`（todo/doing/blocked/done）、`limits`（12 条） |
| `versions` 三态（A18） | **部分**：全部 released | draft/rolled-back 未覆盖 | `matrix`（3 态）、`limits`（8 条） |
| `deliveries` 历史切换（A19） | **是**：`whiteboard-ready-round3.json` 含 3 条内联历史交付 | 无需网络即可切换/返回；外部 `snapshotUrl` 失败隔离由既有测试覆盖 | `history` fixture + 测试 + 截图 08/09 |
| `decisions/next/note`（A10） | **是**：各 1 条；note 为本地模拟说明 | 免责声明必须保留 | `tests/resultBoard.test.mjs` + 截图 03 |
| 空/短成果（A21） | **部分**：draft-round1 数据稀薄 | 纯 summary-only / artifact-only / 空 result 未覆盖 | 测试内构造 + `resultBoardStates` |
| 极限数量（A20） | **否** | 真实样例为常规量 | `limits`（metrics12/artifacts8/sections8/blocks24/checks12/tasks12/changes24/…） |
| 6 类 metric / 8 类 section / 12 block 全类型截图 | **否** | 截图主要为真实样例与历史交付；类型矩阵截图未产出 | 测试覆盖 + dev 预览页 `?fixture=matrix/layouts/limits`；见 05 |

## 7. 结论

- 6 metric / 4 artifact / 8 section / 12 block / 10 presentation state 全部有对应渲染与自动化断言。
- **真实样例**只覆盖：`auto`（→value）、`document`、`changes`/`documents`、presentation `draft/ready/verified/rejected`、
  以及 §6 中的检查失效/风险/任务/版本/历史/note；“部分/否”的类型全部由前端 fixture 覆盖并已明示。
- 没有为覆盖类型新增任何协议字段、接口或依赖。

## 视觉样例对照（本轮新增）

| 数据类型 | 视觉样例截图 | 组件/结构 | 备注 |
| --- | --- | --- | --- |
| 6 metric kind（auto/comparison/value/status/target/text） | `screenshots/type-01-metrics-kinds.png` | `ResultMetrics` | auto 由既有规则解析，不出现 auto 原形 |
| document artifact + documents section | `screenshots/type-02-delivery-document.png` | `ResultArtifactList` + `ResultSectionCard(documents)` | 精确同源进同一预览入口 |
| image/link/data artifact + gallery | `screenshots/type-03-artifacts-mixed.png` | `ResultArtifactList` + `ResultSectionCard(gallery)` | 有效/空 URL 两种回退 |
| checks + risks | `screenshots/type-04-review-checks-risks.png` | `ResultReviewLog` | passed 降级、failed/stale 高亮、stale 版本差异 |
| versions | `screenshots/type-05-versions-timeline.png` | `ResultVersionTimeline` | 三种状态节点 |
| changes（24 文件 + inline diff） | `screenshots/type-06-changes-inline-diff.png` | `ResultChanges` | 二进制/较大文件不造假 |
| 说明型成果（无交付物） | `screenshots/type-07-fact-mode.png` | `ResultWorkspace` + `readingMode` | 无「本轮交付」、正文前置 |
| api/environments/files/tests | `screenshots/type-08-sections-machinery.png` | `ResultSectionCard` | 源顺序不变 |

> 上述 type-* 均为前端验收 fixture（非真实业务数据），数据来源在 `screenshots/manifest.json` 逐张标注；真实样例的 9 张验收截图仍为视觉基准。

# 05 未完成清单与安全回退

> 状态：最终版（2026-11-11）。原则：禁止请求修改协议/服务端；做不到的能力写明原因与安全回退形式，
> 不用假按钮、假数据或空白糊弄。原因分类：**前端能力** / **环境** / **证据**。

## 1. 结论摘要

- A01–A10（P0）：全部通过。
- A11–A22（P1）：**全部通过**（A12 的空 artifact 回退已修复并补测试；空 `versionId` 且无可读正文/URL 时显示
  禁用文案 `暂无图片可预览` / `暂无正文或文件地址`，不再打开失败预览）。
- A23–A28（P2）：A26/A27 通过（capture.mjs 自动断言 + Lead 的 Playwright 核查）；A28 通过（最终 9 张截图 +
  manifest 已重截）；A23/A24/A25 为**部分**（视觉主观判定需审核方完成，本代理无法读图）。
- 未发现需要修改协议或新增依赖才能满足的验收项；规范 §17 的“潜在增强”本次均未实现，也未偷加字段。

## 2. 逐项清单

| 编号 | 未完成/部分内容 | 原因分类 | 安全回退形式 | 影响 |
| --- | --- | --- | --- | --- |
| A23/A24/A25 | 视觉一致性、首屏主次、阅读密度属主观视觉判定；本代理无法读图（模型不支持图像输入），只能确认 CSS token/结构/截图存在 | 证据 | 提供截图 + manifest（数据来源/视口/哈希）；由审核方按规范 §16 门槛二/四判定；如审核提出排版问题，属前端样式整改范围，不涉及协议 | P2 评分项 |
| A11/A13/A14/A20 | chart / block image / 类型矩阵 / 极限密度**没有独立截图**（已由测试与 `limits` fixture 覆盖；dev 预览页 `?fixture=matrix|layouts|limits` 可现场渲染） | 证据 | 测试断言覆盖全部类型与上限；如审核需要可直接打开 dev 预览页截取，不需要改协议或产品源码 | P1/P2 证据 |
| 浏览器行为 | 复制摘要、下载报告、下载文件未单独录屏；剪贴板/Blob 下载依赖浏览器 API | 环境 | 按钮与既有实现保留（`ResultReader`/`download.ts`/`ResultArtifactPreview` 未改），SSR 断言按钮存在；A27 的 Playwright 交互核查覆盖预览打开/关闭/焦点，下载/复制为原有逻辑 | A04 补充证据 |

## 3. 已明确的边界（不作为“未完成”）

- 不新增协议字段/接口/依赖；页面上的 2 通过/1 待处理/1 待补充、交付计数、需关注数量均由既有契约数据派生，不写回。
- 只有 `result` 的孤立样例不虚构 `whiteboard.status` 或历史交付项（规范 §12）；因此真实样例页显示“任务状态未提供”。
- 历史交付失败只影响该记录，不以当前版本冒充历史；`snapshotUrl` 读取仍受 64 KiB/15 秒/并发 4 的既有规则约束。
- `detail`（已废弃 Markdown）不再渲染，仅渲染结构化 `detailSections`（规范 §10，Lead 确认的有意变更）。
- 真实样例未出现的类型全部由 dev-only fixture 覆盖，fixture 仅经前端 Schema 校验，不是新协议。

## 4. 行为差异备注（请 Lead/审核知悉）

1. **首屏“需要关注”的统计口径**：新单页流使用顶层 `result.checks`（`resultBoardChecks`）计算首屏提醒；
   旧实现 `resultAttention` 会合并 `sections.tests` 内的嵌套检查。重构后，仅存在于 tests section 的待处理/失败检查
   仍会在该 section 内显示，并仍参与 `resultVerificationConflict`（verified 冲突判定），但**不再计入首屏“需要关注 N 项”**。
   真实样例的检查都在顶层 `result.checks`，不受影响；`tests/resultPresentation.test.mjs` 已按现行为断言并保留
   “nested 检查驱动 conflict”的不变量。若审核认为首屏也应汇总嵌套检查，属前端展示统计口径调整，不涉及协议。
2. **`changes` 默认展示全部文件行**：规范 §7 要求“24 个文件时默认紧凑文件行、各行就地展开，不默认把 diff 放首页”，
   因此移除了旧“仅前 4 个 + 全部 N 个文件”折叠；真实样例 6 条全部可见，binary 不生成假 diff。属有意变更。
3. **历史交付入口**：`ResultDeliveryShell` 新增“交付历史”下拉（`deliveries.length > 1` 时出现），
   选择后显示“历史交付 · 第 N 轮…”与“返回当前成果”；这是对既有历史切换能力的界面整理，不改数据读取规则。

## 5. 待协议支持的能力（本次不做）

规范 §17 明确本次没有任何必须新增的协议能力。本次实现未新增字段/接口；以下潜在增强均**未做且不偷加**：

- 缺少可靠关联时自动认定某文件对应某章节；
- 缺少 `emphasis` 时智能重排“最重要指标”；
- 从检查数量自动推导“结果已验证”；
- 把任意 data 文件变成业务图表；
- `turnId` 缺失时按时间猜聊天轮次；
- 从历史交付自动合并当前结果已删除的产物。

## 6. 安全回退总述

所有无法安全渲染的内容都按“信息不丢失”回退：未知 block → `FallbackBlock` 文本提示；Mermaid 渲染失败/SSR →
可复制源文本；chart 无数据 → “暂无数据”；空图片 URL → 统一占位；外链失败 → 局部错误提示；历史读取失败 →
局部错误 + 重试，不影响当前成果；不可信 HTML/SVG/脚本 → 忽略/转义，不执行。

## 5. 第三轮（数据类型视觉体系）已知限制

| 项目 | 现状 | 安全回退/说明 |
| --- | --- | --- |
| link artifact 预览 | 统一外链新窗口，即使有 `versionId` 也不进本地预览 dialog | 避免把外链当本地文件；合法 http(s) 才可打开，空 URL 禁用 |
| data artifact 格式化 | 格式 chip 仅由 `mimeType` 派生（JSON/CSV/表格/文本/未知） | 不猜扩展名/业务含义；预览走既有表格/文本识别 |
| 已关闭风险 | 同列表弱化（opacity），不折叠 | 保证 A18 三种状态可见；若需折叠可再调整 |
| comparison 双条 | 仅 value/previous 可安全解析为数字时出现，散文式前值回退文本 | 不推断/不伪造第三个数字 |
| 图片/画廊 | 合法 URL 但加载失败时回退统一虚线占位 | 不显示破图；仍保留查看/打开动作 |
| 12 种 custom block | 沿用既有视觉实现（本轮优先五类核心内容：文件交付/指标/检查与风险/版本/代码变更） | 无新依赖；chart/diagram/table 等既有回退不变 |
| 视觉主观判定 | 已用图像能力逐张复核，但最终评分仍由审核方/产品判断 | 见 06 截图索引与 manifest |


# 06 截图索引（最终版，以最终 manifest 为准）

> 截图目录：`docs/design/result-board/screenshots/`（由 `fixtures-harness` 产出，本任务不写入该目录）。
> 元数据来源：`screenshots/manifest.json`（最终重截：17 张，`interrupted: null`），`branch = feat/result-board-design`，
> `consoleErrors: []`，`fixtureSmoke` 23 项全部 `ok: true`（5 个既有 fixture + 8 个 type fixture + 10 展示态）。
> 数据来源两类：**用户真实样例**（handoff `sample/*.json` 逐字节复制）与**前端 fixture**（dev-only，非真实业务数据）。
>
> 说明：本轮已由 Lead 用图像能力逐张视觉复核（首屏、完整长图、8 张类型样例、手机、diff、历史对比），核对内容包括类型辨识度与断行/对齐；
> 所有截图均为最终重截版（数据类视觉体系：6 metric kind / 4 artifact kind / 审查带 / 版本时间线 / 行内 diff / 两种阅读模式 / 文件带 74–77px 行 / 无边框指标带）。

## 1. 规范 §15.3 要求的 7 张（全部产出）

| # | 截图 | 路径 | 尺寸/视口 | 数据来源 | 证明的验收项 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | PawOffice 首页（证明未改） | `screenshots/01-home-1787x864.png` | 1787×864 | PawOffice 首页（未改动） | A02、A28：2D 场景/顶部统计/左右侧栏/聊天区/入口不变 | 已产出 |
| S2 | 成果详情首屏 | `screenshots/02-result-first-screen-1787x864.png` | 1787×864（manifest 记录阅读器 1120×824） | 真实样例 `result-ready-round3.json`（`fixture=sample`，state ready） | A03、A05、A06、A08、A24、A28：无 Tab、title+summary 最醒目、ready 不显示已验证、首屏可见 `需要关注 3 项` 与首个交付 | 已产出 |
| S3 | 成果详情完整长图 | `screenshots/03-result-full.png` | 1787×864 视口，完整长图 1121×2588（正文约 2524px） | 真实样例 `result-ready-round3.json` | A09、A10、A11、A13、A18、A25：changes→documents 顺序、metrics 数字、风险/任务/版本、免责声明 | 已产出 |
| S4 | 展开需求说明正文 | `screenshots/04-markdown-reading.png` | 1787×864 | 真实样例 `result-ready-round3.json`（点击「登录模块需求说明」打开文档预览） | A04、A08、A16：3 份 Markdown 原文可读、标题/版本/格式未伪造、documents 关联同一预览入口 | 已产出 |
| S5 | 展开 changes diff | `screenshots/05-changes-diff.png` | 1787×864 | 真实样例 `result-ready-round3.json`（展开 `LoginForm.tsx` diff） | A04、A09、A13、A22：6 文件变更全部可见、真实 unified diff、binary 不造假 | 已产出 |
| S6 | 旧版本检查待补充状态 | `screenshots/06-stale-check.png` | 1787×864 | 真实样例 `result-ready-round3.json`（滚动到「需求范围检查」） | A07、A18：prd-v1 检查在 prd-v2 下显示待补充验证；摘要 2 通过/1 待处理/1 待补充 | 已产出 |
| S7 | 390×844 手机成果页 | `screenshots/07-mobile-390x844.png` | 390×844 | 真实样例 `result-ready-round3.json` | A26、A27、A21：单列可读、无横向溢出（capture 脚本断言）、触控目标 38/36/40px（manifest `tapTargets`）、状态文字 | 已产出 |

## 2. 补充截图（A04/A17/A19 证据）

| # | 截图 | 路径 | 尺寸/视口 | 数据来源 | 证明的验收项 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| S8 | 历史版本对比 | `screenshots/08-history-version-compare.png` | 1787×864 | 真实白板样例 `whiteboard-ready-round3.json`（`fixture=history`）：打开文档预览 → 版本选择器切到 `prd-v1` →「与当前版本比较」 | A04、A17、A19：`versionId` 决定版本、真实 diff、历史版本入口 | 已产出 |
| S9 | 历史交付切换 | `screenshots/09-history-delivery.png` | 1787×864 | 真实白板样例 `whiteboard-ready-round3.json`（`initialDeliveryId=delivery-2`） | A04、A19：历史提示「历史交付 · 第 2 轮 · 首次文档交付 … 返回当前成果」、不拿当前版本冒充历史 | 已产出 |

## 3. manifest 关键字段核对

- 9 张截图都有 `sha256`、`bytes`、`capturedAt`、`viewport`、`dataSource`、`fixture`。
- 真实样例复制件 SHA-256：
  - `result-ready-round3.json` = `7C090985EE937F5073002F954B530D960B1375A5CFB33CB34254D20285EAA0FE`
  - `whiteboard-ready-round3.json` = `9B1A6602ABB98A83DEA31C42616569C8EE69C8089A2FD7DFC8789F5BEF8D9958`
- `fixtureSmoke`（15 项，全部 `ok: true`）：`fixture=sample/history/matrix/layouts/limits` +
  `state=draft/ready/verified/rejected/conflict/producing/blocked/failed/missing/empty` 均成功渲染，无控制台错误。
- 手机截图记录 `tapTargets = { deliverableAction: 38, documentOpen: 36, readerAction: 40 }`（A27/A28 自动化证据）。
- 首屏截图记录阅读器尺寸 1120×824（规范 §2.3 桌面 1080–1160px 建议范围内）。
- 数据来源 URL：真实样例为 `/dev/result-board.html?fixture=sample|history`（使用生产同款
  `ResultReaderDialog`/`ResultWorkspace`/`ResultDeliveryShell`/`ResultArtifactPreview`），首页为 `/?conference=0`。

## 4. 数据类型视觉样例（本轮新增 8 张，均为真实浏览器 1787×864）

| # | 截图 | 覆盖的数据类型 | 对应验收点 | 数据来源 |
| --- | --- | --- | --- | --- |
| T1 | `type-01-metrics-kinds.png` | 6 种 metric kind + emphasis + 3 列密度 | A11：每种 kind 有专属形态（数字/双点对比/状态灯/目标刻度/事实句） | 前端 fixture |
| T2 | `type-02-delivery-document.png` | document artifact ×3 + documents 同源索引 + 未关联项 | A08/A16：文档可读、精确同源指向同一预览入口、不重复整卡 | 前端 fixture |
| T3 | `type-03-artifacts-mixed.png` | document / image（有效+空）/ link（有效+空）/ data + gallery | A12：4 种 artifact 有不同形态；空 URL/空图/空外链诚实回退 | 前端 fixture |
| T4 | `type-04-review-checks-risks.png` | checks（passed/pending/failed/stale）+ risks（高/中/低 × 三种状态） | A07/A18：结论带 + 比例条、stale 版本说明、风险登记 | 前端 fixture |
| T5 | `type-05-versions-timeline.png` | versions（draft/released/rolled-back） | A18：版本三态与时间线语言 | 前端 fixture |
| T6 | `type-06-changes-inline-diff.png` | changes 24 文件（新增/修改/删除/重命名/二进制/较大） | A04/A13/A22：真实 diff、行内展开、二进制不造假 | 前端 fixture |
| T7 | `type-07-fact-mode.png` | 说明型成果（无 artifacts/changes） | 本轮验收点 2：阅读重心切换（不再出现交付区） | 前端 fixture |
| T8 | `type-08-sections-machinery.png` | api / environments / files / tests 四类区块 | A13：section 类型专用形态与顺序 | 前端 fixture |

### 4.1 类型矩阵与极限状态（渲染冒烟，未单独截图）

| 项目 | 现状 | 说明 |
| --- | --- | --- |
| 6 metric / 8 section / 12 block（`?fixture=matrix`） | `fixtureSmoke` ok（`tests/resultBoard.test.mjs` 断言） | 类型样例见 T1–T8；需要时可直接打开 dev 预览页截图 |
| 四种 custom layout（`?fixture=layouts`） | `fixtureSmoke` ok | 同上 |
| 极限数量（`?fixture=limits`） | `fixtureSmoke` ok | 同上 |
| 10 展示态（`?state=*`） | `fixtureSmoke` 全部 ok | 同上 |

## 5. 截图未覆盖的交互（需人工/录屏补充）

`<dialog>` 打开/关闭、Escape、焦点恢复、diff 行内展开/收起（已有 Playwright 实测）、剪贴板复制、Blob 下载、文件版本下拉切换等，
无法由静态截图完整证明。代码路径保留（`WhiteboardReader`/`ResultDeliveryShell`/`ResultArtifactPreview`/
`ResultChanges` 均未改变打开/关闭/复制/下载机制）；A27 的键盘/焦点/对比度由 Lead 的 Playwright 实测补充，
本索引不重复声称。


---

# 五、截图 manifest（17 张，数据来源与哈希）

```json
{
  "generatedAt": "2026-11-11T16:04:10.090Z",
  "branch": "feat/result-board-design",
  "previewPage": "/dev/result-board.html",
  "homePage": "/?conference=0",
  "dataTypeSpec": "docs/design/result-board/07-data-type-visual-system.md §5",
  "note": "DEV-ONLY 验收截图。数据来源逐张标注：真实样例为 sample JSON 的逐字节复制，其余为前端验收 fixture。type-01…type-08 为数据类型专用视觉样例，每张记录覆盖的数据类型。",
  "dataSources": {
    "real-sample": "用户真实样例 result-ready-round3.json（逐字节复制）",
    "real-sample-history": "用户真实样例 whiteboard-ready-round3.json（逐字节复制，含历史交付）",
    "frontend-fixture": "前端验收 fixture（非真实数据）",
    "home": "PawOffice 首页（未改动，证明首页零回归）"
  },
  "realSamples": [
    {
      "source": "docs/design/chatgpt-result-board-handoff/sample/result-ready-round3.json",
      "copy": "apps/web/src/dev/fixtures/result-ready-round3.json",
      "sha256": "7C090985EE937F5073002F954B530D960B1375A5CFB33CB34254D20285EAA0FE"
    },
    {
      "source": "docs/design/chatgpt-result-board-handoff/sample/whiteboard-ready-round3.json",
      "copy": "apps/web/src/dev/fixtures/whiteboard-ready-round3.json",
      "sha256": "9B1A6602ABB98A83DEA31C42616569C8EE69C8089A2FD7DFC8789F5BEF8D9958"
    }
  ],
  "fixtureSmoke": [
    {
      "query": "fixture=sample",
      "ok": true,
      "textLength": 1477
    },
    {
      "query": "fixture=history",
      "ok": true,
      "textLength": 1576
    },
    {
      "query": "fixture=matrix",
      "ok": true,
      "textLength": 3142
    },
    {
      "query": "fixture=layouts",
      "ok": true,
      "textLength": 589
    },
    {
      "query": "fixture=limits",
      "ok": true,
      "textLength": 5580
    },
    {
      "query": "fixture=type-metrics",
      "ok": true,
      "textLength": 393
    },
    {
      "query": "fixture=type-delivery",
      "ok": true,
      "textLength": 603
    },
    {
      "query": "fixture=type-artifacts",
      "ok": true,
      "textLength": 507
    },
    {
      "query": "fixture=type-review",
      "ok": true,
      "textLength": 680
    },
    {
      "query": "fixture=type-versions",
      "ok": true,
      "textLength": 322
    },
    {
      "query": "fixture=type-changes",
      "ok": true,
      "textLength": 1399
    },
    {
      "query": "fixture=type-fact",
      "ok": true,
      "textLength": 562
    },
    {
      "query": "fixture=type-sections",
      "ok": true,
      "textLength": 600
    },
    {
      "query": "state=draft",
      "ok": true,
      "textLength": 76
    },
    {
      "query": "state=ready",
      "ok": true,
      "textLength": 77
    },
    {
      "query": "state=verified",
      "ok": true,
      "textLength": 141
    },
    {
      "query": "state=rejected",
      "ok": true,
      "textLength": 145
    },
    {
      "query": "state=conflict",
      "ok": true,
      "textLength": 305
    },
    {
      "query": "state=producing",
      "ok": true,
      "textLength": 96
    },
    {
      "query": "state=blocked",
      "ok": true,
      "textLength": 100
    },
    {
      "query": "state=failed",
      "ok": true,
      "textLength": 96
    },
    {
      "query": "state=missing",
      "ok": true,
      "textLength": 93
    },
    {
      "query": "state=empty",
      "ok": true,
      "textLength": 87
    }
  ],
  "consoleErrors": [],
  "interrupted": null,
  "screenshots": [
    {
      "file": "01-home-1787x864.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        40.68,
        41.92,
        47.58
      ],
      "sha256": "8a8f6867f62d3b7fb986f2f15c63b1ada0391ea7749558b250d3edf85311551f",
      "bytes": 748220,
      "capturedAt": "2026-11-11T16:03:49.722Z",
      "url": "/?conference=0",
      "viewport": "1787×864",
      "dataSource": "PawOffice 首页（未改动，证明首页零回归）",
      "fixture": "home"
    },
    {
      "file": "02-result-first-screen-1787x864.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        53.23,
        50.96,
        53.25
      ],
      "sha256": "c59dd51e135c048e3c6f6332c98401a4756758c9b5bbcb82af158ddd15751127",
      "bytes": 106788,
      "capturedAt": "2026-11-11T16:03:50.659Z",
      "url": "/dev/result-board.html?fixture=sample",
      "viewport": "1787×864",
      "dataSource": "用户真实样例 result-ready-round3.json（逐字节复制）",
      "fixture": "sample",
      "state": "ready",
      "checks": [
        "标题/结论/成果状态/需要关注提示/首个交付文件均首屏可见",
        "阅读器 1120×824"
      ]
    },
    {
      "file": "03-result-full.png",
      "width": 1121,
      "height": 2588,
      "pixelStdev": [
        25.52,
        23.62,
        25.53
      ],
      "sha256": "da0a9c480ac1da8225bcba9b0a5cc5334823f2513cf997996bd6f42ce4e4f9de",
      "bytes": 220585,
      "capturedAt": "2026-11-11T16:03:51.553Z",
      "url": "/dev/result-board.html?fixture=sample",
      "viewport": "1787×864（展开为完整长图，正文 2525px）",
      "dataSource": "用户真实样例 result-ready-round3.json（逐字节复制）",
      "fixture": "sample",
      "state": "ready"
    },
    {
      "file": "04-markdown-reading.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        78.63,
        74.55,
        77.08
      ],
      "sha256": "613d95345aed4e962fef2b439e9e436ece4d6af6c4fd5d97fb752bd962cd9d7a",
      "bytes": 57742,
      "capturedAt": "2026-11-11T16:03:52.713Z",
      "url": "/dev/result-board.html?fixture=sample（点击「登录模块需求说明」打开文档预览）",
      "viewport": "1787×864",
      "dataSource": "用户真实样例 result-ready-round3.json（逐字节复制）",
      "fixture": "sample",
      "state": "ready"
    },
    {
      "file": "05-changes-diff.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        50.43,
        48.65,
        50.16
      ],
      "sha256": "39c1f1c3f70b8f1a2080a2b968f2c5ed6ce152ba24d215515df8a316f47bb4b5",
      "bytes": 55849,
      "capturedAt": "2026-11-11T16:03:53.730Z",
      "url": "/dev/result-board.html?fixture=sample（展开 LoginForm.tsx 的 diff）",
      "viewport": "1787×864",
      "dataSource": "用户真实样例 result-ready-round3.json（逐字节复制）",
      "fixture": "sample",
      "state": "ready"
    },
    {
      "file": "06-stale-check.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        51.52,
        49.37,
        51.35
      ],
      "sha256": "7dacac644a1fc079cd0b08c3ce2e7ca38a4fb8739210dc6c8eb772ac5d1f4443",
      "bytes": 73034,
      "capturedAt": "2026-11-11T16:03:54.977Z",
      "url": "/dev/result-board.html?fixture=sample（滚动到旧版本检查「需求范围检查」）",
      "viewport": "1787×864",
      "dataSource": "用户真实样例 result-ready-round3.json（逐字节复制）",
      "fixture": "sample",
      "state": "ready"
    },
    {
      "file": "07-mobile-390x844.png",
      "width": 390,
      "height": 844,
      "pixelStdev": [
        40.43,
        37.61,
        40.33
      ],
      "sha256": "9f7d166f7c1aa70fd0ebaf9b489fe6511706f2333de9c42eb3211e3c06d97032",
      "bytes": 69570,
      "capturedAt": "2026-11-11T16:04:09.951Z",
      "url": "/dev/result-board.html?fixture=sample",
      "viewport": "390×844",
      "dataSource": "用户真实样例 result-ready-round3.json（逐字节复制）",
      "fixture": "sample",
      "state": "ready",
      "tapTargets": {
        "deliverableAction": 38,
        "documentOpen": 40,
        "readerAction": 40
      }
    },
    {
      "file": "08-history-version-compare.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        77.71,
        73.99,
        75.85
      ],
      "sha256": "105e38aea68ff796528f5b8f2e8aa384e0661c0aabd70a917b426c6a09d6db37",
      "bytes": 51031,
      "capturedAt": "2026-11-11T16:03:56.541Z",
      "url": "/dev/result-board.html?fixture=history（打开「登录模块需求说明」→ 版本选择器切到 prd-v1 → 与当前版本比较）",
      "viewport": "1787×864",
      "dataSource": "用户真实样例 whiteboard-ready-round3.json（逐字节复制，含历史交付）",
      "fixture": "history",
      "steps": [
        "打开当前成果的文档预览",
        "文档版本选择器选择 prd-v1（第 2 轮历史交付）",
        "点击“与当前版本比较”",
        "等待真实 diff 渲染",
        "历史交付选择器：交付历史 当前成果 第 3 轮 · 更新需求与验收 第 2 轮 · 首次文档交付 第 1 轮 · 确认目标"
      ]
    },
    {
      "file": "09-history-delivery.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        52.52,
        50.17,
        52.1
      ],
      "sha256": "3a8986e176e0c1e85c1c13d1e2ed6cb133eebac030989359ac8e922560da966c",
      "bytes": 90165,
      "capturedAt": "2026-11-11T16:03:57.564Z",
      "url": "/dev/result-board.html?fixture=history&delivery=delivery-2（打开第 2 轮历史交付）",
      "viewport": "1787×864",
      "dataSource": "用户真实样例 whiteboard-ready-round3.json（逐字节复制，含历史交付）",
      "fixture": "history",
      "steps": [
        "通过 existing initialDeliveryId 打开 delivery-2",
        "历史提示：历史交付 · 第 2 轮 · 首次文档交付 2026-10-28 11:00:00 · 文档固定为当时版本。 返回当前成果",
        "历史交付选择器：交付历史 当前成果 第 3 轮 · 更新需求与验收 第 2 轮 · 首次文档交付 第 1 轮 · 确认目标"
      ]
    },
    {
      "file": "type-01-metrics-kinds.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        54.02,
        51.55,
        53.7
      ],
      "sha256": "469fbf0c1755c769303a2409dd8fe546ed0682eddc21a449337b5db6b15cf310",
      "bytes": 104118,
      "capturedAt": "2026-11-11T16:03:59.142Z",
      "url": "/dev/result-board.html?fixture=type-metrics",
      "viewport": "1787×864",
      "dataSource": "前端验收 fixture（非真实数据）",
      "fixture": "type-metrics",
      "coverage": "数据类型：6 种 metric kind（value/comparison/status/target/text/auto→comparison）+ emphasis=primary，card 密度 3 列。",
      "scrollTarget": ".result-workspace-metric-band（短内容底部对齐，保留成果标题与全部 6 项指标）"
    },
    {
      "file": "type-02-delivery-document.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        51.51,
        49.3,
        51.34
      ],
      "sha256": "1d08cc6df7538e5959d620df68e85dd6560ab193dcb6eda1346083aa77828bbf",
      "bytes": 74812,
      "capturedAt": "2026-11-11T16:04:00.565Z",
      "url": "/dev/result-board.html?fixture=type-delivery",
      "viewport": "1787×864",
      "dataSource": "前端验收 fixture（非真实数据）",
      "fixture": "type-delivery",
      "coverage": "数据类型：document artifacts ×3（Markdown content + versionId/version）+ documents section 精确同源 3 项 + 1 项未关联文档。",
      "scrollTarget": ".result-workspace-delivery"
    },
    {
      "file": "type-03-artifacts-mixed.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        53.65,
        51.82,
        53.62
      ],
      "sha256": "d6209911ab40bc8c8f9a80d8ab35fff8e9ece4cbd6a6f9cea6b869f638324424",
      "bytes": 112200,
      "capturedAt": "2026-11-11T16:04:01.965Z",
      "url": "/dev/result-board.html?fixture=type-artifacts",
      "viewport": "1787×864",
      "dataSource": "前端验收 fixture（非真实数据）",
      "fixture": "type-artifacts",
      "coverage": "数据类型：document / image（有效 URL + 空 URL）/ link（有效 URL + 空 URL）/ data（JSON content）+ gallery 3 项（含空 image 占位）。",
      "scrollTarget": ".result-workspace-delivery"
    },
    {
      "file": "type-04-review-checks-risks.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        51.14,
        49.05,
        51
      ],
      "sha256": "e87955f565e42c277a4a6ab27c6ee1327d62c0efee2250acfc11e34f58061d56",
      "bytes": 68130,
      "capturedAt": "2026-11-11T16:04:03.362Z",
      "url": "/dev/result-board.html?fixture=type-review",
      "viewport": "1787×864",
      "dataSource": "前端验收 fixture（非真实数据）",
      "fixture": "type-review",
      "coverage": "数据类型：checks 4 项（passed / pending / failed / stale 绑定旧 versionId）+ risks 3 项（high·open / medium·mitigating / low·closed）。",
      "scrollTarget": ".result-workspace-review"
    },
    {
      "file": "type-05-versions-timeline.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        53.2,
        50.92,
        53
      ],
      "sha256": "4e10e2e6152b6c03069b3f8b9f56acd2d1bc516eab9ceed1c116685db6153ca3",
      "bytes": 86148,
      "capturedAt": "2026-11-11T16:04:04.749Z",
      "url": "/dev/result-board.html?fixture=type-versions",
      "viewport": "1787×864",
      "dataSource": "前端验收 fixture（非真实数据）",
      "fixture": "type-versions",
      "coverage": "数据类型：versions 3 项（draft / released / rolled-back）纵向时间线。",
      "scrollTarget": ".result-workspace-record-versions 或 .result-workspace-versions 或 .result-version-timeline 或 .result-workspace-version"
    },
    {
      "file": "type-06-changes-inline-diff.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        49.01,
        47.8,
        48.86
      ],
      "sha256": "bbdafd1d55e34fc2afe3414b15ebf002ae27284c80efcc86878d657df83f59c7",
      "bytes": 50698,
      "capturedAt": "2026-11-11T16:04:06.208Z",
      "url": "/dev/result-board.html?fixture=type-changes（点击第一条文件行展开行内 unified diff）",
      "viewport": "1787×864",
      "dataSource": "前端验收 fixture（非真实数据）",
      "fixture": "type-changes",
      "coverage": "数据类型：changes 24 个文件（added / modified / deleted / renamed / binary / oversized），第一条就地展开真实 unified diff。",
      "scrollTarget": ".result-workspace-detail .result-changes 或 .result-changes 或 .result-workspace-detail [data-kind=\"changes\"]"
    },
    {
      "file": "type-07-fact-mode.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        51.92,
        49.74,
        51.79
      ],
      "sha256": "c003068720a3e00c58cb3448ca1eb29d69e32a958aba4f08177e036a5eb36e1e",
      "bytes": 66486,
      "capturedAt": "2026-11-11T16:04:07.609Z",
      "url": "/dev/result-board.html?fixture=type-fact",
      "viewport": "1787×864",
      "dataSource": "前端验收 fixture（非真实数据）",
      "fixture": "type-fact",
      "coverage": "数据类型：说明型成果（无 artifacts、无 changes）——summary / verdict + 2 个 custom text section + decisions + next + note。",
      "scrollTarget": ".result-workspace-detail"
    },
    {
      "file": "type-08-sections-machinery.png",
      "width": 1787,
      "height": 864,
      "pixelStdev": [
        51.3,
        49.23,
        51.24
      ],
      "sha256": "36917d5896f1f8e49d65b0bcc4838d3053c782b2f8f18ab72b6978cc88831cc6",
      "bytes": 58964,
      "capturedAt": "2026-11-11T16:04:09.045Z",
      "url": "/dev/result-board.html?fixture=type-sections",
      "viewport": "1787×864",
      "dataSource": "前端验收 fixture（非真实数据）",
      "fixture": "type-sections",
      "coverage": "数据类型：api 3 行 / environments 4 种状态 / files 4 项 / tests（指标 + 进度 + 检查）区块机制。",
      "scrollTarget": ".result-workspace-detail（api / environments / files 主体与 tests 标题同屏；tests 正文在 DOM 中断言）"
    }
  ]
}
```
