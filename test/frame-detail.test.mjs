import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { BoardModel } from '../src/board.model.js';
import { preview_declarations } from '../src/preview-declarations.mjs';
import { trace_source } from '../src/source-runtime.js';
import { project_url, frame_url, read_project_route } from '../src/project-route.js';

const catalog = [
  { id: '/home', path: '/home', name: '首页', title: '首页', kind: 'page', file: 'home.frame', source: 'export const home = true;', preview: 'direct', width: 1200, height: 800 },
  { id: '/controls/按钮 + 空格', path: '/controls/按钮 + 空格', name: '按钮', title: '按钮', kind: 'component', file: 'button.frame', source: 'export const button = true;', preview: 'direct', width: 520, height: 360 },
  { id: '/source', path: '/source', name: '源码', title: '源码', kind: 'page', file: 'source.frame', source: 'export const source = true;', preview: 'source' },
];

test('Frame 详情路由独立于筛选，宽度不改画板尺寸，返回时恢复画板视口', () => {
  const model = BoardModel(catalog, { getItem() {} });
  model.state.query = '不存在'; model.state.view = { x: 23, y: 45, scale: .7 };
  const href = model.frame_url(catalog[1].id);
  assert.equal(read_project_route(href).frame_id, catalog[1].id);
  assert.equal(read_project_route(href).project_id, 'default');
  model.read_route(href);
  assert.deepEqual(model.visible().map(frame => frame.id), [catalog[1].id]);
  model.set_detail_width(390);
  assert.equal(model.frame_width(model.state.detail.frame), 390);
  assert.equal(model.state.detail.frame.width, 520);
  model.fit(1200, 900);
  assert.ok(model.state.view.scale > 0);
  model.read_route('/');
  assert.equal(model.state.detail, null);
  assert.deepEqual(model.state.view, { x: 23, y: 45, scale: .7 });
  assert.equal(model.state.query, '不存在');
  for (const href of [frame_url('default', '/missing'), frame_url('default', '/missing.again')]) {
    model.read_route(href);
    assert.match(model.state.detail.error, /找不到/);
    assert.deepEqual(model.visible(), []);
  }
});

test('项目与 Frame URL 编码完整身份，拒绝损坏的编码且不混淆其他项目', () => {
  const id = '/controls/中文 + 空格?#%.frame';
  const url = frame_url('project-id', id);
  assert.deepEqual(read_project_route(url), { project_id: 'project-id', frame_id: id });
  assert.deepEqual(read_project_route(project_url('project-id')), { project_id: 'project-id', frame_id: null });
  assert.equal(read_project_route('/project/project-id/other'), null);
  assert.throws(() => read_project_route('/project/project-id/frame/%ZZ'), /无效/);
  const model = BoardModel(catalog, { getItem() {} }, 'existing-layout', 'project-id');
  model.read_route(frame_url('project-id', '/home'));
  assert.equal(model.state.detail.frame.id, '/home');
  model.read_route(frame_url('other-project', '/home'));
  assert.equal(model.state.detail, null);
});

test('详情 Model 默认启用可交互预览的节点选择，源码和无效 Frame 不启用', () => {
  const model = BoardModel(catalog, { getItem() {} });
  for (const [id, enabled] of [['/home', true], ['/source', false], ['/missing', false]]) {
    model.read_route(frame_url('default', id));
    assert.equal(model.state.detail.picking, enabled);
    assert.equal(model.state.detail.nodes_visible, enabled);
  }
});

const bundled = await build({
  entryPoints: [new URL('../src/board.js', import.meta.url).pathname], bundle: true, write: false, format: 'esm',
  plugins: [{ name: 'board-preview-fixture', setup(builder) {
    builder.onResolve({ filter: /^\.\/direct-preview\.js$/ }, () => ({ path: 'preview', namespace: 'board-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'board-fixture' }, () => ({ contents: `
import { create_direct_preview as create } from ${JSON.stringify(new URL('../src/direct-preview.js', import.meta.url).pathname)};
export function create_direct_preview(options) {
  return create({ ...options, load: options.load || load_preview });
}
export async function load_preview(document, project) {
  if (project.fail_preview) throw new Error('预览模块加载失败');
  return { styles: [], adapter: {
    mount(frame, root) {
      preview_mounts[frame.id] = (preview_mounts[frame.id] || 0) + 1;
      const input = root.ownerDocument.createElement('input'); input.dataset.n = 'preview-input'; input.dataset.revision = project.revision || 'initial'; input.value = 'draft'; root.append(input);
      return () => { preview_unmounts[frame.id] = (preview_unmounts[frame.id] || 0) + 1; };
    },
  } };
}`, loader: 'js', resolveDir: new URL('../', import.meta.url).pathname }));
  } }],
});

async function fixture(path = '/project/demo-id', frames = catalog, project_overrides = {}, open_project) {
  const { document, window } = parseHTML('<html><head></head><body><div id="app" data-n="board-app"></div></body></html>');
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, writable: true, value: '' });
  Object.defineProperties(window.HTMLElement.prototype, {
    clientWidth: { configurable: true, get() { return 1280; } },
    clientHeight: { configurable: true, get() { return this.dataset.n === 'picked-source-code' ? 220 : this.dataset.n === 'picked-source-full-code' ? 600 : 900; } },
    offsetWidth: { configurable: true, get() { return parseFloat(this.style.width) || 1280; } },
    offsetHeight: { configurable: true, get() { return this.className === 'picked-source-line' ? 20 : parseFloat(this.style.height) || 900; } },
    offsetTop: { configurable: true, get() { return this.className === 'picked-source-line' ? [...this.parentNode.children].indexOf(this) * 20 : 0; } },
  });
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const input = this.dataset.n === 'preview-input';
    const left = input ? 140 : 0, top = input ? 180 : 0, width = input ? 100 : 1280, height = input ? 30 : 900;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height };
  };
  window.getComputedStyle = () => ({ display: 'block', visibility: 'visible', contentVisibility: 'visible' });
  const entries = [{ path, state: null }]; let current = 0;
  const location = { href: `http://localhost${path}`, reloads: 0, reload() { this.reloads++; }, assign(value) { this.href = new URL(value, this.href).href; } };
  function navigate() { location.href = new URL(entries[current].path, 'http://localhost').href; window.dispatchEvent(new window.Event('popstate')); }
  const history = {
    get state() { return entries[current].state; },
    pushState(state, _title, path) { entries.splice(++current); entries.push({ path, state }); location.href = new URL(path, location.href).href; },
    back() { if (current > 0) { current--; navigate(); } },
    forward() { if (current + 1 < entries.length) { current++; navigate(); } },
  };
  const preview_mounts = {}, preview_unmounts = {}, stored = new Map(), requests = [];
  const runtime = { document, window, location, history, console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    preview_mounts, preview_unmounts, ResizeObserver: class { observe() {} },
    requestAnimationFrame: callback => setTimeout(callback, 0),
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    fetch: async (path, request) => {
      requests.push({ path, request });
      if (request?.method === 'POST' && open_project) return open_project(path, request);
      if (path === '/sources.json') return { ok: true, json: async () => ({ uid: 'demo-id', files: { 'view.js': Array.from({ length: 60 }, (_, index) => `const line_${index + 1} = '<b>原始代码</b>';`).join('\n') } }) };
      return { ok: true, json: async () => path === '/catalog.json' ? frames : path === '/project.json' ? { id: 'demo', uid: 'demo-id', title: '测试项目', runtime_scripts: [], stylesheets: [], ...project_overrides } : request?.method === 'POST' ? { id: JSON.parse(request.body).id || 'demo-id', title: '测试项目', pages: 1, components: 1 } : { projects: [{ id: 'demo-id', adapter: 'demo', title: '测试项目', source: '' }, { id: 'rss-id', adapter: 'xiaoxunrss', title: '小讯', source: '/rss' }] } };
    },
  };
  try { await vm.runInNewContext(`(async () => { ${bundled.outputFiles[0].text}\n })()`, runtime); }
  catch (error) { error.fixture = { document, location, requests, preview_mounts }; throw error; }
  await new Promise(resolve => setTimeout(resolve, 10));
  const query = name => document.querySelector(`[data-n="${name}"]`);
  const emit = (target, type, properties = {}) => { const event = new window.Event(type, { bubbles: true, cancelable: true }); Object.assign(event, properties); target.dispatchEvent(event); return event; };
  return { document, window, location, history, query, emit, preview_mounts, preview_unmounts, requests };
}

test('目录默认展示全部 Frame，筛选行移除，标题旁仅保留一个展开收起图标', async () => {
  const f = await fixture();
  assert.equal(f.query('catalog-filters'), null);
  assert.equal(f.query('catalog-tree-actions'), null);
  assert.equal(f.query('expand-tree'), null);
  assert.equal(f.query('collapse-tree'), null);
  assert.equal(f.query('sidebar-heading').querySelectorAll('button').length, 1);
  assert.ok(f.query('catalog-tree-toggle').querySelector('svg'));
  const ids = [...f.query('frame-list').querySelectorAll('[data-id]')].map(node => node.dataset.id);
  assert.deepEqual(new Set(ids), new Set(catalog.map(frame => frame.id)));
  f.emit(f.query('catalog-tree-toggle'), 'click');
  assert.equal(f.query('catalog-tree-toggle').title, '展开全部');
});

test('进入详情默认可直接选择节点，Esc 和按钮可退出，历史前进重新默认启用', async () => {
  const f = await fixture();
  f.emit(f.query('frame-title'), 'dblclick');
  const preview = f.query('direct-preview'), input = preview.shadowRoot.querySelector('input');
  assert.equal(f.query('pick-nodes-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(f.query('picked-nodes-panel').hidden, false);
  assert.equal(f.query('whiteboard-workspace').classList.contains('picking-nodes'), true);
  assert.equal(preview.getAttribute('data-picking'), 'true');
  preview.shadowRoot.elementFromPoint = () => input;
  const point = { button: 0, pointerId: 1, clientX: 150, clientY: 190 };
  assert.equal(f.emit(f.query('whiteboard-workspace'), 'pointerdown', point).defaultPrevented, true);
  f.emit(f.query('whiteboard-workspace'), 'pointerup', point);
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].n, 'preview-input');
  f.emit(f.document, 'keydown', { key: 'Escape' });
  assert.equal(f.query('pick-nodes-toggle').getAttribute('aria-pressed'), 'false');
  f.emit(f.query('detail-close'), 'click'); f.history.forward();
  assert.equal(f.query('pick-nodes-toggle').getAttribute('aria-pressed'), 'true');
  f.emit(f.query('pick-nodes-toggle'), 'click');
  assert.equal(f.query('pick-nodes-toggle').getAttribute('aria-pressed'), 'false');
});

test('详情切换交互模式释放预览事件，保留输入，切回选择及返回画板恢复屏蔽', async () => {
  const f = await fixture(frame_url('demo-id', '/home'));
  const preview = f.query('direct-preview'), input = preview.shadowRoot.querySelector('input');
  const workspace = f.query('whiteboard-workspace'), toggle = f.query('pick-nodes-toggle');
  const point = { button: 0, pointerId: 1, clientX: 150, clientY: 190 };
  preview.shadowRoot.elementFromPoint = () => input;
  f.emit(workspace, 'pointerdown', point); f.emit(workspace, 'pointerup', point);
  f.emit(f.window, 'pointerup', point);
  assert.equal(f.query('node-picker-controls').hidden, false);
  assert.equal(toggle.textContent, '选择模式 · 切换交互');
  f.emit(toggle, 'click');
  assert.equal(toggle.textContent, '交互模式 · 切换选择');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(workspace.dataset.interactive, 'true');
  assert.equal(preview.inert, false);
  assert.equal(preview.getAttribute('data-picking'), 'false');
  assert.equal(f.query('node-picker-controls').hidden, true);
  assert.equal(f.query('node-picker-box').hidden, true);
  input.value = '交互后的输入';
  let clicks = 0; input.addEventListener('click', () => clicks++);
  const transform = f.query('whiteboard-world').style.transform;
  assert.equal(f.emit(input, 'pointerdown', point).defaultPrevented, false);
  assert.equal(f.emit(preview, 'pointerdown', point).defaultPrevented, false);
  f.emit(f.window, 'pointermove', { ...point, clientX: 210, clientY: 250 });
  f.emit(f.window, 'pointerup', point);
  assert.equal(f.emit(input, 'click').defaultPrevented, false);
  assert.equal(clicks, 1);
  assert.equal(f.emit(preview, 'wheel', { deltaX: 0, deltaY: 40 }).defaultPrevented, false);
  assert.equal(f.emit(input, 'keydown', { key: 'f' }).defaultPrevented, false);
  assert.equal(f.emit(preview, 'keydown', { key: 'f' }).defaultPrevented, false);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.query('whiteboard-world').style.transform, transform);
  f.emit(f.query('fit-all'), 'click');
  assert.equal(preview.inert, false);
  f.emit(workspace, 'keydown', { key: 'Alt' });
  assert.equal(preview.getAttribute('data-picking'), 'true');
  f.emit(workspace, 'keyup', { key: 'Alt' });
  assert.equal(preview.getAttribute('data-picking'), 'false');
  f.emit(toggle, 'click');
  assert.equal(toggle.textContent, '选择模式 · 切换交互');
  assert.equal(preview.inert, true);
  assert.equal(workspace.dataset.interactive, 'false');
  assert.equal(f.emit(workspace, 'pointerdown', point).defaultPrevented, true);
  f.emit(workspace, 'pointerup', point);
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].n, 'preview-input');
  f.emit(toggle, 'click'); f.emit(f.query('detail-close'), 'click');
  assert.equal(preview.inert, true);
  assert.equal(workspace.dataset.interactive, 'false');
  assert.equal(input.value, '交互后的输入');
  assert.equal(f.preview_mounts['/home'], 1);
});

test('顶部刷新画板按钮重新提交当前项目，构建成功后重新加载画板', async () => {
  const f = await fixture();
  const dialog = f.query('project-dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const destinations = [];
  f.location.assign = path => destinations.push(path);
  f.emit(f.query('refresh-board'), 'click');
  assert.equal(f.query('refresh-board').disabled, true);
  assert.equal(f.query('refresh-board').textContent, '正在刷新…');
  await new Promise(resolve => setImmediate(resolve));
  const sent = f.requests.find(({ request }) => request?.method === 'POST');
  assert.equal(sent.path, '/__jiezi/project');
  assert.deepEqual(JSON.parse(sent.request.body), { adapter: 'demo', source: '' });
  assert.deepEqual(destinations, ['/project/demo-id']);
});

test('详情刷新仅替换画布并加载新源码和预览，保留页面、视口及宽度，可连续刷新', async () => {
  const path = frame_url('demo-id', '/home');
  const frames = catalog.map(frame => ({ ...frame })), project = { revision: 'first' };
  let builds = 0;
  const f = await fixture(path, frames, project, async () => {
    project.revision = `refresh-${++builds}`;
    frames[0] = { ...frames[0], title: `更新 ${builds}`, source: `export const updated = ${builds};` };
    return { ok: true, json: async () => ({ id: 'demo-id', title: '测试项目', pages: 1, components: 1 }) };
  });
  const dialog = f.query('project-dialog');
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  const destinations = []; f.location.assign = path => destinations.push(path);
  const app = f.query('board-app'), workspace = f.query('whiteboard-workspace'), toolbar = f.query('board-toolbar'), header = f.query('board-header');
  const previous_preview = f.query('direct-preview');
  f.query('preview-device').value = '390'; f.emit(f.query('preview-device'), 'change');
  f.emit(workspace, 'wheel', { deltaX: 20, deltaY: 30 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const transform = f.query('whiteboard-world').style.transform;
  assert.equal(f.query('detail-refresh').textContent, '刷新');
  f.emit(f.query('detail-refresh'), 'click');
  assert.equal(f.query('detail-refresh').disabled, true);
  assert.equal(f.query('detail-refresh').textContent, '正在刷新…');
  assert.equal(f.location.reloads, 0);
  await new Promise(resolve => setImmediate(resolve));
  const sent = f.requests.find(({ request }) => request?.method === 'POST');
  assert.equal(sent.path, '/__jiezi/project');
  assert.deepEqual(JSON.parse(sent.request.body), { adapter: 'demo', source: '' });
  assert.equal(f.location.reloads, 0);
  assert.equal(new URL(f.location.href).pathname, path);
  assert.deepEqual(destinations, []);
  assert.equal(f.query('board-app'), app); assert.equal(f.query('whiteboard-workspace'), workspace);
  assert.equal(f.query('board-toolbar'), toolbar); assert.equal(f.query('board-header'), header);
  assert.notEqual(f.query('direct-preview'), previous_preview);
  assert.equal(f.preview_unmounts['/home'], 1);
  assert.equal(f.preview_mounts['/home'], 2);
  assert.equal(f.query('direct-preview').shadowRoot.querySelector('input').dataset.revision, 'refresh-1');
  assert.equal(f.query('detail-title').textContent, '更新 1');
  assert.equal(f.query('detail-source-pane').textContent, 'export const updated = 1;');
  assert.equal(f.query('whiteboard-world').style.transform, transform);
  assert.equal(f.query('direct-preview').style.width, '390px');
  assert.equal(f.query('detail-refresh').disabled, false); assert.equal(dialog.open, false);
  assert.equal(f.query('node-picker-box').hidden, true);
  f.emit(f.query('detail-refresh'), 'click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.query('detail-title').textContent, '更新 2');
  assert.equal(f.preview_mounts['/home'], 3);
  assert.equal(f.location.reloads, 0);
});

test('详情刷新禁止重复提交，失败保留原预览，弹窗重试成功后仅替换内容', async () => {
  let finish;
  const path = frame_url('demo-id', '/home');
  const f = await fixture(path, catalog, {}, () => new Promise(resolve => { finish = resolve; }));
  const preview = f.query('direct-preview'), dialog = f.query('project-dialog');
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  const destinations = []; f.location.assign = path => destinations.push(path);
  f.emit(f.query('detail-refresh'), 'click'); f.emit(f.query('detail-refresh'), 'click');
  assert.equal(f.requests.filter(({ request }) => request?.method === 'POST').length, 1);
  finish({ ok: false, json: async () => ({ error: 'view.js:12 构建失败' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.query('detail-refresh').disabled, false);
  assert.match(f.query('project-open-error').textContent, /view.js:12/);
  assert.equal(f.query('direct-preview'), preview);
  assert.equal(f.location.reloads, 0);
  f.emit(f.query('project-form'), 'submit');
  finish({ ok: true, json: async () => ({ id: 'demo-id', title: '测试项目', pages: 1, components: 1 }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.location.reloads, 0);
  assert.equal(new URL(f.location.href).pathname, path);
  assert.deepEqual(destinations, []);
  assert.notEqual(f.query('direct-preview'), preview);
  assert.equal(f.query('detail-refresh').disabled, false);
});

test('预览资源加载失败保留旧画布；刷新删除当前 Frame 时在原地址显示错误', async () => {
  const frames = catalog.map(frame => ({ ...frame })), project = { fail_preview: false };
  let builds = 0;
  const f = await fixture(frame_url('demo-id', '/home'), frames, project, async () => {
    project.fail_preview = ++builds === 1;
    if (builds === 2) frames.splice(0, 1);
    return { ok: true, json: async () => ({ id: 'demo-id', title: '测试项目' }) };
  });
  const dialog = f.query('project-dialog'), preview = f.query('direct-preview');
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  f.emit(f.query('detail-refresh'), 'click'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.query('direct-preview'), preview);
  assert.match(f.query('project-open-error').textContent, /预览模块加载失败/);
  assert.equal(f.query('detail-refresh').disabled, false);
  f.emit(f.query('project-form'), 'submit'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.query('direct-preview'), null);
  assert.match(f.query('detail-route-error').textContent, /找不到/);
  assert.equal(f.location.reloads, 0);
  assert.equal(new URL(f.location.href).pathname, frame_url('demo-id', '/home'));
  assert.equal(f.query('detail-refresh').disabled, false);
});

test('切换项目导航到持久 ID 对应地址，双击 Frame 使用嵌套路由', async () => {
  const f = await fixture();
  const brand = f.query('board-brand');
  assert.deepEqual([...brand.children].map(node => node.dataset.n), ['brand-logo', 'brand-name', 'brand-project', 'board-logo', 'project-switch']);
  assert.equal(f.query('brand-logo').getAttribute('src'), '/jiezi-logo.svg');
  assert.equal(f.query('brand-name').textContent, 'jiezi');
  assert.equal(f.query('brand-project').textContent, '/');
  assert.equal(f.query('header-actions').querySelector('select'), null);
  assert.equal(f.query('project-switch').value, 'demo-id');
  assert.equal(new URL(f.location.href).pathname, '/project/demo-id');
  f.emit(f.query('frame-title'), 'dblclick');
  assert.equal(new URL(f.location.href).pathname, frame_url('demo-id', '/home'));
  f.emit(f.query('detail-close'), 'click');
  const dialog = f.query('project-dialog');
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  const destinations = [];
  f.location.assign = path => destinations.push(path);
  f.query('project-switch').value = 'rss-id'; f.emit(f.query('project-switch'), 'change');
  await new Promise(resolve => setImmediate(resolve));
  const sent = f.requests.find(({ request }) => request?.method === 'POST');
  assert.deepEqual(JSON.parse(sent.request.body), { id: 'rss-id' });
  assert.deepEqual(destinations, ['/project/rss-id']);
});

test('Frame 标题与内容单击仅选中，双击才打开详情', async () => {
  for (const name of ['frame-title', 'frame-summary']) {
    const f = await fixture();
    const target = f.document.querySelector(`[data-n="board-frame"][data-id="${catalog[1].id}"] [data-n="${name}"]`);
    f.emit(target, 'click');
    assert.equal(new URL(f.location.href).pathname, '/project/demo-id');
    assert.equal(f.query('board-app').dataset.mode, 'board');
    assert.equal(target.closest('[data-n="board-frame"]').classList.contains('selected'), true);
    assert.equal(f.query('inspector-title').textContent, catalog[1].title);
    f.emit(target, 'click');
    assert.equal(f.query('board-app').dataset.mode, 'board');
    f.emit(target, 'dblclick');
    assert.equal(new URL(f.location.href).pathname, frame_url('demo-id', catalog[1].id));
    assert.equal(f.query('board-app').dataset.mode, 'frame');
  }
});

test('移动工具单击和双击 Frame 保持总览', async () => {
  const f = await fixture();
  f.emit(f.query('hand-tool'), 'click');
  f.emit(f.query('frame-title'), 'click');
  f.emit(f.query('frame-title'), 'dblclick');
  assert.equal(new URL(f.location.href).pathname, '/project/demo-id');
  assert.equal(f.query('board-app').dataset.mode, 'board');
});

test('白板与详情中的渲染错误均可复制，重绘后错误界面仍可交互', async () => {
  const f = await fixture('/project/demo-id', catalog, { fail_preview: true });
  const copied = [], clipboard = { async writeText(text) { copied.push(text); } };
  Object.defineProperty(f.document, 'defaultView', { configurable: true, value: new Proxy(f.window, { get(target, key) { return key === 'navigator' ? { clipboard } : Reflect.get(target, key); } }) });
  const preview = f.query('direct-preview');
  const copy = preview.shadowRoot.querySelector('[data-n="preview-error-copy"]');
  assert.equal(preview.inert, false);
  f.emit(f.query('fit-all'), 'click');
  assert.equal(preview.inert, false);
  f.emit(copy, 'click'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied.length, 1); assert.match(copied[0], /预览模块加载失败/);
  assert.equal(f.query('board-app').dataset.mode, 'board');
  f.emit(f.query('frame-title'), 'dblclick');
  assert.equal(f.query('board-app').dataset.mode, 'frame');
  assert.equal(preview.inert, false);
  f.emit(copy, 'pointerdown', { button: 0, pointerId: 1, clientX: 150, clientY: 190 });
  f.emit(copy, 'pointerup', { button: 0, pointerId: 1, clientX: 150, clientY: 190 });
  f.emit(copy, 'click'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(copied, [copied[0], copied[0]]);
});

test('跨项目的历史导航重新加载，由服务解析对应项目', async () => {
  const f = await fixture();
  let reloads = 0; f.location.reload = () => { reloads++; };
  f.history.pushState(null, '', '/project/other-id');
  f.emit(f.window, 'popstate');
  assert.equal(reloads, 1);
});

test('旧服务缺少项目 ID 或启动时项目不匹配会提示重启，不循环刷新或打开默认项目', async () => {
  const path = frame_url('demo-id', '/home');
  for (const uid of [undefined, 'other-project']) {
    await assert.rejects(fixture(path, catalog, { uid }), error => {
      const { document, location, requests, preview_mounts } = error.fixture;
      assert.match(document.querySelector('#app').textContent, /项目元数据缺失或与地址不一致.*重启开发服务/);
      assert.equal(location.reloads, 0);
      assert.equal(location.href, `http://localhost${path}`);
      assert.equal(requests.length, 2);
      assert.deepEqual(preview_mounts, {});
      return true;
    });
  }
});

test('.frame 声明的大尺寸传到画板和详情预览，切换设备宽度保留高度', async () => {
  const source = `export const _Preview = [{ name: '长页面', path: '/home', width: 1440, height: 2400, render() {} }];`;
  const [declaration] = preview_declarations(source);
  const f = await fixture('/', [{ ...catalog[0], ...declaration, source }]);
  const preview = f.query('direct-preview');
  assert.equal(f.query('board-frame').style.width, '1440px');
  assert.equal(f.query('board-frame').style.height, '2400px');
  assert.equal(preview.style.width, '1440px');
  assert.equal(preview.style.height, '2400px');
  assert.equal(preview.style.getPropertyValue('--jiezi-viewport-width'), '1440px');
  assert.equal(preview.style.getPropertyValue('--jiezi-viewport-height'), '2400px');
  f.emit(f.query('frame-title'), 'dblclick');
  assert.equal(preview.style.height, '2400px');
  f.query('preview-device').value = '390'; f.emit(f.query('preview-device'), 'change');
  assert.equal(preview.style.width, '390px');
  assert.equal(preview.style.height, '2400px');
  assert.equal(preview.style.getPropertyValue('--jiezi-viewport-width'), '390px');
  assert.equal(preview.style.getPropertyValue('--jiezi-viewport-height'), '2400px');
  f.emit(f.query('detail-close'), 'click');
  assert.equal(f.query('direct-preview'), preview);
  assert.equal(preview.style.width, '1440px');
  assert.equal(preview.style.height, '2400px');
  assert.equal(preview.style.getPropertyValue('--jiezi-viewport-width'), '1440px');
});

test('双击进入详情路由，复用画板中的页面，工具面板不替换预览，返回与前进可恢复', async () => {
  const f = await fixture();
  const copied = [];
  const clipboard = { async writeText(text) { copied.push(text); } };
  Object.defineProperty(f.document, 'defaultView', { configurable: true, value: new Proxy(f.window, { get(target, key) { return key === 'navigator' ? { clipboard } : Reflect.get(target, key); } }) });
  const preview = f.query('direct-preview');
  const input = preview.shadowRoot.querySelector('input'); input.value = '用户输入';
  f.emit(f.query('frame-title'), 'dblclick');
  assert.equal(new URL(f.location.href).pathname, frame_url('demo-id', '/home'));
  assert.equal(f.query('board-app').dataset.mode, 'frame');
  assert.equal(f.query('frame-detail-dialog'), null);
  assert.equal(f.query('picked-parent-source-copy').disabled, true);
  assert.equal(f.query('whiteboard-world').querySelector('[data-n="direct-preview"]'), preview);
  assert.equal(preview.inert, true);
  assert.equal(input.value, '用户输入');
  assert.equal(f.preview_mounts['/home'], 1);
  assert.equal(f.query('detail-frame-path').textContent, '/home');
  f.emit(f.query('detail-source-toggle'), 'click');
  assert.equal(f.query('detail-source-panel').hidden, false);
  assert.equal(f.query('detail-source-pane').textContent, catalog[0].source);
  assert.equal(f.query('whiteboard-world').contains(preview), true);
  f.emit(f.query('detail-source-close'), 'click');
  f.query('preview-device').value = '390'; f.emit(f.query('preview-device'), 'change');
  assert.equal(preview.style.width, '390px');
  const transform = f.query('whiteboard-world').style.transform;
  f.emit(f.query('board-frame'), 'pointerdown', { button: 1, pointerId: 2, clientX: 400, clientY: 300 });
  f.emit(f.window, 'pointermove', { pointerId: 2, clientX: 440, clientY: 340 });
  f.emit(f.window, 'pointerup', { pointerId: 2, clientX: 440, clientY: 340 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.notEqual(f.query('whiteboard-world').style.transform, transform);
  assert.equal(f.query('picked-nodes-panel').hidden, false);
  assert.equal(f.query('pick-nodes-toggle').getAttribute('aria-pressed'), 'true');
  preview.shadowRoot.elementFromPoint = () => {
    assert.equal(preview.inert, false);
    assert.equal(preview.style.getPropertyValue('pointer-events'), 'auto');
    return input;
  };
  let mounted = null;
  const tracked_view = { t: 'view', onMounted() {}, get $elm() { return mounted; }, set $elm(node) { mounted = node; } };
  trace_source(tracked_view, { file: 'view.js', line: 41, column: 5, end_line: 41, end_column: 30 });
  trace_source(tracked_view, { file: 'page.frame', line: 8, column: 3 });
  tracked_view.$elm = input;
  const point = { button: 0, pointerId: 1, clientX: 150, clientY: 190, composedPath: () => [f.query('board-frame')] };
  f.emit(f.query('whiteboard-workspace'), 'pointerdown', point);
  f.emit(f.query('whiteboard-workspace'), 'pointerup', point);
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].n, 'preview-input');
  assert.equal(f.query('picked-node-source').textContent, 'view.js:41:5');
  assert.equal(f.query('picked-node-usage').textContent, '使用位置：page.frame:8:3');
  f.emit(f.query('picked-node-source-copy'), 'click'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied.at(-1), 'view.js:41:5');
  assert.match(f.query('picked-nodes-status').textContent, /已复制源码位置/);
  f.emit(f.query('picked-node-usage-copy'), 'click'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied.at(-1), 'page.frame:8:3');
  const write = clipboard.writeText; clipboard.writeText = async () => { throw new Error('denied'); };
  f.emit(f.query('picked-node-source-copy'), 'click'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(f.query('picked-nodes-status').textContent, /复制失败/);
  clipboard.writeText = write;
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].source_details.declaration.end_column, 30);
  await new Promise(resolve => setImmediate(resolve));
  const source_lines = [...f.query('picked-source-code').children];
  assert.equal(source_lines.length, 60);
  assert.match(source_lines[0].textContent, /^1  /);
  assert.match(source_lines.at(-1).textContent, /^60  /);
  assert.equal(f.query('picked-source-code').scrollTop, 35 * 20);
  assert.match(f.query('picked-source-code').querySelector('[aria-current="true"]').textContent, /41  const line_41/);
  assert.equal(f.query('picked-source-code').querySelector('b'), null);
  assert.equal(f.query('picked-source-preview').hidden, false);
  const source_dialog = f.query('picked-source-dialog');
  source_dialog.showModal = () => { source_dialog.open = true; source_dialog.setAttribute('open', ''); };
  source_dialog.close = () => { source_dialog.open = false; source_dialog.removeAttribute('open'); f.emit(source_dialog, 'close'); };
  f.query('picked-source-code').scrollTop = 17;
  f.emit(f.query('picked-source-expand'), 'click');
  assert.equal(source_dialog.open, true);
  assert.equal(source_dialog.getAttribute('aria-labelledby'), 'picked-source-dialog-title');
  assert.equal(f.query('picked-source-full-code').children.length, 60);
  assert.match(f.query('picked-source-full-code').querySelector('[aria-current="true"]').textContent, /41  const line_41/);
  assert.equal(f.query('picked-source-full-code').scrollTop, 41 * 20 - 20 - (600 - 20) / 2);
  assert.equal(f.query('picked-source-full-code').querySelector('b'), null);
  const selection_before_modal_escape = f.query('picked-nodes-json').textContent;
  f.emit(source_dialog, 'keydown', { key: 'Escape' });
  assert.equal(f.query('picked-nodes-json').textContent, selection_before_modal_escape);
  assert.equal(f.query('pick-nodes-toggle').getAttribute('aria-pressed'), 'true');
  f.emit(source_dialog, 'cancel');
  assert.equal(source_dialog.open, false);
  assert.equal(f.query('picked-source-code').scrollTop, 17);
  assert.equal(new URL(f.location.href).pathname, frame_url('demo-id', '/home'));
  f.emit(f.query('picked-source-expand'), 'click');
  f.emit(f.query('picked-source-dialog-close'), 'click');
  assert.equal(source_dialog.open, false);
  assert.equal(preview.inert, true);
  assert.equal(preview.style.getPropertyValue('pointer-events') || '', '');
  const preview_root = input.parentElement;
  preview_root.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 40, column: 3 }));
  input.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 41, column: 5 }));
  const sibling = f.document.createElement('input'); sibling.dataset.n = 'preview-sibling';
  sibling.getBoundingClientRect = () => ({ left: 250, top: 180, right: 350, bottom: 210, width: 100, height: 30 });
  sibling.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 42, column: 5 })); preview_root.append(sibling);
  preview.shadowRoot.elementFromPoint = x => x < 245 ? input : sibling;
  const selected_json = f.query('picked-nodes-json').textContent;
  const view_before_parent = f.query('whiteboard-world').style.transform;
  f.emit(f.query('node-picker-parent'), 'pointerdown', point);
  f.emit(f.query('node-picker-parent'), 'pointerup', point);
  f.emit(f.query('node-picker-parent'), 'click');
  assert.equal(f.query('whiteboard-world').style.transform, view_before_parent);
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].selector, ':scope');
  assert.equal(f.query('picked-node-source').textContent, 'view.js:40:3');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(f.query('picked-source-code').querySelector('[aria-current="true"]').textContent, /40  const line_40/);
  assert.equal(f.query('node-picker-parent').disabled, true);
  f.emit(f.query('node-picker-back'), 'click');
  assert.equal(f.query('picked-nodes-json').textContent, selected_json);
  f.emit(f.query('whiteboard-workspace'), 'pointerdown', { ...point, clientX: 130, clientY: 170 });
  f.emit(f.query('whiteboard-workspace'), 'pointermove', { ...point, clientX: 360, clientY: 220 });
  assert.equal(f.query('node-picker-box').style.width, '230px');
  f.emit(f.query('whiteboard-workspace'), 'pointerup', { ...point, clientX: 360, clientY: 220 });
  assert.equal(f.query('node-picker-box').style.width, '1280px');
  assert.equal(f.query('node-picker-box').style.height, '900px');
  assert.equal(f.query('picked-parent-source').hidden, false);
  assert.equal(f.query('picked-parent-source').textContent, '父节点源码：view.js:40:3');
  f.emit(f.query('picked-parent-source-copy'), 'click'); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(copied.at(-1), 'view.js:40:3');
  assert.match(f.query('picked-source-code').querySelector('[aria-current="true"]').textContent, /40  const line_40/);
  assert.equal(f.requests.filter(request => request.path === '/sources.json').length, 1);
  assert.equal(f.query('picked-nodes-list').querySelector('[data-n="picked-node-source"]'), null);
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].source.line, 41);
  assert.equal(f.emit(f.document, 'keydown', { key: 'Escape' }).defaultPrevented, true);
  assert.equal(f.query('pick-nodes-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(f.query('picked-source-preview').hidden, true);
  assert.equal(new URL(f.location.href).pathname, frame_url('demo-id', '/home'));
  f.emit(f.query('detail-close'), 'click');
  assert.equal(new URL(f.location.href).pathname, '/project/demo-id');
  assert.equal(f.query('board-app').dataset.mode, 'board');
  assert.equal(f.query('frame-detail-overlay'), null);
  assert.equal(preview.inert, true);
  assert.equal(preview.style.width, '1200px');
  assert.equal(input.value, '用户输入');
  f.history.forward();
  assert.equal(f.query('board-app').dataset.mode, 'frame');
  assert.equal(f.query('direct-preview'), preview);
  f.emit(f.query('detail-close'), 'click');
  for (const node of f.document.querySelectorAll('#app *')) assert.ok(node.dataset.n, node.outerHTML.slice(0, 150));
});

test('点击内嵌和弹窗源码反选节点，多行范围保留点击行，无匹配保留原选择', async () => {
  const f = await fixture(frame_url('demo-id', '/home'));
  const preview = f.query('direct-preview'), input = preview.shadowRoot.querySelector('input'), root = input.parentElement;
  input.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 10, column: 3 }));
  const sibling = f.document.createElement('input'); sibling.dataset.n = 'source-target';
  sibling.getBoundingClientRect = () => ({ left: 300, top: 180, right: 400, bottom: 210, width: 100, height: 30 }); root.append(sibling);
  let mounted = null;
  const view = { t: 'view', onMounted() {}, get $elm() { return mounted; }, set $elm(value) { mounted = value; } };
  trace_source(view, { file: 'view.js', line: 20, column: 3, end_line: 22, end_column: 8 }); view.$elm = sibling;
  preview.shadowRoot.elementFromPoint = () => input;
  const point = { button: 0, pointerId: 1, altKey: true, clientX: 150, clientY: 190 };
  f.emit(f.query('whiteboard-workspace'), 'pointerdown', point); f.emit(f.query('whiteboard-workspace'), 'pointerup', point);
  await new Promise(resolve => setImmediate(resolve));
  const source_row = line => f.query('picked-source-code').children[line - 1];
  assert.equal(source_row(20).tagName, 'BUTTON');
  const original_row = source_row(1);
  f.query('picked-source-code').scrollTop = 127; f.query('picked-source-code').scrollLeft = 43;
  f.emit(source_row(20), 'click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(source_row(1), original_row);
  assert.equal(f.query('picked-source-code').scrollTop, 127);
  assert.equal(f.query('picked-source-code').scrollLeft, 43);
  assert.match(f.query('picked-source-code').querySelector('[aria-current="true"]').textContent, /^20  /);
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].n, 'source-target');
  assert.equal(f.query('node-picker-box').style.left, '300px');
  assert.match(f.query('picked-source-location').textContent, /^view\.js:20:1$/);
  const selected = f.query('picked-nodes-json').textContent;
  f.emit(source_row(55), 'click');
  assert.equal(f.query('picked-nodes-json').textContent, selected);
  assert.match(f.query('picked-source-status').textContent, /没有对应/);
  assert.equal(f.query('picked-source-status').hidden, false);
  const dialog = f.query('picked-source-dialog');
  dialog.showModal = () => { dialog.open = true; dialog.setAttribute('open', ''); };
  dialog.close = () => { dialog.open = false; dialog.removeAttribute('open'); f.emit(dialog, 'close'); };
  f.emit(f.query('picked-source-expand'), 'click');
  f.emit(f.query('picked-source-full-code').children[54], 'click');
  assert.equal(dialog.open, true);
  assert.match(f.query('picked-source-full-status').textContent, /没有对应/);
  f.emit(f.query('picked-source-full-code').children[21], 'click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialog.open, false);
  assert.equal(f.query('picked-source-code').scrollTop, 127);
  assert.equal(f.query('picked-source-code').scrollLeft, 43);
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].n, 'source-target');
  assert.match(f.query('picked-source-code').querySelector('[aria-current="true"]').textContent, /^22  /);
  assert.equal(f.query('picked-source-status').hidden, true);

  const world = f.query('whiteboard-world');
  const view_x = () => Number(/translate\(([^,]+)px,/.exec(world.style.transform)[1]);
  const original_x = view_x();
  const far = f.document.createElement('button'); far.dataset.n = 'offscreen-source-target';
  far.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 30, column: 1 }));
  far.getBoundingClientRect = () => { const left = 2000 + view_x() - original_x; return { left, right: left + 100, top: 300, bottom: 330, width: 100, height: 30 }; }; root.append(far);
  f.emit(source_row(30), 'click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.parse(f.query('picked-nodes-json').textContent).nodes[0].n, 'offscreen-source-target');
  assert.notEqual(view_x(), original_x);
  assert.equal(f.query('node-picker-box').hidden, false);
  assert.equal(f.query('node-picker-box').style.left, '590px');
});

test('框选弹窗内容时排除整页遮罩与底层节点，源码定位到可见内容的共同父节点', async () => {
  const f = await fixture(frame_url('demo-id', '/home'));
  const preview = f.query('direct-preview'), input = preview.shadowRoot.querySelector('input'), root = input.parentElement;
  const area = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const dialog = f.document.createElement('section'); dialog.dataset.n = 'dialog-content';
  dialog.getBoundingClientRect = () => area(120, 160, 300, 100);
  dialog.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 40, column: 3 }));
  const sibling = f.document.createElement('input'); sibling.dataset.n = 'dialog-sibling'; sibling.getBoundingClientRect = () => area(250, 180, 100, 30);
  const backdrop = f.document.createElement('div'); backdrop.dataset.n = 'dialog-backdrop'; backdrop.getBoundingClientRect = () => area(0, 0, 1280, 900);
  const covered = f.document.createElement('button'); covered.dataset.n = 'covered-page-button'; covered.getBoundingClientRect = () => area(140, 180, 100, 30);
  root.append(covered, backdrop, dialog); dialog.append(input, sibling);
  preview.shadowRoot.elementFromPoint = x => x < 245 ? input : sibling;
  const point = { button: 0, pointerId: 1, clientX: 130, clientY: 170 };
  f.emit(f.query('whiteboard-workspace'), 'pointerdown', point);
  f.emit(f.query('whiteboard-workspace'), 'pointerup', { ...point, clientX: 360, clientY: 220 });
  await new Promise(resolve => setImmediate(resolve));
  const payload = JSON.parse(f.query('picked-nodes-json').textContent);
  assert.deepEqual(payload.nodes.map(node => node.n), ['preview-input', 'dialog-sibling']);
  assert.equal(payload.parent.selector, '[data-n="dialog-content"]');
  assert.equal(payload.parent.source.line, 40);
  assert.equal(f.query('node-picker-box').style.width, '300px');
  assert.equal(f.query('node-picker-box').style.height, '100px');
  assert.equal(f.query('picked-source-preview').hidden, false);
  assert.match(f.query('picked-source-code').querySelector('[aria-current="true"]').textContent, /40  const line_40/);
});

test('详情中拖动、滚轮平移和缩放保留节点、源码与历史，选框跟随画布变换', async () => {
  const f = await fixture(frame_url('demo-id', '/home'));
  const stage = f.query('whiteboard-workspace'), world = f.query('whiteboard-world'), preview = f.query('direct-preview');
  const input = preview.shadowRoot.querySelector('input');
  input.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 41, column: 5 }));
  const read_view = () => {
    const [, x, y, scale] = /translate\(([^,]+)px, ([^)]+)px\) scale\(([^)]+)\)/.exec(world.style.transform);
    return { x: Number(x), y: Number(y), scale: Number(scale) };
  };
  const initial = read_view();
  input.getBoundingClientRect = () => {
    const view = read_view(), ratio = view.scale / initial.scale;
    const left = view.x + (140 - initial.x) * ratio, top = view.y + (180 - initial.y) * ratio, width = 100 * ratio, height = 30 * ratio;
    return { left, top, width, height, right: left + width, bottom: top + height };
  };
  preview.shadowRoot.elementFromPoint = () => input;
  const point = { button: 0, pointerId: 1, clientX: 150, clientY: 190 };
  f.emit(stage, 'pointerdown', point); f.emit(stage, 'pointerup', point);
  // linkedom 不会把 stage 的事件继续冒泡到 window。
  f.emit(f.window, 'pointerup', point);
  await new Promise(resolve => setImmediate(resolve));
  const selected_json = f.query('picked-nodes-json').textContent;
  const source_line = f.query('picked-source-line'); f.query('picked-source-code').scrollTop = 17;
  const box = f.query('node-picker-box');
  f.emit(stage, 'pointerdown', { ...point, button: 1, pointerId: 2, clientX: 400, clientY: 300 });
  f.emit(f.window, 'pointermove', { pointerId: 2, clientX: 440, clientY: 330 });
  f.emit(f.window, 'pointerup', { pointerId: 2, clientX: 440, clientY: 330 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(box.style.left, '180px'); assert.equal(box.style.top, '210px');
  assert.equal(f.query('node-picker-controls').style.left, '180px');
  f.emit(stage, 'wheel', { deltaX: 10, deltaY: 20, clientX: 640, clientY: 450 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(box.style.left, '170px'); assert.equal(box.style.top, '190px');
  f.emit(stage, 'wheel', { deltaX: 0, deltaY: -30, ctrlKey: true, clientX: 640, clientY: 450 });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(Math.abs(parseFloat(box.style.width) - input.getBoundingClientRect().width) < .001);
  assert.equal(f.query('picked-nodes-json').textContent, selected_json);
  assert.equal(f.query('picked-source-line'), source_line);
  assert.equal(f.query('picked-source-code').scrollTop, 17);
  assert.equal(f.query('pick-nodes-toggle').getAttribute('aria-pressed'), 'true');
  f.emit(f.query('node-picker-parent'), 'click'); f.emit(f.query('node-picker-back'), 'click');
  assert.equal(f.query('picked-nodes-json').textContent, selected_json);
  assert.ok(Math.abs(parseFloat(box.style.width) - input.getBoundingClientRect().width) < .001);
  for (const name of ['zoom-in', 'zoom-reset', 'fit-all']) {
    f.emit(f.query(name), 'click');
    assert.equal(f.query('picked-nodes-json').textContent, selected_json);
    assert.equal(f.query('picked-source-preview').hidden, false);
  }
});

test('详情深链接支持被过滤组件、源码预览和无效 ID，Esc 不离开外部历史页面', async () => {
  const component = await fixture(frame_url('demo-id', catalog[1].id));
  assert.equal(component.query('detail-frame-path').textContent, catalog[1].id);
  assert.equal(component.query('direct-preview').inert, true);
  component.emit(component.window, 'keydown', { key: 'Escape' });
  assert.equal(new URL(component.location.href).pathname, '/project/demo-id');
  const source = await fixture(frame_url('demo-id', '/source'));
  assert.equal(source.query('detail-source-panel').hidden, false);
  assert.equal(source.query('pick-nodes-toggle').disabled, true);
  source.emit(source.query('detail-close'), 'click');
  const missing = await fixture(frame_url('demo-id', 'missing'));
  assert.match(missing.query('detail-route-error').textContent, /找不到/);
  missing.emit(missing.query('detail-close'), 'click');
  assert.equal(missing.query('board-app').dataset.mode, 'board');
});
