# 03 测试报告（实际执行记录）

> 本报告只记录实际运行过的命令与真实输出；未执行的项目明确写“未执行”。
> 执行时间：2026-11-11 晚；执行环境：`D:\kunlunmeta\ai-office-react`（Windows，pwsh）。
> 会话为 danger-full-access，**不需要也不允许**再申请 `sandbox_permissions`；`node --test` 直接运行成功，
> 未出现沙箱 EPERM。

## 1. 环境

| 项目 | 值 |
| --- | --- |
| 分支 | `feat/result-board-design`（未切换/未合并/未提交） |
| Node | `v22.22.2` |
| 基线提交 | `b69f24f`（改动前 `git log -1`） |
| 主实现状态 | Lead 已冻结（`npm run build` / `tsc` / `eslint` 由 Lead 执行通过） |
| 测试数据 | `docs/design/chatgpt-result-board-handoff/sample/*.json` 的逐字节复制 + 前端验收 fixture |

## 2. 测试命令与结果

### 2.1 一次性回归（Lead 指定的 7 份）

```powershell
node --test tests/resultWorkspace.test.mjs tests/resultBoard.test.mjs tests/resultReader.test.mjs `
  tests/resultPresentation.test.mjs tests/resultSectionRouting.test.mjs `
  tests/whiteboardDetails.test.mjs tests/resultHistory.test.mjs
```

真实输出摘要：

```text
# tests 80
# suites 0
# pass 80
# fail 0
# cancelled 0
# skipped 0
# duration_ms 2626.6279
```

（该命令在实现冻结后多次运行均为 80/80；历史记录：`2450.1687`、`4643.176`、`2626.6279`、最终复核 `3056.5854`。A12 修复与最后字号对齐后重新运行仍 80/80。）

### 2.2 逐份执行（便于定位）

| 文件 | tests | pass | fail | duration_ms |
| --- | --- | --- | --- | --- |
| `tests/resultWorkspace.test.mjs` | 13 | 13 | 0 | 1175.34 |
| `tests/resultBoard.test.mjs`（新增） | 24 | 24 | 0 | 1472.43 |
| `tests/resultReader.test.mjs` | 14 | 14 | 0 | 1128.93 |
| `tests/resultPresentation.test.mjs` | 10 | 10 | 0 | 1047.54 |
| `tests/resultSectionRouting.test.mjs` | 6 | 6 | 0 | 1072.52 |
| `tests/whiteboardDetails.test.mjs` | 4 | 4 | 0 | 1246.42 |
| `tests/resultHistory.test.mjs` | 9 | 9 | 0 | 1040.22 |

### 2.3 类型检查

```powershell
npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile .tmp/app.tsbuildinfo
# exit code 0，无输出
```

### 2.4 Lint

```powershell
npx eslint apps/web/src tests
# exit code 0，无输出
```

> 最终复核以 `npx eslint apps/web/src tests scripts`（含 dev 夹具/截图脚本）执行，同样 exit 0。
> Lead 另执行过同一命令，均 exit 0。

### 2.5 冻结范围核验

```powershell
git diff --stat HEAD -- packages server integration package.json package-lock.json
# 空输出
git status --short -- packages server integration package.json pnpm-lock.yaml package-lock.json
# 空输出
git branch --show-current
# feat/result-board-design
```

结论：A01 的“协议/服务端/Schema/集成/依赖零改动”有实际命令证据。

### 2.6 全量测试：`npm test` 环境阻塞与替代命令（如实记录）

`npm test` **未通过**，但阻塞发生在 `pretest` 阶段，与本次前端改动无关：

```text
> pretest
> npm run packages:build && npm run server:build && npm run licenses:check && npm run assets:build
...
> licenses:check
> node scripts/third-party-notices.mjs --check
Outdated license notice: public/THIRD_PARTY_NOTICES.txt
```

- 原因：`public/THIRD_PARTY_NOTICES.txt` 的依赖声明漂移（构建的 `licenses:generate` 会重写它，Lead 已还原保持干净 diff），
  **改动前基线（clean tree）同样失败**，不是本次单页阅读流改动引入的回归；`packages/*`/`server/*`/依赖均未改动（见 §2.5）。
- 替代命令（Lead 执行，绕过 `pretest`）：`node --test tests/*.test.mjs`（全部测试文件）。
  实际结果：**1019 tests / 1015 pass / 2 fail / 2 skipped**。两个失败均为**改动前基线问题、与本次前端改动无关**：
  1. `tests/teamOverview.test.mjs:91`「the scene trigger suspends presentation without stopping the team host」：
     对 `ConnectedOfficeWorkspace` 源码做正则匹配，期望的写法与当前仓库源码不一致；该文件本次未改
     （`git status` 无 `apps/web/src/ui/**`），单独运行同样失败 → 基线。
  2. `tests/thirdPartyNotices.test.mjs:94`：`Outdated license notice: public/THIRD_PARTY_NOTICES.txt`，
     依赖声明漂移基线（`npm run licenses:check` 在 clean tree 同样失败）。
- 本报告**不声称 `npm test` 通过**；也不把上述两个基线失败写成回归。

### 2.7 构建

- 最终冻结代码上执行 `npm run build`（= prebuild：`packages:build`、`licenses:generate`、`assets:build` + `tsc -b` + `vite build`）：
  **exit code 0**，末尾输出 `✓ built in 930ms`；产物包含 `dist/assets/WhiteboardReader-DN_i-vVg.js`、
  `dist/assets/home-Bp8f7mqm.js` 等。
- 说明：构建过程的 `licenses:generate` 会重写 `public/THIRD_PARTY_NOTICES.txt`；Lead 在构建后已用
  `git checkout -- public/THIRD_PARTY_NOTICES.txt` 还原，保持与基线的干净 diff。这正是 §2.6 中
  `licenses:check` 基线漂移的来源，与本次前端改动无关。
- 最终冻结代码上复跑：`npx eslint apps/web/src tests scripts` exit 0、`npx tsc -p tsconfig.app.json --noEmit` exit 0。

## 3. 测试变更：有意行为变更 vs 回归

单页阅读流移除三 Tab、legacy `detail` 不再渲染，属于规范要求的有意行为变更。以下测试预期同步更新；
**协议 Schema 校验类断言全部保留未动**。

| 文件 | 变更 | 依据 | 分类 |
| --- | --- | --- | --- |
| `tests/resultWorkspace.test.mjs` | 删除 `role=tablist`/`aria-selected`/`tabpanel`/「概览·交付物·过程记录」断言；改为单页流、无 Tab、sections 源顺序、`result-metrics` 计数、完整读取字段与 note | 规范 §0 红线 3、§14 A03/A09/A10 | 有意变更 |
| `tests/resultReader.test.mjs` | 删除 tablist/3 tab 断言；新增无 Tab、dialog 工具行、`任务详情与协作`/`执行阶段` 保留断言 | 同上 | 有意变更 |
| `tests/resultPresentation.test.mjs` | 删除 1 tablist/3 tab 断言；`全部待处理事项` 改为首屏 `需要关注 N 项` 摘要；补充“nested tests 检查仍驱动 conflict”断言 | 规范 §9/§14 A03/A18 | 有意变更 |
| `tests/whiteboardDetails.test.mjs` | legacy `detail` Markdown 不再渲染（规范 §10 已废弃）；仅保留 `detailSections` 渲染断言，并新增“无结构化详情即无详情折叠块” | 规范 §10；Lead 确认 | 有意变更 |
| `tests/resultBoard.test.mjs` | 新增 24 项 SSR 验收测试（A05/A07/A08/A09/A11/A12/A13/A14/A15/A16/A18/A19/A20/A21/A22 与 10 展示态） | 规范 §14 | 新增 |

### 3.1 改动前基线（用于区分回归）

- 重构后、测试更新前：`node tests/resultWorkspace.test.mjs` → **11 pass / 2 fail**，失败点均为旧的三 Tab
  断言（`role="tablist"`、`aria-selected`、`交付物` 文案等），不是产品缺陷。
- `node tests/resultPresentation.test.mjs` → **8 pass / 2 fail**，失败点为旧 tablist/3 tab 与
  `全部待处理事项` 断言。
- `node tests/whiteboardDetails.test.mjs` → **3 pass / 1 fail**，失败点为 legacy Markdown `detail` 仍被断言的旧行为。
- 测试按新单页流更新后：以上 3 份全部通过（见 §2）。

## 4. 阻塞与未执行项

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 沙箱 EPERM | **未发生** | 会话为 danger-full-access，`node --test` 正常；无需升级权限 |
| 浏览器交互自动化（Escape/焦点恢复/复制/下载/版本对比点击） | 未执行自动化 | SSR 测试不能覆盖；由 fixtures-harness 的 Playwright 截图 04/08/09 与人工复现补充 |
| 全仓测试 `npm test` | **失败（基线阻塞）** | `pretest` 的 `licenses:check` 报 `Outdated license notice: public/THIRD_PARTY_NOTICES.txt`；改动前 clean tree 同样失败。替代 `node --test tests/*.test.mjs` → 1019 tests / 1015 pass / 2 fail / 2 skipped，两个失败均为基线问题（`teamOverview.test.mjs:91` 源码正则漂移、`thirdPartyNotices.test.mjs:94` license 声明漂移），与本次无关 |
| 多视口横向溢出自动化 | 未执行 | 只有 1787×864 与 390×844 截图；见 05 |
| 无障碍键盘/焦点自动化 | 未执行 | 依赖真实浏览器；实现层面保留 `<dialog>` 原生语义 |

## 5. 局限

- 本报告不能替代视觉验收：截图由 fixtures-harness 产出（含 manifest/hash/像素统计），本代理无法读图，
  视觉判断由审核方完成。
- 下载/复制/剪贴板/Blob 等依赖浏览器 API 的行为只验证了按钮与既有实现存在，未在自动化中点击。

## 6. 第二轮（组合式排版重构）复跑记录

第二轮重写的是前端组合方式（`ResultWorkspace.tsx/.css`、`ResultMetrics.*`、`ResultArtifactList.*`、`ResultSectionCard.tsx` 的 documents 分支），协议、服务端、测试语义均未变。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 相关测试 7 份 | `node --test tests/{resultWorkspace,resultBoard,resultReader,resultPresentation,resultSectionRouting,whiteboardDetails,resultHistory}.test.mjs` | **80/80 pass，exit 0** |
| 类型检查 | `npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile .tmp/app.tsbuildinfo` | exit 0 |
| Lint | `npx eslint apps/web/src tests scripts` | exit 0 |
| 构建 | `npm run build` | **exit 0**（`✓ built in 1.11s`，产物 `dist/assets/home-UKsS3xHq.js`） |
| 截图 | `node scripts/result-board/capture.mjs` | 9 张重新产出，`fixtureSmoke` 15/15 ok，`consoleErrors: []`；03 完整长图 1121×2220 |
| 交互回归（Playwright 实测） | 打开预览 / Escape 关闭且焦点回到「阅读」/ 复制摘要写入剪贴板 / 下载报告 `登录模块交付成果.md` / diff 13 行 / 文档索引打开同一预览入口 | 全部通过，无 console 错误 |
| 对比度 | 脚本遍历 4 个 fixture 的可见文本，检查 CSS 颜色与等效背景对比度 | 0 项低于 4.5 |
## 7. 第三轮（数据类型专用视觉体系）执行记录

> 设计：`07-data-type-visual-system.md`。本轮只改前端表现层（新增/重写类型组件与 dev-only 夹具），协议/服务端/依赖未变。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 新增类型视觉测试 | `node tests/resultTypeVisual.test.mjs` | **8/8 pass，exit 0**（阅读模式、6 metric、4 artifact、documents 同源、review/risks、versions、inline changes、sections 机制） |
| 既有 + 新增结果测试 | `node --test tests/resultTypeVisual.test.mjs tests/resultBoard.test.mjs tests/resultWorkspace.test.mjs tests/resultReader.test.mjs tests/resultPresentation.test.mjs tests/whiteboardDetails.test.mjs tests/resultHistory.test.mjs tests/resultSectionRouting.test.mjs` | **88/88 pass，exit 0** |
| 类型检查 | `npx tsc -p tsconfig.app.json --noEmit --tsBuildInfoFile .tmp/final.tsbuildinfo` | exit 0 |
| Lint | `npx eslint apps/web/src tests scripts` | exit 0 |
| 构建 | `npm run build` | **exit 0**（`✓ built in 920ms`） |
| 类型截图 | `node scripts/result-board/capture.mjs` | **17 张**（既有 9 + type-01…08），`consoleErrors: []`、`fixtureSmoke 23/23`、`interrupted: null`；连续重跑幂等 |
| 全量测试（绕过 npm pretest 的既有 license 阻塞） | `node --test <tests/*.test.mjs>` | **1027 tests / 1023 pass / 2 fail（改动前基线：teamOverview 源码正则、thirdPartyNotices license 漂移）/ 2 skipped** |\n| 浏览器交互（Playwright 实测） | 点击 changes 首行 → inline diff、`aria-expanded=true`；Esc 收起并回焦；图片加载失败 → 虚线占位（无破图）；gallery 失败项占位 | 通过，无 console error |

已知限制（与 05 一致）：link 统一外链新窗口；data 格式只由 `mimeType` 派生；closed 风险同列表弱化；12 种 custom block 视觉沿用既有实现（本轮优先五类核心内容）；视觉主观评分仍由审核方按截图判定。