# 服务层

`officeGatewayApi.ts` 从配置的动作地址解析网关 origin，并集中提供类型化的
`/office/*` 读写接口。`useOfficeResource.ts` 为 React 管理可中止的请求生命周期。
`officeActionDispatcher.ts` 串行化场景拜访，`officeActionHttp.ts` 轮询动画动作。
所有页面组件都必须通过该 API 调用网关，不能自行拼接 URL 或读取本地文件。
