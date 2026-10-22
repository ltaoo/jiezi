# 芥子（jiezi）

独立的前端页面与组件白板。默认构建和测试只使用项目内文件，不得依赖相邻仓库、绝对本机路径或外部项目的 node_modules。

- 纯 JavaScript 保持 Model/View 分离；业务状态和逻辑由 Model 管理，View 只渲染并调用 Model 方法。
- HTML 和动态节点使用明确的 `data-n`；节点配置对象使用 `attributes: { n: '<用途>' }`。
- 白板样式使用 `src/tokens.css`，业务样式隔离在 Frame 的 ShadowRoot 中；滚动条贴住视觉容器内边缘。
- 外部业务项目只通过显式 `--source` 接入。对应集成测试单独运行，不能成为默认测试的前置条件。
- 不自动化浏览器。运行 `npm test` 和 `npm run build`，浏览器排版由人工验收。
- `dist/` 与 `node_modules/` 不提交；构建产物通过生成器更新。
