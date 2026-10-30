# PawOffice 侧接入面调研：Pele（Mermaid → SVG）能落在哪里

> 历史调研说明：2026-10-30 已删除早期独立成果测试页及其专用数据。本文涉及该页面的路径和行号仅代表调研时的代码状态；当前联调使用正式办公室中的电商工作流 mock。

> 调研人：integration-scout ｜ 调研日期：2026-10-27 ｜ 范围：**仅 PawOffice 仓库（`D:\kunlunmeta\ai-office-react`）**，不评估 Pele 本身（由另一位 teammate 负责）
> 只读调研：未修改任何源码；仅新建本文件。所有结论以仓库内 `file:line` 为证；凡属推断均标 `[推断]`。
> 关键结论均已用命令复核：`npm run licenses:check` → `Third-party notices verified: 199 production packages`（当前仓库许可清单是干净的，可作为基线）。

---

## 0. 结论速览

1. **全仓 `mermaid` 只有 4 处命中，全部是静态文档里的围栏代码块**（`integration/docs/office-integration.md:27,94,277,436`），由 GitHub 渲染，PawOffice 前端**从不**处理 mermaid。仓库内没有任何 mermaid 解析器、没有 `@mermaid-js/*`、没有 diagram 组件。
2. 真正有意义的接入面只有 **3 个 Markdown 渲染点 + 1 个结构化原语注册表**：
   - AI/后端文本：`apps/web/src/components/ChatMarkdown.tsx:12-15`（聊天）、`apps/web/src/components/WhiteboardDetail.tsx:10-12`（白板 `detail`）、`apps/web/src/components/ResultBlocks.tsx:75-79` + `ResultReader.tsx:127`（成果文本/交付物）。
   - 结构化数据：`ResultBlocks.tsx:394-415` 的 `blockRenderers` 注册表——加一个 `chart` 之外的 `diagram` 原语即可让**后端按 schema 传**图。
3. **今天一块 `` ```mermaid `` 围栏的落点是 `<pre><code class="language-mermaid">…转义文本…</code></pre>`**。证据在仓库自己的测试断言里：`tests/chatMarkdown.test.mjs:20`。没有语法高亮、没有二次加工（`integration/docs/office-integration.md:912` 明确"代码块显示为文本，不进行语法高亮"）。
4. **白板 `whiteboard` 是"固定格式"，不是富内容容器**：`task-board-v1` 模板 + `detail`（≤16000 字符 Markdown）+ `result`（`result-v1` 结构化成果）。挂图有三条路，成本与风险差别很大（见 §3.4）。
5. **新增一个 npm 运行时依赖在当前机制下是"许可清单自动化 + 人工评审"闸门**：只要 declared license 是 `MIT` **且**安装目录里有 LICENSE/COPYING/NOTICE 文件，`licenses:generate` 会自动通过（`scripts/third-party-notices.mjs:7,32,50-52,77`）。以下情况会**直接 fail**：复合 SPDX 表达式（如 `(MIT OR Apache-2.0)`）、license 文件缺失、`file:`/非 workspace 本地依赖、lockfile 与安装版本不一致。（详见 §5，这是本次决策最关键的一节。）
6. 仓库没有 CSP、没有 HTML sanitizer，唯一 `dangerouslySetInnerHTML` 喂的是**本地生成且已转义**的字符串（`packages/scene-office/src/taskBoard.ts:4,16`）。因此"渲染第三方 SVG 字符串"这件事今天**没有任何策略兜底**，必须由接入方自己保证只喂"本地/渲染器自己生成的 SVG"，绝不能让后端文本直接变成 SVG 字符串。

---

## 1. 图表类内容可能出现的面：逐条实测

### 1.1 `mermaid`（任意大小写）

全仓仅 4 处，均为已有架构文档的围栏：

| 文件:行 | 内容 | 性质 |
| --- | --- | --- |
| `integration/docs/office-integration.md:27` | `sequenceDiagram`：打开页面/初始化/心跳时序 | (c) 静态文档 |
| `integration/docs/office-integration.md:94` | 时序图 | (c) 静态文档 |
| `integration/docs/office-integration.md:277` | 时序图 | (c) 静态文档 |
| `integration/docs/office-integration.md:436` | 时序图（会话切换） | (c) 静态文档 |

**含义**：这 4 处是 GitHub / 编辑器渲染，PawOffice 部署站点不做任何 mermaid 处理。若要把它们变成页面内的图，属于"把文档搬进产品"，与聊天/白板接入是两条完全不同的需求。

> 附带事实：文档里用 mermaid **描述协议**，说明团队已经在用 mermaid 作为"架构表达语言"——这是**内部共识**上的加分项（需求侧有真实习惯），但不是"运行时已有渲染能力"。

### 1.2 Markdown 渲染（4 个真实渲染点）

依赖在 `apps/web/package.json:27-28`：`react-markdown@10.1.0` + `remark-gfm@4.0.1`（**只在 apps/web，不在任何 `packages/*`**）。全仓 4 个 `<Markdown>`：

| 文件:行 | 渲染对象 | 数据来源 | 现有 `components` 覆盖 |
| --- | --- | --- | --- |
| `apps/web/src/components/ChatMarkdown.tsx:12-15` | 助手回复全文 | (a) AI/聊天服务 NDJSON | `a`/`table`/`img`，**无 `pre`/`code`** |
| `apps/web/src/components/WhiteboardDetail.tsx:10-12` | 白板 `detail`（≤16000 字符） | (a) 后端快照 | `a`/`table` |
| `apps/web/src/components/ResultBlocks.tsx:75-79` | `result` 的 `text` 原语（≤4000 字符） | (a) 后端快照 | `a`/`table`/`img`（`ResultBlocks.tsx:38-46`） |
| `apps/web/src/components/ResultReader.tsx:127` | 交付物 `artifacts[].content`（≤8000 字符） | (a) 后端快照 | `a`/`table` |

四处全部 `skipHtml`（原始 HTML 被丢弃，非"转义后显示"）。**没有 `rehype-raw`、没有 sanitizer、没有高亮器**（依赖表里无 highlight.js/shiki/prism）。

### 1.3 代码块今天长什么样

`ChatMarkdown` 没有覆盖 `code`/`pre`，落到 react-markdown 默认渲染器。仓库自己的 SSR 测试把实际 HTML 钉死了：

```js
// tests/chatMarkdown.test.mjs:20
assert(html.includes('<pre><code class="language-html">&lt;div&gt;\n  # 标题 *原文*\n&lt;/div&gt;\n</code></pre>'))
```

推论（`[推断]`，但由上一行直接可推）：LLM 回 `` ```mermaid `` 时，页面出现的是

```html
<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>
```

即**等宽字体、灰底、`overflow-x:auto` 的纯文本**（样式见 `apps/web/src/components/OfficeChat.css:50`），源码中的 `-->` 之类被转义成 `--&gt;`，但**围栏语言标记 `language-mermaid` 被完整保留**——这正是接入点：`code` 渲染器里 `className` 一处判断即可抓到全部候选块，零协议改动。

### 1.4 Markdown 之外的"半结构化可视化"面

| 面 | 文件:行 | 说明 | 性质 |
| --- | --- | --- | --- |
| 成果 `chart` 原语 | `packages/protocol/src/office-ui.ts:254-264`（schema）、`apps/web/src/components/ResultBlocks.tsx:212-343`（手写 SVG） | `bar/line/pie`，最多 8 组数据；`role="img"` + `aria-label`（`ResultBlocks.tsx:233-234`） | (a) 后端结构化数据 |
| 成果 `image` 原语 | `office-ui.ts:266-271` | 只允许 `""` 或 http(s) URL，空时虚线占位 | (a) |
| 白板任务板 | `packages/scene-office/src/taskBoard.ts:16-49` | **本地生成**的 HTML 字符串（内联 style），后端只给文本/数字 | (a) 数据 → 本地模板 |
| 地图编辑覆盖层 | `apps/web/src/components/map-editor/MapEditorOverlay.tsx:81-110` | 一块**真实的 DOM `<svg>`** 叠在 Pixi canvas 上（`z-index:4`，`MapEditor.css:8`） | (b) 用户交互（不是图表） |
| 场景协议 JSON 面板 | `apps/web/src/components/SceneControlPanel.tsx:9,25,76` | 用户手改 JSON 命令 → `<pre>` 结果 | (b) 用户自著 |
| 成果预览 JSON | `apps/web/src/dev/ResultPreview.tsx:147` | `<pre>{JSON.stringify(…)}</pre>`，dev-only | (b) 开发工具 |
| docs 截图 | `docs/*.png`（如 `result-workspace.png`、`result-reader-board-detail.png`） | 静态图片，无法挂 mermaid | (c) 静态 |
| lucide 图标 | **26 个** `.tsx/.ts` 文件 `import from 'lucide-react'`；另 `scripts/assets/build-whiteboard-icons.mjs:1-10` 在**构建期内联 SVG** 到 `packages/scene-office/src/whiteboardIcons.ts` | 图标不是图表，但它是"SVG 内联字符串进缩放受限画布"的现成先例 | (c) 构建期 |

### 1.5 组织图 / 技能树 / 任务流可视化的现状

`skill`/`orgChart`/`flowchart`/`skillTree`/`treeView` 在 `apps/web/src` 内**零命中**。任务/流程目前的可视化只有两种已经做过的形态：

- **阶段进度**：白板 `steps`（≤3）→ 圆形序号 + 进度条（`taskBoard.ts:19-27`），以及 `result` 的 `progress`/`list`/`tests` 原语。
- **任务明细表**：`result.tasks`（≤12）→ 列表/勾选（`ResultReader`/`ResultWorkspace`）。

即：**"任务流/依赖图"这一形态今天完全空缺**，而协议里已经有一堆天然适合画成图的语义数据（`steps` 三态、`tasks` 的 `todo/doing/blocked/done`、`risks`、`versions`）——这是"结构化 → 图"路线（不经过 Mermaid）的真实价值所在。

### 1.6 按来源分类汇总

| 类别 | 面 | 谁能控制内容 | 可信度 |
| --- | --- | --- | --- |
| **(a) 后端/AI 文本** | 聊天回复、白板 `detail`、`result.text`、`artifacts[].content` | 外部聊天服务 / 业务后端 / LLM | 不可信输入，但目前只用 `skipHtml` 渲染为受限 Markdown |
| **(a) 后端结构化** | `whiteboard`（`task-board-v1`）、`result`（`result-v1` + 11 种原语） | 业务后端 | zod `strictObject` 严格校验，未知字段直接拒绝 |
| **(b) 用户自著** | 地图编辑器草稿、场景协议 JSON 面板、聊天输入框（≤4000 字符） | 本页用户 | 本地，不上传业务后端 |
| **(c) 静态文档/资产** | `integration/docs/*.md` 的 4 处 mermaid、`docs/**` 截图、lucide 图标、Pixi 场景素材 | 仓库本身 | 构建期产物 |

---

## 2. 聊天管线：一条 `` ```mermaid `` 从 LLM 到屏幕

### 2.1 全链路

```text
外部聊天服务 ──NDJSON──> POST /api/pawoffice/chat（同源转发）
  └─ packages/protocol/src/chat.ts:61-93  readChatEvents()
       每行 JSON ≤350000 字符，逐条 zod 校验 chatEventSchema(:43-49)
       delta.text ≤16000(:45)、snapshot.text ≤50000(:48)
  └─ apps/web/src/chat/sources.ts:74-83   HttpChatSource.events()
  └─ apps/web/src/chat/ChatSession.ts:192-226 receive()
       delta → 追加到该条 message.content（:210-214）
       snapshot → 整体替换（:205-209）
       每次追加都 this.update(...) → notifySubscribers（:47-54）
  └─ apps/web/src/components/OfficeChat.tsx:18  useSyncExternalStore(session.subscribe...)
  └─ ChatTranscript.tsx:56  <ChatMarkdown content={row.message.content} pending=… />
  └─ ChatMarkdown.tsx:14    <Markdown remarkPlugins={[remarkGfm]} skipHtml>
```

协议契约见 `integration/docs/chat-integration.md`，其中最后一句话就是现状总结：

```text
integration/docs/chat-integration.md:221
回复按 Markdown 展示，支持标题、列表、代码块、表格等，禁用原始 HTML 执行。复制和历史记录保留原始文本。
```

### 2.2 三个对接入方是硬约束的细节

1. **流式是逐 delta 全量重渲**。`ChatSession.ts:213` 每收到一段就整体替换 message 对象，`ChatMarkdown.tsx:12` 是 `memo` 但 `content` 每 delta 都变 → **每 ~35–100ms 重新跑一次 react-markdown**（预览源的节流见 `apps/web/src/chat/sources.ts:26-29`，每 3 字符 + 35ms）。若在 `code` 渲染器里同步调用图渲染器，会在流式期间被调用几十上百次，且 `content` 在围栏闭合前是**不完整的 Mermaid 源码**。
   → 接入时必须：① 只在 `pending === false`（或围栏闭合）时渲染；② 渲染结果按 `content` 缓存（LRU/Map），否则滚动 + 虚拟列表会反复重算。
2. **虚拟列表会测量 DOM**。`ChatTranscript.tsx:26-32` 用 `@tanstack/react-virtual`，`measureElement`（:52）依赖真实高度。异步渲染/缩放 SVG 会让行高在 1–2 帧后跳变，导致滚动抖动；现有实现已用 `estimateSize:140`、`overscan:6` 缓解，但**图比一行文字高得多**，需要给图一个确定高度或 `ResizeObserver` 主动重测。
3. **历史与复制保存原始文本**。消息存 IndexedDB（分块 50 条，`integration/docs/chat-integration.md:182`），渲染产物不落库 → **换设备/刷新后仍能重绘**（只要渲染器确定性），但**导出/复制的是源码**（`ChatTranscript.tsx:36-41` 只复制 `message.content`）。这对"图 = 派生视图"的定位是好事。

### 2.3 今天的可见结果

| 位置 | 现在 | 改动后（示意） |
| --- | --- | --- |
| 聊天气泡 | 灰底 `<pre><code class="language-mermaid">` + 源码文本 | 图 + 可折叠源码 |
| 复制按钮 | 复制围栏源码 | 不变（符合现有语义） |
| 刷新恢复 | 重新渲染同一段源码 | 不变（确定性渲染） |
| `snapshot` 事件 | 整段替换，可能把已画好的图整体重挂 | 需要 key 稳定（用 turnId + 块序号） |

---

## 3. 白板管线

### 3.1 协议形状（固定格式，非富容器）

`packages/protocol/src/office-ui.ts:408-424`：

```ts
export const whiteboardTaskBoardSchema = z.strictObject({
  template: z.literal('task-board-v1').default('task-board-v1'), title: z.string().max(160).default(''),
  status: z.enum(['queued','running','blocked','completed','failed']).default('queued'),
  tagline: z.string().max(40).default(''), description: z.string().max(300).default(''), note: z.string().max(160).default(''),
  summary: z.string().max(300).default(''), detail: z.string().max(16000).default(''),
  link: …url 白名单…,
  steps: z.array(…progress/-1..100/state…) .max(3),
  result: officeResultSchema.default(emptyResult()),
})
```

- 位置：`conversations[].whiteboard`，随 `office.snapshot` 下发，共用快照 `seq`（`integration/docs/office-integration.md:616`），整次请求 **≤64 KiB**（`:618`）。
- `detail`（≤16000 字符）是**唯一的长文本富内容位**，被文档明确定义为 Markdown：`integration/docs/office-integration.md:618,912`。
- Schema 会**自动**通过 `office.capabilities` 暴露给后端：`packages/protocol/src/office-integration.ts:118`（`whiteboardSchema: z.toJSONSchema(whiteboardTaskBoardSchema)`）——所以任何协议字段变更对集成方"自动可见"，但旧客户端会**整份快照拒收**（`integration/docs/office-integration.md:888`：未知 `type` 会先被旧 schema 拒绝整份快照）。这是新增 block 类型的主要兼容风险。

### 3.2 渲染链（两个渲染器，一个 dormant 的 `dangerouslySetInnerHTML`）

```text
apps/web/src/components/OfficeCanvas.tsx:20  <WhiteboardReader …/>（原生 <dialog> 弹窗）
  └─ WhiteboardReader.tsx:28   detail = board.detail.trim()
  └─ WhiteboardReader.tsx:30-33 html = renderWhiteboardContent({taskBoard: progress.project(...)})
  └─ WhiteboardReader.tsx:96   <WhiteboardBoardView detail={detail} html={html} />
        └─ WhiteboardBoardView.tsx:5
             detail ? <WhiteboardDetail content={detail}/>            ← Markdown 分支（优先）
                    : <div dangerouslySetInnerHTML={{__html: html}}/> ← 本地生成 HTML 分支
```

- **`html` 永远是本地生成**：`packages/scene-office/src/taskBoard.ts:16-49`，源头注释就写着 `/** Fixed presentation markup. Backend content is text/data, never HTML or CSS. */`（:15），且所有后端字符串都过 `escape()`（:4、:24、:32、:41、:42、:44）。所以这个 `innerHTML` **不是** untrusted HTML sink。
- 一旦提供 `detail`，**弹窗只显示 Markdown，任务板 HTML 不显示**（`detail` 优先）。这意味着：往 `detail` 里塞 `` ```mermaid ``，用户看到的就是 §1.3 那个 `<pre>`，而且**连原有的任务板卡片都没了**——接入前必须先想清楚这个取舍。
- 墙上白板走的是**另一条完全不同的路**：`packages/scene-office/src/pixi/views/referenceOffice.ts:106-136` 用 Pixi `HTMLText`（:108）渲染 `renderWhiteboardPreview()`（:121），只在 `update`/`updateFrame` 里以 250ms 节流重绘（:131-134）。`HTMLText` 只接受 HTML 文本子集（`b/i/br/span` 一类），**塞不进 `<svg>`**。要在墙上显示图，只能把 SVG 转成纹理（`Texture.from(dataURL)`）或改成 DOM 覆盖层——两者都是新工作量，不是"复用现有渲染"。

### 3.3 白板"能不能挂图"的三种现存能力

| 方式 | 现在能不能 | 证据 |
| --- | --- | --- |
| `result.image` 原语贴 **https 图片** | 能 | `office-ui.ts:266-271` + `ResultBlocks.tsx:347-357`；URL 只允许 `""` 或 http(s)（`:4-6`） |
| `result.gallery[].image` 缩略图 | 能，同上 | `office-ui.ts:61-69` |
| `detail` 里贴 Markdown 图片 | 能，但只接受 http(s)（react-markdown 默认 urlTransform 会剥掉 `data:`；`tests/chatMarkdown.test.mjs:48-50` 正是钉这个） | — |
| `detail` 里塞 `` ```mermaid `` | 不是"挂图"，是"挂源码文本" | §1.3 |

### 3.4 结论：白板侧的三条接入路线

1. **最省**：只让 `detail` 里的 `` ```mermaid `` 围栏被渲染成图（改 `WhiteboardDetail.tsx` 的 `components.code`）。价值：后端不用改协议；代价：与任务板卡片互斥、`detail` 16000 字符预算、墙上看不到图。
2. **最正规**：`result` 加一个 `diagram` 原语（`resultBlockTypes` `office-ui.ts:185-187` + `resultBlockSchema` `:286-290` + `ResultBlocks.tsx` 注册表 `:403-415`），后端传 `{type:'diagram', source:'…mermaid 文本…'}`。价值：走能力协商（`office.capabilities` 自动暴露新 schema）、有严格的 64 KiB 预算、走成果页而不是挤占 `detail`。代价：**必须同时改协议包和前端**，且旧客户端会拒收整份快照（`office-integration.md:888`）——需要版本化/能力降级策略。
3. **不要做**：让后端或 LLM 直接传 SVG 字符串。这会把"本地生成的 HTML"变成"远端可控的 SVG"，在无 CSP、无 sanitizer 的现状下等于开一个新 XSS 面（见 §4.4）。

---

## 4. 包体与架构约束

### 4.1 当前 dist 体积（实测）

```text
dist/  34.7 MB / 201 个文件（绝大部分是场景素材）
dist/assets/*.js   1 634 KB / 39 个 chunk      ← 代码总量
dist/assets/*.css    118 KB
最大 chunk：home-VQK-y61U.js 447.4 KB、primitives-BsRo-Moz.js 232.6 KB、connectionConfig-BoRwUOH2.js 221.5 KB
dist/index.html 直接 modulepreload 了 20 个 chunk（Pixi 全家桶：WebGLRenderer 71KB、CanvasPool 69.5KB、GraphicsContext 60.2KB…）
dist/THIRD_PARTY_NOTICES.txt 261 332 B
```

要点：

- 首屏已经"很重且全量预加载"：`dist/index.html` 里 20 条 `modulepreload` + 1 个 entry。`docs/architecture/package-migration.md:23` 也承认"仍有大于 500 kB 的 chunk 提醒"。→ **净增几十 KB 在这个量级里不是主要决策变量**，但"进首屏还是按需"仍然重要。
- 站点根部的 `THIRD_PARTY_NOTICES.txt` 会被 Vite 原样拷进部署产物（`licenses/README.md:4-5`），每加一个生产依赖就把它撑大一点（不影响 JS 体积，但会影响部署体积与人工 review 的 diff）。

### 4.2 Vite 配置与代码分割

`apps/web/vite.config.ts`（根 `vite.config.ts:1` 只是 re-export）：

- Vite **8** + rolldown（`build.rolldownOptions`，:74-81），MPA 四入口：`home` / `minimal` / `classroom` / `farm`。
- **没有 `manualChunks`、没有 budget 检查、没有 `rollup-plugin-visualizer`**。chunk 划分完全交给 rolldown 自动推导（所以看到 `primitives`/`core`/`WebGLRenderer` 这类共享块）。
- `resolve.dedupe: ['pixi.js','react','react-dom']`（:64）——单实例约束，新依赖若带 react 生态要小心重复实例。
- **唯一的手写动态导入是 dev-only**：`apps/web/src/App.tsx:35-37`（`import.meta.env.DEV ? lazy(() => import('./dev/ResultPreview.tsx'))`）。生产构建里没有任何 `React.lazy`。
- → 结论：想让图渲染器**不进首屏**，必须自己写 `await import('...')` + `Suspense`；没有现成的按需加载基建。`docs/architecture/result-workspace.md:263` 已经把这条路写成既定演进方向："**注册表插件化**：新原语作为独立包懒加载，核心 App 不必随每次扩展发版（如 `chart@2`）"。

### 4.3 DOM / SVG 覆盖层可以放哪里（Pixi 之上的既有分层）

PawOffice 是"Pixi canvas + DOM 覆盖层"的混合结构，覆盖层是**既定架构**而非 hack：

| 层 | 证据 | z-index |
| --- | --- | --- |
| Pixi canvas | `<SceneSurface host={host} className="office-render-surface" />`，`OfficeCanvas.tsx:13` | 基础层 |
| 地图编辑 `<svg>` 覆盖 | `MapEditorOverlay.tsx:81`（viewBox 与场景坐标同构，用 `getScreenCTM().inverse()` 做坐标反算，:44-45）；`MapEditor.css:8` `.map-overlay { z-index: 4 }` | 4 |
| 聊天全屏面板 | `OfficeChat.css:3` `.office-chat { position:absolute; inset:0; z-index:25 }` | 25 |
| 白板阅读器 | 原生 `<dialog>`（`WhiteboardReader.tsx:80`）+ `showModal()`（:53） | top layer |

→ **结论**：把图的 SVG 放进 DOM 是零架构阻力的（地图编辑器就是先例，且已经解决了"DOM 坐标 ↔ 场景坐标"的换算）；**相反**，想在图里显示到 Pixi 场景内部（墙上白板、桌面屏幕）才是有成本的（§3.2 的 `HTMLText` 限制）。

### 4.4 安全与 CSP 现状（重要）

实测：**全仓没有任何 `Content-Security-Policy`**。

- `server/src/app.ts`（Fastify）唯一的 `onSend` 钩子（:47-56）只做协议响应校验，不设安全头；`grep -i "content-security|helmet|X-Frame"` 零命中。
- `vercel.json`（7 行）没有任何 `headers` 配置。
- `apps/web/index.html` 没有 CSP `<meta>`。
- `Dockerfile` 也没有反向代理层加头。

现有的 HTML 注入面只有一处，且是安全的：

```ts
// apps/web/src/components/WhiteboardBoardView.tsx:5
return detail ? <WhiteboardDetail content={detail} /> : <div className="whiteboard-reader-fallback" dangerouslySetInnerHTML={{ __html: html }} />
```

`html` 恒来自 `packages/scene-office/src/taskBoard.ts:16`，后端文本全部 `escape()`（:4）。Markdown 侧统一 `skipHtml` + react-markdown 默认 URL 变换（`data:`/`javascript:` 被剥，见 `tests/chatMarkdown.test.mjs:47-51`）。

→ **对 Pele 的直接影响**：
- Pele 产出的是 **SVG 字符串**。如果接入方式是 `dangerouslySetInnerHTML={{__html: svg}}`，那么"SVG 里能不能带 `<script>`/`onload`/`<foreignObject>`"就完全取决于 Pele 对**输入文本**的处理。**"输入来自 LLM/后端"**这一前提意味着：这是一条新的、没有兜底的执行路径。
- 因此建议：**只渲染"渲染器自己序列化出来的 SVG 元素"**（用 React 元素树 / DOM API 构建），或至少把 SVG 字符串当作完全可信产物并在 draft 文档里写清"仅接受本地渲染结果"。在引入 Pele 的同一次变更里顺手加一条 CSP 是合理的最小加固，但那会牵动部署侧（Vercel `headers` / Fastify 头 / 内联 style 豁免），属于**额外范围**。

### 4.5 依赖边界：新代码只能放在哪

两条机器强制的约束（走 `npm run pretest` / `npm test` 就会跑到）：

**`tests/architecture.test.mjs`**（导入图级别的硬断言）：

```js
// :44-47
test('headless core cannot import office definitions, Pixi, React, application or texture code', async () => {
  const graph = await dependencies('runtime/src/index.ts')
  assert(graph.files.every(file => /^(runtime|protocol)\//.test(file)))
  assert.deepEqual(graph.imports.sort(), ['pathfinding', 'zod'])      // ← 精确相等，多一个就红
})
// :55-60  protocol 的 8 个入口只能 import 'zod'
// :77-83  scene-office core 不得 import 'pixi.js'；animation-frame 不得 import 场景/渲染包
```

**`scripts/check-packages.mjs`**（声明与导入必须对齐）：

```js
// :55-56  每个 import 的裸包名必须在该包 dependencies/peerDependencies 里，否则
//         `${file}: undeclared dependency ${dependency}`
// :62     protocol/contracts/runtime 不得 import react/pixi（must remain headless）
// :65     pixi.js 出现在 peerDependencies 的包，不得同时在 dependencies
```

→ **结论**：
- **别想把渲染器放进 `packages/protocol` 或 `packages/runtime`**（`imports` 是精确相等断言，且必须 headless）。
- 现实落点只有两个：**`apps/web`**（`react-markdown` 的现居地，boundary 最松），或**新建一个 `packages/diagram` 之类的工作区包**（但 workspace 名必须以 `@pawoffice/` 开头，否则 `third-party-notices.mjs:64` 会报 `Unreviewed workspace`）。

### 4.6 有没有"禁止新增运行时依赖"的硬性规定

**没有硬性禁令，但有很强的书面偏好和两处显式"成绩单"**：

```text
docs/architecture/result-workspace.md:251
- 图表为手写 SVG（无新增依赖），Markdown 复用 `react-markdown + remark-gfm`。

docs/architecture/result-workspace.md:263-264
- **注册表插件化**：新原语作为独立包懒加载，核心 App 不必随每次扩展发版（如 `chart@2`）。
- **逃生通道**：极少数无法抽象的内容才用外链 artifact 或白名单域名 + sandbox 的 `embed`。
```

即：团队在成果工作台里**明确把"手写 SVG 而不是引图表库"当成设计决策记进了架构文档**。任何"为了画图引入一个新运行时依赖"的方案，都必须回答"为什么不能用 262-264 里已有的两条演进路径"。这是**评审门槛，不是 CI 门槛**。

其他相关文档约束（都不是硬门）：
- `docs/architecture/README.md:75-81`：依赖方向；`protocol` 只依赖 zod；Pixi 只作 peer；"所有包只通过显式 `exports` 公开 API"。
- 无 `AGENTS.md`、无 `CONTRIBUTING.md`、无 `.cursorrules`/`.mdc` 规则文件（实测 glob 为零）。

---

## 5. 第三方许可声明机制（决策关键，逐条 quote）

### 5.1 触发链：什么时候会被检查

```text
package.json:53   "prebuild": "… && npm run licenses:generate && …"
package.json:56   "pretest":  "… && npm run licenses:check && …"
package.json:46-47 "licenses:generate": "node scripts/third-party-notices.mjs"
                   "licenses:check":    "node scripts/third-party-notices.mjs --check"
Dockerfile:5      RUN npm ci && npm run build:full && npm prune --omit=dev
vercel.json:4-5   installCommand: npm ci / buildCommand: npm run build
```

- **`npm run build` 会先自动重写** `public/THIRD_PARTY_NOTICES.txt` + `public/LICENSE.txt`（`third-party-notices.mjs:104-115`）。
- **`npm test` 会先 `--check`**：生成结果与已提交文件不一致就直接 fail（`:113` `Outdated license notice: …; run npm run licenses:generate`）。
- 两者叠加的实际效果：**加依赖的人必须同时提交被重新生成的 `THIRD_PARTY_NOTICES.txt`，否则 test/CI 红。** `licenses/README.md:9` 把这个写成流程要求："Commit the generated notices alongside dependency changes."

### 5.2 硬校验 1：许可证必须在白名单里（这是最容易踩的）

```js
// scripts/third-party-notices.mjs:6-7
// Blue Oak 1.0.0 permits redistribution with its license text, included below.
const approvedLicenses = new Set(['MIT', 'ISC', 'BSD-3-Clause', 'PSF', 'BlueOak-1.0.0'])
// :76-77
const license = declaredLicense(pkg)
if (!approvedLicenses.has(license)) throw new Error(`Unreviewed license: ${pkg.name}@${pkg.version} (${license ?? 'unknown'})`)
```

- `declaredLicense()`（:23-28）只认 `pkg.license`（字符串或 `.type`）或 `pkg.licenses[0].type`——即 **package.json 里那个字符串必须逐字等于白名单元素**。
- **`MIT` 在白名单里 → 一个 MIT 的新 npm 依赖这一关直接过。**
- 但白名单是**精确字符串匹配**，所以这些都会 fail（仓库测试已经把这个行为钉死）：

```js
// tests/thirdPartyNotices.test.mjs:46-51
for (const license of ['GPL-3.0-only', undefined, '(MIT OR Apache-2.0)']) {
  …await assert.rejects(collectThirdPartyNotices(root), /Unreviewed license/)
}
```

  → **`(MIT OR Apache-2.0)` 这种复合表达式也算未审核**（哪怕它包含 MIT）。很多现代库就是这样声明的，`[推断]` 这是本项目接入新库最常见的真实卡点。
- 白名单本身改起来只是加一个字符串，但 `licenses/README.md:10` 明确要求"New license identifiers require review before being added to the approved list in the generator"——即**改白名单是一次需要评审的代码变更**，不是配置。

### 5.3 硬校验 2：必须能找到许可证正文文件

```js
// :30-32  在安装目录里按文件名找（大小写不敏感、允许扩展名）
const names = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)(?:$|[._-])/i.test(name)).sort()
// :50-52
if (!documents.length || documents.some(document => !document.text)) {
  throw new Error(`Missing license text: ${identity}; add a verified, version-specific license source`)
}
```

三条补充路径，**都写死在脚本里**（= 都要改代码）：

```js
// :18  只有这两个老包允许从 README 的 "License\n-------" 段兜底
const readmeLicenses = new Set(['heap@0.2.5', 'pathfinding@0.4.18'])
// :8-17 只有这些包允许用 licenses/*.txt 里人工核对过的正文（版本号写死在 key 里）
const supplementalLicenses = {
  'abstract-logging@2.0.1': { file: 'licenses/abstract-logging-2.0.1.txt', source: '…' },
  '@pixi/colord@2.9.6':    { file: 'licenses/pixi-colord-2.9.6.txt',    source: '…' },
}
```

- supplement 是**版本绑定**的，升级即失效（`:46` 用 `${name}@${version}` 查表；`tests/thirdPartyNotices.test.mjs:75-78` 专门测 `@pixi/colord@2.9.7` → `Missing license text`）。
- `files` 字段（npm 的发布白名单）如果排除了 LICENSE，也会命中这条错误。`[推断]` 这是"小而美"库的第二大常见卡点（LICENSE 在仓库根目录但没进 `files`）。

### 5.4 硬校验 3-5：位置、版本、workspace 命名

```js
// :58  lockfile 必须是 v3
if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error('A version 3 npm lockfile is required')
// :64  packages/*、apps/*、examples/* 里的 workspace 必须叫 @pawoffice/*；
//      非 private 的还必须 license === 'MIT'
if (!pkg.name?.startsWith('@pawoffice/') || pkg.version !== lock.packages[directory].version || !pkg.private && pkg.license !== 'MIT')
  throw new Error(`Unreviewed workspace: ${directory}`)
// :70  跳过 dev 依赖（见 §5.6）；:71 跳过 workspace 链接
if (!directory || entry.dev) continue
if (workspaces.has(directory) || entry.link && workspaces.has(entry.resolved)) continue
// :72  非 node_modules/ 下、或是 link，就拒绝
if (!directory.startsWith('node_modules/') || entry.link) throw new Error(`Unreviewed dependency location: ${directory}`)
// :75  安装版本与 lockfile 不一致 → 要求 npm ci
if (pkg.version !== entry.version) throw new Error(`Installed version differs from lockfile: ${pkg.name}; run npm ci`)
```

对 `entry.link` 这条要特别提醒（`[推断]`，依据是 `:71-72` + 本仓库 lockfile 实测：17 个 workspace link 的 `resolved` 都是 `packages/xxx` 或 `examples/xxx`）：

> **用 `"pele": "file:vendor/pele"` 这类本地目录依赖引入，会让 `licenses:generate` 直接抛 `Unreviewed dependency location: node_modules/pele`。** npm 对 `file:` 依赖建的是符号链接（`link:true`），而 `resolved` 指向 `vendor/pele`，不在 workspace 集合里 → 不满足 :71 的豁免 → 命中 :72。

也就是说，"把 Pele 的源码放到仓库某处再用 `file:` 引用"这条常见做法，**在当前脚本下是硬失败**。可行的替代只有两种：当成 workspace 包（必须叫 `@pawoffice/*`），或**直接内联进 `apps/web/src`（不产生 package.json 条目）**。

### 5.5 输出产物与"vendored/inlined"的归属问题（这是最容易漏的一条）

```js
// :104-107  只产出两个文件；正文只有一个来源：lockfile 的非 dev 包
const outputs = new Map([
  ['public/THIRD_PARTY_NOTICES.txt', text],
  ['public/LICENSE.txt', await readText(path.join(root, 'LICENSE'))],
])
```

清单正文完全由 `package-lock.json` 非 dev 条目驱动（:69 `Object.entries(lock.packages)`）。因此：

| 引入方式 | 自动进入 `THIRD_PARTY_NOTICES.txt`？ | 谁负责归属 |
| --- | --- | --- |
| npm 生产依赖（走 registry） | ✅ 自动，含全部 license/notice 文件正文（:32-36） | 脚本 |
| npm **devDependencies** | ❌ 不进入（:70 `if (entry.dev) continue`；测试 `:32,38` 明确断言 `!text.includes('dev-tool')`） | 仅当"分发这些工具/SDK/桌面应用"时才需重新审计（`licenses/README.md:11`） |
| **内联/改动过的源码拷进 `apps/web/src` 或 `packages/*`** | ❌ **完全不可见**（没有 lockfile 条目） | **纯人工**，没有任何机制兜底 |
| `file:` / 本地目录依赖 | ❌ 且会让脚本 **报错退出**（见 §5.4） | — |

内联场景在本仓库**已经有一个成文先例**，照着做即可：

```js
// scripts/assets/build-whiteboard-icons.mjs:8-10
const license = await readFile(new URL('../../node_modules/lucide-react/LICENSE', import.meta.url), 'utf8')
const notice = `/*!\n${license.trim()}\n*/\n// Generated from lucide-react. Regenerate: node scripts/assets/build-whiteboard-icons.mjs\n`
await writeFile(new URL('../../packages/scene-office/src/whiteboardIcons.ts', import.meta.url), `${notice}export const whiteboardIcons = ${…}`)
```

产物 `packages/scene-office/src/whiteboardIcons.ts:1-15` 里就是完整的 ISC 正文 + 生成脚本路径。**这就是"把第三方产物落到源码里"时本仓库承认的归属方式：完整 license 正文进文件头 banner，并写清再生成命令。**

### 5.6 一个 MIT npm 依赖到底要做什么（可直接照抄的清单）

假设 Pele 以**普通 npm 生产依赖**进入 `apps/web`（MIT、有 LICENSE 文件）：

1. `apps/web/package.json` 加依赖（版本精确或 `^`，与现有风格一致：`react-markdown` 用精确 `10.1.0`，`lucide-react` 用 `^1.48.0`）。
2. `npm install`，确认 `package-lock.json` 仍为 v3、且该包 `resolved` 是 registry 地址、**不是** `link`。
3. `npm run licenses:generate`（或直接 `npm run build`，`prebuild` 会跑）→ 自动往 `public/THIRD_PARTY_NOTICES.txt` 追加 `pele@x.y.z` / `Declared license: MIT` / `Source: pele/LICENSE` + 全文。
4. `git add public/THIRD_PARTY_NOTICES.txt`（**必须提交**，否则 `npm test` 的 `pretest` 阶段 `licenses:check` 直接红）。
5. 若该包 `license` 是复合表达式或缺 LICENSE 文件 → 需要**改 `scripts/third-party-notices.mjs`**（加白名单元素，或加 `supplementalLicenses` 条目 + 新建 `licenses/pele-x.y.z.txt` + 在 `licenses/README.md` 记录来源 URL）；这是评审项，`tests/thirdPartyNotices.test.mjs` 也要相应加/改。
6. 若内联进源码（不走 npm）→ 在文件头加 `/*! 完整 MIT 正文 */` + `// Vendored from … (commit/tag), unmodified` / 说明改动，并在 `licenses/README.md` 里记一段（参照其 :13-19 对 `@pixi/colord` / `lucide` / `pathfinding` 的写法）。**这一步没有 CI 检查，完全靠 review。**
7. `licenses/README.md:21-22` 的边界声明保持有效：清单只覆盖**软件依赖**，不覆盖美术素材、也不构成法律意见。

**成本量化**：清单文件当前 261 332 B / 199 个生产包；一个典型小库会带来 +1–20 KB 的部署文件增量（不影响 JS bundle）。人工成本按 §5.6 的 1–4 步约 0.5 人时；若命中 §5.2/§5.3 的例外，约 +2–4 人时（含改脚本 + 改测试 + 找上游许可正文并核对版本）。

---

## 6. 既有先例：这个仓库是怎么"加库"的

| 先例 | 引入形态 | 归属/许可处理 | 位置 |
| --- | --- | --- | --- |
| **pixi.js**（声明 `^8.18.1`，实际安装 8.22.0） | 视觉包的 **peerDependency**，宿主提供唯一实例 | 生产依赖 → 自动进清单 | `packages/scene-office/package.json` peerDeps；`docs/architecture/README.md:80`；`vite.config.ts:64` dedupe；`check-packages.mjs:65` 强制"peer 不得同时是 dep" |
| **lucide-react** | 双重形态：① 生产依赖（**26 个**组件文件 import）② **构建期内联 SVG** 到源码 | ① 自动进清单（含 Feather 归属，`tests/thirdPartyNotices.test.mjs:91-99` 断言 `Cole Bemis` 在正文里）② 文件头 `/*!` banner（`whiteboardIcons.ts:1-15`） | `package.json:66`、`apps/web/package.json:23`、`scripts/assets/build-whiteboard-icons.mjs` |
| **pathfinding** | 生产依赖，但**用 README 的 License 段当正文** | 特例写进脚本白名单 `readmeLicenses`（`:18`），且校验段落边界，上游改标题就 fail（`:39-44`） | `packages/runtime`（`architecture.test.mjs:47` 断言 runtime 只依赖 `pathfinding` + `zod`） |
| **@pixi/colord** | 上游 npm 包**漏发** LICENSE | `supplementalLicenses` + `licenses/pixi-colord-2.9.6.txt`（版本锁定，升级即失效） | `third-party-notices.mjs:13-16`；`licenses/README.md:13-16` |
| **react-markdown + remark-gfm** | 只在 `apps/web`，版本**精确锁定**（`10.1.0` / `4.0.1`） | 生产依赖，自动进清单 | `apps/web/package.json:27-28` |
| **@tanstack/react-virtual** | 只在 `apps/web`，精确锁定 `3.14.21` | 同上 | `apps/web/package.json:22` |
| **手写 SVG 图表（反面先例）** | **不引入依赖**，自己写 bar/line/pie | 无许可义务 | `ResultBlocks.tsx:212-343`；`docs/architecture/result-workspace.md:229,251` |

**先例给出的模式**（`[推断]`，但覆盖了全部 7 个样本）：

1. 新依赖优先**只装在 `apps/web`**（唯一的 React/DOM 层），不污染 `packages/*` 的 headless 边界。
2. 视觉/引擎类走 **peer + 宿主单例**，不需要单例的纯工具库走普通 dep。
3. 版本策略分裂：**新库用精确版本**（`react-markdown@10.1.0`、`@tanstack/react-virtual@3.14.21`），老库用 `^`（pixi、react、lucide）。`[推断]` 精确锁定是本仓库对"供应链/可复现"的默认态度，新引入的库应跟随精确版本。
4. **"能不引就不引"是有文档记账的偏好**（`result-workspace.md:251`），并且已经预留了"独立包懒加载"（:263）与"外链 artifact / sandbox embed"（:264）两条替代演进路径。
5. 内联第三方产物时，**文件头 `/*!` 全量 license + 生成脚本反查**是唯一成文惯例。

---

## 7. 可落地的接入点（按价值/成本排序）

| # | 接入面 | 具体落点 | 价值 | 工作量 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 1 | **聊天回复里的 `` ```mermaid ``** | 给 `ChatMarkdown.tsx:6-10` 的 `components` 加 `code`（判断 `className` 含 `language-mermaid`）→ 懒加载渲染器；仅在 `pending===false` 渲染 + 按源码缓存 | 高：AI 回复是最活跃的文本入口，用户/LLM 已在用围栏语法；零协议改动、零后端配合 | 低：1–2 人日（含缓存、错误兜底、`aria`、SSR 测试补 `tests/chatMarkdown.test.mjs`） | 中：流式期间逐 delta 重渲（`ChatSession.ts:210-214`）；虚拟列表行高跳动（`ChatTranscript.tsx:26-32,52`）；需保证"渲染失败回退源码"不白屏 |
| 2 | **白板 `detail` 里的 `` ```mermaid ``** | 同 1，改 `WhiteboardDetail.tsx:5-11` 的 `components.code` | 中高：`detail` 是后端唯一的长文本富内容位（≤16000 字符），`integration/docs/office-integration.md:912` 已把它定义成 Markdown | 低：0.5–1 人日（与 #1 共用渲染组件） | 中：`detail` 会顶掉任务板卡片（`WhiteboardBoardView.tsx:5`），视觉上等于"白板变成了文档"；墙上白板（Pixi `HTMLText`，`referenceOffice.ts:106-136`）**看不到图**，两处表现不一致 |
| 3 | **成果页 `diagram` 原语** | `office-ui.ts:185-187` 的 `resultBlockTypes` + `:286-290` 的 `resultBlockSchema` 加 `diagram`；`ResultBlocks.tsx:403-415` 注册渲染器 | 高（长期）：让**后端按 schema 传图**，自动出现在 `office.capabilities`（`office-integration.ts:118`），受 64 KiB 预算与 zod 严格校验约束，不依赖 LLM 是否守规矩 | 中：3–5 人日（协议 + 前端 + `z.toJSONSchema` 断言 + `tests/resultWorkspace.test.mjs` 扩充 + `dev/mock/result-preview.json` 示例 + 文档 `docs/architecture/result-workspace.md`） | 中高：**旧客户端会拒收整份快照**（`office-integration.md:888`）；需要能力降级或版本门（`result-workspace.md:262` 已把"能力协商"列为待办，说明现在还没有）；新增原语没有前向兼容承诺 |
| 4 | 聊天/白板 `detail` 的**围栏 → 图片文件**（后端预渲染 PNG/SVG 走 `result.image`/`gallery`） | 用现有 `image` 原语（`office-ui.ts:266-271`）+ 上传到 https 域名 | 中：零前端改动，可先验证需求是否存在 | 极低：0 人日前端 | 低-中：只接受 http(s)；引入外部图床/存储与隐私/可用性依赖；无交互、无深浅色适配 |
| 5 | 墙上白板 / 显示器里显示图 | 需 `Texture.from(svgDataURL)` 或改 DOM 覆盖层 | 低-中：视觉冲击大但需求未验证 | 高：5+ 人日（`HTMLText` 不支持 `svg`，要么做纹理管线要么重构该 prop 的渲染方式） | 高：破坏"后端文本 → 本地固定模板"的现有分层；纹理缓存/缩放/分辨率问题；完全没有既有先例可抄 |
| 6 | 让后端/LLM 直接传 **SVG 字符串** | 新增 `result` 原语或 `detail` 原生 HTML | 负价值 | 低 | **极高，不建议**：引入无 sanitizer、无 CSP 的远端 SVG 执行面（§4.4） |

**推荐次序**：#1 → #2（共用同一渲染组件与缓存策略）→ 视需求再评估 #3。若只想做一次最小验证，#1 单独就能覆盖"LLM 画图"这个最高频场景，且完全不动协议、不动后端、不动许可清单的既有结构（但仍然要为**新依赖**做 §5.6 的事）。

---

## 8. 未核实 / 需要别人补的部分

- **Pele 自身的 API 形状**（是返回字符串还是 DOM 节点、有没有 UMD/ESM 双产物、包体积、是否能在 SSR/`node --test` 的 jsdom 环境里跑）——由 profile Pele 的 teammate 负责。这些直接决定 §7 #1 的"工作量:低"是否成立：如果只能拿到 SVG 字符串，就要额外决定"用 `dangerouslySetInnerHTML` 还是转 React 元素"（§4.4）。
- **`tests/*.test.mjs` 的 SSR 渲染环境能否承载 Mermaid 渲染器**：现有测试用 `renderToStaticMarkup`（`tests/chatMarkdown.test.mjs:14`），同步、无 DOM。一个同步渲染器（Pele 声称 synchronous）理论上可以，但 `[推断]` 仍需实测；若渲染器依赖 `document`，则测试需降级为"只断言围栏被识别"。
- **`licenses:check` 与新增依赖的 CI 落地顺序**：本文只证明本地 `npm run licenses:check` 当前通过（199 包）。仓库里没找到 CI workflow 文件（`.github/` 未在本机快照中出现），所以"CI 是否会跑 pretest"是 `[推断]`；但 `package.json:56` 的 `pretest` 已足以让任何 `npm test` 失败。
- **§1.5 所说的"任务流/依赖图"是否有真实业务需求**：本文只证明"形态空缺 + 协议里已有可图的语义数据"，不能证明用户要它。
