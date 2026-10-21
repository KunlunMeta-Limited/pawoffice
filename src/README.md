# Frontend Source

React 外壳负责仪表板呈现，Pixi 场景负责角色移动。`services/officeGatewayApi.ts`
是仪表板唯一的数据传输边界；
scene action transport remains in `services/officeActionHttp.ts`.
