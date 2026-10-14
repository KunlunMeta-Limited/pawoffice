# 脚本

`action-gateway.mjs` 是本地 B 线 HTTP 边界。它校验办公室动作联合类型，将
合法动作排入 `GET /actions` 队列，在内存中投影六人名册状态，并提供 OpenPaw
主目录和指定工作区的只读视图。导入模块不会产生副作用；直接运行时会启动仅
监听回环地址的 Node 服务器。

`POST /office/conversations` 支持仅提交 `title` 创建空会话；带 `text` 时保持
旧的“创建并启动首轮”兼容行为。provider 默认读取 `OPENPAW_DEFAULT_PROVIDER`，
未设置时仅在存在 `OPENAI_API_KEY` 才选择 `openai`（可同时设置
`OPENPAW_OPENAI_BASE_URL` 指向兼容端点），否则保持离线 `mock`。
