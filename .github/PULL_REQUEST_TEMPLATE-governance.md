# 受控变更 PR

## 变更单

- CHG 文件：
- CHG 状态：必须是 `approved` 或 `in-progress`
- 设计基线：
- 目标分支：

## 本次实际修改

逐项说明实际 diff 中每个文件与 CHG“允许修改文件”表的对应关系；未登记文件必须先退回更新 CHG。

## 验证证据

| 命令 | 退出码 | 结果或报告地址 |
| --- | ---: | --- |
| `python governance/check.py pr-check ...` |  |  |
| `python governance/check.py comments-diff ...` |  |  |
| `npm run lint` |  |  |
| `npm run build`、`npm run test`、`npm run test:e2e` |  |  |

## 审核确认

- [ ] 没有修改 CHG 禁止路径或未登记文件
- [ ] 公共 API、动作、字段和依赖变化已逐项说明
- [ ] 新增/修改公共 TypeScript export 使用中文标准注释
- [ ] Gateway 文件边界、FIFO、失败隔离和回滚可执行
- [ ] L3/L4 CODEOWNER 已审核
- [ ] 未执行项已说明原因，没有用 skip 冒充通过
