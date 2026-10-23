<p align="center" data-n="readme-brand">
  <img src="src/logo.svg" width="72" height="72" alt="芥子 Logo：开放画框与金色芥子" data-n="readme-logo">
</p>

# 芥子 · jiezi

**把前端页面和组件，展开在同一张白板上。**

芥子是一个本地运行的前端预览与检查工具。将真实页面、组件和不同状态并排展示，在画布中浏览、比较、调整尺寸，再从 DOM 节点定位到源码。

[快速开始](#快速开始) · [使用白板](#使用白板) · [声明预览](#声明预览) · [使用指南](docs/guide.md)

![芥子白板预览：左侧为页面与组件目录，中间并排展示真实页面和弹窗，右侧展示 Frame 信息](docs/images/whiteboard.png)

*FindRSS 管理后台示例：26 个页面、21 个组件，展示 mock 数据、空状态和独立弹窗。*

![画布详情：选中搜索输入框，右侧展示节点源码预览与节点详情](docs/images/frame-detail.png)

*画布详情示例：选中搜索输入框，查看对应源码、节点语义标识与使用位置。*

## 能做什么

- **集中查看页面与组件**：按路径组织目录和画布分组，搜索名称、路径或源码文件。
- **在画布上比较状态**：拖动、平移、缩放，在页面、空状态和弹窗之间快速切换视线。
- **检查响应式布局**：进入 Frame 详情，切换 1200 / 768 / 390px 宽度，也可在声明中指定尺寸。
- **从界面追到源码**：点选、框选真实 DOM，查看节点信息与源码；点击源码行反向选择节点。
- **隔离预览环境**：每个 Frame 使用独立 ShadowRoot，支持浅色与深色主题，错误在各自 Frame 中展示。
- **管理多个本地项目**：通过适配器接入业务源码，保存项目清单、独立布局和可直接访问的 Frame 地址。

预览默认进入选择模式，用于展示和检查；详情工具栏可切换到交互模式，实际操作页面、输入和滚动，切换时保留页面状态。业务数据和依赖由适配器提供；内置示例可独立运行。

## 快速开始

需要 **Node.js 20+** 和 npm。在项目根目录运行：

```sh
npm ci
npm run dev
```

打开 [http://127.0.0.1:39980](http://127.0.0.1:39980)，即可看到内置的桌面首页、手机首页和计数器组件，无需配置外部项目。

源码变更后自动重建，刷新查看；也可点击「刷新画板」手动构建。修改适配器配置或服务脚本后需重启。服务只监听本机，不提供业务后端。

## 使用白板

| 操作 | 方式 |
| --- | --- |
| 平移画布 | 拖动空白处、滚轮，或按住空格拖动 |
| 缩放画布 | Ctrl / ⌘ + 滚轮，或底部缩放按钮 |
| 适应画布 | 按 `F` 或点击「适应画布」 |
| 移动 Frame | 拖动 Frame 标题 |
| 进入详情 | 双击 Frame 或目录条目；选中目录条目后按 Enter |
| 检查 DOM | 在详情中点选或框选；退出选择后可按 Alt / Option 临时选择 |
| 逐层退出 | 按 Esc 清除选区、退出选择、关闭源码面板或返回画板 |

详情中可切换设备宽度、查看源码和节点 JSON。「刷新」只更新画布内容，保留当前地址、视口和设备宽度；预览中的临时业务状态会重置。

更多行为见[画布操作](docs/guide.md#使用白板)和[源码追踪](docs/guide.md#节点源码追踪)。

## 声明预览

内置示例在 `examples/demo/views.frame` 中声明预览，文件内容是 JavaScript：

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

`name` 是展示名称，`path` 是唯一身份并决定目录层级；`render()` 返回视图或创建视图的工厂，每次挂载可创建独立 Model。扫描时只读取元数据，不执行模块或渲染函数。

这是内置适配器使用的声明方式；其他项目的扫描和挂载由各自适配器负责。详见[预览声明规范](docs/guide.md#声明预览)。

## 开发与验证

项目采用原生 JavaScript、Model / View 分离、esbuild 构建，以及基于 Node.js 的测试。新增节点应提供明确的 `data-n` 语义标识，白板样式使用 [tokens.css](src/tokens.css)。

```sh
npm test
npm run build
```

默认测试使用项目内示例、临时文件和 Node DOM 模型。内置构建输出位于 `dist/demo/`；外部项目按适配器与源码目录区分输出，构建成功后原子替换。`dist/` 与 `node_modules/` 不提交。

外部业务集成测试单独运行，从本机 `project.json` 读取对应适配器的首个项目：

| 命令 | 验证对象 |
| --- | --- |
| `npm run test:integration` | 小讯适配器 |
| `npm run test:admin` | FindRSS 管理后台 |
| `npm run test:wx` | Download & Manage |

测试不执行浏览器布局引擎，实际排版、焦点、媒体和滚动裁切需人工验收。当前源码追踪支持 JavaScript 编译输入，TS / JSX、第三方运行时生成节点等限制见[源码追踪说明](docs/guide.md#节点源码追踪)。

提交问题时请附上适配器类型、复现步骤和错误信息；修改代码后运行默认测试与构建。项目约定见 [AGENTS.md](AGENTS.md)。

---

文档结构参考 [Best-README-Template](https://github.com/othneildrew/Best-README-Template) 与 [GitHub README 指南](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)。
