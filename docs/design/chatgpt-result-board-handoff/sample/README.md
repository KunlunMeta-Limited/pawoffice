# 后端演示脚本产出的成果 JSON

这些 JSON 不是手写的样例，是仓库里的后端演示脚本 `integration/clients/send-result-demo.ps1` 在 `-DryRun` 模式下打印的**真实请求体**——即业务后端通过 `offices.initialize` 推给前端的完整快照。字段与线上完全一致，可用于让 ChatGPT 基于真实数据设计渲染。

## 复现命令

```bash
pwsh -NoProfile -File integration/clients/send-result-demo.ps1 -DryRun -ResultStatus ready    -Round 3
pwsh -NoProfile -File integration/clients/send-result-demo.ps1 -DryRun -ResultStatus verified -Round 3
pwsh -NoProfile -File integration/clients/send-result-demo.ps1 -DryRun -ResultStatus rejected -Round 3
pwsh -NoProfile -File integration/clients/send-result-demo.ps1 -DryRun -ResultStatus draft    -Round 1
```

## 文件说明

每个状态有两份：`result-*` 只含成果本身（建议优先上传），`whiteboard-*` 是完整任务白板（含任务状态、阶段进度、任务详情、历史交付）。

| 文件 | 内容 | 适合用来看什么 |
| --- | --- | --- |
| `result-ready-round3.json` | 成果 `status=ready`，任务 `running`，3 个交付文件、4 项检查（1 项待补充）、1 条风险、2 个任务、2 条版本 | **主样例**：最常见的"已交付待验收" |
| `result-verified-round3.json` | 同上但 `status=verified`，任务 `completed`，检查全通过、无风险 | 全绿状态 |
| `result-rejected-round3.json` | `status=rejected`，任务 `blocked`，检查项失败 | 失败/受阻状态 |
| `result-draft-round1.json` | `status=draft`，**没有任何交付物、指标、检查、风险**，只有 2 个任务和 1 条下一步 | **空态**：验证页面在数据稀薄时是否还成立 |
| `whiteboard-*.json` | 外层白板：`status`、`summary`、`description`、`steps`（3 步）、`detailSections`（3 个）、`deliveries`（历史交付 1–3 条）、`result` | 历史交付切换、任务详情、阶段进度 |

## 数据结构要点

- 顶层是白板对象，成果在 `whiteboard.result` 里；页面同时用到白板层（任务状态、阶段进度、任务详情）和成果层。
- `result.status` 四态：`draft` / `ready` / `verified` / `rejected`（**成果**状态）。
- `whiteboard.status` 五态：`queued` / `running` / `blocked` / `completed` / `failed`（**任务**状态）。
- 两者不同步：`ready` 可以配 `running`，`verified` 才配 `completed`。"任务完成"不等于"成果已验证"。
- `artifacts[]` 是交付文件，带 `content`（Markdown 正文）、`versionId`、`sha256`、`mimeType`；内容的展示方式由前端决定。
- `sections[]` 是结构化区块，本样例里有 `changes`（文件变更）和 `documents`（交付文档）；schema 还支持 gallery / tests / api / environments / files / custom 共 8 种 kind。
- `deliveries[]` 是历史交付，体积可能很大，通常只带引用（`snapshotUrl`），前端按需拉取。
- 所有字段都可能为空或缺失：`draft-round1` 就是典型例子。

## 建议怎么发给 ChatGPT

1. 上传 `result-ready-round3.json`（8KB），必要时加 `result-draft-round1.json`（753 字节）作对比。
2. 可再附 1 张现状截图：`../screenshots/current/ecommerce-overview-rich.png`。
3. 配合下面这段提示词：

```text
附件是后端演示脚本真实推送的成果 JSON（不是手写样例），以及一张当前页面的截图。
请基于这份真实数据设计前端渲染方案。

要求：
1. 先通读 JSON，列出你能拿到的全部信息，并指出哪些字段在实际数据里重复、哪些为空；
2. 给出成果展示页的信息架构：从上到下每一块回答用户什么问题；
3. 每一块内容都标注它来自哪个字段（表格：区块 → 字段名）；
4. 只允许使用 JSON 里已有的字段，不允许假设新增字段，也不允许修改数据结构；
5. 如果数据不足以支撑某个设计，明确写出"缺哪个字段"，不要自己补；
6. 对比 result-draft-round1.json：页面在这个近乎空的数据下应该显示什么？
7. 最后说明：为了这个设计，你被迫放弃了哪些信息，为什么可以放弃。

先只给信息架构和首屏，不要写代码，不要给组件实现。
```

## 备注

- 数据里的时间是演示用的固定日期（2026-10-28）；`verdict` / `summary` 里带"模拟数据"前缀，是脚本自带文案。
- `sha256`、`mimeType`、`versionId` 这类字段前端可以用来做下载校验和版本选择，但不需要展示给用户。
