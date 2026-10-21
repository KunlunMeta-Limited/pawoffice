# AI Office B 线机器契约

本目录保存动作跨项目契约。中文字段含义、数据流、状态码和兼容策略必须同时存在于
`docs/governance/项目设计基线.md` 和有效 CHG；Schema 只负责机器校验。

当前契约：`office-action-v1.schema.json`，覆盖 Host -> Gateway 的三种动作和关键字段。
修改顺序固定为：先改需求/设计和 CHG，再改 Schema/fixtures，再改 Rust/TypeScript/Gateway 和测试。
