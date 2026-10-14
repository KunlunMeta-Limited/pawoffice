# AI Office 治理入口

本目录只保存项目适配配置。通用校验规则位于 `D:/Workspace/_bak/test/framework`，正式使用时通过
`AI_GOVERNANCE_FRAMEWORK` 固定版本。

```text
python governance/check.py validate --profile governance/project-profile.toml
python governance/check.py contracts --dir contracts
python governance/check.py index --changes docs/changes --output docs/changes/INDEX.md
```

当前 CHG 是反向接入草案，未批准不能编码。人审核通过后才执行：

```text
python governance/check.py approve --change docs/changes/CHG-2026-0002-治理接入.md --by "真实姓名"
```

Git 建立后，PR 必须执行 `pr-check`、`comments-diff` 和 profile 中对应的 npm 命令；未登记文件、未批准
CHG 或敏感路径缺少 CODEOWNER 审查都应阻断合并。
