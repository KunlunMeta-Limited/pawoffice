# PawOffice 现状代码地图（raw-codebase 暂存稿）

> 约定：未标注=代码/文档事实（含 file:line）；标【推断】=我的判断，需原型或运行验证。行号对应当前工作树。全程只读，未跑 build/test。规模：11 个 workspace 包（packages/*），正式页面在 apps/web，独立示例在 examples/。

## 1 决策层现状：谁决定人物行动

**结论：仓库里没有"自主决策"模块。** `SceneRuntime` 是唯一状态写入口（packages/runtime/src/SceneRuntime.ts:144-179），它只执行已被提交的 `activity.start`/`immediate` 命令；谁"想做什么"完全由提交方决定。全仓 `type: 'activity.start'` 的提交点共 8 类（含零散入口，路径已逐一核对）。

| # | 通道 | 触发条件 | 互斥 / 打断 | 确定性 / 存档 | file:line |
|---|---|---|---|---|---|
| 1 | **外部业务后端命令**（协议 2.0 relay） | 后端经 Fastify/SSE 下发 `{teamId, command}`；办公室集成会话解析 relay 消息 | 单条命令走 `ordered:true` FIFO（同运行时内串行）；`busyPolicy` queue/reject；`command.cancel`/`activity.stop` 走预留控制位立即处理 | 内容由后端决定；命令进 checkpoint 记录，重启后非终态命令失败、不重放 | apps/web/src/application/OfficeIntegrationSession.ts:174-183；packages/runtime/src/adapters/messages.ts:48-56；SceneRuntime.ts:174,267-274,286-295,568-573 |
| 2 | **页面 UI 手动命令** | 人点"拜访工位/开始专注/召集会议/使用家具/结束活动"；或协议面板贴 JSON | 与 1 相同的 runtime 规则；编辑期间一律拒绝（Snapshot.editing） | 人决定；命令入记录 | apps/web/src/components/SceneControlPanel.tsx:44,45,48-52,54,65-77,82；SceneRuntime.ts:170 |
| 3 | **officeDemo 演示脚本** | 手动开启演示源后每 tick 派一轮 `office.visit` / `scene.move` 回座 | 等"无 active 活动、无 queued、全员无 motion/step/seatTransition"再派（:44,47-48）；任一失败即停并置 error（:58-62）；`returning` 优先回座（:47-48）；真实数据团队不允许此源 | 轮转配对由 round 计算，话题按 round/index 取（确定性）；不写业务任务；命令同样入 checkpoint | apps/web/src/dashboard/OfficeDemoSource.ts:32-63；apps/web/src/scene/systems/officeDemo.ts:14-38,40-49；OfficeTeamSession.ts:57,79 |
| 4 | **CommerceSceneQueue 业务演示脚本** | `visit(stops)` 入队，一次只跑一个 job | 前一个 job 终态才起下一个（:45-56）；`stop()` 取消并让全员回座（:58-64）；用"回应阶段已过/完成"判断交付，不用走路时长（:28-44） | 站点顺序按任务与距离排（CommerceDemoRun.ts:66-88）；业务状态由 source 自己更新，动画不完成业务 | apps/web/src/application/CommerceSceneQueue.ts:18-57；apps/web/src/application/CommerceDemoRun.ts:66-88 |
| 5 | **DashboardSceneBridge 业务映射** | 业务快照 sync：任务 running/blocked→`actor.presentation.set`；`task.assigned` 事件→`office.visit` | 不主动取消；presentation 用递增 sourceRevision；白板走 `object.state.set` | 由业务数据决定；仅记录已见事件防重放（:60-66） | apps/web/src/dashboard/sceneBridge.ts:23-82（尤其 :46-58,:60-79） |
| 6 | **OfficeIdleCoffee 本地空闲行为**（自主性最强） | 250ms 轮询：`enabled && !suspended && !editingRequested && !returning && !managed`，无其它活动，候选者 idle/有工位/在座/无锁定/冷却到 0 | 单名额 landmark 资源（跨办公室独立）；`beforeCommand` 钩子：任何外部 `activity.start` 先中断咖啡并给参与者加冷却（:88-103）；presentation 更新也加冷却并中止（:97-101）；`suspend/interrupt/prepareEditing`（:47-59,:79-87） | 随机（可注入 `random`，默认 Math.random），候选带 shuffle/久未休息优先/降低近期搭档（:159-168）；cooldown/lastRest 只在内存（:19-21），不进存档；命令入 checkpoint，重启只产生结束事件 | packages/scene-office/src/core/OfficeIdleCoffee.ts:88-103,109-186,201-213；idleCoffee.ts:46,78-80 |
| 7 | **farm tendFarm 照料脚本** | examples/farm 开启自动照料时调用（web 不调用） | 跳过 busy actor、已占用 plot、被占 work anchor、需要但被占的收获箱；`busyPolicy:'reject'` | 打分：ops 优先级(plant 优先)→距离→跳过 blocked（:17-23）；只提交能力，不写作物状态（complete 在插件里） | packages/scene-farm/src/core/supervisor.ts:6-29；examples/farm/src/controller/useFarmController.ts:30 |
| 8 | 其他零散提交点 | 地图编辑器 `map.edit`、`office.emote`、`furniture.use`、`scene.move`、JSON 面板 `submitBatch` | 全部走同一 runtime | — | apps/web/src/components/map-editor/commands.ts:16；OfficeScene.ts:98-101；SceneControlPanel.tsx:54,70；examples/classroom/src/controller/useClassroomController.ts:100 |

注：`apps/web/src/application/decisions/DecisionSession.ts` 等"decisions"是**业务审批/人工选择**（外部决定），不是人物 AI 决策（OfficeTeamSession.ts:61-66, OfficeIntegrationSession.ts:366-380）。

**"自主型决策"目前缺什么（按依赖顺序）：**
1. 无需求/目标模型：`Actor` 只有 position/facing/posture/presentation/speech/expression/using/step（packages/runtime/src/model.ts:20-29），没有 needs/mood/goal/intent 字段；checkpoint 只存 world/records/activeActivities（SceneRuntime.ts:542-543）。
2. 无动作选择器：runtime 不选择 capability，只解析已给的 `capability`+`participants`+`params`（SceneRuntime.ts:219-226）；`ActivityPlan` 的 phases 由插件写死（model.ts:54-59）。
3. 打分逻辑是两份私有硬编码：`tendFarm` 的 sort（supervisor.ts:22）与 `OfficeIdleCoffee` 的 shuffle+sort（OfficeIdleCoffee.ts:159-168）；不可复用、不可观测、不入存档。
4. 可行性查询四处重复实现：`reachable`（OfficeIdleCoffee.ts:201-213）、`blocked` 手写格比较（supervisor.ts:19）、`navigation.path` try/catch（navigation.ts:78-82）、`movement.resolve` 的候选比较（movement.ts:80-144）。没有统一 affordance/utility 查询接口。
5. 冲突只靠资源 claim + busyPolicy，没有"谁更该做"的仲裁层；同一 actor body claim 天然互斥（SceneRuntime.ts:92,229-236）。
6. 活动结束后无后续计划：`endActivity` 只清理移动/讲话/资源（SceneRuntime.ts:455-482），没有"完成后决定下一步"的钩子（`beforeCommand` 只在提交前，:111-114）。
【推断】最短路径是把 3+4 抽成 runtime 之外的 `DecisionDirector`（纯函数候选枚举 + 打分 + 提交命令），而不是改 runtime。

## 2 交互对象层现状：能和什么互动、怎么互动

### 2.1 家具模板 schema（`Template`，packages/runtime/src/model.ts:31-39；交互 `FurnitureInteraction` :10-13）
字段只有：`id/name/view`、`footprint`（整数 `Box`，半开区间）、`anchors: Record<string,Point>`（相对原点的整数格偏移）、`optionalAnchors`、`interactions: Record<id,{name,anchor,approaches[],cells[],facing,posture,requiresHome?,resource?}>`、`resources: Record<string,capacity>`、`initialState`。
- **没有** contact/socket/接触面字段，**没有** use-slot 数量概念（多占用只能靠多个 anchor + 多个 interaction/resource），**没有** occupancy 表：占地格默认禁止通行，唯一例外是交互的 `cells`（navigation.ts:42-46,66；plugins.ts:7-21 校验：入口必须在占地外、`cells` 必须在占地内；交互声明的 resource 若在模板中登记，容量必须为 1（:19））。
- 场景实例可覆盖 anchors（`Prop.anchors`，model.ts:30；解析优先级见 navigation.ts:20），但座位相关锚点在地图编辑时禁止单独移动（MapDraft.ts:33-37 `FIXED_SEAT_ANCHOR`）。
- 例子：工位 2×2、座位置于内部下排两格、入口 seatLeft/seatRight（scene-office/src/core/objects.ts:7-12）；白板 2×1、4 个 attendee anchor、interaction `write` 用 resource `meeting`（:13-16）；宽桌工位 4×3 只封锁 y=1..2 行并留出后排通道（referenceOffice.ts:16-25）；教室课桌 3×3（scene-classroom/src/core/objects.ts:12-19）。

### 2.2 capability 如何声明参与者/参数/构建 Phase
`Capability = {id,name,params:Zod, participants?{min,max,roles[],rules[]}, build(ctx,params):ActivityPlan, complete?(ctx,params):ObjectStateChange[]}`（packages/runtime/src/plugins.ts:24-30）。
- **事实：`participants` 只用于 `describe()` 输出**（plugins.ts:117-120）；执行时 runtime 只校验参与者非空/不重复/实体存在（SceneRuntime.ts:220-221），角色与规则完全由各 `build()` 自己校验（例：pack.ts:40-44、teaching.ts:13-31、activities.ts:12）。
- Phase 由插件手写：`{title, moves[], durationMs, actions[{actorId,actionId}], speech[], poses[]}`（model.ts:54-59，planSchema 限制 phases≤100、每阶段 moves/actions/poses/speech≤24：SceneRuntime.ts:35-43）。例：拜访 5 阶段/站（pack.ts:46-59）、家具使用 3 阶段（pack.ts:113-118）、农场 2 阶段+完成提案（activities.ts:27-48）、课堂讲解/回答（teaching.ts:46-72）、咖啡 1+2N 阶段（idleCoffee.ts:64-80）。
- `actions` 的 `actionId` 是语义动作（如 `office.coffee.sip`、`farm.water`），不进 runtime 行为，只被表现层读（见 §3）。
- `complete()` 是纯状态提案，由 runtime 统一校验资源/版本后先持久化再应用（SceneRuntime.ts:484-518）。

### 2.3 资源 claims / landmarks / anchor 预约如何避免多人冲突
- 资源在构造与提交时登记：`actor:<id>:body|speech`、`prop:<id>:<key>`（模板 resources + 每个交互的 resource/id 默认 1 容量）、`anchor:<propId>:<anchor>`、`landmark:<id>:<key>`（SceneRuntime.ts:90-107）。
- `buildPlan` 自动补 claim：绑定工位的身体 claim→座位资源（:229-236）；每个 move 的 interaction resource（:237-244）；**目标 anchor 与所有 alternatives 各 1 个 anchor 资源**（:245-249）。因此"一个站位同时只能一人"，白板多人靠 attendee1..4 不同 anchor（objects.ts:16）。
- 占格冲突另由导航/占位检查：`occupiedCells`（cellMovement.ts:8-14）、`walkable` 对他人格与 blockedAreas 的判断（navigation.ts:33-47）、movement 候选排除 `TARGET_OCCUPIED/TARGET_RESERVED`（movement.ts:104-111）。
- 抢占用公平排队：pump 里同批竞争失败的资源记入 `blockedResources`，后来活动不能跳过（SceneRuntime.ts:279-296）；资源原子取得（resources.ts:12-31）；冲突命令有界排队≤128（:167）。
- landmark 用于不随布局移动的固定点（咖啡窗 `office.coffee-window` + 5 个 window anchor、单名额 `visitor` 资源）：scene-office/src/core/coffeeLocations.ts:1-8；idleCoffee.ts:46,78-80；注册/校验见 plugins.ts:56-60。

### 2.4 入座 / 离座
- 入口求解：`SeatInteractions.ports()` 对每个 approach 生成 `{seat,approach,passage}` 局部通道，用 `navigation.path(..., {contact,within})` 验证（seatInteraction.ts:24-37）；`MovementController.resolve` 比较离开口×入出口的完整路线距离，选最近合法组合并排除被占/被预订格（movement.ts:112-143）。
- 状态机：`begin` 写入 `actor.seatTransition`（stage aligning/entering/sitting/rising/exiting，seatInteraction.ts:45-52），`advance` 逐格走完再坐/起身，进度与 `seatedAmount` 供表现层（:67-112）；坐姿对齐 120ms、姿态过渡 520ms（:9,100）。
- 取消/恢复：`recover` 沿已走通道回退（:53-66）；入口持续被堵 8s 抛 `SEAT_BLOCKED`（:79），通道持续被占 12s 抛 `TRAFFIC_BLOCKED`（movement.ts:149）。
- 存档/布局恢复：`restoreBoundActor` 按模板 anchor+posture+facing 复位（furnitureBinding.ts:4-13），`restoreInteractionFacing`（:15-19）；坐姿完整性的硬校验在 SceneRuntime.ts:345-355（不在座但声明 seated → `NOT_AT_SEAT`）。
- 视觉只对齐最后站位：`actorVisualPose` 只对 seat 交互做像素对齐与入座插值（scene-office/src/pixi/projection.ts:50-69），`seatPixels` 硬编码 +25/-10（:12），步长按像素折算（:44-48）。

### 2.5 地图编辑器家具目录与可放置家具
- 目录 = `runtime.templates()`（已启用插件的全部模板）：apps/web/src/components/map-editor/RoomEditor.tsx:103；放置走 `map.edit` 命令（commands.ts:16）。
- 事务/校验：`MapDraft.patch` 支持 `map.replace/floor.set/prop.put/prop.remove/blocked.put/blocked.remove/binding.set`（MapDraft.ts:80-104）；结构错误整批拒绝、几何错误可留草稿（:98-101）；提交前重校验占地/导航并先存档再换地图（SceneRuntime.ts:428-445）；协议见 docs/map-editor.md:91-127。
- 视图按 `template.view` 查 `PropViewRegistry`，未注册回落占位方块（packages/renderer-pixi/src/PropViewRegistry.ts:15-22,29-33）；办公室注册 `workstation`/`whiteboard`（scene-office/src/pixi/views/index.ts:34-38），参考办公室另注册 reference 视图（pixi/views/referenceOffice.ts）。
- **【事实】能放什么不等于能演什么**：放入一个没有视图的模板会显示占位；放入一个没有对应姿态素材的交互会在执行时 `UNSUPPORTED_POSE`（actionContract.ts:19-21）。

### 2.6 教室与农场如何复用
- 教室：`classroomScenePack` = `scenePrimitives + classroomObjects + classroomTeaching`（scene-classroom/src/core/index.ts:12-17）。只有课桌有 interaction（seat），黑板只有 anchors（teacher/speaker）没有 interaction，教师"讲台前"是普通 move 到 anchor（teaching.ts:50），所以"能对黑板做什么"仍由 capability 硬编码，模板不表达。
- 农场：`farm.plot`/`farm.store` **都没有 interactions**，只有 `anchors.work/front` + resources（cultivation/inventory，world.ts:12-15）；`farm.plant/water/harvest` 在 build 里手工 claim `prop:<plot>:cultivation`（activities.ts:28-29），`work` anchor 容量 1 保证一格一人。
- 两者都复用同一 runtime/导航/座位状态机，只各自换 core 插件与 presentation pack（README docs/architecture/README.md:69-72；architecture.test.mjs 用例 "classroom and office are peer scenes..."）。

### 2.7 "今天新增一种家具 + 一种交互"要改哪些文件（真实清单，以文档里的饮水机 `drink` 为例，docs/integer-grid-and-interactions.md:18-49）
1. 模板数据：`packages/scene-office/src/core/objects.ts:6-17`（或新文件）并注册到 `builtinPlugins`（pack.ts:120）或 reference 插件（referenceOffice.ts:12-33）。
2. 新能力（若需要专属行为/多人/完成效果）：在 pack.ts 加 `ScenePlugin + Capability`（模板参考 :104-118 `furniture.use`，它已能通用驱动"任意 furniture interaction"，所以简单交互可零代码）。
3. 家具视图：新 view 文件 + `createOfficePropViews` 注册（pixi/views/index.ts:34-38），并在 `loadObjects` 里加载贴图（scene-office/src/pixi/assets/loadOfficeAssets.ts）。
4. 素材：`public/assets/office/*` 与构建脚本（scripts/build-office-assets.mjs / build-visual-manifests.mjs）。
5. 动作/姿态契约（若交互要新姿态或新语义动作）：`assets-office/src/frame/bindings.ts:19-42`、`scene-office/src/core/poseSupport.ts:11-13`，且人物包必须真有所需 clip（docs/character-packs.md:94-98）。
6. 资源名与容量：模板 `resources`（模型侧）+ runtime 自动登记（SceneRuntime.ts:92-100），无需改 runtime。
7. 外部协议：**不用改**（`describe()` 自动导出新模板/能力，plugins.ts:117-120；协议 2.0 的 `params` 是 JSON object，protocol/src/index.ts:19-20）。
8. 测试：至少 `tests/seatInteraction.test.mjs`（已有 "a plugin-defined standing appliance can occupy an internal use cell" 作模板）、`tests/mapEditor.test.mjs`（目录放置）、`tests/architecture.test.mjs`（依赖边界）。
计：**代码改动点 ≈ 4-8 处、跨 4 个包（runtime 0 处、scene-office 2-3 处、assets-office 0-1 处、apps/web 0-1 处）+ 2-3 个测试文件**；如果沿用 `furniture.use` 则不新增能力代码，若需要新表现/完成效果则要写新 capability+manifest 变体。
【推断】真正的成本不在模板字段，而在视图、素材与"到位后能不能演"（姿态/动作契约），这也是 Smart Objects 想解决的部分。

### 2.8 为什么"任意家具接触适配"目前不支持
1. 契约允许 contacts/contactProfileId，但**生产链路没有任何 contacts 生产者**：办公投影只在 seated 时给固定 `contactProfileId:'office-desk-v1'`（scene-office/src/pixi/index.ts:36），`AnimationPresenter` 只是原样转发 `intent.contacts ?? []`（renderer-pixi/src/presentation/AnimationPresenter.ts:44），全仓无代码把家具几何换算成 `ContactTarget{socketId,position,toleranceDu}`（contracts/src/animation.ts:15-22）。
2. 帧适配器**明确拒绝非空 contacts**（animation-frame/src/FrameAdapter.ts:99），socket 白名单只有 `root.ground`/`ui.label`（:45,109-113）；其他挂点必须返回 undefined，不能用原点伪造（docs/architecture/extension-contracts.md:111）。
3. 家具模板没有接触面概念（model.ts:31-39），`contactProfiles:['office-desk-v1']` 只是素材兼容声明（assets-office/src/frame/bindings.ts:46），没有求解器消费；宿主不做通用 IK（extension-contracts.md:113）。
三层数据（家具接触几何 / 世界→du 目标 / 可重定向适配器）都缺，因此"任意家具"不成立。

## 3 动画表现层现状：身体怎么完成动作

### 3.1 语义 actionId → 帧采样链路（6 段）
runtime Actor → 场景投影 `projectActors`（renderer-pixi/src/ScenePresentationPack.ts:28，办公室实现 scene-office/src/pixi/index.ts:28-52）→ `ActorIntent{actionId,poseId,view,speech,progress,contactProfileId}`（contracts/src/presentation.ts:3-11）→ `AnimationPresenter.sample` 生成 `EntityPresentation`（request + actions[含时钟] + contacts，animation.ts:19-27；presenter:28-51）→ `FrameAdapter.sample` 选 clip+时间（FrameAdapter.ts:84-108）→ `FrameSprite.renderClip`→`sampleCharacterLayers`（animation-frame/src/FrameSprite.ts:39-40；assets-office/src/frame/packSchema.ts:60-74）。
- manifest 由 `bindOfficeFrames` 生成：`variantId = ${actionId}.${poseId}.${view}`，bindings 指到角色包 clip（assets-office/src/frame/bindings.ts:9-18）；语义集合 `core.idle/walk/sit-down/stand-up/speak/emote.*`、`office.type`、`office.coffee.hold/sip`（:19-42）。
- 语义→姿态的办公室映射：`characterPoseClip`（posture×facing→idle.*/sit.back/talk.seated-*，poseSupport.ts:4-6）；`supportsOfficePose` 在素材加载前就断言标准包能力（:11-13）；apps/web 用已加载 manifest 的真实能力覆盖（OfficeScene.ts:46-50）。
- 时钟三态由宿主算：`time`（elapsed/loop）、`progress`（坐起进度）、`distance`（travelledDu/strideDu）（animation.ts:9-13；AnimationPresenter.ts:44-51：walk 用 distance，sit-down/rising 用 progress，其余 time；转身保留步态相位、换动作重置 :30）。

### 3.2 poses / lookAt / facing / posture 的运行时含义
- `Phase.poses` 同时是**到位后的目标姿态**和**候选站位过滤条件**（model.ts:58-59；SceneRuntime.ts:327-332）；`movement.resolve` 对每个候选 anchor 先 `resolvePoses`，不支持就记 `UNSUPPORTED_POSE` 并换候选（movement.ts:95-103）；阶段真正就绪前再整体校验一次（SceneRuntime.ts:343-356）。
- `lookAt` → `facingToward` 由坐标算朝向；`lookAt` 与显式 `facing` 不能同时给（actionContract.ts:17-18；SceneRuntime.ts:251-254）。
- `posture` 决定座位语义与视觉：seated 必须真在座位上（NOT_AT_SEAT，SceneRuntime.ts:345-355）；`expression` 只影响表现（`customAnimation`→`apartmentPoseForState`，scene-office/src/adapters/office.ts:41-43；pixi/posePolicy.ts:5-11）。
- 说明：runtime 只懂四向 facing + 两姿态；没有关节/接触/倾斜度的概念。

### 3.3 `AnimationAdapter<Container>` 契约要点（contracts/src/animation.ts:68-87）
`acquire(manifest,signal)` → `VisualAssetLease{assess,prepare,create,release}` → `AnimatedVisual{root,sample,getSocket,getHitBounds,dispose}`。
- FrameAdapter 实现：版本/adapterId/source.format 校验（:32-37）、组合限制（必须 1 base + ≤1 speech、无 gesture，:38-43）、speech 只能 time 时钟（:44）、socket 白名单（:45）、资源引用计数与晚到释放（:56-59,130）、prepare 只准备不推进（:70-78）、sample 不写世界（:84-108）、dispose 只销毁自己节点（:115-118）。
- 宿主侧：`ActorView` 每帧 `lease.create` 的实例 `sample`（renderer-pixi/src/ActorView.ts:64-72），`getSocket('ui.label')` 决定名字高度（:83），hitArea 用 `getHitBounds`（:95）；租约生命周期与并发加载见 AnimationResources（presentation/AnimationResources.ts:17-34,56-62）与 AnimationRegistry（多适配器注册，animation/AnimationRegistry.ts:7-21）。

### 3.4 FrameAdapter 对非空 contacts
`if (state.contacts.length) throw new Error('Frame contact retargeting is not supported; use a compatible authored contact profile')`（animation-frame/src/FrameAdapter.ts:99）；回归测试 tests/animationAdapter.test.mjs:137-138。`contactProfileId` 只做"清单里有没有"的校验（contracts/src/animationSupport.ts:13），不触发任何重定向。

### 3.5 骨骼适配器预留情况
- 契约位留了：`adapterId/adapterApiVersion/rendererApiVersion:'pixi-1'`、`capabilities.sockets{policy:'stable'|'animated'}`、`contactProfiles`（animation.ts:36-41）、`root.ground`/`ui.label` 两个已实现 socket；注册表可同时挂多个适配器（AnimationRegistry.ts:7-21）；骨骼包方向与验收清单写在 docs/architecture/README.md:68,139,147-151 与 extension-contracts.md:146-155。
- **事实：仓库没有骨骼包**（packages/ 11 个中无 animation-skeleton）；生产唯一适配器是 FrameAdapter（apps/web/src/application/OfficeScene.ts:61）；examples/dimetric 有测试替身适配器（examples/dimetric/src/appearance.ts:47 实现 getSocket），文档明确"测试替身不等于真实骨骼"（docs/architecture/migration-and-acceptance.md:37）。

### 3.6 嘴层 / 工位特效等分层素材：已存在
- 嘴层：`manifest.mouth` + 逐帧挂点 `mouth:{x,y,view,scale,rotation}`，`sampleCharacterLayers` 产出 body+mouth 两层（packSchema.ts:66-74；docs/character-packs.md:116-124）；`FrameSprite` 用独立 `mouthSprite` 跟随镜像/缩放/旋转（FrameSprite.ts:17,78-95）。
- 工位/物品特效：`public/assets/office/effects/work-crafting-lite-v1.png` 图集 + `OfficeWorkEffect`（160px 单元、逐帧时长；scene-office/src/pixi/effects/OfficeWorkEffect.ts:8-19,53-60）、`OfficeMonitorScreen`；工作面 landmarks 在 `workstationSurface.ts:22-42`。
- 家具分层：`public/assets/office/{desk,chair,computer,desk-accessories}.png`，工位视图按 shadow/desk/chair/indicator/deskFront 分层并做深度切分（pixi/views/index.ts:12；pixi/depth.ts:5-8,14-20）。
- 农场/教室也分层：教室 desk/chair/room 分开并各自标接触点（scene-classroom/src/pixi/alignment.ts:19-42）；农场作物由 plotView 按状态绘制。

### 3.7 "程序化调整身体"现在有哪些缝隙
1. **du 空间已定义**：`1du = 站立参考高度`，根点 (0,0) 在脚下（extension-contracts.md:90-94）；`FrameAdapter.create` 把根节点缩放 `1/displayHeight`（FrameAdapter.ts:82），`ActorView` 再把 appearance 放大 `displayHeight`（ActorView.ts:67），所以适配器内部单位统一是 du —— 这是 IK 可以落脚的坐标面。
2. **pivot / referenceHeight / offsets**：绘制锚点固定用 `manifest.pivot`（FrameSprite.ts:69），缩放用 `displayHeight/referenceHeight`（:68），逐帧 `offset` 只用于算名字高度（:96-97），**不参与身体定位**；因此换 pose 时身体是按 pivot 对齐的，没有可驱动的关节参数。【事实】
3. **anchor**：运行时 anchor 是整数格（≈50px），视觉座位点却是硬编码 `seatPixels` +25/-10（projection.ts:12）和 `WORKSTATION_SEAT_Y=45`（workstationArtwork.ts:3）；du 与 cell/px 之间没有统一换算函数。
4. **现成的类 IK 代码（最接近实现）**：两段解析 IK `solveWorkArm`（assets-office/src/frame/workAnimation.ts:14-20）+ 可达性预检 `canUseWorkSurface`（:67-81）+ 分层手臂 parts 与肩点（art/characters/packs/office-lead/character.json `work` 块 :665-729；packSchema workRig 校验 :13-19,28-40）+ 工作面接触目标（contracts/src/contactSurface.ts:2-7,19-24；workstationSurface.ts:22-42）。**但它只在角色预览/测试里跑**：`sampleCharacterLayers(..., surface)` 才启用（packSchema.ts:60-63），场景里 `FrameSprite.renderClip` 不传 surface（FrameSprite.ts:39），docs 也写明"当前场景通过 FrameAdapter 播放完整工作帧，不在运行时拼接手臂"（docs/character-packs.md:104；回归 tests/computerWork.test.mjs:34）。
5. 结论【推断】：IK 需要的三件东西——接触目标生产者、du 坐标的骨骼/挂点、可重定向的渲染实现——第 2、3 件在预览侧已有原型，缺的是"host→adapter 的 contact 通道"和"家具侧接触声明"。

## 4 三技术插入点矩阵

| 技术 | 现有机制（最接近的代码） | 缺口 | 最自然插入点（file:line） | 改动规模 + 理由 | 风险 | 测试覆盖 |
|---|---|---|---|---|---|---|
| **Utility AI**（决定想做什么） | 两个手写打分器：`tendFarm`（supervisor.ts:17-23）、`OfficeIdleCoffee` 候选/冷却/随机（OfficeIdleCoffee.ts:109-186）；候选可行性查询 `reachable`（:201-213）；提交统一走 `runtime.submit`；`beforeCommand` 抢占钩子（SceneRuntime.ts:111-114） | 无 needs/goal 模型、无通用候选枚举、打分不可观测/不持久、无仲裁与"完成后下一步"、`participants` 声明不参与执行校验 | 应用层新 `DecisionDirector`（装配在 apps/web/src/application，参考 OfficeSimulation 的 tick 编排 :30-37）；runtime 侧只需暴露只读查询（已有 `snapshot/readActivePhases/readActors/navigation`）；能力侧保持"命令即接口"（protocol/src/index.ts:19-20） | **中**：不改 runtime 语义即可跑；但要新增候选枚举+打分+冷却持久化+可观测面板，并处理与 demo/外部命令的优先级（当前只有 busyPolicy + beforeCommand） | 与外部后端命令竞争（idleCoffee.test.mjs 已证咖啡会被抢占，但通用仲裁未定义）；随机/时钟导致不可复现；`beforeCommand` 抛错只警告不阻断（SceneRuntime.ts:158-161） | 无专门测试（模块不存在）；间接覆盖 idleCoffee/farm 行为 20+ 用例（见 §5） |
| **Smart Objects**（能和什么互动、怎么互动） | 模板已有 footprint/anchors/interactions{cells,approaches,posture,facing,requiresHome,resource}/resources（model.ts:31-39）；runtime 自动把 anchor+interaction resource 转成独占资源（SceneRuntime.ts:237-249）；通用能力 `furniture.use`（pack.ts:104-118）；地图目录=模板（RoomEditor.tsx:103）；占位视图兜底（PropViewRegistry.ts:15-22,29-33） | 交互只是"一个 anchor + 一个姿态 + 一个独占资源"；无 affordance 广告/前置条件表达式（participants/rules 不执行，plugins.ts:26 vs SceneRuntime.ts:220）；无 object 侧状态机/多用户 slot 语义（交互 resource 容量最多 1，plugins.ts:19）；无接触几何；黑板/菜地等对象干脆没有 interaction（classroom objects.ts:21-25；farm world.ts:12-15） | 扩展 `Template`/`FurnitureInteraction`（runtime/model.ts:31-39 与 plugins.ts:7-21 校验）或新增 `SmartObjectPlugin`；选择/预约插入 `SceneRuntime.buildPlan`（:229-249）与 `pump`（:279-296）；表现对接 `projectActors`（scene-office/src/pixi/index.ts:28-52） | **中-大**：字段扩展会动 runtime 类型 + 地图协议 v2（MapDraft/map schema）+ 场景数据；好处是不改命令协议 2.0，仍以 capability 表达 | 存档/地图 v2 兼容（旧地图无新字段须有默认值）；anchor 独占模型与"多用户 slot"冲突；`validateWorld` 结构校验（classroom/farm 都有）需同步；渲染占位视图可能掩盖缺失实现 | 较强：seatInteraction.test.mjs 14 例、mapEditor.test.mjs 19 例、runtime.test.mjs 32 例、actionContract.test.mjs 10 例；缺口=affordance/前置条件/多用户新语义 |
| **IK**（身体自然完成动作） | contacts/contactProfileId/socket 契约（animation.ts:15-22,68-87；presentation.ts:9-10）；办公 seated 已标 `office-desk-v1`（scene-office/src/pixi/index.ts:36）；`solveWorkArm` 两段解析 IK + 可达预检 + 手臂分层素材（assets-office/src/frame/workAnimation.ts:14-20,67-81）；du 定义与统一缩放（FrameAdapter.ts:82；ActorView.ts:67；extension-contracts.md:90-94）；嘴层/socket 已有稳定先例（FrameAdapter.ts:109-113；FrameSprite.ts:78-95） | 无 contact 目标生产者；FrameAdapter 拒收 contacts（FrameAdapter.ts:99）；socket 白名单仅 2 个（:45）；家具无接触声明（model.ts）；逐帧 offset 不参与定位；宿主不做求解（extension-contracts.md:113） | 数据：模板新增接触规格 + manifest `contactProfiles` 真实化（assets-office/src/frame/bindings.ts:46）；生产者：`projectActors` 里按 `furniture/prop + anchor` 算 contact（scene-office/src/pixi/index.ts:28-52）；消费：新 `animation-skeleton` 适配器实现 contacts + 多 socket（契约 animation.ts:68-87，注册 OfficeScene.ts:61）；预览侧 `sampleComputerWork` 可复用到适配器内核 | **大**：需要新包（骨骼/IK）+ 新素材或骨骼绑定 + 家具接触数据 + 容差验收；帧适配器路线不可行（contacts 明确拒绝） | 帧/骨骼混合未验证（README:151）；pivot/du/逐帧 offset 转换易错；性能（20 人）无基线；"动画完成≠任务完成"边界必须守住（migration-and-acceptance.md:86-87） | 弱-中：contracts 有 schema 测试、animationAdapter.test.mjs 9 例（含拒收 contacts，:137-138）、computerWork.test.mjs 3 例（预览侧 IK/接触，:34-50）；缺口=真实适配器 contacts/socket/容差测试为零 |

插入点细目：【推断】优先级建议 **Smart Objects 数据扩展（先做 affordance 枚举只读接口）→ Utility AI 独立 director → IK 单独新包**，因为前两者不动帧播放边界，IK 会同时动契约消费端与素材。

## 5 规模与风险数据（packages/*/src 与 apps/web，pwsh 统计行数）

| 包 | 文件 | 约 LOC | 关键文件 |
|---|---|---|---|
| runtime | 25 | 1843 | SceneRuntime.ts 637、movement.ts 183、navigation.ts 159、MapDraft.ts 132、plugins.ts 121、seatInteraction.ts 113 |
| scene-office | 35 | 1895 | OfficeIdleCoffee.ts 229、pack.ts 120、pixi/index.ts 90、objects.ts 19、idleCoffee.ts 90 |
| renderer-pixi | 14 | 1211 | ActorView.ts 109、AnimationPresenter.ts 53、SceneView.ts（24.7KB，未逐行读） |
| animation-frame | 8 | 599 | FrameAdapter.ts 134、FrameSprite.ts、packSchema.ts |
| protocol | 9 | 817 | index.ts 70（命令联合/limits）、map.ts |
| contracts | 8 | 209 | animation.ts 87、presentation.ts 44、contactSurface.ts 24 |
| scene-farm | 9 | 415 | activities.ts 51、supervisor.ts 29、crops.ts 37、world.ts 25 |
| scene-classroom | 7 | 285 | teaching.ts 74、objects.ts 33、alignment.ts 51 |
| assets-office | 5 | 229 | bindings.ts 49、workAnimation.ts 103、packSchema.ts 81 |
| assets-farm / assets-classroom | 1 / 1 | 21 / 37 | 仅 manifest 绑定 |
| apps/web/src | 91 | 6392 | OfficeScene.ts 111、OfficeIntegrationSession.ts 408、OfficeTeamSession.ts、sceneBridge.ts 83、CommerceSceneQueue.ts 65 |
| tests | 90 个 `*.test.mjs` | 14218 | — |

涉及测试文件（主题）：runtime.test.mjs（命令/资源/取消/超时/存档 32 例）、movement.test.mjs（候选诊断/逐格预约/多人避让）、navigation.test.mjs（A* / 整数格 / 通道）、seatInteraction.test.mjs（家具交互/插件设备/取消恢复）、actionContract.test.mjs（姿态契约/朝向/筛除）、animationAdapter.test.mjs（采样/共享租约/拒收 contacts:137-138）、idleCoffee.test.mjs（24 例本地自主行为）、officeDemo.test.mjs（5 例演示轮转）、commerceDemo.test.mjs、farm.test.mjs（13 例）、classroom.test.mjs（含桌面接触/坐姿对齐）、mapEditor.test.mjs（19 例）、architecture.test.mjs（包边界）、productBoundaries.test.mjs、sceneIsolation.test.mjs、seatProjection.test.mjs、deskVisit.test.mjs、characterWork.test.mjs、computerWork.test.mjs、quietWork.test.mjs、characterMouthLayer.test.mjs、referenceOffice.test.mjs。
**覆盖缺口（事实）**：无 Utility AI 模块与测试；contacts 只有"拒绝"用例，无正向接触/IK 容差测试；无多家具通用接触适配测试；无 20 人/性能基线（docs/architecture/migration-and-acceptance.md:88-98 自认未建立基线）。

构建/协议兼容硬约束：
- runtime 不得依赖 React/Pixi/场景（impl 见 packages/runtime/src/SceneRuntime.ts 无相关 import；测试 architecture.test.mjs "headless core cannot import office definitions, Pixi, React..." ; docs/architecture/README.md:75）。
- 命令协议固定 `2.0`、checkpoint `version:2`、scenePack `apiVersion:1`（packages/protocol/src/index.ts:8；SceneRuntime.ts:542,600；scenePack.ts:6-8；plugins.ts:46）。
- 适配器边界：不 contact 重定向、socket 白名单、不得自启 ticker/自走时钟（FrameAdapter.ts:45,99；extension-contracts.md:101）。
- 包边界：`renderer-pixi` 不依赖 animation-frame、scene-office 根入口无 DOM/Pixi（README:77-78；packages:check 校验）。
- 编辑/持久化互斥：编辑中拒绝新活动（SceneRuntime.ts:170）；持久化失败拒绝执行（:154,173）。
- 容量/上限：等待队列 128、记录 512、事件 256、单活动 claims≤128、phases≤100、每阶段效果≤24（SceneRuntime.ts:20,167,261,532；:35-43）。

## 6 不确定项清单（需要运行/原型验证，不在此下结论）

1. 外部 relay 真实链路：`server/src/app.ts` 未读；HTTP 200 与命令完成解耦（docs/plugin-runtime.md:183）在真实后端负载下的顺序/丢失行为需联调验证。
2. `beforeCommand` 只覆盖提交瞬间：外部命令与 idleCoffee 的竞态在真实 6 人+高频 presentation 更新下的表现，仅靠 tests/idleCoffee.test.mjs 的种子随机覆盖，需浏览器/网关复现。
3. 我未逐行读：`packages/renderer-pixi/src/SceneView.ts`（24.7KB，只 grep 了 appearance/load 路径）、`apps/web/src/application/OfficeIntegrationSession.ts` 后半（211-408）、`OfficeTeamSession.ts` 全文、`server/src/**`、`scripts/**`、`packages/scene-*/src/pixi/*`（除引用点）。
4. Smart Objects 扩展是否真的可以不改存档/地图 v2：取决于新增字段能否全部设为 optional（mapDocumentSchema 为 strict，MapDraft.ts:97 会 parse），需原型改一版 map 文档验证旧存档。
5. IK 工作量估计：`solveWorkArm` 只解两段手臂、只有肩点/hand tip 数据；躯干/坐姿/腿不存在骨架数据（character.json 仅 work rig），真实适配器需要骨骼绑定与素材重制，规模可能远大于本文"大"。
6. 性能：帧播放器 20 人、骨骼+帧混合、每帧 contacts 求解的耗时与显存无基线（docs 明确未测），需实测。
7. `capability.participants` 是否在别处（服务端/集成层）被校验：我只确认 runtime 与 describe 的使用；`integration/docs/office-integration.md`（56KB）未读，可能另有约束。
8. 教室/农场在 examples 里由用户手动驱动，未运行验证自动化的完整性（farm 自动照料只在 examples/farm 的 controller 启用）。
