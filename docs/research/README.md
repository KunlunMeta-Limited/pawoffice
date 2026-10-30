# 调研记录

本目录是一次性调研的过程记录，按需保留或清理。

## 多 Agent 成果展示

[前端能力对照评审](./frontend-gap-review-2026-10-28.md)：对照用户提供的通用 Multi-Agent 前端建议，区分当前已有能力、本次交付、缺口及建议优先级，不改变 PawOffice 架构。

调研日期：2026-10-28。[多 Agent 系统的结果展示调研](./multi-agent-result-presentation-2026-10-28.md)对照 AutoGen Studio、CrewAI AMP、LangSmith Studio、Deep Agents、OpenHands、Google ADK，并分析 A2A/A2UI 对成果协议的启发；区分官方资料可确认的事实与对 PawOffice 的建议。

## Pele（Mermaid 渲染器）引入评估

调研日期：2026-10-27。

| 文件 | 内容 | 状态 |
| --- | --- | --- |
| [pele-evaluation.md](./pele-evaluation.md) | **最终评估报告**：结论、事实基线（体积/性能/覆盖）、对 PawOffice 的提升、分级接入方案、MIT 许可义务、风险与路线 | 可交付，先读这份 |
| [pele-technical-profile.md](./pele-technical-profile.md) | Pele 本体技术档案：33 种图逐项体积、API 签名、兼容边界、安全模型、CJK、许可逐条证据 | 过程证据（强度高，逐条带 `file:line`） |
| [pawoffice-integration-surface.md](./pawoffice-integration-surface.md) | 本仓库接入面：4 个 `react-markdown` 出口、原语注册表、架构/协议约束、第三方声明脚本行为 | 过程证据 |

渲染样例见本目录的 `pele-demo.png`。

