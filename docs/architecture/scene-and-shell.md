# 场景视图与应用界面

当前办公室、教室、农场和轴测办公室预览都按三个部分装配：

```text
App / RuntimeWorkspace（装配入口）
├── controller（场景实例、状态、命令、数据连接）
├── scene（画布、场景内内容、资源加载反馈）
└── ui / Shell（导航、按钮、表单、统计、业务面板）
```

`Shell` 通过 `scene` 插槽安排场景的位置，也可以传入按钮等覆盖层。覆盖层仍属于应用界面；场景自己的白板、人物铭牌和字幕属于场景视图。双方共享控制层提供的状态和操作，不互相创建或销毁。

## 目录

| 入口 | 控制层 | 场景 | 默认界面 |
| --- | --- | --- | --- |
| `apps/web/src/components/RuntimeWorkspace.tsx` | `src/controller/useOfficeSceneController.ts` | `src/components/OfficeCanvas.tsx` | `src/ui/OfficeShell.tsx` |
| `examples/classroom/src/ClassroomApp.tsx` | `src/controller/useClassroomController.ts` | `src/scene/ClassroomScene.tsx` | `src/ui/ClassroomShell.tsx` |
| `examples/farm/src/FarmApp.tsx` | `src/controller/useFarmController.ts` | `src/scene/FarmScene.tsx` | `src/ui/FarmShell.tsx` |
| `examples/dimetric/src/studio/StudioApp.tsx` | `controller/useStudioController.ts` | `scene/StudioScene.tsx` | `ui/StudioShell.tsx` |

场景样式跟随场景模块，界面样式跟随 Shell；根目录的 CSS 只保留基础主题。经典办公室的地图编辑和人物菜单在 `ui/OfficeSceneControls.tsx`，聊天框在装配层作为覆盖界面接入。

## 装配与替换

默认 `layout="full"` 还原完整页面；`layout="scene"` 只展示场景。各应用还接受 `shell` React 组件，用来替换默认外层界面。

```tsx
<FarmApp assetBaseUrl="/farm-assets/" layout="scene" />
<FarmApp assetBaseUrl="/farm-assets/" shell={MyFarmShell} />
```

自定义 Shell 接收对应的 `ShellProps`。例如农场 Shell 可以把 `scene()` 放到任意有明确尺寸的容器里，通过 `controller.start()` 发起农作；办公室 Shell 接收装配好的 `scene` 节点和业务操作回调。

运行中更换 `layout` 或 `shell` 时，保留 App 的 React 身份和控制层。`apps/shared/scene/SceneHost.ts` 持有同一渲染 DOM 根节点，`SceneSurface` 将它移动到新容器，控制层持有的运行时和画布继续使用。卸载整个 App、改变场景资源地址或场景连接参数时，才按相应生命周期重新创建场景。通过跳转 URL 重新加载页面不属于运行中的布局切换。

本地预览可在现有地址加 `?layout=scene`：

- `/office/?layout=scene`
- `/classroom/?layout=scene`
- `/farm/?layout=scene`
- 独立轴测入口 `/?layout=scene`

只展示场景时仍可由外部网关或控制层驱动，页面操作按钮由完整 Shell 或自定义 Shell 提供。

## 办公室页面布局

完整办公室提供两套前端 Shell，左上角的布局按钮可随时切换：

- `classic`：原有导航、概况和右侧任务面板。
- `members`：左侧三列成员头像、选中成员资料，右侧复用办公室场景。

直接访问 `/office/?shell=members` 可预览成员布局，`/office/?shell=classic` 可打开经典布局。选择保存在浏览器的 `pawoffice.page-shell.v1` 中，URL 的显式选择优先。`shell` 与 `layout=scene` 独立；场景模式仍只显示办公室，不展示成员侧栏。代码传入自定义 `shell` 组件时，优先使用该组件，不显示内置布局切换器。

以上本地偏好只用于静态演示和非受控装配。正式连接模式通过 `OfficeIntegrationSession` 接收服务端的页面布局选择，前端按钮和外部业务后端共用同一份服务实例级状态；服务端选择优先于本地偏好和 URL。`office.layout.read` 查询当前布局及目录，初始化可指定 `layoutId`，`office.layout.set` 独立切换。布局版本由服务端管理，随 SSE 首次同步与重连恢复，不参与办公室业务 `seq`。每个布局的目录项声明数据投递操作与 JSON Schema，目前两者均使用现有办公室快照。

成员侧栏复用人物包的独立头像，按员工 ID 选择成员，允许不同员工绑定同一个人物。点击场景人物与左侧选择互相联动，未绑定业务成员的人物保留原有点击行为。统计、当前任务和动态只来自当前会话快照，不冒充完整历史数据；完整档案优先使用已有的 `employee.inspect`，本地演示则展示当前会话已有关联任务和动态。布局不新增外部接口要求。

成员详情分成顶部资料与统计、中间任务与动态、底部档案入口三个区域。任务简介随中间内容独立滚动，底部按钮始终保留在滚动区外；切换成员或会话时，中间区域回到顶部。极矮窗口下，顶部资料也允许独立滚动，避免挤掉底部入口。

成员布局的办公室九宫格入口位于左侧标题栏，与布局切换按钮并排，仍复用原有目录弹窗，不另设办公室下拉框。地图编辑、闲聊和演示工具条在两种布局中均位于场景右上角，演示开关只显示开始或暂停图标，操作名称由悬停提示与无障碍标签提供。高级场景控制、插件和协议入口仍在成员资料右上角的菜单。聊天、审批、地图编辑和演示继续使用现有装配逻辑。窄屏时成员侧栏折叠为抽屉，展开按钮位于场景左上角，避免与工具条重叠。切换页面 Shell 不重新创建控制层、运行时或渲染画布。

## 工作屏幕动画

参考办公室的电脑屏幕由 `packages/scene-office/src/pixi/effects/OfficeMonitorScreen.ts` 绘制。六台电脑共享一张 128 × 256 的静态代码贴图，各自只保留四个顶点和独立的滚动偏移，不逐帧绘制文字、上传图片或创建 React 状态。屏幕内容内缩于显示器边框，并沿用桌面和人物的遮挡顺序。

只有人物正在本工位以背面坐姿执行 `office.type`、且任务处于进行中时才滚动。走动、交谈、任务暂停或完成后保留最后一帧。滚动有短暂停顿，不同工位错开起始位置；复用场景时钟，更新上限为 20 FPS，不提高办公室既有的静坐 20 FPS、走路 60 FPS。隐藏场景、编辑布局或启用系统减少动态效果时停止推进。最后一个屏幕卸载时释放共享贴图，每个屏幕卸载时释放自身几何缓冲。

## 后续配置层接入位置

未来的前端能力配置应由装配层消费：界面配置选择 Shell 的区域和组件，场景配置选择场景及实体。运行时、动画播放器和画面挂点仍由场景模块维护。本次没有新增或定稿任何后端协议。
