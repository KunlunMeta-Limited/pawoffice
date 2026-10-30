# 外部系统对接

本目录集中存放外部业务后端接入 PawOffice 所需的协议说明和可运行客户端。正式前端应用位于 `apps/web/`，独立示例位于 `examples/`，服务端实现位于 `server/`，公共 Schema 位于 `packages/protocol/`。

后端组织成果数据时，请按[成果内容用途与归属](./docs/result-section-routing.md)区分分析、验证依据与文件预览；旧数据继续兼容。

想评审正式成果页面，先看[电商完整页面评审](./docs/ecommerce-visual-review.md)：支持一键载入完整状态，以及从空聊天逐轮推进；包括任务目标、分工、图表、素材、风险和文件版本。

## 目录

```text
integration/
  README.md
  clients/
    client.mjs                 初始化、任务更新和用户确认示例
    ui-client.mjs              领取用户操作并返回展示结果
    send-result-demo.ps1       PowerShell 7 三轮交付与固定版本演示
  fixtures/
    result-deliveries.json     当前成果、历史交付及文档版本数据
  docs/
    office-integration.md      HTTP 接入协议与完整流程图
    dashboard-integration.md   业务快照和白板字段
    chat-integration.md        可选聊天流式接口
    message-relay.md           部署、连接配置和职责边界
```

## 阅读顺序

1. [HTTP 接入协议与流程图](./docs/office-integration.md)：了解从空状态创建办公室、初始化、数据更新、用户操作、决策菜单和动画指令。
2. [业务快照字段](./docs/dashboard-integration.md)：准备办公室、成员、任务和固定格式白板数据。
3. [部署与连接配置](./docs/message-relay.md)：启动 PawOffice、设置服务地址和密钥。
4. [聊天流式接口](./docs/chat-integration.md)：需要接入聊天生成服务时阅读。

## 运行示例

默认电商案例的完整 prompt、助手回复、Markdown/CSV 产物及操作步骤见[电商全流程演示](./docs/ecommerce-workflow.md)。启动 `pwsh -NoProfile -File .\integration\clients\start-workflow-mock.ps1 -Scenario ecommerce` 后，从新办公室的空聊天逐轮发送五个已准备好的 prompt。

从空聊天开始的完整成果工作流（确认目标、首次交付、更新、回滚、移除和重新验收）：保持下面两个服务运行，另执行 `pwsh -NoProfile -File .\integration\clients\start-workflow-mock.ps1`。操作步骤及聊天地址注册范围见[全流程联调](../docs/architecture/workflow-mock.md)。

在项目根目录安装依赖并启动服务器模式：

```sh
npm install
npm run dev
```

打开启动日志中 Vite 地址的 `/office/` 页面。没有办公室时，页面显示「新建办公室」引导。在另一个终端启动用户操作处理示例：

```sh
npm run integration-ui-example
```

在页面点击「新建办公室」，填写名称并提交。客户端通过 `ui.next` 收到 `office.create`，返回 `target: "office"` 快照后，页面进入新办公室。此示例只创建内存数据；OpenPaw 等外部主机须将该处理替换为真实工作空间创建。字段、成功和失败响应见[从空状态创建办公室](./docs/office-integration.md#从空状态创建办公室)。

也可以由后端主动初始化已有办公室。下面的示例会初始化办公室、更新任务并等待用户确认：

```sh
npm run integration-example
```

`integration-ui-example` 可以在初始化之前启动，并继续处理页面中的人物点击、任务操作和详情选项。

这两个客户端模拟外部业务后端，不是 PawOffice 服务端。默认服务地址为 `http://127.0.0.1:8765`，默认密钥为公开演示值 `pawoffice-demo-key`。连接其他服务时，通过进程环境变量配置：

```sh
PAWOFFICE_URL=http://127.0.0.1:3000 PAWOFFICE_API_KEY=your-private-key npm run integration-example
```

纯静态演示 `npm run dev:vite` 不接收外部业务请求。公网部署应配置私有密钥及页面访问控制。

## 实现与验收

多轮成果联调沿用上述两个服务，另运行 `pwsh -NoProfile -File .\integration\clients\send-result-demo.ps1 -Round 3`，选择“成果联调办公室”→“登录模块交付演示”→“当前成果”。可依次发送 `-Round 1`、`2`、`3` 查看积累和更新；协议升级后需按原命令重启开发服务。数据职责、外部版本 URL 与字段说明见[交付与版本预览](../docs/architecture/result-deliveries.md)。

- [公共协议 Schema](../packages/protocol/src/office-integration.ts)
- [PawOffice 服务端实现](../server/src/)
- [场景运行时 SDK 与命令协议](../docs/plugin-runtime.md)
- [测试与验收入口](../tests/README.md)
- [端到端验收说明](../tests/integration-e2e/README.md)

示例客户端仅通过公开 HTTP 协议对接，不导入前端内部代码，也不承担业务系统的持久化或业务权限管理。
