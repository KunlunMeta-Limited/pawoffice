# PawOffice 完整交付包 · 阅读器演示

在仓库根目录启动开发服务。下列地址使用端口 5197，换用其他端口时，演示素材会随页面来源地址加载。

```powershell
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5197 --strictPort
```

| 样例 | 开发预览 |
| --- | --- |
| 综合成果 | [complete](http://127.0.0.1:5197/dev/result-board.html?fixture=complete) |
| 综合成果完整记录 | [complete&view=all](http://127.0.0.1:5197/dev/result-board.html?fixture=complete&view=all) |
| 说明型成果 | [complete-fact](http://127.0.0.1:5197/dev/result-board.html?fixture=complete-fact) |
| 双栏 | [complete-columns](http://127.0.0.1:5197/dev/result-board.html?fixture=complete-columns) |
| 网格 | [complete-grid](http://127.0.0.1:5197/dev/result-board.html?fixture=complete-grid) |
| 卡片 | [complete-cards](http://127.0.0.1:5197/dev/result-board.html?fixture=complete-cards) |

综合演示首屏按灰度交付结论、发布阻断项和交付物组织。页面标注“模拟业务数据”，文档、图像、数据及证据仍使用项目阅读组件。验收明细和技术材料可按需展开，右上角“完整记录”打开全量数据视图。该阅读编排针对这一份演示样例。

综合成果覆盖 6 种指标、4 种交付物、8 种 Section 和 12 种 Custom Block。综合成果自带 `stack` 布局，另三种布局可分别打开查看。

## 来源与校验

内外层 ZIP 完整性检查通过。两层主 JSON 内容一致，内层 manifest 列出的文件字节数和 SHA-256 均已核对。五份接入数据均通过项目 `packages/protocol/src/office-ui.ts` 中的 `officeResultSchema` 校验。

原包的综合成果有两处 Schema 错误。文档目录 `delivery-docs` 和图廊 `ui-gallery` 的 `purpose: artifact-preview` 需要节级别的 `artifactId` 与 `versionId`。这两节覆盖多份文件，因此接入副本移除了这两处 `purpose`，由阅读器按普通章节展示。目录项自身的文件与版本引用保留，其他业务字段沿用原值。

预览入口将样例中的 `http://localhost:5173/demo-assets/` 指向同源的 `/dev/pawoffice-complete-assets/`。六份静态素材保留包内原件。Vite 会为浏览器打开的 HTML 简报注入开发客户端。ZIP 只提供结果状态，页面将任务执行状态显示为“任务状态未提供”。

## 浏览器验收

- 六种指标都能展示。目标型 `auto` 显示目标 3 项、当前 2 项、进度 67% 及“有风险”。通过率 95.0% 和用例执行进度 97% 各自标注。
- 文档目录可打开匹配版本。Markdown、图片、CSV 和本地 HTML 简报均已打开核验，图片下载字节与包内 SHA-256 一致。
- 八种 Section 可见，包含代码逐行差异。Custom Block 中的流程图成功绘制，说明型与其余三种布局可独立查看。
- 原 v2.2 检查归入待补充验证。发布、验证和环境状态各按样例字段呈现。主样例的版本记录可读，包中仅有当前版本文档原文。
- 390px 视口中文件说明换行，操作可见。横竖预览图均保持原比例。
