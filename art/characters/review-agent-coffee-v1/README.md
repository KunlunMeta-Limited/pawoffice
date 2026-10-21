# 刘市咖啡动作候选 v1

状态：candidate-unreviewed，未正式发布。

- 原始生成图：source-sheet.png；内置 image_gen 提示词与来源：generation.json。
- 八张 256×384 透明帧：frames/right/001.png 至 008.png。
- 动画：preview.gif；逐帧页：preview.html；对照表：contact-sheet.png。
- 时长与每帧完整配准：animation.json；第一帧倍率定标记录：registration.json。
- 端杯、屈肘举杯、嘴部接触、倾杯、移开、放下；循环复用第 1 帧收尾，第 8 帧保留供比较。
- 原始图网格间距不均；整个序列保持同一等比倍率，按脚底和鞋子站位平移完整人物。各帧源锚点与偏移均有记录，没有局部肢体拉伸或分帧缩放。
- alpha ≥128 的观测：足底 343–343，头顶 65–66；所有帧均未触及画布边缘。
- 仍有生成图轮廓差异；握杯与嘴部接触需人工确认，未宣称准入审计或视觉验收通过。
- 当前只绘制与首个样片相同的右侧动作；正/背视图未制作，未改正式人物包和办公室代码。

复现：在仓库根目录运行 node scripts/characters/prepare-office-coffee-v1.mjs。准入规则见 docs/character-admission.md。
