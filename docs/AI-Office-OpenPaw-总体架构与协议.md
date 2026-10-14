# AI Office / OpenPaw 总体架构与协议

本文是历史入口和协议速览；完整正文已归并到以下权威文档，避免同一事实在多处漂移：

- [01-需求基线.md](./01-需求基线.md)：`master-plan.md` T1-T13、M1-M6 和当前状态。
- [02-设计与实现.md](./02-设计与实现.md)：总体架构、HTTP 协议、数据链路、并发、恢复和独立运行边界。
- [03-测试大纲.md](./03-测试大纲.md)：完整测试点和发布门禁。
- [04-验收记录.md](./04-验收记录.md)：实际证据、失败和未执行项。

## 当前协议结论（2026-09-20）

- `/actions` 继续作为兼容的尽力动画接口；对话事实不再经由它传递。
- 对话链路为 `React :5173 -> Gateway :8765 -> OpenPaw engine-host :4096 -> AgentLoop -> Provider/JSONL`。
- Gateway 返回 `202` 仅表示回合已接收；Host 通过 `OpenPaw-Turn-ID`、`status/turns/message` 和 JSONL 终态完成对账。
- terminal 已完成但 assistant 正文尚未投影时，Gateway 只对该场景按 50/100/200ms 有界重读；失败和取消不等待。
- Host 默认输出预算保持 4096，可通过通用 `OPENPAW_MAX_OUTPUT_TOKENS` 调整；达到输出上限的部分正文不得标记 completed。
- 同一 session 只允许一个活动回合；不同 session 默认 4 个运行槽、32 个 FIFO 排队槽，第 37 个请求返回 `429 queue_full`。
- 完整 AI Office 对话是超出原 T11/T12 的产品扩展；Calendar/OCR 已从核心 Gateway 删除，Calendar/Browser 页面只保留静态“不支持”，通知因任务生命周期仍保留。
- 还原无意义 CLI 输出、格式和注释改动后，重新绑定当前源码构建的真实 DeepSeek `deepseek-v4-flash` 完成 `200/200`，失败 `0`；证据为 `D:/workSpace/KunlunMeta_Git/_diagnostics/deepseek-200-current-final.json`。当前候选 manifest 前缀为二进制 `6143aea245ae`、源码 `d91da2d28aae`。
- Host 对已持久化 `requestID` 先做指纹校验和重放，再构造 Provider；因此 Provider 凭据失效或 Host 重启不会破坏已接收请求的幂等重放，不同请求正文仍返回 `idempotency_conflict`。
- Host 强制关闭以登记任务最终是否全部收割作为成功条件；仅发出 abort 但仍有登记任务时不报告成功。
- OpenPaw 默认 CLI/no-default/sidecar 不依赖 AI Office，默认依赖树不含 `axum` 或 `openpaw-engine-host`。

完整架构、HTTP 字段、并发、恢复、动画边界和未关闭发布风险见 [02-设计与实现.md](./02-设计与实现.md)；不要把本页的历史入口当作独立的第二套协议事实源。

本文件保留原路径用于兼容历史链接，不再维护重复正文。`docs/changes/**` 仍独立保存，不属于本次合并范围。
