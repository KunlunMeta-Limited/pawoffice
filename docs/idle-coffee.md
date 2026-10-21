# 空闲咖啡闲聊

正式办公室的团队会话会为空闲同事开启咖啡休息。人物没有未完成业务任务、活动占用、移动或表情时，随机等待 5–15 秒后与其他空闲同事组成 2–3 人的小组。在可通行的站位轮流显示 `...`、端杯、喝咖啡，结束后回到各自工位。空间不足时缩小分组；没有同伴时独自喝咖啡。

工具栏的咖啡按钮可以关闭或开启此行为。任务状态更新和手动活动优先，闲聊会释放自己的身体、语音和站位资源。取消时先完成正在进行的格移动或坐起，再通过原有寻路回座。布局编辑会等待休息人物安全回座。演示期间暂停自动闲聊。

实现位于 `packages/scene-office/src/core/OfficeIdleCoffee.ts` 和 `idleCoffee.ts`。它们只提交场景活动，不更新业务任务、进度或底部聊天记录。咖啡动作现在通过现有 FrameAdapter 播放完整人物帧；已删除原来的杯子和长手臂覆盖效果。`coffeePresentation.ts` 仅在空闲、站立、静止且对应活动已就绪时选择新动作。领取任务、移动、入座、编辑时立即恢复原动作。

六个角色均使用独立右侧动作与左侧镜像。前/背朝向的闲聊人物会在表现层转向同伴，世界朝向和寻路不变；没有凭空添加正/背视图。端杯使用第一帧，喝一口由活动进度驱动举杯、接触、倾杯、放下全过程。`...` 保留为气泡，不叠加旧的说话身体帧。减少动态效果偏好下保持端杯姿势。

`npm run assets:build` 会在原人物准入检查后运行 `scripts/build-office-coffee-frames.mjs`。它保留原始 registry、人物源包和历史白名单，为真实办公室生成独立的 coffee-registry、组合 manifest 和六张无损 WebP 图集。只有真实 OfficeScene 选择这些组合资源；独立场景默认继续使用原包。新资源也进入发布/导出清单，不依赖开发用的 art 路径。

本次素材选择绑定 `art/characters/coffee-v1/integration-selection.json` 中的动画配置、参考立绘和逐帧 SHA-256；修改选中素材会导致构建拒绝。构建另检查画布、透明边界、统一倍率、足底、动作阶段和轮廓连续性。这是用户明确要求接入后新增的独立咖啡动作扩展规则，不将旧人物包改成 approved，也不伪造完整人物的视觉验收记录。

独立 `OfficeSimulation` 和 `OfficeScene` 保持原有默认行为。嵌入方可以使用 `new OfficeSimulation(runtime, undefined, { idleCoffee: { canIdle } })` 或 `new OfficeScene({ idleCoffee: true })` 主动开启。`canIdle` 必须同时考虑排队任务；只看人物当前的 `idle` 展示状态不足以确定是否空闲。

运行时增加了可选的 `beforeCommand` 订阅，用于在外部命令入队前释放本地闲聊占用。未订阅时沿用原有执行流程；观察者收到命令副本，观察者异常不会阻止原命令。关闭运行时会清理订阅。

回归测试：`node --test tests/idleCoffee.test.mjs`。浏览器测试页面：`tests/fixtures/idle-coffee.html`，需要以仓库根目录启动 Vite 并预先生成资源。
