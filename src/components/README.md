# 组件层

`OfficeDashboardChrome` 负责导航、统计和网关数据面板。每个远程面板都区分加载中、
空数据和连接失败状态，并通过统一 API 完成对话、任务、日程、通知、文件和技能交互。
首页只显示任务、智能体和快捷方式；会话创建先建立命名的空会话，首条消息由对话编辑器
发送，provider/model 由网关默认配置决定。`OfficeCanvas` 与 `OfficeActionConnector`
仍是 Pixi 场景集成边界，场景初始化带卸载失效保护，避免异步资源加载后残留画布或桥接。
