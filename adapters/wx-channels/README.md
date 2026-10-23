# Download & Manage 适配器

在芥子顶部「添加项目」中选择「Download & Manage · 视频号下载」，目录填写业务仓库的 `frontend/`。添加后可通过顶部下拉框切换，项目列表保存在根目录的本机 `project.json`。

也可显式启动或构建：

```sh
npm run dev -- --adapter wx-channels --source /path/to/wx_channels_download/frontend
npm run build -- --adapter wx-channels --source /path/to/wx_channels_download/frontend
# 集成测试从 project.json 读取 wx-channels 的绝对路径
npm run test:wx
```

适配器读取真实页面、DMUI 组件和项目自带的 Timeless 0.33.1 运行时，使用芥子的 esbuild 构建，不修改业务源码。当前提供 13 个业务页面的原始与 Mock 预览，另有内容卡片视图、Shell 布局及设置预览，共 28 个页面预览和 12 个组件，声明位于 `catalog.mjs`。默认构建、测试不依赖该外部项目。

页面各自使用顶层路径，例如 `/browsehistory`（浏览记录）、`/content`（内容管理）和 `/download`（下载任务）；对应有数据的预览位于 `/browsehistory/mock`、`/content/mock`、`/download/mock`。组件集中在 `/dmui/` 下，原有 Frame 路径与布局保持不变。

`/content/card` 展示带 Mock 数据的内容管理卡片视图，通过独立的内存 `content.layout` 设置调用业务已有的卡片布局，包含封面、标题、账号和标签；`/content/mock` 保留列表视图，各 Frame 的布局状态互不影响。

`/shell-layout` 分组展示真实 ShellLayoutView（业务模块导出名为 `SiderLayoutView`），包含侧栏和 Mock 下载页面。`/shell-layout/settings` 展示独立的完整设置弹窗；`/shell-layout/settings/certificate`、`/shell-layout/settings/mcp`、`/shell-layout/settings/about` 分别展示三个独立内容页，均使用真实 `ShellViewModel` 和业务视图。总览与详情预览均禁用业务交互，请通过画板目录选择不同内容；业务菜单切换行为由独立 DOM 集成测试验证。构建仅在预览包中导出原有的私有内容函数，业务源码保持不变。证书使用虚构的已信任状态，MCP 展示模拟的运行状态和工具列表；卸载证书、开关真实服务等写操作仍返回未实现提示。

每个 Frame 独立初始化运行时、业务 Model、内存存储与请求环境，复用现有预览宿主。页面 CSS 放在 ShadowRoot 中，暗色样式跟随白板，宽度断点转换为 Frame 容器断点；卸载时释放视图、路由、下载 SDK 和计时器。

原始预览保留列表空状态与未登录状态。有数据的预览由 `mock-data.js` 声明示例账号、内容、浏览记录、多种状态的下载任务、自动化流程及节点、运行记录、同步服务、日志、抓取结果与聊天消息，仍调用真实业务 Model 和 View。详情页自动携带示例记录 ID，文件预览使用内嵌 SVG 图片，不加载远程媒体；文件助手的模拟轮询在卸载时释放。数据与存储按 Frame 隔离，不读取真实下载记录或账号数据。

页面跳转请通过白板目录选择。WebSocket 只提供内存连接，不产生业务事件。未实现的 API 返回明确错误，不连接业务后端。真实下载、抓取、同步、登录与自动化执行不在白板中运行。

源码位置由芥子统一编译追踪，通过 Timeless 视图绑定实际 DOM，支持进度条等配置转发组件，无需项目单独注入。未追踪的运行时内部节点仍显示「未记录源码位置」，不会伪造位置，详见[统一追踪说明](../../README.md#节点源码追踪)。集成测试检查所有页面与组件的挂载、卸载、状态隔离及宿主边界；浏览器排版、编辑器和媒体行为由人工验收。
