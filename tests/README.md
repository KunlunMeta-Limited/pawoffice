# 测试与验收

所有命令均在项目根目录执行。外部业务接入文档和可运行客户端位于 [integration](../integration/README.md)。

## 测试目录

| 路径 | 内容 |
| --- | --- |
| `tests/*.test.mjs` | 协议、运行时、场景、界面、资源与目录的 Node 回归测试 |
| `tests/helpers/` | 测试公共工具 |
| `tests/browser/resultWorkspace.mjs` | 成果阅读器的本地浏览器回归，自动启动 Vite；支持 `--channel=msedge` |
| `tests/browser/resultChanges.mjs` | PowerShell → HTTP → 正式办公室的文件清单、悬停差异、焦点和手机验证 |
| `tests/browser/resultHistory.mjs` | 外部历史快照与文档版本、实时更新、下载、比较、错误恢复和手机验证 |
| `tests/browser/workflow.mjs` | 同一手动 mock 后端，从空聊天逐轮发送六次请求，验证交付、更新、回滚、移除与验收 |
| `tests/browser/ecommerceWorkflow.mjs` | 五轮电商场景、当前集合、聊天历史入口、原件下载、文件版本比较及复核 |
| `tests/browser/ecommerceShowcase.mjs` | 完整页面评审：任务目标、6位办公室成员、8项任务、协作图、预算/趋势图、逐日明细、图片、历史任务状态与移动端 |
| `tests/browser/resultFilePreview.mjs` | 真实版本正文的代码高亮/复制/折叠，CSV分页搜索/原件，JSON树/源文/比较，错误输入及手机布局 |
| `tests/resultSectionRouting.test.mjs` | 内容用途路由、旧数据兼容、检查去重、精确文件版本关联，以及真实接口拒绝无效预览 |
| `tests/fixtures/` | 测试页面、包消费者和固定输入 |
| `tests/integration-e2e/` | 外部 HTTP 客户端、真实浏览器及 Docker 端到端验收 |
| `scripts/check-relay-service.mjs` | 已启动服务的页面、鉴权和 SSE 检查 |

## 运行

```sh
npm ci
npm test
npm run lint
```

`npm test` 会先构建公共包、服务端和素材，检查许可证，然后执行全部 Node 回归。仅运行某个测试时，先确保这些产物已构建：

```sh
node --test tests/integrationDirectory.test.mjs tests/protocolNullAudit.test.mjs
```

其他检查：

成果浏览器回归使用临时端口和独立服务，不修改正在运行的办公室数据：

```sh
node tests/browser/resultWorkspace.mjs --channel=msedge
node tests/browser/resultChanges.mjs --channel=msedge
node tests/browser/resultHistory.mjs --channel=msedge
node tests/browser/chatDeliveries.mjs --channel=msedge
node tests/browser/workflow.mjs
node tests/browser/ecommerceWorkflow.mjs
node tests/browser/ecommerceShowcase.mjs
node tests/browser/resultFilePreview.mjs
```

截图写入已忽略的 `test-results/result-workspace/`。运行前先构建公共包及服务端。

| 命令 | 用途 |
| --- | --- |
| `npm run packages:check` | 检查包依赖边界、类型声明和公开导出；需要先构建包 |
| `npm run packages:smoke` | 在临时目录安装发布包，验证导入、类型及独立场景 |
| `npm run test:integration:types` | 检查端到端测试的 TypeScript 类型 |
| `npm run test:integration` | 构建临时 Docker 服务并运行真实浏览器验收 |
| `npm run test:service` | 检查已启动服务的页面、认证及 SSE 转发 |

在线服务检查使用独立测试团队；它不会替你启动服务。目标地址和密钥通过进程环境变量提供：

```sh
PAWOFFICE_URL=http://127.0.0.1:3000 PAWOFFICE_API_KEY=your-private-key npm run test:service
```

## 端到端报告

完整环境要求和用例范围见[端到端验收说明](./integration-e2e/README.md)。报告写入 `integration-e2e-report/`，截图、轨迹与请求记录写入 `test-results/`，这些生成目录均已忽略。打开已有报告：

```sh
npx playwright show-report integration-e2e-report
```
