# 成果展示分支的合并前验证

本分支交付正式办公室中的当前成果阅读、按聊天轮次打开历史交付、指定文件版本预览与比较，以及结构化内容用途路由。业务后端保管版本文件，PawOffice负责协议、缓存、展示和预览。

## 历史正确性修正

接收服务现在比较已有交付记录的完整规范化内容，而不仅比较 `result`。任务状态、摘要、阶段进度、详情、交付元数据或快照地址被原 ID 覆盖时，返回 `409 RESULT_HISTORY_CONFLICT`，缓存保持原样。当前任务状态仍可独立更新。

历史回归包含状态、摘要、进度、详情、删除任务快照、改写标题以及将内联结果替换为外部地址等场景。

## 全量测试失败归因与修正

收尾前，Windows 上全量运行两次均为951项：926通过、22失败、3取消。失败定位如下；相关测试代码在本地 `dev` 中也存在。本次未独立执行完整 `dev` 工作区，因此不把这一结果表述为 `dev` 的完整测试基线。

| 类别 | 原因 | 修正 |
| --- | --- | --- |
| 图片与角色资源测试 | URL的 `pathname` 在Windows产生 `/D:/...` 或重复盘符 | 文件URL统一用 `fileURLToPath` 转换；HTTP URL仍使用pathname |
| 架构导入检查 | `path.relative` 产生反斜杠，而断言按正斜杠匹配 | 断言输入统一使用 `/` |
| 符号链接逃逸检查 | Windows文件链接创建受权限限制 | 目录逃逸测试使用junction；两项文件链接检查作为独立子用例，在Windows明确返回EPERM时跳过，其他错误继续失败 |
| 长轮询默认值测试 | `inject`没有监听端口，服务的unref计时器不足以维持事件循环 | 测试启动真实监听器并由测试结束钩子关闭 |

符号链接跳过只涉及两个子用例；其余尺寸、哈希、路径逃逸、过期输出等检查继续运行。在允许创建文件符号链接的环境中，这两个子用例仍执行。

## PR范围整理

移除已停用的独立成果测试页及其专用数据、写入探针和过期截图。无关的Utility AI/IK调研、原始过程资料及临时交接材料已移出仓库，本地另行归档。成果页文档改为当前职责、协议边界和正式联调入口。保留与成果展示、Mermaid选型有关的研究与必要说明。

## 验证命令

```powershell
npm test
npm run lint
npx tsc -b --pretty false
npx vite build
node tests/browser/resultHistory.mjs --channel=msedge
node tests/browser/ecommerceWorkflow.mjs
node tests/browser/ecommerceShowcase.mjs
```

`npm test`包含包构建、服务构建、第三方许可检查和素材构建。浏览器验证使用独立临时服务，不占用用户现有服务。

2026-10-30验证结果：`npm test`共954项，952通过、0失败、0取消、2跳过（上述文件符号链接权限子用例）。全量ESLint、TypeScript构建检查、Vite生产构建及以上三组浏览器回归均通过。`git diff --cached --check`通过。
