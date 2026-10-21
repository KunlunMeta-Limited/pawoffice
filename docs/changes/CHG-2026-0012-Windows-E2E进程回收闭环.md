# CHG-2026-0012：Windows E2E 进程回收闭环

## 先说结论

本变更用项目运行器直接启动和回收隔离 Gateway/Vite 子进程，解决 Playwright 断言全部通过后仍卡在 Windows WebServer teardown 的问题。清理只针对运行器自己创建的 PID，不触及正式 4096、8765、5173 服务。生产 Gateway、前端运行时和协议保持不变，正式治理批准仍待人工记录。

## 1. 变更审批

| 审批项目 | 内容 |
| --- | --- |
| 变更编号 | `CHG-2026-0012` |
| 变更标题 | Windows E2E 进程回收闭环 |
| 当前状态 | 评审中（review） |
| 变更类型 | 测试基础设施修复（test-fix） |
| 风险等级 | 中（medium） |
| 负责人 | AI Office 项目负责人（待确认） |
| 必须审核 | 测试负责人、系统架构负责人、构建负责人 |
| 设计基线 | `DES-AIOFFICE-B-2026-09-15` |
| AI 参与 | 是 |
| AI 工具 | Codex（历史实施与本次文档迁移） |
| 目标分支 | `main`（历史工作树；正式发布前需迁移到受控分支） |
| 批准人 | 待审批 |
| 批准时间 | 待审批 |

用户要求系统测试完整退出，但没有 Git 平台 CODEOWNER、PR 或批准时间证据，故不沿用旧文件的“已批准”表述。

## 2. 变更原因

8 个 Playwright 功能断言全部通过后，Windows runner 卡在 `Terminating the WebServer`，隔离 Gateway/Vite 端口仍保持监听，标准命令不能自然退出。调试日志表明问题位于 Playwright 1.63 内置 WebServer 回收直接 Node 服务的路径，而不是产品断言或正式服务。

## 3. 涉及仓库

| 仓库编号 | PR 或说明 |
| --- | --- |
| ai-office-react-main | 当前本地历史工作树；尚无独立受控 PR |

## 4. 允许修改文件

| 仓库 | 操作 | 文件 | 模块或符号 | 文件负责人 | 为什么必须修改 | 对其他部分的影响 |
| --- | --- | --- | --- | --- | --- | --- |
| ai-office-react-main | 新增 | `scripts/e2e.mjs` | Windows E2E 服务运行器 | 测试负责人 | 直接启动、健康检查和回收隔离 Gateway/Vite | 仅影响标准 E2E 服务生命周期 |
| ai-office-react-main | 修改 | `playwright.config.ts` | `webServer` 条件配置 | 测试负责人 | 外部运行器管理服务时关闭内置 WebServer | 直接调试时仍保留原行为 |
| ai-office-react-main | 修改 | `package.json` | `test:e2e` 脚本 | 构建负责人 | 让标准命令使用可靠运行器 | 改变测试脚本入口，不影响生产 bundle |
| ai-office-react-main | 修改 | `docs/changes/CHG-2026-0012-Windows-E2E进程回收闭环.md` | 受控变更说明 | 项目负责人 | 记录 PID 边界、验证和回滚 | 不改变运行时 |
| ai-office-react-main | 修改 | `docs/changes/INDEX.md` | CHG 索引 | 项目负责人 | 由治理工具重新生成索引 | 不改变运行时 |

## 5. 明确禁止范围

| 仓库 | 禁止路径 | 为什么禁止 |
| --- | --- | --- |
| ai-office-react-main | `scripts/action-gateway.mjs` | 不修改生产 Gateway 行为和协议 |
| ai-office-react-main | `src/**` | 进程回收属于测试基础设施，不修改业务组件 |
| ai-office-react-main | `package-lock.json` | 不升级依赖或改变锁文件 |
| ai-office-react-main | `contracts/**` | 公共接口没有变化 |

## 6. API 变化

没有生产 API 变化；新增的是测试运行器环境变量协作。

| 接口编号 | 类型 | 原始标识符 | 中文名称 | 兼容性 | 功能和边界 |
| --- | --- | --- | --- | --- | --- |
| 无 | 不涉及 | 无 | 不改变生产 HTTP API | 不适用 | `OFFICE_E2E_MANAGED_SERVERS` 仅控制 Playwright 是否自行启动测试服务 |

## 7. 字段变化

没有线协议字段变化。

| 字段编号 | 所属接口 | 原始字段名 | 中文名称 | 类型 | 必填 | 默认值 | 约束 | 数据来源 | 数据去向 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 无 | 不涉及 | 无 | 不改变请求响应字段 | 不适用 | 否 | 无 | 测试运行器环境变量不进入浏览器业务数据 | Node 测试进程 | Playwright 配置 |

## 8. 保护路径

| 仓库 | 文件或路径 | 等级 | 负责人 | 为什么需要保护 |
| --- | --- | --- | --- | --- |
| ai-office-react-main | `package.json` | L3 | 构建负责人 | 标准测试脚本决定 CI 和本地验收执行方式，错误修改会造成假通过或无法退出 |

## 9. 影响、数据流和实现

### 影响分析

标准 `npm run test:e2e` 由 Node 运行器管理两个隔离服务；直接调用 Playwright 时仍可使用原 `webServer` 调试路径。运行器只记录并终止自己创建的进程，正式服务 PID 和端口不在清理范围。Windows 强制终止仅作为普通终止失败后的兜底。

### 数据流和失败路径

```text
npm run test:e2e -> scripts/e2e.mjs
  -> shell:false 启动隔离 Gateway 和 Vite
  -> 等待健康端点
  -> OFFICE_E2E_MANAGED_SERVERS=1 启动 Playwright
  -> 测试完成/失败/中断
  -> 反序终止已记录子进程
  -> Windows 未退出时仅 taskkill 这些 PID 的进程树
```

任一服务未健康则停止已启动子进程并返回非零；Playwright 失败仍执行 finally 清理；不得按端口模糊杀进程，也不得清理正式服务。

### 实现方案和选择理由

显式持有子进程对象和 PID，能准确界定所有权；`shell:false` 避免额外 shell 层导致终止信号落不到 Node 服务。与继续依赖 Playwright 内置 teardown 相比，此方案可在 Windows 上验证端口释放，并保留直接调试能力。

## 10. 验收测试

| 测试编号 | 执行命令 | 场景和通过条件 |
| --- | --- | --- |
| TEST-AIOFFICE-CHG0012-001 | `npm run test:e2e` | 全部浏览器断言通过，命令自然退出；历史记录为 8/8 通过，约 1.8 分钟 |
| TEST-AIOFFICE-CHG0012-002 | `npm run test:e2e -- --grep "任务深链"` | 定向用例自然退出；历史记录为 1/1 通过 |
| TEST-AIOFFICE-CHG0012-003 | `Get-NetTCPConnection -LocalPort 18771,14403 -ErrorAction SilentlyContinue` | 测试结束后隔离端口无 LISTENING，仅允许正常 TIME_WAIT |
| TEST-AIOFFICE-CHG0012-004 | `npm run lint` | 静态检查退出码 0 |
| TEST-AIOFFICE-CHG0012-005 | `npm run build` | 生产构建退出码 0，可保留既有大 chunk 警告 |
| TEST-AIOFFICE-CHG0012-006 | `git diff --check` | 退出码 0；Windows CRLF 提示不计为内容错误 |

## 11. 追踪、兼容和回滚

| 需求编号 | 设计章节 | 接口编号 | 代码文件或符号 | 测试编号 | 验收证据 |
| --- | --- | --- | --- | --- | --- |
| REQ-B-OFFICE-006 | `DES-AIOFFICE-B-2026-09-15` §3/§8 | 无 | `scripts/e2e.mjs`、`playwright.config.ts`、`package.json` | TEST-AIOFFICE-CHG0012-001 至 006 | 本文件历史记录；正式证据待 PR/CI |

产品运行时与协议完全兼容。回滚时恢复 `package.json` 的直接 Playwright 命令、删除运行器并恢复固定 `webServer` 数组；不涉及测试数据和生产状态。但本机已知 Playwright 1.63 teardown 会再次卡住，回滚后标准 Windows 门禁不能视为闭环。

## 12. 验证和审批记录

| 时间 | 人员或系统 | 结论 | 证据或备注 |
| --- | --- | --- | --- |
| 2026-09-16 | 历史本地验证 | 通过但非本次重跑 | 定向 1/1、全量 8/8、隔离端口释放、正式端口 PID 不变、lint/build/diff-check 均记录为通过 |
| 2026-09-17 | 治理迁移 | 已迁移待校验 | 保留实际历史数字和 CRLF 备注，未伪造正式批准 |
| 待审批 | Git CODEOWNER | 待审核 | `package.json` 需构建负责人在 Git 平台批准 |
