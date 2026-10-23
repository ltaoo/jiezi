# FindRSS 管理后台适配器

在芥子顶部点击「添加项目」，选择「FindRSS 管理后台」，目录填写业务仓库的 `admin/`。添加成功后，顶部下拉框可以在管理后台、小讯及其他已添加项目间切换。项目列表保存在芥子根目录的 `project.json`，不入 Git。

也可在芥子目录显式启动或构建：

```sh
npm run dev -- --adapter findrss-admin --source /path/to/findrss-worker/admin
npm run build -- --adapter findrss-admin --source /path/to/findrss-worker/admin
# 集成测试从 project.json 读取 findrss-admin 的绝对路径
npm run test:admin
```

业务仓库需要预先安装自己的依赖，保留 `public/brand/` 和 `public/assets/timeless/0.34.2/`。适配器只读取业务源码，使用芥子的 esbuild 构建，不启动 Worker、登录流程或业务开发服务。产物保存在 `dist/findrss-admin-<source-hash>/`，默认构建与测试仍只使用芥子内部文件。

适配器递归扫描显式 `--source` 目录中的 `.frame`，跳过 `node_modules/`、`.git/` 和 `dist/`，同时生成目录和渲染入口。预览可放在 `admin/pages/`、`admin/components/` 及其子目录，通过 `_Preview` 或 `_Previews` 声明，并以相对路径导入真实 View 与业务 Model；源码位置也相对于该目录。新增组件预览无需修改适配器，例如 `components/discovery_platform.frame` 中的两种状态会分别生成画板。`catalog.mjs` 保留后台路由上下文与内置 frui 示例的登记；已登记页面仍自动获得对应路由，新页面需要后台路由上下文时补充路由登记。

预览路径不带 `/admin`，每个预览各占一个画板；设置子页使用 `/settings-device-tokens/1` 这样的独立分组，实际后台路由仍为 `/admin/settings/device-tokens`。`/discovery/1` 展示 mock 订阅源，`/discovery/2` 展示空状态。`/discovery/components/create-source/1` 为「新增订阅源」页面组件预览，复用真实弹窗，默认展开，关闭后可重新打开；草稿与其他 Frame 隔离。每个预览可设置非负有限数 `order`，值越小越靠前；目录采用子项中最小的排序值，同值或未设置时按名称排序。后台页面声明排序，未设置排序值的组件放在页面后。节点位置在构建时注入，Alt / Option 点击节点可查看原始文件、行、列。

`render()` 可以直接返回页面函数，适配器自动提供路由上下文，无需导入或调用 `render_page`：

```js
import { OverviewPage } from './dashboard.js';

export const _Preview = [
  { name: '运行概览', path: '/overview/1', width: 1200, height: 800, render() { return OverviewPage; } },
];
```

需要自定义 Model 或参数时，可返回接收上下文的函数，例如 `render() { return props => ScriptPage({ ...props, store: ScriptPreviewModel() }); }`。组件也可以直接返回视图实例，例如 `render() { return ScriptEditorView({ store: ScriptPreviewModel() }); }`；此时参数由预览自行准备。登录页返回的函数直接调用，不创建后台路由。预览文件不再支持导入 `admin-preview-page` 或调用 `render_page`，页面路由由适配器统一提供。

旧后台通过全局对象组合 UI、认证及路由依赖，因此每个 Frame 独立初始化 Timeless Core、DOM renderer 和后台模块。DOM 查询、Portal、事件监听、计时器、存储和 API 由当前 Frame 的环境提供。页面样式在 ShadowRoot 内；路由点击不会离开画布，永久卸载时释放路由、页面和宿主资源。

预览 API 位于 `preview.model.js`，提供概览指标、任务示例、订阅源 mock / 空状态和设置初值。设置保存只修改当前 Frame 的内存数据；登录示例密码为 `preview`。并发请求页使用内存 WebSocket 握手，不执行真实并发任务。其他未提供的 API 交互返回明确提示，不回退到业务服务。

集成测试验证全部预览挂载、默认错误状态、源码位置、Portal 边界、状态隔离和卸载。浏览器排版、CodeMirror 编辑器测量与焦点行为由人工验收，不自动化浏览器。
