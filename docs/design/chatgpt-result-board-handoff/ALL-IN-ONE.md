# 成果看板改版 · 设计输入（合集）

> 本文件由三部分组成：①设计任务书 ②需求原话与提炼 ③关键源码附录。
> 请先读完 ① 和 ② 再设计；③ 用于核对字段与真实渲染逻辑。

---

# 成果看板（Result Board）前端改版 · 设计任务书

> 这是一份交给外部设计方（ChatGPT）的输入材料。请完整读完再开始设计方案。
> 材料末尾附有完整源码与截图清单；本文档中引用的行号对应 `code/` 目录下的副本。

---

## 0. 一句话说明你要交付什么

为「AI 办公室」产品的**成果阅读页**做一次**纯前端**的信息架构 + 视觉重构：

- 从现在的 **3 个 Tab** 改为 **1 个页面集成全部成果**；
- 解决"用户不知道该看哪、该看啥"的信息层级缺失问题；
- 并为**场景内**设计一个轻量的「成果状态概览」显示；
- **不改协议、不加依赖、不丢功能**。

---

## 1. 产品背景

「AI 办公室」（仓库 `ai-office-react`，包名 `@pawoffice/*`）是一个 2D 办公室场景应用：

- 场景用 **Pixi.js 8** 渲染：一间办公室、若干工位、若干 AI 员工角色，员工会走动、协作、在工位前工作。
- 覆盖层是 **React 19** 的仪表盘、聊天面板、白板阅读器等。
- 用户给 AI 团队派任务，一轮任务结束后产生一份**本轮成果**（`OfficeResult`）：结论、指标、交付文件、检查项、风险、任务、版本记录等。
- 成果通过场景里的**白板 / 成果入口 / 工具栏**打开，打开后是一个模态阅读器（`<dialog>`，标题"成果阅读器"），内部即本次要重构的 `ResultWorkspace`。

**产品定位**：用户看到的不是"文档列表"，而是"这轮事情做到什么程度、东西能不能用、问题在哪"。
所以成果页的核心任务不是"陈列内容"，而是**让用户在三秒内建立判断**。

---

## 2. 技术栈与前端边界

| 项 | 内容 |
| --- | --- |
| 框架 | React 19.2 + TypeScript 5，Vite 构建 |
| 场景 | Pixi.js 8.18（`packages/renderer-pixi`、`packages/scene-office`），React 只做覆盖层 |
| 图标 | `lucide-react`（已在依赖里，可直接用） |
| 校验 | `zod` 4（协议层，**只读**） |
| 样式 | 原生 CSS 文件（无 CSS Modules、无 Tailwind、无 CSS-in-JS），按组件平铺 `.css`，BEM-ish 前缀命名（`result-workspace-*`） |
| 无障碍 | 现有代码有 `role="tablist"/"tabpanel"`、`aria-label`、焦点恢复、`sr-only` 状态播报——改版需保留等价能力 |

**你只能设计方案，不能修改的范围**（实施阶段由内部执行）：

- `packages/protocol/`、`packages/contracts/`、`packages/runtime/`
- `server/`（Fastify 服务端）
- `integration/`
- 任何 zod schema 字段（`OfficeResult` 的字段集合**不可增删改**）

**可设计的范围**：`apps/web/src/components/`、`apps/web/src/*.css`、场景覆盖层的展示组件。

---

## 3. 目录结构（节选，只列与本任务相关的部分）

```
ai-office-react/
├─ apps/web/src/
│  ├─ components/
│  │  ├─ ResultWorkspace.tsx        ← 当前三 Tab 主页面（360 行，核心改造对象）
│  │  ├─ ResultWorkspace.css        ← 该页面全部样式（1284 行）
│  │  ├─ ResultDeliveryShell.tsx    ← 历史交付切换 + 文件预览上下文（121 行）
│  │  ├─ WhiteboardReader.tsx       ← 模态容器 <dialog>，负责打开/关闭/导出（56 行）
│  │  ├─ ResultReader.tsx           ← 分视图渲染器：hero/metrics/artifacts/checks/next
│  │  ├─ ResultSectionCard.tsx      ← 8 种结构化区块的通用卡片
│  │  ├─ ResultBlocks.tsx           ← 区块内 primitive 渲染（表格/图/代码/列表…）
│  │  ├─ ResultArtifactPreview.tsx  ← 文件预览弹层（含版本对比、下载）
│  │  ├─ ResultChanges.tsx          ← 文件变更列表
│  │  ├─ ResultPrimitives.tsx       ← Chip / Track 等小组件
│  │  ├─ WhiteboardBoardView.tsx    ← 任务详情与协作（白板 detailSections）
│  │  ├─ ChatDeliveries.tsx         ← 聊天中的交付卡（打开同一个阅读器）
│  │  ├─ OfficeCanvas.tsx          ← 场景覆盖层，挂载 WhiteboardReader
│  │  ├─ Result*.css               ← 各组件样式（16 个 css 文件）
│  │  └─ …
│  ├─ results/                      ← 纯前端数据加工（可改，但不得改协议）
│  │  ├─ presentation.ts            ← 状态推导：resultPresentation / resultAttention
│  │  ├─ sections.ts                ← 区块按 purpose 分流：analysis/evidence/supplementary/preview
│  │  ├─ checks.ts / format.ts / diff.ts / download.ts / highlight.ts …
│  │  └─ artifactContext.ts         ← 文件预览打开上下文
│  ├─ dashboard/resultDemo.ts       ← 一份完整演示数据（电商经营复盘），可直接当样例
│  └─ index.css                     ← 全局重置 + 中文字体栈
├─ packages/protocol/src/office-ui.ts   ← OfficeResult 定义（只读）
│  ├─ packages/scene-office/            ← 场景、白板、锚点（场景改动受限）
│  └─ packages/renderer-pixi/           ← Pixi 渲染层
└─ tests/browser/*.mjs                  ← 现有浏览器测试（改动需同步）
```

---

## 4. 当前实现现状

### 4.1 打开路径（现状）

```
场景（点击白板 / 工具栏按钮）
  → WhiteboardReader.tsx        <dialog class="whiteboard-reader is-result">，标题「成果阅读器」
      → ResultDeliveryShell.tsx  负责：当前成果 / 历史交付切换、文件预览 Provider
          → ResultWorkspace.tsx  负责：页头 + 三个 Tab 的全部内容
```

历史交付（`board.deliveries[]`，最多 20 条）通过 Shell 顶部的通知条切换；查看历史时内容被"冻结"为当时版本。

### 4.2 三个 Tab 的内容（逐条）

Tab 定义在 `ResultWorkspace.tsx:162-166`：`概览 / 交付物 / 过程记录`。

**Tab 1 · 概览**（`ResultWorkspace.tsx:266-324`）
- 左栏：摘要（`summary`）/ 结论（`verdict`）/ 状态描述 + 「复制摘要」「下载报告」按钮
- 右栏（`aside`）：指标卡（最多 12 个）+ 阶段进度 stepper（最多 3 步）
- 主列依次：任务目标 → 需要关注（顶部 1 条 + 查看全部）→ 任务推进（前 3 条）→ 本轮文件变更摘要 → 分析与结论区块 → 补充内容区块 → 交付内容（前 3 个产物）→ 下一步
- 即：**概览页内部又叠了 8 个区块**，并且其中 4 处是"去另一个 Tab 看全部"的跳转按钮

**Tab 2 · 交付物**（`ResultWorkspace.tsx:107-131, 326-327`）
- 「本页内容」锚点导航（当内容 > 1 项时出现）
- 产物网格（`ResultReader view="deliverables"`）：文件卡片，可点开预览、复制、下载
- 文件变更区块（`ResultChanges`）

**Tab 3 · 过程记录**（`ResultWorkspace.tsx:329-358`）
- 「本页内容」锚点导航（又是一个）
- 待处理事项（检查未通过 + 未关闭风险 + 受阻任务，聚合列表）
- 验证与决策（`ResultReader view="process"` + evidence 区块）
- `<details>` 折叠区，默认展开：风险与备注、任务明细
- `<details>` 折叠区，默认折叠：版本记录
- `<details>` 折叠区：任务详情与协作（白板 detailSections）

### 4.3 页头（`ResultWorkspace.tsx:239-254`）

标题 + 一排小字 meta（任务状态、负责人、团队、时间）+ 右侧成果状态徽标。
成果状态由 `results/presentation.ts` 推导出 **10 种 key**：

| key | 徽标文案 | 触发条件 |
| --- | --- | --- |
| `draft` | 草稿 | `result.status = draft` 且有内容 |
| `ready` | 已交付 | `result.status = ready` |
| `verified` | 已验证 | `result.status = verified` |
| `rejected` | 未通过 | `result.status = rejected` |
| `conflict` | 验证待核对 | 标了已验证，但检查项有失败/待补充/失效 |
| `producing` | 正在产出 | 无内容且 `board.status = running` |
| `blocked` | 产出受阻 | 无内容且 `board.status = blocked` |
| `failed` | 尚无成果 | `board.status = failed` |
| `missing` | 尚未交付 | `board.status = completed` 但无内容 |
| `empty` | 暂无成果 | 未开始 |

### 4.4 已有能力（改版必须保留，不得丢失）

1. 历史交付切换 +「返回当前成果」，历史内容固定为当时版本
2. 文件预览：文本/Markdown/代码/CSV/JSON/图片等；版本对比（diff）；下载该版本
3. 产物级：复制内容、下载原件
4. 摘要级：复制摘要、下载报告（Markdown）
5. 右上角：导出全部轮次原始数据（JSON）
6. 检查/风险/任务/版本/决策的完整结构化渲染
7. 任务详情与协作（白板 detailSections，可折叠）
8. 模态：Escape 关闭、点遮罩关闭、关闭后焦点恢复；移动端全屏
9. 屏幕阅读器状态播报（`role="status"`）

### 4.5 当前视觉现状（为什么被说"丑"）

- 结构：`页头 → Tab 条 → 内容`，内容由大量**同权重白色卡片**堆叠，靠 1px 边框和 8–14px 圆角区分。
- 层级：标题、正文、meta、徽标字号差距小，颜色以灰阶为主，**没有视觉焦点**。
- 信息密度：概览页 8 个区块 + 侧栏指标，卡片内又是表格/代码/列表，形成"均匀的灰色噪音"。
- 状态表达：页头有成果状态徽标，卡片里又有任务状态 Chip、版本状态 Chip、风险等级 Chip，**同一种"彩色小标签"承载了 4 类不同语义**。
- 两处"本页内容"锚点导航与概览里的"查看全部"跳转并存，**导航重复**。

### 4.6 现状截图（见 `screenshots/current/`）

| 文件 | 内容 |
| --- | --- |
| `office-result-station.png` | 场景中的成果入口（白板/成果站） |
| `classic-integrated.png` / `members-integrated.png` | 两种场景布局下打开成果页的整体效果 |
| `ecommerce-overview-rich.png` | 概览 Tab：指标 + 结论 + 任务推进的富内容状态 |
| `ecommerce-deliverables-index.png` | 交付物 Tab：产物网格 + 本页内容导航 |
| `ecommerce-overview-mobile.png` | 移动端概览（全屏） |
| `file-changes-list.png` / `file-changes-mobile.png` | 文件变更区块 |
| `history-current.png` / `history-version-diff.png` | 历史交付切换与版本对比 |
| `code-preview.png` / `csv-preview.png` / `json-preview-mobile.png` | 文件预览弹层 |

> `screenshots/prototype/` 是**上一版未落地的设计探索**（单页 + 场景内气泡入口）。可参考其方向，也可推翻重做——它没有被采纳，原因见第 7 节用户原话。

---

## 5. 问题诊断（把用户抱怨翻译成设计命题）

| 用户原话 | 现象 | 代码证据 | 设计命题 |
| --- | --- | --- | --- |
| "不能就是 3 个 tab 页堆在一起" | 信息被按"技术分类"切了三份，用户要自己拼 | `WorkspaceTab = 'overview' \| 'deliverables' \| 'process'` | 按**用户问题**组织，而不是按数据类型组织 |
| "随便的信息堆叠" | 8 个区块同权重，卡片套卡片 | 概览页 8 个 section 平铺 | 建立唯一主叙事轴：结论 → 可信度 → 交付物 → 追溯 |
| "正常人都不知道该看哪，该看啥" | 首屏没有视觉焦点，状态与内容混排 | 页头 meta 一行 4 个元素 + 徽标 | 首屏必须回答：**是什么、成不成、要不要我处理** |
| "成果看板太丑" | 灰阶同质卡片、标签语义混淆 | 4 类 Chip 共用一个组件与色板 | 建立颜色语义系统：状态色 vs 类别色分离 |
| "专门搞个气泡显示成果是不是有点奇怪" | 上一版原型在场景电脑上挂了气泡 | 原型 `ResultDesignPreview.tsx`（未落地） | 场景内概览要不要"气泡"这种形态，需要论证；也可用完全不同的载体 |
| "前端页面上需要一个状态显示，显示成果的概览" | 场景里看不到成果状态，必须打开才知道 | 现无场景内概览 | 设计一个**一眼可读**的场景内状态位 |
| "不要动协议" | 数据结构已冻结 | `packages/protocol` | 所有设计必须用现有字段拼出来 |

---

## 6. 数据结构（你可以依赖的全部信息）

`OfficeResult`（`packages/protocol/src/office-ui.ts:428-465`，字段不可改）：

| 字段 | 类型 | 上限 | 含义 |
| --- | --- | --- | --- |
| `title` | string | 160 | 成果标题 |
| `status` | `draft \| ready \| verified \| rejected` | — | 成果状态（**权威**） |
| `summary` | string | 300 | 摘要 / 一句话交代 |
| `verdict` | string | 300 | 结论（比 summary 更结论性） |
| `owner` / `team` / `teamSize` | string / number | 40 | 负责人、团队 |
| `producedAt` / `updatedAt` | string | 40 | 产出时间 / 更新时间 |
| `metrics` | array | 12 | 指标（label/value/unit/previous/change/trend/tone） |
| `metricsTitle` / `metricsCaption` | string | 40/60 | 指标组标题与说明 |
| `artifacts` | array | 8 | 交付产物（kind: document/image/data/code/link…，含 url/content/versionId/change） |
| `sections` | array | 8 | 结构化区块，8 种 kind：gallery/documents/tests/api/environments/files/changes/custom |
| `checks` | array | 12 | 验证检查项（passed/failed/pending/stale 等） |
| `decisions` | array | 8 | 决策记录 |
| `tasks` | array | 12 | 任务明细（todo/doing/blocked/done + progress + owner） |
| `versions` | array | 8 | 版本记录（draft/released/rolled-back） |
| `risks` | array | 8 | 风险（level: high/medium/low，status: open/mitigating/closed） |
| `next` | string[] | 8 | 下一步 |
| `note` | string | 300 | 备注 |

外层 `WhiteboardTaskBoard`（`office-ui.ts:542`）另有：

| 字段 | 说明 |
| --- | --- |
| `status` | `queued \| running \| blocked \| completed \| failed`（**任务**状态，非成果状态） |
| `title` / `summary` / `description` | 本轮目标 |
| `steps` | 最多 3 步的阶段进度（progress 0–100 或 -1 表示未知） |
| `result` | 上述 `OfficeResult` |
| `deliveries` | 历史交付数组（最多 20） |

**语义约束（设计必须尊重）**：
- "任务完成" ≠ "成果已验证"。`board.status = completed` 时成果可能仍是 `draft`。
- 只有 `result.status = verified` 且检查项无失败，才能出现"已验证"表达。
- 未知/缺失不能显示为"已完成"。

### 6.1 空数据规则（极其重要）

任何字段都可能是空字符串 / 空数组。设计必须**按"缺省即不渲染整块"**处理：

- 无内容的区块整块消失，不留空标题、不留"暂无"占位（除非是**新手引导**性质的空态）。
- 不重复展示同一份信息（例如 summary 与 description 相同、verdict 与 summary 重复时，只保留一份）。
- 无 `artifacts` 但有 `changes`，不能显示"0 项产物"这类误导文案。

### 6.2 完整样例数据

`code/dashboard-resultDemo.ts` 是一份真实演示数据（电商经营复盘：6 个指标、4 个产物、检查项、风险、任务、版本、下一步）。请直接用它做设计走查，不要自己编数据。

---

## 7. 需求

### 7.1 用户原话（按对话顺序，未改写）

> - 专门搞个气泡显示成果是不是有点奇怪。
> - 那你自己设计
> - 更深层次的需求是什么。
> - 前端页面上需要一个状态显示，显示成果的概览。
> - 优化成果看板的样式
> - 不能就是 3 个 tab 页堆在一起
> - 不要动协议
> - 不要 3 个 tab 页面，一个页面集成所有的成果展示。
> - 成果看板太丑
> - 优化展示的前端。
> - 随便的信息堆叠
> - 这就是现在的问题
> - 正常人都不知道该看哪，该看啥
> - 这是个大改动了。我得仔细设计一下，我们确认设计之后再做。
> - 并且不能动协议层的东西，仅从前端解决。

### 7.2 条目化需求与验收标准

| # | 需求 | 验收标准 |
| --- | --- | --- |
| R1 | 单页集成全部成果，取消 Tab | 页面内无 tab 控件；所有信息在一条纵向阅读流中可达 |
| R2 | 建立明确阅读顺序 | 首次打开 3 秒内能说出：这轮做了什么、东西能不能用、有没有要处理的事 |
| R3 | 场景内成果状态概览 | 不打开阅读器也能看到本轮成果状态与关键信号；不遮挡场景、不干扰交互 |
| R4 | 视觉重做 | 有明确主次关系；同类信息归组；不存在"同权重卡片堆叠" |
| R5 | 不丢功能 | 4.4 的 9 项能力全部保留（可换位置/形态，不可删除） |
| R6 | 纯前端 | 不涉及协议、服务端、依赖变更 |
| R7 | 可实施 | 给出组件级落地路径，能对上现有文件与字段 |

### 7.3 硬约束

1. **不改协议**：字段集合、枚举值、长度上限全部不动。
2. **不加新依赖**：图标用 `lucide-react`，样式用原生 CSS。
3. **不出现 Tab**：不是把 3 个 tab 换成"分段控件/侧边导航"——用户明确拒绝按分类切分的顶部导航。
4. **不推翻既有交互约定**：模态打开方式、Escape/焦点恢复、历史交付语义、移动端全屏。
5. **不做纯视觉改版**：必须先解决信息架构，配色是第二步。

### 7.4 明确不做的事

- 不设计新的数据字段或"理想后端的返回结构"（可以备注"若有此字段会更好"，但不能作为前置条件）。
- 不设计成果的创建/编辑流程（只读消费）。
- 不改场景美术资源与工位布局。
- 不引入图表库（现有指标/表格用原生 DOM + CSS 实现）。

---

## 8. 你需要输出的设计内容（格式与篇幅）

请按以下 12 节输出，**每节都要具体到能落地**，不要泛泛而谈：

1. **设计目标与原则**（≤5 条，每条一句话，带取舍说明）
2. **信息架构**：从"进入页面"到"读完"的完整顺序；说明每一段只承担一个职责；给出"旧 Tab 内容 → 新位置"的映射表
3. **单页结构线框**：ASCII 线框，至少 Desktop（≥1280）与 Narrow（<768）两版；标注区块顺序、折叠策略、首屏可见范围
4. **场景内状态概览**：显示哪些信息（≤3 条）、什么条件下出现/消失、用什么载体（气泡/角落卡片/桌牌/其他），并说明为什么这个载体不只是"装饰"
5. **组件树**：树状结构 + 每个组件的职责 + 建议的 props（须对应现有字段）
6. **状态矩阵**：`result.status`(4) × `board.status`(5) × 内容有无 → 首屏显示什么（表格，可合并明显相同的行）
7. **视觉规范**：字号/行高/字重层级、颜色语义（状态色、类别色、中性色，给出 hex）、间距刻度、卡片与分隔策略、图标用法
8. **响应式规则**：三档断点的布局变化（列数、折叠、字号）
9. **交互与动效**：展开/折叠、文件预览、历史切换、场景内概览的进入/退出；注明可访问性要求（焦点顺序、aria、动效减弱）
10. **迁移方案**：从现有 3 Tab 到新结构的最小步骤；现有组件「复用 / 改造 / 废弃」清单；风险点
11. **验收清单**：可勾选项，覆盖 7.2 的 R1–R7
12. **开放问题**：需要产品方拍板的决策点（列出选项与推荐）

**输出体裁**：Markdown 文档；线框用 ASCII；不要输出可运行的前端代码（最多给关键组件的伪代码或结构示意）。

---

## 9. 一个提醒

这份材料的作者（产品/前端负责人）已经明确：**上一版"场景气泡 + 单页详情"的方案没有定稿**。你可以沿用其中合理的部分，但必须自己论证入口与状态位的形态，而不是默认它就是气泡。

请特别注意回答用户那句质询：**"专门搞个气泡显示成果是不是有点奇怪？"** —— 这既是设计问题，也是产品问题。

---

# 需求原话与提炼（成果看板改版）

> 本节保留用户原始表达，供设计方理解语气与真实关切；后半部分是整理后的需求条目与取舍记录。
> 原始消息是碎片化、口语化的，顺序与时间不完全对应，不要按字面逐条实现。

## 一、用户原话（按对话顺序，未改写）

1. 专门搞个气泡显示成果是不是有点奇怪。
2. 那你自己设计
3. 更深层次的需求是什么。
4. 前端页面上需要一个状态显示，显示成果的概览。
5. 优化成果看板的样式
6. 不能就是 3 个 tab 页堆在一起
7. 不要动协议
8. 不要 3 个 tab 页面，一个页面集成所有的成果展示。
9. 成果看板太丑
10. 优化展示的前端。
11. 随便的信息堆叠
12. OK
13. 这就是现在的问题
14. 正常人都不知道该看哪，该看啥
15. 这是个大改动了。
16. 我得仔细设计一下，我们确认设计之后再做。
17. 那咋办
18. 行
19. 并且不能动协议层的东西，仅从前端解决。

## 二、提炼后的真实需求（按优先级）

### 1. 深层需求：一眼可判断的状态

用户要的不是"好看"，而是**不打开也能判断**、**打开后能顺着读**：

- 场景里：本轮成果到什么程度、有没有问题，要有一眼可读的状态位（"前端页面上需要一个状态显示，显示成果的概览"）。
- 详情里：一页读完，有明确先看什么（"正常人都不知道该看哪，该看啥"）。

### 2. 结构需求：一个页面，不要 3 个 Tab

原话出现两次（第 6、8 条），是**最高优先级的硬约束**。

现状是"概览 / 交付物 / 过程记录"三个 Tab，用户认为这是把信息按技术分类切开，逼用户自己拼。

### 3. 视觉需求：重建层级，而不是换配色

- "成果看板太丑""优化展示的前端"——但紧接着补充"随便的信息堆叠""正常人都不知道该看哪"，说明**丑的根因是没有主次**。
- 因此纯视觉改版（换色、换圆角、加阴影）不算完成需求。

### 4. 入口形态存疑（未决）

第 1 条"专门搞个气泡显示成果是不是有点奇怪"是**质疑**，不是需求。
上一版原型在办公室后方电脑上挂了一个成果气泡，用户对此有保留。设计方需要论证入口/状态位的载体，而不是默认沿用气泡。

### 5. 流程要求：先设计、确认后再实施

第 15–18 条明确：这是大改动，要先出设计稿，确认后再动代码。

## 三、硬约束

| # | 约束 | 说明 |
| --- | --- | --- |
| C1 | 不动协议 | 字段集合、枚举、长度上限全部保持不变；不新增接口 |
| C2 | 仅前端 | 改动只在 `apps/web` 展示层，不碰 `packages/protocol`、`server`、`integration` |
| C3 | 不加依赖 | 表格、指标、图形都用现有 DOM + CSS 实现；图标用 `lucide-react` |
| C4 | 不出现 Tab | 也不能换成"分段控件/侧边导航"这类按分类切分的顶部导航 |
| C5 | 不丢既有能力 | 历史交付、文件预览与版本对比、复制摘要、下载报告、导出原始数据、检查/风险/任务/版本/决策、任务详情、模态交互与焦点恢复、屏幕阅读器播报 |
| C6 | 尊重状态语义 | 任务完成 ≠ 成果已验证；未知不能显示为已完成 |

## 四、已知取舍（设计时需要权衡）

1. **场景内状态位的信息量 vs 遮挡**：办公室场景是产品主体，状态位不能抢戏，但又要"一眼可读"。
2. **单页长度 vs 可扫读**：取消 Tab 后页面会变长，必须靠折叠/摘要/锚点体系控制，但不能退化成新的"锚点导航堆叠"。
3. **信息完整 vs 首屏聚焦**：12 个指标、8 个产物、12 个检查项都可能有，首屏只能选最有判断价值的少数几个。
4. **历史交付 vs 当前成果**：历史内容是冻结快照，视觉上必须让用户清楚"我现在看的是哪一轮"，同时不打断阅读。
5. **移动端**：窄屏全屏展示，长页面 + 折叠策略需要单独设计，不能只是桌面版单列化。

## 五、上一版方案为什么没落地

上一版（`screenshots/prototype/`、`上一版设计草案.md`）做过：暖白底 + 低饱和绿、取消三 Tab、结论优先、依据默认折叠、后方电脑挂气泡入口。

未被采纳的原因不是视觉，而是**入口与整体结构仍在讨论中**：用户对"专门搞个气泡"有疑虑，且当时尚未确认信息架构。设计方可以参考，但不要假设它已经定稿。

---

# 附录：关键源码

> 以下为现状实现副本。设计时请以此为准，不要假设存在额外字段。

## A.1  `ResultWorkspace.tsx`（apps/web/src/components/ResultWorkspace.tsx）

````tsx
import { useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, Clock3, FileText, FolderOpen, GitBranch, Info, LayoutGrid, ListChecks, ShieldAlert, UserRound, Users, ArrowRight } from 'lucide-react'
import type { OfficeResult, ResultRisk, ResultTask, ResultVersion, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { ResultSectionCard } from './ResultSectionCard.tsx'
import { Chip, Track } from './ResultPrimitives.tsx'
import { ResultReader } from './ResultReader.tsx'
import { ResultDeliveryShell } from './ResultDeliveryShell.tsx'
import { ResultChanges } from './ResultChanges.tsx'
import { WhiteboardBoardView } from './WhiteboardBoardView.tsx'
import { formatResultTimestamp, resultHasContent } from '../results/format.ts'
import { boardStatusLabels, resultAttention, resultContentLayout, resultPresentation } from '../results/presentation.ts'
import { resultEvidenceCheckInputs, resultEvidenceChecks } from '../results/checks.ts'
import './ResultWorkspace.css'

export type WorkspaceTab = 'overview' | 'deliverables' | 'process'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'
type StageState = 'done' | 'active' | 'pending'
type BoardStatus = NonNullable<WhiteboardTaskBoardData['status']>

const taskStatusLabels: Record<ResultTask['status'], string> = {
  todo: '待开始', doing: '进行中', blocked: '受阻', done: '已完成',
}
const versionStatusLabels: Record<ResultVersion['status'], string> = {
  draft: '草稿', released: '已发布', 'rolled-back': '已回滚',
}
const riskLevelLabels: Record<ResultRisk['level'], string> = { high: '高', medium: '中', low: '低' }
const riskStatusLabels: Record<ResultRisk['status'], string> = { open: '待处理', mitigating: '处理中', closed: '已关闭' }
const taskStatusTones: Record<ResultTask['status'], ChipTone> = {
  todo: 'pending', doing: 'active', blocked: 'danger', done: 'done',
}
const versionStatusTones: Record<ResultVersion['status'], ChipTone> = {
  draft: 'pending', released: 'done', 'rolled-back': 'danger',
}
const riskStatusTones: Record<ResultRisk['status'], ChipTone> = {
  open: 'progress', mitigating: 'active', closed: 'done',
}

const tabIcons = { overview: LayoutGrid, deliverables: FolderOpen, process: ListChecks } as const
/** The 3-step stage stepper on top of the 交付成果 tab. */
function StageSteps({ steps, status }: { steps: WhiteboardTaskBoardData['steps']; status?: BoardStatus }) {
  if (!steps.length) return null
  const values = steps.map(step => step.progress ?? -1)
  const firstOpen = values.findIndex(value => value < 100)
  return <div className="result-workspace-stage">
    <ol className="result-workspace-stage-list" data-count={steps.length}>
      {steps.map((step, index) => {
        const progress = values[index]
        const state: StageState = step.state ?? (progress >= 100 ? 'done' : status === 'running' && index === firstOpen ? 'active' : 'pending')
        const known = progress >= 0
        return <li key={step.id} className="result-workspace-stage-step" data-state={state}>
          <div className="result-workspace-stage-head">
            <span className="result-workspace-stage-dot" aria-hidden="true">
              {state === 'done' ? <Check size={12} strokeWidth={2.8} /> : index + 1}
            </span>
            <span className="result-workspace-stage-title" title={step.title}>{step.title}</span>
            <span className="result-workspace-stage-value">{known ? `${Math.round(progress)}%` : '—'}</span>
          </div>
          <Track value={progress} label={`${step.title}进度`} tone={state} unknown={!known} />
        </li>
      })}
    </ol>
  </div>
}

function TaskRow({ task }: { task: ResultTask }) {
  return <li className="result-workspace-task" data-status={task.status}>
    <div className="result-workspace-task-head">
      <span className="result-workspace-task-title" title={task.title}>{task.title}</span>
      {task.owner && <span className="result-workspace-task-owner"><UserRound size={12} strokeWidth={2} aria-hidden="true" />{task.owner}</span>}
      <Chip tone={taskStatusTones[task.status]}>{taskStatusLabels[task.status]}</Chip>
    </div>
    {task.progress !== undefined && <div className="result-workspace-task-progress">
      <Track value={task.progress} label={`${task.title}进度`} tone={task.status === 'blocked' ? 'danger' : task.status === 'done' ? 'done' : task.status === 'todo' ? 'pending' : 'active'} />
      <small>{Math.round(task.progress)}%</small>
    </div>}
    {task.note && <p className="result-workspace-task-note">{task.note}</p>}
  </li>
}

function VersionRow({ version }: { version: ResultVersion }) {
  const meta = [version.author, version.at].filter(Boolean).join(' · ')
  return <li className="result-workspace-version" data-status={version.status}>
    <span className="result-workspace-version-tag">{version.version}</span>
    <span className="result-workspace-version-main">
      {version.note && <p>{version.note}</p>}
      {meta && <span className="result-workspace-version-meta">{meta}</span>}
    </span>
    <Chip tone={versionStatusTones[version.status]}>{versionStatusLabels[version.status]}</Chip>
  </li>
}

function RiskRow({ risk }: { risk: ResultRisk }) {
  return <li className="result-workspace-risk">
    <div className="result-workspace-risk-head">
      <span className="result-workspace-risk-level" data-level={risk.level} title={`风险等级：${riskLevelLabels[risk.level]}`}>{riskLevelLabels[risk.level]}</span>
      <h4 className="result-workspace-risk-title">{risk.title}</h4>
      <Chip tone={riskStatusTones[risk.status]}>{riskStatusLabels[risk.status]}</Chip>
    </div>
    {(risk.owner || risk.note) && <div className="result-workspace-risk-body">
      {risk.owner && <span className="result-workspace-risk-owner"><UserRound size={12} strokeWidth={2} aria-hidden="true" />{risk.owner}</span>}
      {risk.note && <p>{risk.note}</p>}
    </div>}
  </li>
}

function DeliverablesPane({ result, active }: { result: OfficeResult; active: boolean }) {
  const { changes, documentMeta } = resultContentLayout(result)
  const sections = changes
  const targets = useRef(new Map<string, HTMLDivElement>())
  const contents = [...(result.artifacts.length ? [{ id: '@files', title: `文件 · ${result.artifacts.length}` }] : []), ...sections.map(section => ({ id: section.id, title: section.title }))]
  const locate = (id: string) => {
    const element = targets.current.get(id)
    element?.scrollIntoView({ block: 'start' })
    element?.focus({ preventScroll: true })
  }
  return <div className="result-workspace-deliverables">
    {contents.length > 1 && <nav className="result-workspace-contents" aria-label="交付物内容导航"><span>本页内容</span>
      <div>{contents.map(item => <button type="button" key={item.id} title={item.title} onClick={() => locate(item.id)}>{item.title}</button>)}</div>
    </nav>}
    {result.artifacts.length > 0 && <div ref={element => { if (element) targets.current.set('@files', element); else targets.current.delete('@files') }} tabIndex={-1} className="result-workspace-anchor">
      <ResultReader result={result} view="deliverables" documentMeta={documentMeta} /></div>}
    {sections.length > 0 && <div className="result-workspace-sections">
        {sections.map(section => <div key={section.id} className="result-workspace-anchor" tabIndex={-1}
          ref={element => { if (element) targets.current.set(section.id, element); else targets.current.delete(section.id) }}>
          <ResultChanges section={section} active={active} />
        </div>)}
      </div>}
    {!sections.length && !result.artifacts.length && <p className="result-workspace-empty">当前没有可查看的交付物。产出后将显示在这里。</p>}
  </div>
}

function TasksPane({ board, result }: { board: WhiteboardTaskBoardData; result: OfficeResult }) {
  return <div className="result-workspace-tasks-pane">
    {result.tasks.length > 0
      ? <ul className="result-workspace-tasks">{result.tasks.map(task => <TaskRow key={task.id} task={task} />)}</ul>
      : <StageSteps steps={board.steps} status={board.status} />}
    {result.next.length > 0 && <section className="result-workspace-next" aria-label="下一步">
      <header><ListChecks size={14} strokeWidth={2} aria-hidden="true" /><h3>下一步</h3></header>
      <ol>{result.next.map((item, index) => <li key={`${index}-${item}`}>
        <span aria-hidden="true">{index + 1}</span><p>{item}</p>
      </li>)}</ol>
    </section>}
  </div>
}

function VersionsPane({ result }: { result: OfficeResult }) {
  return <ol className="result-workspace-versions">
    {result.versions.map(version => <VersionRow key={version.id} version={version} />)}
  </ol>
}

function RisksPane({ result }: { result: OfficeResult }) {
  return <div className="result-workspace-risks-pane">
    {result.risks.length > 0 && <ul className="result-workspace-risks">
      {result.risks.map(risk => <RiskRow key={risk.id} risk={risk} />)}
    </ul>}
    {result.note && <p className="result-workspace-note"><Info size={14} strokeWidth={2} aria-hidden="true" /><span>{result.note}</span></p>}
  </div>
}

const tabs = [
  { key: 'overview' as const, label: '概览' },
  { key: 'deliverables' as const, label: '交付物' },
  { key: 'process' as const, label: '过程记录' },
]

type WorkspaceProps = {
  board: WhiteboardTaskBoardData; result: OfficeResult; boardHtml?: string; initialTab?: WorkspaceTab
  initialDeliveryId?: string
  onTabChange?: (tab: WorkspaceTab) => void
}

export function ResultWorkspace(props: WorkspaceProps) {
  return <ResultDeliveryShell board={props.board} result={props.result} initialDeliveryId={props.initialDeliveryId}>{(board, result, historical, executionKnown) =>
    <ResultWorkspaceBody {...props} board={board} result={result} historical={historical} executionKnown={executionKnown} boardHtml={historical ? undefined : props.boardHtml} />
  }</ResultDeliveryShell>
}

function ResultWorkspaceBody({ board, result, initialTab = 'overview', onTabChange, historical, executionKnown }: WorkspaceProps & { historical: boolean; executionKnown: boolean }) {
  const baseId = useId()
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab)
  const tabRefs = useRef<Partial<Record<WorkspaceTab, HTMLButtonElement | null>>>({})
  const title = board.title || result.title || '当前成果'
  const summaryLabel = historical ? '本次交付' : '成果概览'
  const boardStatus: BoardStatus = board.status ?? 'queued'
  const presentation = resultPresentation(board, result)
  const hasResult = resultHasContent(result)
  const delivery = resultContentLayout(result)
  const hasDeliverables = result.artifacts.length > 0 || delivery.changes.length > 0
  const attention = resultAttention(result)
  const teamLabel = result.team ? (result.teamSize === undefined ? result.team : result.team + '（' + result.teamSize + '人）') : ''
  const updatedAt = result.updatedAt || result.producedAt
  const changes = delivery.changes
  const evidenceChecks = resultEvidenceChecks(result)
  const processResult = { ...result, checks: resultEvidenceCheckInputs(result) }

  const hasAside = result.metrics.length > 0 || board.steps.length > 0
  const hasTaskDetails = Boolean(board.detailSections?.length || board.detail?.trim())
  const taskDetails = useRef<HTMLDetailsElement>(null)
  const taskList = useRef<HTMLDetailsElement>(null)
  const processTargets = useRef(new Map<string, HTMLElement>())
  const processItems = [
    ...(attention.length ? [{ id: 'attention', title: `待处理 · ${attention.length}` }] : []),
    ...(evidenceChecks.length || result.decisions.length || result.note || delivery.evidence.length ? [{ id: 'evidence', title: '验证与决策' }] : []),
    ...(result.tasks.length ? [{ id: 'tasks', title: `任务 · ${result.tasks.length}` }] : []),
    ...(result.risks.length ? [{ id: 'risks', title: `风险 · ${result.risks.length}` }] : []),
    ...(result.versions.length ? [{ id: 'versions', title: '版本记录' }] : []),
    ...(hasTaskDetails ? [{ id: 'details', title: '任务详情与协作' }] : []),
  ]
  const tabId = (key: WorkspaceTab) => baseId + '-tab-' + key
  const panelId = (key: WorkspaceTab) => baseId + '-panel-' + key
  const switchTab = (key: WorkspaceTab, focus = false) => {
    setActiveTab(key)
    onTabChange?.(key)
    if (focus) requestAnimationFrame(() => tabRefs.current[key]?.focus())
  }
  const openProcessSection = (target: string) => {
    switchTab('process')
    requestAnimationFrame(() => {
      const element = target === 'details' ? taskDetails.current : target === 'tasks' ? taskList.current : processTargets.current.get(target)
      if (!element) return
      if (element instanceof HTMLDetailsElement) element.open = true
      element.scrollIntoView({ block: 'start' })
      const focus = element.querySelector('summary') ?? element
      focus.focus({ preventScroll: true })
    })
  }
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = tabs.findIndex(tab => tab.key === activeTab)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    switchTab(tabs[next].key, true)
  }

  return <div className="result-workspace" data-status={boardStatus} data-result-status={presentation.key}>
    <header className="result-workspace-head">
      <div className="result-workspace-heading-icon" aria-hidden="true"><FolderOpen size={23} strokeWidth={1.5} /></div>
      <div className="result-workspace-heading-copy">
        <h2 className="result-workspace-title" title={title}>{title}</h2>
        <div className="result-workspace-meta">
          <span className="result-workspace-execution" data-status={executionKnown ? boardStatus : undefined}><i aria-hidden="true" />{executionKnown ? `任务 · ${boardStatusLabels[boardStatus]}` : '任务状态未提供'}</span>
          {result.owner && <span className="result-workspace-meta-item"><UserRound size={12} aria-hidden="true" />{result.owner}</span>}
          {teamLabel && <span className="result-workspace-meta-item"><Users size={12} aria-hidden="true" />{teamLabel}</span>}
          {updatedAt && <span className="result-workspace-meta-item"><Clock3 size={12} aria-hidden="true" /><time dateTime={updatedAt}
            title={`${result.updatedAt ? '更新时间' : '产出时间'}（本地时区）`}>{formatResultTimestamp(updatedAt)}</time></span>}
        </div>
      </div>
      <span className="result-workspace-result-status" data-status={presentation.key} role="status" title={presentation.description}>
        <i aria-hidden="true" />成果 · {presentation.label}
      </span>
    </header>

    <div className="result-workspace-tabs" role="tablist" aria-label="成果内容" onKeyDown={onTabKeyDown}>
      {tabs.map(item => {
        const Icon = tabIcons[item.key]
        const selected = item.key === activeTab
        return <button key={item.key} ref={element => { tabRefs.current[item.key] = element }} type="button"
          role="tab" id={tabId(item.key)} aria-selected={selected} aria-controls={panelId(item.key)} tabIndex={selected ? 0 : -1}
          onClick={() => switchTab(item.key)}><Icon size={14} aria-hidden="true" />{item.label}</button>
      })}
    </div>

    <section className="result-workspace-panel" id={panelId('overview')} role="tabpanel" aria-labelledby={tabId('overview')}
      hidden={activeTab !== 'overview'} tabIndex={0}>
      <div className="result-workspace-overview" data-aside={hasAside}>
        <div className="result-workspace-overview-lead">
          <section className="result-workspace-summary" aria-label={summaryLabel}>
            <p className="result-workspace-eyebrow">{hasResult ? summaryLabel : '当前目标'}</p>
            {(result.summary || board.summary || board.description) && <p className="result-workspace-conclusion">{result.summary || board.summary || board.description}</p>}
            {result.title && result.title !== title && <p className="result-workspace-result-title">{result.title}</p>}
            {result.verdict && <p className="result-workspace-verdict">{result.verdict}</p>}
            {(!result.verdict || presentation.key === 'conflict') && <p className="result-workspace-state-description" data-state={presentation.key}>{presentation.description}</p>}
            <div className="result-workspace-summary-actions">
              {!hasDeliverables && processItems.length > 0 && <button type="button" className="result-workspace-primary" onClick={() => switchTab('process', true)}>查看执行记录<ArrowRight size={14} aria-hidden="true" /></button>}
              {hasResult && <ResultReader result={result} view="actions" />}
            </div>
          </section>
        </div>
        {hasAside && <aside className="result-workspace-overview-aside" aria-label="成果指标与进度">
          {result.metrics.length > 0 && <ResultReader result={result} view="metrics" />}
          {board.steps.length > 0 && <section aria-label="执行进度" className="result-workspace-progress-section">
            <h3>阶段进度</h3><StageSteps steps={board.steps} status={boardStatus} />
          </section>}
        </aside>}
        <div className="result-workspace-overview-main">
          {board.description && board.description !== (result.summary || board.summary) && <section className="result-workspace-goal" aria-label="任务目标">
            <p className="result-workspace-eyebrow">任务目标</p><p>{board.description}</p>
            {hasTaskDetails && <button type="button" onClick={() => openProcessSection('details')}>查看任务详情与分工<ArrowRight size={13} aria-hidden="true" /></button>}
          </section>}
          {attention.length > 0 && <section className="result-workspace-attention-preview" aria-label="待处理事项">
            <ShieldAlert size={17} strokeWidth={1.7} aria-hidden="true" />
            <div><h3>需要关注 <span>{attention.length} 项</span></h3><p title={attention[0].title}>{attention[0].title}</p></div>
            <button type="button" onClick={() => openProcessSection('attention')} aria-label="查看全部待处理事项">查看<ArrowRight size={13} aria-hidden="true" /></button>
          </section>}
          {result.tasks.length > 0 && <section className="result-workspace-task-glance" aria-label="任务推进概况">
            <header><div><h3>任务推进</h3><span>{result.tasks.filter(task => task.status === 'done').length}/{result.tasks.length} 已完成</span></div>
              <button type="button" onClick={() => openProcessSection('tasks')}>全部任务<ArrowRight size={13} aria-hidden="true" /></button></header>
            <ul>{[...result.tasks].sort((a, b) => ({ blocked: 0, doing: 1, todo: 2, done: 3 })[a.status] - ({ blocked: 0, doing: 1, todo: 2, done: 3 })[b.status]).slice(0, 3).map(task => <li key={task.id}>
              <span>{task.title}<small>{task.owner}</small></span><Chip tone={taskStatusTones[task.status]}>{taskStatusLabels[task.status]}</Chip>
            </li>)}</ul>
          </section>}
          {changes.length > 0 && <section className="result-workspace-change-summary" aria-label="文件变化摘要">
            <div><FileText size={16} aria-hidden="true" /><span>本轮文件变更</span><strong>{changes.reduce((count, section) => count + section.files.length, 0)} 个文件</strong></div>
            <button type="button" onClick={() => switchTab('deliverables', true)}>查看变更<ArrowRight size={13} aria-hidden="true" /></button>
          </section>}
          {delivery.analysis.length > 0 && <section className="result-workspace-content-group" aria-label="分析与结论"><h3>分析与结论</h3>
            {delivery.analysis.map(section => <ResultSectionCard key={section.id} section={section} sourceArtifact={result.artifacts.find(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)} />)}
          </section>}
          {delivery.supplementary.length > 0 && <section className="result-workspace-content-group" aria-label="补充内容"><h3>补充内容</h3>
            {delivery.supplementary.map(section => <ResultSectionCard key={section.id} section={section} sourceArtifact={result.artifacts.find(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)} />)}
          </section>}
          {hasDeliverables && <section className="result-workspace-featured" aria-label="主要交付物">
            <header><h3>交付内容</h3><button type="button" onClick={() => switchTab('deliverables', true)}>查看全部<ArrowRight size={13} aria-hidden="true" /></button></header>
            {result.artifacts.length > 0
              ? <ResultReader result={result} view="featured" documentMeta={delivery.documentMeta} />
              : <p className="result-file-caption">本轮提供文件变更记录，可在交付物中查看。</p>}
          </section>}
          {result.next.length > 0 && <ResultReader result={result} view="next" />}
        </div>
      </div>
    </section>

    <section className="result-workspace-panel" id={panelId('deliverables')} role="tabpanel" aria-labelledby={tabId('deliverables')}
      hidden={activeTab !== 'deliverables'} tabIndex={0}><DeliverablesPane result={result} active={activeTab === 'deliverables'} /></section>

    <section className="result-workspace-panel" id={panelId('process')} role="tabpanel" aria-labelledby={tabId('process')}
      hidden={activeTab !== 'process'} tabIndex={0}>
      <div className="result-workspace-process">
        {processItems.length > 1 && <nav className="result-workspace-contents" aria-label="过程记录内容导航"><span>本页内容</span>
          <div>{processItems.map(item => <button type="button" key={item.id} onClick={() => openProcessSection(item.id)}>{item.title}</button>)}</div>
        </nav>}
        {!processItems.length && <p className="result-workspace-empty">当前暂无过程记录。</p>}
        {attention.length > 0 && <section tabIndex={-1} ref={element => { if (element) processTargets.current.set('attention', element) }} className="result-workspace-attention result-workspace-anchor" aria-label="全部待处理事项">
          <header><ShieldAlert size={16} aria-hidden="true" /><h3>待处理事项</h3><span>{attention.length} 项</span></header>
          <ul>{attention.map(item => <li key={item.id}><span data-danger={item.danger}>{item.label}</span><p>{item.title}</p></li>)}</ul>
        </section>}
        {(evidenceChecks.length > 0 || result.decisions.length > 0 || result.note || delivery.evidence.length > 0) && <div tabIndex={-1} className="result-workspace-anchor" ref={element => { if (element) processTargets.current.set('evidence', element) }}>
          <ResultReader result={processResult} view="process" />
          {delivery.evidence.map(section => <ResultSectionCard key={section.id} section={section} sourceArtifact={result.artifacts.find(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)} />)}
        </div>}
        {(result.risks.length > 0) && <details ref={element => { if (element) processTargets.current.set('risks', element) }} className="result-workspace-disclosure result-workspace-anchor" open>
          <summary><ShieldAlert size={15} aria-hidden="true" />风险与备注<span>{result.risks.length}</span></summary><RisksPane result={{ ...result, note: '' }} />
        </details>}
        {result.tasks.length > 0 && <details ref={taskList} className="result-workspace-disclosure result-workspace-anchor" open>
          <summary><ListChecks size={15} aria-hidden="true" />任务明细<span>{result.tasks.length}</span></summary><TasksPane board={board} result={{ ...result, next: [] }} />
        </details>}
        {result.versions.length > 0 && <details ref={element => { if (element) processTargets.current.set('versions', element) }} className="result-workspace-disclosure result-workspace-anchor">
          <summary><GitBranch size={15} aria-hidden="true" />版本记录<span>{result.versions.length}</span></summary><VersionsPane result={result} />
        </details>}
        {hasTaskDetails && <details ref={taskDetails} className="result-workspace-disclosure result-workspace-anchor" open>
          <summary><FileText size={15} aria-hidden="true" />任务详情与协作</summary>
          <WhiteboardBoardView sections={board.detailSections ?? []} detail={board.detail} />
        </details>}
      </div>
    </section>
  </div>
}
````

## A.2  `ResultDeliveryShell.tsx`（apps/web/src/components/ResultDeliveryShell.tsx）

````tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, LoaderCircle } from 'lucide-react'
import type { OfficeResult, ResultArtifact, ResultDelivery, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { resultDeliverySchema } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { formatResultTimestamp } from '../results/format.ts'
import { readDeliverySnapshot } from '../results/resources.ts'
import { artifactPreviewSections } from '../results/sections.ts'
import { ResultArtifactPreview } from './ResultArtifactPreview.tsx'
import './ResultDeliveryShell.css'

const label = (delivery: ResultDelivery) => delivery.title || `第 ${delivery.sequence} 次交付`

export function ResultDeliveryShell({ board, result, children, initialDeliveryId }: {
  board: WhiteboardTaskBoardData; result: OfficeResult
  initialDeliveryId?: string
  children: (board: WhiteboardTaskBoardData, result: OfficeResult, historical: boolean, executionKnown: boolean) => ReactNode
}) {
  const deliveries = useMemo(() => (board.deliveries ?? []).map(item => resultDeliverySchema.parse(item)).sort((a, b) => b.sequence - a.sequence), [board.deliveries])
  const [selected, setSelected] = useState<ResultDelivery | null>(() => deliveries.find(item => item.id === initialDeliveryId) ?? null)
  const [missingTarget, setMissingTarget] = useState(() => Boolean(initialDeliveryId && !deliveries.some(item => item.id === initialDeliveryId)))
  const [loaded, setLoaded] = useState<{ record: ResultDelivery; snapshot?: ResultDelivery; error?: string } | null>(null)
  const [preview, setPreview] = useState<{ artifact: ResultArtifact; trigger: HTMLElement } | null>(null)
  const [retry, setRetry] = useState(0)
  const [catalogRetry, setCatalogRetry] = useState(0)
  const [catalog, setCatalog] = useState<{ records: ResultDelivery[]; retry: number; snapshots: ResultDelivery[]; failed: number } | null>(null)
  const previewId = preview?.artifact.id
  const container = useRef<HTMLDivElement>(null)
  // The file menu remains a history entry even when chat messages have not loaded.
  // Only read backend-owned snapshot metadata when a file preview is open.
  useEffect(() => {
    if (!previewId || catalog?.records === deliveries && catalog.retry === catalogRetry) return
    const external = deliveries.filter(delivery => !delivery.result)
    if (!external.length) return
    const controller = new AbortController()
    const snapshots: ResultDelivery[] = []
    let cursor = 0, failed = 0
    const worker = async () => {
      while (cursor < external.length && !controller.signal.aborted) {
        const record = external[cursor++]
        try { snapshots.push(await readDeliverySnapshot(record, controller.signal)) }
        catch { if (!controller.signal.aborted) failed++ }
      }
    }
    void Promise.all(Array.from({ length: Math.min(4, external.length) }, worker)).then(() => {
      if (!controller.signal.aborted) setCatalog({ records: deliveries, retry: catalogRetry, snapshots, failed })
    })
    return () => controller.abort()
  }, [previewId, deliveries, catalog, catalogRetry])
  useEffect(() => {
    if (!selected || selected.result) return
    const controller = new AbortController()
    readDeliverySnapshot(selected, controller.signal).then(snapshot => {
      if (!controller.signal.aborted) setLoaded({ record: selected, snapshot })
    }).catch(error => {
      if (!controller.signal.aborted) setLoaded({ record: selected, error: error instanceof Error ? error.message : '读取历史交付失败。' })
    })
    return () => controller.abort()
  }, [selected, retry])
  const resolved = selected?.result ? selected : loaded?.record === selected ? loaded.snapshot : undefined
  const error = loaded?.record === selected ? loaded.error : ''
  const historical = Boolean(selected || missingTarget)
  const viewResult = historical ? resolved?.result : result
  const viewBoard: WhiteboardTaskBoardData = resolved && viewResult ? {
    template: 'task-board-v1', title: viewResult.title || board.title, status: 'completed', steps: [],
    ...resolved.board, result: viewResult,
  } : board
  const returnToCurrent = () => {
    setSelected(null)
    setMissingTarget(false)
    setLoaded(null)
    container.current?.closest('.whiteboard-reader-content')?.scrollTo(0, 0)
  }
  const catalogReady = catalog?.records === deliveries && catalog.retry === catalogRetry
  const knownDeliveries = useMemo(() => deliveries.map(delivery => delivery.result ? delivery
    : (catalog?.records === deliveries ? catalog.snapshots.find(snapshot => snapshot.id === delivery.id) : undefined) ?? delivery), [deliveries, catalog])
  const versions = useMemo(() => {
    if (!preview) return []
    const entries = new Map<string, { artifact: ResultArtifact; label: string }>()
    for (const delivery of [...knownDeliveries].reverse()) for (const artifact of delivery.result?.artifacts ?? []) {
      if (artifact.id === preview.artifact.id && artifact.versionId) entries.set(artifact.versionId, { artifact, label: `${artifact.version || artifact.versionId} · ${label(delivery)}` })
    }
    for (const artifact of resolved?.result?.artifacts ?? []) {
      if (artifact.id === preview.artifact.id && artifact.versionId) entries.set(artifact.versionId, { artifact, label: `${artifact.version || artifact.versionId} · ${selected ? label(selected) : '历史交付'}` })
    }
    if (preview.artifact.versionId && !entries.has(preview.artifact.versionId)) entries.set(preview.artifact.versionId, {
      artifact: preview.artifact, label: `${preview.artifact.version || preview.artifact.versionId} · 正在查看`,
    })
    const current = result.artifacts.find(artifact => artifact.id === preview.artifact.id)
    if (current?.versionId) entries.set(current.versionId, { artifact: current, label: `${current.version || current.versionId} · 当前版本` })
    return [...entries.values()]
  }, [preview, knownDeliveries, resolved, selected, result.artifacts])
  const origin = preview ? deliveries.find(delivery => delivery.id === preview.artifact.runId) : undefined
  const previewSections = preview ? artifactPreviewSections([viewResult,
    knownDeliveries.find(delivery => delivery.id === preview.artifact.runId)?.result,
    ...knownDeliveries.map(delivery => delivery.result), result], preview.artifact) : []

  return <ArtifactPreviewContext.Provider value={{ open: (artifact, trigger) => setPreview({ artifact, trigger }) }}>
    <div ref={container} className="result-delivery-shell">
      {selected && <div className="result-delivery-notice" role="status">
        <div><strong>历史交付 · {label(selected)}</strong><span>{formatResultTimestamp(selected.createdAt)} · 文档固定为当时版本。</span></div>
        <button type="button" onClick={returnToCurrent}>返回当前成果<ArrowRight size={13} /></button>
      </div>}
      {missingTarget && <div className="result-delivery-loading"><p role="alert">该次交付不在当前会话的可用目录中，未展示其他轮次内容。</p>
        <button type="button" onClick={returnToCurrent}>查看当前成果</button></div>}
      {selected && !viewResult && <div className="result-delivery-loading">
        {error ? <><p role="alert">{error} 没有展示其他轮次的内容。</p><button type="button" onClick={() => { setLoaded(null); setRetry(value => value + 1) }}>重新读取此交付</button></>
          : <p role="status"><LoaderCircle size={16} />正在读取指定交付…</p>}
      </div>}
      {viewResult && children(viewBoard, viewResult, historical, !historical || Boolean(resolved?.board))}
    </div>
    {preview && <ResultArtifactPreview key={JSON.stringify([preview.artifact.id, preview.artifact.versionId, preview.artifact.url])}
      artifact={preview.artifact} current={result.artifacts.find(artifact => artifact.id === preview.artifact.id)}
      sections={previewSections}
      catalogLoading={deliveries.some(delivery => !delivery.result) && !catalogReady}
      catalogFailed={catalogReady ? catalog.failed : 0} onRetryCatalog={() => setCatalogRetry(value => value + 1)}
      versions={versions} origin={origin ? label(origin) : historical ? '历史交付' : '当前成果'} trigger={preview.trigger}
      onClose={() => setPreview(null)} onSelect={artifact => setPreview({ ...preview, artifact })} />}
  </ArtifactPreviewContext.Provider>
}
````

## A.3  `WhiteboardReader.tsx`（apps/web/src/components/WhiteboardReader.tsx）

````tsx
import { useEffect, useMemo, useRef } from 'react'
import { Download, X } from 'lucide-react'
import { whiteboardTaskBoard } from '@pawoffice/scene-office/whiteboard'
import type { WhiteboardProgress } from '@pawoffice/scene-office/whiteboard'
import { stringifyDocumentObject } from '@pawoffice/protocol/schema'
import { officeResultSchema } from '@pawoffice/protocol/office-ui'
import { ResultWorkspace } from './ResultWorkspace.tsx'
import { resultFileBase } from '../results/format.ts'
import './WhiteboardReader.css'

export function WhiteboardReader({ state, boardId, onClose, initialDeliveryId }: {
  state: Record<string, unknown>; boardId: string; progress: WhiteboardProgress; onClose: () => void
  initialDeliveryId?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const content = useRef<HTMLElement>(null)
  const serialized = JSON.stringify(state)
  const board = useMemo(() => whiteboardTaskBoard(JSON.parse(serialized)), [serialized])
  const result = useMemo(() => officeResultSchema.parse(board?.result ?? {}), [board])
  useEffect(() => {
    const element = dialog.current!
    const trigger = document.activeElement
    element.showModal()
    return () => {
      element.close()
      requestAnimationFrame(() => {
        if (trigger instanceof HTMLElement && trigger.isConnected && !document.querySelector('dialog[open]')) trigger.focus()
      })
    }
  }, [])
  const download = () => {
    if (!board) return
    const url = URL.createObjectURL(new Blob([stringifyDocumentObject(board, 2)], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url; link.download = resultFileBase({ ...result, title: board.title }) + '-whiteboard.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <dialog className="whiteboard-reader is-result" ref={dialog} aria-labelledby="whiteboard-reader-title" onCancel={onClose}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <header>
      <div className="whiteboard-reader-heading"><h2 id="whiteboard-reader-title">成果阅读器</h2></div>
      <div className="whiteboard-reader-actions">
        <button type="button" aria-label="导出全部轮次原始数据" title="导出全部轮次原始数据" disabled={!board} onClick={download}><Download size={18} /></button>
        <button type="button" aria-label="关闭当前成果" title="关闭" onClick={onClose}><X size={20} /></button>
      </div>
    </header>
    <article className="whiteboard-reader-content is-result" ref={content} aria-label="当前成果内容">
      {board ? <ResultWorkspace key={boardId} board={board} result={result} initialDeliveryId={initialDeliveryId} onTabChange={() => content.current?.scrollTo(0, 0)} />
        : <p className="result-workspace-empty">当前没有可读取的任务信息。</p>}
    </article>
  </dialog>
}
````

## A.4  `presentation.ts`（apps/web/src/results/presentation.ts）

````ts
import type { OfficeResult, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'
import { resultHasContent, resultStatusLabels } from './format.ts'
import { resultEvidenceChecks, resultVerificationConflict } from './checks.ts'
export { resultChecks } from './checks.ts'

export const boardStatusLabels = {
  queued: '待开始', running: '执行中', blocked: '执行受阻', completed: '已完成', failed: '执行失败',
} as const

export function resultPresentation(board: WhiteboardTaskBoardData, result: OfficeResult) {
  if (resultVerificationConflict(result)) return { key: 'conflict', label: '验证待核对', description: '后端标记已验证，但当前检查存在失效、待补充或未通过项，请核对当前版本的验证依据。' }
  // An explicit delivery/verification state remains meaningful even before its content arrives.
  if (resultHasContent(result) || result.status !== 'draft') {
    const descriptions = {
      draft: '当前为阶段草稿，后续可能继续更新。',
      ready: '成果已交付，尚未标记为验证通过。',
      verified: '成果已标记为验证通过，可查看交付内容与验收依据。',
      rejected: '成果未通过验证，请先查看结论与待处理项。',
    }
    return { key: result.status, label: resultStatusLabels[result.status], description: descriptions[result.status] }
  }
  if (board.status === 'running') return { key: 'producing', label: '正在产出', description: '任务正在执行，成果内容将在产出后显示。' }
  if (board.status === 'blocked') return { key: 'blocked', label: '产出受阻', description: '任务执行受阻，当前尚无成果。请查看过程记录。' }
  if (board.status === 'failed') return { key: 'failed', label: '尚无成果', description: '任务执行失败，当前没有可查看的成果。' }
  if (board.status === 'completed') return { key: 'missing', label: '尚未交付', description: '任务已结束，但尚未收到成果内容。' }
  return { key: 'empty', label: '暂无成果', description: '任务尚未开始，交付内容将在这里汇总。' }
}

export function resultAttention(result: OfficeResult) {
  const checks = resultEvidenceChecks(result).filter(check => check.status !== 'passed').map(check => ({
    id: JSON.stringify(['check', check.id, check.artifactId, check.versionId]), title: check.label, label: check.status === 'failed' ? '未通过' : '待补充',
    danger: check.status === 'failed',
  }))
  const risks = result.risks.filter(risk => risk.status !== 'closed').map(risk => ({
    id: `risk-${risk.id}`, title: risk.title, label: risk.level === 'high' ? '高风险' : '风险', danger: risk.level === 'high',
  }))
  const tasks = result.tasks.filter(task => task.status === 'blocked').map(task => ({
    id: `task-${task.id}`, title: task.title, label: '任务受阻', danger: false,
  }))
  return [...checks, ...risks, ...tasks].sort((a, b) => Number(b.danger) - Number(a.danger))
}

export { resultDeliveryLayout, resultContentLayout } from './sections.ts'
export type { ResultDocumentMetadata } from './sections.ts'
````

## A.5  `sections.ts`（apps/web/src/results/sections.ts）

````ts
import type { OfficeResult, ResultArtifact, ResultDocumentsSection, ResultSection } from '@pawoffice/protocol/office-ui'

export type ResultDocumentMetadata = ResultDocumentsSection['items'][number]

/** Associate metadata only through explicit artifact/version identity; titles are display text. */
export function resultDeliveryLayout(result: OfficeResult) {
  const documents = result.sections.flatMap(section => section.kind === 'documents' && !section.purpose ? section.items : [])
  const documentMeta = new Map<string, ResultDocumentMetadata>()
  const merged = new Set<ResultDocumentMetadata>()
  for (const artifact of result.artifacts) {
    const matches = documents.filter(item => item.artifactId === artifact.id && (!item.versionId || item.versionId === artifact.versionId))
    if (matches.length !== 1) continue
    if (artifact.kind === 'image') continue
    documentMeta.set(artifact.id, matches[0])
    merged.add(matches[0])
  }
  const sections = result.sections.flatMap<ResultSection>(section => {
    if (section.purpose) return [section]
    if (section.kind === 'files') {
      const items = section.items.filter(item => !item.artifactId || !result.artifacts.some(artifact => artifact.id === item.artifactId && (!item.versionId || artifact.versionId === item.versionId)))
      return items.length ? [{ ...section, items }] : []
    }
    if (section.kind !== 'documents') return [section]
    const items = section.items.filter(item => !merged.has(item))
    return items.length ? [{ ...section, items }] : []
  })
  return { sections, documentMeta }
}

/** Routing is semantic. Unclassified legacy content stays visible, without inventing its purpose. */
export function resultContentLayout(result: OfficeResult) {
  const { sections, documentMeta } = resultDeliveryLayout(result)
  const analysis: ResultSection[] = [], evidence: ResultSection[] = [], supplementary: ResultSection[] = [], previews: ResultSection[] = []
  const changes = sections.filter(section => section.kind === 'changes')
  for (const section of sections) {
    if (section.kind === 'changes') continue
    if (section.kind === 'tests') {
      // All checks are collected once, including stale-version handling, by resultEvidenceChecks.
      if (section.metrics.length || section.progress !== undefined) evidence.push({ ...section, checks: [] })
    } else if (section.purpose === 'artifact-preview') previews.push(section)
    else if (section.purpose === 'analysis') analysis.push(section)
    else if (section.purpose === 'evidence') evidence.push(section)
    else supplementary.push(section)
  }
  return { analysis, evidence, supplementary, previews, changes, documentMeta }
}

/** Pick only authored blocks for the exact selected file version, never by title. */
export function artifactPreviewSections(results: (OfficeResult | undefined)[], artifact: ResultArtifact) {
  for (const result of results) {
    if (!result) continue
    const sections = result.sections.filter(section => section.purpose === 'artifact-preview' && section.artifactId === artifact.id && section.versionId === artifact.versionId)
    if (sections.length) return sections
  }
  return []
}
````

## A.6  `ResultReader.tsx`（apps/web/src/components/ResultReader.tsx）

````tsx
import { useContext, useEffect, useId, useRef, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, BadgeCheck, CalendarDays, Check, CheckCircle2, CircleDashed, CircleX,
  ClipboardCheck, Copy, Download, ExternalLink, FileText, Image as ImageIcon, Info, Link2, Minus,
  PackageCheck, PencilLine, Table2, Target, UserRound,
} from 'lucide-react'
import type { OfficeResult, ResultArtifact, ResultCheck, ResultMetric } from '@pawoffice/protocol/office-ui'
import { formatResultTimestamp, resultFileBase, resultHasContent, resultReport, resultStatusText, resultSummaryText } from '../results/format.ts'
import { ResultMarkdown } from './ResultMarkdown.tsx'
import type { ResultDocumentMetadata } from '../results/presentation.ts'
import { resultChecks, resultVerificationConflict } from '../results/checks.ts'
import { downloadArtifact } from '../results/download.ts'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import './ResultReader.css'

const statusIcons = { verified: BadgeCheck, ready: PackageCheck, draft: PencilLine, rejected: CircleX } as const
const trendIcons = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const
const toneIcons = { positive: CheckCircle2, negative: CircleX, neutral: CircleDashed } as const
const targetIcons = { met: CheckCircle2, missed: CircleX, 'at-risk': CircleDashed } as const
const targetLabels = { met: '已达标', missed: '未达标', 'at-risk': '有风险' } as const
const checkIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const
const checkLabels = { passed: '已通过', pending: '待补充', failed: '未通过' } as const
const artifactIcons = { document: FileText, image: ImageIcon, link: Link2, data: Table2 } as const

type ResolvedMetricKind = 'comparison' | 'value' | 'status' | 'target' | 'text'

function downloadText(filename: string, content: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** auto = comparison when a previous value exists, otherwise a plain value card. */
function resolveMetricKind(metric: ResultMetric): ResolvedMetricKind {
  if (metric.kind !== 'auto') return metric.kind
  return metric.previous ? 'comparison' : 'value'
}

function MetricHeader({ metric }: { metric: ResultMetric }) {
  return <div className="result-metric-top"><span>{metric.label}</span></div>
}

function ComparisonMetric({ metric }: { metric: ResultMetric }) {
  const TrendIcon = trendIcons[metric.trend]
  return <>
    <div className="result-metric-top">
      <span>{metric.label}</span>
      {metric.change && <span className={`result-delta is-${metric.tone}`}><TrendIcon size={12} strokeWidth={2.4} />{metric.change}</span>}
    </div>
    <p className="result-metric-value"><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.previous && <p className="result-metric-previous">首轮 {metric.previous}</p>}
  </>
}

function ValueMetric({ metric }: { metric: ResultMetric }) {
  return <>
    <MetricHeader metric={metric} />
    <p className="result-metric-value"><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.change && <p className="result-metric-previous">{metric.change}</p>}
  </>
}

function StatusMetric({ metric }: { metric: ResultMetric }) {
  const Icon = toneIcons[metric.tone]
  return <>
    <MetricHeader metric={metric} />
    <p className="result-metric-state" data-tone={metric.tone}><Icon size={17} strokeWidth={2} /><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.previous && <p className="result-metric-previous">首轮 {metric.previous}</p>}
  </>
}

function TargetMetric({ metric }: { metric: ResultMetric }) {
  const status = metric.targetStatus || ''
  const StatusIcon = status ? targetIcons[status] : Target
  return <>
    <div className="result-metric-top">
      <span>{metric.label}</span>
      {status ? <span className={`result-target-state is-${status}`}><StatusIcon size={12} strokeWidth={2.2} />{targetLabels[status]}</span> : <Target size={13} strokeWidth={2} />}
    </div>
    <p className="result-metric-value"><strong>{metric.value}</strong>{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.progress !== undefined && <div className="result-target-progress">
      <div className="result-target-track" role="progressbar" aria-label={`${metric.label}进度`} aria-valuenow={Math.round(metric.progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${metric.progress}%` }} /></div>
      <small>{Math.round(metric.progress)}%</small>
    </div>}
    {(metric.target || metric.change) && <p className="result-metric-previous">{metric.target ? `目标 ${metric.target}` : metric.change}</p>}
  </>
}

function TextMetric({ metric }: { metric: ResultMetric }) {
  return <>
    <MetricHeader metric={metric} />
    <p className="result-metric-text">{metric.value}{metric.unit && <span>{metric.unit}</span>}</p>
    {metric.change && <p className="result-metric-previous">{metric.change}</p>}
  </>
}

function MetricCard({ metric }: { metric: ResultMetric }) {
  const kind = resolveMetricKind(metric)
  return <article className={`result-metric result-kind-${kind}`} data-kind={kind} data-tone={metric.tone} data-trend={metric.trend} data-emphasis={metric.emphasis}>
    {kind === 'status' ? <StatusMetric metric={metric} />
      : kind === 'target' ? <TargetMetric metric={metric} />
        : kind === 'text' ? <TextMetric metric={metric} />
          : kind === 'value' ? <ValueMetric metric={metric} />
            : <ComparisonMetric metric={metric} />}
  </article>
}

function ArtifactCard({ artifact, expanded, copied, onToggle, onCopy, onDownload, metadata }: {
  artifact: ResultArtifact; expanded: boolean; copied: string
  onToggle: () => void; onCopy: () => void; onDownload: () => void
  metadata?: ResultDocumentMetadata
}) {
  const Icon = artifactIcons[artifact.kind]
  const preview = useContext(ArtifactPreviewContext)
  const versioned = Boolean(preview && artifact.versionId)
  const isCopied = copied === artifact.id
  return <article className="result-artifact" data-kind={artifact.kind} data-expanded={expanded}>
    <div className="result-artifact-main">
      <span className="result-artifact-icon"><Icon size={18} strokeWidth={1.9} /></span>
      <div className="result-artifact-copy">
        <h4>{artifact.title}</h4>
        {artifact.description && <p>{artifact.description}</p>}
        {artifact.change && <p className="result-artifact-change" data-change={artifact.change}>{({ added: '本次新增', updated: '本次更新', removed: '本次移除（保留历史版本）', unchanged: '沿用已有版本' })[artifact.change]}</p>}
        {(metadata || artifact.versionId) && <p className="result-artifact-document-meta">{[
          artifact.version || metadata?.version || artifact.versionId,
          artifact.producedAt ? formatResultTimestamp(artifact.producedAt) : metadata?.at,
          metadata && { done: '已完成', active: '进行中', pending: '待开始' }[metadata.status],
        ].filter(Boolean).join(' · ')}</p>}
      </div>
    </div>
    {!versioned && expanded && artifact.content && <div className="result-artifact-preview">
      <ResultMarkdown content={artifact.content} />
    </div>}
    {(artifact.content || artifact.url || versioned) && <div className="result-artifact-actions">
      {versioned ? <button type="button" aria-haspopup="dialog" onClick={event => preview!.open(artifact, event.currentTarget)}><FileText size={13} />查看</button>
        : artifact.content && <button type="button" aria-expanded={expanded} onClick={onToggle}>{expanded ? <Minus size={13} /> : <FileText size={13} />}{expanded ? '收起' : '查看'}</button>}
      {artifact.content && <button type="button" onClick={onCopy}>{isCopied ? <Check size={13} /> : <Copy size={13} />}{isCopied ? '已复制' : '复制'}</button>}
      {(artifact.content || artifact.url) && <button type="button" onClick={onDownload}><Download size={13} />下载</button>}
      {artifact.url && !versioned && <a href={artifact.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />打开</a>}
    </div>}
  </article>
}

function CheckRow({ check }: { check: ResultCheck }) {
  const Icon = checkIcons[check.status]
  return <li data-status={check.status}><Icon size={15} strokeWidth={2} /><span>{check.label}</span><em>{checkLabels[check.status]}</em></li>
}

export function ResultReader({ result, onOpenBoard, view = 'full', documentMeta }: {
  result: OfficeResult; onOpenBoard?: () => void
  view?: 'full' | 'overview' | 'deliverables' | 'process' | 'metrics' | 'actions' | 'featured' | 'next'
  documentMeta?: ReadonlyMap<string, ResultDocumentMetadata>
}) {
  const baseId = useId()
  const [copied, setCopied] = useState('')
  const [expanded, setExpanded] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!resultHasContent(result)) return <p className="result-empty">本轮还没有可展示的成果。</p>

  const status = { label: resultStatusText(result), Icon: statusIcons[result.status] }
  const StatusIcon = status.Icon
  const checks = resultChecks(result)
  const passed = checks.filter(check => check.status === 'passed').length
  const metrics = result.metrics
  const kinds = metrics.map(resolveMetricKind)
  const metricsTitle = result.metricsTitle || '关键指标'
  const metricsCaption = result.metricsCaption || (kinds.length > 0 && kinds.every(kind => kind === 'comparison') ? '首轮观察 → 更新后观察' : '')
  const metricCount = metrics.length
  const hasPrimary = metrics.some(metric => metric.emphasis === 'primary')
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id); clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(''), 1800)
    } catch { setCopied('') }
  }
  const fileBase = resultFileBase(result)
  const overview = view === 'full' || view === 'overview'
  const deliverables = view === 'full' || view === 'deliverables' || view === 'featured'
  const process = view === 'full' || view === 'process'
  const changePriority = { added: 0, updated: 1, removed: 2, unchanged: 3, '': 4 }
  const artifacts = view === 'featured' ? [...result.artifacts].sort((a, b) => changePriority[a.change] - changePriority[b.change]).slice(0, 3) : result.artifacts

  return <div className="result-reader" data-status={result.status} data-view={view}>
    <span role="alert">{downloadError}</span>
    <span className="result-sr-only" role="status">{copied ? '已复制到剪贴板' : ''}</span>
    {(overview || view === 'actions') && <section className="result-hero" aria-label="成果摘要操作">
      {view === 'full' && <div className="result-hero-meta">
        <span className={`result-status is-${result.status}`}><StatusIcon size={14} strokeWidth={2.2} />{status.label}</span>
        {result.owner && <span className="result-meta-item"><UserRound size={13} />{result.owner}</span>}
        {result.producedAt && <span className="result-meta-item"><CalendarDays size={13} /><time dateTime={result.producedAt}
          title="产出时间（本地时区）">{formatResultTimestamp(result.producedAt)}</time></span>}
      </div>}
      {view === 'full' && result.summary && <p className="result-conclusion">{result.summary}</p>}
      {view === 'full' && result.verdict && <p className="result-verdict"><StatusIcon size={15} strokeWidth={2} />{result.verdict}</p>}
      <div className="result-hero-actions">
        {onOpenBoard && <button type="button" className="result-action is-primary" onClick={onOpenBoard}><ClipboardCheck size={15} />查看任务白板</button>}
        <button type="button" className="result-action" onClick={() => void copy('summary', resultSummaryText(result))}>
          {copied === 'summary' ? <Check size={15} /> : <Copy size={15} />}{copied === 'summary' ? '已复制' : '复制摘要'}
        </button>
        <button type="button" className="result-action" onClick={() => downloadText(`${fileBase}.md`, resultReport(result))}><Download size={15} />下载报告</button>
      </div>
      {view === 'full' && result.status === 'verified' && !resultVerificationConflict(result) && <span className="result-seal" aria-hidden="true">验收通过</span>}
    </section>}

    {(overview || view === 'metrics') && !!metricCount && <section className="result-section" aria-labelledby={`${baseId}-metrics`}>
      <header className="result-section-head">
        <h3 id={`${baseId}-metrics`}>{metricsTitle}</h3>
        {metricsCaption && <small>{metricsCaption}</small>}
      </header>
      <div className="result-metrics" data-count={String(Math.min(metricCount, 6))} data-lead={hasPrimary ? 'true' : undefined}>
        {metrics.map(metric => <MetricCard key={metric.id} metric={metric} />)}
      </div>
    </section>}

    {deliverables && !!result.artifacts.length && <section className="result-section" aria-labelledby={`${baseId}-artifacts`}>
      {result.artifacts.some(item => item.change) && <p aria-label="交付变化摘要">{(['added', 'updated', 'removed', 'unchanged'] as const).map(change => {
        const count = result.artifacts.filter(item => item.change === change).length
        return count ? `${({ added: '新增', updated: '更新', removed: '移除', unchanged: '沿用' })[change]} ${count}` : ''
      }).filter(Boolean).join(' · ')}</p>}
      {view !== 'featured' && <header className="result-section-head"><h3 id={`${baseId}-artifacts`}>交付物</h3><small>{result.artifacts.length} 项</small></header>}
      <div className="result-artifacts">{artifacts.map(artifact => <ArtifactCard key={artifact.id} artifact={artifact} metadata={documentMeta?.get(artifact.id)}
        expanded={expanded === artifact.id} copied={copied}
        onToggle={() => setExpanded(current => current === artifact.id ? '' : artifact.id)}
        onCopy={() => { void copy(artifact.id, artifact.content) }}
        onDownload={() => { setDownloadError(''); void downloadArtifact(artifact).catch(error => setDownloadError(error instanceof Error ? error.message : '下载失败')) }} />)}</div>
    </section>}

    {process && (!!result.checks.length || !!result.decisions.length) && <div className={`result-columns${result.checks.length && result.decisions.length ? '' : ' is-single'}`}>
      {!!result.checks.length && <section className="result-card" aria-labelledby={`${baseId}-checks`}>
        <header className="result-card-head"><h3 id={`${baseId}-checks`}>验收清单</h3><span>{passed}/{result.checks.length} 通过</span></header>
        <ul className="result-check-list">{checks.map(check => <CheckRow key={JSON.stringify([check.id, check.artifactId, check.versionId])} check={check} />)}</ul>
      </section>}
      {!!result.decisions.length && <section className="result-card" aria-labelledby={`${baseId}-decisions`}>
        <header className="result-card-head"><h3 id={`${baseId}-decisions`}>过程决策</h3><span>{result.decisions.length} 项</span></header>
        <ol className="result-decision-list">{result.decisions.map(decision => <li key={decision.id}>
          <p className="result-decision-question">{decision.question}</p>
          <p className="result-decision-choice"><strong>{decision.choice}</strong>{decision.at && <time>{decision.at}</time>}</p>
        </li>)}</ol>
      </section>}
    </div>}

    {(overview || view === 'next') && !!result.next.length && <section className="result-section" aria-labelledby={`${baseId}-next`}>
      <header className="result-section-head"><h3 id={`${baseId}-next`}>下一步</h3><small>{result.next.length} 项行动</small></header>
      <ol className="result-next-list">{result.next.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
    </section>}

    {process && result.note && <p className="result-note"><Info size={14} strokeWidth={2} /><span>{result.note}</span></p>}
  </div>
}
````

## A.7  `ResultSectionCard.tsx`（apps/web/src/components/ResultSectionCard.tsx）

````tsx
import { useContext, useId } from 'react'
import { CheckCircle2, CircleDashed, CircleX, ClipboardCheck, File, FileArchive, FileBarChart, FileDiff, FileText, FolderOpen, Gauge, Images, Image as ImageIcon, LayoutGrid, Server, Webhook } from 'lucide-react'
import type { ResultArtifact, ResultApiSection, ResultDocumentsSection, ResultEnvironmentsSection, ResultFilesSection, ResultGallerySection, ResultSection, ResultTestsSection } from '@pawoffice/protocol/office-ui'
import { ArtifactPreviewContext } from '../results/artifactContext.ts'
import { CustomSectionBody } from './ResultBlocks.tsx'
import { ResultChanges } from './ResultChanges.tsx'
import { Chip, Track } from './ResultPrimitives.tsx'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'
const galleryStatusLabels: Record<ResultGallerySection['items'][number]['status'], string> = {
  done: '已完成', active: '开发中', pending: '待开始',
}
const documentStatusLabels: Record<ResultDocumentsSection['items'][number]['status'], string> = {
  done: '已完成', active: '进行中', pending: '待开始',
}
const apiStatusLabels: Record<ResultApiSection['rows'][number]['status'], string> = {
  done: '已完成', active: '开发中', pending: '待发布',
}
const environmentStatusLabels: Record<ResultEnvironmentsSection['items'][number]['status'], string> = {
  running: '运行中', pending: '待发布', stopped: '已停止', failed: '需关注',
}
const galleryStatusTones: Record<ResultGallerySection['items'][number]['status'], ChipTone> = {
  done: 'done', active: 'active', pending: 'pending',
}
const documentStatusTones: Record<ResultDocumentsSection['items'][number]['status'], ChipTone> = {
  done: 'done', active: 'progress', pending: 'pending',
}
const apiStatusTones: Record<ResultApiSection['rows'][number]['status'], ChipTone> = {
  done: 'done', active: 'active', pending: 'pending',
}
const checkStatusLabels: Record<ResultTestsSection['checks'][number]['status'], string> = {
  passed: '已通过', pending: '待补充', failed: '未通过',
}
const fileKindLabels: Record<ResultFilesSection['items'][number]['kind'], string> = {
  image: '图片', document: '文档', report: '报告', archive: '压缩包', other: '文件',
}

const sectionIcons = {
  gallery: Images, documents: FileText, tests: ClipboardCheck, api: Webhook, environments: Server, files: FolderOpen,
  changes: FileDiff, custom: LayoutGrid,
} as const
const metricToneIcons = { positive: CheckCircle2, negative: CircleX, neutral: Gauge } as const
const checkIcons = { passed: CheckCircle2, pending: CircleDashed, failed: CircleX } as const
const fileKindIcons = { image: ImageIcon, document: FileText, report: FileBarChart, archive: FileArchive, other: File } as const

function GalleryBody({ section }: { section: ResultGallerySection }) {
  return <ul className="result-workspace-gallery">
    {section.items.map(item => <li key={item.id} className="result-workspace-gallery-item" data-preview={Boolean(item.image)} title={item.title}>
      <div className="result-workspace-thumb">
        {item.image
          ? <a href={item.image} target="_blank" rel="noopener noreferrer" aria-label={`查看${item.title}原图（新窗口）`}><img src={item.image} alt={item.title} loading="lazy" /></a>
          : <ImageIcon size={22} aria-hidden="true" />}
      </div>
      <div className="result-workspace-gallery-meta">
        <span className="result-workspace-gallery-label">{item.meta || item.title}</span>
        {!item.image && <small>暂无预览</small>}
        <Chip tone={galleryStatusTones[item.status]}>{galleryStatusLabels[item.status]}</Chip>
      </div>
    </li>)}
  </ul>
}

function DocumentsBody({ section }: { section: ResultDocumentsSection }) {
  return <ul className="result-workspace-docs">
    {section.items.map(item => <li key={item.id} className="result-workspace-doc">
      <span className="result-workspace-doc-icon" aria-hidden="true"><FileText size={15} strokeWidth={1.9} /></span>
      <span className="result-workspace-doc-main">
        <span className="result-workspace-doc-title" title={item.title}>{item.title}</span><small>{item.artifactId ? '指定产物版本未提供' : '文档说明（未关联文件）'}</small>
        {(item.version || item.at) && <span className="result-workspace-doc-meta">{[item.version, item.at].filter(Boolean).join(' · ')}</span>}
      </span>
      <Chip tone={documentStatusTones[item.status]}>{documentStatusLabels[item.status]}</Chip>
    </li>)}
  </ul>
}

function TestsBody({ section }: { section: ResultTestsSection }) {
  return <div className="result-workspace-tests">
    {section.metrics.length > 0 && <div className="result-workspace-stats">
      {section.metrics.map(metric => {
        const Icon = metricToneIcons[metric.tone]
        return <div key={metric.id} className="result-workspace-stat" data-tone={metric.tone}>
          <span className="result-workspace-stat-label"><Icon size={12} strokeWidth={2} aria-hidden="true" />{metric.label}</span>
          <span className="result-workspace-stat-value">{metric.value}{metric.unit && <em>{metric.unit}</em>}</span>
        </div>
      })}
    </div>}
    {section.progress !== undefined && <div className="result-workspace-tests-progress">
      <div className="result-workspace-progress-head">
        <span>{section.progressLabel || '测试进度'}</span>
        <strong>{Math.round(section.progress)}%</strong>
      </div>
      <Track value={section.progress} label={section.progressLabel || '测试进度'} />
    </div>}
    {section.checks.length > 0 && <ul className="result-workspace-checks">
      {section.checks.map(check => {
        const Icon = checkIcons[check.status]
        return <li key={check.id} data-status={check.status}>
          <Icon size={14} strokeWidth={2} aria-hidden="true" />
          <span>{check.label}</span>
          <em>{checkStatusLabels[check.status]}</em>
        </li>
      })}
    </ul>}
  </div>
}

function ApiBody({ section }: { section: ResultApiSection }) {
  return <div className="result-workspace-table-wrap">
    <table className="result-workspace-table">
      <caption className="result-workspace-sr-only">{section.title}接口列表</caption>
      <thead>
        <tr><th scope="col">接口地址</th><th scope="col">方法</th><th scope="col">状态</th><th scope="col">更新时间</th></tr>
      </thead>
      <tbody>
        {section.rows.map(row => <tr key={row.id}>
          <td><code className="result-workspace-endpoint">{row.endpoint}</code></td>
          <td><span className="result-workspace-method" data-method={row.method}>{row.method}</span></td>
          <td><Chip tone={apiStatusTones[row.status]}>{apiStatusLabels[row.status]}</Chip></td>
          <td className="result-workspace-time">{row.at || '—'}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

function EnvironmentsBody({ section }: { section: ResultEnvironmentsSection }) {
  return <ul className="result-workspace-envs">
    {section.items.map(item => <li key={item.id} className="result-workspace-env" data-status={item.status}>
      <span className="result-workspace-dot" aria-hidden="true" />
      <span className="result-workspace-env-name" title={item.name}>{item.name}</span>
      {item.version && <span className="result-workspace-version-chip">{item.version}</span>}
      <span className="result-workspace-env-time">{item.at || '—'}</span>
      <span className="result-workspace-env-state">{environmentStatusLabels[item.status]}</span>
    </li>)}
  </ul>
}

function FilesBody({ section }: { section: ResultFilesSection }) {
  return <ul className="result-workspace-files">
    {section.items.map(item => {
      const Icon = fileKindIcons[item.kind]
      const body = <>
        <span className="result-workspace-file-icon" data-kind={item.kind} aria-hidden="true"><Icon size={16} strokeWidth={1.9} /></span>
        <span className="result-workspace-file-name" title={item.name}>{item.name}</span>
        {item.size && <span className="result-workspace-file-size">{item.size}</span>}
      </>
      return <li key={item.id} className="result-workspace-file">
        {item.url && !item.artifactId
          ? <a className="result-workspace-file-card" href={item.url} target="_blank" rel="noopener noreferrer"
            aria-label={`${item.name}（${fileKindLabels[item.kind]}），在新窗口打开`}>{body}</a>
          : <div className="result-workspace-file-card" title={item.name}>{body}</div>}
      </li>
    })}
  </ul>
}

function SectionBody({ section }: { section: ResultSection }) {
  switch (section.kind) {
    case 'gallery': return <GalleryBody section={section} />
    case 'documents': return <DocumentsBody section={section} />
    case 'tests': return <TestsBody section={section} />
    case 'api': return <ApiBody section={section} />
    case 'environments': return <EnvironmentsBody section={section} />
    case 'files': return <FilesBody section={section} />
    case 'changes': return <ResultChanges section={section} />
    case 'custom': return <CustomSectionBody section={section} />
  }
}

export function ResultSectionCard({ section, sourceArtifact }: { section: ResultSection; sourceArtifact?: ResultArtifact }) {
  const preview = useContext(ArtifactPreviewContext)
  const headingId = useId()
  const Icon = sectionIcons[section.kind]
  return <section className="result-workspace-card" data-kind={section.kind} data-column={section.column}
    data-span={section.span} data-emphasis={section.emphasis} aria-labelledby={headingId}>
    <header className="result-workspace-card-head">
      <span className="result-workspace-card-icon" aria-hidden="true"><Icon size={14} strokeWidth={2} /></span>
      <h3 id={headingId}>{section.title}</h3>
      {section.caption && !/^(查看全部|查看详情|上传文件)\s*[→↗]?$/.test(section.caption.trim()) && <small>{section.caption}</small>}
    </header>
    {sourceArtifact && <button className="result-section-source" type="button" onClick={event => preview?.open(sourceArtifact, event.currentTarget)} disabled={!preview}>来源：{sourceArtifact.title} · {sourceArtifact.version || sourceArtifact.versionId}</button>}
    <SectionBody section={section} />
  </section>
}
````

## A.8  `ResultPrimitives.tsx`（apps/web/src/components/ResultPrimitives.tsx）

````tsx
type StageState = 'done' | 'active' | 'pending'
type ChipTone = 'done' | 'active' | 'progress' | 'pending' | 'danger'

export function Chip({ tone, children }: { tone: ChipTone; children: string }) {
  return <span className="result-workspace-chip" data-tone={tone}>{children}</span>
}

/** Compact progress track shared by the stage stepper, tests and tasks. */
export function Track({ value, label, tone = 'done', unknown = false }: {
  value: number; label: string; tone?: StageState | 'danger'; unknown?: boolean
}) {
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  return <div className="result-workspace-track" data-tone={tone} data-unknown={unknown ? true : undefined}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={unknown ? undefined : percent} aria-valuetext={unknown ? '暂无进度' : `${percent}%`}>
    <i style={{ width: unknown ? '0%' : `${percent}%` }} />
  </div>
}
````

## A.9  `dashboard-resultDemo.ts`（apps/web/src/dashboard/resultDemo.ts）

````ts
import { officeResultSchema } from '@pawoffice/protocol/office-ui'
import type { OfficeResult, OfficeResultInput, ResultMetricInput, WhiteboardTaskBoardData } from '@pawoffice/protocol/office-ui'

const metrics: ResultMetricInput[] = [
  { id: 'impressions', label: '曝光', value: '10,000', unit: '次', previous: '10,000 次', change: '+0.0%', trend: 'flat', tone: 'neutral' },
  { id: 'visits', label: '商品访问', value: '350', unit: '次', previous: '360 次', change: '-2.8%', trend: 'down', tone: 'neutral' },
  { id: 'orders', label: '订单', value: '14', unit: '单', previous: '9 单', change: '+5 单', trend: 'up', tone: 'positive' },
  { id: 'conversion', label: '访问成交率', value: '4.0', unit: '%', previous: '2.5%', change: '+1.5pp', trend: 'up', tone: 'positive' },
  { id: 'revenue', label: '成交额', value: '1,106', unit: '元', previous: '711 元', change: '+55.6%', trend: 'up', tone: 'positive' },
  { id: 'price', label: '成交单价', value: '79', unit: '元', previous: '79 元', change: '保持不变', trend: 'flat', tone: 'neutral' },
]

const artifacts: NonNullable<OfficeResultInput['artifacts']> = [
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

const checks: NonNullable<OfficeResultInput['checks']> = [
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
  const base: OfficeResultInput = {
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
  return officeResultSchema.parse(base)
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
    detailSections: [
      {
        id: 'goal', title: '当前目标', layout: 'stack', blocks: [
          { type: 'text', text: '完成折叠电脑支架的商品资料核验、内容制作、上架授权与经营观察。所有对外图片与文案统一使用已确认参数：售价 **79 元**，适用 **13–16 英寸**笔记本，六档高度调节。' },
          { type: 'stats', items: [
            { label: '售价', value: '79', unit: '元' },
            { label: '适用范围', value: '13–16', unit: '英寸' },
            { label: '高度调节', value: '6', unit: '档' },
          ] },
        ],
      },
      {
        id: 'steps', title: '执行步骤', layout: 'stack', blocks: [
          { type: 'list', ordered: true, items: [
            { text: '核对商品参数与供应商资料，保留参数来源。' },
            { text: '制作标题、主图、尺寸图与详情文案，保持参数一致。' },
            { text: '完成上架检查，等待负责人授权后模拟上架。' },
            { text: '观察首个 24 小时窗口，汇总访问、订单与购买咨询。' },
            { text: '根据用户选择补充尺寸说明或验证优惠，再观察第二个窗口。' },
          ] },
        ],
      },
      {
        id: 'deliverables', title: '阶段交付物', caption: '3 个阶段', layout: 'stack', blocks: [
          { type: 'table', columns: [
            { key: 'stage', label: '阶段' },
            { key: 'artifact', label: '交付物' },
            { key: 'accept', label: '验收要求' },
          ], rows: [
            { stage: '商品与上架', artifact: '标题、主图、详情、价格', accept: '参数一致，无夸大描述' },
            { stage: '销量与反馈', artifact: '首轮经营数据与咨询分类', accept: '保留统计口径与起止时间' },
            { stage: '优化与复盘', artifact: '改动清单、两轮对比、复盘结论', accept: '改动有依据，结论不夸大因果' },
          ] },
        ],
      },
      {
        id: 'acceptance', title: '验收要求', layout: 'stack', blocks: [
          { type: 'list', items: [
            { text: '标题、主图、详情与价格完成复核。', status: 'passed' },
            { text: '13–16 英寸适用范围已补齐。', status: 'passed' },
            { text: '退款与售后数据接入。', status: 'pending' },
            { text: '延长观察窗口后再决定是否扩大推广。', status: 'pending' },
          ] },
        ],
      },
      {
        id: 'cautions', title: '注意事项', layout: 'stack', blocks: [
          { type: 'callout', tone: 'warning', title: '数据说明', text: '所有店铺操作与经营数据均为本地模拟，不连接真实店铺，不产生费用。' },
          { type: 'list', items: [
            { text: '两个观察窗口不是随机对照实验，不能把订单增长直接归因于单次改动。' },
            { text: '未核验的承重、散热和销量描述不对外展示。' },
          ] },
        ],
      },
    ],
    steps: [
      { id: 'listing', title: '商品与上架', progress: 100 },
      { id: 'observation', title: '销量与反馈', progress: 100 },
      { id: 'improvement', title: '优化与复盘', progress: status === 'draft' ? 60 : 100 },
    ],
    result: createResultDemo(status),
  }
}
````

## A.10  `protocol-office-ui.ts` 摘录：OfficeResult 及其区块定义（只读，不可改）

````ts
/**
 * Semantic blocks of the 交付成果 workspace. The backend picks the kind and supplies content;
 * the reader owns layout, icons and colours and renders one known component per kind. High-frequency
 * business shapes stay as typed presets; `custom` composes primitives for everything else.
 */
export const resultSectionSchema = z.discriminatedUnion('kind', [
  resultGallerySectionSchema, resultDocumentsSectionSchema, resultTestsSectionSchema,
  resultApiSectionSchema, resultEnvironmentsSectionSchema, resultFilesSectionSchema,
  resultChangesSectionSchema,
  resultCustomSectionSchema,
]).superRefine((section, context) => {
  if (section.purpose === 'artifact-preview' && (!section.artifactId || !section.versionId)) context.addIssue({ code: 'custom', message: '文件预览须提供 artifactId 与 versionId', path: ['artifactId'] })
  if (Boolean(section.artifactId) !== Boolean(section.versionId)) context.addIssue({ code: 'custom', message: '区块来源须同时提供 artifactId 与 versionId', path: ['versionId'] })
  if (section.kind === 'changes' && section.purpose) context.addIssue({ code: 'custom', message: '文件变更固定归属交付物，不填写 purpose', path: ['purpose'] })
  if (section.kind === 'tests' && section.purpose && section.purpose !== 'evidence') context.addIssue({ code: 'custom', message: '检查区块只能归属验证依据', path: ['purpose'] })
})
export const resultSectionKinds = [
  'gallery', 'documents', 'tests', 'api', 'environments', 'files', 'changes', 'custom',
] as const

export const resultTaskSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(80),
  owner: z.string().trim().max(40).default(''),
  status: z.enum(['todo', 'doing', 'blocked', 'done']).default('todo'),
  progress: z.number().min(0).max(100).optional(),
  note: z.string().trim().max(80).default(''),
})

export const resultVersionSchema = z.strictObject({
  id: idSchema,
  version: z.string().trim().min(1).max(24),
  note: z.string().trim().max(120).default(''),
  at: z.string().trim().max(24).default(''),
  author: z.string().trim().max(40).default(''),
  status: z.enum(['draft', 'released', 'rolled-back']).default('released'),
})

export const resultRiskSchema = z.strictObject({
  id: idSchema,
  title: z.string().trim().min(1).max(100),
  level: z.enum(['high', 'medium', 'low']).default('medium'),
  status: z.enum(['open', 'mitigating', 'closed']).default('open'),
  owner: z.string().trim().max(40).default(''),
  note: z.string().trim().max(160).default(''),
})

/** A structured result attached to the current goal. The reader renders it as a standalone page. */
export const officeResultSchema = z.strictObject({
  template: z.literal('result-v1').default('result-v1'),
  runId: resultOptionalId,
  title: z.string().max(160).default(''),
  status: z.enum(['draft', 'ready', 'verified', 'rejected']).default('draft'),
  summary: z.string().max(300).default(''),
  verdict: z.string().max(300).default(''),
  owner: z.string().max(40).default(''),
  producedAt: z.string().max(40).default(''),
  /** Workspace header additions. Empty strings keep the reader on the compact result page. */
  team: z.string().max(40).default(''),
  teamSize: z.number().int().min(0).max(99).optional(),
  updatedAt: z.string().max(40).default(''),
  metrics: z.array(resultMetricSchema).max(12).default([]),
  /** Optional section heading override, e.g. 审核结论 or 调研完成度. */
  metricsTitle: z.string().max(40).default(''),
  /** Optional caption for the metric group, e.g. the observation window. */
  metricsCaption: z.string().max(60).default(''),
  artifacts: z.array(resultArtifactSchema).max(8).default([]),
  /** Content sections routed by purpose; legacy sections remain readable as supplementary content. */
  sections: z.array(resultSectionSchema).max(8).default([]),
  checks: z.array(resultCheckSchema).max(12).default([]),
  decisions: z.array(resultDecisionSchema).max(8).default([]),
  /** 任务明细 tab. */
  tasks: z.array(resultTaskSchema).max(12).default([]),
  /** 版本记录 tab. */
  versions: z.array(resultVersionSchema).max(8).default([]),
  /** 风险与备注 tab. */
  risks: z.array(resultRiskSchema).max(8).default([]),
  next: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  note: z.string().max(300).default(''),
}).superRefine((result, context) => {
  result.sections.forEach((section, index) => {
    if (!section.artifactId) return
    const matches = result.artifacts.filter(artifact => artifact.id === section.artifactId && artifact.versionId === section.versionId)
    if (matches.length !== 1) context.addIssue({ code: 'custom', message: '区块必须关联本结果中唯一且版本一致的产物', path: ['sections', index, 'artifactId'] })
  })
})
export const emptyResult = () => officeResultSchema.parse({})
export type OfficeResult = z.infer<typeof officeResultSchema>
export type OfficeResultInput = z.input<typeof officeResultSchema>
export type ResultMetric = z.infer<typeof resultMetricSchema>
export type ResultMetricInput = z.input<typeof resultMetricSchema>
export type ResultArtifact = z.infer<typeof resultArtifactSchema>
````
