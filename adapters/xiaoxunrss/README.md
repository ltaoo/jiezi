# 小讯适配器

前端白板。Frame 直接调用同名 `.frame` 模块导出的 `_Preview` 数组项的 `render()`，支持页面分组、拖动、缩放、搜索、详情、主题和真实 DOM 节点框选；不使用 iframe，也不启动阅读器登录、路由或后端。

这是可选的业务适配器，只有显式指定已安装依赖的小讯项目源码时才启用。页面、frui、业务组件和搜索插件的预览入口由构建自动发现。一个模块可以导出多个示例，每个示例拥有独立 Frame 和 Model。布局只提供自身容器和示例路由状态，未启动整套阅读器路由。

```sh
cd jiezi
npm ci
npm run dev -- --adapter xiaoxunrss --source /path/to/xiaoxunrss
# http://127.0.0.1:39980

npm run dev -- --adapter xiaoxunrss --source /path/to/xiaoxunrss --port 39980
npm run build -- --adapter xiaoxunrss --source /path/to/xiaoxunrss
# 集成测试从 project.json 读取 xiaoxunrss 的绝对路径
npm run test:integration
```

业务项目也需要安装自己的依赖。源码和适配器修改后自动重建，刷新查看；适配器配置或服务脚本改变后重启服务。产物保存在 `dist/xiaoxunrss-<source-hash>/`，构建成功后原子替换。

也可先在芥子运行 `npm run dev`，再从顶部「添加项目」选择「小讯 · Timeless」，填写业务项目的本机绝对目录。打开流程沿用显式 `--source` 的构建入口，检查资源后切换画布与源码监听；失败时保留原项目。已添加项目可通过顶部下拉框切换，列表在重启后保留。同一服务当前打开的项目由所有标签页共享，切换后其他标签页需刷新。

## 添加页面或组件预览

在视图实现文件旁创建同名 `.frame` 文件（如 `login.js` → `login.frame`），内容仍是 JavaScript。在其中导入业务 View，单独导出 `_Preview` 数组字面量。每项的 `render()` 同步、无必填参数，使用真实页面 / 组件，显式构造它需要的 props 和 children。`name` 和 `path` 必须显式声明为非空静态字符串。`path` 是目录树与 Frame 的唯一 ID，`name` 只控制显示名称。

同样支持 `export const _Previews = [...]`；同一模块二者选一。每项可设置 `width`、`height`（正数，单位为 CSS 像素），例如桌面 `1200 × 800`、手机 `390 × 844`。主画布与详情初始尺寸均采用声明值；详情的宽度切换保留声明高度。

```js
// button.frame
import { Button } from "./button.js";

export const _Preview = [
  {
    name: "主要按钮",
    path: "/frui/button/1",
    render() {
      return Button({ variant: "primary", attributes: { n: "canvas-add-subscription" } }, ["添加订阅"]);
    },
  },
  {
    name: "禁用按钮",
    path: "/frui/button/2",
    render() {
      return Button({ disabled: true, attributes: { n: "canvas-disabled-button" } }, ["添加订阅"]);
    },
  },
];
```

有状态页面复用业务 Model，在 `xiaoxunrss/frontend/src/canvas/` 中构造示例依赖；视图只组装 props，不实现业务状态。

`ReaderPreviewModel` 的 `props.view` 使用真实的 `kit.RouteViewCore`；示例可传入 `view: new kit.RouteViewCore({ name, pathname, title, query })`，在 `.frame` 中明确声明路由上下文。页面通过 `props.view.query` 读取参数，例如后台队列的 `{ tab: "download" }` 对应 `/queue?tab=download`，编辑流程的 `{ id: "new", template: "rule" }` 对应 `/flow-edit?id=new&template=rule`。Frame 卸载时清理路由实例、Presence 定时器与事件。

```js
// login.frame
import { LoginPage } from "./login.js";
import { LoginPreviewModel } from "@/canvas/login.model.js";
import { preview_view } from "@/canvas/view.js";

export const _Preview = [
  {
    name: "登录",
    path: "/login/1",
    render() {
      const model = LoginPreviewModel();
      return preview_view(model, props => LoginPage(props));
    },
  },
  {
    name: "密码错误",
    path: "/login/2",
    render() {
      const model = LoginPreviewModel({ password_error: true });
      return preview_view(model, props => LoginPage(props));
    },
  },
];
```

`ReaderPreviewModel` 注入独立的内存 `HttpClient`、身份、存储、媒体 provider 和示例数据，复用真实阅读器 Model。基础表单有更小的 `ControlPreviewModel`、`FormPreviewModel`；大模型预览复用独立设置切片。各实例互不影响；`preview_view` 在子视图销毁后释放 Model，构造失败也会清理。

所有业务副作用通过 props 中的 mock 能力执行。不会创建浏览器业务 provider、请求真实 API、播放远端媒体或写账号存储。未声明的模拟接口会明确报错，需要新交互时在预览 Model 中增加对应行为；不回退到真实网络。部分功能展示真实空状态；插件沙箱和媒体解密不在白板中启动。

`_Preview` 必须单独声明。业务 `.js` 不导入 `.frame` 或示例依赖；生产构建无需剥离代码，依赖检查拒绝任何 `.frame` 或 `canvas/` 示例进入生产包。纯 Model、工具、控制器和纯转导出模块不单独登记；组件不得反向 import 页面。

## 加载与生命周期

小讯适配器扫描 `frontend/src/pages/`、`frontend/src/components/` 和各插件的 `frontend/`，只扫描 `.frame` 文件，通过 AST 读取显式导出的 `_Preview` / `_Previews`。扫描不执行业务代码或 render，也不接受 getter、spread、动态元数据、异步 render、缺少 name/path 或重复 path。构建生成按模块去重的字面量动态 import 注册表。新增预览无需修改白名单或手写 import 表。

Frame 按需加载模块，加载结束后检查取消信号、示例名称和 path，再调用对应项的 `render()` 和 Timeless DOM renderer。同模块各示例独立挂载、独立清理；声明与旧目录不一致时提示刷新。每个 Frame 使用 Timeless ErrorBoundary，接收条件渲染、懒加载及挂载生命周期错误；错误时清理当前实例，在 Frame 内显示来源文件、错误消息与堆栈，其他 Frame 继续展示。销毁后的迟到错误会被忽略。低缩放比例显示摘要，同屏最多挂载 8 个真实视图。

每个 Frame 有开放的 ShadowRoot。业务 CSS 的 `:root` 转为 `:host`，`body` 选择器保留原样，不套用到预览容器；纯宽度媒体查询转为容器查询，指针类型查询保留原意。明暗主题同步到各宿主。

frui 通过 Timeless Scope 捕获当前 Frame 的宿主。Modal、Dialog、Select 和菜单使用 Frame 内的 Portal，浮层矩形转换到 Frame 坐标；页面不覆盖全局 host。点击 Frame 进入 `/project/:uid/frame/:frame_id`（Frame 路径整体编码）时复用已挂载实例，在同一画板中放大展示；预览继续禁用业务交互，标题、源码和节点检查工具以固定浮层展示。

## 路径目录树与画布分组

每个示例必须声明 `name` 和 `path`，`parent` 已移除。`path` 是相对于预览目录根的绝对目录路径，与业务 URL、源码文件位置无关；`/` 分隔层级，必须全局唯一，不接受空段、尾斜杠、`.`、`..`、query 或 hash。多个不同路径可以使用相同的显示名称。调整数组顺序、移动源码文件或修改 name 都不改变 Frame ID；修改 path 会生成新身份。

例如后台队列的两个示例：

```js
// background-queue.frame，实际 render 中各自创建 Model 与真实 RouteViewCore
export const _Preview = [
  { name: "后台队列", path: "/background-queue/1", render() { /* 返回默认队列页面 */ } },
  { name: "文件下载", path: "/background-queue/2", render() { /* 返回 query.tab=download 的页面 */ } },
];
```

子组件声明 `{ name: "任务详情", path: "/background-queue/components/1", render() { /* 返回真实组件 */ } }`。目录树自动生成 `/background-queue` 和 `/background-queue/components` 文件夹，两个页面示例互为同级，子组件归入 components 文件夹。目录节点也用完整 path 作为 ID；文件夹没有 render，不创建额外 Frame。同一个路径若导出了 Frame，仍可拥有更深的子路径。

画布按**顶层目录**分组，以上三个 Frame 都属于 `/background-queue` 组。独立组件可放在 `/components/...`，frui 可放在 `/frui/...`。路径是唯一层级来源，不推断 import 归属或按模块强行合组。

目录使用独立 Model，支持展开 / 收起、方向键、Home / End、单击定位、双击或 Enter 打开详情。搜索按 name、path、源码路径和路由匹配并保留祖先文件夹；搜索目录会展示其子树，清空搜索恢复原展开状态。默认「页面」筛选保留含页面的顶层目录及其组件；「组件」筛选保留组件与目录上下文。详情中的父子目录支持跳转。

组顺序及组内 Frame 顺序采用目录树的完整前序遍历，同级按显示名称排序；每行从左到右，换行后从上到下。折叠目录不改变画布排列。组边界随拖动、搜索和筛选更新；「重新排列」恢复树顺序。布局按项目和 path 保存，使用 v4 存储键；旧布局数据保留，新路径首次使用默认排列。

每项可声明正数 `width`、`height` 指定 Frame 尺寸。响应式断点按 Frame 宽度判断；如阅读器菜单声明 `width: 1200, height: 800`，并在 render 中补上真实页面的 88px Grid 侧栏父容器。声明 height 的预览填满 Frame 高度；详情中切换到 390px 仍展示业务的移动布局。

## 操作与节点框选

总览和详情中的 Frame 内容均仅展示，禁用业务鼠标和键盘交互；详情支持画板平移、缩放及点选 / 框选节点。

- 空白处拖动 / 滚轮平移；空格拖动可在 Frame 上平移。
- Ctrl / ⌘ + 滚轮或底部按钮缩放；`F` 适应画布。
- 拖动 Frame 标题移动，点击 Frame、双击目录或按 Enter 打开详情。
- 详情切换 1200 / 768 / 390px 宽度，查看源码。
- 在详情按住 Alt / Option 点击或拖动，或启用「选择节点」点选 / 框选实际 DOM。
- Esc 清除选区或退出框选，再按一次关闭详情。

选择结果包含入口文件、节点语义、相对选择器、文本、尺寸、HTML 和节点源码位置，可复制 JSON 或打印 Element。支持开放的嵌套 ShadowRoot；` >>> ` 表示进入 ShadowRoot，不是原生 CSS 运算符。最多输出 200 个节点，文本限 240 字符、HTML 限 20,000 字符，截断明确标记。

源码位置由芥子统一编译追踪，再通过 Timeless 视图与 DOM 的绑定记录，不依赖 attributes 配置。面板展示相对于 `--source` 的 `file:line:column`，行列从 1 开始；JSON 的 `source` 包含 `{ file, line, column }`，`source_details` 包含声明范围和使用位置。循环实例共享声明位置，不按语义名称猜测来源。未追踪的运行时内部节点显示「未记录源码位置」，`source` 为 `null`。这里只显示位置，不调用编辑器服务，详见[统一追踪说明](../../README.md#节点源码追踪)。

## 接入其他项目

`adapters/<id>/adapter.mjs` 返回项目 ID、标题、源码根、运行时脚本、样式、静态资产、esbuild 插件、监听目录、构建入口和 `catalog()`。目录条目提供 `id === path`、显式 name、`kind: 'page' | 'component'`、标题、来源、`preview: 'direct' | 'source'` 和可选的 `layout: 'fill'`。

渲染入口导出 `mount(frame, root, { signal, on_error })`，可同步或异步返回清理函数。首次加载、渲染失败可抛出异常；挂载后的渲染错误通过 on_error 回传。白板核心不 import 业务框架。小讯的注册表生成与 Timeless 宿主处理保留在项目适配器中。

## 验证范围

`npm run test:integration` 从根目录 `project.json` 读取小讯项目的绝对路径，使用实际 Timeless Core / DOM / Web 运行时和 Node DOM 模型，覆盖全部示例挂载与销毁、多示例隔离、登录错误状态、内存传输、浮层作用域、加载取消、错误处理、主题、CSS 转换、节点框选和静态服务边界。目录与布局测试覆盖声明校验、路径 ID、重复路径 / 无效元数据、自动文件夹、顶层目录分组、组内多层组件、动态边界、搜索祖先保留、折叠恢复、键盘导航与树节点语义。测试禁止预览调用真实 fetch。

这些测试不启动浏览器、不执行布局引擎。实际排版、焦点、媒体、缩放时浮层位置与滚动裁切仍需手动验收；Node 中显式矩形检查只验证坐标换算。按小讯项目约定，不自动化浏览器。
