# 使用指南

[返回项目首页](../README.md)

## 构建与启动

默认适配器为 `demo`，示例在 `examples/demo/`。源码变更后自动重建，刷新查看；适配器配置或服务脚本变更后需重启。内置产物在 `dist/demo/`，外部项目在 `dist/<adapter-id>-<source-hash>/`，成功后原子替换。服务只监听本机，不提供业务后端。

## 管理项目

开发服务中，点击顶部「添加项目」，选择项目类型并填写本机绝对目录。支持小讯项目根目录、[FindRSS 管理后台](../adapters/findrss-admin/README.md)的 `admin/` 目录，以及 [Download & Manage](../adapters/wx-channels/README.md) 的 `frontend/` 目录。服务显式以该目录作为 `--source`，检查项目结构、依赖和运行时资源后构建；成功时刷新进入新画布，顶部显示页面与组件数量，源码监听同步切换。构建失败保留当前项目，弹窗显示文件与错误，可修改目录重试。选择「原生 DOM 示例」并留空目录可返回内置示例。

已添加项目保存在根目录的本机 `project.json`（不入 Git），每项有持久化的唯一 `id`；旧清单缺少 ID 时自动生成并保存，重复打开、重新构建和重启均沿用 ID。顶部下拉框切换后进入 `/project/:uid`，其中 `uid` 为清单中的 `id`；相同项目类型和目录只登记一次，失败的项目不加入列表。直接访问项目或 Frame 地址时，开发服务自动打开对应项目；访问 `/` 则进入服务当前打开的项目（启动时由命令行参数指定）。项目目录移走后可更新清单中的 `source`，保留 `id` 即可保留链接。也可手动编辑清单后重启服务，`source` 必须填写绝对路径：

```json
[
  { "adapter": "findrss-admin", "title": "FindRSS 管理后台", "source": "/path/to/findrss-worker/admin" },
  { "adapter": "wx-channels", "title": "Download & Manage", "source": "/path/to/wx_channels_download/frontend" }
]
```

每个开发服务同一时间打开一个项目，切换会影响该服务的其他标签页，其他标签页需刷新。构建产物和布局按项目类型与源码目录分别保存；内置示例沿用原存储键。静态构建产物可浏览已有画布；添加与切换项目需要 `npm run dev` 的本地服务。

修改源码后可点击顶部「刷新画板」，或详情页标题栏中的「刷新」，手动重新构建当前项目。详情刷新只替换画布内容并更新目录、源码和样式，不刷新整页，保留 Frame 地址、画布位置、缩放及设备宽度；旧节点选择会清除，预览中的临时业务状态会重置。构建或资源加载失败时保留原画布并显示错误，可修复源码后重试。刷新需要 `npm run dev` 的本地服务。

## 使用白板

- 空白处拖动或滚轮平移；空格拖动可在 Frame 上平移。
- Ctrl / ⌘ + 滚轮或底部按钮缩放；`F` 适应画布。
- 拖动 Frame 标题移动；单击 Frame 选中，双击 Frame、双击目录或按 Enter 进入 `/project/:uid/frame/:frame_id` 详情路由，Frame 的完整路径用 `encodeURIComponent` 编码，支持直接打开、刷新和浏览器前进 / 后退。
- 详情仍在点阵画板中渲染当前 Frame，可平移、缩放及切换 1200 / 768 / 390px 宽度；标题、目录路径和检查工具固定浮在画板上。
- 详情默认进入「选择模式」，可直接点选 / 框选实际 DOM；点击模式按钮可切换到「交互模式」，实际操作页面、输入和滚动。按 Esc 也可退出选择，交互模式仍可按住 Alt / Option 临时选择。
- Esc 先清除选区或退出框选，再关闭已打开的源码面板，最后返回画板。

总览和详情选择模式使用 `pointer-events: none` 和 `inert` 屏蔽业务鼠标及键盘交互；交互模式解除屏蔽，预览内的左键操作和普通滚轮交给业务页面，空白处或鼠标中键仍可拖动画板，Ctrl / ⌘ + 滚轮仍可缩放。切换到交互模式会清除选区和选择浮层。详情复用已挂载的页面实例，切换模式保留业务状态；查看源码、选择节点和节点详情使用独立固定浮层，不替换页面或挤压预览宽度；返回时恢复原画板视口。Frame 有独立的开放 ShadowRoot，业务 CSS 不影响白板。总览中低缩放比例显示摘要，同屏最多挂载 8 个真实视图；详情持续保留当前 Frame 的真实视图。加载失败和运行错误只显示在对应 Frame 内；卸载时取消加载并释放资源。

框选优先选择完整包围的可见子树；没有完整节点时才选边界相交的最深节点，并通过实际命中测试排除被遮挡的内容，避免遮罩和底层节点把共同父节点扩大到整页。选择结果包含入口文件、节点语义、相对选择器、文本、尺寸、HTML 和节点源码位置，在节点详情中展示 JSON。开放的嵌套 ShadowRoot 用 ` >>> ` 分隔路径；这不是原生 CSS 运算符。最多输出 200 个节点，文本限 240 字符、HTML 限 20,000 字符，截断明确标记。

单选展示节点自身的源码位置；多选统一展示最近公共父节点的源码行，跨开放 ShadowRoot 沿宿主链查找，范围不超出当前预览。父节点未注入位置时明确提示，不继续向上猜测。节点 JSON 的 `parent` 保存公共父节点的选择器与源码位置，各 `nodes[].source` 仍保留节点自身的来源；公共父节点在节点列表截断前计算。

## 声明预览

内置示例使用 `.frame` 文件，内容是 JavaScript：

```js
import { CounterModel } from './counter.model.js';
import { CounterView } from './views.js';

export const _Preview = [
  {
    name: '计数器',
    path: '/home/components/counter',
    width: 390,
    height: 500,
    render() { return () => CounterView(CounterModel()); },
  },
];
```

也接受 `_Previews`；同一模块二者选一，单独声明数组字面量。`name` 和 `path` 必须是非空静态字符串；`width`、`height` 可选且必须为正数。`render()` 同步、无必填参数，可直接返回页面/组件函数，或返回创建 Model 和 View 的工厂函数；每次挂载都会调用返回的函数，创建独立实例。也可以直接返回视图实例。元数据通过 AST 读取，扫描不执行模块或 render。

每个预览可独立设置 Frame 宽高，单位为 CSS 像素。例如内容较多的页面可在条目中设置 `width: 1200, height: 1800`，画板和详情页都会使用该尺寸；高度足以容纳内容（含内边距）时，预览容器不会出现纵向滚动条。详情页切换设备宽度仍保留声明的高度。省略尺寸时，默认页面为 1200 × 800、组件为 520 × 360，适配器可提供自己的默认值。页面内部自行限制高度的滚动区域仍由业务样式控制。

预览样式表属性值中的 `vh` / `vw` / `vmin` / `vmax`（含 `sv*`、`lv*`、`dv*`）按 Frame 的 CSS 尺寸计算，画布缩放不改变计算结果。例如 Frame 高度为 800px 时，`max-height: 85vh` 为 680px；详情切换宽度会同步更新宽度单位。样式表在构建时转换，运行时新增节点及行内 `style` 的变化由各 Frame 独立监听并转换，包含自定义属性中的视口单位；卸载时停止监听。

`path` 是目录树与 Frame 的唯一身份，与业务 URL 和源码位置无关。`/` 分隔层级，必须全局唯一，不接受空段、尾斜杠、`.`、`..`、query 或 hash。改名或调整数组顺序不会改变身份；修改 path 会产生新身份。路径自动生成文件夹，画布按顶层目录分组。目录与画布按树的前序遍历排列，折叠不改变顺序。搜索匹配名称、路径和源码路径，并保留祖先目录。

布局按项目和 path 存储在浏览器本地。保留历史 `frontend-agent:<project-id>:layout:v4` 键，以继续读取已有画布位置。

## 编写适配器

通过适配器接入框架和业务源码，不在白板核心中导入业务代码。已有的[小讯适配器](../adapters/xiaoxunrss/README.md)是可选接入，必须显式指定源码目录：

```sh
npm run dev -- --adapter xiaoxunrss --source /path/to/xiaoxunrss
npm run build -- --adapter xiaoxunrss --source /path/to/xiaoxunrss
npm run dev -- --adapter findrss-admin --source /path/to/findrss-worker/admin
npm run dev -- --adapter wx-channels --source /path/to/wx_channels_download/frontend
```

外部项目自行安装它的依赖。芥子不会猜测相邻目录，也不会使用外部项目的 esbuild 替代自己的依赖。

新增适配器放在 `adapters/<id>/adapter.mjs`，默认导出接收 `{ source, bundle }` 的工厂，返回：

- `id`、`title`、`source`、`logo`（SVG 文件路径）。
- `catalog()`：返回目录条目。条目包含 `id === path`、`name`、`title`、`kind: 'page' | 'component'`、`file`、`source`、`preview: 'direct' | 'source'` 和可选尺寸及 `layout: 'fill'`。
- `entry_points.adapter`：渲染模块入口；其他键可提供额外 esbuild 入口。
- 可选的 `runtime_scripts`、`stylesheets`、`assets: [{ from, to }]`、esbuild `plugins`、`watch` 目录和 `after_build(dist)`。

渲染模块导出 `mount(frame, root, { signal, on_error })`，可同步或异步返回清理函数。加载或渲染失败可抛出异常；挂载后的错误用 `on_error` 回传。需要异步加载的适配器应在加载结束后检查 signal，销毁后的迟到结果不能再挂载。

业务状态由 Model 维护，View 只渲染并调用 Model 方法。动态节点带明确的 `data-n`，使节点框选结果可读。示例不访问真实账号数据或后端，业务样式保留在 Frame 的 ShadowRoot 内。

## 节点源码追踪

源码追踪由 `load_adapter()` 统一接入，项目适配器不再注入节点属性，也无需列举 DOM helper 或组件名称。源码根和适配器目录内的 `.js`、`.mjs`、`.frame`，包括自定义 loader 返回的模块，都经过同一编译过程；适配器需要子构建时使用工厂参数 `bundle()`，自动复用该过程。node_modules 与范围之外的文件不处理。

构建同时生成 `sources.json`，保存参与追踪的原始模块源码。选择节点后，节点详情展示完整文件，默认滚动到源码行并高亮，内嵌视口约显示目标行及前后各 5 行，可继续滚动或点击“弹窗查看”展开完整源码；多选时使用共同父节点的位置，切换父节点或退回时同步更新。预览对应当前构建快照，修改源码后刷新画板重新构建即可更新。

点击内嵌预览或弹窗中的源码行，可反向选择当前 Frame 内对应的已挂载节点。声明和调用位置均可匹配，多行调用优先选择覆盖该行的最具体范围，同一处源码生成的多个实例一起选择；视口外的节点会移到画布中央。成功选择后关闭源码弹窗，源码仍定位到点击行；没有对应节点时提示并保留原选择。

编译器在原始调用处记录文件、起止行列，运行时只追踪返回的原生 DOM 和 Timeless 视图。Timeless 的 `$elm` 赋值与渲染句柄的 render/hydrate 把来源绑定到实际 DOM；同一文档内通过共享 WeakMap 保存，不改变业务配置或添加 HTML 属性。无 attributes、配置变量、属性展开、包装组件、延迟回调、Portal 和开放 ShadowRoot 均不依赖额外项目适配。循环实例共享声明位置，节点重建时更新绑定。

单选展示节点声明位置及后续返回该节点/视图的调用位置；多选展示最近公共父节点的声明位置。JSON 的 `source` 保留 `{ file, line, column }`；`source_details.declaration` 额外提供 `end_line`、`end_column`，`usages` 记录使用位置。行列从 1 开始，路径相对源码根；适配器自身的预览源码使用 `adapters/<id>/` 前缀。仍兼容读取旧的 `data-jiezi-source` 标记。

当前编译输入是 JavaScript，不包含 TS/JSX 转译和 Source Map 链式还原。未知框架、未经过编译的第三方代码、运行时内部生成的节点以及 innerHTML 内容可能没有精确声明位置；查询到已有 DOM 不会被冒充为创建位置，也不借用祖先或 Frame 入口的位置。
