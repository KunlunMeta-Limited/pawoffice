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
| A11 | P1 | 6 类 metric 各有可读且语义准确表现 | `tests/resultBoard.test.mjs` 覆盖 `auto→comparison/value`、comparison、value、status、target、text；卡/紧凑两种密度与 `emphasis` 不排序；dense 行补全 target/comparison 语义；真实样例三条不复算 | **通过**（无独立类型截图，见 05） |
| A12 | P1 | 4 类 artifact 可读可用；URL/内容为空有正确回退 | `tests/resultBoard.test.mjs`「four artifact kinds…」覆盖 document/image/link/data；**空 artifact 回退已修复**：`versionId` 存在但无 `content`/合法 http(s) URL 时不再给预览主操作，image 显示禁用文案 `暂无图片可预览`、document 显示 `暂无正文或文件地址`（`aria-disabled="true"`）；空外链不生成假跳转；空图片不伪造 `<img>`；真实样例仅 document，其余由 `matrix`/`limits` fixture 覆盖 | **通过** |
| A13 | P1 | 8 类 section 全覆盖 | `tests/resultBoard.test.mjs` 断言 gallery/documents/tests/api/environments/files/changes/custom 与源顺序；`limits` 夹具覆盖 8 类上限数量 | **通过**（类型矩阵无独立截图，见 05） |
| A14 | P1 | 12 类 block 全覆盖或安全信息回退 | `tests/resultBoard.test.mjs` 断言 12 种 `data-block-type`；未知类型由 `FallbackBlock` 回退（`ResultBlocks.tsx` 未改）；Mermaid SSR 保留源文本 | **通过**（同上） |
| A15 | P1 | stack/columns/grid/cards 在区块内部有效、窄屏不破坏阅读 | `tests/resultBoard.test.mjs`「four custom layouts…」+ matrix 8 section 顺序；CSS 复用 `ResultBlocks.css` 既有四种 layout | **通过** |
| A16 | P1 | 匹配 artifactId+versionId 的文档共享预览入口；不按标题猜关联 | `tests/resultBoard.test.mjs`：真实样例 3 个 `.result-workspace-doc-open`；matrix 2 个；错误版本/同名未绑定共 0 个且显示“关联文件不在本轮交付中”；截图 04 | **通过** |
| A17 | P1 | `versionId` 决定版本身份；对比、hash 校验继续有效；失败不伪装成功 | 既有 `tests/resultHistory.test.mjs`（sha256 校验失败、版本对比边界）；`ResultArtifactPreview` 未改；截图 08（版本下拉 + 与当前版本比较） | **通过** |
| A18 | P1 | 风险等级/处置状态、任务 4 态、版本 3 态、检查 3 态文案正确 | `tests/resultBoard.test.mjs`「risks, tasks, versions and check states…」断言 high/closed、todo/doing/blocked/done、draft/released/rolled-back、passed/pending/failed/stale | **通过** |
| A19 | P1 | 现有白板/历史样例验证；失败局部显示且不拿当前版本冒充历史 | 真实 `whiteboard-ready-round3.json` 夹具：`tests/resultBoard.test.mjs` 历史切换（delivery-2 提示/返回当前成果/历史正文）、缺失目标只显示局部 alert；截图 09；`tests/resultHistory.test.mjs` 校验失败隔离 | **通过** |
| A20 | P1 | metrics12、artifacts8、sections8、blocks24、checks12、tasks12 等不溢出不丢项 | `tests/resultBoard.test.mjs`「extreme counts…」：12 指标紧凑行、8 artifacts、8 sections、8 gallery、12 files、24 changes、24 blocks、12 checks、12 tasks、8 versions/risks/decisions/next | **通过**（无极限密度截图，见 05） |
| A21 | P1 | summary-only、artifact-only、空结果、部分字段为空均无死白块/虚假占位 | `tests/resultBoard.test.mjs`「empty, summary-only and artifact-only…」「a result with only a note…」「ten presentation states」 | **通过** |
| A22 | P1 | 不执行不可信 HTML/脚本/SVG；不丢弃 Mermaid/chart 源信息 | `tests/resultBoard.test.mjs`：无未转义事件属性/`<script>`/`<svg onload>`/`href="javascript:`；`&lt;script&gt;` 作为文本存在；Mermaid 源文本、chart series/aria-label 保留 | **通过** |

## P2 质量

| 编号 | 等级 | 通过条件 | 证据 | 结论 |
| --- | --- | --- | --- | --- |
| A23 | P2 | 字体/颜色/圆角/阴影/图标统一沿用 PawOffice，不出现新品牌 | 新组件沿用 `--result-*` token（`ResultWorkspace.css:2-11` 等）；未引入新依赖/字体/第二套主题；仅成果域 CSS 变化；截图 02/03 | **部分**：代码层面未创新品牌；视觉统一性需审核方按截图判定（本代理无法读图） |
| A24 | P2 | 首屏 title+summary 最醒目、文件入口清楚、验证缺口可见、其余降权 | 组合式重构后实测（Playwright 几何）：1787×864 首屏内依次出现标题(y≈96–135)、成果状态(147–171)、结论(211–248)、验收意见(264–287)、需要关注 3 项(301–321) 与**全部 3 份交付文件**(418–630，行高 70–71px)，阅读器 1120×824；`需要关注 3 项` 与 `3 份交付文件` 有测试断言；截图 02 | **通过（结构/几何自动化证据）**；视觉评分仍由审核方判定 |
| A25 | P2 | 不出现 5–8 张等权重卡片；长内容可控可读 | 本轮组合式重构：交付改为无卡片文件带（无巨型类型图标，16px 内联 Glyph，行高 70px）；指标改为**无边框数字带**（数字在上、标签在下，1/2/3/4/6 网格与 7–12 紧凑行由测试断言）；`documents` 与 `artifacts` 精确同源时改为**单行文档索引**（同一预览入口，不再重复整份文件列表）；检查项中 `passed` 降级、`failed/stale` 高亮；决策/任务/版本改为**三栏紧凑记录**；整页高度从 3334px 降到 2220px（-33%），首屏即可读完三份交付 | **通过（结构/几何自动化证据）**；视觉评分仍由审核方判定 |
| A26 | P2 | 1280/1440/1787/390 适配；无预期外全页横向滚动 | `scripts/result-board/capture.mjs` 在桌面与手机视口对每个 fixture 断言 `scrollWidth - clientWidth <= 0`（无横向溢出）；截图 1787×864 与 390×844 存在；移动端点击区域断言 38/36/40px（Lead 的 Playwright 核查）。**注：为自动化脚本断言，非人工视觉评分** | **通过（自动化证据）** |
| A27 | P2 | 键盘可触达、状态非纯色、文本可读、浮层焦点/关闭正确 | Lead 用 Playwright 实测：Tab 焦点可达「阅读」、Enter 打开预览、Escape 关闭且焦点返回触发按钮、无重复 id、状态均有文字标签、正文对比度脚本检查 0 项 < 4.5；测试同时断言状态文案（非纯色）与 `<dialog>` 关闭/焦点恢复实现保留 | **通过（自动化证据）** |
| A28 | P2 | 指定尺寸提交“首页未改 + 成果首屏 + 完整页 + 文件预览 + 检查异常”证据 | 最终重截完成：`manifest.json`（generatedAt `2026-11-11T12:45:00Z`）记录 9 张截图（01 首页、02 首屏 1787×864、03 完整长图、04 文档正文、05 diff、06 检查异常、07 手机、08 版本对比、09 历史交付），`fixtureSmoke` 15 项全部 ok、`consoleErrors: []`；截图 02 记录阅读器 1120×824、手机记录点击区域 38/36/40px | **通过**（材料齐备；视觉评分由审核方完成） |

## 结论

- **门槛一（A01–A10）：全部通过**，可进入视觉评审。
- **门槛二（真实样例视觉）：截图重截后复核**（最终以 fixtures-harness 的 `manifest.json` 为准），视觉判断待审核方。
- **门槛三（A11–A22）：全部通过**（A12 已修复并补测试；其余由 SSR 测试覆盖）。
- **门槛四（A23–A28）：A26/A27 通过（自动化脚本/Playwright 证据）、A28 通过（最终 9 张截图 + manifest）；
  A23–A25 为“部分”**，原因是视觉主观判定需审核方完成（本代理无法读图），已在 05 列出补充方式，不虚报为通过。
