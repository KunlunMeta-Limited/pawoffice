# 独立复核报告：`docs/research/utility-ai-smart-objects-ik.md`

> 复核人：report-verifier ｜ 复核时间：2026-10-27 ｜ 被审快照：SHA256 `BE092CB3EE6140D39BA71ABCD2585F06C7A4610CDB64E329B04829C183C48BFC`，328 行（mtime 17:38:30；复核开始后该文件又保存过一次，本报告以该快照为准，若再改需重跑本表）
> 只读复核：未修改被审报告与源码，未执行 npm build/test；代码用 read/grep 打开核对，链接用 web_fetch / curl 检查。
> 快照说明：复核开始时曾读到 §5.4 的 "Spy Editor"，当前快照已为 "Spine Editor"，故本次不计为问题。

## 总体结论：**pass**

- **无 P0**；P1 × 2，P2 × 12。三个技术的判断（Smart Objects P0、Utility AI 有条件 P1、现在不做真 IK P3）与仓库事实及文档承诺一致，可交付；建议先修正 2 条 P1。
- file:line 核对：报告共 **34 处独立 file:line 引用**（重复出现另计）与 8 处仅指文件/目录的引用，**全部命中，0 处行号漂移**。问题集中在 2 处"表述超出代码"和若干口径/术语，而非错行。

## 一、问题表（严重度 ｜ 位置与原文摘录 ｜ 核对证据 ｜ 建议）

| 严重度 | 位置（章节 + 原文摘录） | 核对证据 | 建议 |
| --- | --- | --- | --- |
| **P1** | §2.1 tendFarm「过滤占用/不可达/资源被占」 | 实际只过滤三种情况：菜地已被预约（supervisor.ts:10,16）、目标格被其他人物或步伐占据（:19-21）、收获箱 inventory 忙（:12,21）；**没有** walkable/path/可达性检查，"不可达"无代码依据 | 改为"过滤菜地被占、目标格被站、收获箱忙碌"；可达性由提交后的寻路失败兜底，不要归为 supervisor 的过滤 |
| **P1** | §2.1「全仓 activity.start 共 8 类提交通道…地图/表情/家具等零散入口」；§1「8 条命令提交通道 + 2 个手写策略」 | ①地图编辑器只提交 `map.edit`（apps/web/src/components/map-editor/commands.ts:16），全仓无 map-editor 的 activity.start；②§2.1 八项中 OfficeIdleCoffee、tendFarm 已占 2 席，§1 又在 8 条之外"+2 个手写策略"，自相矛盾；③examples 的教室/农场控制器也提交 activity.start（examples/classroom/src/controller/useClassroomController.ts:100、examples/farm/src/controller/useFarmController.ts:75），"全仓"口径不成立 | 删「地图」；§1 改为"8 条提交通道（其中 2 个为手写启发式）"；把"全仓"限定为 apps/web + packages 生产通道，或明确 examples 单独计 |
| P2 | §2.2「`capability.participants/rules` 只用于 describe() 输出，执行时只校验参与者不重复/存在」 | runtime 确实不执行声明式 participants/rules（plugins.ts:26 定义、:119 仅 describe 导出），但各能力 build 自行校验角色与规则：office.visit（pack.ts:40-44）、office.meeting（:70）、furniture.use（:108）、教室（teaching.ts:24-25） | 改为"runtime 不校验声明式规则，只查参与者不重复/存在；角色规则由各能力 build 自行实现" |
| P2 | §2.2「约 4–8 处改动、跨 4 个包（模板数据、能力/编排、家具视图、素材、姿态契约、测试）」 | 同一句列了 6 类改动，与"4 个包"口径不一致；相关包候选至少有 scene-office、assets-office、renderer-pixi、contracts、animation-frame；且未标 [推断] | 统一包数口径，并标注"粗略估算" |
| P2 | §2.3「场景默认播放完整工作帧、不传工作面（FrameSprite.ts:23-25；character-packs.md:104）」 | FrameSprite.ts:23-25 只能说明不向 sampleCharacterLayers 注入 surface；而 packSchema.ts:62 在未传 surface 时回退 `manifest.work.previewSurface`，"不传"≠"不跑 IK"。场景不跑预览 IK 的真实依据是场景从不播放 work.computer-back（character-packs.md:100,106） | 以 character-packs.md 为主证；FrameSprite 引用改为"场景调用不注入 surface"，并补 previewSurface 回退事实 |
| P2 | §3.2「多槽位语义（会议桌 4 个 anchor vs 单 meeting 资源）」 | office.conference-table 模板 anchors:{}、resources:{}（referenceOffice.ts:29）；4 个 attendee anchor 属于白板（objects.ts:16、referenceOffice.ts:28），meeting 资源容量为 1 | 改为"会议白板 4 个 anchor" |
| P2 | §0、§3.2「数据地基已存在约 60–70%」 | 主观成熟度判断，无仓库依据、无 [推断] 标记；文首只声明"工作量均为粗略估算"，不覆盖该数字 | 标注"主观估计（[推断]）"或给出可核对的拆分口径 |
| P2 | §3.6「map schema 是 strict（MapDraft parse），新字段必须 optional」；§7「Smart Objects 扩字段波及 strict map/checkpoint v2」 | mapDocumentSchema 确为 strict（packages/protocol/src/map.ts:10），但 Template/interaction 定义来自场景包代码，不写入 map 文档或 checkpoint；真正会卡旧存档的是插件版本精确匹配（SceneRuntime.restore 校验 pluginVersions 全等；plugin-runtime.md:245） | 补"插件版本精确匹配"这一实际约束，并说明只有 Prop/World 字段才进 map/checkpoint |
| P2 | §5.2「像素风与骨骼变形天然冲突…（Godot 2D skeletons）」 | 链接 HTTP 200 且主题为 2D skeletons/skinning，但页面正文没有"像素风冲突/非整数采样/蒙皮锯齿"论述；该论点应视为 [推断] | 改标 [推断]，或改引像素美术管线资料 |
| P2 | §6「阶段 1…合计约 4–6 工程师周」 | 分项 §3.5 Smart Objects M1 2–3 周 + §4.6 Utility AI M1 3–5 周 = 串行 5–8 周（并行 3–5 周）；"4–6"未说明并行/串行口径，与分项对不上 | 注明"按并行口径"，或改为 5–8 周（串行） |
| P2 | §5.1「手部接触…整帧烘焙 + 作者接触点验收（tests/computerWork.test.mjs）」 | 该测试校验的是显式预览 work.computer-back 的 IK 采样、作者工作面接触点与家具 landmark（computerWork.test.mjs:26-59,61-87），不是"整帧烘焙"的验收；作者接触点可用于验收见 character-art-standard.md:54 | 改为"整帧烘焙播放 + 作者接触点/家具接触面验收（现有测试覆盖预览 IK 与家具 landmark）" |
| P2 | 文首「工作树另有 3 个与本调研无关的既有修改」 | 复核时 `git status --short` 显示 7 个已跟踪文件被修改（ResultPreview.css/.tsx、mock/README.md、mock/result-preview.json、results/format.ts、protocol/office-ui.ts、tests/resultReader.test.mjs），另有若干未跟踪文件；"与调研无关"成立，但数量不符 | 改为"若干"或注明统计时间点与口径 |
| P2 | §2.1「每个空閒农夫」 | 繁体字"閒"，全文其余为简体中文 | 改"空闲" |
| P2 | §0「现有 2 个手写打分器」 | OfficeIdleCoffee 与 tendFarm 是筛选/加权排序启发式（无归一化分数、无 response curve），"打分器"过强；§1 称"手写策略"、§4.2 称"行为数 2"，三处指同一对象但称谓不一 | 统一为"2 个手写启发式（无显式打分）" |

## 二、已核对无误的关键结论抽样

1. **写入口与钩子**：`SceneRuntime.submit` 确在 :144；`beforeCommand` :111-114；监听器异常仅 `console.warn` :158-161；只读查询 `snapshot/readActors/templates/describe` 在 :120-141；`describe()` :141 —— 全部与报告一致。
2. **OfficeIdleCoffee**：:118 每 250ms 轮询、:61 冷却 5–15s、:159-160 久未休息优先、:168 近期搭档降权、:88-103 经 beforeCommand 抢占并加冷却、:109-186 tick —— 属实（冷却/偏好均为内存 Map，不进存档）。
3. **tendFarm**：:6-29 枚举 farm.plot、作物状态→plant/water/harvest、plant 优先再按距离排序（:17-22）、提交 farm.*（:25）—— 属实（"不可达"除外，见 P1-1）。
4. **model.ts**：`FurnitureInteraction` :10-13、Actor 无 needs/mood/goal/intent :20-29、Template :31-39 —— 属实。
5. **plugins.ts**：:19 交互资源容量必须为 1；:26 `participants/rules` 仅为声明，:119 仅在 describe 导出 —— "执行时未按声明执行"属实（但各 build 自行校验角色，见 P2-1）。
6. **furniture.use**：pack.ts:104-118 为通用能力，仅校验 interaction 存在与 requiresHome（:110-112）；plugin-runtime.md:65 是其文档行 —— 属实。
7. **contacts 是预留而非已有能力**：animation.ts:22 定义 `contacts { socketId, position, toleranceDu }`、:39 定义 `contactProfiles`；FrameAdapter.ts:99 对非空 contacts 抛错；:45 socket 白名单仅 root.ground/ui.label —— 报告"接口预留但未实现"表述准确，未把预留写成已有。
8. **IK 原型**：workAnimation.ts:14-20 为标准两连杆解析解、:67-81 为整段可达预检；packSchema.ts:61-63 仅在 work.computer-back 采样；character-packs.md:100/104/106 明确"场景播放完整工作帧、work.computer-back 仅显式预览" —— 结论成立。
9. **教室/农场缺 interaction**：classroom objects.ts:21-25 黑板无 interactions；farm world.ts:12-13 菜地无 interactions；教学能力只 move 到 teacher anchor（teaching.ts:50）—— 属实。
10. **姿态校验**：UNSUPPORTED_POSE 在 actionContract.ts:19-21 抛出 —— 属实。
11. **"现在不做真 IK"与仓库文档一致**：architecture/README.md:151「不支持…自动 IK 或任意家具接触适配」、extension-contracts.md:113「宿主不做通用 IK 求解」、migration-and-acceptance.md:16「真实骨骼人物 未实现」—— 结论与文档承诺一致，非自创；骨骼适配器/多槽位也均被写成未来项或缺失项，未误报为已有能力。
12. **优先级与承诺一致性**：§0 表 P0/P1/P3 与 §3/§4/§5 标题、§6 决策树一致；"不新增协议字段、决策状态不写存档"与 protocol 2.0 / checkpoint v2 的文档描述一致；"接口预留≠已有能力"在 §7 风险中单列，正文也守住了。
13. **引用文件存在性**：seatInteraction.ts、movement.ts、bindings.ts、contactSurface.ts、docs/integer-grid-and-interactions.md、tests/computerWork.test.mjs、art/characters/packs/*/character.json（6 个）—— 均存在。
14. **外部资料支撑**：UE Smart Objects（原文 "Smart Objects do not contain execution logic"）、Spine IK（Essential 无 IK、3 骨以上不支持）、Spine License（每用户需自购 Editor 授权）、spine-pixi（v8 最低 Pixi 8.16、major.minor 对齐）、IAUS（Dave Mark / GDC 2013 / GW2: HoT）、ONI（优先级桶 + Enable Proximity 就近）—— 页面可达且内容支持相应表述。

## 三、外部链接抽查（≥6，均核对了可访问性与主题匹配）

| 链接 | 结果 | 与报告表述的匹配 |
| --- | --- | --- |
| UE Smart Objects Overview | HTTP 200 | 原文含 "Smart Objects do not contain execution logic"、Slots、reservation system → 支持 §3.1 |
| Spine IK constraints | HTTP 200 | "IK constraints are not available in Spine Essential."、"Constraining three or more bones is not supported" → 支持 §5.4 |
| Spine Runtimes License | HTTP 200 | "each user of the Products must obtain their own Spine Editor license" → 支持 §5.4 |
| spine-pixi | HTTP 200 | 表格给出 spine-pixi-v8 最低 Pixi 8.16、major.minor 需对齐 → 支持 §5.4；仓库 pixi.js ^8.18.1 满足 |
| Unity 2D IK | HTTP 200 | 2D Animation 13.0 的 2D IK 文档存在 → 链接有效 |
| Godot 2D skeletons | HTTP 200 | 页面为 2D 骨骼/蒙皮，但不含"像素风冲突/非整数采样/锯齿"论述 → 部分匹配（P2-7） |
| Yacht Club Shovel Knight | HTTP 200 | 像素 sprite 与帧动画制作流程 → 支持 §5.2 |
| IAUS（gameai.com） | HTTP 200 | Dave Mark、GDC 2013 Architecture Tricks、ArenaNet / GuildWars 2: HoT → 支持 §4.1 |
| ONI Priority wiki | HTTP 200 | 优先级面板 + Enable Proximity 同优先级就近 tie-break → 支持 §4.1 |
| RimWorld wiki | HTTP 200 | 页面存在，但正文被 GitHub 导航截断，未逐段核对 → 部分核实 |
| Game AI Pro PDF × 8 | HTTP 200（curl 请求头） | 链接可达；PDF 正文未能读取（见下） |

## 四、未能核实的项（工具限制，不是链接失效证据）

- Game AI Pro 8 个 PDF：`web_fetch` 不支持 application/pdf；仅用 curl 确认 HTTP 200，未核对正文与报告章节表述的逐字对应。
- Zubek Needs-Based AI PDF、FABRIK DOI、UE Quick Start / Motion Warping / Control Rig、Unity Animation Rigging、Dead Cells、Rain World、mykaadev：本机 shell 直连 HTTPS 因沙箱无 TLS 凭证（schannel SEC_E_NO_CREDENTIALS）失败，且未逐一用 web_fetch 抽查，属"未核实"而非 404。
- GDC Vault Architecture Tricks：HTTP 302 跳转，正文未读取；IAUS 页面引用同一 URL，可作为链接有效的间接佐证。
- RimWorld wiki 正文（见上）。

## 五、交付判断

**pass**：证据链总体可靠、无 P0；建议先修 2 条 P1（tendFarm"不可达"、8 类通道含"地图"/计数矛盾），P2 可在下一版顺手处理。
