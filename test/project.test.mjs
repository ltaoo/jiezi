import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { ProjectModel } from '../src/project.model.js';
import { create_project_dialog } from '../src/project-dialog.js';
import { create_project_session, project_options } from '../project-session.mjs';
import { options_from_args, root } from '../build.mjs';

test('打开项目 Model 管理目录、构建状态、重试，禁止重复提交和构建中关闭', async () => {
  let resolve_request, sent;
  const model = ProjectModel({ id: 'demo' }, async (url, options) => {
    sent = { url, ...JSON.parse(options.body) };
    return new Promise(resolve => { resolve_request = resolve; });
  });
  model.show();
  assert.equal(await model.open(), false);
  assert.match(model.state.error, /填写项目目录/);
  model.set_source(' /project/xiaoxunrss ');
  const opening = model.open();
  assert.equal(model.state.status, 'opening');
  assert.equal(await model.open(), false);
  model.hide(); model.set_source('/changed');
  assert.equal(model.state.visible, true);
  assert.equal(model.state.source, ' /project/xiaoxunrss ');
  assert.deepEqual(sent, { url: '/__jiezi/project', adapter: 'xiaoxunrss', source: '/project/xiaoxunrss' });
  resolve_request({ ok: false, json: async () => ({ error: '缺少 node_modules' }) });
  assert.equal(await opening, false);
  assert.equal(model.state.status, 'error');
  assert.equal(model.state.error, '缺少 node_modules');
  const retry = model.open();
  resolve_request({ ok: true, json: async () => ({ title: '小讯', pages: 41, components: 145 }) });
  assert.equal(await retry, true);
  assert.equal(model.state.opened.pages, 41);
  assert.equal(model.state.status, 'ready');
});

test('Model 保留当前外部项目目录，处理连接失败及静态服务器响应', async () => {
  const model = ProjectModel({ id: 'xiaoxunrss', source: '/project' }, async () => { throw new Error('服务已断开'); });
  assert.equal(model.state.source, '/project');
  assert.equal(await model.open(), false);
  assert.equal(model.state.error, '服务已断开');
  const static_model = ProjectModel({ id: 'demo' }, async () => ({ ok: false, json: async () => { throw new Error('not JSON'); } }));
  static_model.set_adapter('demo');
  assert.equal(await static_model.open(), false);
  assert.match(static_model.state.error, /npm run dev/);
});

test('已添加项目可按 ID 直接切换，未知项目和当前项目不重复打开', async () => {
  const projects = [{ id: 'rss-id', adapter: 'xiaoxunrss', title: '小讯', source: '/rss' }, { id: 'admin-id', adapter: 'findrss-admin', title: '管理后台', source: '/worker/admin' }];
  const sent = [];
  const model = ProjectModel({ id: 'xiaoxunrss', uid: 'rss-id', source: '/rss' }, async (url, options) => {
    if (!options) return { ok: true, json: async () => ({ projects }) };
    sent.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ ...projects[1], pages: 24, components: 13 }) };
  });
  await model.load_projects();
  assert.equal(model.state.projects.length, 2);
  assert.equal(await model.switch_project(model.current_key), false);
  assert.equal(await model.switch_project('unknown'), false);
  assert.equal(await model.switch_project(model.project_key(projects[1])), true);
  assert.deepEqual(sent, [{ id: 'admin-id' }]);
  assert.equal(model.opened_url(), '/project/admin-id');
  assert.equal(model.state.visible, true);
});

test('打开项目弹窗通过 Model 提交，失败不切换画布，成功才通知重新加载', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  // linkedom 未实现 select.value setter 和原生 dialog 方法。
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, writable: true, value: '' });
  let resolve_request, opened = 0;
  const model = ProjectModel({ id: 'demo' }, () => new Promise(resolve => { resolve_request = resolve; }));
  const view = create_project_dialog({ document, model, on_open() { opened++; } });
  view.dialog.showModal = () => { view.dialog.open = true; };
  view.dialog.close = () => { view.dialog.open = false; };
  document.body.append(view.dialog);
  for (const node of document.body.querySelectorAll('*')) assert.ok(node.dataset.n);
  model.show();
  assert.equal(view.dialog.open, true);
  const input = view.dialog.querySelector('[data-n="project-source"]');
  input.value = '/project'; input.dispatchEvent(new window.Event('input'));
  assert.equal(model.state.source, '/project');
  const form = view.dialog.querySelector('form');
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(view.dialog.querySelector('[data-n="project-open-submit"]').disabled, true);
  const escape = new window.Event('cancel', { cancelable: true }); view.dialog.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(model.state.visible, true);
  resolve_request({ ok: false, json: async () => ({ error: '构建失败：view.js:12' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 0);
  assert.match(view.dialog.querySelector('[role="alert"]').textContent, /view.js:12/);
  assert.equal(view.dialog.querySelector('[data-n="project-open-submit"]').disabled, false);
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  resolve_request({ ok: true, json: async () => ({ title: '小讯', pages: 1, components: 2 }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 1);
  assert.match(view.dialog.querySelector('[role="status"]').textContent, /1 个页面预览，2 个组件预览/);
  view.destroy();
  assert.equal(document.body.childNodes.length, 0);
});

test('项目目录校验拒绝无效类型、相对路径、缺失资源，默认示例无需外部依赖', async () => {
  for (const input of [null, {}, { adapter: '../evil', source: '/' }, { adapter: 'xiaoxunrss', source: '' }, { adapter: 'xiaoxunrss', source: './relative' }, { adapter: 'demo', source: '\0' }]) {
    await assert.rejects(project_options(input), error => error.status === 400);
  }
  assert.equal((await project_options({ adapter: 'demo', source: '' })).source, join(root, 'examples/demo'));
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-project-'));
  try {
    await assert.rejects(project_options({ adapter: 'xiaoxunrss', source: directory }), /缺少 package.json/);
    await writeFile(join(directory, 'not-directory'), 'file');
    await assert.rejects(project_options({ adapter: 'demo', source: join(directory, 'not-directory') }), /项目文件夹/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('刷新使用当前项目，构建中禁止重复操作，失败保留页面并可重试', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, writable: true, value: '' });
  let resolve_request, sent, reloaded = 0;
  const model = ProjectModel({ id: 'findrss-admin', source: '/worker/admin' }, (url, request) => {
    sent = { url, ...JSON.parse(request.body) };
    return new Promise(resolve => { resolve_request = resolve; });
  });
  const view = create_project_dialog({ document, model, on_open() { reloaded++; } });
  view.dialog.showModal = () => { view.dialog.open = true; };
  view.dialog.close = () => { view.dialog.open = false; };
  try {
    model.set_adapter('xiaoxunrss'); model.set_source('/unfinished-project');
    const refreshing = model.refresh();
    assert.deepEqual(sent, { url: '/__jiezi/project', adapter: 'findrss-admin', source: '/worker/admin' });
    assert.equal(model.state.action, 'refresh');
    assert.equal(view.dialog.open, true);
    assert.match(view.dialog.querySelector('h2').textContent, /刷新画板/);
    assert.equal(view.dialog.querySelector('[data-n="project-source-label"]').hidden, true);
    assert.equal(view.dialog.querySelector('[data-n="project-source"]').required, false);
    assert.equal(view.dialog.querySelector('[data-n="project-open-submit"]').disabled, true);
    assert.equal(await model.refresh(), false);
    assert.equal(await model.open(), false);
    model.hide(); assert.equal(model.state.visible, true);
    resolve_request({ ok: false, json: async () => ({ error: 'discovery.frame:12 构建失败' }) });
    assert.equal(await refreshing, false);
    assert.equal(reloaded, 0);
    assert.match(view.dialog.querySelector('[role="alert"]').textContent, /discovery\.frame:12/);
    assert.equal(view.dialog.querySelector('[data-n="project-open-submit"]').textContent, '重试刷新');
    view.dialog.querySelector('form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    resolve_request({ ok: true, json: async () => ({ title: '管理后台', pages: 25, components: 14 }) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reloaded, 1);
    assert.equal(model.state.status, 'ready');
    assert.match(view.dialog.querySelector('[role="status"]').textContent, /已刷新 管理后台/);
  } finally { view.destroy(); }
});

test('项目切换串行构建，失败保留当前项目及监听器，成功更换监听目录并释放旧监听器', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-session-'));
  for (const name of ['next', 'broken']) {
    await mkdir(join(directory, name));
    for (const file of ['views.frame', 'icon.svg', 'preview.css']) await writeFile(join(directory, name, file), 'fixture');
  }
  const watches = [], calls = [];
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const session = await create_project_session(options_from_args([]), {
    registry_file: join(directory, 'projects.json'),
    async build(options) {
      calls.push(options.source);
      if (options.source.endsWith('/broken')) throw new Error('broken/view.js:9:3');
      if (options.source.endsWith('/next') && !release) { await new Promise(resolve => { release = resolve; started(); }); }
      return { adapter: { id: options.adapter, title: '示例', source: options.source, watch: [options.source] }, catalog: [{ kind: 'page' }, { kind: 'component' }], dist: options.source };
    },
    watch_directory(path, options, callback) {
      const watcher = { path, callback, closed: false, close() { this.closed = true; } };
      watches.push(watcher); return watcher;
    },
  });
  try {
    const initial = session.current;
    await assert.rejects(session.open({ adapter: 'demo', source: join(directory, 'broken') }), /broken\/view.js:9:3/);
    assert.equal(session.current, initial);
    assert.ok(watches.every(watcher => !watcher.closed));
    assert.equal(session.describe().projects.length, 1);
    await assert.rejects(session.open({ id: 'unknown' }), error => error.status === 404);
    const opening = session.open({ adapter: 'demo', source: join(directory, 'next') });
    await entered;
    assert.equal(session.describe().status, 'building');
    assert.equal(session.current, initial);
    await assert.rejects(session.open({ adapter: 'demo', source: '' }), error => error.status === 409);
    release();
    const result = await opening;
    assert.equal(result.status, 'ready');
    assert.equal(result.pages, 1); assert.equal(result.components, 1);
    assert.equal(result.projects.length, 2);
    assert.notEqual(result.id, result.projects[0].id);
    assert.equal(JSON.parse(await readFile(join(directory, 'projects.json'), 'utf8')).length, 2);
    assert.ok(session.current.adapter.source.endsWith('/next'));
    assert.ok(watches.slice(0, 2).every(watcher => watcher.closed));
    assert.ok(watches.slice(2).every(watcher => !watcher.closed));
    watches.at(-1).callback('change', 'views.frame');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(calls.at(-1), session.current.adapter.source);
    assert.equal(calls.length, 4);
  } finally { session.close(); await rm(directory, { recursive: true, force: true }); }
  assert.ok(watches.every(watcher => watcher.closed));
});

test('重启后恢复已添加项目，同一目录重复打开不重复登记', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-registry-'));
  const registry_file = join(directory, 'projects.json');
  const saved = { adapter: 'findrss-admin', title: '管理后台', source: join(directory, 'admin') };
  await writeFile(registry_file, JSON.stringify([saved]));
  const config = { registry_file, build: async options => ({ adapter: { id: options.adapter, title: '内置示例', source: options.source }, catalog: [], dist: directory }), watch_directory: () => ({ close() {} }) };
  let session;
  try {
    session = await create_project_session(options_from_args([]), config);
    assert.equal(session.describe().projects.length, 2);
    const saved_project = session.describe().projects[0];
    assert.deepEqual({ ...saved_project, id: undefined }, { ...saved, id: undefined });
    const initial_id = session.describe().id;
    await session.open({ adapter: 'demo', source: '' });
    assert.equal(session.describe().projects.length, 2);
    assert.equal(session.describe().id, initial_id);
    await session.open({ id: initial_id });
    assert.equal(session.describe().id, initial_id);
    session.close();
    session = await create_project_session(options_from_args([]), config);
    assert.equal(session.describe().projects.length, 2);
    assert.equal(session.describe().id, initial_id);
    assert.deepEqual(session.describe().projects.find(project => project.id === saved_project.id), saved_project);
  } finally { session?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('按 ID 打开项目时，目录规范化不改变 ID 或重复登记', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-project-id-'));
  const source = join(directory, 'preview'); await mkdir(source);
  for (const file of ['views.frame', 'icon.svg', 'preview.css']) await writeFile(join(source, file), 'fixture');
  const registry_file = join(directory, 'projects.json');
  await writeFile(registry_file, JSON.stringify([{ id: 'saved-id', adapter: 'demo', title: '示例', source: source + '/' }]));
  const session = await create_project_session(options_from_args([]), {
    registry_file,
    build: async options => ({ adapter: { id: options.adapter, title: '示例', source: options.source }, catalog: [], dist: directory }),
    watch_directory: () => ({ close() {} }),
  });
  try {
    const result = await session.open({ id: 'saved-id' });
    assert.equal(result.id, 'saved-id');
    assert.equal(result.source, await realpath(source));
    assert.equal(result.projects.length, 2);
    assert.equal(result.projects.filter(project => project.id === 'saved-id').length, 1);
  } finally { session.close(); await rm(directory, { recursive: true, force: true }); }
});
