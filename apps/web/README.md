# PawOffice 完整办公室

React 应用负责团队、聊天、业务数据源、地图编辑器与 HTTP/SSE 接入；公共包只包含独立协议、运行时、渲染、动画与场景规则。

首页 `/` 直接装配完整办公室，`/office/` 提供相同入口；两者均使用 `src/main.tsx`，支持静态演示和服务端运行时配置。原官网介绍页已移除。

只维护一份 `index.html`；`/office/` 由 Vite 在开发时映射、在构建时生成，避免两份 HTML 的品牌和配置发生偏差。应用与各示例的共用场景宿主位于 `apps/shared/scene/`。

最小装配位于 `/minimal/`，教室位于 `/classroom/`，农场位于 `/farm/`；这些场景仍使用独立页面入口。最小装配可返回办公室首页。

从仓库根目录运行 `npm run dev:vite` 启动本地演示，或运行 `npm run dev` 启动前端与 Fastify。`npm run build` 输出到根目录 `dist/`。

项目包名使用 `@pawoffice/*`，服务端配置变量使用 `PAWOFFICE_*`，聊天地址使用 `VITE_PAWOFFICE_CHAT_URL`；业务接口位于 `/api/pawoffice/`。
