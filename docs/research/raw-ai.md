# 外部调研：Utility AI 与 Smart Objects（原理、工业后验、成本、PawOffice 适用性）

> **证据分级**：`[文档]` 引擎/官方文档或 Game AI Pro 等章节明确写出的机制；`[案例]` 已发行游戏团队的第一手复盘/GDC 演讲；`[厂商]` 商业产品页面（有宣传动机）；`[实践]` 个人开发者经验（样本量 1，仅作参考）；`[推断]` 本文基于机制与项目约束的推理，**需原型验证**。
> **本地事实**来自仓库文档与代码（[整数格与家具互动](../integer-grid-and-interactions.md)、[空闲咖啡](../idle-coffee.md)、`packages/runtime/src/model.ts`、`packages/runtime/src/scenePack.ts`、`packages/scene-office/src/core/OfficeIdleCoffee.ts`），本次未修改任何代码。

## 0. 结论先行

- **Utility AI：有条件有用，当前不建议整包引入。** 现有手写启发式（咖啡调度、农场照料）在行为种类 <5 时够用；当行为 ≥6、出现两两优先级冲突、需要角色差异、或设计师要求不改代码调频率时，收益才超过成本。先做 1 周 M0 实验再决策。
- **Smart Objects：数据层已存在 60–70%，值得补"查询/预检/失效"，不值得照搬框架。** 我们的 `interactions + anchors + resources + 原子预约 + 姿态契约` 已覆盖其核心；缺的是只读候选索引、slot 可用性预检、revision 失效语义。UE 式"对象挂行为定义 + 全局空间分区注册表"与本项目"姿态/动画在角色侧、命令由后端驱动"的约束冲突。
- **最推荐的形态：后端下发"意图"，前端 utility 只负责"选对象与时机"**；不新增协议字段，自治命令与外部命令同构，外部命令永远优先。
- **最大的坑是调参与可解释性成本，不是算法。** 不做分数可视化，utility 会退化成另一团意大利面。

## 1. 定义与范式

### 1.1 Utility AI：用连续分数表达"多想要"

**核心循环** `[文档]`：枚举候选动作 → 对每个动作取若干 consideration（世界量：距离、需求、状态、时间）→ 每条经 response curve 归一化到 `[0,1]` → 合成总分 → 选择（argmax / 加权随机）→ 执行。
关键区分：**分数表达"多想要"，不表达"能不能"**；能力、锚点、姿态、资源是否可用仍必须用布尔前置条件过滤（见 [Game AI Pro 1 Ch9](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf)）。

**consideration 与 response curve** `[文档]`：线性（等速衰减）、二次（先平后陡/先陡后平）、logistic（阈值/甜点区）。曲线的中点与斜率通常比权重更能表达设计意图（"多近才开始在意"），也是调参时最容易失控的部分（见 [Game AI Pro 3 Ch13](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf)）。

**合成：可补偿 vs 不可补偿** `[文档]`：

```
加权和（可补偿）  score = Σ wᵢ · curveᵢ(inputᵢ)        // 高分可抵消低分，直觉但易"均值化"
乘法（不可补偿）  score = Π curveᵢ(inputᵢ)              // 任一为 0 直接否决，IAUS 风格
混合             score = Π gateᵢ · Σ wᵢ·curveᵢ          // 硬门槛 + 软权衡，实践常见
```

乘法会放大"某项极低"的影响，适合"只要有一条不满足就不该做"的场景；加权和适合"几条都不错、权衡取舍"的场景。两者都要求各项先归一化，否则量纲决定结果。

**选择与时间维度**（抖动抑制的全部家当）`[文档]`：决策频率（不必每帧重算）、当前动作惯性/滞回（当前动作加分或最小承诺时长）、切换阈值（`score_new > score_current + margin` 才切）、冷却、平局随机或加噪。Dave Mark 的演讲专门讲"在时间、空间、深度上管理行为"，核心就是这些（见 [Architecture Tricks, GDC 2013](http://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in)，GDC Vault 现多跳转至 gdconf.com）。

**IAUS（Dave Mark）** `[厂商]`：2012 年起的数据驱动 utility 架构，响应曲线 + 乘法合成，提供数据库式设计工具，C++/C# 版本；官方称在 ArenaNet《Guild Wars 2: Heart of Thorns》部署，并给出"设计师 7 分钟搭一个 AI 包"的演示（[gameai.com/iaus.php](https://gameai.com/iaus.php)）。**注意**：7 分钟是宣传口径，不含设计、调试与内容制作；不能作为小团队成本依据。

**The Sims 为什么是经典 utility 案例** `[案例/文档]`：需求（motives）随时间衰减；场景物体的 **advertisement** 广播"我能满足哪个需求、满足多少"；sim 以需求紧迫度 × 广告值 × 距离/占用挑选交互，再组成动作队列。经典的原因不是数学，而是**世界数据自带评分信息**：新增内容 = 新增带广告的物体，无需改决策代码；连续需求压力自然产生多样行为（见 [Zubek《Needs-Based AI》](https://robert.zubek.net/publications/Needs-based-AI-draft.pdf) 与 [1998 年 Sims 设计文档](https://web.archive.org/web/20210308141246/https://donhopkins.com/home/TheSims/TheSimsDesignDocumentDraft3-1998-08-07-DonsReview.pdf)）。

**RimWorld 与 utility 的关系** `[案例]`：ThinkTree 是**层级化候选选择**——节点按游戏条件与优先级返回 Job；work priority 是玩家设定的桶；执行由 Job/JobDriver/Toil 顺序推进，Toil 内做资源 reservation。它是 utility 的"离散化/优先级化"版本：便宜、可解释、玩家可调，但软性权衡表达力弱（社区逆向说明见 [RimWorld Modding Guide](https://github.com/roxxploxx/RimWorldModGuide/wiki/SHORTTUTORIAL:-How-Pawns-Think)）。

**Oxygen Not Included** `[案例]`：每个 duplicant 对每类 chore 设优先级桶 + 子优先级 1–9，同分用就近或隐藏优先级打破平局；生理需求会自动优先处理，紧急状态（Red Alert）则强制忽略需求。两层优先级 + 就近 tie-break 支撑几十个 agent（[ONI Wiki: Priority](https://oxygennotincluded.wiki.gg/wiki/Priority)）。这说明**管理模拟不必须上 utility**。

**与其它架构的边界** `[文档/推断]`：

| 架构 | 擅长 | 不擅长 | 与 PawOffice 的关系 |
| --- | --- | --- | --- |
| FSM | 状态少、流程固定 | 并行竞争目标一多就爆炸 | 现有咖啡调度本质就是一个小 FSM |
| Behavior Tree | 层级化、可打断、序列/回退清晰 | 大量软目标权衡会变成条件爆炸 | 若只做"活动编排"够用 |
| Utility AI | 多软目标并行权衡、数据驱动调参 | 顺序/长流程、可解释性依赖工具 | 只适合做**单角色原子行为**的选择层 |
| GOAP/HTN | 多步规划、预条件/效果可枚举 | 状态建模与重规划调试成本高 | 现有 activity 的 phases/claims 已是**脚本化计划**，不需要 planner |

`[文档]` Game AI Pro 有专章讨论"把 utility 决策嵌进现有 BT"（Ch10）与行为选择算法总览（Ch4），业界主流是 **utility 选目标 + BT/FSM 执行**，而非二选一。

### 1.2 Smart Objects：把"能和什么互动"变成数据 + 预约

**概念链**：affordance（物体提供的动作可能性）→ advertisement（物体广播可满足的需求/可执行交互）→ interaction slot（物体上一个可被占用的使用位）→ reservation/claim（先占位再前往）→ preconditions（用户标签、状态要求）+ effects（对象状态修改）→ planner 集成（把"对象交互"当作规划操作符，或用对象查询生成候选）。

**UE 实现** `[文档]`（[Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview)）：SmartObject 子系统维护全局注册表 + 空间分区；Definition 数据资产保存不可变数据（user tags、activity tags、默认 behavior definitions）；一个对象有一个或多个 Slot（相对锚点的 transform + 可覆盖属性）；运行时时序为 `FindSmartObjects → Claim（Claim Handle）→ 寻路到位 → Use（Claimed→Occupied）→ Release`，对象状态变化通过 `OnSlotInvalidatedDelegate` 通知。**文档明确写"Smart Objects do not contain execution logic"**：它只提供数据与预约，交互逻辑由 agent/player 自己实现。官方 Quick Start 用 BT + Blackboard 两个 Task，从查询结果里**随机**挑一个（[Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---quick-start)）——恰好证明 SO 解决"能和谁互动/占位"，不解决"该不该"。该插件在 UE 4.27 已存在 API（[4.27 API 文档](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/SmartObjectsModule/USmartObjectBlueprintFunctionLib-?application_version=4.27)），UE5 文档化并配 Gameplay Behavior 插件。

**其它代表性实现**：
- 环境查询（EQS 思路）"向环境提问"：带过滤的空间查询生成候选，与 SO 搜索同构（[Game AI Pro 1 Ch33](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter33_Asking_the_Environment_Smart_Questions.pdf)）。
- Smart Zones：以区域而非单个物体为单位提供氛围交互（[Game AI Pro 2 Ch11](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter11_Smart_Zones_to_Create_the_Ambience_of_Life.pdf)）；对"对象太多"是一种可能的降维，具体收益按原文与原型验证。
- RimWorld 的 reservation 是同一问题的轻量解（JobDriver 里 `Toils_Reserve.Reserve`）。
- Hitman: Absolution 的沙盒/战术感知是"系统驱动的环境交互"，常被引为案例，但它不是通用 smart object 架构（[GDC 2013: Spaces in the Sandbox](https://archive.org/details/GDC2013Vehkala_201511)），引用时不要混淆范式。
- **与 planner 的集成**：planner 把"对象 + 交互"当作操作符（preconditions/effects 来自交互声明），或者反过来用对象查询为规划器生成候选；本项目现有 activity 的 phases 是"预写好的计划"，因此不需要 planner，只需要候选 + 排序。

**它解决/不解决什么**：

| 解决 | 不解决 |
| --- | --- |
| 候选发现（附近有什么可互动） | 该不该做、多想要（需要 utility/needs） |
| slot/占用仲裁与并发一致性 | 多角色协同编排（谁和谁一起） |
| 数据化作者性（内容=数据） | 多步长流程（需要 plan/BT/phases） |
| 交互与执行解耦 | 可达性/姿态合法性（要寻路与动作契约校验） |

**与 Utility AI 是一体两面** `[案例/推断]`：广告负责"生成候选并携带偏好"，需求/效用负责"排序"。经典写法可概括为 `score = needUrgency × adValue × distanceFactor`。**PawOffice 的农场自动照料（按作物状态与距离排序）就是这条公式的原始版本**——数据里已有"广告值"，只是没形式化。

**数据驱动/MVVM 映射** `[推断]`：把 ScenePack（模板的 `interactions/anchors/resources`）当场景视图模型数据；affordance index 是从 `World + ScenePack + Snapshot` 派生的只读 selector（纯函数、可单测）；调试面板订阅派生的决策视图模型。**不把决策状态写进 `World`/存档**，也不让对象侧持有执行逻辑——这与本项目"渲染与动画装配分离、内核不依赖 Pixi"的既有分层一致。

## 2. 案例与后验

> 读法：厂商页（IAUS"7 分钟搭一个 AI 包""不易卡死"）与引擎文档（机制是什么）不能当复盘；真正可迁移的是已发行团队写的章节/演讲，以及开发者个人对"哪里疼"的复盘。下表按这条原则标注证据类型。

| 案例 | 规模/背景 | 收益（作者/团队口径） | 代价与坑 | 证据 |
| --- | --- | --- | --- | --- |
| The Sims 1–4 | Maxis，AAA 内容规模 | 需求 + 对象广告让行为多样、内容可持续新增、大幅减少逐行为脚本 | 内容量巨大；调参与工具投入大；小团队无法复制其内容规模 | `[案例/文档]` Zubek、1998 设计文档、GMTK |
| GW2: Heart of Thorns（IAUS） | ArenaNet，MMO 大规模 NPC | 数据驱动、行为可复用、设计师自建 AI 包、行为不易卡死 | 需专用编辑工具；培训与调参成本为行业经验（`[推断]`）；宣传口径与真实制作工时无关 | `[厂商/案例]` gameai.com + GDC 2015 |
| Dragon Age: Inquisition（BDS） | BioWare，AAA RPG 战斗 | 用效用评分支撑大量战斗决策与调参 | 评分架构本身即一项工程，需要配套工具与调参流程（按章节主题与行业观察，`[推断]`） | `[案例]` Game AI Pro 3 Ch31 |
| RimWorld | Ludeon，小团队殖民模拟 | 优先级 + ThinkTree + reservation：便宜、可解释、玩家可调 | 软性权衡弱；"为什么选这个工作"玩家只能看优先级表 | `[案例]` 模组wiki |
| Oxygen Not Included | Klei，中型团队模拟 | 两层优先级 + 就近 tie-break 支撑几十 agent | 同上，表达力有限；靠玩家设置弥补 | `[案例]` ONI wiki |
| 独立开发者实践 | Unity 个人插件作者 | utility 让"优先级可见"、迭代快 | "scoring actions is easy, scoring them well is not"；consideration 越加越难调试；容易过度设计 | `[实践]` Mykaa 开发日志 |

**收益（有来源支撑的部分）**：行为多样性来自"打分组合"而非穷举分支；新增行为常是加数据/加 consideration 而不是改优先级链；行为不易因条件漏写而卡死；适合"很多平行的软目标"。
**后验中的坑**（区分来源）：
- **调参地狱/不可解释** `[实践/案例]`：分数是多个因子的乘积，出问题时无法像 BT 那样指出"哪个分支失败"；没有逐项分数日志就只能猜。
- **行为抖动/振荡** `[案例/文档]`：两个动作分数接近时高频切换；工业界的标准解法是决策频率、惯性/滞回、切换 margin、冷却与随机化，而不是继续加权重。
- **内容量爆炸** `[推断+案例]`：行为数、consideration 数、角色差异三者相乘；The Sims 靠内容团队撑住，小团队会被拖垮。
- **工具成本被低估** `[案例/厂商]`：DAI 的效用评分是团队级系统（章节以架构为主题），IAUS 把编辑器当卖点——两者都指向同一结论："没有评分编辑/调试手段，utility 很难维护"（工具必要性的程度为 `[推断]`）。
- **过设计的典型信号** `[推断]`：先写框架再写行为、先做编辑器再做 3 个可玩行为、把 AAA 的全套概念（slot、tag query、spatial subsystem）搬进单场景小项目。

## 3. 成本与失败模式

### 3.1 工程量估算（PawOffice 视角，1 名熟悉仓库的 TS 工程师；`[推断]`，需 M0 校准）

| 工作项 | 估算 | 说明 |
| --- | --- | --- |
| Affordance 索引与查询（从模板/道具/资源快照生成候选） | 1–3 人日 | 纯函数，无 Pixi，可 node --test |
| Utility 打分器（曲线、合成、归一化、种子随机） | 2–4 人日 | 核心算法本身很小，测试占一半 |
| AutonomyDirector 插件（tick、租约、抢占、冷却、失败回退） | 2–4 人日 | 复用现有 ScenePlugin/命令提交通道与 `beforeCommand` |
| 数据 schema（zod 校验 + 示例配置） | 1–2 人日 | ScenePack 可选字段，向后兼容 |
| 调试面板（top-k、分项分数、选择的动作） | 1–2 人日 | DOM 面板即可，无需进 Pixi |
| 模拟/指标 harness + golden 测试（种子、回放） | 2–3 人日 | 没有它无法做"是否值得"的判断 |
| 每个新行为的调参 | 0.5–2 人日（首次） | 稳定后 0.25–0.5 人日 |
| 多角色协调器（若要做联合活动） | 3–5 人日 | 复用现有 single-slot resource / 会话概念 |
| **M1 合计** | **约 3–5 工程师周** | 不含新动画/素材与后端联调 |
| **若照搬 UE 式 SO** | **+3–6 周** | 注册表、标签体系、slot 状态机、编辑器、验证矩阵，长期维护成本高 |

**隐性成本**：调参是持续成本，每个新行为都会增加"这个分数为什么是这个值"的沟通成本；不投入可解释性工具时，上述估算至少翻倍。Web 前端的优势是调试面板便宜（DOM + 事件），这是相对 AAA 的实质性优势。

### 3.2 失败模式与规避（≥3 条，按风险排序）

| # | 失败模式 | 表现 | 规避方式 |
| --- | --- | --- | --- |
| 1 | 调参地狱/分不可解释 | 行为怪但说不出原因；改 A 坏 B | 限制每行为 2–4 个 consideration；记录分项分数与曲线参数；调试面板显示 top-k 与 margin；用场景化 golden 测试锁行为 |
| 2 | 行为抖动/振荡 | 咖啡↔窗边高频切换；同一角色反复横跳 | 惯性加分、最小承诺时长、切换 margin、决策间隔、冷却、种子随机；指标监控 switch/min |
| 3 | 内容量爆炸 | 行为数 × 角色差异 × consideration 数失控 | 行为模板库；禁止角色特判；上限 + 评审；新增行为必须带来可量化指标改善 |
| 4 | 与外部命令冲突/资源竞态 | 自主动作刚发起就被外部活动打断；资源被占 | 自治租约 + 外部命令最高优先（`beforeCommand` 释放）；提交前预检资源/可达性；失败进事件而非重试风暴 |
| 5 | Smart Object 数据膨胀/状态不一致 | 布局改了索引还指向旧锚点；对象状态与候选不符 | 候选**派生**而非复制；按 `layoutRevision/stateRevision` 失效；布局编辑时暂停自治；zod 校验 |
| 6 | 多角色编排缺失 | 6 个人同时去同一个咖啡机；两人咖啡聊不起来 | 明确 utility 只做原子行为；联合活动保留 coordinator（沿用现有 coffee 单名额资源/会话模型） |
| 7 | 跨场景语义漂移 + 验证矩阵爆炸 | 办公室"休息"是坐沙发，农场"休息"是回屋，教室没有对应物；每加一个交互要手测所有场景 | 统一少量动作标签（sit/drink/social/work/rest）+ 契约测试；交互必须有 pose/可达性测试；标签缺失时显式降级 |
| 8 | 寻路/占用误判 | 候选看起来空着，走到一半被堵或入口被占 | 候选预检包含"入口可达 + 姿态可满足"；失败即换候选并记录原因（现有 runtime 已有 NO_ROUTE/UNSUPPORTED_POSE 语义可复用） |
| 9 | 小团队过设计 | 先建框架/编辑器，最后只有 2 个行为 | M0 先证伪；dev-only 面板；3 个行为验证 ROI 后再扩展；不引入 planner |

## 4. 对 PawOffice 的适用性判断

### 4.1 现状事实（来自仓库，不是推测）

- 命令协议 **2.0**，外部业务后端下发 `activity.start`（capability/participants/params），前端负责排队、原子预约、寻路、姿态校验、执行与收尾；存在 `beforeCommand` 钩子供插件在外部命令前释放本地占用（[整数格与家具互动](../integer-grid-and-interactions.md)）。
- 场景包的家具模板已声明 `interactions`（name/anchor/approaches/cells/facing/posture/`requiresHome`/`resource`）与 `resources` 容量（`packages/runtime/src/model.ts`），执行顺序是 `提交 → 排队/预约 → 选最近入口 → 逐格靠近 → 预约局部通道 → 到位 → 保持 → 离开 → 释放`。
- 现有自主行为只有两处：`OfficeIdleCoffee`（单咖啡名额资源 + 每人 cooldown + 随机 5–15s + 近期搭档降权，本质是有状态的小调度器）与农场自动照料（按作物状态与距离排序的贪心）。
- 运行时内核不依赖 Pixi；整数格；姿态/动作契约是硬约束；存档 version 2 为 strict 结构。

### 4.2 结论：Utility AI —— **有条件有用，当前先 M0，不整包引入**

判断依据：
1. **解决的是不是真问题**：现在只有 2 个行为，启发式够用；utility 的收益随"行为数 × 冲突数 × 角色差异"增长，当前这三项都低。
2. **现有启发式何时不够**：行为 ≥6 且两两互相抢时间（咖啡 vs 农场 vs 饮水 vs 窗边 vs 伸懒腰 vs 摸鱼）；同一物体被多角色竞争出现饥饿；需要按角色性格/状态差异化；设计师要求"改个配置就能调频率"；抖动靠不断堆 cooldown 补丁。
3. **外部命令权威性**：后端是唯一业务权威。前端 utility 若做"全自治"会与后端抢决策权，ROI 低、责任不清；**做"意图→选对象/时机"的局部决策 ROI 高**（后端仍决定"要做什么"，前端决定"在哪儿做、什么时候做"）。
4. **6–10 角色、单场景、Web**：算力不是瓶颈，瓶颈是调参与可解释；DOM 调试面板成本低，这是本次值得做的部分。

**判为"无用/过度设计"的条件**：产品定位就是"后端剧本 + 少量氛围行为"；或只为让 idle 动画看起来不呆板——那只要随机/权重表就够，不需要评分框架。

### 4.3 结论：Smart Objects —— **有条件有用；补数据/查询层，不引入框架**

| 已经有的（约 60–70%） | 真正缺的 |
| --- | --- |
| 交互声明（anchor/approaches/cells/posture/facing） | 只读候选索引：任意 actor 在当前位置"现在能做什么" |
| 资源容量与原子预约（`resources`/`claims`/holders） | 决策前的可用性**预检**（避免选中后失败） |
| `requiresHome` 用户限制 | 通用用户标签/前置条件表达 |
| 布局/状态 revision 概念 | 明确的失效策略与事件（索引过期即失效） |
| 多阶段 activity（phases/poses/speech） | 多 actor 的 slot 语义（会议桌 4 个锚点 vs 单 `meeting` 资源） |

**不照搬 UE 的理由** `[推断]`：UE 的 `Behavior Definition` 要求"对象知道怎么被执行"，而本项目的动画/姿态能力在角色侧、执行逻辑在 runtime，两者会打架；全局空间分区注册表在单场景 <30 个道具时是纯开销；动态注册与布局编辑已有 revision 机制可替代。**照搬会把"数据化"变成"第二套权威"**。

### 4.4 必须原型验证的"行业经验/推断"

- 多样性提升是否**客户可感知**（录像盲评，而不是指标自嗨）。
- 6–10 角色是否会"共振"（同时做同一件事）——需要随机化 + 协调器，不能只靠 utility。
- 单场景对象 <30 时 affordance 索引是否真的必要（可能直接扫描更快）——先 benchmark 再决定。
- 每个行为的真实调参工时（本报告估 0.5–2 人日）——M0 用 3 个行为实测。
- 前端自治与后端权威的业务边界——这是产品决策，不是技术决策。
- utility 是否影响 60fps / GC（每帧打分 vs 分帧打分）。

## 5. 最小切片与集成

### 5.1 M0（1 周，可证伪实验，dev-only）

**目标**：用最小成本回答"在现有启发式之上，评分式选择是否真的提升可感知的生活感，且可控"。

- Day 1–2：`affordance index` 纯函数（输入 `World + ScenePack + Snapshot`，输出候选与不可用原因：资源被占/不可达/姿态不支持），单元测试；dev 页面列出候选。
- Day 3：3 个行为（咖啡独饮/窗边、接水、伸懒腰）× 各 2–3 个 consideration（需求、cooldown、距离、对象状态），2 条曲线（linear + logistic），乘法/加权和可切换；种子随机。
- Day 4：dev-only `AutonomyDirector`：每 N ms 决策一次，提交**现有形状**的 `activity.start`；外部命令到达即释放租约；预检失败换候选而非重试。
- Day 5：模拟 harness 跑 30 分钟 × 5 个种子（无渲染），输出指标；DOM 面板显示 top-5 与分项分数；与现有启发式基线对比。
- **通过标准**：指标表（见 5.4）可采集且方向正确；3 人盲看两段录像能分辨差异；100% 决策可解释；无协议/存档/姿态回归。
- **失败标准**：多样性无提升，或调参超过 2 天仍抖动，或外部抢占出现孤儿占用——任一命中即结论"暂不引入"。

### 5.2 M1（3–5 周，产品化，可开关）

- ScenePack 可选 `autonomy` 配置（zod 校验，向后兼容）：`behaviors[]`（id、capability、params、considerations[{input, curve, weight}]、cooldownMs、inertia、margin）。
- `AutonomyDirector` 作为正式 scene plugin：多行为、租约、抢占、失败回退、按场景开关；办公室/农场/教室各自提供行为配置。
- 调试与观测：`autonomy.scored / decided / failed` 事件进入现有 SceneEvent；dev 面板升级为时间轴 + 分布直方图；生产环境仅保留计数指标。
- 多角色：单槽资源沿用；联合活动（咖啡聊天）保留 coordinator，**不**交给 utility。
- 文档 + 回归测试 + 回滚开关（按场景/按产品）。

### 5.3 集成草图（不改协议）

```
外部业务后端 ──activity.start(协议 2.0)──▶ CommandQueue ──▶ SceneRuntime（权威：预约/寻路/姿态/执行）
                                                      │  只读快照(world, resources, revisions)
                                                      ▼
                                   AutonomyDirector（可选 scene plugin）
                                     ├─ AffordanceIndex（纯函数，派生候选）
                                     ├─ UtilityScorer（曲线/合成/种子随机/滞回）
                                     ├─ Lease & Cooldown（外部命令 via beforeCommand 抢占）
                                     └─ 提交"同构" activity.start（无新字段）
                                                      │
                                        SceneEvent ──▶ DebugPanel（dev） / 指标采集
                                                      │
                              ScenePack（可选 autonomy 配置）+ 模板 interactions/anchors/resources
```

**新增层，不破坏现有约束**：
- 协议 2.0 不变：自治命令与外部命令同构，不新增字段；"来源=autonomy"只进本地 SceneEvent；
- 整数格/姿态契约不变：候选预检必须走姿态与可达性校验，失败原因进事件；
- 资源预约不变：不做软预约绕过，预检失败换候选；
- 存档 v2 不变：**不持久化**自治状态，加载后重新决策（种子由 dev 配置或命令日志派生以保证回放）；
- 内核不依赖 Pixi：`affordances/` 与 `autonomy/` 放 runtime 侧纯 TS，面板放 apps/renderer；
- 编辑模式暂停自治（对齐咖啡的现有行为）；外部命令永远优先。

### 5.4 可量化验收指标

| 指标 | 定义 | M0 目标 | M1 目标 |
| --- | --- | --- | --- |
| 行为多样性 | 每角色每 10 分钟不同行为数 / 行为分布熵 | ≥ 基线 +50% | 稳定且非单行为垄断 |
| 闲置率 | 可行动角色处于"无活动且无氛围行为"的时长占比 | 低于基线 | 低于基线 30%+ |
| 抖动 | 每角色每分钟行为切换次数；中位停留时长 | ≤2 次/分 | ≤1 次/分 |
| 冲突/失败率 | 选中候选因资源占用/不可达/姿态失败的比例 | <10% | <5% |
| 可解释性 | top1–top2 margin 分布；分项分数日志覆盖率 | 100% 决策有日志 | 100%，面板可回放 |
| 外部抢占 | 外部命令到租约释放的延迟；孤儿占用数 | 0 孤儿 | 0 孤儿，p95 < 100ms |
| 性能 | 每次决策耗时；每帧总开销 | <1ms/角色 | 每帧 <5% 预算 |
| 内容成本 | 新增一个行为所需的代码/配置/工时 | 0 代码 + ≤1 条配置 | <30 分钟，无需发版 |
| 确定性 | 同种子 + 同命令日志 → 同命令序列 | 通过 | 通过 |

## 6. 参考文献（按主题分组；标注可靠性）

**A. Utility AI 定义、曲线与合成（可靠：专业书籍章节，免费）**
1. [An Introduction to Utility Theory — David "Rez" Graham, Game AI Pro 1 Ch9](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf) — 概念、consideration、归一化与调参入门。
2. [Choosing Effective Utility-Based Considerations — Mike Lewis, Game AI Pro 3 Ch13](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf) — 工业界如何挑 consideration（作者为 ArenaNet AI，曾与 Dave Mark 同台讲解 IAUS 落地）。
3. [Behavior Selection Algorithms: An Overview — Game AI Pro 1 Ch4](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter04_Behavior_Selection_Algorithms.pdf) — FSM/BT/utility/规划器横向对比。
4. [Building Utility Decisions into Your Existing Behavior Tree — Game AI Pro 1 Ch10](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter10_Building_Utility_Decisions_into_Your_Existing_Behavior_Tree.pdf) — utility 与 BT 混合的工业常态。
5. [Dual-Utility Reasoning — Kevin Dill, Game AI Pro 2 Ch3](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter03_Dual-Utility_Reasoning.pdf) — 单一效用轴的局限与双轴扩展。

**B. IAUS / Dave Mark 与 GDC 演讲**
6. [Intrinsic Algorithm — Infinite Axis Utility System](https://gameai.com/iaus.php) — IAUS 官方说明、GDC 演讲索引（厂商页面，注意宣传口径）。
7. [Architecture Tricks: Managing Behaviors in Time, Space, and Depth（GDC 2013）](http://www.gdcvault.com/play/1018040/Architecture-Tricks-Managing-Behaviors-in) — 决策频率、惯性、抖动抑制（GDC Vault 现跳转 gdconf.com）。
8. [Building a Better Centaur: AI at Massive Scale（GDC 2015）](http://www.gdcvault.com/play/1021848/Building-a-Better-Centaur-AI) — IAUS 在 GW2: HoT 的完整部署与编辑工具演示。
9. [Curvature — 开源 utility AI 编辑器](https://github.com/apoch/curvature) — 工具化成本与数据模型的现实参考。

**C. The Sims / Smart Objects 经典**
10. [Needs-Based AI — Robert Zubek, Game Programming Gems 8（作者草稿 PDF）](https://robert.zubek.net/publications/Needs-based-AI-draft.pdf) — needs + advertisement + smart objects 的形式化描述。
11. [The Sims 设计文档 Draft 3（1998，Don Hopkins 审阅版，Wayback）](https://web.archive.org/web/20210308141246/https://donhopkins.com/home/TheSims/TheSimsDesignDocumentDraft3-1998-08-07-DonsReview.pdf) — 对象广告/需求的早期原始表述。
12. [The Genius AI Behind The Sims（Game Maker's Toolkit，二手解读）](https://gameindustrylibrary.com/documents/gmtk-the-genius-ai-behind-the-sims) — 面向大众的机制梳理，可作辅助而非一手证据。

**D. 已发行案例与后验**
13. [Behavior Decision System: Dragon Age Inquisition's Utility Scoring Architecture, Game AI Pro 3 Ch31（见目录）](http://www.gameaipro.com/) — AAA 效用评分架构的团队复盘。
14. [RimWorld Modding Guide: How Pawns Think](https://github.com/roxxploxx/RimWorldModGuide/wiki/SHORTTUTORIAL:-How-Pawns-Think) — ThinkTree/Job/JobDriver/Toil/reservation 的机制说明（社区逆向，机制可信、口径非官方）。
15. [Oxygen Not Included Wiki: Priority](https://oxygennotincluded.wiki.gg/wiki/Priority) — 优先级桶 + 子优先级 + 就近 tie-break 的玩家可见机制。
16. [GDC 2013: Spaces in the Sandbox — Tactical Awareness in Open World Games（Hitman: Absolution, IO Interactive）](https://archive.org/details/GDC2013Vehkala_201511) — 环境驱动交互的相邻范式，非通用 smart object 架构。
17. [Utility AI & The Sims — Mykaa 开发日志](https://mykaadev.github.io/articles/Learning%20Utility%20AI/) — 个人实践者对"过度加 consideration"的复盘（样本量 1，仅作参考）。

**E. Smart Objects / 环境查询实现**
18. [Smart Objects in Unreal Engine — Overview](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---overview) — subsystem/Definition/Slot/Claim/Use/Release 与"不含执行逻辑"。
19. [Smart Objects in Unreal Engine — Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/smart-objects-in-unreal-engine---quick-start) — 最小示例的完整数据与 BT 接线（可作工程量基准）。
20. [UE 4.27 SmartObjects Blueprint API](https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/SmartObjectsModule/USmartObjectBlueprintFunctionLib-?application_version=4.27) — 4.27 已存在该插件。
21. [Asking the Environment Smart Questions — Game AI Pro 1 Ch33](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter33_Asking_the_Environment_Smart_Questions.pdf) — "向环境提问"式的空间查询，与 SO 搜索同构。
22. [Smart Zones to Create the Ambience of Life — Game AI Pro 2 Ch11](http://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter11_Smart_Zones_to_Create_the_Ambience_of_Life.pdf) — 按章节主题属区域级 affordance，可作"对象太多"的降维参考。
23. [Breathing Life into Your Background Characters — Game AI Pro 1 Ch36](http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter36_Breathing_Life_into_Your_Background_Characters.pdf) — 按章节主题讨论背景角色的低成本行为设计（与 PawOffice 氛围层直接相关）。
24. [Ambient Interactions: Improving Believability by Leveraging Rule-Based AI — Game AI Pro 3 Ch35](http://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter35_Ambient_Interactions_Improving_Believability_by_Leveraging_Rule-Based_AI.pdf) — 规则化环境交互提升可信度。
25. [Unity Utility AI 插件的设计文档（厂商文档，含 needs/smart objects 章节）](https://www.nooparmygames.com/WF-UtilityAI-Unity/articles/design.html) — 中间件实现参考与二手书单。

**F. 说明**：本报告未把 GDC Vault 专访页、商店页与 AI 生成内容当作证据；`[推断]` 项与 `[实践]` 项在正文中已单独标注，需 M0 原型验证后才能进入最终技术方案。
