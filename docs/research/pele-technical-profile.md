# Pele（obsidianmd/pele）技术调研档案

> **调研对象**：`pele@1.12.0`（MIT），仓库 `https://github.com/obsidianmd/pele`，官网 `https://pele.run`。
> **数据来源**：仓库只读副本（`%TEMP%\dsh-qQQS4s\pele-research`，HEAD = tag `1.12.0`，shallow clone）、npm 发布包 `pele-1.12.0.tgz`（registry 下载）、GitHub REST API、npm registry API、Obsidian 官方 changelog、本机 Node 22.22.2 实测。
> **调研时间**：2026-10-27。凡未实测者均显式标注「未验证」。

---

## 关键结论

**一句话**：Pele 是 Obsidian 团队用 TypeScript 重写的 Mermaid 12.1.0 渲染器——自研 parser/layout/renderer、零运行时依赖、同步纯函数、CSS 变量主题；它**语法兼容 Mermaid、视觉与布局不兼容**，体积约为 Mermaid 的 1/5.8（gzip），已是 Obsidian 1.15.0 的生产渲染器。

| 关键问题 | 结论（证据见正文） |
| --- | --- |
| npm 包名 | **`pele` 就是本项目**（registry 元数据 repository 指向 obsidianmd/pele，latest = 1.12.0）。注意 npm 上 `pele@1.0.0`（2020 年）是**无关旧包**，本项目从 `1.0.1`（2026-10-06）开始接管该名字。 |
| 图类型覆盖 | **33 种**，覆盖 Mermaid 12.1.0 全部内置类型（含 swimlane/agentflow/treeView/cynefin/wardley/eventmodeling/usecase/venn/ishikawa/railroad 等 beta 类型）；不支持 ZenUML/外部插件。用发布包实测 Mermaid 官方文档示例 **522/522 全部渲染成功**。 |
| 体积 | 全量 ESM `dist/pele.js` = **709.0 KiB min / 268.5 KiB gzip / 216.9 KiB brotli**；global 版 713.2/269.3/217.2 KiB。按需 `pele/core` 仅 **14.6 KiB gzip**，core+flowchart = 63.0 KiB gzip。官网宣称 230 kB gzip（**与实测不符，偏乐观**）。 |
| 与 Mermaid 对比 | Mermaid 12.1.0 `dist/mermaid.min.js` = 5,364.4 KiB min / **1,546.3 KiB gzip** / 1,149.1 KiB brotli，23 个直接依赖；Pele 为 0 运行时依赖，gzip 约为其 **1/5.8**。 |
| 公共 API | `render` / `parse` / `mount` / `register` / `registered` / `detectType` / `supports` / `enableZoom` / `forgetTextWidths` + `PeleError`；`pele/core`、`pele/lazy`（`renderAsync`/`mountAsync`/`load`）、`pele/diagrams/*`、`pele/global`；全量 `.d.ts`（290 个文件）。同步渲染，无 DOM 依赖，可在 Node/Worker 中跑 `render()`。 |
| 许可 | MIT（`Copyright (c) 2026 kepano`）+ **附加 Lucide ISC 通知**（zoom 控件 reset 图标，该图标实际打进 `dist/pele.js`）。若 PawOffice 打包 `pele`，**THIRD_PARTY_NOTICES 必须同时包含 Pele MIT 全文与 Lucide ISC 全文**；Mermaid 代码/语法文件仅存在于 `tests/`，不进发布包，**无需**附带 Mermaid 通知。 |
| 成熟度 | 项目 2026-10-05 创建，21 天发布 21 个版本（1.0.1→1.12.0），409 commits，3,659 stars，4 个 open issue，无 CHANGELOG、无安全公告；已是 **Obsidian 1.15.0 生产渲染器**（桌面早期访问，2026-10-22 起 Mermaid 被移除）。 |
| 中文（CJK） | 内置 CJK 宽字符测量（全角按 1em）与 CJK 换行（可断在任意汉字之间、含禁则处理），并有 `tests/render/cjk-wrap.test.ts`；但**必须自备字体**（`--pele-font` / `fontFamily`），字体与测量字体不一致会导致文本溢出/留白；Node/SSR 无 canvas 时退化为 Arial 宽度表，**拉丁字符宽度对中文字体不准**。 |

**给 PawOffice 的三条决策建议**

1. **默认打包方式**：若只需要常见 6 种图，用 `pele/core` + `pele/diagrams/*` 精确注册（约 63–112 KiB gzip）；图类型不可预知则用 `pele/lazy`（初始 15.3 KiB gzip，按需 chunk）；全量 268.5 KiB gzip 也完全可接受（Mermaid 的 1/5.8）。
2. **主题**：颜色全部走 CSS 变量，切换暖色/暗色**不需要重渲染**；但换字体（主题切换改 `--pele-font`）必须 `refresh()` 或重新 `render()`。
3. **必须处理的风险**：① 项目极年轻、单维护者主导、日更节奏 → **锁死 `1.12.0` 精确版本**；② 许可通知（MIT + Lucide ISC）；③ 不追求与 Mermaid 像素级一致（布局引擎不同，输出必然重排）。

---

## 1. 是什么 / 覆盖范围

### 1.1 定位

- README（`README.md`）首段：*"Pele renders Mermaid diagrams to SVG. It is small, synchronous, has no runtime dependencies, and uses CSS variables for colors and fonts."*
- `AGENTS.md`：*"Pele renders Mermaid text to SVG for Obsidian, themed with CSS custom properties."*；并规定**四条硬约束**：**无运行时依赖**、**严格 TypeScript + ESM**、**渲染必须同步且不访问 DOM**、**相同输入 + 相同 measurer 必须产生相同 SVG**。
- 版本与元数据（`package.json`）：`"name": "pele"`, `"version": "1.12.0"`, `"license": "MIT"`, `"author": "kepano"`, `"type": "module"`, `"engines": { "node": ">=20" }`, 无 `dependencies` 字段。
- 官网首页（`website/src/content/pages/index.md`）：*"Zero dependencies, 6× smaller, and up to 500× faster than Mermaid.js. Pele supports every diagram type built into Mermaid 12.1.0."*

### 1.2 图类型清单（33 种，已验证）

`src/diagrams/registry.ts` 的 `all` 数组长度 = 33（`tests/entries.test.ts` 断言 `expect(all.length).toBe(33)`）；`src/entries/` 有 33 个入口文件；`src/detect.ts` 有 37 条 detector 规则映射到这 33 个 type（flowchart 两条：`flowchart-elk` 与 `flowchart-v2`；railroad 四条：base/ebnf/abnf/peg）。

| # | `type` | 触发关键字（`src/detect.ts`） | `mermaidType` | 首次加载增量（KiB min / gzip）¹ |
| --- | --- | --- | --- | --- |
| 1 | `flowchart` | `graph` / `flowchart` / `flowchart-elk` | `flowchart-v2` / `flowchart-elk` | 122.4 / 48.7 |
| 2 | `sequence` | `sequenceDiagram` | `sequence` | 98.5 / 40.7 |
| 3 | `class` | `classDiagram` | `classDiagram` | 117.6 / 47.4 |
| 4 | `state` | `stateDiagram`, `stateDiagram-v2` | `stateDiagram` | 111.0 / 44.7 |
| 5 | `er` | `erDiagram` | `er` | 95.9 / 40.8 |
| 6 | `pie` | `pie` | `pie` | 23.1 / 10.4 |
| 7 | `gantt` | `gantt` | `gantt` | 45.9 / 18.5 |
| 8 | `gitGraph` | `gitGraph` | `gitGraph` | 31.7 / 13.4 |
| 9 | `mindmap` | `mindmap` | `mindmap` | 36.4 / 13.9 |
| 10 | `timeline` | `timeline` | `timeline` | 63.7 / 28.0 |
| 11 | `journey` | `journey` | `journey` | 24.1 / 10.6 |
| 12 | `quadrantChart` | `quadrantChart` | `quadrantChart` | 25.6 / 11.4 |
| 13 | `xychart` | `xychart`, `xychart-beta` | `xychart` | 28.8 / 12.6 |
| 14 | `requirement` | `requirementDiagram` | `requirement` | 85.3 / 36.7 |
| 15 | `c4` | `C4Context`/`C4Container`/`C4Component`/`C4Dynamic`/`C4Deployment` | `c4` | 98.2 / 40.0 |
| 16 | `sankey` | `sankey`, `sankey-beta` | `sankey` | 26.1 / 11.7 |
| 17 | `block` | `block`, `block-beta` | `block` | 94.5 / 38.5 |
| 18 | `packet` | `packet`, `packet-beta` | `packet` | 25.4 / 11.1 |
| 19 | `kanban` | `kanban` | `kanban` | 27.1 / 11.8 |
| 20 | `architecture` | `architecture`, `architecture-beta` | `architecture` | 79.2 / 34.2 |
| 21 | `radar` | `radar-beta` | `radar` | 25.3 / 11.1 |
| 22 | `treemap` | `treemap`, `treemap-beta` | `treemap` | 30.8 / 13.7 |
| 23 | `info` | `info` | `info` | 18.3 / 8.3 |
| 24 | `agentflow` | `agentflow-beta` | `agentflow` | 129.3 / 51.7 |
| 25 | `usecase` | `usecase-beta` | `usecase` | 113.6 / 46.3 |
| 26 | `railroad` | `railroad-beta`, `railroad-ebnf-beta`, `railroad-abnf-beta`, `railroad-peg-beta` | `railroad` / `railroadEbnf` / `railroadAbnf` / `railroadPeg` | 38.0 / 15.2 |
| 27 | `treeView` | `treeView-beta` | `treeView` | 31.3 / 13.2 |
| 28 | `venn` | `venn-beta` | `venn` | 31.6 / 13.9 |
| 29 | `cynefin` | `cynefin-beta` | `cynefin` | 66.8 / 29.4 |
| 30 | `wardley` | `wardley-beta` | `wardley` | 77.6 / 33.0 |
| 31 | `swimlane` | `swimlane-beta` | `swimlane` | 134.7 / 54.0 |
| 32 | `ishikawa` | `ishikawa`, `ishikawa-beta` | `ishikawa` | 64.0 / 28.1 |
| 33 | `eventmodeling` | `eventmodeling` | `eventmodeling` | 75.9 / 32.5 |

¹ 方法：对每个 `dist/esm/diagrams/<type>.js` 求静态 import 闭包，减去 `dist/esm/core.js` 闭包（与仓库 `scripts/build.mjs --sizes` 同一算法）。**注意**：多图共享 chunk（如 `layout/layered.ts` 同时被 flowchart/class/state/usecase 使用），因此该表是「只加载这一种图时的增量」，多图相加会重复计算；实测组合见 §3.3。

**覆盖性验证**：
- 用 `mermaid@12.1.0/dist/mermaid.min.js` 字符串检索，上表 34 种关键字形式**全部存在**于 Mermaid 12.1.0（唯一例外 `zenuml` 是外部插件，Pele 明确不支持，见 `website/src/content/docs/compatibility.md`）。
- 用发布包对仓库内 `tests/corpus/*-docs.json`（由 Mermaid 官方 syntax 文档示例生成，见 §1.3）逐条渲染：**522/522 成功（100%）**，覆盖 33 种图；其中 flowchart 114 条、class 38、sequence 38、git 35、block 30、er 25、usecase 24、state 22……
- 仓库自带 **296 个测试文件**、**34 个 `tests/compat/<type>/` 套件**（33 种图 + 1 个 `usecase-parser`）。

### 1.3 与 Mermaid 12.1.0 的兼容边界

**验证方式（仓库自述 + 可核对文件）**：
- `README.md`：*"Its parsers are tested against Mermaid's parser specs and with differential fuzzing."*
- `CONTRIBUTING.md`：*"We test these against Mermaid's parser specs and with differential fuzzing… Find parser specs in `tests/compat/<type>/` and reasons for skipped cases in each directory's `SKIPPED.md`."*
- `scripts/sync-specs.mjs`：从指定 Mermaid checkout（pinned tag `mermaid@12.1.0`）复制 parser specs 到 `tests/compat/`，改写 import 指向 Pele adapter，并在文件头写入：
  ```
  // Ported from Mermaid mermaid@12.1.0 (21f72f07ea), packages/mermaid/src/diagrams/sequence/sequenceDiagram.spec.js
  // Copyright (c) 2014 - 2022 Knut Sveidqvist, MIT License. Generated by scripts/sync-specs.mjs; do not edit.
  ```
- 同一脚本把 Mermaid 文档示例抽成 `tests/corpus/<type>-docs.json`（官网 playground 的示例来源）。
- 每个套件的 `SKIPPED.md` 记录「跳过哪些用例、为什么、哪些 spec 文件不移植」。跳过原因高度集中于三类：**测试 Jison/DOMPurify/dagre/cytoscape 等 Mermaid 内部实现细节**、**断言渲染器像素坐标（Pele 自研布局，不做 layout parity）**、**断言 Mermaid 主题 CSS**。例如 `tests/compat/sequence/SKIPPED.md` 大量条目写 *"Checks pixel positions kept by Mermaid's renderer (`renderer.bounds`). Pele has its own layout and no layout parity."*

**有意的差异（摘自 `website/src/content/docs/compatibility.md`，逐条可核对）**：

| 维度 | Mermaid 12.1.0 | Pele 1.12.0 |
| --- | --- | --- |
| 布局 | dagre/ELK/cytoscape 等，节点位置固定 | **完全自研布局**（`src/layout/layered.ts` 91 KB 等），节点位置/间距/边路径必然不同 |
| 主题 | `theme`/`themeVariables`/生成 stylesheet | **CSS 自定义属性**；Mermaid 主题变量**不生效** |
| 标签 | 可配置 HTML 标签（DOMPurify 清洗） | 仅 SVG `<text>`，支持换行/粗体/斜体；**不支持任意 HTML label** |
| 交互 | `click` 可绑定 JS 回调 | 仅支持链接；**JS 回调被忽略**（`security.md`: *"JavaScript callbacks in `click` statements are ignored."*） |
| URL 策略 | 除 `javascript:`/`data:`/`vbscript:` 外基本放行 | **更严格**：默认仅 `http/https/mailto/tel`（图片 `http/https`），`//host/share` 网络路径也拒绝 |
| 尺寸适配 | `useMaxWidth` 缩放 | `responsive`（默认 true）+ `maxWidth` 触发**布局重排**；`autoDirection` 在 <640px 时把横向图转纵向（Mermaid 无此能力） |
| 限额 | `maxTextSize` 50,000；无输出大小限制 | 源码 50,000、输出 4,000,000 字符、edge 5,000（Mermaid 500） |
| Sankey | ASCII 节点名 | **扩展支持 Unicode**（重音、非拉丁、emoji，引号/非引号 CSV 字段）；数值非数字开头（如 `abc`）时 Pele 报语法错而 Mermaid 画空流；gradient 需要 `idPrefix` |
| 数学 | 内置 KaTeX 渲染 `$$...$$` | **宿主提供 `math` resolver**（KaTeX/Temml/MathJax），未提供则显示 TeX 源码 |
| 图标 | Iconify 图标包 | **宿主提供 `icons` resolver**；architecture/treeView 有少量内置 glyph |
| 流程图 ELK | 真正的 ELK 布局 | `flowchart-elk` 关键字可识别（`mermaidType: 'flowchart-elk'`）但**仍用 Pele 布局** |
| 插件 | ZenUML 等 | 不支持 |

**源码佐证**：`src/detect.ts` 注释 *"Mermaid's detectors, in the order Mermaid registers them. The first match wins."*；`src/util/url.ts` 注释 *"Stricter than Mermaid, which lets any scheme but three through: a diagram in a shared note could otherwise open a local file, a network share, or another application."*；`src/svg/theme.ts` 注释 *"Splits Mermaid style declarations into what applies to a shape and what applies to its text."*

**结论**：**语法/解析层**以 Mermaid 12.1.0 为准（并有 ported specs + fuzz 背书），**渲染/视觉层**是独立实现，不存在像素级兼容；依赖 Mermaid 主题或 HTML label 的存量内容会发生视觉变化。

---

## 2. 公共 API

### 2.1 入口（`package.json` `exports`，已核对发布包）

| Specifier | 实现文件 | 内容 | 初始体积（实测） |
| --- | --- | --- | --- |
| `pele` | `dist/pele.js` | 全部 API + **注册全部 33 种图**（副作用） | 709.0 KiB min / 268.5 KiB gzip |
| `pele/core` | `dist/esm/core.js` | API，无图类型；用 `register()` 添加 | 34.5 KiB min / 14.6 KiB gzip |
| `pele/lazy` | `dist/esm/lazy.js` | API + 动态 import 表；`renderAsync`/`mountAsync`/`load` | 37.1 KiB min / 15.3 KiB gzip |
| `pele/diagrams/*` | `dist/esm/diagrams/*.js` | 单个图类型，default export | 23–135 KiB（见 §1.2） |
| `pele/global` | `dist/pele.global.js` | IIFE，全局变量 `pele` | 713.2 KiB min / 269.3 KiB gzip |
| `pele/package.json` | — | 元数据 | — |

所有入口均为 **ESM-only**（`"type": "module"`，无 CJS 条件导出）；`types` 条件齐全（`dist/index.d.ts`、`dist/core.d.ts`、`dist/lazy.d.ts`、`dist/entries/*.d.ts`）。

### 2.2 精确签名（来自 `dist/*.d.ts`，与 `src/*.ts` 一致）

`src/index.ts`（4 行，体现「主入口即全量注册」）：

```ts
import { register } from './core.js';
import { all } from './diagrams/registry.js';

register(...all);

export * from './core.js';
export type * from './models.js';
```

`src/core.ts` 的核心导出：

```ts
export declare function register(...list: Diagram<any>[]): void;
export declare function registered(type: DiagramType): boolean;
export declare function detectType(text: string): DiagramType | null;
export declare function supports(text: string): boolean;
export declare function parse(text: string, options?: ParseOptions): ParsedDiagramModel;
export declare function render(source: string | DiagramModel, options?: RenderOptions): RenderResult;
export declare function mount(element: HTMLElement, text: string, options?: MountOptions): Mounted;
export declare function enableZoom(element: HTMLElement, options?: ZoomOptions): Zoom;
export declare function forgetTextWidths(): void;
```

`pele/lazy`：

```ts
export declare function load(type: DiagramType | null): Promise<boolean>;
export declare function renderAsync(text: string, options?: RenderOptions): Promise<RenderResult>;
export declare function mountAsync(element: HTMLElement, text: string, options?: MountOptions): Promise<Mounted>;
```

运行时导出键（在 Node 中 `import('dist/pele.js')` 实测）：
`PeleError, detectType, enableZoom, forgetTextWidths, mount, parse, register, registered, render, supports`（global 版同样 10 个，挂在 `window.pele`）。

关键语义：
- `register()` 写入模块级 `Map<DiagramType, Diagram>`；`pele` 主入口的 `register(...all)` 是**模块副作用**，因此 `package.json` 声明 `"sideEffects": ["./dist/pele.js", "./src/index.ts"]`——用主入口无法靠 tree-shaking 去掉未用图类型。
- `supports(text)` 只判断「类型是否已注册」，**不校验语法**（`website/src/content/docs/api.md`）。
- `detectType()` 不需要注册即可工作（`core.ts` 直接跑 detector）。
- `parse()` 返回的 model 可多次 `render()`（不同宽度），避免重复解析；model 通过 `WeakMap` 关联解析结果。

### 2.3 `RenderOptions`（`src/types.ts`，全部可选）

| 选项 | 类型 | 默认值 | 说明/来源 |
| --- | --- | --- | --- |
| `measurer` | `TextMeasurer` | 浏览器 canvas，否则内置 Arial 宽度表 | 见 §6.6 |
| `fontFamily` | `string` | `sans-serif` | 测量与绘制字体；文档默认「Measured font」 |
| `fontFamilyMono` | `string` | `monospace` | 等宽字体 |
| `monospace` | `('members'\|'attributes'\|'files'\|'messages')[]` | — | 哪些部分按等宽测量/绘制 |
| `fontSize` | `number` | `16` | 基础字号（px） |
| `idPrefix` | `string` | `render()` 用 `'pele'`；`mount()` 自动生成 | 前缀 SVG 内 id（`<title>`/`<desc>`/sankey gradient） |
| `responsive` | `boolean` | `true`（若 config 中该图 `useMaxWidth:false` 则为 false） | 根 SVG 加 `max-width:100%;height:auto` |
| `maxWidth` | `number` | — | 可用宽度（px），触发换行/降级/改向 |
| `autoDirection` | `boolean` | `true` | <640px 允许横向图转纵向 |
| `directionBreakpoint` | `number` | `640` | 上述阈值 |
| `padding` | `number` | 图类型自带 | 图形四周留白 |
| `limit` | `number` | `50000` | 源码字符上限（= Mermaid `maxTextSize`） |
| `outputLimit` | `number` | `4_000_000` | SVG 字符上限（Mermaid 无） |
| `maxEdges` | `number` | `5000` | flowchart/agentflow 边数上限（Mermaid 500） |
| `linkSchemes` | `string[]` | `['http','https','mailto','tel']` | 链接额外允许的 scheme |
| `imageSchemes` | `string[]` | `['http','https']` | 图片允许的 scheme |
| `links` | `boolean` | `true` | 关闭后所有链接被丢弃（不是写成 `about:blank`） |
| `images` | `boolean` | `true` | 关闭后 `<image>` 不输出 |
| `linkRel` | `string` | `'noopener'` | `rel` 属性；空串则省略 |
| `icons` | `(name: string) => string \| null \| undefined` | — | 返回**受信任** SVG 片段（原样插入） |
| `math` | `(tex: string, size: number) => MathMarkup \| null \| undefined` | — | `$$...$$` 排版器，返回 `{svg,width,height}` 或 `{html,width,height}` |
| `config` | `Config`（YAML 对象） | — | Mermaid 配置默认值；frontmatter/`%%{init}%%` 覆盖它；**支持程度按图类型不同** |
| `now` | `number \| Date` | 当前时间 | Gantt 的「今天」标记 |

`MountOptions extends RenderOptions` 追加：`onRender(result)`、`zoom: boolean|'auto'|ZoomOptions`（默认 `'auto'`）、`sanitize(svg): Node`、`onError(error)`。

### 2.4 返回值与 SVG 输出形态

`RenderResult` = `{ svg, width, height, links, type, mermaidType }`；`LinkInfo = { id, href, internal }`。

根节点（`src/svg/root.ts`，实测输出开头）：

```html
<svg xmlns="http://www.w3.org/2000/svg" class="pele pele-flowchart"
     viewBox="0 0 263 64" width="263" height="64"
     style="max-width:100%;height:auto;--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#1f1f1f);…"
     fill="var(--_fg)" role="graphics-document document"
     aria-roledescription="flowchart">
```

- 根 class：`pele` + `pele-<type>`（如 `pele-flowchart`）；`accTitle`/`accDescr` 生成 `<title id="<prefix>-title">`/`<desc id="<prefix>-desc">` 并接 `aria-labelledby`/`aria-describedby`（实测 `id="p7-title"`）。
- 图形由 `<path>/<rect>/<polygon>/<text>/<tspan>/<a>/<svg class="pele-icon">` 等组成；**常见图中无 `<defs>`、无 `<marker>`、无 `<style>` 元素**（箭头以路径绘制）；sankey 在给定 `idPrefix` 时才有 `<linearGradient id="z9-sankey-…">`（实测）。
- 样式主要通过**内联 `style` 属性 + presentation attributes**（`fill`/`stroke`/`style="rx:var(--_r)"` 等）表达；文本的 `letter-spacing`/`word-spacing`/`text-transform`/`direction` 被显式钉死，避免页面 CSS 影响测量结果（`src/svg/theme.ts` `fontStyle()`）。
- 文本全部经 `esc()` 转义；**不存在 `<script>`、事件属性、`<style>`、`<foreignObject>`**（唯一例外：`math` resolver 返回 `html` 时会用 `<foreignObject>` 包裹，此时依赖宿主 sanitizer 策略，官方文档明确 DOMPurify 会删掉它）。
- 无源码 map 文件（发布包 0 个 `.map`），minified 堆栈难读；调试期可用 global 版（带 banner）。

### 2.5 错误处理

`PeleError extends Error`，字段：`code: 'unsupported-diagram' | 'syntax' | 'semantic' | 'limit'`、`type`、`mermaidType`、`line`、`column`、`snippet`。

实测（Node）：

```
limit        -> code 'limit'，'Diagram source is longer than the limit of 5 characters.'
outputLimit  -> code 'limit'，'Diagram output is longer than the limit of 10 characters.'
maxEdges     -> code 'limit'，'Edge limit exceeded. The limit is 0.'
unsupported  -> code 'unsupported-diagram'，'No diagram type detected for the given text.'
syntax       -> code 'syntax', line 2, column 8, snippet "  A -->\n-------^"
```

- 语法错误消息自带源码行 + 插入符定位（`src/errors.ts` `syntaxError()`）；`core.ts` 的 `tagErrors()` 会把 `<`、`>` 等实体码还原成用户原文再呈现，因此消息含图源文本 → 官方要求**用 `textContent` 展示**。
- 栈溢出的深层嵌套被 `guarded()` 转成 `PeleError('Diagram is nested too deeply.', 'limit')`。
- `render()`/`parse()` **抛异常**；`mount()`/`update()` **不抛解析错误**，而是把错误显示在容器里（已有图则置灰 + 底部覆盖错误条；无图则替换为错误文本），并回调 `onError`；`update()` 失败时保留上一次可解析的 model 以支持宽度变化重绘（`src/mount.ts`）。
- 错误条颜色 `--pele-error`，类名 `pele pele-error`。

### 2.6 `mount()` / `Mounted` / zoom

`Mounted`（`src/mount.ts`）：

```ts
export interface Mounted {
  readonly result: RenderResult | undefined;
  readonly source: string;
  readonly error: unknown;
  readonly zoom: Zoom | undefined;
  update(text: string, options?: MountOptions): void;
  refresh(): void;   // 宽度/字体变化后重绘
  destroy(): void;   // 停止观察，保留画面
}
```

- `mount()` 会读取 CSS：`--pele-font`、`--pele-font-mono`（`fontsFor()` 取 `getComputedStyle`，先看图中节点再看容器），并**以容器宽度作为 `maxWidth`**；`ResizeObserver` + `requestAnimationFrame` 做宽度自适应，隐藏容器延迟绘制，跨 window 场景按元素所属 window 取样式（`src/window.ts`）。
- 等宽字体加载完成后自动 `forgetTextWidths()` 并重绘（`settled()`/`awaitFonts()`）。
- 每个 mount 自动生成唯一 `idPrefix`：`` `pele-${copy}-${++mounted}` ``（`copy` 为每份库实例的随机串），避免同页 id 冲突。
- 默认 `zoom: 'auto'`：仅当图被缩小显示时启用缩放；`enableZoom(el, opts)` 可给已存在的 SVG 加缩放。缩放按钮有键盘操作、`Alt` 标签可用 `labels` 本地化（默认英文）。
- 容器要求：宽度不依赖内容（block 元素）。

### 2.7 `pele/global`

```html
<script src="https://cdn.jsdelivr.net/npm/pele@1/dist/pele.global.js"></script>
<script>for (const el of document.querySelectorAll('pre.mermaid')) pele.mount(el, el.textContent);</script>
```

- 实测 IIFE 全局键与 ESM 入口一致；文件头 banner：`/*! Pele 1.12.0 | MIT License | https://github.com/obsidianmd/pele */`（`scripts/browser-build.mjs`）。
- **ESM `dist/pele.js` 没有 banner**（build 用 `legalComments: 'none'`，只有 global 版显式加 banner）——这直接影响许可合规，见 §5.4。

### 2.8 主题机制与「是否需要重渲染」

- 根节点一次性定义私有别名，全部指向公开变量并提供 fallback（`src/svg/theme.ts`）：
  ```ts
  export const ROOT_STYLE =
    '--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#1f1f1f);--_m:var(--pele-muted,#6e6e6e);' +
    '--_l:var(--pele-line,#1f1f1f);--_s:var(--pele-surface,#f3f3f3);--_a:var(--pele-surface-alt,#e6e6e6);' +
    '--_b:var(--pele-border,#8a8a8a);--_c:var(--pele-accent,#5b7bd5);color:var(--_fg)';
  ```
- 公开变量（`website/src/content/docs/theming.md`，实测 dist 中出现 21 个 `--pele-*` token，含 8 个 series 与 5 个 zoom 变量）：
  `--pele-bg`(#ffffff)、`--pele-fg`(#1f1f1f)、`--pele-fg-on-light`、`--pele-fg-on-dark`、`--pele-muted`(#6e6e6e)、`--pele-line`(#1f1f1f)、`--pele-surface`(#f3f3f3)、`--pele-surface-alt`(#e6e6e6)、`--pele-border`(#8a8a8a)、`--pele-accent`(#5b7bd5)、`--pele-critical`(#e45756)、`--pele-error`(#e45756)、`--pele-font`、`--pele-font-mono`、`--pele-title-weight`、`--pele-heading-weight`、`--pele-bold-weight`、`--pele-radius`(#4px)、`--pele-series-1..8`、`--pele-zoom-{top,right,bottom,left,cursor}`。
- **颜色切换不需要重渲染**：所有颜色在 SVG 中以 `var(--pele-*, fallback)` 引用；README 原文 *"Colors adapt to theme changes without being re-rendered."*；theming.md *"Switch between light and dark colors without re-rendering the diagram."* 实测一次 flowchart 输出含 **21 处 `var(--…)`、0 个硬编码 `fill="#hex"`**。
- **字体切换需要重渲染**：文本宽度决定节点尺寸，必须重新测量。`mount()` 场景改 CSS 字体后调用 `refresh()`；`render()` 场景重新 `render()` 并传新的 `fontFamily`。
- 图内 `style`/`classDef`/sequence `rect|box` 设置的颜色是**固定值**，不随主题变化；对这些填充上的文字，Pele 在渲染时按亮度在 `--pele-fg-on-light` / `--pele-fg-on-dark` 中二选一（`src/svg/ink.ts`，WCAG 相对亮度，阈值在 #1f1f1f 与 #fff 等对比处），实际颜色仍是变量 → 主题切换依然生效，但**对比色档位选择**在渲染时固定。
- 图内 class 命名空间丰富（`pele-node`、`pele-edge`、`pele-label`、`pele-cluster`、`pele-title`、`pele-icon`、`pele-er-*`、`pele-wardley-*`、`pele-venn-*` 等；dist 中可检索到约 257 个 `pele-*` 片段），主题可用类名做精细覆盖；节点可用 `data-id` 选择。
- 图表系列色通过 `--pele-series-N`（默认 Tableau 10 风格 8 色）。

### 2.9 类型系统

- 发布包携带 **290 个 `.d.ts`（180,822 bytes）**，覆盖全部子路径与内部模型（`dist/models.d.ts` 导出 33 个 Model 类型的联合 `DiagramModel`）。
- `Diagram` 接口（自定义图类型/`register()` 用）：
  ```ts
  export interface Diagram<Model> {
    type: DiagramType;
    section?: string;          // Mermaid config 中的节名（默认 = type）
    keepComments?: boolean;    // 需要报告源码位置时保留 %% 注释行
    math?: boolean;            // 启用 $$...$$ 
    parse(source, config, title, lineOffset, limits): Model;
    render(model, config, options): Rendered;
  }
  ```
- `mount.d.ts` / `zoom.d.ts` 引用 DOM 类型（`HTMLElement`、`Node`、`Zoom`），**纯 Node/SSR 工程若 `lib` 不含 `DOM` 会类型报错**（运行时无碍，因为 `render` 不碰 DOM）。

---

## 3. 包体积与性能

### 3.1 发布包构成（实测 npm tarball）

| 指标 | 值 |
| --- | --- |
| tarball 大小 | 890,253 bytes（约 869 KiB） |
| 解压后 | 2,395,415 bytes（约 2.28 MiB），420 个文件（registry `fileCount: 420`） |
| 包内文件类型 | 127 `.js` + 290 `.ts`(d.ts) + 1 `package.json` + 1 README + 1 LICENSE；**0 个 sourcemap**、0 个测试/语法文件 |
| `dist/` 文件数 | 417（`pele.js`、`pele.global.js`、11 个顶层 d.ts、`esm/{core,lazy}.js`、90 个共享 chunk、33 个图入口、33 个 `entries/*.d.ts`、按图分目录的 d.ts） |
| 运行时依赖 | **0**（`package.json` 只有 `devDependencies`；发布包 `package.json` 无 `dependencies`/`peerDependencies`；dist 内 import 全为相对路径 chunk） |
| 直接依赖对比 | Mermaid 12.1.0 有 **23 个直接依赖**（d3、dagre-d3-es、cytoscape、cytoscape-fcose、cytoscape-cose-bilkent、elkjs、katex、khroma、marked、dompurify、chevrotain、@mermaid-js/parser、@iconify/utils、@upsetjs/venn.js、d3-sankey、dayjs、uuid、roughjs、stylis、ts-dedent、es-toolkit、@braintree/sanitize-url、@types/d3） |

### 3.2 全量体积（Node 22 `zlib` 实测）

| 产物 | minified | gzip (level 6) | brotli (quality 11) |
| --- | --- | --- | --- |
| `dist/pele.js`（ESM，全 33 图） | 726,020 B = **709.0 KiB** | **268.5 KiB** | 216.9 KiB |
| `dist/pele.global.js`（IIFE） | 730,358 B = **713.2 KiB** | **269.3 KiB** | 217.2 KiB |

### 3.3 按需体积（ESM 静态 import 闭包，实测）

| 组合 | minified | gzip | brotli | 文件数 |
| --- | --- | --- | --- | --- |
| `pele/core` | 34.5 KiB | **14.6 KiB** | 12.9 KiB | 5 |
| `pele/lazy`（初始） | 37.1 KiB | **15.3 KiB** | 13.5 KiB | 5 |
| core + pie | 57.6 KiB | 24.3 KiB | 21.5 KiB | 10 |
| core + flowchart | 156.9 KiB | **63.0 KiB** | 54.9 KiB | 18 |
| core + flowchart + sequence | 200.3 KiB | 79.3 KiB | 68.1 KiB | 21 |
| core + flowchart + sequence + class + state + er | 285.2 KiB | 111.5 KiB | 93.5 KiB | 28 |
| core + 全部 33 图（ESM 并列） | 723.5 KiB | 276.5 KiB | 224.7 KiB | 91 |

> 全量 ESM 并列（723.5 KiB）比单文件 `pele.js`（709.0 KiB）略大，属模块边界/共享 chunk 重复所致，量级一致。

**打包建议**：
- 只关心少数图 → `pele/core` + `pele/diagrams/<type>`（`flowchart` 首图 63 KiB gzip，之后每加一图边际成本显著下降，因为 `src/layout/layered.ts`、`src/svg/*` 等共享 chunk 只付一次）。
- 图类型不确定/很多 → `pele/lazy`：初始 15.3 KiB gzip，`renderAsync()` 首次遇到某类型才拉对应 chunk（`src/lazy.ts` 的 `loaders` 表 33 条，均为 `import()`）。
- 不在意 268.5 KiB gzip → 直接 `import { render } from 'pele'` 最简单，但**没有 tree-shaking 空间**（`sideEffects` + `register(...all)`）。

### 3.4 与 Mermaid.js 的对比

| 指标 | Pele 1.12.0（实测） | Mermaid 12.1.0（实测 unpkg `dist/mermaid.min.js`） | 倍数 |
| --- | --- | --- | --- |
| minified | 709.0 KiB | 5,364.4 KiB | 7.6× |
| gzip | 268.5 KiB | 1,546.3 KiB | 5.8× |
| brotli | 216.9 KiB | 1,149.1 KiB | 5.3× |
| 直接依赖 | 0 | 23 | — |
| 官网宣称 | 230 kB gzip | 1.6 MB gzip | 6× |

**官网数字与实测的差异（必须注意）**：`website/src/content/pages/index.md` 与 `index.astro` 均写 *"Bundle size gzip：230 kB vs 1.6 MB"*。本次实测 v1.12.0 为 268.5 KiB gzip（另测 v1.11.0 = 263.1 KiB），均高于 230 kB；具体测量口径（是否 gzip -9、是否旧版本）**无法从仓库确认**，故标注为**未验证/偏乐观**。对决策影响不大：即便 268.5 KiB，仍比 Mermaid 小约 5.8×。

Mermaid 侧旁证：`mermaid@12.1.0` 的 `dist` 解压后 **122,268,705 bytes / 1,329 文件**（registry `unpackedSize`），因此「1.6 MB gzip」对应其 minified 主包是合理的（实测 1.51 MiB）。

### 3.5 性能

**仓库自带基准方法**（未在本机运行，缺少 Chrome 与 `node_modules`）：
- `npm run bench`（`scripts/bench.mjs`）→ Node 中测 Pele 渲染：Mermaid flowchart 文档示例集、50/500 节点 tree、50/500 节点 mesh，输出中位数与 bundle 大小（gzip）。
- `npm run bench:mermaid`（`scripts/bench-mermaid.mjs`）→ 起本地 HTTP server + 无头 Chrome，用 `performance.now()` 对比 Pele 与从 unpkg 拉取的 Mermaid 12.1.0 在同一批图上的渲染时间（需 Node ≥22，`CHROME` 环境变量指定 Chrome）；`--mermaid <version>` 可换版本。
- 官网据此宣称：**Pele 0.05–0.3 ms/图 vs Mermaid 6–82 ms/图（"up to 500× faster"）**——该数字来自项目方浏览器基准，**本次未独立复现**。

**本机 Node 22.22.2 实测（median，预热后）**：

| 场景 | 时间 |
| --- | --- |
| Mermaid flowchart 官方文档示例（114 条，`tests/corpus/flowchart-docs.json`） | **0.127 ms/图** |
| 50 节点 tree flowchart | 1.043 ms |
| 500 节点 tree flowchart | 6.108 ms（SVG 241 KiB，宽 48,387 px） |

说明：Node 与浏览器 V8 一致但无 DOM 布局干扰，且 measurer 为 fallback 表；与官网「0.05–0.3 ms」量级吻合（文档示例是小编图），但**不能作为浏览器端结论**。

**性能边界**：`outputLimit` 4,000,000 字符、`maxEdges` 5,000、`limit` 50,000 字符是硬闸；500 节点图已产生 241 KiB SVG，大图应关注输出体积而非时间。

---

## 4. 安全模型

官方口径（`SECURITY.md` + `website/src/content/docs/security.md`）：*"Pele escapes diagram text, filters links and styles, and limits source and output size."*；*"It does not turn diagram source into scripts, event handlers, or HTML labels. JavaScript callbacks in `click` statements are ignored."*

### 4.1 转义（文本 → XML）

`src/svg/builder.ts`：

```ts
const RE_NEEDS_ESC = /[&<>"\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff\ufffe\uffff]/u;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export function esc(text: string): string {
  return RE_NEEDS_ESC.test(text) ? text.replace(RE_ESC, (c) => ESC[c] ?? '') : text;
}
```
- 同时**丢弃非法 XML 字符**（含孤立代理项、`\uFFFE/\uFFFF`）；`escText()` 用于只需当作文本读取的属性（tooltip、`data-id`、`aria-*`），会先解码 `#35;` 这类 Mermaid 实体码。
- 标签文本走 `src/text/label.ts`：只识别 `b/strong/i/em/code/...` 等**白名单内联标签**并转成 `<tspan>` 样式位；其余 HTML 标签（含 `<script>`、`<img>`）被**丢弃但保留文本**。实测 `A["<script>alert(1)</script>"]` 输出仅文本 `alert(1)`，SVG 中无 `<script`、无 `onerror`。

### 4.2 样式过滤

`src/svg/theme.ts` `resolveStyle()`：
- 仅接受 **shape 允许属性**：`fill, fill-opacity, stroke, stroke-width, stroke-dasharray, stroke-dashoffset, stroke-linecap, stroke-linejoin, stroke-opacity, opacity, rx, ry`；
- **text 允许属性**：`color, font-size, font-family, font-weight, font-style, text-decoration, letter-spacing, word-spacing, opacity`；
- 值先去掉 `!important`，再拒绝：
  ```ts
  const RE_UNSAFE = /url\s*\(|expression\s*\(|javascript:|[<>{};\\]|@import|image-set|\/\*/i;
  ```
  （拒绝 `url()`、`expression()`、`javascript:`、`<>{}\;`、`@import`、`image-set`、注释注入）
- `font-family` 只写回「纯字体名单」形态，避免注入声明（`fonts.test.ts` 用 `x;color:red`、`url(//evil.example/f)` 等验证）。
- 结果整体再次 `esc()` 后写入 `style="…"`，保证「检查的值 = 写出的值」。

### 4.3 链接与图片过滤

`src/util/url.ts`：实现思路与 `@braintree/sanitize-url`（Mermaid 用于 `click` 的检查）一致，但**是自研实现**（该库只在 `devDependencies`，不进 dist）。

- `sanitizeUrl()`：反复解包（控制字符、HTML 实体、`\n\r\t` 转义、最多 32 轮）以揭穿隐藏 scheme；`javascript:`/`data:`/`vbscript:` **恒定拒绝**（`RE_INVALID_PROTOCOL`）。
- `allow()`：拒绝网络路径 `//host/share` 与 `\\host\share`；scheme 必须在白名单内；**同时对原始值和 URL-decode 后的值双重检查**（`website/src/content/docs/security.md`: *"The decoded URL is checked too, for an app that decodes the href before opening it."*）。
- 默认白名单：
  ```ts
  const LINK_SCHEMES = ['http', 'https', 'mailto', 'tel'];
  const IMAGE_SCHEMES = ['http', 'https'];
  ```
  `linkSchemes`/`imageSchemes` 可替换；`links:false`/`images:false` 直接不产出。
- 被拒链接**不会退化成 `about:blank` 写进 `href`**，而是整段 `<a>` 省略（注释：写成 `about:blank` 点击仍会导航）。
- URL 链接默认 `rel="noopener"`（`linkRel` 可覆盖为空串）。
- **内部链接（Obsidian 式笔记链接）**：`internalLink()` 把笔记名清洗后用于 `href`，原始名保留在 `data-href`；实测 `A[Note]:::internal-link` → `<a class="internal-link" href="Note" rel="noopener" data-href="Note">`，`links` 里 `internal: true`。文档明确：*"Handle internal links as note names. Their values are not filtered as URLs."* —— 宿主必须自己套用导航策略。

### 4.4 限额（DoS 面）

`src/core.ts` 常量：

```ts
const DEFAULT_LIMIT = 50000;          // Mermaid's default maxTextSize
const DEFAULT_OUTPUT_LIMIT = 4_000_000; // Mermaid has no limit on its output
const DEFAULT_MAX_EDGES = 5000;       // Mermaid stops at 500
```

- 超限抛 `PeleError(code:'limit')`；深层嵌套的 `RangeError` 也被归类为 `limit`。
- `maxEdges` 只对 flowchart/agentflow 计数（`A & B --> C & D` 会指数级放大边数，注释说明这是加限制的动机）。
- `limit` 在**预处理前**对整个 source 检查（`agentflow-max-text-size` 的 SKIPPED 说明：*"Pele checks its limit on the whole source before preprocessing"*）。
- 输出大小在 `render()` 末尾检查（`rendered.svg.length > outputLimit`）。

### 4.5 宿主责任（`SECURITY.md` 原文要点）

1. 错误消息含图源文本 → **用 `textContent` 展示**；
2. `icons` 返回的 SVG **原样插入、不过滤** → 只从可信图标集返回，且不要把图源里的名字拼进 markup；
3. `math` 返回的 markup **原样插入** → KaTeX 保持 `trust:false`，MathJax 加载 `ui/safe`；
4. 内部链接按笔记名处理，套用宿主导航策略；
5. **不要让图作者直接提供 `options`/`options.config`**；
6. 图片会发网络请求 → `links:false, images:false` 可全关；
7. 需要时间上限 → **放到可被宿主终止的 Web Worker 里渲染**；
8. 使用自家 SVG sanitizer → 传 `mount()` 的 `sanitize(svg): Node`（每次插入前调用）。

### 4.6 测试层面的证明

- `tests/render/inert.test.ts` 定义 `assertInert()`：检查 `<script>`、`<style>`、`<foreignObject>`、`on*` 事件属性、未知属性（`xlink:href`）、未加引号属性、未闭合元素、未转义 `&`、非数字尺寸、`url(#a)` 形式的 `rx`/`fill`、`javascript:`/`data:`/`file:`/`about:blank`/`//host`/`obsidian://` 链接、`target`、`style` 里的 `position:fixed`、`url()` 等，且**会自检**（"If it stopped objecting, they would all pass."）。
- `tests/render/` 下有 **30 个 `<type>-security.test.ts`**（覆盖多数图类型）+ 汇总的 `security.test.ts`，对 40+ 模板 × 恶意 payload 全量跑 `assertInert`；`security.test.ts` 还对语料做变异 fuzz（默认 4,000 条，`FUZZ` 可调）并检查**原型污染**（`__proto__`/`constructor` 等，`preprocess.ts` 的 `UNSAFE_KEYS` 与 `merge()` 跳过这些键）。
- 实测补充：`javascript:` 链接被丢弃（`links: []`）；`style A fill:url(...)` 直接语法错误；`classDef fill:#fef3e2` 正常保留。

### 4.7 CSP 说明（推断，仓库无官方 CSP 文档）

基于输出结构可确定：**无 `<script>`、无 `<style>` 元素、无内联事件处理器**；但大量使用**内联 `style` 属性**与 `style` 中的 CSS 自定义属性。因此：

- 严格 CSP（`style-src 'self'` 且无 `'unsafe-inline'`）会**丢失大部分颜色/圆角样式**（属性本身仍在，但 `style` 被拦）。需要 `style-src 'unsafe-inline'`（或 CSP3 的 `style-src-attr 'unsafe-inline'`）；Pele 不提供 nonce 机制。
- 输出中可能出现 `<a href>` 与 `<image href>`：若允许图片，需要相应 `img-src`；`links:false, images:false` 可让输出完全无外链。
- `math` resolver 返回 `html` 时会引入 `<foreignObject>`：DOMPurify 默认会删除，且 CSP 下 `style` 同样受限。
- 以上为**基于代码/输出的推断**，未经项目方 CSP 文档确认。

---

## 5. 许可与版权

### 5.1 LICENSE 原文结构（`LICENSE`，与发布包内文件内容一致）

1. 标准 **MIT** 文本，`Copyright (c) 2026 kepano`。
2. 分隔线 `---` 后追加一段第三方声明：
   ```
   The reset icon of the zoom controls is "rotate-ccw" from Lucide v1.14.0
   (https://lucide.dev), under the ISC License:

   Copyright (c) 2026 Lucide Icons and Contributors
   … ISC 许可全文 …
   ```
   - 对应代码在 `src/zoom.ts`：
     ```ts
     const ICONS = {
       zoomIn: 'M5 12h14M12 5v14',
       zoomOut: 'M5 12h14',
       // Lucide's rotate-ccw. Its license is in the LICENSE file.
       reset: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
     };
     ```
   - 该路径字符串**实际存在于 `dist/pele.js`**（grep 命中 `M3 12a9 9`），因此 **Lucide 的 ISC 通知是发布物的一部分，必须随分发保留**。
3. 仓库 `LICENSE` 与 npm 包内 `LICENSE` **内容一致**（Windows 检出为 CRLF、tarball 为 LF，故仅字节数差 40）。

### 5.2 第三方归属盘点

| 来源 | 出现在哪里 | 是否进 `dist/` | 义务 |
| --- | --- | --- | --- |
| **Lucide**（`rotate-ccw` 图标） | `src/zoom.ts` ICONS + LICENSE 附加段 | **是**（`dist/pele.js`、`pele.global.js`） | ISC：保留版权声明 + 许可全文 |
| **Mermaid** parser specs / grammars / docs 示例 | `tests/compat/**`（spec 文件头写明 `Copyright (c) 2014 - 2022 Knut Sveidqvist, MIT License`）、`tests/compat/*/upstream/*.jison`（Mermaid 语法文件）、`tests/corpus/*-docs.json`（由 Mermaid 文档示例生成） | **否**（`package.json` `files: ["dist","LICENSE","README.md"]`；发布包中 0 个 `.jison`/测试文件） | 仅在再分发 `tests/` 时需要 MIT 通知；打包 `pele` 不需要 |
| **Pele 自身** | 全部 `src/` | 是 | MIT：保留 `Copyright (c) 2026 kepano` + 许可全文 |
| **website/**（Astro 站点） | `website/`，`private: true`，依赖 `mermaid@^12.1.0`、`temml`、CodeMirror、Astro、`@fontsource-variable/inter` 等 | 否（不发布、不属于 npm 包；`website/package.json` 无 `license` 字段，默认归仓库根 MIT） | 与「打包 pele 库」无关；若复制网站代码需遵守其依赖许可 |
| architecture/treeView 内置图标 glyph | `src/diagrams/architecture/icons.ts`、`treeview/icons.ts` | 是 | 注释称 *"Outlines for the icon names Mermaid's architecture diagrams know without an icon pack, **drawn on a 24 by 24 grid**"*（自绘声明）；**是否为第三方图标集衍生未验证**，法务上建议按「自绘」处理但保留出处说明 |

**「Mermaid 代码是否进 dist」的结论**：`src/` 中检索 `Mermaid` 只见**行为注释**（如 *"Match Mermaid: …"*、*"Mermaid's detectors…"*），未发现 import/复制 Mermaid 源码；parser 均为手写 lexer/parser（如 `src/diagrams/flowchart/lexer.ts` 24.9 KB、`parser.ts` 17.4 KB），YAML 也是自研（`src/util/yaml.ts`，注释说明只覆盖 Mermaid 用到的子集）。结合发布包 `files` 列表，**`dist/` 不含 Mermaid 派生代码或语法文件**。

### 5.3 npm 包名与发布身份（重要）

**结论：npm 上的 `pele` 就是本包。** 证据（`https://registry.npmjs.org/pele` 实测）：

- `"name": "pele"`，`dist-tags.latest = "1.12.0"`，`description`/`homepage`(`https://pele.run`)/`repository`(`git+https://github.com/obsidianmd/pele.git`) 与仓库一致；
- 维护者：`tgrosinger`、`lishid`、`kepano`、`saberzero1`（均为 Obsidian 侧账号）；
- latest 发布时间 **2026-10-26T23:18:05Z**，`fileCount 420`，`unpackedSize 2,395,415`，带 **npm attestations + SLSA provenance**（`dist.attestations.url`），发布流程见 `.github/workflows/release.yml`（`npm publish --provenance`，tag 必须等于 `package.json` 版本）。

**但有一个历史陷阱**：`pele@1.0.0` 发布于 **2020-05-26**，维护者是 `kumavis`（`unpackedSize 4,502,336`、776 files），与本项目无关；本项目从 **`1.0.1`（2026-10-06）** 开始使用该名字。因此：
- `npm install pele` 解析到 1.12.0，正常；
- 若 lockfile/`=1.0.0` 命中旧包，会装到完全不同的代码 → **必须锁 `1.12.0`（或至少 `>=1.0.1`）并校验 provenance/完整性**。

### 5.4 若 PawOffice 把 `pele` 打进自己的 dist：THIRD_PARTY_NOTICES 必须包含

> 触发条件：`pele` 的 JS 或 d.ts 以任何形式进入 PawOffice 的发布产物（包括 bundler 打包、内联、CDN 自托管）。

**必含 1：Pele（MIT）**

```text
Pele 1.12.0 — https://github.com/obsidianmd/pele
Copyright (c) 2026 kepano
Licensed under the MIT License.
<MIT 全文>
```

**必含 2：Lucide（ISC）** —— 因为 `dist/pele.js` 内含 `rotate-ccw` 图标路径：

```text
Lucide — https://lucide.dev
The reset icon of Pele's zoom controls is "rotate-ccw" from Lucide.
Copyright (c) 2026 Lucide Icons and Contributors
Licensed under the ISC License.
<ISC 全文>
```

**不需要**：Mermaid 的 MIT 通知（发布包不含 Mermaid 代码/语法/测试）；但如果 PawOffice 另行复制 Pele 仓库的 `tests/compat/**` 或 `website/**`，则需补 Mermaid 通知。

**操作建议**：
1. 在 `THIRD_PARTY_NOTICES`（或「关于/开源许可」页）收录上述两段；
2. 同时把 Pele 的完整 `LICENSE` 文件原样保存为 `licenses/pele-LICENSE.txt`（该文件本身已包含 Lucide 段落，一次满足两项）；
3. **不要依赖打包产物自带声明**：ESM `dist/pele.js` 内**没有任何版权行或许可文本**（`legalComments:'none'`；检索 `Copyright`/`Licence` 均无，`MIT` 仅作为 `DELIMITER` 的子串偶然出现），只有 `pele.global.js` 有一行 `/*! Pele 1.12.0 | MIT License | … */` banner；minifier 也可能把它删掉。合规责任在分发方。
4. 若仅以 `dependencies` 形式依赖、不打包（Node 运行时 require 外部包），仍建议在「第三方组件」清单列出，但物理 bundle 内不含 Pele 代码。

### 5.5 GitHub license 元数据的坑

GitHub API `GET /repos/obsidianmd/pele` 返回 `license.spdx_id = "NOASSERTION"`，原因：`LICENSE` 在 MIT 全文后追加了 Lucide ISC 段落，GitHub 无法归类。**自动 license 扫描器（license-checker、FOSSA、GitHub Dependency Graph）可能报 UNKNOWN/NOASSERTION**，需要人工在 SBOM/合规清单里标注为「MIT + ISC（附加段）」。npm 元数据仍是 `"license": "MIT"`。

---

## 6. 成熟度与风险

### 6.1 版本历史与发布节奏

| 维度 | 事实 | 来源 |
| --- | --- | --- |
| 仓库创建 | 2026-10-05T23:32:40Z | GitHub API |
| 首个可用版本 | `1.0.1` 2026-10-06（`1.0.0` 为 2020 无关旧包） | npm registry `time` |
| 最新版本 | `1.12.0` 2026-10-26T23:18:05Z（tag `1.12.0`，本地 `git describe` = `1.12.0`） | npm registry / git |
| 发布数量/节奏 | **21 个版本 / 21 天**（10-06 → 10-26），10-26 当天连发 3 版（1.10.1→1.11.0→1.12.0），基本日更 | npm `time` + GitHub releases（21 个 release，均带 `pele-<v>.tgz` 资产） |
| 提交数 | **409 commits**（GitHub commits API `Link rel=last` page=409 @per_page=1）；本地 shallow clone 仅 50 条 | GitHub API |
| CHANGELOG | **无** `CHANGELOG.md`（根目录只有 README/AGENTS/CONTRIBUTING/SECURITY/LICENSE） | 仓库文件列表 |
| 版本语义 | 1.x；无 LTS/弃用策略文档；小版本仍在改动主题变量（1.12 新增 `--pele-fg-on-light/dark`） | release notes |
| CI | `.github/workflows/ci.yml`：Node 24、`npm ci`、typecheck、全量测试（带缓存）、build、website 测试/构建/Cloudflare 部署 | 仓库 |
| 发布流水线 | `.github/workflows/release.yml`：tag 触发、校验 tag==version、`check-pack.mjs` 验证每个 exports 可解析、`attest` 生成 SLSA 证明、`npm publish --provenance`、建 draft release | 仓库 |

**1.12.0 release notes（GitHub）摘录**：填充色对比文字（`--pele-fg-on-light/dark`）、subgraph/复合状态等自定义填充不再半透明、链接保留 `%20`/`%26` 百分号转义。可见**行为仍在快速变化**。

### 6.2 社区指标（GitHub API，2026-10-27）

| 指标 | 值 |
| --- | --- |
| Stars | **3,659** |
| Forks | 112 |
| Watchers | 6 |
| Open issues | **4**（issues only，search API）/ 6（`open_issues_count` 含 PR） |
| 安全公告 | **0**（`/security-advisories` 返回 `[]`） |
| 贡献者 | 12：`kepano` 372 commits，`lingengyuan` 19，`liby` 3，`dhruv1220` 3，`Spenhouet` 3，其余 7 人各 1–2 |
| 语言/体积 | TypeScript，仓库 2,944 KB |

当前 open issues 内容偏功能增强（xychart 调色板/图例位置、layout 边框端口对齐、playground CSS 定制、文档 light mode），无高危缺陷类。

### 6.3 生产使用：Obsidian 1.15.0

Obsidian 官方 changelog（**2026-10-22 Desktop 1.15.0 Early access**，https://obsidian.md/changelog/2026-10-22-desktop-v1.15.0/ ）原文：

- *"Mermaid diagrams and charts are now rendered using our new library **Pele**, compatible with the latest Mermaid 12.1.0 syntax."*
- *"Diagrams are now shown without asking first, since **Pele can't run code**. The **Show Mermaid diagrams in notes** setting has been removed."*
- 开发者说明：*"Obsidian no longer includes Mermaid: `loadMermaid()` and `window.mermaid` now draw with Pele and support `initialize()`, `render()`, `parse()` and `mermaidAPI.getConfig()`, `setConfig()` and `render()`. Their SVG has Pele's classes, not Mermaid's. New code can use `window.pele` once `loadMermaid()` resolves."*
- 新增 `--mermaid-*` CSS 变量用于颜色、圆角、字重（Obsidian 侧的映射层，不是 Pele 本体）。

**含义**：Pele 已是「数千万级用户桌面应用」的默认渲染路径（早期访问通道），但**仅在桌面早期访问版本**；稳定性背书强于普通 3 周新项目，同时意味着上游会按 Obsidian 需求快速演进。

### 6.4 工程约束（TS / ESM / 浏览器 / Node）

| 项 | 事实 | 证据 |
| --- | --- | --- |
| 语言/构建 | 严格 TS（`strict`、`noUnusedLocals`、`verbatimModuleSyntax`），esbuild 打包，`declaration` + `emitDeclarationOnly` 产出 d.ts | `tsconfig.json`、`scripts/build.mjs` |
| 模块格式 | **ESM-only**（`"type":"module"`，`exports` 只有 `import`/`default`，无 `require`） | `package.json` |
| Node 版本 | `engines.node >= 20`；CI/发布用 Node 24；`bench:mermaid` 需 Node ≥22（依赖全局 `WebSocket`） | `package.json`、`scripts/bench-mermaid.mjs` |
| ESM 产物 target | `es2022` | `scripts/build.mjs` |
| 浏览器最低目标 | global 版 **es2021**，注释：*"es2021 matches the oldest browsers a host supports: Safari 15 is the system WebKit of macOS 12, where Obsidian's Quick Look runs."*；`tests/browsers.test.ts` 会删除 `Array.prototype.at/findLast/toSorted`、`Object.hasOwn/groupBy`、`structuredClone` 后跑全量文档语料，确保不依赖新 built-ins | `scripts/browser-build.mjs`、`tests/browsers.test.ts` |
| 测试规模 | 296 个测试文件（含 `tests/website`）；34 个 compat 套件；30 个 `*-security.test.ts`；`tests/render` 下 70+ 渲染快照/不变量测试 | 文件统计 |
| 类型依赖 | d.ts 引用 DOM 类型（`HTMLElement`/`Node`），无 `@types/*` 运行时依赖 | `dist/mount.d.ts` |

### 6.5 SSR / Web Worker 可运行性（已实测）

`render()`/`parse()` 路径**不访问 DOM**（`src/core.ts` 无 `document/window`；仅 `src/mount.ts`、`src/zoom.ts`、`src/window.ts` 用 DOM）。在 Node 22.22.2 中（`typeof document === 'undefined'`、`typeof window === 'undefined'`、`typeof OffscreenCanvas === 'undefined'`）实测：

- `render()` 正常返回 SVG；`detectType`/`supports`/`parse`/`register` 均可用；
- 相同输入两次 `render()` 的 SVG **逐字节相同**（AGENTS.md 的不变量成立）；
- 默认 measurer 退化为 `metricsMeasurer`（Arial 宽度表），CJK 按 1em 计；
- `mount()`/`enableZoom()` 需要真实 DOM（`ResizeObserver`、`getComputedStyle`、`requestAnimationFrame`、`ownerDocument`）——**在 Web Worker / SSR 中无法使用**，但可在 Worker 中跑 `render()` 并把 SVG 字符串 postMessage 回主线程（这正是官方建议的「可被终止的 Worker 渲染」）。
- 浏览器/Worker 中若存在 `OffscreenCanvas`，`canvasMeasurer()` 会优先使用它（`measurer.ts` `context()`），因此在 Worker 里也能获得真实字体宽度（前提是 Worker 能访问字体信息；`FontFaceSet` 检查在无 `document` 时跳过，即「无法检查的字体宽度也会被缓存」）。

### 6.6 CJK / 字体测量（中文应用重点）

**Pele 内置 CJK 支持，但测量精度取决于宿主字体与测量环境。**

机制（`src/text/measurer.ts`）：

```ts
function isWide(c: number): boolean {
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
         (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
         (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
         (c >= 0xffe0 && c <= 0xffe6) || (c >= 0xd800 && c <= 0xdbff);
}
```
- `canvasMeasurer()`：优先 `OffscreenCanvas` → `document.createElement('canvas')`，用真实字体 `ctx.measureText()`；`FontFaceSet.check()` 失败（字体未加载）时**不缓存**宽度；字体集合 size 变化会清空缓存；`mount()` 在 `document.fonts.ready` 后 `forgetTextWidths()` 并重绘。
- `metricsMeasurer()`：无 canvas 时的 fallback，基于 **Arial ASCII advance 表**（`src/text/metrics.ts`，由 `scripts/gen-metrics.mjs` 生成）+ 规则：CJK/全角 = **1000/1000 em**，零宽字符（组合记号、ZWSP、变体选择符、低代理项）= 0，其他非 ASCII = 580（等宽 600）。
- CJK 换行（`src/text/label.ts`）：
  ```ts
  // Break between any two Chinese or Japanese characters. Hangul is left out: Korean puts spaces between words.
  const CJK = '\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uff60';
  const CLOSE = '、。，．：；！？）］｝」』】〕〉》〙〗ー…‥・ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ,.:;!?)\\]}';
  const OPEN = '（［｛「『【〔〈《〘〖([{';
  ```
  即：可在任意汉字/假名之间断行，并处理**禁则**（行首不出现 `、。，）」` 等、行尾不出现 `（「【` 等）；拉丁词不拆、韩文按空格断；支持零宽空格与软连字符断点。
- 测试：`tests/render/cjk-wrap.test.ts` 用日文长句验证换行保字符、禁则、中英混排、韩文词边界；`tests/render/fonts.test.ts` 验证 `--pele-font` 为 `思源黑体, sans-serif` 时能正确写入 `var(--pele-font,思源黑体, sans-serif)` 且拒绝注入型字体串。

**中文应用必须注意的 5 个坑**：

1. **字体 = 测量字体**：`render()` 用 `fontFamily` 测量；`mount()` 从 CSS 取 `--pele-font`/`--pele-font-mono`。二者必须一致（文档：*"If you also set `--pele-font` in CSS, use the same font so the labels fit their measured size."*）。只改 CSS 不改测量字体 → 文本溢出或节点过大。
2. **主题切字体必须 refresh**：换暗色只改颜色 = 无需重渲染；换字体 = 必须 `refresh()`/重新 render（`theming.md`: *"Call `refresh()` after changing fonts so Pele can measure the labels again."*）。
3. **SSR/Node 端 fallback 表对中文字体的拉丁部分不准**：CJK 按 1em 近似（全角字符通常准确），但同一行里的拉丁字母/数字用的是 Arial 宽度，与思源/苹方等字体有差异；服务端预渲染再客户端 hydration 可能出现尺寸不一致。建议：客户端渲染，或注入**自定义 `TextMeasurer`**（用宿主侧度量结果/字体表），或 SSR 时禁用依赖精确宽度的图。
4. **粗体/斜体 CJK**：fallback 下 CJK 宽度不随 bold 改变（仅换 Arial 表，CJK 仍 1em）；canvas 测量则取真实字体宽度。若对粗体标题宽度敏感，用 canvas/自定义 measurer。
5. **emoji 与组合字符**：高代理项按 1em、低代理项按 0 宽（≈ 1em/emoji）；变体选择符/零宽连接符被忽略；一般够用，但多 emoji 混排可能有 1–2px 偏差。

**推荐配置（中文）**：

```ts
import { render } from 'pele/core';
import flowchart from 'pele/diagrams/flowchart';
import sequence from 'pele/diagrams/sequence';
register(flowchart, sequence);

const font = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const { svg } = render(src, { fontFamily: font, fontSize: 15 });
```
```css
.pele { --pele-font: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; }
```

### 6.7 风险清单

| # | 风险 | 等级 | 依据 | 缓解 |
| --- | --- | --- | --- | --- |
| 1 | **项目极年轻 + 高速迭代**（3 周、21 版、409 commits、日更；1.12 仍在改主题变量） | 高 | §6.1 | 锁定 `1.12.0` 精确版本；升级前跑视觉回归；关注 GitHub release notes |
| 2 | **单维护者主导**（kepano 372/409 commits；其余 11 人合计 37） | 中高 | GitHub contributors | 关注 bus factor；保留回退到 Mermaid 的能力/开关 |
| 3 | **许可通知义务易遗漏**（MIT + 附加 Lucide ISC；dist 内无版权字符串） | 中高 | §5 | THIRD_PARTY_NOTICES + `licenses/pele-LICENSE.txt` 全量收录；CI 检查 |
| 4 | **npm 包名历史异常**（2020 旧 `pele@1.0.0` 属于他人） | 中 | §5.3 | 精确版本 + lockfile + 校验 `repository`/provenance/integrity |
| 5 | **与 Mermaid 视觉不兼容**（自研布局；themeVariables 无效；无 HTML label） | 中 | §1.3 | 接受重排；用 CSS 变量重建品牌色；提前做迁移样例对比 |
| 6 | **默认允许链接/图片**，内部链接 `href` 不做 URL 语义过滤 | 中 | §4.3 | `links:false, images:false` 或严格的 `linkSchemes`；内部链接走宿主导航策略 |
| 7 | **CJK 字体/测量错配**导致溢出或留白 | 中 | §6.6 | 统一字体来源；canvas 环境渲染；主题换字体后 `refresh()` |
| 8 | **体积宣称与实测不符**（官网 230 kB vs 实测 268.5 KiB gzip） | 低 | §3.4 | 以实测为准做预算 |
| 9 | **无 sourcemap**，线上 minified 报错难定位 | 低 | 发布包 0 `.map` | 保留 `pele.global.js`（带 banner、可读性略好）或源码映射自建 |
| 10 | **CSP 需要 `style-src 'unsafe-inline'`**（内联 style 属性） | 低 | §4.7（推断） | 若必须强 CSP，需权衡：样式可能失效，目前无 nonce 方案 |

---

## 7. 工程集成事实

### 7.1 安装与导入

```bash
npm install pele@1.12.0        # 精确锁定；不要用 =1.0.0（无关旧包）
```

```ts
// 全量（最简单，268.5 KiB gzip）
import { render, mount, parse, detectType, supports, PeleError } from 'pele';

// 按需：核心 + 单图
import { register, render } from 'pele/core';
import flowchart from 'pele/diagrams/flowchart';

// 懒加载：首次遇到类型才拉 chunk
import { renderAsync, mountAsync, load } from 'pele/lazy';

// 浏览器全局
// <script src="https://cdn.jsdelivr.net/npm/pele@1/dist/pele.global.js"></script> → window.pele
```

- 无需 `@types`；d.ts 随包。
- 无 CJS：Node ESM 项目直接 import；CJS 项目需动态 `import()` 或让 bundler 处理。
- `pele` 主入口有注册副作用（`sideEffects` 已声明）；`pele/core` + `pele/diagrams/*` 可 tree-shake。
- 同一页面**不要混用不同入口的 API 实例**（`lazy` 内部依赖 core 的注册表；文档提示 *"Keep your API imports on the same entry point."*）。

### 7.2 React 集成

**方案 A（推荐，静态/半静态渲染）**：`render()` + `dangerouslySetInnerHTML`

```tsx
const { svg } = render(source, {
  fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
  idPrefix: useId().replace(/:/g, ''),   // 每图唯一，避免 <title>/<desc>/gradient id 冲突
  links: false,
  images: false,
});
return <div className="pele-host" dangerouslySetInnerHTML={{ __html: svg }} />;
```

- SVG 是自包含字符串（带 `xmlns`），`dangerouslySetInnerHTML` 可行；输出无脚本/事件处理器（安全边界见 §4），但仍建议对不可信来源做服务端 sanitizer。
- **ids 唯一性**：`render()` 默认 `idPrefix='pele'`，同页多图若都用默认值，`<title id="pele-title">`/sankey gradient id 会重复；必须传唯一前缀（`mount()` 自动处理）。
- React 不要在该容器内再渲染子节点（Pele/`mount` 会整体替换 `innerHTML`）。

**方案 B（需要自适应宽度/缩放时）**：`mount()` + `ref`

```tsx
const ref = useRef<HTMLDivElement>(null);
const mounted = useRef<Mounted>();
useEffect(() => {
  if (!ref.current) return;
  mounted.current = mount(ref.current, source, { zoom: 'auto', onError: e => console.warn(e) });
  return () => mounted.current?.destroy();
}, []);
useEffect(() => { mounted.current?.update(source); }, [source]);
```

- 容器必须是宽度不依赖内容的 block 元素；隐藏容器会延迟绘制；`destroy()` 清理 `ResizeObserver`/zoom 监听。
- 主题切换只改 CSS 变量 → 无需任何操作；**若主题同时切换字体，调用 `mounted.current?.refresh()`**。
- 若仅需给 `render()` 生成的 SVG 加缩放：`enableZoom(el, { maxScale: 3 })`。

**SSR / hydration 注意**：`render()` 在 Node 可用（§6.5），但服务端无 canvas → 宽度用 Arial fallback 表，客户端若用 canvas 重新渲染会得到不同尺寸。建议 SSR 时不预渲染 SVG（客户端挂载后渲染），或注入确定性的自定义 `TextMeasurer`。

### 7.3 主题：匹配暖色 / off-white UI（Flexoki 方案，官方示例）

```css
/* 根 SVG 自带 class="pele"，变量可设在任意祖先 */
.pele {
  --pele-bg: #fffcf0;            /* 暖白背景（官方示例值） */
  --pele-fg: #100f0f;            /* 近黑文字 */
  --pele-fg-on-light: #100f0f;   /* 可选覆盖；默认 #1f1f1f */
  --pele-fg-on-dark: #fffcf0;    /* 可选覆盖；默认 #ffffff */
  --pele-muted: #6f6e69;
  --pele-line: #100f0f;
  --pele-surface: #f2f0e5;       /* 节点填充（暖灰） */
  --pele-surface-alt: #e6e4d9;   /* subgraph 填充 */
  --pele-border: #cecdc3;
  --pele-accent: #205ea6;
  --pele-critical: #af3029;
  --pele-radius: 4px;
  --pele-font: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  --pele-font-mono: "JetBrains Mono", "Sarasa Mono SC", monospace;
  --pele-title-weight: 600;      /* 可选：默认 bold */
  --pele-heading-weight: 600;    /* 可选：默认 bold */
  --pele-bold-weight: 600;       /* 可选：默认 bold */
  /* 图表系列色：以下为 Pele 默认值，可按品牌替换 */
  --pele-series-1: #4c78a8;
  --pele-series-2: #f58518;
  --pele-series-3: #54a24b;
  --pele-series-4: #e45756;
  --pele-series-5: #72b7b2;
  --pele-series-6: #eeca3b;
  --pele-series-7: #b279a2;
  --pele-series-8: #9d755d;
}

@media (prefers-color-scheme: dark) {
  .pele {
    --pele-bg: #100f0f; --pele-fg: #cecdc3; --pele-muted: #878580;
    --pele-line: #cecdc3; --pele-surface: #1c1b1a; --pele-surface-alt: #282726;
    --pele-border: #403e3c; --pele-accent: #4385be; --pele-critical: #d14d41;
  }
}
```

（浅色块数值取自 `website/src/content/docs/theming.md` 的 Flexoki 风格示例；`--pele-series-*` 为文档列出的默认值；注释标「可选」的项是文档默认 bold 的自定义覆盖。）

要点：
- 颜色切换**零成本**（CSS 变量在 SVG 中引用）；`prefers-color-scheme` 或 `data-theme` 切类即可。
- 图内 `style`/`classDef` 设置的颜色是硬编码，不随主题走；这些填充上的文字颜色自动在 `--pele-fg-on-light`/`--pele-fg-on-dark` 中择一对比度更高的（`src/svg/ink.ts`）。
- 精细控制可用类名：`.pele-node[data-id="start"] .pele-label { fill: var(--pele-accent) }`、`.pele-edge`、`.pele-cluster`、`.pele-title`、`.pele-marker`、`.pele-icon`、`.pele-math`。
- 图表类图用 `--pele-series-*`；pie/git/mindmap/kanban 等会取用系列色。

### 7.4 CSP / sanitizer

- 输出无 `<script>`/`<style>`/事件属性；但含**内联 `style` 属性** → 需要 `style-src 'unsafe-inline'`（推断，见 §4.7）。
- 图片会发请求 → 若 CSP `img-src` 受限，给 `images:false`。
- 使用自家 sanitizer（DOMPurify 等）：传 `mount(el, src, { sanitize: svg => DOMPurify.sanitize(svg) as unknown as Node })`；注意 DOMPurify 会删 `<foreignObject>`（MathML 路径不可用），SVG 输出则无碍；`render()` 路径需宿主自行 sanitize 后再插入。

### 7.5 打包体积策略

| 场景 | 方案 | 初始 gzip |
| --- | --- | --- |
| 只支持 1–3 种图 | `pele/core` + `pele/diagrams/x` | 24–63 KiB（首图） |
| 支持 6 种常见图 | core + 6 个入口 | ≈111.5 KiB |
| 类型不确定，接受闪一下 | `pele/lazy` | 15.3 KiB + 按需 |
| 全部 33 种、追求简单 | `pele` | 268.5 KiB |
| 非打包环境 | `pele.global.js`（CDN 自托管注意许可） | 269.3 KiB |

### 7.6 集成检查清单

- [ ] 锁定 `pele@1.12.0`，确认 npm `repository=obsidianmd/pele` 与 provenance；
- [ ] 选择入口（全量 / core+diagrams / lazy），确认 bundle 体积符合预算；
- [ ] `render()` 传唯一 `idPrefix`（同页多图）；
- [ ] 设置 `--pele-font` 且与 `fontFamily` 一致；中文字体栈已验证；
- [ ] 主题切换只改颜色变量；若字体也变，调用 `refresh()`；
- [ ] 按信任级别设置 `links`/`images`/`linkSchemes`/`linkRel`；内部链接套用导航策略；
- [ ] 错误消息用 `textContent` 展示；`mount()` 场景接 `onError`；
- [ ] 不可信图源：启用 `limit`/`outputLimit`/`maxEdges`（默认已开）并考虑 Worker 超时；
- [ ] 需要数学公式：接 `math` resolver（KaTeX trust:false / MathJax ui/safe），交付物用 SVG 输出；
- [ ] 需要图标：接可信 `icons` resolver；
- [ ] `THIRD_PARTY_NOTICES` 含 Pele MIT + Lucide ISC（建议直接收录完整 LICENSE 文件）；
- [ ] 视觉回归基线：与现有 Mermaid 输出做并排对比（布局必然不同，关注可读性而非像素）；
- [ ] E2E：CJK 长标签、窄容器 `maxWidth`、暗色主题、导出（`responsive:false`）。

---

## 附录 A：证据与复现命令

**本地副本**：`C:\Users\51159\AppData\Local\Temp\dsh-qQQS4s\pele-research`（只读，shallow，`git describe` = `1.12.0`，`git status` clean）。

```powershell
# 1) 拉取并解包发布包
curl / node fetch  https://registry.npmjs.org/pele/-/pele-1.12.0.tgz
tar -xzf pele-1.12.0.tgz -C <dir>

# 2) 体积（Node 22）
node -e "const fs=require('fs'),z=require('zlib');const b=fs.readFileSync('dist/pele.js');
console.log(b.length, z.gzipSync(b).length, z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}).length)"

# 3) 语料覆盖：对 tests/corpus/*-docs.json 逐条 render（本次 522/522）
# 4) CJK/安全/链接/限额：直接 import dist/pele.js，在无 document 的 Node 中跑（本报告 §2/§4/§6.5 的实测均来自此）
# 5) npm 元数据
Invoke-WebRequest https://registry.npmjs.org/pele
# 6) GitHub
Invoke-WebRequest https://api.github.com/repos/obsidianmd/pele
```

**关键文件索引**：

| 主题 | 路径 |
| --- | --- |
| 入口/注册 | `src/index.ts`、`src/diagrams/registry.ts`、`src/entries/*.ts` |
| 公共 API | `src/core.ts`、`src/lazy.ts`、`src/types.ts`、`src/models.ts`、`src/errors.ts` |
| 类型检测 | `src/detect.ts` |
| mount/zoom | `src/mount.ts`、`src/zoom.ts`、`src/window.ts` |
| 预处理（frontmatter/directive/实体码） | `src/preprocess.ts`、`src/util/yaml.ts`、`src/text/entities.ts` |
| SVG 输出 | `src/svg/{root,builder,theme,ink,edges,shapes,title,cluster}.ts` |
| 文本测量/换行 | `src/text/{measurer,metrics,label,math,icons}.ts` |
| 安全过滤 | `src/svg/builder.ts`(esc)、`src/svg/theme.ts`(style)、`src/util/url.ts`(URL) |
| 限额 | `src/core.ts` 顶部常量 |
| 兼容测试 | `tests/compat/<type>/`、`tests/compat/<type>/SKIPPED.md`、`tests/corpus/*-docs.json` |
| 安全测试 | `tests/render/inert.test.ts`、`tests/render/*-security.test.ts`、`tests/util/url.test.ts` |
| 构建/基准 | `scripts/{build,browser-build,bench,bench-mermaid,check-pack,sync-specs}.mjs` |
| 文档 | `website/src/content/docs/{api,compatibility,security,theming}.md`、`README.md`、`AGENTS.md`、`CONTRIBUTING.md`、`SECURITY.md` |
| CI/发布 | `.github/workflows/{ci,release}.yml` |

## 附录 B：未验证 / 局限

1. **未从源码构建**：本报告的 dist 数据全部来自 npm 发布包，未在本机 `npm ci && npm run build` 重建（避免污染只读副本，也未安装 dev 依赖）；构建可复现性未验证。
2. **未独立复现 500× / 6× 基准**：仓库 `bench:mermaid` 需 Chrome + Node 22 并从 unpkg 拉 Mermaid；本机只做了 Node 端 Pele 计时。官网 230 kB gzip 也与实测 268.5 KiB 不符，口径未知。
3. **浏览器 canvas 测量精度未实测**：CJK/字体实测均在 Node fallback 表下完成；真实浏览器 canvas 宽度只做了代码审查。
4. **CSP 结论为推断**：仓库无 CSP 文档；结论基于「输出含内联 style 属性、无 `<style>`/script」。
5. **架构/树图内置图标 glyph 是否第三方衍生未验证**：源码注释称自绘（24×24 grid），未做字形比对。
6. **GitHub 数据为快照**：stars/forks/issues/commit 数随时间变化（2026-10-27 抓取）。
7. **本地 clone 为 shallow（50 commits）**，完整历史/逐版本 diff 依赖 GitHub API，未逐版审计。
8. **obsidian 集成细节**：Obsidian 1.15.0 的 `--mermaid-*` 映射层不在 Pele 仓库内，未审阅。
