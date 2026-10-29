# Utility AI / Smart Objects / IK 调研：PawOffice 该不该做、先做什么

> 调研日期：2026-10-27 ｜ 代码基线：HEAD `45597cd`（工作树另有若干与本调研无关的并行改动，本次未触碰）｜ 范围：PawOffice 前端（Vite + React + Pixi 8，帧动画人物，命令协议 2.0）。
>
> 方法：仓库代码与文档事实 + 外部权威资料（GDC / Game AI Pro / 引擎官方文档 / 已发行案例复盘）。文中标注 `[代码]`（本仓库可验证）、`[文档/案例]`（外部资料）、`[推断]`（本文判断，需 M0/S1 验证）。工作量均为**粗略估算**，需实验校准。

## 0. 结论（一页）

| 技术 | 判断 | 优先级 | 什么条件下值得做 | 一句话理由 |
| --- | --- | --- | --- | --- |
| **Utility AI**（决定想做什么） | **有条件有用；先做 1 周 dev-only M0 证伪，不整包引入** | P1 | 行为数 ≥6、行为之间开始互抢时间；需要角色差异；设计师要求"改配置调频率"；产品要求"无业务指令时办公室也像活的" | 现有 2 个手写启发式（无显式打分）说明需求真实存在，但规模未到；utility 的收益随"行为数 × 冲突数 × 角色差异"增长，当前三项都低 |
| **Smart Objects**（能和什么互动、怎么互动） | **有用；补"数据 + 查询 + 预检 + 失效"，不做框架** | **P0** | 要新增家具/装饰交互、统一教室与农场对象、让外部 AI 发现可执行交互 | 数据地基已存在约 60–70%（**主观估计，[推断]**：模板 interactions/anchors/resources + 原子预约 + 姿态契约），缺的只是只读候选索引、可用性预检、多槽位与失效语义；风险最低、直接收益最明确 |
| **IK**（让身体自然完成动作） | **现在不做真 IK；真 IK 归入未来 `animation-skeleton` 骨骼适配器里程碑** | P3（冻结） | 骨骼美术资产真的开始制作，且出现"任意家具高度/任意朝向/自由道具交接"需求时 | 帧位图没有可旋转关节，IK 无处施加；办公室是平坦整数格，没有地形适配/3D 瞄准/长链需求；仓库已有两连杆解析 IK，但只服务预览且已弃用——瓶颈在美术与验收，不在算法 |

**推荐路线**：Smart Objects M0（3–5 人日）与 Utility AI M0（1 周证伪实验）并行（共享同一个 AffordanceIndex 产物）→ M1 产品化（合计约 1–2 月，可开关）→ 真 IK 等骨骼里程碑。可选：与主线并行的 1–3 天 IK-lite 对齐 spike（纯表现层，不阻塞、不承诺）。

**三个必须守住的边界**：

1. **业务决策权仍在外部后端**。前端自治只做"选对象与时机"（做哪件事的哪一步、在哪儿做），不做"要不要做业务任务"；外部命令永远优先。
2. **协议 2.0 / 存档 v2 / 整数格 / 姿态契约不变**。自治命令与外部命令同构，不新增协议字段；决策状态只放内存，**不写入存档**（重启后重新决策，避免存档兼容与回放问题）。
3. **不对外承诺"自动 IK"**。`contacts` 的语义是"验收契约 + 可选 warp 目标"，不是"请适配器求解"；真实 IK 能力必须由骨骼适配器自行声明并验收，宿主不做通用求解（`docs/architecture/extension-contracts.md:113`）。

---

## 1. 三个词不在同一层，不能平行比较 ROI

| 层 | 回答的问题 | 技术 | PawOffice 现有落点 | 缺口 |
| --- | --- | --- | --- | --- |
| 决策层 | 人物**想**做什么 | Utility AI | 8 条生产提交通道（apps/web + packages，其中 2 条是手写启发式；examples 的教室/农场控制器另有独立入口） | 无 needs/goal 模型、无统一候选枚举、打分不可观测、无"完成后下一步" |
| 交互对象层 | 能和**什么**互动、**怎么**互动 | Smart Objects | 家具模板声明 interactions/anchors/resources + 通用执行器 + 原子资源预约 | 无只读 affordance 查询、前置条件不执行、交互资源容量最多 1、部分对象没有 interaction |
| 表现层 | 身体**怎么**完成动作 | IK | 语义 actionId → 烘焙帧；适配器契约（含预留 contacts）；预览侧已有两连杆 IK 原型 | 无运行时程序化身体通道；FrameAdapter 明确拒绝非空 contacts；无骨骼播放器 |

**关系**：Smart Objects 产出候选（"有什么可选"）→ Utility AI 排序选择（"为什么选它"）→ 表现层执行（"怎么演"）。前两者是一体两面（对象广告 + 需求评分，The Sims 的经典组合）；IK 与它们解耦，受资产管线约束。因此**只做 Utility AI 不做 Smart Objects**会退化成继续硬编码候选；**只做 Smart Objects 不做 Utility AI** 也能立刻受益（外部 AI、地图编辑器、新家具）；**IK 与两者都无关**。

---

## 2. PawOffice 现状事实（本报告依赖的部分）

### 2.1 决策层 `[代码]`

- **唯一状态写入口是 `SceneRuntime.submit`**（`packages/runtime/src/SceneRuntime.ts:144`）：运行时只执行"已被提交"的 `activity.start` 等命令，自己不做任何"该做什么"的判断。apps/web + packages 的生产提交通道共 8 类（不含 examples 的教室/农场控制器）：外部业务后端 relay、页面 UI、`officeDemo` 演示脚本、`CommerceSceneQueue`、`DashboardSceneBridge`、`OfficeIdleCoffee`、`farm tendFarm`，以及零散的 `activity.start`/场景命令（表情、家具使用、JSON 面板等）。地图编辑器只提交 `map.edit`，不属于人物行为决策。
- **两个"最接近自主"的实现都是手写启发式**：
  - `OfficeIdleCoffee`（`packages/scene-office/src/core/OfficeIdleCoffee.ts:109-186`）：250ms 轮询；每人 5–15s 冷却；久未休息者优先、近期搭档降权、随机对话回合；通过 `runtime.beforeCommand` 在外部命令到达时先释放自己的占用并加冷却（`:88-103`）。冷却/偏好只在内存，不进存档。
  - `tendFarm`（`packages/scene-farm/src/core/supervisor.ts:6-29`）：每个空闲农夫枚举菜地 → 作物状态映射操作（plant/water/harvest）→ 过滤菜地已被预约、目标格被他人或步伐占据、收获箱忙碌（可达性由提交后的寻路失败兜底）→ "plant 优先、再按距离"排序 → 提交 `farm.*` 命令。
- **缺什么**（按依赖顺序）：① `Actor` 没有 needs/mood/goal/intent 字段（`packages/runtime/src/model.ts:20-29`）；② 无通用候选枚举与显式打分；③ 无决策可观测性（分项分数/选择理由）；④ 无仲裁层（只有 `busyPolicy` + 资源 claim）；⑤ 活动结束后没有"下一步"钩子。
- **可用的插入钩子**：`beforeCommand`（`SceneRuntime.ts:111-114`，外部命令到达前让本地行为释放占用；监听器异常只 `console.warn`，见 `:158-161`）、`busyPolicy: 'reject'`、只读快照/查询（`snapshot()`、`readActors()`、`templates()`、`describe()`，`SceneRuntime.ts:120-141`）。这些足够支撑一个"环境行为导演层"，**不需要改 runtime 语义**。

### 2.2 交互对象层 `[代码]`

- **家具模板已经是数据**：`footprint`、`anchors`、`interactions{ anchor, approaches, cells, posture, facing, requiresHome, resource }`、`resources`（`packages/runtime/src/model.ts:10-13,31-39`；实例见 `packages/scene-office/src/core/objects.ts:7-16`）。入座/离座、入口选择、局部通道与资源预约为通用控制器（`packages/runtime/src/seatInteraction.ts`、`movement.ts`）。
- **已有通用执行能力** `furniture.use`（`packages/scene-office/src/core/pack.ts:104-118`，文档见 `docs/plugin-runtime.md:63-66`）：简单交互可以"零新能力"跑通。
- **但语义很窄**：一个 interaction = 一个锚点 + 一个姿态 + 一个独占资源；模板 `resources` 中被交互引用的容量**必须为 1**（`packages/runtime/src/plugins.ts:19`），所以一个站位同时只能一人；`capability.participants/rules` 只是声明，runtime 只校验参与者不重复/存在（`packages/runtime/src/SceneRuntime.ts:220-221`），角色与规则由各能力 `build()` 自行校验（如 `packages/scene-office/src/core/pack.ts:106-112`）；教室黑板、农场菜地**没有 interaction 声明**（原状是普通 move 到 anchor）；背景柜子/植物/门是静态内容（`docs/plugin-runtime.md:244`）。
- **新增"一种家具 + 一种交互"的真实成本**：粗估 4–8 处改动、跨 4–5 个包（模板数据、能力/编排、家具视图、素材、姿态契约，视需求还可能涉及 renderer-pixi/contracts），其中 runtime 0 处（**[推断]，需按实际对象校准**）。真正贵的不是模板字段，而是视图、素材与"到位后能不能演"。
- **"任意家具接触适配"不支持的原因**：缺三层——家具侧接触几何、世界→du 的接触目标生产者、可重定向的动画适配器；当前没有代码把家具几何换算成 `ContactTarget`（`packages/contracts/src/animation.ts:15-22`），且帧适配器明确拒绝（`packages/animation-frame/src/FrameAdapter.ts:99`）。

### 2.3 表现层 `[代码]`

- 链路：语义 `actionId` → manifest variant（`packages/assets-office/src/frame/bindings.ts`）→ `AnimationPresenter` → `FrameAdapter.sample`（`packages/animation-frame/src/FrameAdapter.ts:84-108`）→ 整帧采样。`poses/lookAt/facing/posture` 是运行时校验过的"到位姿态"，不支持就返回 `UNSUPPORTED_POSE`（`packages/runtime/src/actionContract.ts:19-21`）。
- **contacts 契约已预留但未实现**：`contacts[] { socketId, position, toleranceDu }` 与 `contactProfiles`（`contracts/src/animation.ts:15-22,36-41`）；`FrameAdapter.ts:99` 对非空 contacts 抛错；socket 白名单只有 `root.ground`/`ui.label`（`:45`）；宿主不做通用 IK（`extension-contracts.md:113`）。
- **已有一个真 IK 原型**：`solveWorkArm` 是标准两连杆解析解（`packages/assets-office/src/frame/workAnimation.ts:14-20`），配 `canUseWorkSurface` 可达性预检（`:67-81`）、肩点/手臂分层素材（`art/characters/packs/*/character.json` 的 `work` 块）、工作面接触点（`packages/contracts/src/contactSurface.ts`）。但它只在**显式预览**的 `work.computer-back` 里运行（`packages/assets-office/src/frame/packSchema.ts:60-63`）；场景默认播放完整工作帧、从不播放 `work.computer-back`（`docs/character-packs.md:100,104,106`），`FrameSprite.renderClip` 也不注入 surface，未传 surface 时采样器会回退到素材自带的 `previewSurface`（`packSchema.ts:62`）。旧"杯子 + 长手臂覆盖层"效果也曾被删除，改为整帧端杯——"能跑但弃用"的先例值得注意。

---

## 3. Smart Objects：P0，补数据与查询层

### 3.1 它是什么

affordance（物体提供的动作可能性）→ advertisement（物体广播"能满足什么"）→ interaction slot（可被占用的使用位）→ claim/reservation（先占位再前往）→ preconditions/effects（用户标签、状态要求、对象状态修改）。UE 官方文档明确写 **"Smart Objects do not contain execution logic"**：只提供数据与预约，交互逻辑由 agent 自己实现（[UE Smart Objects Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview)、[Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---quick-start)）。The Sims 的对象广告与需求评分是同一套思想的经典形态（[Zubek, Needs-Based AI](https://robert.zubek.net/publications/Needs-based-AI-draft.pdf)）。

与 planner 的边界：本项目 activity 的 `phases/claims` 已经是"预写好的计划"，**不需要 GOAP/HTN planner**；需要的是"候选 + 排序"，即 Smart Objects + Utility 的组合。

### 3.2 已经有的（主观估计约 60–70%，[推断]）与真正缺的

| 已有 | 缺失 |
| --- | --- |
| 交互声明：anchor/approaches/cells/posture/facing | **只读候选索引**：任意角色"现在能做什么、为什么不能" |
| 资源容量与原子预约（`resources`/claims/holders） | **决策前可用性预检**（资源、可达性、姿态、入口被占） |
| `requiresHome` 用户限制 | 通用**前置条件表达式**（替代 `build()` 里的 if/throw） |
| 布局/状态 revision 概念 | 明确的**失效语义**（布局或对象状态变化后候选过期） |
| 多阶段 activity（phases/poses/speech） | **多槽位语义**（会议白板 4 个 anchor vs 单 `meeting` 资源；饮水机排队） |

### 3.3 对本项目的具体收益

1. **背景装饰变成可交互对象**：柜子/植物/门当前是纯静态内容（`docs/plugin-runtime.md:244`）；饮水机只有文档示例、尚未实现（`docs/integer-grid-and-interactions.md:18-49`），数据化后不需要新能力插件。
2. **地图编辑器摆放的家具从"障碍物"变成"有语义对象"**：目录 = `runtime.templates()`，新增交互不再复制 capability 代码。
3. **教室/农场对象统一**：黑板、菜地补上 interaction 声明后，与办公室共用同一套发现/预约/姿态校验。
4. **外部 AI 的动作菜单**：`runtime.describe()`（`SceneRuntime.ts:141`）已经暴露模板/能力 Schema，配合只读 affordance 查询即可让 LLM/外部 AI 看到"当前可执行交互"（项目已有 `map.edit` 的外部 AI 编辑协议，这条延伸很自然）。
5. **为 Utility AI 提供候选**：没有它，utility 的候选仍要手写。

### 3.4 不做什么

- 不引入 UE 式 `Behavior Definition`（对象知道怎么被执行）——本项目的动画/姿态能力在角色侧、执行逻辑在 runtime，照搬会制造**第二套权威**。
- 不做全局空间分区注册表（单场景 <30 个道具时是纯开销）、不做 tag/query 子系统、不做 planner。
- **不新增协议字段**：新增能力仍用 `activity.start` 表达；`describe()` 自动导出。

### 3.5 最小切片

**M0（3–5 人日，dev-only，可证伪）**

- `AffordanceIndex` 纯函数：输入 `World + ScenePack/templates + Snapshot`，输出 `{ actorId, propId, interactionId, anchor, 可用/不可用原因 }`；node 单测；dev 页面列出候选。
- zod 可选字段原型（前置条件/效果/槽位），验证新字段对 map 文档/checkpoint v2 的兼容影响（模板字段在代码侧、插件版本需精确匹配；若落到 World/Prop 则必须 optional 且有默认值）。
- 不改任何 runtime 行为、不改现有命令形状。

**M1（2–3 周，产品化）**

- runtime 侧只读接口（保持不依赖 Pixi/场景）或场景包内纯函数导出；`furniture.use` 泛化：多槽位、声明式前置条件/效果、失效通知。
- scene-office 试点 1–2 个新对象（饮水机/绿植），验证"数据 + 视图"即可新增交互。
- 旧地图/旧存档加载测试、2–3 人共享对象（白板/饮水机）不冲突测试。

**验收**：新增一种交互对象的改动文件数相对基线下降；外部 AI 可通过 `describe()` + 查询发现新交互；旧地图/旧存档行为不变；同屏多人使用同一对象不出现资源超发。

### 3.6 成本与风险

- **存档/地图 v2 兼容**：map 文档 schema 是 strict，但模板/interaction 定义在场景包代码里、**不写入** map 文档或 checkpoint；真正卡旧存档的是插件版本精确匹配（`docs/plugin-runtime.md:245`）。若新增字段落到 World/Prop，就必须 optional 且有默认值——M0 先验证这两类情况。
- **anchor 独占模型 vs slot 语义**：现在 anchor 资源容量恒 1；多槽位需要新的资源命名/容量语义，改动要小而清晰。
- **跨场景语义漂移**：办公室"休息"是坐沙发、农场"休息"是回屋；建议只用少量动作标签（sit/drink/social/work/rest）+ 契约测试。
- **验证矩阵膨胀**：每加一个交互都要测寻路/姿态/资源；用数据生成测试而不是手写。
- 风险等级：**低–中**（不动协议、不动 runtime 执行语义）。

---

## 4. Utility AI：P1，先证伪再产品化

### 4.1 它是什么

核心循环：枚举候选动作 → 每个动作取若干 consideration（距离、需求、状态、时间…）→ 每条经 response curve 归一化到 [0,1] → 合成总分（加权和=可补偿 / 乘法=不可补偿 / 硬门槛+软权衡）→ 选择（argmax 或加权随机）→ 惯性/滞回抑制抖动。分数表达"多想要"，**不表达"能不能"**——能力、锚点、姿态、资源仍是布尔前置条件（[Game AI Pro 1 Ch9](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf)、[Game AI Pro 3 Ch13](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf)）。

业界主流不是二选一，而是 **utility 选目标 + BT/FSM 执行**（[Game AI Pro 1 Ch10](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter10_Building_Utility_Decisions_into_Your_Existing_Behavior_Tree.pdf)、[Ch4 总览](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter04_Behavior_Selection_Algorithms.pdf)）。管理模拟也不一定上 utility：RimWorld 用层级 ThinkTree + 玩家优先级 + reservation，Oxygen Not Included 用优先级桶 + 就近 tie-break（[RimWorld 机制](https://github.com/roxxploxx/RimWorldModGuide/wiki/SHORTTUTORIAL:-How-Pawns-Think)、[ONI Priority](https://oxygennotincluded.wiki.gg/wiki/Priority)）——便宜、可解释，但软性权衡弱。IAUS（Dave Mark）是数据驱动 utility 的代表实现，在 Guild Wars 2: HoT 有部署（[IAUS](https://gameai.com/iaus.php)、[GDC 2013 Architecture Tricks](http://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in)）。

### 4.2 PawOffice 的判断：有条件有用

- **现在自主氛围行为只有 2 个**（咖啡休息、农场照料；其余行动由外部命令或演示脚本驱动），手写启发式够用；utility 的收益随"行为数 × 冲突数 × 角色差异"增长，当前三项都低 → **不整包引入**。
- **触发条件**（任一命中再上）：行为数 ≥6 且两两抢时间（咖啡 vs 饮水 vs 窗边 vs 摸鱼…）；同一物体多人竞争出现饥饿；需要按角色性格/状态差异化；设计师要求"改配置调频率"；抖动只能靠不断堆 cooldown 补丁。
- **产品条件**：产品要求"无业务指令时办公室也像活的"或展示型/演示型产品 → 值得；如果定位就是"后端剧本 + 少量氛围行为"，只需要随机/权重表，**不要上评分框架**（[Game AI Pro 3 Ch35 氛围交互](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter35_Ambient_Interactions_Improving_Believability_by_Leveraging_Rule-Based_AI.pdf) 与 [Ch36 背景角色](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter36_Breathing_Life_into_Your_Background_Characters.pdf) 讲的是低成本规则化氛围，与本项目现阶段更匹配）。
- **最大收益不是"更聪明"，而是"可解释 + 可组合 + 数据驱动"**：新增行为是加配置而不是改优先级链；每个选择都能给出分项分数；外部 AI 可以只下发业务意图，由前端 utility 在本地挑对象/时机。

### 4.3 架构边界与放置

```
外部后端 ──activity.start(协议 2.0)──▶ SceneRuntime（权威：预约/寻路/姿态/执行）
                                   │ 只读快照
                                   ▼
                    AutonomyDirector（可选、可开关、场景策略）
                     ├─ AffordanceIndex（Smart Objects M0 产物）
                     ├─ UtilityScorer（曲线/合成/种子随机/滞回）
                     ├─ Lease & Cooldown（外部命令经 beforeCommand 抢占）
                     └─ 提交同构 activity.start（无新字段）
                                   │
                    SceneEvent ──▶ dev 调试面板 / 指标采集
```

放置建议：`packages/utility`（纯 TS：曲线/合成/选择器，零场景依赖）+ 各 `scene-*/core` 的场景策略（候选枚举 + 场景知识）+ 应用层装配与 dev 面板。理由：不破坏"runtime 不依赖 Pixi/React/场景"的包边界；与现有 `OfficeIdleCoffee` 位于 scene-office 的先例一致。

**硬约束**：外部命令最高优先（`beforeCommand` 释放租约）；编辑/演示/资源加载期间暂停自治；不新增协议字段；**决策状态不持久化**（重启重新决策）；种子随机保证可复现；联合活动（咖啡聊天）继续用现有单名额 coordinator，不交给 utility。

### 4.4 最小切片

**M0（1 周，可证伪，dev-only）**

- Day 1–2：AffordanceIndex 纯函数 + 单测（与 Smart Objects M0 共用）。
- Day 3：3 个行为（咖啡/接水/伸懒腰）× 各 2–3 个 consideration × 2 条曲线，乘法/加权和可切换，种子随机。
- Day 4：dev-only `AutonomyDirector`，每 N ms 决策一次；外部命令到达即释放；预检失败换候选而非重试。
- Day 5：无渲染模拟跑 30 分钟 × 5 个种子，输出指标；DOM 面板显示 top-5 与分项分数；与现有启发式基线对比。
- **通过标准**：指标可采集且方向正确；盲看录像能分辨出"更像活的"；100% 决策可解释；无协议/存档/姿态回归。
- **失败标准**：多样性无提升，或调参超过 2 天仍抖动，或外部抢占出现孤儿占用——任一命中即"暂不引入"。

**M1（3–5 周，产品化、可开关）**：ScenePack 可选 `autonomy` 配置（behaviors/considerations/curves/cooldown/inertia/margin）；AutonomyDirector 作为正式场景插件；`autonomy.scored/decided/failed` 事件进入现有 `SceneEvent`；dev 面板升级；办公室/农场各自提供行为配置；回归测试 + 回滚开关。

### 4.5 验收指标

| 指标 | 定义 | M0 目标 |
| --- | --- | --- |
| 行为多样性 | 每角色每 10 分钟不同行为数 / 分布熵 | 比基线 +50% |
| 闲置率 | 可行动角色"无活动且无氛围行为"时长占比 | 低于基线 |
| 抖动 | 每角色每分钟行为切换次数 | ≤2 次/分 |
| 冲突/失败率 | 候选因资源/可达/姿态失败比例 | <10% |
| 可解释性 | 有分项分数日志的决策占比 | 100% |
| 外部抢占 | 外部命令到租约释放延迟；孤儿占用 | 0 孤儿 |
| 性能 | 每次决策耗时 | <1ms/角色 |
| 确定性 | 同种子+同命令日志 → 同命令序列 | 通过 |

### 4.6 失败模式与规避（来源：`[案例/实践]` 与 `[推断]`）

| 失败模式 | 表现 | 规避 |
| --- | --- | --- |
| 调参地狱/不可解释 | 行为怪但说不出原因；改 A 坏 B | 每行为 ≤4 个 consideration；记录分项分数与曲线参数；面板显示 top-k 与 margin；golden 测试锁行为 |
| 行为抖动 | 咖啡↔窗边高频切换 | 惯性加分、最小承诺时长、切换 margin、决策间隔、冷却、种子随机 |
| 内容量爆炸 | 行为数 × 角色差异 × consideration 数失控 | 行为模板库；禁止角色特判；新增行为必须带来可量化指标改善 |
| 与外部命令冲突 | 自主动作刚发起就被打断；资源被抢 | 自治租约 + 外部最高优先；提交前预检；失败进事件而非重试风暴 |
| 多角色共振 | 六个人同时去同一处 | utility 只做原子行为；联合活动保留 coordinator；随机化 |
| 过设计 | 先建框架/编辑器，最后只有 2 个行为 | M0 先证伪；dev-only 面板；3 个行为验证 ROI 后再扩展；不引入 planner |

**成本**（`[推断]`，需 M0 校准）：Affordance 索引 1–3 人日；打分器 2–4 人日；Director（tick/租约/抢占/冷却/失败回退）2–4 人日；schema 1–2 人日；调试面板 1–2 人日；模拟/指标 harness 2–3 人日；M1 合计约 **3–5 工程师周**（不含素材与后端联调）；长期调参是持续成本，没有可解释性工具时至少翻倍。

---

## 5. IK：现在不做真 IK

### 5.1 办公室真正需要 IK 的地方很少

| IK 典型用途 | PawOffice 是否存在 | 现有替代 |
| --- | --- | --- |
| 足部贴地/地形适配 | 不存在（平坦单层整数格，家具不可站立） | 烘焙脚底常量 |
| 手部接触（键盘/鼠标/杯/文件） | 存在，但目标固定 | 整帧烘焙播放 + 作者接触点/家具接触面验收（现有测试覆盖预览 IK 与家具 landmark，`tests/computerWork.test.mjs`） |
| look-at/注视 | 存在（朝同伴、说话转头） | 朝向帧选择（`VisualRequest.view`），无连续旋转 |
| 瞄准/3D 目标 | 不存在 | — |
| 长链程序化（尾巴/披风/触手） | 不存在 | — |

结论：办公室的"接触"本质是**站位/家具/动作的预对齐**，"注视"是**朝向与转头帧选择**，不是"任意姿态实时求解"。

### 5.2 硬约束

- **帧位图没有可旋转关节**：IK 输出是骨骼旋转/位移，烘焙帧不可在运行时重定向；`FrameAdapter.ts:99` 的报错不是偷懒，是"位图帧没有可重定向的接触点"。
- **像素风与骨骼变形冲突（[推断]）**：骨骼旋转/蒙皮会产生非整数采样与拉伸，蒙皮在大幅弯曲时也可能出现意外形变（[Godot 2D skeletons](https://docs.godotengine.org/en/stable/tutorials/animation/2d_skeletons.html)）；像素风还要求整数像素与手工调色，而本项目素材准入建立在整图等比、禁止运行时改 scale、脚底 ±2px 上（`docs/character-art-standard.md`）——两者正面冲突。
- **行业常态不是运行期 IK**：像素逐帧（Shovel Knight）、3D 渲染成像素（Dead Cells）、程序化生物（Rain World）是更常见的三条路（[Shovel Knight](https://old.yachtclubgames.com/2020/03/creating-a-shovel-knight-character-sprite/)、[Dead Cells](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-)、[Rain World](https://www.gameanim.com/2017/07/24/rain-world-animation-process/)）。运行期 IK 的主场是高清矢量/骨骼 2D 与 3D。
- **仓库已有"两连杆 IK 能跑但弃用"的先例**：`solveWorkArm` 只服务显式预览，场景默认整帧；旧的杯子/长臂覆盖层已删除。瓶颈在美术一致性、验收与吞吐，不在算法。

### 5.3 判断与建议

| 选项 | 判断 | 说明 |
| --- | --- | --- |
| 现在做运行时 IK | **不做** | 帧位图不可解；骨骼资产不存在；成本远超收益 |
| 等骨骼适配器再做 | **真 IK 归入 `animation-skeleton` 阶段** | 触发条件：骨骼美术真的开始制作；出现"任意家具高度/朝向/自由道具交接"需求；某动作整帧方案无法表达 |
| 现在做 IK-lite | **可选 1–3 天 spike（纯表现层）** | 不改 FrameAdapter/AnimationAdapter 接口、不改整数格与存档 |

**可选 spike S1（若想做"更顺滑的接触"，1–3 天）**：在 presenter 层加可选 `WarpPresenter`，对 actor root 做 ≤1/4 格位移 + 120–200ms 朝向插值（像素取整、可关闭、reduce-motion 下禁用），用 `VisualCue` 标记接触时刻做重定时。验收：接触误差 P95 ≤2px、最大位移 ≤0.25 格、相邻帧位移 ≤1px、关闭时与基线逐像素一致、`npm test` 全绿。失败判据：需要 >1/4 格或出现像素抖动 → 放弃，回美术侧改动作/站位/家具锚点。

**contacts 契约的正确用法（4 条）**：schema 不动；`FrameAdapter` 继续显式拒绝非空 contacts（不要静默降级）；语义定为"预烘焙对齐档（contactProfileId）+ 验收目标/可选 warp 目标（contacts）"，不是求解请求；未来在 skeleton 适配器能力清单里增加 `contactRetargeting: 'none' | 'warp' | 'ik'` 与 `maxToleranceDu`，由适配器实现 `validateContacts`，宿主只调用、不实现通用求解。文档里的"自动 IK 不支持"表述保持。

### 5.4 成本与风险 `[文档/案例]`

- **骨骼化 = 美术管线重建**：6 个角色 × 现有动作集（四向步态、坐起、转头、工作、说话、端杯…）要切图/绑骨/刷权重/逐帧修像素/重做验收，粗估 **3–6 人周**（需 S2 spike 校准），且要重跑素材准入流程。
- **引擎与许可**：Spine 是商业授权，运行许可要求每个最终产品的用户自行获得 Spine Editor 授权；Essential 版不含 IK；3 骨以上 IK 官方明确不支持（[IK constraints](https://esotericsoftware.com/spine-ik-constraints)、[Runtimes License](https://esotericsoftware.com/spine-runtimes-license)）。Pixi 8 官方运行时是 `@esotericsoftware/spine-pixi-v8`（Pixi ≥8.16，运行时 major.minor 需与 Spine Editor 对齐；[spine-pixi](https://esotericsoftware.com/spine-pixi)）。
- **验收与混合**：真实帧/骨骼混合运行仓库明确未验证；现有验收是"真实资源清单 + 采样对照 + 人工并排"，不是逐像素 diff；引入骨骼需要新增视觉回归与混合验收。
- **品牌风险**：对外承诺 IK 而素材跟不上，用户看到的是手穿桌、脚打滑；当前文档写"不支持自动 IK"是正确的风险姿态，应保持。

---

## 6. 三者关系、推荐路线与决策树

**依赖关系**：

```
Smart Objects（候选：能和什么互动） ──▶ Utility AI（排序：想做什么）
        │                                      │
        └── 独立价值：外部 AI 动作菜单、地图编辑器、新家具、跨场景统一
                                               ▼
                                        表现层执行（怎么演）
                                               ▲
IK（现在不做）──────────────── 未来 animation-skeleton 骨骼阶段 ─┘
```

**推荐路线**：

| 阶段 | 内容 | 估算 | 交付判据 |
| --- | --- | --- | --- |
| 阶段 0（1–2 周） | Smart Objects M0 + Utility AI M0 并行（共用 AffordanceIndex）；可选 IK-lite S1 spike | 合计约 8–12 人日 | Affordance 查询可用；utility 证伪实验出指标结论；旧地图/存档/测试全绿 |
| 阶段 1（1–2 月） | Smart Objects M1（多槽位/前置条件/效果/失效 + 1–2 个新对象试点）+ Utility AI M1（可开关的 AutonomyDirector + 调试面板 + 指标） | 合计约 5–8 工程师周（串行；并行约 3–5 周） | 新增交互成本下降；行为多样性/抖动/冲突指标达标；可一键回滚 |
| 阶段 2（按需） | `animation-skeleton` + 真 IK/contacts 验收（含骨骼美术预算与选型） | 立项另估 | 一个真实骨骼人物与帧人物混合运行通过；不承诺自动 IK |

**决策树**：

1. **只做一件事** → 做 Smart Objects（P0）：风险最低、现有缺口最具体、对另外两件都有正收益。
2. **产品要求"无业务指令时办公室也像活的"** → 做 Utility AI M0（1 周证伪），通过再 M1。
3. **只是觉得 idle 动画呆板** → 随机/权重表 + 氛围行为配置即可，不上 utility（[Game AI Pro 3 Ch35]）。
4. **出现"任意家具高度/任意朝向/自由道具交接"需求** → 先做骨骼选型与 IK spike（S2），不要先做帧适配器上的假 IK。
5. **什么情况下都不做**：现有演示已满足客户；团队没有持续调参与验收预算；只想"技术栈看起来先进"。

**不要做清单**：不要在前端抢业务决策权；不要在 runtime 里加 `if office/farm` 分支；不要把决策状态写进 v2 存档；不要照搬 UE Smart Object 框架；不要在帧适配器上强行实现 contacts；不要对外宣称"自动 IK"。

---

## 7. 统一验收与风险

**建议的产品级验收指标**（阶段 0 就要能采集）：

- Smart Objects：新增一种可交互对象的改动文件数（相对基线）；外部 AI 能否通过 `describe()` + 查询发现新交互；旧地图/旧存档兼容；多人共享对象零超发。
- Utility AI：行为多样性、闲置率、抖动（切换次数/中位停留）、冲突失败率、决策可解释率、外部抢占延迟、同种子可复现。
- IK（若做 S1）：接触误差 P95 ≤2px、位移 ≤1/4 格、相邻帧差 ≤1px、关闭时基线零差异。

**主要风险**：调参与可解释性成本（不是算法）；前端自治 vs 后端权威的决策权冲突；Smart Objects 扩字段与插件版本精确匹配（checkpoint 恢复要求插件版本全等）的兼容问题；跨场景语义漂移与验证矩阵膨胀；骨骼化美术预算被低估；把"接口预留"误当成"能力已有"。

---

## 8. 参考资料

**Utility AI / Smart Objects**

- [An Introduction to Utility Theory — Game AI Pro 1 Ch9](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf)
- [Choosing Effective Utility-Based Considerations — Game AI Pro 3 Ch13](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf)
- [Behavior Selection Algorithms: An Overview — Game AI Pro 1 Ch4](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter04_Behavior_Selection_Algorithms.pdf)
- [Building Utility Decisions into Your Existing Behavior Tree — Game AI Pro 1 Ch10](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter10_Building_Utility_Decisions_into_Your_Existing_Behavior_Tree.pdf)
- [Infinite Axis Utility System（IAUS）](https://gameai.com/iaus.php) ｜ [GDC 2013 Architecture Tricks](http://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in)
- [Needs-Based AI — Robert Zubek](https://robert.zubek.net/publications/Needs-based-AI-draft.pdf)
- [Smart Objects in Unreal Engine — Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview) ｜ [Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---quick-start)
- [Asking the Environment Smart Questions — Game AI Pro 1 Ch33](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter33_Asking_the_Environment_Smart_Questions.pdf)
- [Smart Zones — Game AI Pro 2 Ch11](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter11_Smart_Zones_to_Create_the_Ambience_of_Life.pdf)
- [Ambient Interactions — Game AI Pro 3 Ch35](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter35_Ambient_Interactions_Improving_Believability_by_Leveraging_Rule-Based_AI.pdf) ｜ [Breathing Life into Background Characters — Game AI Pro 1 Ch36](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter36_Breathing_Life_into_Your_Background_Characters.pdf)
- [RimWorld: How Pawns Think](https://github.com/roxxploxx/RimWorldModGuide/wiki/SHORTTUTORIAL:-How-Pawns-Think) ｜ [Oxygen Not Included: Priority](https://oxygennotincluded.wiki.gg/wiki/Priority)
- [学习 Utility AI 的个人复盘（样本量 1）](https://mykaadev.github.io/articles/Learning%20Utility%20AI/)

**IK**

- [Spine — IK constraints](https://esotericsoftware.com/spine-ik-constraints) ｜ [Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license) ｜ [spine-pixi](https://esotericsoftware.com/spine-pixi)
- [Unity — 2D Inverse Kinematics](https://docs.unity3d.com/Packages/com.unity.2d.animation@13.0/manual/2DIK.html) ｜ [Animation Rigging](https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.3/manual/index.html)
- [Unreal — Motion Warping](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-warping-in-unreal-engine) ｜ [Control Rig](https://dev.epicgames.com/documentation/en-us/unreal-engine/control-rig-in-unreal-engine)
- [Godot — 2D skeletons](https://docs.godotengine.org/en/stable/tutorials/animation/2d_skeletons.html)
- [FABRIK 论文（Aristidou & Lasenby, 2011）](https://doi.org/10.1016/j.gmod.2011.05.003)
- 案例：[Shovel Knight 像素帧流程](https://old.yachtclubgames.com/2020/03/creating-a-shovel-knight-character-sprite/) ｜ [Dead Cells 3D→像素管线](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-) ｜ [Rain World 动画流程](https://www.gameanim.com/2017/07/24/rain-world-animation-process/)

**仓库内证据**

- 决策：`packages/runtime/src/SceneRuntime.ts:109-179`（写入口/beforeCommand/提交）、`packages/scene-office/src/core/OfficeIdleCoffee.ts:88-186`、`packages/scene-farm/src/core/supervisor.ts:6-29`
- 交互：`packages/runtime/src/model.ts:10-13,31-39`、`packages/scene-office/src/core/objects.ts:7-16`、`packages/scene-office/src/core/pack.ts:104-118`、`packages/runtime/src/plugins.ts:19,26`、`packages/runtime/src/seatInteraction.ts`
- 动画：`packages/contracts/src/animation.ts:15-22,68-87`、`packages/animation-frame/src/FrameAdapter.ts:45,99`、`packages/assets-office/src/frame/workAnimation.ts:14-20,67-81`、`packages/animation-frame/src/FrameSprite.ts:23-25`（renderClip 不注入 surface）、`docs/architecture/extension-contracts.md:105-113`、`docs/character-packs.md:100,104,106`
- 约束：`docs/integer-grid-and-interactions.md`、`docs/plugin-runtime.md`、`docs/architecture/README.md:75,151`

---

## 9. 待验证清单（阶段 0 必须回答）

1. 旧地图/旧存档在新增 optional 字段后是否无感加载（拿真实布局 + 备份跑一遍）。
2. 单场景 <30 个道具时，AffordanceIndex 全量扫描是否足够快（先 benchmark，别先建索引结构）。
3. 6 人办公室同时"自发行为"是否会共振（同去一处/同时起身），随机化 + coordinator 是否够。
4. utility 的"生活感"提升客户能否感知（录像盲评，而不是只看指标）。
5. 外部命令抢占后是否出现孤儿占用/资源泄漏（高频 presentation 更新 + 6 人压力场景）。
6. 每个行为的真实调参工时（本报告估 0.5–2 人日/首次，需 3 个行为实测）。
7. S1 warp 的 1/4 格上限是否够覆盖入座/端杯错位（真实录屏对比；不够则回美术侧）。
