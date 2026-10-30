# 成果展示与内容渲染

正式办公室工具栏的“当前成果”打开共享成果阅读器。聊天消息上的交付条打开对应轮次的历史快照。早期独立测试页面及专用 mock 已移除。

## 页面职责

| 区域 | 内容 |
| --- | --- |
| 概览 | 当前结论、任务目标、指标、任务摘要、分析与来源、文件变化摘要 |
| 交付物 | 当前有效产物及文件变更；产物提供版本、预览、下载入口 |
| 过程记录 | 任务详情、分工、验收依据、检查、风险和决策 |
| 文件预览 | 指定版本的正文、结构化报告及与当前采用版本的比较 |

当前成果由业务后端提供有效集合；未修改的文件继续存在，移除的文件退出当前集合。页面没有全局历史轮次切换器。旧消息打开当时交付，文件版本菜单提供就近历史入口。

任务执行状态与成果状态分别呈现。任务完成不自动表示验证通过；检查引用旧版本时显示待重新验证。时间取自后端，按查看者时区格式化到秒。

## 协议与内容归属

业务后端通过 `offices.initialize`、`office.snapshot` 提供结构化数据。协议 Schema 校验数据，前端决定布局，不执行后端 HTML、CSS 或组件代码。

成果位于 `conversations[].whiteboard.result`，支持摘要、指标、产物、检查、任务、风险、决策和语义区块。区块可以使用预设类型，也可以组合文本、键值、统计、表格、列表、进度、图表、图片、Mermaid、提示及分隔线。

区块的可选 `purpose` 控制归属：

- `analysis`：概览中的分析与结论。
- `evidence`：过程记录中的验证依据。
- `artifact-preview`：特定文件版本的内容预览，必须提供有效的 `artifactId` 和 `versionId`。
- 未分类旧区块：概览中的“补充内容”。

`changes` 固定进入交付物；`tests` 的检查与根检查合并去重，仅在过程记录展示一次。来源通过精确 ID 和版本关联，不根据标题猜测。完整约束及示例见[用途与归属](../../integration/docs/result-section-routing.md)。

## 预览与历史边界

支持 Markdown、图片、代码、CSV/TSV 和 JSON。代码提供高亮、复制、折叠和换行；CSV提供搜索、分页、表头与分隔符选项；JSON提供按源文保留精度的树状视图和源文切换。

读取文件有超时和大小限制，复杂渲染另有内容与节点数量上限。失败显示明确原因，不自动换用其他版本。格式与限制见[版本协议](./result-deliveries.md)。

业务后端保存不可变版本，PawOffice只缓存快照并提供展示。历史交付记录的元数据、结果、任务状态及详情不可在原交付 ID 下改写；更新需要新交付 ID。产物正文更新需要新的 `versionId`。外部文件可附带 SHA-256 校验；接收缓存不能替代版本存储。

没有提供任务详情时，过程记录不生成墙面缩略白板或空白回退组件。

## 主要实现

| 文件 | 责任 |
| --- | --- |
| `packages/protocol/src/office-ui.ts` | 成果、区块、交付与版本 Schema |
| `apps/web/src/components/ResultWorkspace.tsx` | 正式阅读器的三个内容区域 |
| `apps/web/src/components/ResultBlocks.tsx` | 通用内容块 |
| `apps/web/src/results/sections.ts` | 用途路由及精确版本关联 |
| `apps/web/src/components/ResultDeliveryShell.tsx` | 历史交付、文件版本目录与预览调度 |
| `apps/web/src/components/ResultArtifactPreview.tsx` | 指定版本预览与比较 |
| `server/src/officeState.ts` | 接收缓存及历史冲突保护 |

## 验证与手动演示

保持 `npm run dev` 和 `npm run integration-ui-example`，另开 PowerShell 7：

```powershell
pwsh -NoProfile -File .\integration\clients\start-workflow-mock.ps1 -Mode showcase
```

完整五轮电商场景及逐轮模式见[页面评审](../../integration/docs/ecommerce-visual-review.md)。演示复用六位办公室成员及人物绑定。

自动验证见[测试目录](../../tests/README.md)。本次保留正式页面与通用组件回归，不依赖独立测试页。
