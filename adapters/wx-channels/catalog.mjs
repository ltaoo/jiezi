import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const pages = [
  ['download', 'downloadv2', '下载任务', 'root.shell.download'],
  ['scraper', 'scraper', '内容抓取', 'root.shell.scraper'],
  ['content', 'content', '内容管理', 'root.shell.content'],
  ['content-detail', 'content_detail', '内容详情', 'root.shell.content_detail'],
  ['browsehistory', 'browsehistory', '浏览记录', 'root.shell.browsehistory'],
  ['account', 'account', '帐号管理', 'root.shell.account'],
  ['automation', 'automation', '自动化', 'root.shell.automation'],
  ['automation-detail', 'automation_detail', 'Pipeline 详情', 'root.automation_detail'],
  ['automation-edit', 'automation_edit', '编辑 Pipeline', 'root.automation_edit'],
  ['sync', 'sync', '下载服务同步', 'root.shell.sync'],
  ['logs', 'logs', '日志', 'root.shell.logs'],
  ['filehelper', 'filehelper', '微信文件传输助手', 'root.filehelper'],
  ['preview', 'preview', '文件预览', 'root.preview'],
];

export const components = [
  ['button', '按钮', "Button({ store: new vm.ButtonCore({}), attributes: { n: 'preview-button' } }, ['新建任务'])"],
  ['input', '输入框', "Input({ store: new vm.InputCore({ defaultValue: '示例名称', placeholder: '输入名称' }), attributes: { n: 'preview-input', 'aria-label': '名称' } })"],
  ['checkbox', '复选框', "Checkbox({ store: new vm.CheckboxCore({ checked: true }), attributes: { n: 'preview-checkbox', 'aria-label': '启用' } })"],
  ['card', '卡片', "Card({ attributes: { n: 'preview-card' } }, [CardHeader({}, [CardTitle({}, ['下载任务'])]), CardContent({}, ['任务内容预览'])])"],
  ['badge', '标签', "Badge({ attributes: { n: 'preview-badge' } }, ['已完成'])"],
  ['progress', '进度条', "Progress({ store: new vm.ProgressCore({ value: 65 }), attributes: { n: 'preview-progress', 'aria-label': '下载进度' } })"],
  ['alert', '提示', "Alert({ attributes: { n: 'preview-alert' } }, [AlertTitle({}, ['提示']), AlertDescription({}, ['这里只展示示例数据。'])])"],
  ['empty', '空状态', "EmptyCard({ name: 'preview-empty', title: '暂无下载任务', description: '新建任务后会显示在这里。' })"],
];

export const shell_previews = [
  ['shell-layout', 'ShellLayoutView', 'shell.js', '/shell-layout', 'page'],
  ['settings-dialog', '设置弹窗', 'shell.components.js', '/shell-layout/settings', 'component'],
  ['settings-certificate', '证书设置内容', 'shell.components.js', '/shell-layout/settings/certificate', 'component'],
  ['settings-mcp', 'MCP 设置内容', 'shell.components.js', '/shell-layout/settings/mcp', 'component'],
  ['settings-about', '关于内容', 'shell.components.js', '/shell-layout/settings/about', 'component'],
];

export async function collect_catalog(source) {
  const entries = [
    ...pages.flatMap(([key, module, name, route]) => [
      { key, name, route, module: `src/pages/${module}.js`, path: `/${key}`, kind: 'page' },
      { key, name: `${name} · Mock 数据`, route, module: `src/pages/${module}.js`, path: `/${key}/mock`, kind: 'page', mock: true, query: { id: key === 'preview' ? 'mock-task' : 'mock-content', flow_id: 'mock-flow' } },
    ]),
    { key: 'content', name: '内容管理 · 卡片视图 · Mock 数据', route: 'root.shell.content', module: 'src/pages/content.js', path: '/content/card', kind: 'page', mock: true, content_layout: 'card' },
    ...components.map(([key, name]) => ({ key, name, module: 'src/dmui.js', path: `/dmui/${key}`, kind: 'component' })),
    ...shell_previews.map(([key, name, module, path, kind]) => ({ key, name, module: `src/pages/${module}`, path, kind, shell_preview: true, mock: true, width: 1200, height: 800, layout: 'fill' })),
  ];
  return Promise.all(entries.map(async entry => ({ ...entry, id: entry.path, title: entry.name, file: entry.module, source: await readFile(join(source, entry.module), 'utf8'), preview: 'direct', width: entry.width || (entry.kind === 'page' ? 1200 : 600), height: entry.height || (entry.kind === 'page' ? 800 : 420), layout: entry.layout || (entry.kind === 'page' ? 'fill' : 'content') })));
}

export function preview_entry() {
  return `import 'wx-preview-bootstrap';
import * as store from '@wx/src/store.js';
import { EmptyCard } from '@wx/src/dmui.js';
import { render_shell_preview } from 'wx-shell-preview';
${pages.map(([key, module], index) => `import Page${index} from ${JSON.stringify('@wx/src/pages/' + module + '.js')};`).join('\n')}
const pages = { ${pages.map(([key], index) => `${JSON.stringify(key)}: Page${index}`).join(', ')} };
export function render(frame) {
  if (frame.shell_preview) {
    store.history$.push('root.shell.download', {}, { ignore: true });
    const views = { ...store.router.views, ${pages.map(([key, , , route]) => `${JSON.stringify(route)}: pages[${JSON.stringify(key)}]`).join(', ')} };
    return render_shell_preview(frame, { app: store.app$, history: store.history$, view: store.history$.views['root.shell'], views, client: store.http_client$, storage: store.storage$, hlsPlayer: store.hls_player$, tip() {} });
  }
  if (frame.kind === 'component') {
    const renderers = { ${components.map(([key, , expression]) => `${JSON.stringify(key)}: () => (${expression})`).join(',\n')} };
    return View({ class: 'flex flex-col gap-4', attributes: { n: 'dmui-component-preview' } }, [renderers[frame.key]()]);
  }
  store.history$.push(frame.route, frame.query || {}, { ignore: true });
  return pages[frame.key]({ app: store.app$, history: store.history$, view: store.history$.views[frame.route], views: store.router.views, client: store.http_client$, storage: store.storage$, hlsPlayer: store.hls_player$, tip() {} });
}
export function destroy() {
  window.dl$?.destroy(); window.scraper$?.destroy();
  Object.values(store.history$.views).forEach(view => view.destroy?.());
  store.history$.destroy?.(); store.router$.destroy?.(); store.app$.destroy?.();
}
`;
}
