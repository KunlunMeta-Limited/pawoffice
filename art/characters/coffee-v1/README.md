# 全角色咖啡动作候选 v1

更新：六个角色的侧面帧已接入 feature_idle_coffee_chat 的真实办公室页面；integration-selection.json 绑定本次用户选择，正式页面图集由 scripts/build-office-coffee-frames.mjs 生成。预览与回归已通过，待用户在真实页面继续验收；未合并 main。

本轮补齐王明、李研、周理、陈书、刘市五个角色，各八张完整人物透明帧；加上前轮赵审，共六位角色 48 张帧。与前轮样片相同，当前均为右侧动作。

## 交付文件

- `preview.html`：六位角色的循环总览，点击进入各自的逐帧预览。
- `preview.gif`：六位角色同步循环。顺序为王明、李研、周理 / 陈书、刘市、赵审。
- `sip-overview.png`：六位角色倾杯帧对照，同上顺序。
- `prompts.json`：本轮五位角色的完整提示词集、生成方式和结果标识。
- `../<角色ID>-coffee-v1/frames/right/001.png` 至 `008.png`：256×384 RGBA PNG。
- 每个角色目录内的 `source-sheet.png` 是内置 image_gen 生成原图，`generation.json` 保存完整提示词与生成标识。
- 每个角色的 `registration.json` 记录真实统一配准参数，`animation.json` 记录时长和阶段，`observations.json` 记录实际边界，不伪造准入结果。

角色对应：office-lead=王明，code-agent=李研，file-agent=周理，app-agent=陈书，review-agent=刘市，data-agent=赵审。

## 制作与限制

使用各自原始右侧立绘保留形象，以内置 image_gen 分别绘制八帧。刘市候选的卷袖另行编辑为原立绘的长袖。原始网格间距不均，按四列两行裁切后，每个动作序列保持同一等比倍率，再按脚底和鞋子站位平移完整人物。每帧的源锚点和真实偏移保存在 animation.json；未拉长局部肢体，也没有分帧缩放。

复现五位新角色素材：

导入时仅将重采样产生的孤立 alpha=1 噪点归零，保留 alpha≥2 的人物边缘；原始生成图不改动。这个处理记录在每帧配准元数据中。

```sh
node scripts/characters/prepare-office-coffee-v1.mjs
```

该脚本只写候选制作目录；不写 `art/characters/packs/`、正式注册表或办公室代码。它检查源图尺寸、alpha 和裁切边界，不代替美术验收或 `characters:audit`。当前均为 `candidate-unreviewed`，未生成正式 `review.json`，未发布正式图集。仍有少量头发、衣服轮廓与足底差异，握持与杯沿接触需逐帧确认。

按照 `docs/character-admission.md`，通过隔离预览和视觉验收后才能正式发布。本轮未合并 main、未推送远程。
