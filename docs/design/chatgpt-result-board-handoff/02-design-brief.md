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
