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
