# PawOffice 成果阅读页（单页阅读流）验收材料索引

本目录是「成果阅读页只前端重构」任务的验收与文档材料。产品与验收依据为用户提供的规范
`PawOffice_成果阅读页_前端渲染设计与验收规范_V1.0.md`（下称「规范」），以及只读的原始材料目录
`docs/design/chatgpt-result-board-handoff/`（下称「handoff 原始材料」）。

- 任务分支：`feat/result-board-design`（已检出；**不切换、不合并、不提交**）
- 改动性质：仅前端表现层。协议层、服务端、Schema、集成契约、数据推送接口、依赖均冻结。
- 本目录中的文档由 `verification-docs` 编写；`screenshots/` 由 `fixtures-harness` 产出，本文档不写入该目录。

**当前状态（2026-11-11）：主实现已冻结；本目录 7 份文档均为最终版。** 7 份相关测试 80/80 通过，
`tsc`/`eslint` exit 0，9 张截图与 manifest 已产出；A01–A28 结论见 `02-acceptance-self-check.md`，
未完成/部分项见 `05-open-issues.md`。

## 1. 材料编号与含义

| 文件 | 内容 | 何时完成 |
| --- | --- | --- |
| `README.md` | 本索引：编号含义、运行方式、分支与禁止改动声明 | 第一阶段 |
| `01-affected-files-and-reuse.md` | **改动前**源码调查：受影响前端文件清单、现有复用能力表、协议冻结声明 | 第一阶段（改动前） |
| `02-acceptance-self-check.md` | A01–A28 逐项自查表：等级/通过条件/证据/结论，不虚报 | 主实现与测试完成后 |
| `03-test-report.md` | 实际执行的命令、真实输出、阻塞原因与权限说明 | 主实现与测试完成后 |
| `04-data-matrix.md` | 6 metric / 4 artifact / 8 section / 12 block / 10 presentation state 覆盖矩阵 | 第一阶段建模板，验收前更新为最终版 |
| `05-open-issues.md` | 未完成清单、原因、安全回退形式（禁止请求改协议） | 验收前 |
| `06-screenshot-index.md` | 截图索引：既有 9 张验收图 + 本轮 8 张数据类型视觉样张（路径、验收项、数据来源） | 截图产出后 |
| `07-data-type-visual-system.md` | **本轮设计先行文档**：数据类型（6 metric/4 artifact/8 section/12 block）→ 当前实现 → 新视觉形态 → 交互方式 → 验收截图；含两种阅读重心与五类核心内容规格 | 本轮实施前 |
| `screenshots/` | 截图产物与 `manifest.json`（17 张：既有 9 + type-01…08） | 验收夹具脚本产出 |

编号不连续（无 `00`）是有意保留：`02`–`06` 对应规范 §14/§15 的验收与提交材料顺序，`01` 为前置源码调查。

## 2. 如何运行与复现

工作目录为仓库根 `D:\kunlunmeta\ai-office-react`（Windows / pwsh）。以下命令均为本任务实际使用或计划使用的命令：

```powershell
# 单份测试（直接 node 执行，避免 node --test 的 spawn 行为；SSR 测试复用 tests/helpers/vite.mjs）
node tests/resultWorkspace.test.mjs
node tests/resultBoard.test.mjs
node tests/resultReader.test.mjs
node tests/resultPresentation.test.mjs
node tests/resultSectionRouting.test.mjs

# 一次跑多份（node --test 支持多文件）
node --test tests/resultWorkspace.test.mjs tests/resultBoard.test.mjs

# 类型检查与 lint
npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile .tmp/app.tsbuildinfo
npx eslint apps/web/src tests
```

说明：

- SSR 测试通过 `tests/helpers/vite.mjs` 创建 Vite middleware 服务器，把 `packages/*` 的 `dist` 导出
  重定向到 `src/*.ts` 后 `ssrLoadModule`，因此不需要先构建协议包。
- 测试是 React `renderToStaticMarkup` 的静态 HTML 断言；客户端行为（Escape、焦点恢复、diff 预览
  popover、Mermaid 客户端渲染）无法由 SSR 覆盖，只能由截图/人工复现或 Playwright 补充。
- 实际执行结果与失败项以 `03-test-report.md` 为准；未执行的项目不会写成“通过”。

规范要求的 7 张截图（首页、成果首屏 1787×864、完整长图、需求说明正文、changes diff、旧版本检查待补充、
390×844 手机页）由 `fixtures-harness` 的 dev-only 预览页与 Playwright 脚本产出，索引见 `06-screenshot-index.md`。

## 3. 分支与禁止改动声明

本任务自始至终遵守以下约束，并在 `03-test-report.md` 记录校验命令与结果：

1. 分支固定 `feat/result-board-design`；不切换、不建分支、不合并、不提交、不 push。
2. **只改** `tests/**` 与 `docs/design/result-board/**`（本文档目录，`screenshots/` 除外）。
3. **不改**产品源码 `apps/web/src/**`、协议 `packages/**`、服务端 `server/**`、集成 `integration/**`、
   依赖清单 `package.json`/lockfile、Schema 与 handoff 原始材料 `docs/design/chatgpt-result-board-handoff/**`。
4. 不新增字段、不新增接口、不新增依赖、不请求后端补数据；展示所需的分组/排序/状态全部由前端既有契约数据派生。
5. `whiteboard.status` 与 `result.status` 分离；`completed ≠ verified`；复用 `resultPresentation` 与
   `checks.ts` 的版本失效判定，不自创另一套规则。

## 4. 状态标记约定

文档中的结论统一使用：`通过` / `部分` / `未做（原因）` / `待补（依赖项）`。凡未实际执行的测试、
未产出的截图、未验证的交互，一律不写“通过”。真实样例与前端 fixture 在 `04-data-matrix.md` 中分列标注。
