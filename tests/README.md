# 测试与验收

所有命令均在项目根目录执行。外部业务接入文档和可运行客户端位于 [integration](../integration/README.md)。

## 测试目录

| 路径 | 内容 |
| --- | --- |
| `tests/*.test.mjs` | 协议、运行时、场景、界面、资源与目录的 Node 回归测试 |
| `tests/helpers/` | 测试公共工具 |
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
