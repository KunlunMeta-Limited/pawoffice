# DSH 结果区「改动了哪些文件」的实现调研

调研对象：DSH Web GUI 每轮结束时显示的「已编辑 N 个文件 +X -Y」卡片，以及下方的交付文件卡片。
目的：弄清它如何得到文件列表、行数，是否区分“修改/新建/删除”，以及 PawOffice 若要复刻应怎么做。

## 结论速览

1. **这是两条独立通道，不是一个组件**：
   - 改动卡片：来自 `workspace/changes` Session 事件 → `workspaceChanges.summary/diff` → HTTP `/api/changes.summary` / `/api/changes.diff`。数据由 **git 工作树快照**（turn 开始时拍一次，turn 结束时再拍一次）做 diff 得到，单位是“本轮（turn）”，不是整个会话。
   - 下方文件卡片：来自 `present` 工具 → `deliverables/presented` Session 事件。只记录路径 + 说明，不复制内容，**和 git 改动无关**。截图里的 `whiteboard-detail.png` / `WhiteboardDetail.tsx` / `office-ui.ts` / `result-workspace.md` 是上一轮 `present` 的产物，不是“本轮创建的 4 个文件”。
2. **改动卡片当前不区分“新建 / 修改”**：`WorkspaceChangedFile` 只有 `path/display/added/deleted/binary/oversized`，没有 `status`；标题统一叫「已编辑 {count} 个文件」。新建文件会被计入列表（通常 `+N -0`），但不会打“新建”标签。
3. **新建/删除只有在打开某个文件的 diff 时才显示**：`/api/changes.diff` 返回 `before:boolean`、`after:boolean`；`before=false` 时 UI 在 diff 上方显示「本轮新建的文件」，`after=false` 显示「本轮删除的文件」。所以“能区分”是在 diff 详情层，不在汇总列表层。
4. **要在列表里直接展示“新建了哪些文件”，需要补后端字段**：recorder 内部本来就知道 before/after 是否存在（快照树里有没有 blob、capture 是否为空），只是 `changedFile()` 把这些信息丢了。给 `WorkspaceChangedFile` 加 `status`（或 `before/after`）是小改动；否则前端只能对每个文件各发一次 diff 请求（N+1 次，且要处理 diff 限流/大文件拒绝）。
5. **重命名不会显示为“重命名”**：`git diff-tree -M` 能识别 rename，`parseNumstat` 也保留了 `oldPath`，但 `WorkspaceChangedFile` 不含 `oldPath`；UI 只会把它当作一个文本 diff 展示。PawOffice 若要支持，需要在 summary 里保留 `previousPath`。
6. **下方交付卡片是 `present` 工具**：每次最多 8 个文件（工具 schema 描述建议每次 1–2 个、最多 4 个），只校验“存在的普通文件”，记录绝对路径与可选描述；桌面端可打开/定位文件，网页端侧边栏预览。

## 一、改动卡片（已编辑 N 个文件）

### 1.1 UI 结构

源码：`dsh/node_modules/@deepseek-ai/dsh-client-ui-deliverables/lib/client.js`

- `ChangedFiles`
  - header：文件图标 + 标题（`changes.title`: “已编辑 {count} 个文件”；单文件时 `changes.singleTitle`: “已编辑 {name}”）+ 总行数（`+509` / `-220`）。
  - 列表：默认最多 `COLLAPSED_ROWS = 4` 行；超过 4 个时显示「全部 N 个文件 / 收起」折叠按钮。
  - 每行：`display` 路径 + 该文件 `+added` / `-deleted`；二进制显示“二进制”，超大显示“过大”。
  - 行/头部点击打开右侧栏 review（`dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>`）；鼠标悬停 500ms 显示 diff 预览。
  - 折叠状态只展示前 4 行，但 `changes.total` 仍是全量数字（`files` 最多 `maxFiles` 条）。
- review 面板（`ReviewTab` + `FileDiff`）
  - 顶部文件选择器；diff 前有一条 note：
    - `!diff.before` → `diff.created` = “本轮新建的文件”
    - `!diff.after` → `diff.deleted` = “本轮删除的文件”
    - 无 hunk 变化 → “两侧内容相同”
  - 支持 unified/split、自动换行、打开整个文件；二进制/超大文件分别显示拒绝原因。
  - 行数来自 `/api/changes.diff` 的 hunks（`+`/空格/`-` 前缀），大文件超时则退化为整文件替换（`diff.coarse`）。

### 1.2 数据形状

前端校验与后端服务声明（源码）：

```ts
// WorkspaceChangedFile
{
  path: string;      // 相对 Session cwd 的稳定路径（durable path）
  display: string;   // 展示路径（相对 workspace root，必要时绝对）
  added: number;
  deleted: number;
  binary?: true;     // 二进制：行数恒为 0，diff 只返回 kind:'binary'
  oversized?: true;  // 超过 maxFileBytes：行数恒为 0，diff 只返回 kind:'oversized'
}

// WorkspaceChangesSummary
{
  turn: number;      // 第几轮
  cwd: string;
  files: WorkspaceChangedFile[]; // 最多 maxFiles=500（默认），按 display 排序
  total: number;     // 截断前的总文件数
  added: number;     // 全部文件行数合计（注意：按截断前 sorted 求和）
  deleted: number;
  snapshot?: { before: string; after: string }; // 两个 git tree id（不发给前端展示）
}

// WorkspaceFileDiff
{ kind: 'text', path, display, before: boolean, after: boolean, hunks: [{oldStart,...lines:string[]}], coarse: boolean }
| { kind: 'binary', path, display }
| { kind: 'oversized', path, display }
```

### 1.3 数据怎么产生

源码：`@deepseek-ai/dsh-workspace-changes`（Host 插件）

- 每个顶层 Session 一个 `TurnRecorder`：
  1. `turn/start`：`snapshotTree()` 用临时 index 执行 `git add --all --ignore-errors` + `git write-tree`，得到 turn 起点的工作树 tree id（包含未跟踪文件，排除 `.gitignore` 的路径；子模块/gitlink 不进入）。
  2. 文件工具执行前：`capture(path)` 保存整文件副本（只在本轮第一次修改该路径时），覆盖 git 忽略文件、工作区外文件、非 git 仓库场景。
  3. `turn/end`（或 `stopping`）：再拍一次 `snapshotTree()`，`git diff-tree -r -M -z --numstat <before> <after>` 得到每个路径的增删行数、二进制标记、rename 的 `oldPath`；再对未被快照覆盖的 captured 路径做文件副本比较。
  4. append `workspace/changes` 事件，只带 `{ turn }`；summary 与 diff 源数据留在内存 `records` 里，供 `workspaceChanges.summary(sessionId, seq)` / `.diff(sessionId, seq, index)` 查询，Session dispose 后清空。
- 限制（默认配置）：
  - `maxFiles: 500`
  - `maxFileBytes: 2 MiB`（超过标 `oversized`，不算行数）
  - `diffTimeoutMs: 100`（逐行比较超时 → `coarse` 整文件替换）
  - `timeoutMs: 30s`、`outputMaxBytes: 8 MiB`
- 非 git 仓库 / Host 没有 git：只汇总“文件工具实际改过的路径”，同样走 capture 比较，没有 tree snapshot。
- 子 Session（subagent）不记录；只有顶层 Session 产生 `workspace/changes`。
- 前端消费：
  - 会话事件流里匹配 `workspace/changes`，拿到 `seq` 与 `turn`；
  - 用 `/api/changes.summary?sessionId&seq` 拉 summary（带缓存、连接替换时清空）；
  - hover/点击时用 `/api/changes.diff?sessionId&seq&index` 拉单个文件 diff；
  - `/api/changes.open` 用系统默认应用打开源文件。
- 相关 Session 事件：`workspace/changes: { turn: number }`；`deliverables/presented: { turn, callId, files[] }`。

### 1.4 为什么截图中没有“新建文件”标签

- `changedFile()` 只输出 `path/display/added/deleted/binary/oversized`，把 `diffTrees` 里的 `oldPath` 与“before/after 是否存在”都丢掉了。
- 新建文件确实在列表中，只是和修改文件一样显示路径 + `+N -0`，标题统一是「已编辑」。
- 若要“列表直接区分”，可选三种做法：
  1. **改 DSH 后端（推荐）**：`WorkspaceChangedFile` 增加 `status: 'added'|'modified'|'deleted'|'renamed'`（recorder 在 tree diff / capture 比较时本来就知道），或至少加 `before:boolean` / `after:boolean`；前端行首加状态胶囊，标题可拆成「新建 N · 修改 M · 删除 K」。
  2. 前端按需拉 diff：展开/悬停时请求 `/api/changes.diff`，用 `before/after` 推断；成本是每个文件一次请求，不能用于首屏统计。
  3. 只按 `+N -0` 猜测“新建”：不可靠（纯追加内容的修改、二进制新文件都会误判），不建议。
- 行数也不适合作为判断依据：新建文本文件通常 `deleted=0`，但修改文件也可能只增不删；二进制/超大文件行数强制为 0。

## 二、交付文件卡片（截图下方四张卡）

源码：`@deepseek-ai/dsh-tool-present` + `@deepseek-ai/dsh-client-ui-deliverables` 的 `PresentRow` / `PresentedFileCard`

- 工具名 `present`，参数：

```ts
present({ files: [{ path: string; description?: string }] })
```

- 校验：路径必须在当前 Session 文件系统可访问、必须是普通文件、不能是目录/最终符号链接；相对路径按 Session 工作目录解析；不读取内容、不复制内容。
- 成功后 append `deliverables/presented`：

```ts
{ turn: number, callId: ToolCallId, files: [{ path: string, description?: string }] }
```

- 每次调用 `maxFiles` 默认 8（工具描述建议 1–2 个、最多 4 个）。
- 卡片：文件名 + 描述 + 文件类型图标；提供“在侧边栏预览 / 用默认应用打开 / 在文件管理器中显示”（浏览器环境只能预览）。
- 语义上与 git 改动无关：可以是本轮新建的，也可以是早就存在、本轮只是交付；同一文件可以既出现在 changes 又在 present 里出现两次。
- 因此 **不能用 `present` 卡片统计“本轮新建了哪些文件”**。

## 三、如果 PawOffice 要复刻

### 3.1 推荐的信息模型

不要复用 `present`（交付）语义，单独增加“本轮文件变更”：

```ts
// 建议加入 result-v1（或 result-v2 的新 kind）
{
  kind: 'changes',
  id: 'changes',
  title: '本轮文件变更',
  files: [{
    path: 'apps/web/src/components/WhiteboardDetail.tsx',
    previousPath: '',                          // 仅 renamed 时非空
    status: 'added' | 'modified' | 'deleted' | 'renamed',
    added: 22,
    deleted: 12,
    binary: false,
    oversized: false
  }],
  total: 17,
  added: 509,
  deleted: 220
}
```

- `status` 必须由后端计算（不要在渲染层猜）。
- `files` 上限建议 12–20；`total/added/deleted` 是全量统计；二进制/超大分别标记，不发 diff 正文。
- 前端卡片：头部「本轮编辑 17 个文件 · +509 −220」；行首状态胶囊（新建/修改/删除/重命名）+ 路径 + `+N −M`；默认折叠 4 行；点击行打开该文件 diff（可复用 DSH 的 review 思路：按需请求 diff，或直接展示交付物）。
- 主题/安全：路径只做文本；不发绝对路径、HTML、CSS；diff 懒加载并限制大小。
- 兼容：`changes` 是新 kind，旧版严格 schema 会拒绝整份结果 → 通过 `office.capabilities` 的 result schema 做能力协商，或放进 `custom` 的预留 block（但语义化 kind 更好）。

### 3.2 后端变更检测的两条路

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A. git 快照（DSH 同款） | turn 开始 `git add -A && git write-tree`，结束再拍；`git diff-tree -r -M --numstat` | 覆盖任意文件写入（包括 shell、生成器、present 之外的操作）；rename 可识别 | 依赖 git；大仓库快照/tree 有成本；非 git 工作区要退化 |
| B. 工具事件聚合 | 拦截 `write/edit/apply_patch` 等工具，按路径维护“第一次写入前内容哈希/副本”，结束后比较 | 不依赖 git、精确到工具 | 漏掉 shell 重定向等间接写入；rename/删除需要额外处理；跨轮状态要持久化 |

若 PawOffice 的“编辑文件”都来自受控工具（write/edit），B 的工程量更小；若要覆盖“执行命令生成的文件”，A 更稳。二者可以合并：B 负责在工具调用时记录 before 快照，A 负责补充 git 能看到的其他变化。

### 3.3 渲染层可复用的部分

PawOffice 已有 `result-v1` / `result-workspace` 和 v2 原语注册表：

- 新 `changes` section 可直接复用 `ResultWorkspace` 的卡片外壳、两栏布局、`data-emphasis` 等；
- 行的 `+N/-M` 颜色、状态胶囊可复用 v2 `table` 的 `status`/`number` 格式器；
- 若只做“原型展示”，可以先用 `custom` section + `table` 模拟，但真正接入建议加 typed `changes`（字段固定、可校验、可导出 Markdown）。

### 3.4 工作量估算

| 范围 | 内容 | 估算 |
| --- | --- | --- |
| 协议 + 渲染 | `changes` section schema、ResultWorkspace 卡片、折叠/状态胶囊、Mock、测试 | 1.5–2.5 人日 |
| 数据采集 A（git） | turn 前后快照、diff-tree、rename/二进制/超大处理、上限 | 1.5–3 人日（Windows/large repo 需打磨） |
| 数据采集 B（工具事件） | 写前快照、路径归一化、跨轮存储 | 1–2 人日 |
| diff 查看器（可选） | 点击行看 before/after、懒加载、超时降级 | 2–4 人日 |
| 合计（不含 diff） | 只做“本轮变更列表” | 约 3–5 人日 |

## 四、复现这次调研（源码位置）

本机 DSH 安装目录：

```text
D:\Program Files\deepseekharness\resources\app.asar
```

asar 内相关包（可用 asar 头解析后按偏移抽取，本次调研已用 Python 临时解析，未改动安装目录）：

- `dsh/node_modules/@deepseek-ai/dsh-client-ui-deliverables/lib/client.js`：`ChangedFiles`、`FileDiff`、`ReviewTab`、`PresentRow`、`PresentedFileCard` 与中英文案。
- `dsh/node_modules/@deepseek-ai/dsh-client-ui-deliverables/lib/index.js`：`/api/changes.summary`、`/api/changes.diff`、`/api/changes.open`、`/api/present.*` 路由注册。
- `dsh/node_modules/@deepseek-ai/dsh-workspace-changes/lib/types/recorder.js`：`TurnRecorder`、`workspace/changes` 事件、summary/diff 服务。
- `dsh/node_modules/@deepseek-ai/dsh-workspace-changes/lib/types/git.js`：`snapshotTree`、`diffTrees`、`gitlinkPaths`、`ignoredPaths`。
- `dsh/node_modules/@deepseek-ai/dsh-workspace-changes/lib/types/numstat.js`：`--numstat -z` 解析（added/deleted/binary/rename oldPath）。
- `dsh/node_modules/@deepseek-ai/dsh-tool-present/lib/index.js`：`present` 工具、`deliverables/presented` 事件。
- `dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js`：`workspace/changes` 事件类型登记。
