# 成果展示：任务详情工作台的数据契约与渲染

> **当前实现（2026-10-28）**：正式页面与预览已统一为“概览 / 交付物 / 过程记录”。任务状态和成果状态分别呈现，旧 Markdown 详情恢复兼容回退。入口、布局、状态规则与验收标准以 [成果体验优化方案与实施说明](result-experience-plan.md) 为准。本文其余部分保留原型的数据契约与迭代记录，早期独立视图和旧详情停用方案已被上述实现替代。

> **多轮交付补充**：入口现名“当前成果”，新增不可变交付目录、指定版本预览、精确下载、旧检查失效提示及文本比较。最新协议和能力边界见 [当前成果、历史交付与版本预览](result-deliveries.md)；产品缺口对照见 [前端能力评审](../research/frontend-gap-review-2026-10-28.md)。

本文说明设计稿「任务详情面板」（交付成果 / 任务明细 / 版本记录 / 风险与备注）如何由后端结构化数据驱动，并在前端渲染。范围是右侧任务详情面板；左侧办公室场景、顶部/左侧导航、人物状态气泡属于既有 office shell，不在本契约内。

## 1. 目标与边界

设计稿里有三类不同性质的内容：

| 设计稿区块 | 性质 | 由谁提供 |
| --- | --- | --- |
| 登录模块开发 / 执行中、负责人、团队、更新时间 | 任务头信息 | 白板状态 + 成果字段 |
| 需求与方案 / 功能开发 / 测试与审查 进度 | 阶段进度 | 白板 `steps`（`progress` + 可选 `state`） |
| 页面原型、产品文档、测试与验收、接口交付、部署与发布、文件与附件 | 交付内容 | 成果新增 `sections` 语义块 |
| 任务明细、版本记录、风险与备注 | 过程信息 | 成果新增 `tasks` / `versions` / `risks` |
| 卡片排版、单列流式布局、图标、配色、状态色 | 展示 | 前端决定，后端不传 |

原则沿用现有白板/成果契约：**后端只提供语义数据，前端决定布局、字体、颜色和交互；不接收 HTML、CSS 或文件路径。**

## 2. 数据流

```text
业务后端
  │  offices.initialize / office.snapshot（64 KiB 整体上限）
  │  conversations[].whiteboard.result
  ▼
@pawoffice/protocol  officeResultSchema（result-v1，新增字段全部可选）
  │  zod 严格校验：未知字段、null、非法枚举、非法 URL 直接拒绝
  ▼
apps/web
  ├── ResultReader      旧紧凑成果页（数据不变时保持原样）
  └── ResultWorkspace   任务详情工作台（resultHasWorkspace 为 true 时可用）
        ├── 头部：board.title / board.status / owner / team / updatedAt
        ├── Tabs：交付成果 / 任务明细 / 版本记录 / 风险与备注
        └── 交付成果：阶段进度 + 单列语义区块（含文件变更）
```

`?result-preview=1` 开发预览页从 `apps/web/src/dev/mock/result-preview.json` 取数据，走同一个 schema，因此 **改 JSON 就能改页面**，不需要改组件。

## 3. 新增数据字段

全部挂在 `whiteboard.result`（模板仍是 `result-v1`）上，均可省略并使用默认值，旧数据、旧组件行为不变。

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `team` | string ≤40 | `""` | 团队名，显示在负责人之后 |
| `teamSize` | int 0–99（可选） | 无 | 有值时渲染「前端组（3人）」 |
| `updatedAt` | string ≤40 | `""` | 更新时间展示字符串（建议 `YYYY-MM-DD HH:mm`） |
| `sections` | array ≤8 | `[]` | 交付成果语义区块，见下 |
| `tasks` | array ≤12 | `[]` | 任务明细 |
| `versions` | array ≤8 | `[]` | 版本记录 |
| `risks` | array ≤8 | `[]` | 风险与备注 |

任务明细字段：`{ id, title ≤80, owner ≤40, status: todo|doing|blocked|done, progress?, note ≤80 }`。

版本记录字段：`{ id, version ≤24, note ≤120, at ≤24, author ≤40, status: draft|released|rolled-back }`。

风险字段：`{ id, title ≤100, level: high|medium|low, status: open|mitigating|closed, owner ≤40, note ≤160 }`。

阶段进度沿用白板 `steps`，每个阶段可选 `state: done|active|pending` 表达「已完成 / 当前 / 待开始」三态，用于设计稿里第一步绿色勾选、第二步蓝色当前、第三步琥珀待办的区分；省略 `state` 时前端按 `progress` 推导（100 为 done，第一个未完成项为 active，其余 pending），旧数据行为不变。

## 4. sections：语义区块

每个区块是 `{ kind, id, title ≤40, caption ≤60 }` 加各自的 `items / rows / metrics / files`。`kind` 是判别字段（discriminated union），前端按 kind 选渲染器；未知 kind 会被 schema 拒绝。

| `kind` | 设计稿区块 | 特有字段 | 上限 | 前端渲染 |
| --- | --- | --- | --- | --- |
| `gallery` | 页面原型 / 页面预览 | `items: { id, title, meta, status: done\|active\|pending, image? }` | 8 | 缩略图卡；无 `image` 时画页面线框占位 |
| `documents` | 产品文档 | `items: { id, title, version, at, status }` | 8 | 行列表：文档图标 + 标题 + 版本/日期 + 状态胶囊 |
| `tests` | 测试与验收 | `metrics: { id, label, value, unit, tone }`（≤4）、`progress?`、`progressLabel`、`checks: { id, label, status }`（≤12） | 12 | 统计块 + 进度条 + 验收清单 |
| `api` | 接口交付 | `rows: { id, endpoint, method, status, at }` | 12 | 语义表格：地址 / 方法胶囊 / 状态 / 更新时间 |
| `environments` | 部署与发布 | `items: { id, name, status: running\|pending\|stopped\|failed, version, at }` | 8 | 环境行：状态点 + 名称 + 版本胶囊 + 时间 |
| `files` | 文件与附件 | `items: { id, name, kind: image\|document\|report\|archive\|other, size, url? }` | 12 | 文件卡：按 kind 着色的图标 + 名称 + 大小 |
| `changes` | 本轮文件变更 | `files: { path, status: added\|modified\|deleted\|renamed, previousPath?, added, deleted, binary?, oversized? }` | 24 | 已编辑 N 个文件 + 行数合计；按新增/修改/删除分组，行显示状态胶囊 + 路径 + 行数，可折叠 |

状态语义统一：`done` = 已完成（绿）、`active` = 进行中/开发中（蓝/琥珀）、`pending` = 待开始/待发布（灰）。前端负责把语义映射为文案和颜色，后端不传颜色。`changes` 的 `status` 是文件变更类型（新增/修改/删除/重命名），与上面的业务状态分开。

**所有 section 按数组顺序单列、上下流式渲染**：前端不再按 kind 把卡片分到左右栏，`span`/`column` 仅为旧数据兼容保留，布局上忽略；`emphasis` 仍用于强调卡片。

## 5. Tab 规则

- **交付成果**：始终展示；有 `sections` 时按数组顺序渲染单列区块，没有时显示空态；`board.steps` 非空时在上方渲染阶段进度。
- **任务明细**：`tasks` 非空或 `next` 非空时出现。
- **版本记录**：`versions` 非空时出现。
- **风险与备注**：`risks` 非空或 `note` 非空时出现。
- 没有任何工作台字段（`resultHasWorkspace() === false`）时，预览页不显示「任务详情」入口，正式阅读页继续使用旧的紧凑成果页，完全向后兼容。

## 6. 前端渲染实现

| 文件 | 职责 |
| --- | --- |
| `packages/protocol/src/office-ui.ts` | `resultSectionSchema` / `resultBlockSchema` / `resultTaskSchema` / `resultVersionSchema` / `resultRiskSchema`；扩展 `officeResultSchema` |
| `apps/web/src/components/ResultWorkspace.tsx` | 头部、tabs、阶段进度、区块卡片与单列流式布局（含 `changes` 文件变更卡片）；无 fetch、无副作用 |
| `apps/web/src/components/ResultWorkspace.css` | 全部 `.result-workspace-` 前缀样式，单列纵向流式布局，窄屏适配 |
| `apps/web/src/components/ResultBlocks.tsx` | 通用原语注册表：heading/text/keyValue/stats/table/list/progress/chart/image/diagram/callout/divider |
| `apps/web/src/components/ResultBlocks.css` | 原语样式与四种内部布局（stack/columns/grid/cards），前缀 `.result-block-*` |
| `apps/web/src/components/MermaidDiagram.tsx` | Mermaid 文本 → Pele SVG；懒加载、SSR 占位、错误回落、安全校验 |
| `apps/web/src/components/mermaidMarkdown.tsx` | 共享 `pre` override：` ```mermaid ` 围栏 → 图，其它代码块保持原样 |
| `apps/web/src/components/MermaidDiagram.css` | `--pele-*` 主题变量映射；占位与图注样式 |
| `apps/web/src/results/format.ts` | `resultHasWorkspace()`、`resultTeamLabel()`、Markdown 报告导出（含 typed sections 与 custom blocks） |
| `apps/web/src/dev/ResultPreview.tsx` | 第三视图「任务详情」，预览页切换与 URL 参数 |
| `apps/web/src/dev/mock/result-preview.json` | `login-module`（高频预设）与 `security-audit`（原语组合 + Mermaid 图）案例 |
| `tests/resultWorkspace.test.mjs` | schema 边界、渲染断言、原语组合、mock 端到端、Markdown 导出 |

渲染器是一个显式注册表而不是通用 JSON 渲染器：

```ts
switch (section.kind) {
  case 'gallery': return <GalleryBody section={section} />
  case 'documents': return <DocumentsBody section={section} />
  case 'tests': return <TestsBody section={section} />
  case 'api': return <ApiBody section={section} />
  case 'environments': return <EnvironmentsBody section={section} />
  case 'files': return <FilesBody section={section} />
  case 'custom': return <CustomSectionBody section={section} />  // 原语组合
}
```

类型由协议包推导（`ResultSection` 判别联合），新增 kind 需要同时改协议与前端，避免后端单方面塞入前端不认识的布局。

## 7. 后端接入示例

```json
{
  "template": "result-v1",
  "status": "ready",
  "title": "登录模块开发",
  "summary": "登录、注册、找回密码核心功能已完成开发，测试通过率 96%。",
  "owner": "王明",
  "team": "前端组",
  "teamSize": 3,
  "updatedAt": "2024-06-20 14:30",
  "sections": [
    {
      "kind": "api",
      "id": "api",
      "title": "接口交付",
      "caption": "查看全部 →",
      "rows": [
        { "id": "login", "endpoint": "/login", "method": "POST", "status": "done", "at": "06-18 10:20" }
      ]
    }
  ],
  "tasks": [
    { "id": "login-page", "title": "登录页开发", "owner": "王明", "status": "doing", "progress": 80 }
  ],
  "versions": [
    { "id": "v12", "version": "v1.2", "note": "找回密码与个人中心", "author": "王明", "at": "06-20", "status": "released" }
  ],
  "risks": [
    { "id": "sms", "title": "生产环境依赖第三方短信服务", "level": "high", "status": "open", "owner": "周理" }
  ]
}
```

约束：字段可省略、禁止 `null`；`image` / `url` 只能是 `""` 或 http(s) 链接；整份快照仍受 64 KiB 上限约束，`sections` 文本应保持简短，长正文继续放 `detail` Markdown 或 `artifacts`。

## 8. 预览与验证

```bash
# 开发预览（登录模块案例 + 任务详情视图）
http://localhost:5173/?result-preview=1&case=login-module&view=detail

# 类型检查
node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit

# 测试
node --test tests/resultWorkspace.test.mjs
node --test tests/resultReader.test.mjs
```

预览截图：

| 截图 | 内容 |
| --- | --- |
| [`docs/result-workspace.png`](../result-workspace.png) | 交付成果首屏：头部、tabs、三阶段进度、页面原型、接口交付、部署与发布 |
| [`docs/result-workspace-lower.png`](../result-workspace-lower.png) | 交付成果下半屏：产品文档、测试与验收、文件与附件 |
| [`docs/result-workspace-tasks.png`](../result-workspace-tasks.png) | 任务明细 tab |
| [`docs/result-workspace-versions.png`](../result-workspace-versions.png) | 版本记录 tab |
| [`docs/result-workspace-risks.png`](../result-workspace-risks.png) | 风险与备注 tab |
| [`docs/result-workspace-narrow.png`](../result-workspace-narrow.png) | 窄屏（760px）单列布局 |
| [`docs/result-workspace-page.png`](../result-workspace-page.png) | 预览页整体（Mock 数据驱动、视图切换） |

## 9. v2：通用原语与组合区块

### 动机

v1 的 6 种 typed section 覆盖了高频场景，但每来一个新业务版式就要新增一个前端组件。v2 把**预开发的单位从“业务组件”降为“原语”**：前端只实现一次约 12 种与业务无关的 block，后端用 `custom` section 自由组合；高频形态继续保留 typed 预设，长尾走组合。

### 数据形态

```json
{
  "kind": "custom",
  "id": "overview",
  "title": "审查概览",
  "caption": "自动生成",
  "span": "full",
  "column": "auto",
  "emphasis": "primary",
  "layout": "grid",
  "blocks": [
    { "type": "text", "text": "## 审查结论\n\n高危 **0** 个，中危 **2** 个。" },
    { "type": "stats", "label": "问题分布", "items": [
      { "label": "高危", "value": "0", "unit": "个", "tone": "positive" },
      { "label": "中危", "value": "2", "unit": "个", "tone": "negative" }
    ]},
    { "type": "callout", "tone": "warning", "title": "发布前必须关闭", "text": "中危问题需在发布前关闭。" },
    { "type": "table",
      "columns": [
        { "key": "issue", "label": "问题" },
        { "key": "level", "label": "等级", "format": "status" }
      ],
      "rows": [{ "issue": "验证码可重放", "level": "medium" }]
    }
  ]
}
```

### 原语目录（前端实现一次，后端组合使用）

| `type` | 关键字段 | 上限 | 渲染 |
| --- | --- | --- | --- |
| `heading` | text、level（h2/h3/h4） | 80 字符 | 标题 |
| `text` | Markdown 正文 | 4000 字符 | 与白板详情同一套 Markdown 渲染，忽略原始 HTML |
| `keyValue` | items：label/value/tone | 8 项 | 键值行 |
| `stats` | items：label/value/unit/tone | 4 项 | 统计块 |
| `table` | columns：key/label/format/align；rows：字符串字典 | 6 列 / 12 行 | 语义表格；format 由前端统一格式化 |
| `list` | ordered、items：text/status | 12 项 | 有序/无序清单，status 显示通过/待处理/未通过图标 |
| `progress` | label、value、tone | 0–100 | 进度条 |
| `chart` | chart（bar/line/pie）、unit、series：label/value/tone | 8 组 | 纯 SVG 图表，`role="img"` + `aria-label` |
| `image` | url（空或 https）、alt、caption | — | 图片；url 为空时虚线占位 |
| `diagram` | source（Mermaid 文本）、caption、alt | 8000 字符 | Pele 渲染的 SVG；SSR/测试显示源码占位，失败回落源码 |
| `callout` | tone（info/success/warning/danger）、title、text | 300 字符 | 提示块 |
| `divider` | — | — | 分隔线 |

`table` 的 `format` 枚举：`text / number / percent / date / code / status / method / owner / link`。后端只提供字符串值，前端决定对齐、等宽字体、状态胶囊、方法颜色与链接校验。

### 布局令牌（兼容字段，不再分栏）

| 令牌 | 取值 | 默认 | 含义 |
| --- | --- | --- | --- |
| `span` | `half` / `full` | `half` | 兼容字段；当前所有卡片占满阅读区宽度 |
| `column` | `auto` / `main` / `aside` | `auto` | 兼容字段；当前单列流式布局忽略该值 |
| `emphasis` | `normal` / `primary` | `normal` | 主次强调，仅影响卡片描边/底色 |

这些令牌仍进 zod 枚举以兼容旧数据，但当前版本按数组顺序单列、上下流式渲染，不再合并左右栏；后端不能传像素、颜色或任意样式对象。

### 前端实现

- `ResultWorkspace` 按 `sections` 数组顺序单列渲染，每个卡片占满阅读区；卡片保留 `data-column` / `data-span` / `data-emphasis` 便于数据检查，但布局不再使用 `column`/`span`。
- 单列方案避免了左右栏配对：不存在“某一侧没有 section”时的空列、占位或高度对齐问题，读屏顺序与数组顺序一致，窄屏也不需要额外的两栏降级逻辑。
- `custom` 交给 `ResultBlocks`：内部用注册表 `Map<string, renderer>` 分发，未知 `type` 渲染灰色兜底卡片（不 dump 原始 JSON），保证渲染器滞后时旧客户端不白屏。
- 四种内部布局：`stack`（单列）、`columns`（两列）、`grid`（自适应网格）、`cards`（带卡片边框的网格）；窄屏退化。
- 图表为手写 SVG（无新增依赖），Markdown 复用 `react-markdown + remark-gfm`。

### 兼容、安全与预算

- 所有新字段可选带默认值；不写 `sections`/`blocks` 的旧数据渲染结果与 v1 完全一致。
- `resultBlockSchema` 是严格判别联合：未知 block type、错误枚举、`null`、非法 URL 会被 schema 拒绝，而不是半渲染。
- 原语上限（blocks ≤24、table 6×12、chart ≤8 组、text ≤4000 字符）继续受 64 KiB 快照约束。
- 未知 type 的运行时兜底只用于“前端渲染器暂时落后于协议”的防御场景；后端应以 `office.capabilities` 暴露的 `whiteboardSchema` 为准，不发送未支持的 block。

### 后续演进

- **能力协商**：把支持的原语/版本显式列入 capabilities，后端按客户端能力降级。
- **注册表插件化**：新原语作为独立包懒加载，核心 App 不必随每次扩展发版（如 `chart@2`）。
- **逃生通道**：极少数无法抽象的内容才用外链 artifact 或白名单域名 + sandbox 的 `embed`。

### 预览

```text
http://localhost:5173/?result-preview=1&case=security-audit&view=detail
```

`security-audit` 案例覆盖：`columns` 内部版式的「审查概览」、`diagram` 认证链路（Mermaid flowchart → Pele SVG）、`changes` 文件变更（新增 2 / 修改 6）、问题清单/风险分布两个 `custom` 原语组合、typed `tests` 回归验证与 typed `documents` 审查文档；所有 section 从上到下纵向排列。

预览截图：`docs/result-workspace-v4.png`（文件变更 + 单列布局）、`docs/result-workspace-v4-lower.png`、`docs/result-workspace-v4-narrow.png`；更早的 v3 截图保留在 `docs/result-workspace-v3*.png` 作为历史对照。

## 10. v3：Mermaid 图表通过 Pele 渲染

### 背景

图（流程图、时序图、类图等）不适合用 11 种数据原语硬拼。调研结论是引入 [Pele](https://github.com/obsidianmd/pele)（Obsidian 的 Mermaid 12.1.0 渲染器，MIT，约 15.3 KiB gzip 的 lazy 入口），但**只作为“图”这一类的表达通道**：

- 后端只发 Mermaid 源文本（`diagram.source`，≤8000 字符），不发 HTML/SVG。
- 只有 Pele 从文本生成的 SVG 会被插入页面（`dangerouslySetInnerHTML` 的唯一用途）；后端文本不会直接变成标记。
- 前端懒加载：图类型不可预知，用 `pele/lazy` 的 `renderAsync()`，首次遇到某类型才拉对应 chunk。
- SSR/测试只输出 `<pre>` 源码占位（Node 无 canvas 量宽），浏览器挂载后按容器宽度重绘；失败回落源码。
- 版本锁 `1.12.0`（项目较年轻），封装在 `MermaidDiagram` 内，后续可换渲染器而不改协议。

### 接入位置

| 出口 | 行为 |
| --- | --- |
| 成果页 `diagram` block | `ResultBlocks` 注册表新增 `diagram` → `MermaidDiagram` |
| 聊天 Markdown | `ChatMarkdown` 的 `pre` override：` ```mermaid ` 围栏 → 图，其它代码块保持原样 |
| 白板详情 | `WhiteboardDetail` 同一 override |
| 交付物 Markdown | `ResultReader` 的 artifacts Markdown 同一 override |

### 约束与验证

- 只能放在 `apps/web`：仓库架构测试限制 runtime/protocol 的导入白名单（`pathfinding`/`zod`），图表渲染是展示层能力。
- 主题：SVG 颜色全部走 `--pele-*` CSS 变量，已在 `MermaidDiagram.css` 映射到工作台令牌；换色不需要重新渲染。字体通过 `--pele-font` 与 `renderAsync({ fontFamily })` 保持一致（CJK 测量需要）。
- 安全：`renderAsync` 的输出经过 `isSafeRenderedSvg` 检查（必须是 `<svg>`，且不含 `<script>`/事件处理器/`javascript:`），否则只显示源码。
- 许可：`pele@1.12.0` 已加入 `@pawoffice/web` 依赖，`public/THIRD_PARTY_NOTICES.txt` 已重新生成（200 个生产包）。
- 验证：SSR 测试断言 `mermaid-placeholder` 与源码转义；浏览器实测 `figure[data-rendered=true] svg` 生成成功（956×176），无 console 错误、760px 无溢出；`vite build` 通过。

## 11. 白板详情：Markdown → 结构化 detailSections

### 背景

`feat/whiteboard-summary-details` 引入了 `summary`（墙上概览）+ `detail`（点开白板后的整篇 Markdown）。本分支弃用 Markdown 详情：白板详情改为**后端结构化 sections + 前端原语渲染**，与成果页共用同一套 block 目录和注册表；`detail` 字段仍保留，只为旧快照解析兼容，**不再渲染**。

### 数据契约

`whiteboardTaskBoardSchema` 新增：

- `detailSections`：最多 8 项，每项严格对象 `{ id, title, caption?, layout?, blocks }`；`blocks` 1–24 个，类型完全复用 12 种原语（heading/text/keyValue/stats/table/list/progress/chart/image/diagram/callout/divider）。
- `detail`：`@deprecated`，≤16000 字符，旧快照仍能 parse；如果只有 `detail` 而没有 `detailSections`，展开后回退展示墙上概览任务板，**不会**解析 Markdown。
- `summary` 语义不变；详情与概览独立维护，详情不进入墙上预览。
- 严格对象、禁止 `null`、整份快照 64 KiB 限制不变。

### 渲染

- `WhiteboardReader` 只把 `detailSections` 传给 `WhiteboardBoardView`；有 sections 时渲染 `WhiteboardDetail`，否则使用原有 `whiteboard-reader-fallback` 任务板。
- `WhiteboardDetail` 对每个 section 先做一次 schema 归一化，再交给 `CustomSectionBody`；排版是文档式的“章节标题 + 细分隔线 + 单列 820px”，block 内部仍可用 `stack/columns/grid/cards`。
- `diagram` 复用 v3 的 Pele 通道；聊天/交付物 Markdown 里的 ` ```mermaid ` override 仍然保留，但白板详情本身不再经过 Markdown 渲染。
- 旧的 Markdown 详情渲染器与 `.whiteboard-detail` 的 Markdown 样式已移除，只保留 fallback 任务板需要的样式。

### 迁移映射（旧 `detail` → `detailSections`）

| 旧 Markdown | 新结构 |
| --- | --- |
| `#`/`##`/`###` 标题 | `section.title`，小节内用 `heading` block |
| 段落、强调、链接 | `text` block（行内 Markdown 仍然支持，但不接受整篇 Markdown） |
| 表格 | `table` block |
| 任务清单 | `list` block（`status: passed/pending/failed`） |
| 引用、注意事项 | `callout` block |
| 流程图/时序图 | `diagram` block（Mermaid 源文本，Pele 渲染） |
| 图片、分隔线 | `image` / `divider` block |
| 代码块 | `text` block 内围栏，或交付物 Markdown |

### 文件

| 文件 | 职责 |
| --- | --- |
| `packages/protocol/src/office-ui.ts` | `whiteboardDetailSectionSchema`、`detailSections`、`detail` 弃用标记 |
| `apps/web/src/components/WhiteboardDetail.tsx/.css` | 结构化详情文档：章节标题 + 原语 blocks |
| `apps/web/src/components/WhiteboardBoardView.tsx` | sections 优先，旧任务板 fallback |
| `apps/web/src/components/WhiteboardReader.tsx` | 只读取 `detailSections`；标题与滚动逻辑 |
| `apps/web/src/dashboard/whiteboardDemo.ts` | 长/短结构化详情 demo + 旧 Markdown 回退 demo |
| `apps/web/src/dashboard/resultDemo.ts` | 成果 demo 白板的详情改为结构化 |
| `tests/whiteboardDetails.test.mjs` | schema 上限、bridge、结构化渲染、旧 Markdown 不渲染 |
| `integration/docs/office-integration.md` | 接入契约：detailSections、弃用与迁移 |

### 验证与截图

- 单测：`whiteboardDetails` 4 项（bridge 独立、旧 Markdown 回退、原语渲染/XSS、schema 与 demo 校验）+ `resultReader` 更新后的白板详情断言；本轮相关测试共 64 项全部通过。
- 浏览器（`/?whiteboard-demo=1`，点开墙上白板）：8 个 section、19 个 block、1 张 Pele 图渲染成功，无 console 错误；760px 下无横向溢出。
- 截图：`docs/whiteboard-detail.png`（首屏）、`docs/whiteboard-detail-lower.png`（下半屏，清单/状态）、`docs/whiteboard-detail-narrow.png`（窄屏）。

## 12. 文件变更区块与单列流式布局

### 背景

成果页需要像 DSH 的收尾卡片一样展示“这一轮改了哪些文件”，并区分新建与修改。同时所有 section 改为**单列、上下流式**，不再按 `main`/`aside` 配对左右栏。

### 数据契约

新增 typed section `kind: "changes"`：

```json
{
  "kind": "changes",
  "id": "changes",
  "title": "文件变更",
  "caption": "本轮 · git 工作树",
  "files": [
    { "path": "apps/web/src/components/WhiteboardDetail.css", "status": "added", "added": 49 },
    { "path": "apps/web/src/components/WhiteboardDetail.tsx", "status": "modified", "added": 22, "deleted": 12 },
    { "path": "docs/whiteboard-detail.png", "status": "added", "binary": true }
  ]
}
```

- `files` 1–24 项；`path` 1–200（相对工作区路径，不传绝对路径）；`status` 为 `added`/`modified`/`deleted`/`renamed`（默认 `modified`）；`previousPath` 仅重命名；`added`/`deleted` 为 0–1,000,000 的整数；`binary`/`oversized` 为布尔。
- 总数、`+/-` 行数由前端从 `files` 汇总，后端不需要重复发送；超出 24 个文件请在后端先截断并在 `caption` 说明。
- 与 `files`（文件与附件）语义不同：`files` 是交付物列表，`changes` 是本轮工作区改动。

### 渲染

- `ChangesBody`：顶部「已编辑 N 个文件 +X/-Y」；按状态分组「新增文件 / 修改文件 / 删除文件」；每行是状态胶囊 + 路径（等宽字体）+ 该文件 `+added/-deleted`（二进制/过大显示文字）；每组默认最多 4 行，底部「全部 N 个文件 / 收起」展开。
- 路径只做文本渲染，`title` 提供完整路径；不接收 URL、HTML 或 diff 正文。
- 卡片沿用 `ResultWorkspace` 外壳与 `emphasis` 强调；行数颜色、状态胶囊复用现有设计令牌。

### 单列流式布局

- `ResultWorkspace` 直接按 `sections` 数组顺序渲染 `<SectionCard>`，删除 `groupSectionRows`/两栏配对逻辑；`.result-workspace-sections` 是 flex column，卡片 `width: 100%`。
- `span`/`column` 字段仍保留在 schema 中（旧数据兼容），但布局不再读取；`emphasis` 继续生效。
- 好处：没有“一侧为空”的空列/占位/高度对齐问题；读屏顺序与数组顺序一致；窄屏无需额外降级分支；新增 section 不需要考虑放主栏还是副栏或是否跨栏。
- 代价：信息密度低于两栏、页面更长；用卡片间距、`emphasis` 和分组维持层次。

### 文件

| 文件 | 职责 |
| --- | --- |
| `packages/protocol/src/office-ui.ts` | `resultChangesSectionSchema`、`resultSectionKinds`、`ResultChangesSection` |
| `apps/web/src/components/ResultWorkspace.tsx` | `ChangesBody`、单列 `DeliverablesPane`、`SectionCard` |
| `apps/web/src/components/ResultWorkspace.css` | 单列 sections、变更分组/行/折叠样式 |
| `apps/web/src/results/format.ts` | Markdown 报告导出「文件变更」表格 |
| `apps/web/src/dev/mock/result-preview.json` | `security-audit` 增加 `changes` 示例 |
| `tests/resultWorkspace.test.mjs` | 变更渲染/校验、单列断言、mock 端到端 |

### 验证与截图

- 单测：`resultWorkspace` 15 项全部通过，包含 `changes` 渲染（新增/修改/删除、二进制、折叠）、schema 边界、mock 端到端与“无 `.result-workspace-row`”的单列断言。
- 浏览器（`?result-preview=1&case=security-audit&view=detail`）：7 个 section 纵向排列，`changes` 卡片 8 个文件、新增 2 / 修改 6、合计 +762/-181，无 console 错误、760px 无横向溢出。
- 截图：`docs/result-workspace-v4.png`（文件变更卡片）、`docs/result-workspace-v4-expanded.png`（展开全部 8 个文件）、`docs/result-workspace-v4-lower.png`（后续 section 纵向流式）、`docs/result-workspace-v4-page.png`、`docs/result-workspace-v4-narrow.png`。
