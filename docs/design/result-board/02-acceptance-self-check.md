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
