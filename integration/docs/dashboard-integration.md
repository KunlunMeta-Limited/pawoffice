# 办公室业务快照字段说明

本文定义办公室业务快照 `schemaVersion: "1.0"` 的字段与展示规则。外部业务后端通过[办公室 HTTP 接入协议](./office-integration.md)提交快照，PawOffice 服务端转发给浏览器页面。

业务快照决定办公室名称、会话目录、各会话成员、任务、动态和白板，以及办公室资源指标。办公室对应工作区，会话对应工作区内的一次长期对话。浏览器场景运行时管理人物位置、家具、寻路和动画。纯前端演示使用本地示例数据，服务器模式使用外部业务后端提交的数据。

## 快速联调

运行：

```bash
npm run dev
# 打开 /office/；另一个终端执行：
npm run integration-example
```

外部业务后端调用 PawOffice 的 `POST /api/pawoffice/messages`。初始化时将快照放入 `offices` 数组，更新时将快照放入 `snapshot` 字段。`npm run dev:vite` 用于纯前端本地演示。

## 业务快照 1.0

完整快照示例：

```json
{
  "schemaVersion": "1.0",
  "seq": 1,
  "workspace": {
    "id": "team-a",
    "name": "市场情报空间"
  },
  "conversations": [
    {
      "id": "main",
      "title": "登录模块开发",
      "employees": [
        {
          "id": "leader",
          "sceneActorId": "office-lead",
          "name": "王明",
          "role": "负责人",
          "online": true
        },
        {
          "id": "researcher",
          "sceneActorId": "code-agent",
          "name": "信息检索",
          "role": "检索功能",
          "online": true
        },
        {
          "id": "reviewer",
          "sceneActorId": "code-agent",
          "name": "资料核验",
          "role": "核验功能",
          "online": true
        }
      ],
      "tasks": [
        {
          "id": "task-1",
          "title": "跟踪竞品新品",
          "assigneeId": "researcher",
          "status": "running",
          "progress": 45,
          "updatedAt": "2026-09-30T10:00:00.000Z",
          "summary": "整理今日上新信息"
        },
        {
          "id": "task-2",
          "title": "核验资料来源",
          "assigneeId": "reviewer",
          "status": "blocked",
          "updatedAt": "2026-09-30T10:01:00.000Z"
        }
      ],
      "events": [
        {
          "id": "event-1",
          "kind": "task.assigned",
          "taskId": "task-1",
          "employeeId": "researcher",
          "fromEmployeeId": "leader",
          "summary": "王明分配了任务",
          "occurredAt": "2026-09-30T10:00:00.000Z"
        }
      ],
      "whiteboard": {
        "template": "task-board-v1",
        "title": "",
        "status": "queued",
        "steps": []
      }
    }
  ]
}
```

- 员工 `id` 是业务员工、功能或智能体的独立 ID；`sceneActorId` 是办公室人物 ID。多条业务记录可以绑定同一人物，人物的姓名、外观和工位保持固定。上例的检索与核验功能共用 `code-agent`。省略 `sceneActorId` 的成员显示在列表中，其任务不关联人物动画。办公室人物 ID 为：`office-lead`、`code-agent`、`file-agent`、`app-agent`、`review-agent`、`data-agent`。
- 共用小人的任务仍按各自的 `assigneeId` 独立保存、操作和统计；人物状态与电脑任务气泡使用同一条主任务：优先级为 `running` > `blocked` > `failed` > `queued` > `completed`，同级取 `updatedAt` 最新的一条，同一时间按任务 ID 升序取首条，不受数组顺序影响。完成后展示下一条未完成任务；没有未完成任务时，人物恢复空闲，但电脑气泡保留最近完成的任务，直到下一条任务接替。任务列表保留全部业务任务，不因小人数量而删减。
- 电脑气泡的绿色进度条是前端活动展示，不是业务进度：运行时由快到慢推进，最多显示 99%；仅在任务 `status` 为 `completed` 时显示 100% 和“已完成”，暂停、失败或等待时不自动推进。新任务 ID 会重置展示进度。此效果不回写快照的 `progress`，任务列表和统计仍使用后端真实数据，也不要求后端定时上报百分比。
- 同一人物绑定的成员之间交接任务时，不播放工位拜访；不同人物之间的交接由浏览器安排拜访。浏览器负责动作排队和资源占用，外部业务后端负责业务任务的并发调度。
- 成员解绑后，对应人物恢复空闲展示并清除任务标题。已接收的场景活动继续按场景指令执行。
- 任务状态可用 `queued`、`running`、`blocked`、`completed`、`failed`。`progress` 为 0–100 的业务进度，`-1` 表示未知，省略时默认为 `-1`。
- `updatedAt`、`occurredAt` 使用带时区的 ISO 8601 时间。`events` 应按新到旧排序，事件 `id` 在工作空间内保持稳定。`task.assigned` 事件可触发负责人走到员工身旁；页面首次加载时不会重放历史交接。
- `system` 可选，格式为 `{ "cpuPercent": 39, "memoryPercent": 65, "networkKbps": 15 }`。不提供时页面显示“未提供”，不生成假监控值。
- 会话 ID 在办公室内唯一；员工、任务、事件 ID 分别在所属会话内唯一。非空 `assigneeId` 必须引用同一会话中的员工；空串表示未分配。不同会话可以复用任务或员工 ID，不共享状态。PawOffice 校验完整快照，字段或引用无效时返回错误。

`seq` 是每个办公室独立递增的完整快照版本，必须提供正整数；外部业务后端重启后应继续使用递增版本。较小版本被忽略，同版本不同内容返回 `409 SEQ_CONFLICT`。`whiteboard` 为固定模板数据对象，空标题表示空白板，省略时补齐默认结构。具体内容字段见[办公室 HTTP 接入协议](./office-integration.md)。

## 必填字段与默认值

| 位置 | 必填字段 | 可选字段及默认值 |
| --- | --- | --- |
| 快照 | `schemaVersion`、`seq`、`workspace` | `conversations: []`、默认资源指标、`outputBoard` |
| `workspace` | `id`、`name` | 无 |
| 每个会话 | `id`、`title` | `employees: []`、`tasks: []`、`events: []`、默认白板对象 |
| 每个成员 | `id`、`name` | `sceneActorId: ""`、`role: ""`、`online: false` |
| 每个任务 | `id`、`title`、`status`、`updatedAt` | `assigneeId: ""`、`progress: -1`、`summary: ""` |
| 每个事件 | `id`、`kind`、`summary`、`occurredAt` | `taskId: ""`、`employeeId: ""`、`fromEmployeeId: ""` |
| `system` | 无 | `cpuPercent: -1`、`memoryPercent: -1`、`networkKbps: -1` |

每个办公室最多 100 个后端会话；每个会话的 `employees` 最多 200 项、`tasks` 最多 1000 项、`events` 最多 500 项。一次请求的整体大小限制为 64 KiB，实际可提交条目数还受文字长度影响。

`employees`、`tasks`、`events` 和 `whiteboard` 必须位于 `conversations[]` 内，不能放在快照顶层。一个会话最多一块当前目标白板，空标题表示无当前目标。前端按所选会话投影白板、人物任务、侧栏与任务列表；其他会话的业务数据仍接收并保存。切换不重建办公室，也不取消外部引擎的工作。办公室目录中的 `taskCount` 汇总所有会话任务数。

更新仍使用办公室级完整快照和 `seq`，必须包含需要保留的全部会话。省略的会话从业务目录移除，其旧聊天记录仍可在当前浏览器查看，但不再展示旧任务或白板。会话标题由后端提供；浏览器新增但尚未被后端接纳的会话为本地草稿，见[聊天接口](./chat-integration.md)。

所有字段禁止 `null`。每次更新表示该办公室的完整业务状态；空列表清空相应列表，省略的可选字段按上表补齐。需要保留的成员、任务、事件和白板内容应包含在新快照中。

可选引用可以省略或显式使用 `""`：`sceneActorId` 表示未绑定人物，`assigneeId` 表示未分配负责人，事件中的空引用表示不关联相应对象。办公室、成员、任务和事件本身的 `id` 仍须为有效的非空字符串。

任务按钮产生用户操作，由外部业务后端通过 `ui.next` 领取并处理，再提交新快照。运行 `npm run integration-ui-example` 可查看操作领取与展示结果返回的示例。

## 结果白板（可选 HTML）

协作白板保持原来的 `conversations[].whiteboard`、墙上固定模板和 Markdown 详情。新增结果通过快照顶层 `outputBoard` 提供，独立于会话；切换会话不会换掉办公室结果。页面初始显示协作，只能从墙上白板左侧的「协作 / 结果」标签切换，弹窗不提供第二处切换。

```json
{
  "outputBoard": {
    "title": "今日成果日报",
    "overviewHtml": "<div style=\"font-size:40px;color:#203450\">今日采集 <strong style=\"font-size:100px\">1286</strong> 条</div>",
    "detail": { "format": "html", "html": "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><h1>今日成果日报</h1><p>图表和明细放在这里。</p></body></html>" }
  }
}
```

- `title` 为 1–160 字；`overviewHtml` 为 1–16000 字的静态 HTML 片段，推荐使用内联 CSS。沿用原场景 `HTMLText` 渲染成纹理，设计画布为 778 × 314，其中内边距上 8、右 24、下 16、左 24。它支持 HTML 排版，不执行脚本，也不是完整网页；背景默认透明，房间图片仍提供白板边框。概览只放 2–3 个指标，示例包含销量、采集量、任务完成度和一行成果摘要，指标标签 36px、核心数字 72–92px；完整图表与明细放入详情；不要把完整日报缩小后塞进墙面。实际像素会随整个场景缩放，窄屏请点击展开阅读。
- `detail` 可省略；省略时展开显示「暂未提供结果详情」。HTML 详情使用 `{ "format": "html", "html": "..." }`，最长 200000 字，支持完整网页、CSS、脚本和图表。HTTP 请求仍受整体 64 KiB 限制，较大的报表建议托管后使用 `{ "format": "url", "url": "https://your-service.example/report" }`。地址仅支持 HTTP(S)，托管端需允许 iframe 嵌入。
- 结果详情使用原白板弹窗外壳，内部 iframe 独立滚动，`sandbox="allow-scripts"`，不授予同源、弹窗或表单权限；报表脚本无法读写办公室页面和其存储。外部图表资源需支持跨源加载。
- 后端维护结果文档和统计值，前端只展示。更新时随完整 `office.snapshot` 一起发送 `outputBoard` 并递增 `seq`；省略该字段即清空结果，页面显示「等待结果更新」，不会填充示例数据。

参考模板：[墙面概览](../../apps/web/src/whiteboard/templates/output-overview.html)、[展开报表](../../apps/web/src/whiteboard/templates/output-detail.html)。后端可替换布局和文本，模板中的 `{{sales}}` 等是需要填充并进行 HTML 转义的文本占位符。模板示例数值只在开发地址 `/?whiteboard-demo=1` 启用。

## 源码装配接口

直接集成 React 应用源码的开发者，可实现 [`OfficeDataSource`](../../packages/protocol/src/dashboard.ts) 并注入组件，用于提供、订阅和处理业务数据。HTTP 接入开发者使用 `POST /api/pawoffice/messages`。

## 边界

[`sceneBridge.ts`](../../apps/web/src/dashboard/sceneBridge.ts) 将业务状态转换为人物展示状态，并在收到新任务分配事件时安排工位拜访。业务任务完成由外部业务后端设置 `status: "completed"` 后提交快照。场景协议与地图编辑接口见[插件运行时文档](../../docs/plugin-runtime.md)。

PawOffice 服务端提供访问密钥校验、最新快照的内存缓存和消息转发。外部业务后端负责业务持久化和业务权限；部署方负责页面及浏览器消息接口的访问控制。部署配置见[部署文档](./message-relay.md)。
