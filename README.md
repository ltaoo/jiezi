# 芥子（jiezi）

把前端页面和组件展开在同一张白板上，直观浏览、比较和检查。支持路径目录树、拖动、缩放、搜索、主题、响应式尺寸切换和真实 DOM 节点框选。

这是独立项目。安装、默认构建、启动与单元测试只使用本目录和 npm 依赖，不需要任何相邻仓库。默认附带原生 DOM 示例：桌面首页、手机首页和独立计数器，每次挂载都有自己的 Model。

## 启动

需要 Node.js 20 或更新版本。

```sh
cd /path/to/jiezi
npm ci
npm run dev
# http://127.0.0.1:39980

npm run build
npm test
```

默认适配器为 `demo`，示例在 `examples/demo/`。源码变更后自动重建，刷新查看；适配器配置或服务脚本变更后需重启。静态产物在 `dist/<adapter-id>/`，成功后原子替换。服务只监听本机，不提供业务后端。

## 使用白板

- 空白处拖动或滚轮平移；空格拖动可在 Frame 上平移。
- Ctrl / ⌘ + 滚轮或底部按钮缩放；`F` 适应画布。
- 拖动 Frame 标题移动；双击标题、目录或按 Enter 打开详情。
- 详情切换 1200 / 768 / 390px 宽度，查看源码。
- 详情按住 Alt / Option 拖动，或点击「框选节点」，选择实际 DOM。
- Esc 清除选区或退出框选，再按一次关闭详情。

画布中的内容仅展示，进入详情后可交互。Frame 有独立的开放 ShadowRoot，业务 CSS 不影响白板。低缩放比例显示摘要，同屏最多挂载 8 个真实视图。加载失败和运行错误只显示在对应 Frame 内；卸载时取消加载并释放资源。

框选结果包含入口文件、节点语义、相对选择器、文本、尺寸与 HTML，可复制 JSON 或打印 Element。开放的嵌套 ShadowRoot 用 ` >>> ` 分隔路径；这不是原生 CSS 运算符。最多输出 200 个节点，文本限 240 字符、HTML 限 20,000 字符，截断明确标记。来源是 Frame 入口，尚未映射每个节点的源码行列。

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
    render() { return CounterView(CounterModel()); },
  },
];
```

也接受 `_Previews`；同一模块二者选一，单独声明数组字面量。`name` 和 `path` 必须是非空静态字符串；`width`、`height` 可选且必须为正数。`render()` 同步、无必填参数，在每次调用中创建独立 Model 和 View。元数据通过 AST 读取，扫描不执行模块或 render。

`path` 是目录树与 Frame 的唯一身份，与业务 URL 和源码位置无关。`/` 分隔层级，必须全局唯一，不接受空段、尾斜杠、`.`、`..`、query 或 hash。改名或调整数组顺序不会改变身份；修改 path 会产生新身份。路径自动生成文件夹，画布按顶层目录分组。目录与画布按树的前序遍历排列，折叠不改变顺序。搜索匹配名称、路径和源码路径，并保留祖先目录。

布局按项目和 path 存储在浏览器本地。保留历史 `frontend-agent:<project-id>:layout:v4` 键，以继续读取已有画布位置。

## 接入业务项目

通过适配器接入框架和业务源码，不在白板核心中导入业务代码。已有的[小讯适配器](adapters/xiaoxunrss/README.md)是可选接入，必须显式指定源码目录：

```sh
npm run dev -- --adapter xiaoxunrss --source /path/to/xiaoxunrss
npm run build -- --adapter xiaoxunrss --source /path/to/xiaoxunrss
```

外部项目自行安装它的依赖。芥子不会猜测相邻目录，也不会使用外部项目的 esbuild 替代自己的依赖。

新增适配器放在 `adapters/<id>/adapter.mjs`，默认导出接收 `{ source }` 的工厂，返回：

- `id`、`title`、`source`、`logo`（SVG 文件路径）。
- `catalog()`：返回目录条目。条目包含 `id === path`、`name`、`title`、`kind: 'page' | 'component'`、`file`、`source`、`preview: 'direct' | 'source'` 和可选尺寸及 `layout: 'fill'`。
- `entry_points.adapter`：渲染模块入口；其他键可提供额外 esbuild 入口。
- 可选的 `runtime_scripts`、`stylesheets`、`assets: [{ from, to }]`、esbuild `plugins`、`watch` 目录和 `after_build(dist)`。

渲染模块导出 `mount(frame, root, { signal, on_error })`，可同步或异步返回清理函数。加载或渲染失败可抛出异常；挂载后的错误用 `on_error` 回传。需要异步加载的适配器应在加载结束后检查 signal，销毁后的迟到结果不能再挂载。

业务状态由 Model 维护，View 只渲染并调用 Model 方法。动态节点带明确的 `data-n`，使节点框选结果可读。示例不访问真实账号数据或后端，业务样式保留在 Frame 的 ShadowRoot 内。

## 验证

`npm test` 使用项目内示例、临时文件和 Node DOM 模型，覆盖目录声明校验、分组与排列、搜索、键盘导航、拖动、缩放、布局存储、挂载与销毁、错误隔离、主题、节点框选和静态服务边界。内置示例测试同时检查打包输入均在本项目内。

外部业务集成测试单独运行：

```sh
JIEZI_TEST_SOURCE=/path/to/xiaoxunrss npm run test:integration
```

这些测试不启动浏览器，不执行布局引擎。实际排版、焦点、媒体、缩放时浮层位置与滚动裁切由人工验收。
