# 成果页 Mock 数据

`/?result-preview=1` 启动后会请求 `/mock/result-preview.json`。这个地址由 `apps/web/vite.config.ts` 中的 `result-preview-mock` 插件在开发环境提供，直接读取本目录的 `result-preview.json`。

修改 JSON 后刷新页面即可，不需要改组件代码。Mock 数据来源也会显示在页面右上角的「查看驱动数据」里。

## 结构

```json
{
  "cases": [
    {
      "id": "operations",
      "label": "电商复盘",
      "description": "显示在预览页副标题里的说明",
      "whiteboard": {
        "template": "task-board-v1",
        "title": "任务标题",
        "status": "completed",
        "steps": [{ "id": "step", "title": "阶段", "progress": 100 }],
        "result": {
          "template": "result-v1",
          "status": "verified",
          "title": "成果标题",
          "summary": "一句话结论",
          "verdict": "验收结论",
          "metrics": [],
          "artifacts": [],
          "checks": [],
          "decisions": [],
          "next": [],
          "note": ""
        }
      }
    }
  ]
}
```

- 每个 `whiteboard` 和其中的 `result` 都会经过协议 schema 校验；字段写错时页面会显示具体错误，不会渲染半成品。
- 指标 `kind` 可为 `auto` / `comparison` / `value` / `status` / `target` / `text`，布局由前端按数量决定；`metrics: []` 时成果页不显示指标区。
- 本文件只在开发环境使用，生产构建不包含预览页，也不会发布这份 mock 数据。
