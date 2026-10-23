import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { collect_admin_catalog, admin_entry, components, pages } from '../adapters/findrss-admin/catalog.mjs';
import { CatalogTreeModel } from '../src/catalog-tree.model.js';
import { AdminPreviewModel } from '../adapters/findrss-admin/preview.model.js';

test('预览可直接返回页面函数、组件实例或带参数工厂，自动注入上下文', async () => {
  const overview = `function Page(props) {
  const node = document.createElement('section'); node.dataset.n = 'preview-page'; node.props = props; return node;
}
export const _Preview = [
  { path: '/direct', render() { return Page; } },
  { path: '/component', render() { const node = document.createElement('button'); node.dataset.n = 'preview-component'; return node; } },
  { path: '/factory', render() { return props => Page({ ...props, model: 'custom-model' }); } },
  { path: '/failure', render() { return () => { throw new Error('页面创建失败'); }; } },
];`;
  const catalog = ['pages/overview.frame', 'pages/login.frame', 'components/nested/select.frame'].map(file => ({ file }));
  const result = await build({ stdin: { contents: admin_entry(catalog), loader: 'js', resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'iife', globalName: 'preview', plugins: [{ name: 'admin-preview-return-fixture', setup(builder) {
    builder.onResolve({ filter: /^@admin\// }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
      let contents = '';
      if (args.path === '@admin/components/ui.js') contents = 'window.FindRSSAdminUI = {};';
      else if (args.path === '@admin/pages/overview.frame') contents = overview;
      else if (args.path.endsWith('/login.frame')) contents = `export const _Preview = [{ path: '/login', render() { return () => document.createElement('main'); } }];`;
      else if (args.path === '@admin/components/nested/select.frame') contents = `export const _Previews = [
  { path: '/component/select/1', render() { return () => document.createElement('select'); } },
  { path: '/component/select/2', render() { return document.createElement('button'); } },
];`;
      else if (args.path.endsWith('.frame')) contents = 'export const _Preview = [];';
      else if (args.path === '@admin/store.js') contents = `if (!window.FindRSSAdminUI) throw new Error('页面初始化前必须加载 UI');
export const navigation = ['overview'];
export function create_admin_routing(kit, components) {
  return { views: components, history: { views: {}, push(name) { routes.push(name); this.views[name] = { name }; } } };
}`;
      else {
        const names = pages.filter(([, module]) => args.path === '@admin/pages/' + module + '.js').map(([, , exported]) => exported);
        if (args.path.endsWith('/checkbox.js')) names.push('Checkbox');
        if (args.path.endsWith('/icon-button.js')) names.push('IconButton');
        contents = names.map(name => `export function ${name}() {}`).join('\n');
      }
      return { contents, loader: 'js' };
    });
  } }] });
  const { document } = parseHTML('<html><body></body></html>');
  const runtime = { document, window: {}, kit: {}, routes: [] };
  vm.runInNewContext(result.outputFiles[0].text, runtime);
  const render = (preview_index, path) => runtime.preview.render({ file: 'pages/overview.frame', key: 'Overview', kind: 'page', route_name: 'overview', preview_index, path });
  const page = render(0, '/direct');
  assert.equal(page.tagName, 'SECTION');
  assert.equal(page.props.view.name, 'root.admin.overview');
  assert.equal(page.props.history, runtime.window.preview_routing.history);
  assert.equal(page.props.app.navigation[0], 'overview');
  assert.equal(render(1, '/component').tagName, 'BUTTON');
  const factory = render(2, '/factory');
  assert.equal(factory.props.model, 'custom-model');
  assert.notEqual(factory.props.history, page.props.history);
  assert.equal(runtime.routes.length, 2);
  assert.equal(runtime.preview.render({ file: 'pages/login.frame', key: 'Login', route_name: 'login', preview_index: 0, path: '/login' }).tagName, 'MAIN');
  for (const [preview_index, tag] of ['SELECT', 'BUTTON'].entries()) {
    assert.equal(runtime.preview.render({ file: 'components/nested/select.frame', kind: 'component', preview_index, path: `/component/select/${preview_index + 1}` }).tagName, tag);
  }
  assert.equal(runtime.routes.length, 2);
  assert.throws(() => render(3, '/failure'), /页面创建失败/);
  assert.throws(() => render(0, '/changed'), /页面预览已变化/);
});

test('管理后台预览请求和存储在内存中隔离，未知操作不会回退到真实服务', async () => {
  const first = AdminPreviewModel(), second = AdminPreviewModel();
  const path = '/admin/api/settings/webhook';
  try {
    first.storage.setItem('token', 'preview');
    assert.equal(second.storage.getItem('token'), null);
    await first.fetch(path, { method: 'PUT', body: JSON.stringify({ url: 'https://example.invalid/hooks' }) });
    assert.equal((await (await first.fetch(path)).json()).url, 'https://example.invalid/hooks');
    assert.equal((await (await second.fetch(path)).json()).url, '');
    assert.equal((await first.fetch('https://example.invalid/admin/api/overview')).status, 501);
    assert.equal((await first.fetch('/admin/api/not-defined')).status, 501);
    assert.equal((await first.fetch('/admin/api/background-tasks', { method: 'DELETE' })).status, 501);
    await assert.rejects(first.fetch(path, { signal: AbortSignal.abort() }), error => error.name === 'AbortError');
    await assert.rejects(first.login('real password'), /preview/);
    first.destroy();
    assert.equal((await first.fetch(path)).status, 410);
  } finally { first.destroy(); second.destroy(); }
});

test('并发请求页使用内存握手，启动真实任务时明确提示，销毁后关闭连接', async () => {
  const model = AdminPreviewModel(), messages = [];
  const socket = model.socket('wss://preview.invalid/admin/api/loadtest/ws');
  socket.onopen = () => socket.send('{"type":"hello"}');
  socket.onmessage = event => messages.push(JSON.parse(event.data));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(socket.readyState, 1);
  assert.deepEqual(messages[0].sources, []);
  socket.send('{"type":"start"}');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(messages.at(-1).error, /不执行真实并发任务/);
  model.destroy();
  assert.equal(socket.readyState, 3);
});


test('从业务页面旁读取独立 frame，保留画板身份和后台路由', async () => {
  const source = await mkdtemp(join(tmpdir(), 'jiezi-admin-catalog-'));
  try {
    for (const [, , , name, route_name] of pages) {
      const file = `pages/${route_name.replaceAll('.', '/').replaceAll('_', '-')}.frame`;
      const path = `/${route_name.replaceAll('.', '-').replaceAll('_', '-')}/1`;
      const previews = [{ name, path, order: pages.findIndex(page => page[4] === route_name), width: 1200, height: 800 }];
      if (route_name === 'discovery') previews.push(
        { name: '空状态', path: '/discovery/2', width: 1200, height: 800 },
        { name: '新增订阅源', path: '/discovery/components/create-source/1', width: 1000, height: 900 },
      );
      await mkdir(dirname(join(source, file)), { recursive: true });
      await writeFile(join(source, file), `export const _Preview = [${previews.map(preview => JSON.stringify(preview).replace(/}$/, ', render() {} }')).join(',')}];`);
    }
    for (const [key] of components) {
      const module = key === 'empty' ? 'components/illustration-card.js' : `components/frui/${key}.js`;
      const path = join(source, module);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, '// local fixture');
    }
    const catalog = await collect_admin_catalog(source);
    for (const frame of catalog.filter(frame => frame.file.endsWith('.frame'))) assert.ok(admin_entry(catalog).includes(JSON.stringify('@admin/' + frame.file)));
    assert.deepEqual(CatalogTreeModel(catalog).groups().map(group => group.id), [
      ...pages.map(([, , , , route_name]) => '/' + route_name.replaceAll('.', '-').replaceAll('_', '-')), '/frui',
    ]);
    const page_frames = catalog.filter(frame => frame.kind === 'page');
    assert.equal(new Set(page_frames.map(frame => frame.file)).size, pages.length);
    assert.equal(new Set(page_frames.map(frame => frame.id)).size, page_frames.length);
    const groups = CatalogTreeModel(catalog).groups().filter(group => group.page);
    assert.equal(groups.length, pages.length);
    for (const group of groups) {
      assert.equal(new Set(group.frames.map(frame => frame.route)).size, 1);
      assert.ok(group.frames.every(frame => frame.route.startsWith('/admin/') && frame.file.endsWith('.frame') && !frame.path.startsWith('/admin/')));
    }
    const discovery = groups.find(group => group.id === '/discovery');
    assert.deepEqual(discovery.frames.filter(frame => frame.kind === 'page').map(frame => frame.path).sort(), ['/discovery/1', '/discovery/2']);
    const create_source = discovery.frames.find(frame => frame.path === '/discovery/components/create-source/1');
    assert.equal(create_source.kind, 'component');
    assert.equal(create_source.layout, 'fill');
    assert.equal(create_source.height, 900);
    assert.equal(create_source.file, 'pages/discovery.frame');
    assert.equal(catalog.find(frame => frame.path === '/settings-mcp-tokens/1').file, 'pages/settings/mcp-tokens.frame');
    const tree = CatalogTreeModel(catalog);
    assert.ok(tree.rows().some(row => row.frame?.id === create_source.id));
    tree.update('', 'component');
    assert.ok(tree.rows().some(row => row.frame?.id === create_source.id));
    assert.ok(page_frames.some(frame => frame.path === '/settings-device-tokens/1' && frame.route === '/admin/settings/device-tokens'));
    await mkdir(join(source, 'components/nested'), { recursive: true });
    const component_file = join(source, 'components/nested/discovery_platform.frame');
    await writeFile(component_file, `export const _Previews = [
      { name: '来源 Select', path: '/component/discovery_platform/1', width: 360, height: 600, render() {} },
      { name: '选中内容', path: '/component/discovery_platform/2', width: 360, height: 180, render() {} },
    ];`);
    const discovered = await collect_admin_catalog(source);
    const selects = discovered.filter(frame => frame.file === 'components/nested/discovery_platform.frame');
    assert.equal(selects.length, 2);
    assert.ok(selects.every(frame => frame.kind === 'component' && !frame.route_name));
    assert.deepEqual(selects.map(frame => frame.height), [600, 180]);
    assert.ok(admin_entry(discovered).includes(JSON.stringify('@admin/components/nested/discovery_platform.frame')));
    const component_tree = CatalogTreeModel(discovered);
    component_tree.update('', 'component');
    assert.ok(component_tree.rows().some(row => row.frame?.path === '/component/discovery_platform/1'));
    await writeFile(component_file, `export const _Preview = [{ name: '重复', path: '/frui/button/1', render() {} }];`);
    await assert.rejects(collect_admin_catalog(source), /重复 path/);
    await rm(component_file);
    await writeFile(join(source, 'pages/overview.frame'), 'export const _Preview = [{ name: "运行概览", path: "/overview/1", width: 1440, height: 2400, render() {} }];');
    const updated = (await collect_admin_catalog(source)).find(frame => frame.path === '/overview/1');
    assert.equal(updated.width, 1440); assert.equal(updated.height, 2400);
    await rm(join(source, 'pages/overview.frame'));
    const removed = await collect_admin_catalog(source);
    assert.ok(!removed.some(frame => frame.file === 'pages/overview.frame'));
    assert.ok(!admin_entry(removed).includes('@admin/pages/overview.frame'));
  } finally { await rm(source, { recursive: true, force: true }); }
});

test('订阅源 mock 与空状态的数据各自隔离', async () => {
  const populated = AdminPreviewModel(), empty = AdminPreviewModel({ empty: true });
  try {
    const data = await (await populated.fetch('/admin/api/discovery/sources?limit=20')).json();
    const blank = await (await empty.fetch('/admin/api/discovery/sources?limit=20')).json();
    assert.equal(data.sources.length, 2);
    assert.equal(data.total_count, data.sources.length);
    assert.equal(data.sources[0].title, '科技日报');
    assert.deepEqual(blank.sources, []);
    assert.equal(blank.total_count, 0);
  } finally { populated.destroy(); empty.destroy(); }
});
