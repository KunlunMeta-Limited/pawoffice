# AI Office AI 开发入口规则

本文件是 AI 开始任何编码任务前必须阅读的项目规则。项目目标是完成
`D:/Workspace_bak/master-plan.md` 的 B 线任务，OpenPaw Host 的动作和摘要数据是本项目的外部输入。

## 开始任务前

1. 阅读 `docs/governance/项目设计基线.md`、`docs/governance/需求验收基线.md`、现有
   `docs/b-line-design.md`、`docs/architecture.md` 和有效 `docs/changes/CHG-*.md`。
2. 先只读分析 Gateway、类型、场景桥、React 面板和测试的调用关系；没有已批准 CHG 时只允许起草 draft CHG。
3. CHG 必须逐项说明每个文件为什么必要、对其他模块/API 的影响、明确禁止的路径及原因、接口字段、数据流、实现替代方案、测试和回滚。
4. AI 发现需要修改未登记文件、公共类型、网关路由、依赖或文件系统写入点时，必须停止并要求更新 CHG。

## 编码边界

- 只有 CHG“允许修改文件”表中的文件可以出现在本次分支 diff；新增、删除和重命名同样需要登记。
- `scripts/action-gateway.mjs` 是 L4 安全边界；`src/types/**`、`officeGatewayApi.ts`、场景桥、
  `package.json`、`package-lock.json` 和 CI 是 L3，必须由对应 CODEOWNER 审查。
- UI 不得绕过 `officeGatewayApi.ts` 直接读取 `OPENPAW_HOME`，场景不得绕过 `officeSceneBridge.ts` 直接启动并发拜访。
- Gateway 的 `/actions` 必须整批校验后入队、GET 读后清空；Office 请求失败不得反向改变 OpenPaw AgentLoop 结果。
- 首次治理接入不得修改业务源码、依赖、构建配置或现有测试；`node_modules`、`dist`、`test-results` 不属于事实源。

## 中文注释要求

新增或修改的公共 TypeScript `export` 类型、函数、类、常量和接口字段必须使用中文说明；权威规范见
`D:/workSpace/KunlunMeta_Git/framework/docs/注释规范与示例.md`，项目内镜像见
`docs/governance/注释规范与示例.md`。公共函数和方法固定填写“功能、参数、返回、错误、状态、并发与取消、
权限、关联”八个栏目，不适用项写“无”，不能省略；机器标识保留原文但不能代替中文含义。

## 完成前自检

```text
python governance/check.py validate --profile governance/project-profile.toml
python governance/check.py contracts --dir contracts
python governance/check.py comments --root . --language typescript --all --report-only
npm run lint
npm run build
npm run test
```

Git 建立后再执行 `pr-check` 和 `comments-diff`。未执行的命令、退出码和原因写入 CHG；AI 不得执行 `approve`。
