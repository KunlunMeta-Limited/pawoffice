# 当前成果、历史交付与版本预览

2026-10-28。沿用现有办公室、会话、完整快照与 SSE 通道，不改变项目运行方式。

## 数据职责

- 业务后端保存真实文件版本、交付记录、访问权限和可读取的版本 URL。存储位置由业务后端决定，不要求写入项目工作区。
- PawOffice 负责协议校验、当前成果、历史切换、指定版本预览、下载及文本比较。接收服务仅缓存最新办公室快照，不提供版本仓库。
- `whiteboard.result` 是后端提供的**当前有效产物汇总**。更新一个文档后，未修改且仍有效的文档继续出现在此处；删除的产物应从此列表移除。前端不从历史自动合并或恢复产物。
- `whiteboard.deliveries` 是不可变交付目录。每条记录的 `result` 表达该次交付内容，可以只包含本次新增、修改的文件。一次交互没有文件时，可以只记录总结，不创建空文件。
- 交付不等同于一条聊天消息。当前协议尚未关联聊天 `turnId`，也未提供完整的 Agent 执行实体。

## 两层标识

产物 `id` 跨版本保持稳定；`versionId` 标识不可变正文。文件更新必须生成新的 `versionId`。显示名 `version` 仅供阅读，不能替代版本标识。

```json
{
  "id": "prd",
  "title": "登录模块需求说明",
  "versionId": "prd-v2",
  "version": "v2.0",
  "runId": "delivery-3",
  "producedAt": "2026-10-28T12:00:00+08:00",
  "mimeType": "text/markdown",
  "url": "https://business.example/artifacts/prd/versions/prd-v2/content"
}
```

`runId` 在本次协议中指向来源交付记录；历史记录的 `result.runId` 如填写，须等于该条记录的 `id`。这不是任务调度或完整 Run 状态模型。若以后需要一次 Run 多次交付，应另行扩展执行关联，不能凭消息顺序推断。

短文本可使用 `content`（最多 8000 字符）；版本文件可使用 `url`。同时提供时优先使用非空 `content`。`sha256` 可选，为正文 UTF-8 字节或下载文件原始字节的小写 64 位哈希。提供后，预览和该版本下载都先校验；不匹配时停止展示。

历史记录中的每个 artifact 必须有 `versionId`。旧数据未填写版本字段时仍可使用原有正文展示，但不会自动获得历史版本能力。

## 历史交付

完整快照中最多携带 20 条目录记录；每条使用内联 `result` 或 `snapshotUrl`，两者只能选一项。

```json
{
  "id": "delivery-2",
  "sequence": 2,
  "title": "第 2 轮 · 首次文档交付",
  "createdAt": "2026-10-28T11:00:00+08:00",
  "result": {
    "runId": "delivery-2",
    "status": "ready",
    "artifacts": [{
      "id": "prd", "title": "登录模块需求说明",
      "versionId": "prd-v1", "version": "v1.0",
      "mimeType": "text/markdown", "content": "# 第一版需求\n"
    }]
  }
}
```

记录可另带 `board` 保存该次任务状态、步骤和结构化详情。未提供时，历史界面使用最小提示，不借用当前轮次的任务详情。

较大的历史记录使用外部 JSON：

```json
{
  "id": "delivery-2", "sequence": 2,
  "title": "第 2 轮 · 首次文档交付",
  "createdAt": "2026-10-28T11:00:00+08:00",
  "snapshotUrl": "https://business.example/deliveries/delivery-2.json"
}
```

该 URL 必须返回上一示例那样**包含 result 的单条交付对象**，不是整个办公室快照，也不能再跳转到另一条 JSON 引用。返回记录的 `id`、`sequence` 必须与请求一致，正文继续经过同一 Schema 校验。每份外部 JSON 限 64 KiB。目录本身仍受最多 20 条限制，目前没有历史目录分页接口。

## 预览行为与边界

- 默认“当前成果”展示最新有效集合。交付下拉框选择某次历史后，显示该次交付及当时版本。
- 阅读历史或文档时收到更高 `seq`，保留正在阅读的版本；有新版本时显示提示，用户主动切换。
- 支持 Markdown、纯文本/代码/JSON 源文和图片。代码暂无语法高亮，JSON 暂无树形查看；PDF、Office、表格、音视频目前提供原始文件入口，不承诺内嵌预览。
- 比较选定文本版本与当前最新版本，显示红绿增删行；不是任意两个版本的比较。比较有长度、计算量和显示行数上限，超限会提示，不冻结页面。
- 资源读取超时 15 秒，文件预览最大 8 MiB，文本最多预览 200000 字符。超过限制时使用原始文件入口。下载该版本使用已读且校验过的字节；原始文件外链由业务后端负责一致性。
- 历史缺失、地址不可读、权限/CORS 错误、版本哈希不符或交付错位会明确报错；不会回退到当前工作文件或另一轮内容。
- URL 必须是完整 HTTP(S) 地址。浏览器仅附带同源凭据，不发送 PawOffice 的业务 API 密钥到文件服务。跨域服务需允许前端读取，或提供签名 URL/同源下载代理。当前没有签名 URL 自动续期协议。
- 不执行后端 HTML；Markdown 忽略原始 HTML。图片通过浏览器图片元素预览，其他文本按文本显示，不将文件注入页面执行。

## 验证与执行分开

任务状态由 `board.status` 提供；成果状态由 `result.status` 提供，完成任务不自动意味着验收通过。检查项可以绑定：

```json
{ "id": "scope-review", "label": "需求范围检查", "status": "passed", "artifactId": "prd", "versionId": "prd-v1" }
```

当前产物更新为 `prd-v2` 后，此检查显示为待补充并说明需重新验证；界面和 Markdown 报告使用相同规则。原始快照保留后端原值，JSON 导出用于还原输入，不改写证据。业务后端仍须正确维护整体成果状态和检查对象；未绑定版本的旧检查无法由前端判断是否失效。

时间取自后端的 `producedAt`、`updatedAt`、`createdAt`，浏览器仅按查看者时区格式化到秒；不会用浏览器当前时间补造产出时间。

## 不可变性的实际保证

Schema 检查同一快照内同 `(id, versionId)` 的正文、MIME、哈希及无哈希时的 URL 一致性。接收服务还对缓存前后快照作冲突检查；覆盖已知版本正文或已交付的内联结果会返回 `409 RESULT_HISTORY_CONFLICT`。

这些检查不是持久化版本仓库，也不能替业务后端保证外部 URL 永远返回旧文件。服务端重启会清空缓存，后端需要重新初始化并提供历史目录；被裁剪出缓存的数据仍由后端保管。要求强内容校验时应填写 `sha256`。当前内联历史结果整体被冻结，更新其签名 URL 的流程仍需扩展；外部历史记录更适合长期文件服务。

## 联调

原有两个终端命令保持不变：

```powershell
npm run dev
npm run integration-ui-example
```

协议或服务端代码升级后，按原命令重启，让服务加载新 Schema。打开 Vite 日志地址的 `/office/`，在另一终端依次发送：

```powershell
pwsh -NoProfile -File .\integration\clients\send-result-demo.ps1 -Round 1
pwsh -NoProfile -File .\integration\clients\send-result-demo.ps1 -Round 2
pwsh -NoProfile -File .\integration\clients\send-result-demo.ps1 -Round 3
```

选择“成果联调办公室”→“登录模块交付演示”→“当前成果”。第一轮没有文件；第二轮交付需求 v1 与接口文档；第三轮更新需求至 v2、增加报告，保留未改的接口文档。默认不传 `-Round` 时发送第三轮。样例内容内联于 `integration/fixtures/result-deliveries.json`，不代表项目已经实现磁盘版控。

开发预览：`/?result-preview=1&case=multi-round`。自动浏览器回归：`node tests/browser/resultHistory.mjs --channel=msedge`，使用独立临时服务及文件端点，不占用已有服务。
