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