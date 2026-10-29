# 成果页 Mock 数据

当前预览与正式页面共用 `ResultWorkspace`，只有“概览 / 交付物 / 过程记录”一层导航。默认进入概览；`view=board` 兼容为过程记录，`view=detail` 兼容为交付物。状态切换只更新成果状态，不切走当前标签。详见 [成果体验优化方案](../../../../../docs/architecture/result-experience-plan.md)。

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
        "steps": [{ "id": "step", "title": "阶段", "progress": 100, "state": "done" }],
        "result": {
          "template": "result-v1",
          "status": "verified",
          "title": "成果标题",
          "summary": "一句话结论",
          "verdict": "验收结论",
          "team": "前端组",
          "teamSize": 3,
          "updatedAt": "2024-06-20 14:30",
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
- 阶段步骤可选 `state`: `done` / `active` / `pending`，用于任务详情工作台里「已完成 / 当前 / 待开始」三态；省略时前端按 `progress` 推导。

## 任务详情可选字段

`result` 新增以下可选字段，全部可省略；省略时保持原有紧凑成果页不变：

| 字段 | 说明 |
| --- | --- |
| `team` | 团队名称，≤40 字符 |
| `teamSize` | 团队人数，0–99 的整数；省略时不显示人数 |
| `updatedAt` | 更新时间，≤40 字符 |
| `sections` | 交付成果语义块，最多 8 项 |
| `tasks` | 任务明细，最多 12 项 |
| `versions` | 版本记录，最多 8 项 |
| `risks` | 风险与备注，最多 8 项 |

「交付成果」tab 由 `sections` 驱动：`kind` 决定卡片类型（`gallery` 页面原型 / `documents` 文档 / `tests` 测试与验收 / `api` 接口 / `environments` 部署与发布 / `files` 文件与附件 / `custom` 通用原语组合），前端决定两栏布局、图标与颜色，数据里不写 HTML/CSS。`tasks` / `versions` / `risks` 非空时才出现对应 tab；缺失字段按默认值处理。省略新增字段时页面仍按旧阅读页展示 `metrics`、`artifacts` 等原有内容；字段名写错、枚举非法或超出上限会被严格 schema 拒绝，页面显示具体错误。`sections` 片段示例：

```json
{
  "sections": [
    {
      "kind": "gallery",
      "id": "pages",
      "title": "页面原型 / 页面预览",
      "caption": "查看全部 →",
      "items": [
        { "id": "login-page", "title": "登录页原型", "meta": "登录页", "status": "done", "image": "" },
        { "id": "forgot-password", "title": "忘记密码页原型", "meta": "忘记密码", "status": "active", "image": "" }
      ]
    },
    {
      "kind": "tests",
      "id": "tests",
      "title": "测试与验收",
      "caption": "查看详情 →",
      "metrics": [
        { "id": "pass", "label": "通过率", "value": "96", "unit": "%", "tone": "positive" }
      ],
      "progress": 96,
      "progressLabel": "测试进度",
      "checks": [
        { "id": "login", "label": "登录功能测试", "status": "passed" }
      ]
    }
  ]
}
```

- 字段名与枚举必须与 `packages/protocol/src/office-ui.ts` 一致；禁止 `null`，`url` 只能为空串或 HTTP(S) 绝对链接（生产环境建议 HTTPS）。
- 本文件只在开发环境使用，生产构建不包含预览页，也不会发布这份 mock 数据。

## 通用原语区块（v2 原型）

除前 6 种 typed section 外，`sections` 还支持 `kind: "custom"`：给一个内部版式 `layout` 和 1–24 个通用原语 `blocks`，前端按数组顺序组合渲染，不需要为长尾版式新增组件。

```json
{
  "sections": [
    {
      "kind": "custom",
      "id": "audit-highlights",
      "title": "审查要点",
      "caption": "自动生成",
      "span": "full",
      "column": "auto",
      "emphasis": "primary",
      "layout": "stack",
      "blocks": [
        { "type": "heading", "text": "本轮审查要点", "level": "h3" },
        { "type": "text", "text": "高危问题 **3** 项已全部关闭，中危 **2** 项修复中。" },
        { "type": "callout", "tone": "info", "title": "说明", "text": "原语只描述语义，颜色、间距和排版由前端决定。" }
      ]
    }
  ]
}
```

- `layout` 取 `stack`（单列）、`columns`（两列）、`grid`（自适应网格）、`cards`（网格且每块独立卡片），默认 `stack`。
- 布局令牌 `span`（`half`/`full`，默认 `half`）、`column`（`auto`/`main`/`aside`，默认 `auto`）、`emphasis`（`normal`/`primary`，默认 `normal`）只是受控提示：前端会按窄屏和内容长度调整，不是像素或 CSS。
- 12 种原语：`heading`、`text`、`keyValue`、`stats`、`table`、`list`、`progress`、`chart`、`image`、`diagram`、`callout`、`divider`；字段名、数量与长度上限见 `integration/docs/office-integration.md` 的「通用原语与组合区块」。
- `diagram` 只放 Mermaid 源文本（≤8000 字符，不传 HTML/SVG）；SSR/测试显示源码占位，浏览器里由 Pele 懒加载渲染成主题化 SVG，失败时回落源码。
- `security-audit` 案例用于演示原语组合与文件变更：`overview`（`columns` + text/stats/callout/keyValue）、`auth-flow`（`stack` + diagram）、`changes`（新增/修改文件清单与行数）、`findings`（`stack` + table/progress/list）、`distribution`（`stack` + chart/image/divider/text）与 typed `tests`/`documents` 混排。
- `login-module` 额外包含文件变更清单：新增、修改、删除、重命名、二进制文件；概览和交付物均显示，悬停可看逐行 diff，点击可固定。该示例使用 `files[].diff`，只提供行数的旧数据会明确提示缺少具体差异。
- 成果页所有 section 按数组顺序单列、上下流式渲染；`span`/`column` 字段仍可发送，但当前版本不再拆分左右栏。
- `custom` 和每个 block 都是严格对象：未知 `type`、拼错字段、超过上限（如 table 列 >6、blocks >24）都会让整份 whiteboard 校验失败，预览页显示具体错误（形如 `mock 数据第 N 条的 whiteboard 无效：…`），不会渲染半成品；改完 JSON 先确认合法再刷新。
