# 06 截图索引（最终版，以最终 manifest 为准）

> 截图目录：`docs/design/result-board/screenshots/`（由 `fixtures-harness` 产出，本任务不写入该目录）。
> 元数据来源：`screenshots/manifest.json`，`generatedAt`（以 manifest 为准，2026-11-11 最终重截），`branch = feat/result-board-design`，
> `consoleErrors: []`，`fixtureSmoke` 15 项全部 `ok: true`（sample/history/matrix/layouts/limits + 10 展示态）。
> 数据来源两类：**用户真实样例**（handoff `sample/*.json` 逐字节复制）与**前端 fixture**（dev-only，非真实业务数据）。
>
> 说明：本代理无法读取图片（模型不支持图像输入），下表核对**文件存在、尺寸/视口、manifest 数据来源与验收项映射**；
> 视觉评分与“看起来是否达标”由审核方按规范 §16 判定。所有截图均为最终重截版（含 A12 修复、changes 全部行、指标语义、以及本轮“报告式组合”重构：文件带 70px 行 / 无边框指标带 / 通过项降级 / 记录三栏 / 文档索引单行）。

## 1. 规范 §15.3 要求的 7 张（全部产出）

| # | 截图 | 路径 | 尺寸/视口 | 数据来源 | 证明的验收项 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | PawOffice 首页（证明未改） | `screenshots/01-home-1787x864.png` | 1787×864 | PawOffice 首页（未改动） | A02、A28：2D 场景/顶部统计/左右侧栏/聊天区/入口不变 | 已产出 |
| S2 | 成果详情首屏 | `screenshots/02-result-first-screen-1787x864.png` | 1787×864（manifest 记录阅读器 1120×824） | 真实样例 `result-ready-round3.json`（`fixture=sample`，state ready） | A03、A05、A06、A08、A24、A28：无 Tab、title+summary 最醒目、ready 不显示已验证、首屏可见 `需要关注 3 项` 与首个交付 | 已产出 |
| S3 | 成果详情完整长图 | `screenshots/03-result-full.png` | 1787×864 视口，完整长图 1121×2220（正文约 2156px） | 真实样例 `result-ready-round3.json` | A09、A10、A11、A13、A18、A25：changes→documents 顺序、metrics 数字、风险/任务/版本、免责声明 | 已产出 |
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

## 4. 类型矩阵/极限状态截图

| 项目 | 现状 | 说明 |
| --- | --- | --- |
| 6 metric / 8 section / 12 block（`?fixture=matrix`） | 已通过 `fixtureSmoke` 渲染冒烟，未单独截图 | 测试覆盖见 `tests/resultBoard.test.mjs`；如需类型矩阵图可直接打开 dev 预览页截取 |
| 四种 layout（`?fixture=layouts`） | `fixtureSmoke` ok，未单独截图 | 同上 |
| 极限数量（`?fixture=limits`） | `fixtureSmoke` ok，未单独截图 | 同上 |
| 10 展示态（`?state=*`） | `fixtureSmoke` 全部 ok，未单独截图 | 同上 |

## 5. 截图未覆盖的交互（需人工/录屏补充）

`<dialog>` 打开/关闭、Escape、焦点恢复、diff 悬停/固定、剪贴板复制、Blob 下载、文件版本下拉切换等，
无法由静态截图完整证明。代码路径保留（`WhiteboardReader`/`ResultDeliveryShell`/`ResultArtifactPreview`/
`ResultChanges` 均未改变打开/关闭/复制/下载机制）；A27 的键盘/焦点/对比度由 Lead 的 Playwright 实测补充，
本索引不重复声称。
