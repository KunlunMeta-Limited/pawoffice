# IK 调研：2D 帧动画办公室（PawOffice）要不要做反向运动学

> 对象：PawOffice —— Vite + React + Pixi 8.22（`pixi.js@8.22.0`）+ TypeScript，人物为逐帧烘焙 sprite sheet，无骨骼播放器；办公室是平坦整数格，2:1 轴测为独立示例。
> 调研日期：2026-10-27。外部资料只作为证据使用；本仓库结论附了代码/文档路径。工作量为估算，需 spike 校准。

## 0. 结论摘要

1. **现在不做运行时 IK；真 IK 留到 `animation-skeleton` 骨骼适配器阶段再做。**帧位图没有可旋转的关节，IK 只能作用于骨架/网格；在当前素材上做 IK 等于先重做整条美术管线。
2. **但"等骨骼"不是唯一动作：现在值得做一个 1–3 天的 IK-lite spike**（根部/整体位移插值 + 动作重定时/接触 cue），先消除入座、端咖啡、转头三类视觉瑕疵，再决定是否冻结。
3. **办公室真正需要的只有三类**：手/杯/文件等接触对齐、注视朝向、整体位移与姿态过渡。足部地形适配、3D 瞄准、长链程序化肢体在平坦单层办公室**不存在**。
4. **行业里像素风 2D 的常态不是运行期 IK**：要么逐帧（Shovel Knight），要么 3D 渲染成像素（Dead Cells），要么程序化生物（Rain World）；运行期 IK 的主场是高清矢量/骨骼 2D 与 3D。
5. **`contacts` 契约应保留而非删除**：继续明确拒绝非空 contacts，但把它定义为"验收契约 + 可选 warp 目标"；IK 求解能力由未来适配器自行声明和验收，场景宿主不做通用求解。

## 1. 问题域：IK 解决什么，办公室哪里真的需要

### 1.1 IK 的定义与通用收益

Spine 用户指南讲得最直接：FK 是自上而下（先转上臂再转前臂），IK 是自下而上（先定手/脚目标，再自动求骨旋转）；IK 最常用于"通过移动手或脚来控制四肢"，典型场景包括走路脚不穿地、运行时把目标放到不平地形（[Spine IK constraints](https://esotericsoftware.com/spine-ik-constraints)）。Unity 把 IK/Aim 归为 World Interaction rigs，用于 targeting 和修正动画压缩伪影（[Unity Animation Rigging 1.3](https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.3/manual/index.html)）。

### 1.2 办公室场景逐项判定

| IK 的典型用途 | 具体表现 | PawOffice 是否存在 | 当前替代/证据 |
| --- | --- | --- | --- |
| 足部接触（foot placement） | 脚贴地、台阶、斜坡、不平地形 | 仅"平地站立/坐姿脚底" | 脚底是烘焙常量（站 344、坐 377），整数格无高差（[整数格与家具互动](../integer-grid-and-interactions.md)） |
| 地形适配 | 上楼梯、跨过障碍、贴地滚动 | **不存在** | 平坦单层整数格；家具只占格，不可站立其上 |
| 手部接触（hand contact） | 手贴键盘/鼠标、端杯、递文件、开门 | **存在**，但受家具/动作集合约束 | 当前用整帧烘焙；测试期用作者接触点校验（[computerWork.test.mjs](../../tests/computerWork.test.mjs)） |
| 坐姿接触 | 手放桌面、肘撑、手扶椅 | 存在 | 同上；座椅/桌面有锚点与工件校准（[integer-grid](../integer-grid-and-interactions.md)、[character-art-standard](../character-art-standard.md)） |
| look-at / 注视 | 头部/眼睛持续朝向目标（同伴、光标、道具） | **存在**（朝同伴看、说话转头） | 现有坐姿左/右转头帧与朝向切换（`VisualRequest.view`），无连续旋转 |
| 瞄准（aiming） | 武器/工具指向可变目标 | **不存在** | 无远程攻击、无光标瞄准、无载具 |
| 身体倾斜/次级运动 | 受击后仰、惯性、呼吸、布料飘动 | 部分存在（呼吸、上下浮动、咖啡抬手） | 用整帧或整体 transform 即可，不需要关节求解 |
| 程序化动画 | 尾巴、触手、随附物理、长链肢体 | **不存在** | 人物是完整图像帧，无长链、无尾巴/披风 |
| 2:1 轴测适配 | 屏幕空间各向异性目标 | 轴测是独立示例 | 格→屏幕投影后 y 比例不同；若做 IK 需在格空间求解再投影，成本上升且当前无需求（[dimetric 示例](../../examples/dimetric/README.md)） |

### 1.3 小结

对办公室而言，"手足接触"的真实内涵是**站位/家具/动作的预对齐**，"注视"是**朝向与转头帧选择**，都不是"任意姿态实时求解"。现有三个替代路径（烘焙帧、整体 transform、朝向帧）已经覆盖业务需求；IK 的增量收益主要出现在"目标位置/家具高度不确定"的场合，而平坦办公室恰恰把这类不确定性降到了最低。

## 2. 算法与引擎现状

### 2.1 算法：2D 平面下哪些适用

| 算法 | 原理 | 2D 适用性 | 与本项目相关性 |
| --- | --- | --- | --- |
| two-bone analytic（解析两骨） | 余弦定理直接求肘/膝中间角，固定骨长、唯一解 | 最适合 2D 手臂/腿；计算量极小、确定性好 | **最相关**：Unity 2D 的 "Limb" solver、Spine 两骨 IK 都是它；本仓库 `solveWorkArm` 也是标准两连杆解析（[workAnimation.ts](../../packages/assets-office/src/frame/workAnimation.ts)） |
| FABRIK | 前后向迭代到达，逐步修正关节位置（Aristidou & Lasenby, *Graphical Models* 73(5), 2011） | 可用于 2D 多关节链；需要迭代次数/容差 | 办公室没有长链，收益低；[论文](https://www.semanticscholar.org/paper/ef4396be51f253ed986a1db18d4bffd5e5e4acb3) / [DOI](https://doi.org/10.1016/j.gmod.2011.05.003) |
| CCD | 逐关节旋转逼近目标，迭代收敛 | 2D 可用，收敛慢、易摆动，需 velocity/迭代上限 | Unity 2D 提供 Chain (CCD)；本项目无长链 |
| spline IK | 用样条驱动长链（尾巴、触手、鞭子） | 2D 少用；UE Control Rig 的 Spline Rigging 即此类 | 无需求（[UE Spline Rigging](https://dev.epicgames.com/documentation/en-us/unreal-engine/control-rig-spline-rigging-in-unreal-engine)） |
| look-at / aim | 旋转对象朝向目标，可加权混合多个目标 | 2D 可用；通常只需一个旋转轴 | Unity Multi-Aim、Spine 单骨 IK；帧方案可用"朝向帧替换"更省（[Multi-Aim Constraint](https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.3/manual/constraints/MultiAimConstraint.html)） |

### 2.2 引擎与运行时现状

| 生态 | 关键事实 | 对本项目意味着什么 |
| --- | --- | --- |
| Spine | IK constraints 支持 1 骨/2 骨，带 softness、stretch、mix；**Spine Essential 不含 IK**；3 骨以上明确不支持，理由是"非确定性且难控制"；两骨 IK 有多条与缩放/形变相关的限制 | 真 IK 需 Spine Editor 商业授权 + 角色重做骨骼；2 骨够手臂，但前提是素材已分段（[IK constraints](https://esotericsoftware.com/spine-ik-constraints)） |
| DragonBones | 运行时暴露 `IKConstraint`（Cocos Creator 内置 dragonBones 绑定） | 可作 Spine 备选，但同样需要切图/绑骨，生态与文档弱于 Spine（[Cocos API](https://docs.cocos.com/creator/4.0/api/en/class/dragonBones.IKConstraint)） |
| Unity | Animation Rigging 提供 IK/Aim/Chain 约束；2D Animation 包的 IK Manager 2D 提供 **Limb（两骨解析）/ Chain (CCD) / Chain (FABRIK)**，要求骨骼与 Sprite Skin，提供 Weight 混合与 Always Update 性能开关 | 证明引擎侧算法成熟；但"帧 sprite"不在此体系内（[2D IK](https://docs.unity3d.com/Packages/com.unity.2d.animation@13.0/manual/2DIK.html)） |
| Unreal | Control Rig 提供 IK/Aim、Full-Body IK、Spline Rigging；IK Rig 用 goals+solvers，官方示例即"脚贴不平地形"；**Motion Warping** 用 root motion 对齐目标（Skew/Scale Warp，可指定静态点或骨骼点、warp 窗口、旋转朝向） | Motion Warping 是"不碰骨骼的内部结构、只改整体位移/旋转"的思路，最值得借鉴（[Control Rig](https://dev.epicgames.com/documentation/en-us/unreal-engine/control-rig-in-unreal-engine)、[IK Rig](https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-in-unreal-engine)、[Motion Warping](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-warping-in-unreal-engine)） |
| Pixi v8 | 无内置骨骼/IK；`@pixi/spine` 在 npm 上不存在，官方运行时是 `@esotericsoftware/spine-pixi-v8`（peer `pixi.js ^8.16.0`），package 的 major.minor 必须与 Spine Editor 版本对齐；Canvas 渲染不支持 slot objects/tint black/blend modes | 可接入，但引入编辑器授权、版本同步、包体/加载与一套新适配器验收（[spine-pixi 文档](https://esotericsoftware.com/spine-pixi)、[Runtimes License](https://esotericsoftware.com/spine-runtimes-license)） |
| Godot 2D | 提供 `SkeletonModification2DTwoBoneIK`；2D 骨骼动画需要把图切成多边形、绑骨、刷权重、必要时加内部顶点修正形变 | 说明"2D 骨骼 = 美术管线重做"，不是加一个 solver（[TwoBoneIK](https://docs.godotengine.org/en/stable/classes/class_skeletonmodification2dtwoboneik.html)、[2D skeletons](https://docs.godotengine.org/en/stable/tutorials/animation/2d_skeletons.html)） |

### 2.3 对 2D 的结论

2D 平面的标准答案是 **two-bone 解析 IK + 骨骼运行时**：解析解快、确定、无迭代；迭代法（FABRIK/CCD）只在长链或解析不可解时才有必要。2D 还比 3D 少两个自由度：没有 roll/pole vector 的连续选择，只需固定弯折方向（左/右），这也让解析解在 2D 更稳、更便宜。办公室既没有长链，也没有可变地形，算法层面没有新问题可解——问题在"素材是否是可解的骨骼"。

## 3. 2D 帧动画的现实约束

### 3.1 帧位图不能被 IK 直接作用

IK 的输出是"骨骼旋转/位移"，而烘焙帧是固定像素；不存在"把某一帧的手臂转 20°"的运行时操作。要让 IK 生效，只有三条路：骨骼/网格化（Spine、DragonBones、Unity 2D IK、Godot Skeleton2D）、每帧重绘、或整帧替换。这也解释了为什么 `FrameAdapter` 对非空 contacts 明确报错——不是实现偷懒，而是"位图帧没有可重定向的接触点"（[FrameAdapter.ts:99](../../packages/animation-frame/src/FrameAdapter.ts)）。

### 3.2 像素风与骨骼变形天然冲突

像素画的清晰感来自整数像素网格与手工调色；骨骼旋转会产生非整数采样、网格蒙皮会产生拉伸/锯齿。Godot 文档直接说明：多边形蒙皮即使加了内部顶点，弯曲时仍可能出人意料地变形（[2D skeletons](https://docs.godotengine.org/en/stable/tutorials/animation/2d_skeletons.html)）。本项目的素材准入也建立在"整图 256×384、整图等比缩放、禁止运行时改 scale、脚底 ±2px"这些约束上（[character-art-standard.md](../character-art-standard.md)）；骨骼管线会与这些硬约束正面冲突，需要逐帧重绘修正。

### 3.3 行业做法：像素风并不普遍用运行期 IK

- **逐帧像素**：Shovel Knight 的像素角色是手绘像素帧流程，idle 通常只有 2 帧；文中没有骨骼/绑定环节（[Yacht Club：Creating a Shovel Knight Character Sprite](https://old.yachtclubgames.com/2020/03/creating-a-shovel-knight-character-sprite/)）。
- **3D → 像素**：Dead Cells 用 3D 管线制作再渲染成像素风，而不是在 2D 位图上做骨骼 IK（[Game Developer：A 3D pipeline for 2D animation in Dead Cells](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-)）。
- **程序化生物**：Rain World 在 GDC 2016 Animation Bootcamp 讲解其动画流程，被广泛视为 2D 程序化动画案例；但这是"生物运动系统"设计，讲稿细节本调研未逐条核对，不作为办公室角色的直接证据（[Game Anim：The Rain World Animation Process](https://www.gameanim.com/2017/07/24/rain-world-animation-process/)）。
- **高清矢量/骨骼 2D**（Spine/Unity/UE 体系）才是 IK 的主场：这些项目的美术本来就是可绑定的分件素材，像素风项目反而要额外对抗像素感损失。

### 3.4 本仓库已经跑通过一次"拆臂 + 两连杆 IK"，然后选择不用

`packages/assets-office/src/frame/workAnimation.ts` 里的 `solveWorkArm` 就是标准的 two-link 解析解（余弦定理求肘、固定骨长、外侧弯），服务于 `work.computer-back` 这个**显式制作预览**动作；办公室默认 `working` 播放完整图片帧，不依赖运行时工作面（[character-packs.md](../character-packs.md)）。相关文档也明确："No runtime arm rig, skeleton, furniture movement or per-pose scaling"（[office-lead-quiet-work-v2/README.md](../../art/characters/office-lead-quiet-work-v2/README.md)）；旧的"杯子 + 长手臂覆盖"效果已被删除，改为整帧端杯（[idle-coffee.md](../idle-coffee.md)）。同时，测试已经在用作者接触点校验指尖与键盘/鼠标的对齐（[computerWork.test.mjs](../../tests/computerWork.test.mjs)）。

**这不是"做不到"，而是"能跑但视觉/维护成本不划算"**：算法免费，贵的是切图、权重、逐帧修像素和整套验收。

## 4. IK-lite 替代方案与成本

| 方案 | 在 Pixi + FrameAdapter 里怎么做 | 可行性 | 估算工作量 | 与烘焙感冲突 | 建议 |
| --- | --- | --- | --- | --- | --- |
| 根部/整体位移 warp（motion warping lite） | 在 presenter/SceneView 层只改 actor root 的位移/朝向，把接触点对齐到目标；限位移与时间窗，逻辑坐标仍为整数格 | 高（纯 Container transform，不动帧） | 1–3 人日 | 低（需像素取整） | **先做（S1）** |
| 动作重定时 / 接触 cue | 复用已有 `distance` clock（travelledDu/strideDu）；把接触时刻做成 `VisualCue`（接口已预留、帧播放器目前返回空数组） | 高 | 0.5–2 人日 | 无 | **推荐，补契约** |
| 分层头/眼 look-at | 美术把"头/眼"切层或提供 3–5 个朝向帧；运行时选帧 + 极小位移，不做连续旋转 | 中（依赖美术切层） | 美术 1–2 人日/角色 + 代码 2–3 | 中（需重绘像素脸） | 可选，骨骼阶段前不做 |
| 手部/道具覆盖层 | 用已有 socket/Anchor 把杯子/文件 sprite 挂到手部区域；coffee-v1 的 `speech-attachments.json` 已有"绑定 PNG SHA-256"的先例 | 低–中 | 1–3 人日 + 美术 | 高（描边/阴影/像素对齐易穿帮） | **不推荐回退**（项目已删过类似覆盖层） |
| 呼吸/晃动程序化叠加 | 对整帧做 ±1–2px 的 y 偏移或极轻微缩放；必须可关闭 | 高 | 0.5–1 人日 | 低，但与"静止身体像素不变"的准入检查冲突，需开关+例外规则 | 可选 polish |
| 接触断言（不做求解） | 给每个动作/家具声明 contactProfile，在测试/构建期断言指尖/足底与目标容差；沿用 `computerWork.test.mjs` 模式 | 高 | 0.5 人日 | 无 | **推荐**（contacts 契约的正确用法） |

补充两点：

- **2:1 轴测下 warp 要在格空间算再投影**，否则 x/y 方向容差会随投影比例变化；办公室目前是平面正视/侧视装配，这条主要是给轴测示例的注意事项（[examples/dimetric](../../examples/dimetric/README.md)）。
- **挂点系统已经存在**（`root.ground`、`ui.label`、`getSocket`），但挂点跟随手部需要"每帧手部位置标注"；对一次性动作，整帧烘焙（如端杯）通常比"整帧身体 + 动态手臂/杯子覆盖"更省维护，项目已用实际选择验证过这一点（[idle-coffee.md](../idle-coffee.md)）。

## 5. 成本与风险

### 5.1 美术与动画师

骨骼化 6 个角色 × 现有动作集（正/背站姿、四向步态、坐起、坐姿转头、工作帧、说话、端杯……）意味着：切图、绑骨、刷权重、蒙皮修正、逐帧重绘像素、重新做动作模板与视觉验收。按现有单人素材的制作量粗估 **3–6 人周**（必须由 spike 校准），且要重跑准入流程（[character-admission.md](../character-admission.md)）。这是一次"美术管线重建"，不是"加一个包"。

### 5.2 引擎与许可

- Spine 是商业授权：运行时许可要求"每个最终产品的用户自行获得 Spine Editor 授权"，且 Essential 版不含 IK（[Runtimes License](https://esotericsoftware.com/spine-runtimes-license)、[IK constraints](https://esotericsoftware.com/spine-ik-constraints)）。
- **Pixi 8 生态的现状**：任务里提到的 `@pixi/spine` 在 npm registry 上不存在（404）；Pixi 8 的官方 Spine 运行时是 Esoteric 维护的 `@esotericsoftware/spine-pixi-v8`（peerDependency `pixi.js ^8.16.0`，npm 上 4.3.x 为最新、另有 4.2 维护线，license 标记 `LicenseRef-LICENSE` 即商业许可）。仓库目前只安装 `pixi.js@8.22.0`，没有任何 Spine 包，接入是新增依赖而不是升级依赖。该运行时要求 package 的 major.minor 与导出 Editor 对齐，Canvas 渲染还有功能限制（[spine-pixi](https://esotericsoftware.com/spine-pixi)）。本项目 Pixi 8.22 满足版本下限，但引入发行/版本同步义务。
- 包体与加载：骨数据 + atlas 与现有图集并存，需要新的 lease/引用计数实现（现有帧适配器的资源生命周期不能复用，只能对照）。

### 5.3 验收

- 接触容差：现有标准是脚底/头中心 ±2px、坐姿脚底标注化（[character-art-standard.md](../character-art-standard.md)）；若引入 IK，需要把容差换算成 `toleranceDu` 并在测试中断言。
- 视觉回归：当前验收是"真实资源清单 + 采样对照 + 人工并排"，**不是**逐像素全屏 diff；骨骼/混合方案需要新增视觉 diff 与混合验收（[migration-and-acceptance.md](../architecture/migration-and-acceptance.md)）。
- "一个真实骨骼人物与帧人物混合运行"目前明确未验证（[README.md](../../README.md) 与迁移文档）；先做混合会同时打开三个未知数。

### 5.4 确定性与回放

业务与存档是整数格 + 命令历史（[integer-grid-and-interactions.md](../integer-grid-and-interactions.md)），IK 若只停留在表现层，不影响逻辑确定性。但要注意：
- 迭代求解器必须固定 iterations/tolerance，不能随帧率变化；Spine 官方把"3 骨以上 IK 非确定"直接列为不支持理由（[IK constraints](https://esotericsoftware.com/spine-ik-constraints)），所以 IK 结果**不能**回写交互判定或存档。
- 本项目已有本地存档、命令回放与确定性测试，任何"表现影响逻辑"的捷径都应该在评审阶段被拒绝。

### 5.5 性能（Web 端）

角色数量是个位数到十位数、场景小，**单个角色的骨骼+IK 计算不是主要风险**；真正的风险是：包体/解码、Canvas 渲染限制、纹理内存与两种适配器并存时的资源管理，以及混合场景的验收成本。Unity 的 Always Update/权重混合、Spine 的 softness 等都说明引擎侧已有优化手段，但不是本项目当前的瓶颈。

### 5.6 跨场景复用

office / classroom / farm 共用 `FrameAdapter` 与语义动作（[scene-isolation.md](../architecture/scene-isolation.md)）。骨骼+IK 需要每个场景的角色素材都骨骼化，否则会退化成"同屏两种人物风格"；轴测示例还涉及另一套投影/外观。跨场景复用不会因为"接口一样"自动成立。

### 5.7 品牌风险

对外承诺 IK 而素材/验收跟不上，用户看到的是"手穿桌、脚打滑、抽搐"。当前 README 与架构文档明确写"骨骼引擎尚未实现""不支持自动 IK"（[README.md](../../README.md)、[extension-contracts.md](../architecture/extension-contracts.md)），这是正确的风险姿态，应保持；也不要用"contacts 已预留"暗示已具备 IK。

## 6. 对 PawOffice 的判断与 spike 方案

### 6.1 判断

| 选项 | 判断 | 条件/说明 |
| --- | --- | --- |
| 现在做运行时 IK | **不做** | 帧位图不可解；骨骼资产不存在；美术/验收成本远超收益 |
| 等骨骼适配器再做 | **真 IK 归入 `animation-skeleton` 阶段** | 且只在骨骼美术资产真的开始制作、客户确有"任意家具/任意朝向/自由道具交接"需求时 |
| 现在做 IK-lite | **做 1 个 spike（S1）** | 纯表现层，不承诺产品能力，不改业务/存档/契约语义 |

理由：
1. IK 的增量收益集中在"目标位置不确定"的场景，而办公室是固定家具、固定站位、平坦网格；现有"整帧 + 接触点验收 + 朝向帧"已覆盖。
2. 做 IK = 做骨骼 = 重写美术管线与验收；项目准入流程刚稳定，这一刀切下去影响所有角色和所有场景。
3. 仓库已有"两连杆 IK 能跑但弃用"的先例，说明瓶颈在艺术一致性与吞吐，不在算法。
4. 骨骼适配器尚不存在，现在同时赌"引擎 + 美术 + 混合验收"三件事，违背项目"先验证一个真实人物、不因接口可编译就宣称完成"的分期策略（[migration-and-acceptance.md](../architecture/migration-and-acceptance.md)）。

### 6.2 `AnimationAdapter.contacts` 契约怎么保留

1. **schema 不动**：`EntityPresentation.contacts` 仍是 `{ socketId, position, toleranceDu }[]`，上限 32（[contracts/animation.ts](../../packages/contracts/src/animation.ts)）。
2. **`FrameAdapter` 继续对非空 contacts 明确报错**，不要静默忽略或降级；该错误本身就是"帧资产不支持重定向"的契约声明（[FrameAdapter.ts:99](../../packages/animation-frame/src/FrameAdapter.ts)）。
3. **语义定位**：`contactProfileId` = 预烘焙对齐档；`contacts` = 验收目标/可选 warp 目标，而不是"请适配器求解"的请求。
4. **后续增量（非本轮）**：在适配器能力清单里增加 `contactRetargeting: 'none' | 'warp' | 'ik'` 与 `maxToleranceDu`；新增纯函数 `validateContacts(state)` 由适配器实现（帧返回 unsupported，骨骼返回误差），宿主只调用、不实现通用求解。这样 `contacts` 从"占位字段"变成可验收契约。
5. **文档补一句**：在 [extension-contracts.md](../architecture/extension-contracts.md) "挂点与接触"处写明"宿主不做通用 IK 求解；warp 是可选表现策略；IK 能力由骨骼适配器声明并与家具接触规格一起验收"。

### 6.3 Spike S1：IK-lite 对齐（推荐，1–3 天）

- **目标**：验证"根部/整体位移 warp + 动作重定时 + 接触 cue"能否消除办公室三类高频视觉瑕疵：入座瞬间脚/椅错位、端咖啡时手/杯相对错位、交谈转头生硬。
- **范围**：只在 `renderer-pixi`/SceneView 的 presenter 层加一个可选 `WarpPresenter`（不碰 `FrameAdapter`、不改 `AnimationAdapter` 接口、不改整数格与存档）。输入用现有 contact profile / 家具锚点（`contactSurface`、`workstationSurface`）。
- **做法**：接触目标与当前采样点求差 → 对 actor root 做 ≤ 1/4 格位移 + ≤ 小角度朝向插值（120–200ms 窗口、像素取整、可关闭、reduce-motion 下禁用）；配合 `VisualCue` 标记接触时刻做重定时。
- **不做**：骨骼、Spine、逐帧图变形、任何把位移写回逻辑坐标的行为。
- **验收指标**：接触点误差 P95 ≤ 2px（沿用现有脚底 ±2px 标准）；最大位移 ≤ 0.25 格；相邻帧位移 ≤ 1px（抖动测试）；开关关闭时与基线逐像素一致；`npm test` 全绿。
- **失败判据**：需要 > 1/4 格才能对齐、或像素取整造成可见抖动 → 放弃 warp，回到美术侧改动作/站位/家具锚点。
- **产出**：三组对比 GIF/录屏 + 回归测试 + 是否推广到 classroom/farm 的结论。

### 6.4 可选 Spike S2：骨骼可行性（3–5 天，仅在触发条件下做）

用 Spine 试用版 + `spine-pixi-v8` + Pixi 8.22 做 1 个真实角色 × 2 个动作（站姿端杯接触、坐姿回头），与帧方案 A/B：接触误差（目标 ≤ 2px）、像素感人工评审、10 角色 60fps 预算、包体增量/加载时间、制作工时。**只有 S2 的视觉与成本都不差于帧方案，才值得讨论骨骼化。**

### 6.5 触发条件

客户明确提出"任意家具高度/任意朝向/自由道具交接"，或骨骼美术资产真的进入制作，或某个新动作在整帧方案下无法表达（例如家具高度变化大导致需要多套帧），才启动 S2；否则 S1 结束就冻结 contacts 语义，把"IK"继续明确标注为未实现。

## 7. 参考文献

1. [Spine User Guide — IK constraints](https://esotericsoftware.com/spine-ik-constraints)（FK/IK 区别、1/2 骨限制、Essential 不含 IK、3+ 骨非确定性）
2. [Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license)（每个用户需自行获得 Spine Editor 授权）
3. [spine-pixi Runtime Documentation](https://esotericsoftware.com/spine-pixi)（spine-pixi-v8、Pixi ≥ 8.16、版本对齐、Canvas 限制）
4. [Unity — Animation Rigging 1.3 manual](https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.3/manual/index.html)（IK/Aim 约束与 World Interaction rigs）
5. [Unity — Multi-Aim Constraint](https://docs.unity3d.com/Packages/com.unity.animation.rigging@1.3/manual/constraints/MultiAimConstraint.html)（look-at/注视）
6. [Unity — 2D Inverse Kinematics (IK), 2D Animation 13.0](https://docs.unity3d.com/Packages/com.unity.2d.animation@13.0/manual/2DIK.html)（Limb/CCD/FABRIK、骨骼与 Sprite Skin 要求）
7. [Unreal Engine — Motion Warping](https://dev.epicgames.com/documentation/en-us/unreal-engine/motion-warping-in-unreal-engine)（root motion 对齐目标、Skew/Scale Warp、warp 窗口）
8. [Unreal Engine — Control Rig](https://dev.epicgames.com/documentation/en-us/unreal-engine/control-rig-in-unreal-engine)（IK/Aim、Full-Body IK、程序化）
9. [Unreal Engine — IK Rig](https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-in-unreal-engine)（goals/solvers；脚贴不平地形示例）
10. [Unreal Engine — Control Rig Spline Rigging](https://dev.epicgames.com/documentation/en-us/unreal-engine/control-rig-spline-rigging-in-unreal-engine)（spline IK 类长链）
11. [Godot — SkeletonModification2DTwoBoneIK](https://docs.godotengine.org/en/stable/classes/class_skeletonmodification2dtwoboneik.html)（引擎内 2D 两骨 IK）
12. [Godot — 2D skeletons](https://docs.godotengine.org/en/stable/tutorials/animation/2d_skeletons.html)（切图/多边形/权重/形变）
13. [Aristidou & Lasenby — FABRIK: A fast, iterative solver for the Inverse Kinematics problem (2011)](https://www.semanticscholar.org/paper/ef4396be51f253ed986a1db18d4bffd5e5e4acb3) / [DOI](https://doi.org/10.1016/j.gmod.2011.05.003)
14. [Yacht Club Games — Creating a Shovel Knight Character Sprite](https://old.yachtclubgames.com/2020/03/creating-a-shovel-knight-character-sprite/)（像素逐帧流程）
15. [Game Developer — Art Design Deep Dive: Using a 3D pipeline for 2D animation in Dead Cells](https://www.gamedeveloper.com/production/art-design-deep-dive-using-a-3d-pipeline-for-2d-animation-in-i-dead-cells-i-)（3D→像素管线）
16. [Game Anim — The Rain World Animation Process (GDC 2016)](https://www.gameanim.com/2017/07/24/rain-world-animation-process/)（像素风程序化动画案例）
17. [Cocos Creator API — dragonBones.IKConstraint](https://docs.cocos.com/creator/4.0/api/en/class/dragonBones.IKConstraint)（DragonBones 运行时 IK 约束）
18. [npm registry — @esotericsoftware/spine-pixi-v8](https://registry.npmjs.org/@esotericsoftware%2Fspine-pixi-v8)（4.3.x / 4.2 维护线，peer `pixi.js ^8.16.0`，`LicenseRef-LICENSE`）
19. [npm registry — @pixi/spine](https://registry.npmjs.org/@pixi%2Fspine)（404：Pixi 命名空间下不存在该包，接入须用 Esoteric 运行时）

## 8. 本仓库证据索引

- [FrameAdapter.ts:99](../../packages/animation-frame/src/FrameAdapter.ts) —— 帧适配器对非空 contacts 明确拒绝
- [contracts/animation.ts](../../packages/contracts/src/animation.ts) —— contacts 的 schema 与上限
- [extension-contracts.md](../architecture/extension-contracts.md) —— "骨骼适配器如提供 IK，需自行声明能力、验证容差"；"场景宿主不做通用 IK 求解"
- [workAnimation.ts](../../packages/assets-office/src/frame/workAnimation.ts) —— 已存在的 two-link 解析 IK（仅显式预览用）
- [computerWork.test.mjs](../../tests/computerWork.test.mjs) —— 用作者接触点校验指尖/键盘/鼠标对齐
- [character-packs.md](../character-packs.md) —— 默认工作动画是完整图片帧，`work.computer-back` 只作显式预览
- [idle-coffee.md](../idle-coffee.md) —— 旧的杯子/长手臂覆盖被删除，改为整帧端杯
- [character-art-standard.md](../character-art-standard.md) —— 整图 256×384、整图等比、脚底 ±2px、禁止运行时改 scale
- [migration-and-acceptance.md](../architecture/migration-and-acceptance.md) —— 真实骨骼未实现；帧/骨骼混合未验证；采样对照不是像素 diff
- [integer-grid-and-interactions.md](../integer-grid-and-interactions.md) —— 平坦整数格、座位对齐用"原地播放坐下"而非运行时抬腿

## 9. 待验证 / 不确定项

1. **S1 的 warp 上限**：1/4 格是否足够覆盖入座与端杯错位——必须用真实工会话录制对比，不能只凭文档推断。
2. **像素风下 look-at 的可接受实现**：是"3–5 张朝向帧"还是"切头/眼层微移"，取决于美术产能与像素感评审；本调研不预设答案。
3. **骨骼成本**：3–6 人周的估算需要 S2 校准；Spine 授权费用与客户预算需产品侧确认。
4. **混合运行**：真实骨骼人物与帧人物同屏的视觉/资源/验收影响，目前仓库明确未验证；不在本调研结论内。
