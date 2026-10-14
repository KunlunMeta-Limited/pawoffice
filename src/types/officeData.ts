/**
 * Office 资源请求的生命周期状态。
 *
 * 功能：统一表达资源尚未启用、读取中、可用或读取失败。
 * 字段/变体语义：`idle` 未启用，`loading` 首次读取中，`ready` 有可展示数据，`error` 首次读取失败。
 * 数据来源：`useOfficeResource` 和会话摘要缓存的请求生命周期。
 * 数据去向：各中心的加载、空态和错误 UI。
 * 约束：后台刷新已有数据时应保持 `ready`，不得用 `loading` 引发页面抖动。
 * 稳定性：前端公共状态契约，新增状态必须同步 UI、测试和 CHG。
 * 关联：`DAT-OFFICE-RESOURCE-001`、`CHG-2026-0013`。
 */
/** 中文门禁摘要：Office 资源请求的稳定生命周期枚举。 */
export type OfficeResourceState = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 会话列表中用于面板展示的摘要。
 *
 * 功能：承载最近会话列表所需的最小脱敏元数据。
 * 字段/变体语义：编号和标题标识会话，provider/model 描述模型配置，时间字段用于排序。
 * 数据来源：Gateway `/office/sessions` 对 Host session 摘要的转换。
 * 数据去向：会话缓存、最近对话列表和任务到对话的跳转。
 * 约束：时间为 Unix 毫秒；不得包含消息正文、工具输入输出或凭据。
 * 稳定性：Office 前端公共数据契约。
 * 关联：`API-OFFICE-DATA-001`、`CHG-2026-0013`。
 */
/** 中文门禁摘要：最近会话列表使用的脱敏摘要。 */
export interface OfficeSessionSummary {
  /** 会话稳定编号；来源于 Host，送往会话路由；必填且在生命周期内不可变。 */
  id: string
  /** 会话显示标题；来源于 Host meta，送往最近对话列表；必填，可随会话更新。 */
  title: string
  /** provider 标识；来源于 Host 配置，送往会话摘要；必填，不得包含密钥。 */
  provider: string
  /** 模型标识；来源于 Host 配置，送往会话摘要；必填，不得包含请求参数。 */
  model: string
  /** 创建时间；来源于 Host meta，送往排序和时间显示；必填 Unix 毫秒。 */
  createdAt: number
  /** 最近更新时间；来源于 Host meta，送往倒序排列；必填 Unix 毫秒。 */
  updatedAt: number
}

/**
 * 创建或初始化 Office 对话时提交的请求。
 *
 * 功能：描述创建空会话或创建后立即发送首条文本所需的可选字段。
 * 字段/变体语义：`text` 为首条正文，其余字段覆盖 Host 默认会话配置。
 * 数据来源：对话中心新建表单和任务中心跳转。
 * 数据去向：Gateway `POST /office/conversations`。
 * 约束：至少应提供有效标题或正文；目录必须由 Gateway/Host 重新校验边界。
 * 稳定性：Office 创建会话请求契约。
 * 关联：`API-OFFICE-CONVERSATION-001`、`CHG-2026-0013`。
 */
/** 中文门禁摘要：创建或初始化 Office 对话的请求字段。 */
export interface OfficeConversationRequest {
  /** 创建请求幂等键；来源于前端 API，送往 Gateway；重试必须复用且仅允许可打印 ASCII。 */
  requestID?: string
  /** 首条正文；来源于用户输入，送往 Host prompt；可选，去除首尾空白后不得为空。 */
  text?: string
  /** 会话标题；来源于用户输入，送往 Host meta；可选且应为脱敏短文本。 */
  title?: string
  /** provider 覆盖值；来源于受控配置，送往 Host；可选且必须位于白名单。 */
  provider?: string
  /** 模型覆盖值；来源于受控配置，送往 Host；可选，不得携带密钥。 */
  model?: string
  /** 工作区目录；来源于受控 UI，送往 Host；可选，必须由 Gateway 校验根边界。 */
  directory?: string
}

/**
 * 创建会话接口的结果。
 *
 * 功能：同时返回新会话摘要和可选首条 prompt 是否已被 Host 接收。
 * 字段/变体语义：`session` 用于立即选中会话，`promptAccepted` 只确认入场成功。
 * 数据来源：Gateway 创建会话编排结果。
 * 数据去向：会话摘要缓存和前端回合控制器。
 * 约束：`promptAccepted=true` 不代表模型完成；终态必须继续查询消息和 turns。
 * 稳定性：Office 创建会话响应契约。
 * 关联：`API-OFFICE-CONVERSATION-001`、`CHG-2026-0013`。
 */
/** 中文门禁摘要：创建会话及首条 prompt 接收状态。 */
export interface OfficeConversationResult {
  /** 会话对象；来源于 Host，经 Gateway 返回并送往摘要缓存；必填，额外字段不得直接渲染。 */
  session: OfficeSessionSummary & Record<string, unknown>
  /** 首条 prompt 接收标记；来源于 Gateway 编排，送往控制器；必填且不代表回合完成。 */
  promptAccepted: boolean
}

/**
 * Office 消息提交的接收确认。
 *
 * 功能：确认 Gateway 已把当前消息交给 Host，并携带 Host 分配的回合编号。
 * 字段/变体语义：`accepted` 只表示已接收，`turnID` 用于随后精确对账终态。
 * 数据来源：Gateway `POST /office/conversations/:id/messages`。
 * 数据去向：对话控制器的活动回合身份绑定。
 * 约束：`turnID` 对客户端不透明；旧 Host 未返回响应头时允许缺省。
 * 稳定性：Office 消息提交响应契约。
 * 关联：`API-OFFICE-CONVERSATION-001`、`CHG-2026-0014`。
 */
/** 中文门禁摘要：消息提交成功后的会话和回合身份。 */
export interface OfficeConversationPromptResult {
  /** 接收标记；来源于 Gateway，送往控制器；必填且不代表模型已经完成。 */
  accepted: boolean
  /** 目标会话编号；来源于路由参数，送往控制器校验；必填且不可变。 */
  sessionId: string
  /** Host 回合编号；来源于 `openpaw-turn-id` 响应头，送往终态对账；旧 Host 下可选。 */
  turnID?: string
}

/**
 * 功能：表示 Office 对话消息中的一个可展示内容 part。
 * 字段/变体语义：`type=text` 时 `text` 为正文。
 * 数据来源：Gateway 对 Host message/turn 的白名单转换。
 * 数据去向：对话视图缓存和消息渲染器。
 * 约束：浏览器响应只接受文本 part；工具输入、输出和内部推理必须被丢弃。
 * 稳定性：L3 Office 消息字段类型。
 * 关联：`API-OFFICE-CONVERSATION-004`、`CHG-2026-0013`。
 */
/** 中文门禁摘要：Office 可展示消息 part，只允许脱敏文本进入正文缓存。 */
export interface OfficeConversationMessagePart {
  /** part 编号；来源于 Host SSE/message，送往增量合并；可选且对客户端不透明。 */
  id?: string
  /** 所属消息编号；来源于 Host，送往 SSE 增量隔离；可选。 */
  messageID?: string
  /** 所属会话编号；来源于 Host，送往跨会话隔离；可选。 */
  sessionID?: string
  /** part 类型；来源于 Host message，送往白名单清洗器；可选，仅 `text` 可进入正文。 */
  type?: string
  /** 文本正文；来源于 Host 或本地 notice，送往消息视图；可选且受总长度上限约束。 */
  text?: string
}

/**
 * 功能：表示会话正文、失败通知或隐藏终态标记。
 * 字段/变体语义：`role=user|assistant` 为正文，`role=system` 为脱敏失败/取消通知；`kind=completed` 可无文本。
 * 数据来源：Gateway `/office/conversations/:id/messages`。
 * 数据去向：`conversationViewStore`、对话控制器和对话中心。
 * 约束：只允许白名单元数据和 text part；system 通知不得进入 Host 模型上下文。
 * 稳定性：L3 Office 专用消息契约。
 * 关联：`API-OFFICE-CONVERSATION-004`、`CHG-2026-0013`。
 */
/** 中文门禁摘要：Office 对话正文及失败、取消、完成终态的白名单消息。 */
export interface OfficeConversationMessage {
  /** 消息元数据；来源于 Host/Gateway 或本地 notice，送往去重和渲染；可选，ID 与 turnID 不透明。 */
  info?: { id?: string; sessionID?: string; role?: string; kind?: string; turnID?: string; time?: { created?: number; completed?: number } }
  /** 内容 part；来源于 Host/Gateway，送往白名单清洗器；可选，保持协议顺序且只渲染文本。 */
  parts?: OfficeConversationMessagePart[]
}

/**
 * 对话回合的实时活动摘要。
 *
 * 功能：向 UI 和办公室动画提供当前思考、工具调用或撰写回复的脱敏状态。
 * 字段/变体语义：kind 决定活动类别，tool 是可选工具名，task 是可展示短提示。
 * 数据来源：Host `SessionActivity` 经 Gateway 状态接口返回。
 * 数据去向：对话状态提示和人物动作联动。
 * 约束：不得包含工具参数、结果、Prompt、文件正文或凭据。
 * 稳定性：Office 活动投影契约。
 * 关联：`API-HOST-SESSION-005`、`REQ-B-OFFICE-003`。
 */
/** 中文门禁摘要：当前回合的脱敏活动摘要。 */
export interface OfficeConversationActivity {
  /** 活动类别；来源于 Host，送往 UI 状态映射；可选，未知值必须安全降级。 */
  kind?: 'thinking' | 'tool' | 'responding' | string
  /** 当前工具名；来源于 Host，送往状态提示；可选且不得附带参数或结果。 */
  tool?: string
  /** 活动短提示；来源于 Host，送往对话和动画 UI；可选且必须脱敏、限长。 */
  task?: string
}

/**
 * 功能：表示目标会话当前排队或执行状态。
 * 字段/变体语义：`type=queued` 表示等待全局 permit，`busy` 表示已进入 Provider/工具回合。
 * 数据来源：Host `/session/status` 经 Gateway 按 session 过滤。
 * 数据去向：对话控制器、运行圆点和活动提示。
 * 约束：终态不通过此类型表达，必须从持久化 turn outcome 读取。
 * 稳定性：L3 状态查询契约。
 * 关联：`API-HOST-SESSION-005`、`CHG-2026-0012`、`CHG-2026-0013`。
 */
/** 中文门禁摘要：目标会话当前排队或执行状态，历史终态不由此类型表达。 */
export interface OfficeConversationStatus {
  /** 当前状态类型；来源于 Host，送往控制器；可选，活动值只允许 queued 或 busy。 */
  type?: string
  /** 当前回合编号；来源于 Host，送往 turns 对账；可选且对客户端不透明。 */
  turnID?: string
  /** 当前用户消息编号；来源于 Host，送往消息关联；可选且对客户端不透明。 */
  userMessageID?: string
  /** 队列位置；来源于 Host 调度器，送往排队提示；仅 queued 时可选，使用 1 基位置。 */
  queuePosition?: number
  /** 活动摘要；来源于 Host，送往 UI/动画；可选且必须满足脱敏边界。 */
  activity?: OfficeConversationActivity
}

/**
 * 工作区文件正文响应。
 *
 * 功能：承载已通过路径边界检查的 UTF-8 文件内容。
 * 字段/变体语义：`path` 标识相对位置，`content` 是受大小限制的正文。
 * 数据来源：Gateway 文件读取接口。
 * 数据去向：文件中心预览器和技能正文查看器。
 * 约束：路径必须相对允许根目录，正文不得超过 Gateway 限制或包含未授权文件。
 * 稳定性：Office 文件读取响应契约。
 * 关联：`API-OFFICE-FILE-002`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：通过路径边界检查的文件正文。 */
export interface OfficeFileContent {
  /** 规范化相对路径；来源于 Gateway，送往标题和后续读取；必填且不得包含根目录逃逸。 */
  path: string
  /** UTF-8 正文；来源于受控文件读取，送往预览器；必填且受大小和权限边界限制。 */
  content: string
}

/** 对话回合成功写入工作区的可查看产物类型。 */
export type OfficeArtifactKind = 'markdown' | 'diagram' | 'image' | 'document' | 'data' | 'text' | 'other'

/**
 * 对话产物摘要。
 * 只包含工作区内已通过路径校验的文件元数据，不包含工具输入、文件正文或绝对路径。
 */
export interface OfficeConversationArtifact {
  id: string
  sessionId: string
  /** 子 Agent 产物所属空间；主空间沿用父会话扫描时可缺省。 */
  workspaceId?: string
  turnId?: string
  path: string
  name: string
  kind: OfficeArtifactKind
  mimeType: string
  size: number
  updatedAt: number
}

/**
 * 技能文件正文响应。
 *
 * 功能：在受控文件正文基础上补充可展示的技能名称。
 * 字段/变体语义：继承路径和正文，`name` 是可选技能目录名。
 * 数据来源：Gateway 技能读取接口。
 * 数据去向：技能中心详情面板。
 * 约束：继承文件路径和大小限制；名称不得作为文件系统授权依据。
 * 稳定性：Office 技能读取响应契约。
 * 关联：`API-OFFICE-SKILL-002`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：带技能名称的受控文件正文。 */
export interface OfficeSkillContent extends OfficeFileContent {
  /** 技能名称；来源于 Gateway，送往详情标题；可选，缺失时只允许按已校验路径展示。 */
  name?: string
}

/**
 * 待审批权限的面板摘要。
 *
 * 功能：向用户展示一次工具审批所需的最小信息。
 * 字段/变体语义：编号用于回复，permission/patterns 描述请求，metadata/always 提供受控提示。
 * 数据来源：Host permission API 经 Gateway 白名单转换。
 * 数据去向：对话中心权限请求框和审批回复接口。
 * 约束：不得包含内部工具输入、凭据或未脱敏文件正文；回复只作用于登记请求。
 * 稳定性：Office 权限摘要契约。
 * 关联：`API-HOST-PERMISSION-001`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：对话中心可展示的待审批权限摘要。 */
export interface OfficePermissionSummary {
  /** 请求编号；来源于 Host，送往审批回复路由；必填且对客户端不透明。 */
  id: string
  /** 所属 session；来源于 Host，送往会话筛选；兼容旧 Host 时可选。 */
  sessionID?: string
  /** 权限或工具名；来源于 Host，送往用户提示；必填且不得拼接原始参数。 */
  permission: string
  /** 受控匹配提示；来源于 Host，送往审批 UI；必填数组，内容必须脱敏。 */
  patterns: string[]
  /** 非敏感元数据；来源于 Gateway/Host，送往辅助显示；必填对象，未知字段不得直接渲染。 */
  metadata: Record<string, unknown>
  /** 长期授权候选提示；来源于 Host，送往 UI；必填数组，当前实现仍只回复单个请求。 */
  always: string[]
}

/**
 * 技能列表摘要。
 *
 * 功能：标识一个可读取的技能文件及其显示名称。
 * 字段/变体语义：`name` 用于展示，`path` 用于受控详情读取。
 * 数据来源：Gateway 对 OpenPaw skill 目录的扫描结果。
 * 数据去向：技能中心列表和详情请求。
 * 约束：路径必须位于允许的技能根目录；名称不得作为授权依据。
 * 稳定性：Office 技能列表契约。
 * 关联：`API-OFFICE-SKILL-001`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：技能列表中的名称和受控路径。 */
export interface OfficeSkillSummary {
  /** 显示名称；来源于技能元数据，送往列表；必填且应为脱敏短文本。 */
  name: string
  /** 技能相对路径；来源于 Gateway 扫描，送往详情读取；必填且不得越过技能根。 */
  path: string
}

/**
 * 当前 Office 工作区摘要。
 *
 * 功能：向文件中心显示 Gateway 实际采用的工作区根目录。
 * 字段/变体语义：`root` 是规范化后的根目录字符串。
 * 数据来源：Gateway 启动配置。
 * 数据去向：文件中心路径提示和诊断信息。
 * 约束：只用于显示，不得由浏览器据此绕过 Gateway 路径校验。
 * 稳定性：Office 工作区查询契约。
 * 关联：`API-OFFICE-WORKSPACE-001`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：Gateway 实际采用的工作区根目录。 */
export interface OfficeWorkspaceSummary {
  /** 工作区根；来源于 Gateway 配置，送往路径提示；必填，只读且不能作为浏览器授权依据。 */
  root: string
}

/**
 * Office 通知的显示级别。
 *
 * 功能：限制通知只能使用已登记的四种视觉语义。
 * 字段/变体语义：info/success/warning/error 只影响 UI 呈现和筛选。
 * 数据来源：Gateway 通知创建接口。
 * 数据去向：通知中心样式和筛选逻辑。
 * 约束：不得据此推断引擎错误分类或重试策略。
 * 稳定性：Office 通知显示契约。
 * 关联：`API-OFFICE-NOTIFICATION-001`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：通知中心允许使用的显示级别。 */
export type OfficeNotificationLevel = 'info' | 'success' | 'warning' | 'error'

/**
 * 网关进程内通知。
 *
 * 功能：承载通知中心所需的标题、正文、级别、时间和已读状态。
 * 字段/变体语义：编号用于更新，级别用于显示，read 表示当前 Gateway 内存状态。
 * 数据来源：Gateway 通知接口或本地自动化任务。
 * 数据去向：通知中心和标记已读接口。
 * 约束：正文必须脱敏；当前数据可能随 Gateway 重启丢失。
 * 稳定性：Office 本地通知契约。
 * 关联：`API-OFFICE-NOTIFICATION-001`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：通知中心展示和更新的一条通知。 */
export interface OfficeNotification {
  /** 通知编号；来源于 Gateway，送往已读路由；必填且对客户端不透明。 */
  id: string
  /** 通知标题；来源于创建方，送往列表；必填且必须脱敏。 */
  title: string
  /** 通知正文；来源于创建方，送往列表；必填且不得包含凭据或完整 Prompt。 */
  body: string
  /** 显示级别；来源于创建方，送往样式映射；必填且只能使用登记值。 */
  level: OfficeNotificationLevel
  /** 创建时间；来源于 Gateway，送往排序和显示；必填 Unix 毫秒。 */
  createdAt: number
  /** 已读状态；来源于 Gateway，送往列表操作；必填布尔值。 */
  read: boolean
}

/**
 * 工作区文件树中的单个条目。
 *
 * 功能：描述文件中心可浏览的一条文件或目录摘要。
 * 字段/变体语义：`path` 是相对路径，`type` 区分文件和目录。
 * 数据来源：Gateway 工作区目录扫描。
 * 数据去向：文件中心列表和文件读取请求。
 * 约束：路径必须经过规范化且位于允许根；目录不得作为正文读取。
 * 稳定性：Office 文件列表契约。
 * 关联：`API-OFFICE-FILE-001`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：文件中心使用的受控文件摘要。 */
export interface OfficeFileSummary {
  /** 规范化相对路径；来源于 Gateway，送往列表和读取路由；必填且不得根目录逃逸。 */
  path: string
  /** 条目类型；来源于文件系统扫描，送往操作选择；必填且只允许 file/directory。 */
  type: 'file' | 'directory'
}

/**
 * 任务中心展示的任务摘要。
 *
 * 功能：承载任务列表、状态统计和任务到会话跳转所需字段。
 * 字段/变体语义：编号定位任务，状态/优先级驱动显示，sessionId 建立可选对话关联。
 * 数据来源：Gateway 任务存储或任务文件解析。
 * 数据去向：任务中心、顶部统计和会话跳转。
 * 约束：字段必须脱敏；未知状态按未登记状态显示，不得伪造进度。
 * 稳定性：Office 任务摘要契约。
 * 关联：`API-OFFICE-TASK-001`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：任务中心展示和关联会话的任务摘要。 */
export interface OfficeTaskSummary {
  /** 任务编号；来源于 Gateway，送往更新/删除路由；必填且必须路径安全。 */
  id: string
  /** 任务目标；来源于用户或任务文件，送往列表；必填且必须脱敏。 */
  objective: string
  /** 任务状态；来源于 Gateway/文件元数据，送往标签和统计；必填，未知值安全降级。 */
  status: string
  /** 优先级；来源于任务数据，送往列表；必填，兼容文本或数字旧格式。 */
  priority: string | number
  /** 下一步动作；来源于任务数据，送往列表；必填字符串，可为空。 */
  nextAction: string
  /** 公开执行阶段；来源于 Gateway 生命周期，送往目标阶段轨道；可选以兼容旧任务文件。 */
  phase?: 'planning' | 'executing' | 'verifying' | 'delivering' | 'completed' | 'failed' | 'cancelled'
  /** 完成标准；来源于用户目标表单，送往任务详情和执行 Prompt；可选且不得包含凭据。 */
  successCriteria?: string
  /** 执行策略；自动规划展示公开计划，快速执行减少规划开销。 */
  executionMode?: 'auto_plan' | 'quick'
  /** 失败原因；来源于 Gateway 脱敏终态，送往失败卡；成功和取消任务省略。 */
  failureReason?: string
  /** 失败发生的公开阶段；来源于 Gateway，送往失败定位；可选。 */
  failureStage?: string
  /** 稳定错误码；来源于 Host 终态或 Gateway，送往失败诊断；可选且不包含原始异常栈。 */
  errorCode?: string
  /** 当前失败是否适合直接重试；来源于 Host 终态或 Gateway 分类。 */
  retryable?: boolean
  /** 面向用户的后续处理建议；来源于 Gateway 失败分类。 */
  recommendedAction?: string
  /** 当前执行尝试次数；首次为 1，重试时递增。 */
  attempt?: number
  /** 重试链的原任务编号；来源于 Gateway，送往任务详情；首次执行省略。 */
  parentTaskId?: string
  /** 创建时间 Unix 毫秒；旧任务缺失时省略。 */
  createdAt?: number
  /** 最近更新时间 Unix 毫秒；旧任务缺失时省略。 */
  updatedAt?: number
  /** 分派智能体；来源于任务数据，送往负责人显示；可选且仅使用登记名称。 */
  assignedAgent?: string
  /** 关联会话；来源于任务数据，送往对话跳转；可选且必须由会话接口再次确认存在。 */
  sessionId?: string
}

/**
 * 创建任务时提交的请求。
 *
 * 功能：描述用户创建任务时允许指定的目标、优先级、下一步动作和可选编号。
 * 字段/变体语义：objective 必填，其余字段由 Gateway 应用默认值或安全化。
 * 数据来源：任务中心创建表单。
 * 数据去向：Gateway 任务创建接口。
 * 约束：目标去空白后不得为空；编号必须由 Gateway 路径安全化。
 * 稳定性：Office 创建任务请求契约。
 * 关联：`API-OFFICE-TASK-002`、`CHG-2026-0004`。
 */
/** 中文门禁摘要：创建任务并可选绑定会话的请求。 */
export interface OfficeTaskCreateRequest {
  /** 任务目标；来源于用户输入，送往 Gateway 任务存储；必填且去空白后不得为空。 */
  objective: string
  /** 优先级；来源于用户输入，送往 Gateway；可选，缺省由 Gateway 决定。 */
  priority?: string | number
  /** 下一步动作；来源于用户输入，送往任务存储；可选且必须脱敏。 */
  nextAction?: string
  /** 完成标准；来源于用户输入，送往目标执行 Prompt；可选，最多 1000 字符。 */
  successCriteria?: string
  /** 执行策略；自动规划或快速执行，缺省为自动规划。 */
  executionMode?: 'auto_plan' | 'quick'
  /** 候选编号；来源于调用方，送往 Gateway；可选且必须经过路径安全化后才能使用。 */
  id?: string
}

/**
 * Office 场景中智能体的可观察状态。
 *
 * 功能：限制人物动画和状态标签使用已登记状态。
 * 字段/变体语义：idle/walking/working/talking/thinking 分别表示空闲、移动、工作、交流和思考。
 * 数据来源：Host Office 动作和场景模拟器。
 * 数据去向：人物状态机、智能体中心和动画联动。
 * 约束：状态只描述可视投影，不代表 Host 回合终态。
 * 稳定性：Office 场景状态契约。
 * 关联：`API-OFFICE-ACTION-001`、`REQ-B-OFFICE-003`。
 */
/** 中文门禁摘要：Office 角色允许使用的稳定状态枚举。 */
export type OfficeAgentState = 'idle' | 'walking' | 'working' | 'talking' | 'thinking'

/**
 * Office 名册中智能体的状态摘要。
 *
 * 功能：把名册身份、显示名称、场景状态和脱敏任务摘要提供给 UI。
 * 字段/变体语义：rosterNo 是协议编号，id 是场景编号，state/task 描述当前投影。
 * 数据来源：Gateway 名册配置和 Host Office 动作状态。
 * 数据去向：智能体中心、顶部统计和办公室场景。
 * 约束：名册编号必须唯一且从 1 开始；task 不得包含凭据、路径或完整 Prompt。
 * 稳定性：Office 名册与状态契约。
 * 关联：`API-OFFICE-DATA-001`、`REQ-B-OFFICE-003`。
 */
/** 中文门禁摘要：智能体中心和办公室场景使用的角色摘要。 */
export interface OfficeAgentSummary {
  /** 名册序号；来源于 Gateway 名册，送往动作协议；必填、唯一且从 1 开始。 */
  rosterNo: number
  /** 场景编号；来源于名册配置，送往场景实体查找；必填且稳定。 */
  id: string
  /** 显示名称；来源于名册配置，送往 UI；必填且不得作为授权身份。 */
  name: string
  /** 当前状态；来源于动作投影，送往 UI/动画；必填且只能使用登记枚举。 */
  state: OfficeAgentState
  /** 当前任务摘要；来源于 Host 投影，送往 UI；必填，空字符串表示无任务且内容必须脱敏。 */
  task: string
}

/** 一个完整独立 Agent 对应的办公室空间；每个空间固定包含同一套六人名册。 */
export interface OfficeAgentWorkspaceSummary {
  id: string
  name: string
  kind: 'main' | 'subagent'
  parentWorkspaceId?: string
  sessionId?: string
  updatedAt: number
  agents: OfficeAgentSummary[]
  /** 该空间最近的脱敏活动、交接、产物和模型正文；按时间正序，最多 40 条。 */
  outputs?: Array<{
    id: string
    kind: 'activity' | 'artifact' | 'handoff' | 'model'
    text: string
    state?: OfficeAgentState
    rosterNo?: number
    streaming?: boolean
    createdAt: number
    updatedAt?: number
  }>
  relation?: {
    peerWorkspaceId: string
    direction: 'outgoing' | 'incoming'
    phase: 'going' | 'talking' | 'returning'
    message: string
    rosterNo: number
  }
  relations?: Array<{
    peerWorkspaceId: string
    direction: 'outgoing' | 'incoming'
    phase: 'going' | 'talking' | 'returning'
    message: string
    rosterNo: number
  }>
}
