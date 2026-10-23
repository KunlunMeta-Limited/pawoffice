# 外部系统对接

本目录集中存放外部业务后端接入 PawOffice 所需的协议说明和可运行客户端。正式前端应用位于 `apps/web/`，独立示例位于 `examples/`，服务端实现位于 `server/`，公共 Schema 位于 `packages/protocol/`。

## 目录

```text
integration/
  README.md
  clients/
    client.mjs                 初始化、任务更新和用户确认示例
    ui-client.mjs              领取用户操作并返回展示结果
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

- [公共协议 Schema](../packages/protocol/src/office-integration.ts)
- [PawOffice 服务端实现](../server/src/)
- [场景运行时 SDK 与命令协议](../docs/plugin-runtime.md)
- [测试与验收入口](../tests/README.md)
- [端到端验收说明](../tests/integration-e2e/README.md)

示例客户端仅通过公开 HTTP 协议对接，不导入前端内部代码，也不承担业务系统的持久化或业务权限管理。
