# 调研记录

本目录是一次性调研的过程记录，按需保留或清理。

## 多 Agent 成果展示

[前端能力对照评审](./frontend-gap-review-2026-10-28.md)：对照用户提供的通用 Multi-Agent 前端建议，区分当前已有能力、本次交付、缺口及建议优先级，不改变 PawOffice 架构。

调研日期：2026-10-28。[多 Agent 系统的结果展示调研](./multi-agent-result-presentation-2026-10-28.md)对照 AutoGen Studio、CrewAI AMP、LangSmith Studio、Deep Agents、OpenHands、Google ADK，并分析 A2A/A2UI 对成果协议的启发；区分官方资料可确认的事实与对 PawOffice 的建议。

## 1. Utility AI / Smart Objects / IK

调研日期：2026-10-27。

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| [utility-ai-smart-objects-ik.md](./utility-ai-smart-objects-ik.md) | **最终调研报告**：三个技术的判断与优先级、PawOffice 现状、最小落地切片、路线图、验收指标 | 可交付，先读这份 |
| [raw-codebase.md](./raw-codebase.md) | 现状代码地图：8 条提交通道、模板/能力/资源模型、新增家具改动清单、LOC 与测试统计、不确定项 | 过程证据 |
| [raw-ai.md](./raw-ai.md) | Utility AI / Smart Objects 外部资料：范式、The Sims/RimWorld/ONI/UE 案例、失败模式、引用分级 | 过程证据 |
| [raw-ik.md](./raw-ik.md) | IK 外部资料：2D 帧位图约束、Spine/Unity/Unreal/Godot 现状、IK-lite 替代方案、spike 设计 | 过程证据 |
| [verify-report.md](./verify-report.md) | 最终报告的独立复核记录：34 处 `file:line` 核对（0 漂移）、11 组外部链接抽查、结论 pass；2 条 P1 已在报告中修正 | 审计记录 |

过程证据文件未经最终报告同等强度的交叉复核，只作追溯用途；结论以最终报告为准。

## 2. Pele（Mermaid 渲染器）引入评估

调研日期：2026-10-27。

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| [pele-evaluation.md](./pele-evaluation.md) | **最终评估报告**：结论、事实基线（体积/性能/覆盖）、对 PawOffice 的提升、分级接入方案、MIT 许可义务、风险与路线 | 可交付，先读这份 |
| [pele-technical-profile.md](./pele-technical-profile.md) | Pele 本体技术档案：33 种图逐项体积、API 签名、兼容边界、安全模型、CJK、许可逐条证据 | 过程证据（强度高，逐条带 `file:line`） |
| [pawoffice-integration-surface.md](./pawoffice-integration-surface.md) | 本仓库接入面：4 个 `react-markdown` 出口、原语注册表、架构/协议约束、第三方声明脚本行为 | 过程证据 |

样例图在仓库根目录 `pele-demo.png`（沙箱内子目录写入受限，暂放根目录）。

