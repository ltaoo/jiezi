import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { create_direct_preview } from '../../src/direct-preview.js';
import { shadow_styles } from '../../src/shadow_styles.mjs';
import { load_adapter, root } from '../../build.mjs';
import { configured_project_options } from '../../project-config.mjs';

const adapter = await load_adapter(await configured_project_options('xiaoxunrss'));
const catalog = await adapter.catalog();
const frame = catalog.find(item => item.exported === 'SettingsAboutPage');
const ai_frame = catalog.find(item => item.exported === 'SettingsAIPage');
const rendered_module = await build({ stdin: { contents: `import * as adapter from './adapters/xiaoxunrss/direct.js'; import { previews } from 'canvas-preview-registry'; import { create_ai_store } from '@project/frontend/src/canvas/ai.model.js'; import { CanvasTransportModel } from '@project/frontend/src/canvas/transport.model.js'; import { ReaderPreviewModel } from '@project/frontend/src/canvas/reader.model.js'; import { BackgroundQueuePage } from '@project/frontend/src/pages/background-queue.js'; import { create_canvas_host } from '@project/frontend/src/canvas/host.js'; import { with_frui_host } from "@project/frontend/src/components/frui/platform.js"; Object.assign(globalThis, { adapter, previews, create_ai_store, CanvasTransportModel, ReaderPreviewModel, BackgroundQueuePage, create_canvas_host, with_frui_host });`, resolveDir: root }, bundle: true, write: false, format: 'iife', plugins: adapter.plugins, nodePaths: [join(adapter.source, 'node_modules')] });

async function fixture() {
  // Node DOM 模型，只验证挂载结果和生命周期，不执行浏览器或布局引擎。
  const { document, window } = parseHTML('<html><head></head><body><main data-n="board-test"></main></body></html>');
  document.getSelection = () => null;
  // DOM 模型不提供布局：只给浮层注册所需的接口，不断言屏幕坐标。
  window.Element.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 32, width: 100, height: 32 });
  window.Element.prototype.getClientRects = () => [];
  window.Element.prototype.scrollTo = function() {};
  window.Element.prototype.scrollIntoView = function() {};
  window.Element.prototype.focus = function() {};
  window.Element.prototype.pause = function() {};
  window.Element.prototype.play = async function() {};
  window.Element.prototype.load = function() {};
  const getComputedStyle = () => ({ position: 'static', direction: 'ltr', overflow: 'visible', overflowY: 'visible', overflowX: 'visible', getPropertyValue() { return ''; } });
  class LayoutObserver { observe() {} unobserve() {} disconnect() {} }
  window.getComputedStyle = getComputedStyle;
  window.ResizeObserver = LayoutObserver;
  window.MutationObserver = LayoutObserver;
  const runtime = { window, document, DOMParser: window.DOMParser, Element: window.Element, HTMLElement: window.HTMLElement, console, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, Date, AbortSignal, AbortController, crypto: webcrypto, getComputedStyle, ResizeObserver: LayoutObserver, MutationObserver: LayoutObserver, IntersectionObserver: LayoutObserver, queueMicrotask, structuredClone, navigator: { userAgent: 'Node DOM fixture' } };
  runtime.fetch = () => { throw new Error('预览不得请求真实后端'); };
  for (const file of ['timeless.umd.min.js', 'timeless.dom.umd.min.js', 'timeless.web.umd.min.js']) {
    vm.runInNewContext(await readFile(join(adapter.source, 'public/assets/timeless/0.34.2', file), 'utf8'), runtime);
  }
  vm.runInNewContext(rendered_module.outputFiles[0].text, runtime);
  const load = async () => ({ adapter: runtime.adapter, styles: [shadow_styles(':root { --frui-color-text: black; } body { margin: 0; }')] });
  return { document, window, runtime, load };
}

test('真实关于页面挂到 Frame 的同一 Document 中，不创建 iframe', async () => {
  const { document, load } = await fixture();
  const previews = [1, 2].map(() => create_direct_preview({ document, frame, theme: 'light', project: {}, load }));
  document.querySelector('main').append(...previews.map(preview => preview.host));
  await Promise.all(previews.map(preview => preview.ready));
  for (const preview of previews) {
    assert.equal(preview.host.dataset.status, 'mounted');
    const page = preview.host.shadowRoot.querySelector('[n="settings-about-page"]');
    assert.ok(page);
    assert.equal(page.ownerDocument, document);
    assert.match(page.textContent, /小讯，陪你一起读/);
    assert.match(page.textContent, /版本/);
    assert.equal(page.querySelector('img').getAttribute('src'), '/xiaoxun-logo.svg');
    assert.equal(preview.host.shadowRoot.querySelector('iframe'), null);
  }
  assert.equal(document.querySelector('iframe'), null);
  assert.equal(document.querySelector('[n="settings-about-page"]'), null);
  assert.equal(document.querySelector('[data-n="preview-project-style"]'), null);
  previews[0].set_theme('dark');
  assert.equal(previews[0].host.dataset.theme, 'dark');
  assert.equal(previews[1].host.dataset.theme, 'light');
  previews[0].destroy();
  assert.equal(previews[0].host.isConnected, false);
  assert.equal(previews[0].host.shadowRoot.childNodes.length, 0);
  assert.ok(previews[1].host.shadowRoot.querySelector('[n="settings-about-page"]'));
  previews[1].destroy();
});

test('真实 render 抛出的字符串也在 Frame 中显示，并包含来源文件', async () => {
  const { document, runtime, load } = await fixture();
  let disposed = 0;
  runtime.previews[frame.module] = async () => ({ _Preview: [{ name: frame.preview_name, path: frame.path, render() {
    runtime.Timeless.getOwner().disposables.push(() => disposed++);
    throw '<bad-render>';
  } }] });
  const preview = create_direct_preview({ document, frame, project: {}, theme: 'light', load });
  document.body.append(preview.host);
  try {
    await preview.ready;
    assert.equal(preview.host.dataset.status, 'error');
    const error = preview.host.shadowRoot.querySelector('[role="alert"]');
    assert.match(error.textContent, /<bad-render>/);
    assert.ok(error.textContent.includes(frame.file));
    assert.equal(error.querySelector('bad-render'), null);
    assert.equal(disposed, 1);
  } finally { preview.destroy(); }
});

test('挂载后的条件渲染异常显示在对应 Frame，释放资源且其他 Frame 继续正常显示', async () => {
  const { document, runtime, load } = await fixture();
  const healthy = create_direct_preview({ document, frame, project: {}, theme: 'light', load });
  document.body.append(healthy.host); await healthy.ready;
  const visible = runtime.Timeless.ref(false);
  let destroyed = 0, disposed = 0;
  const errors = [];
  runtime.previews[frame.module] = async () => ({ _Preview: [{ name: frame.preview_name, path: frame.path,
    render() {
      runtime.Timeless.getOwner().disposables.push(() => disposed++);
      return runtime.Timeless.View({ attributes: { n: 'failing-preview' }, onUnmounted() { destroyed++; } }, [
        runtime.Timeless.Show({ when: visible, ok() { throw new Error('conditional render failed'); } }),
      ]);
    },
  }] });
  const broken = create_direct_preview({ document, frame, project: {}, theme: 'light', load, on_error: error => errors.push(error) });
  document.body.append(broken.host);
  try {
    await broken.ready;
    assert.equal(broken.host.dataset.status, 'mounted');
    visible.as(true);
    await Promise.resolve();
    assert.equal(broken.host.dataset.status, 'error');
    assert.match(broken.host.shadowRoot.querySelector('[role="alert"]').textContent, /conditional render failed/);
    assert.match(broken.host.shadowRoot.querySelector('[role="alert"]').textContent, /Error: conditional render failed/);
    assert.equal(errors.length, 1);
    assert.equal(destroyed, 1);
    assert.equal(disposed, 1);
    assert.equal(healthy.host.dataset.status, 'mounted');
    assert.ok(healthy.root.querySelector('[n="settings-about-page"]'));
  } finally { broken.destroy(); healthy.destroy(); }
  assert.equal(destroyed, 1);
});

test('懒加载渲染失败和延迟 onMounted 异常均回传到 Frame', async t => {
  for (const phase of ['lazy', 'mounted']) await t.test(phase, async () => {
    const { document, runtime, load } = await fixture();
    let reject;
    const pending = new Promise((_resolve, fail) => { reject = fail; });
    runtime.previews[frame.module] = async () => ({ _Preview: [{ name: frame.preview_name, path: frame.path,
      render() {
        if (phase === 'lazy') return runtime.Timeless.LazyView({}, () => pending);
        return runtime.Timeless.View({ attributes: { n: 'mounted-error-preview' }, onMounted() { throw new Error('mounted failed'); } });
      },
    }] });
    const preview = create_direct_preview({ document, frame, project: {}, theme: 'light', load });
    document.body.append(preview.host);
    try {
      await preview.ready;
      if (phase === 'lazy') reject(new Error('lazy failed'));
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(preview.host.dataset.status, 'error');
      assert.ok(preview.host.shadowRoot.querySelector('[role="alert"]').textContent.includes(`${phase} failed`));
    } finally { preview.destroy(); }
  });
});

test('大模型页面使用真实 View 和设置切片直接渲染，模型配置可展开', async () => {
  const { document, window, load } = await fixture();
  const preview = create_direct_preview({ document, frame: ai_frame, theme: 'light', project: {}, load });
  document.body.append(preview.host);
  await preview.ready;
  try {
    assert.equal(preview.host.dataset.status, 'mounted');
    const shadow = preview.host.shadowRoot;
    assert.ok(shadow.querySelector('[n="settings-ai-form"]'));
    assert.match(shadow.querySelector('[n="settings-ai-editor"]').textContent, /OpenAI/);
    assert.ok(shadow.querySelector('[n="settings-save-button"]'));
    const configure = shadow.querySelector('button[n^="settings-ai-model-configure-"]');
    assert.ok(configure);
    configure.dispatchEvent(new window.Event('click'));
    assert.ok(shadow.querySelector('[n^="settings-ai-model-details-"]'));
    const input = shadow.querySelector('input[n^="settings-ai-model-name-input-"]');
    assert.ok(input);
    input.value = '白板编辑模型'; input.dispatchEvent(new window.Event('input'));
    assert.match(shadow.querySelector('[n^="settings-ai-model-name-"]').textContent, /白板编辑模型/);
    assert.equal(document.querySelector('[n="settings-ai-form"]'), null);
    assert.equal(document.querySelector('iframe'), null);
  } finally { preview.destroy(); }
});

test('模型配置区保留布局样式，展开状态使用 ARIA 字符串', async () => {
  const { document, window, load } = await fixture();
  const preview = create_direct_preview({ document, frame: ai_frame, theme: 'light', project: {}, load });
  document.body.append(preview.host); await preview.ready;
  try {
    const shadow = preview.host.shadowRoot;
    const configure = shadow.querySelector('button[n^="settings-ai-model-configure-"]');
    configure.dispatchEvent(new window.Event('click'));
    const expanded = configure.getAttribute('aria-expanded');
    assert.equal(expanded, 'true');
    const parameters = shadow.querySelector('[n^="settings-ai-parameters-"]');
    assert.match(parameters.getAttribute('class'), /grid-cols-/);
    assert.equal(parameters.style.getPropertyValue('--grid-template-columns'), 'repeat(2, minmax(0, 1fr))');
  } finally { preview.destroy(); }
});

test('Select 浮层保留在 Frame 中，卸载后不残留到全局文档', async () => {
  const { document, window, load } = await fixture();
  const preview = create_direct_preview({ document, frame: ai_frame, theme: 'light', project: {}, load });
  document.body.append(preview.host); await preview.ready;
  try {
    const shadow = preview.host.shadowRoot;
    shadow.querySelector('button[n^="settings-ai-model-configure-"]').dispatchEvent(new window.Event('click'));
    const select = shadow.querySelector('button[aria-label="推理深度"]');
    assert.ok(select);
    select.dispatchEvent(new window.Event('click'));
    assert.ok(shadow.querySelector('[role="listbox"]'));
    assert.equal(document.body.querySelector('[role="listbox"]'), null);
  } finally { preview.destroy(); }
  assert.equal(document.body.querySelector('[role="listbox"]'), null);
});

test('设置实例之间互不影响，真实保存和连接测试只经过内存传输', async () => {
  const { runtime } = await fixture();
  const first = runtime.create_ai_store(), second = runtime.create_ai_store();
  try {
    const provider = first.state.settings_draft.value.ai_providers.find(provider => provider.enabled);
    first.methods.update_ai_entry('provider', provider.id, { name: '改名示例' });
    assert.equal(second.state.settings_draft.value.ai_providers.find(item => item.id === provider.id).name, 'OpenAI');
    first.methods.set_ai_key(provider.id, 'preview-only-key');
    const result = await first.methods.test_ai_provider(provider, provider.models[0].id);
    assert.equal(result.elapsed_ms, 12);
    await first.methods.save_settings();
    assert.equal(first.state.settings_error.value, '');
    assert.equal(first.state.settings.value.ai.providers.find(item => item.id === provider.id).name, '改名示例');
    assert.ok(first.events.some(event => event.path === '/api/ai/test'));
    assert.ok(first.events.some(event => event.path === '/api/setting'));
    assert.ok(!JSON.stringify(first.events).includes('preview-only-key'));
    first.methods.set_ai_key(provider.id, null);
    await first.methods.save_settings();
    assert.equal(Boolean(first.state.settings.value.ai.providers.find(item => item.id === provider.id).api_key_configured), false);
    first.methods.reset_settings('ai');
    assert.match(first.state.settings_message.value, /恢复默认值/);
  } finally { first.destroy(); second.destroy(); }
});

test('全部 _Previews 示例均可挂载和销毁，真实 fetch 不可用时仍渲染成功', async t => {
  const { document, load } = await fixture();
  for (const item of catalog) {
    await t.test(`${item.module}#${item.preview_name || '(默认)'}`, async () => {
      const errors = [];
      const preview = create_direct_preview({ document, frame: item, theme: 'light', project: {}, load, on_error: error => errors.push(error) });
      document.body.append(preview.host);
      try {
        await preview.ready;
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(preview.host.dataset.status, 'mounted', errors[0]?.stack);
        assert.ok(preview.root.childNodes.length, '入口必须返回可渲染的 View');
        assert.ok(!preview.root.textContent.includes('[object Object]'), '不能把 props 或节点描述当作 View 返回');
      } finally { preview.destroy(); }
      assert.equal(document.body.childNodes.length, 1, '只有测试 main 保留在全局文档中');
      assert.equal(errors.length, 0);
    });
  }
});

test('同模块登录示例隔离，密码错误示例已填值且真实字段显示错误', async () => {
  const { document, load } = await fixture();
  const items = catalog.filter(item => item.exported === 'LoginPage');
  const previews = items.map(item => create_direct_preview({ document, frame: item, project: {}, theme: 'light', load }));
  document.body.append(...previews.map(preview => preview.host));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    const normal = previews[items.findIndex(item => item.preview_name === '登录')];
    const invalid = previews[items.findIndex(item => item.preview_name === '密码错误')];
    assert.equal(normal.host.dataset.status, 'mounted'); assert.equal(invalid.host.dataset.status, 'mounted');
    assert.ok(!normal.root.textContent.includes('邮箱或密码错误，请重试'));
    assert.ok(invalid.root.textContent.includes('邮箱或密码错误，请重试'));
    assert.equal(invalid.root.querySelector('input[type="email"]').value, 'reader@example.com');
    assert.equal(invalid.root.querySelector('input[type="password"]').value, 'incorrect-password');
    assert.equal(normal.root.querySelector('input[type="password"]').value, '');
  } finally { previews.forEach(preview => preview.destroy()); }
});

test('预览注入真实 RouteViewCore，保留 query、href、事件并在卸载时清理', async () => {
  const { runtime, document } = await fixture();
  const host = runtime.create_canvas_host(document.createElement('div'));
  const { RouteViewCore } = runtime.Timeless.kit;
  const view = new RouteViewCore({ name: 'root.ReaderLayout.AutomationEdit', pathname: '/flow-edit', title: '编辑流程', query: { id: 'new', template: 'rule' } });
  let model;
  const scope = runtime.with_frui_host(host, () => {
    model = runtime.ReaderPreviewModel({ pathname: view.pathname, view });
    return runtime.Timeless.View({ attributes: { n: 'route-preview-test' } });
  });
  let shows = 0, destroyed = 0;
  const destroy = view.destroy.bind(view);
  view.destroy = () => { destroyed++; destroy(); };
  try {
    assert.equal(model.props.view, view);
    assert.ok(model.props.view instanceof RouteViewCore);
    const url = new URL(view.href, 'https://canvas.invalid');
    assert.equal(url.pathname, '/flow-edit');
    assert.equal(url.searchParams.get('template'), 'rule');
    view.onShow(() => shows++);
    view.show();
    view.setShow();
    assert.equal(shows, 1);
  } finally { scope.destroy(); model.destroy(); model.destroy(); host.destroy(); }
  assert.equal(destroyed, 1);
  assert.equal(view.$presence.show_timer, null);
  assert.equal(view.$presence.hide_timer, null);
});

test('自动化列表与编辑页独立预览，编辑页读取显式 view.query 的规则模板', async () => {
  const { document, load } = await fixture();
  const items = catalog.filter(item => item.module === 'frontend/src/pages/automation.frame');
  assert.equal(items.length, 2);
  const previews = items.map(item => create_direct_preview({ document, frame: item, project: {}, theme: 'light', load }));
  document.body.append(...previews.map(preview => preview.host));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    await new Promise(resolve => setTimeout(resolve, 20));
    const list = previews[items.findIndex(item => item.preview_name === '自动化流程')];
    const edit = previews[items.findIndex(item => item.preview_name === '编辑流程')];
    assert.ok(list.root.querySelector('[n="flow-list-page"]'));
    assert.equal(list.root.querySelector('[n="flow-edit-route"]'), null);
    assert.ok(edit.root.querySelector('[n="flow-edit-route"]'));
    assert.equal(edit.root.querySelector('[n="flow-list-page"]'), null);
    assert.match(edit.root.textContent, /关键词并且包含图片/);
  } finally { previews.forEach(preview => preview.destroy()); }
});

test('后台队列的 URL 示例选中下载 Tab，默认页仍选中订阅源', async () => {
  const { document, load } = await fixture();
  const items = catalog.filter(item => item.module === 'frontend/src/pages/background-queue.frame');
  assert.equal(items.length, 2);
  const previews = items.map(item => create_direct_preview({ document, frame: item, project: {}, theme: 'light', load }));
  document.body.append(...previews.map(preview => preview.host));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    const normal = previews[items.findIndex(item => item.path === '/background-queue/1')];
    const download = previews[items.findIndex(item => item.preview_name === '文件下载')];
    assert.equal(normal.root.querySelector('[n="queue-tabs-subscription"]').getAttribute('aria-selected'), 'true');
    assert.equal(download.root.querySelector('[n="queue-tabs-download"]').getAttribute('aria-selected'), 'true');
    assert.equal(download.root.querySelector('[n="queue-tabs-subscription"]').getAttribute('aria-selected'), 'false');
    assert.equal(download.root.querySelector('[n="queue-filter-form"]').getAttribute('aria-label'), '文件下载筛选');
  } finally { previews.forEach(preview => preview.destroy()); }
});

test('后台队列未知的 query Tab 回退订阅源，首个请求与选中项一致', async () => {
  const { runtime, document } = await fixture();
  const root = document.createElement('div');
  document.body.append(root);
  const host = runtime.create_canvas_host(root);
  const view = new runtime.Timeless.kit.RouteViewCore({ name: 'root.ReaderLayout.BackgroundQueue', pathname: '/queue', title: '后台队列', query: { tab: 'unknown' } });
  const calls = [];
  let model;
  const page = runtime.with_frui_host(host, () => {
    model = runtime.ReaderPreviewModel({ pathname: view.pathname, view });
    const fetch = model.props.http_client.fetch;
    model.props.http_client.fetch = options => { calls.push(new URL(options.url, 'https://canvas.invalid')); return fetch(options); };
    return runtime.BackgroundQueuePage(model.props);
  });
  runtime.Timeless.DOM.render(page, root);
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(root.querySelector('[n="queue-tabs-subscription"]').getAttribute('aria-selected'), 'true');
    const request = calls.find(url => url.pathname === '/api/background-queue/list');
    assert.ok(request);
    assert.equal(request.searchParams.get('group'), 'subscription');
  } finally { page.destroy(); model.destroy(); host.destroy(); root.remove(); }
});

test('阅读器菜单预览使用桌面尺寸与真实页面的 88px 侧栏父容器', async () => {
  const { document, load } = await fixture();
  const item = catalog.find(item => item.exported === 'ReaderIconMenuView');
  assert.equal(item.width, 1200); assert.equal(item.height, 800); assert.equal(item.layout, 'fill');
  const mobile = catalog.find(item => item.exported === 'ReaderIconMenuView' && item.preview_name === '阅读器菜单 · 手机');
  assert.equal(mobile.width, 390); assert.equal(mobile.height, 844);
  const preview = create_direct_preview({ document, frame: item, project: {}, theme: 'light', load });
  document.body.append(preview.host);
  try {
    await preview.ready;
    assert.equal(preview.host.dataset.status, 'mounted');
    const parent = preview.root.querySelector('[n="canvas-reader-menu-layout"]');
    const menu = parent.querySelector('[n="reader-icon-menu"]');
    assert.equal(parent.style.gridTemplateColumns, '88px minmax(0, 1fr)');
    assert.equal(menu.parentElement, parent);
    assert.ok(menu.classList.contains('flex-col'));
    const css = shadow_styles(await readFile(join(adapter.source, 'frontend/src/components/reader/styles.css'), 'utf8'));
    assert.match(css, /@container preview-size \(max-width: 720px\)/);
  } finally { preview.destroy(); }
});

test('过期的示例索引或名称在构造宿主前报错', async () => {
  const { runtime, document } = await fixture();
  let created = 0;
  await assert.rejects(runtime.adapter.mount({ ...frame, preview_index: 99 }, document.createElement('div'), { create_host() { created++; } }), /预览声明已变化/);
  await assert.rejects(runtime.adapter.mount({ ...frame, preview_name: 'stale' }, document.createElement('div'), { create_host() { created++; } }), /预览声明已变化/);
  assert.equal(created, 0);
});

test('模块按需加载时取消 Frame，不会构建预览 props 或宿主', async () => {
  const { runtime, document } = await fixture();
  const abort = new AbortController();
  abort.abort();
  let created = 0;
  await runtime.adapter.mount(frame, document.createElement('div'), { signal: abort.signal, create_host() { created++; } });
  assert.equal(created, 0);
});

test('预览 HttpClient 实例隔离，未知接口明确拒绝且不回退到真实传输', async () => {
  const { runtime } = await fixture();
  const first = runtime.CanvasTransportModel(), second = runtime.CanvasTransportModel();
  try {
    await first.client.fetch({ url: '/api/setting', method: 'POST', data: { profile: { name: '仅修改当前 Frame' } } });
    assert.equal(first.settings.profile.name, '仅修改当前 Frame');
    assert.equal(second.settings.profile.name, '白板示例账号');
    await assert.rejects(first.client.fetch({ url: '/api/not-a-fixture', method: 'GET' }), /白板未声明模拟接口/);
    first.destroy();
    assert.equal((await first.client.fetch({ url: '/api/setting', method: 'GET' })).status, 410);
  } finally { first.destroy(); second.destroy(); }
});

test('对话记录示例默认选中并显示消息，切换记录后更新右侧内容', async () => {
  const { document, window, load } = await fixture();
  const frame = catalog.find(item => item.path === '/dialogue/2');
  const preview = create_direct_preview({ document, frame, theme: 'light', project: {}, load });
  document.body.append(preview.host);
  await preview.ready;
  try {
    assert.equal(preview.host.dataset.status, 'mounted');
    const shadow = preview.host.shadowRoot;
    for (let attempt = 0; attempt < 50 && !shadow.querySelector('[n="dialogue-history-item"]'); attempt++)
      await new Promise(resolve => setTimeout(resolve, 20));
    const records = shadow.querySelectorAll('[n="dialogue-history-item"]');
    assert.equal(records.length, 2);
    assert.equal(records[0].getAttribute('aria-current'), 'true');
    assert.equal(shadow.querySelectorAll('[n="xiaoxun-dialogue-message"]').length, 4);
    assert.match(shadow.querySelector('[n="dialogue-panel"]').textContent, /近期想读/);
    records[1].dispatchEvent(new window.Event('click'));
    for (let attempt = 0; attempt < 50 && records[1].getAttribute('aria-current') !== 'true'; attempt++)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(records[1].getAttribute('aria-current'), 'true');
    assert.equal(shadow.querySelectorAll('[n="xiaoxun-dialogue-message"]').length, 2);
    assert.match(shadow.querySelector('[n="dialogue-panel"]').textContent, /主动选择信息/);
    assert.equal(shadow.querySelector('[n="xiaoxun-dialogue-error"]').textContent, '');
  } finally { preview.destroy(); }
});

test('Frame 宿主把缩放后的屏幕矩形转成自身坐标', async () => {
  const { runtime, document } = await fixture();
  const root = document.createElement('div');
  Object.defineProperty(root, 'offsetWidth', { value: 400 });
  root.getBoundingClientRect = () => ({ left: 50, top: 80, width: 200, height: 150 });
  const host = runtime.create_canvas_host(root);
  try {
    const rect = host.rect({ left: 100, top: 120, width: 40, height: 20 });
    assert.deepEqual(JSON.parse(JSON.stringify(rect)), { x: 100, y: 80, left: 100, top: 80, width: 80, height: 40, right: 180, bottom: 120 });
  } finally { host.destroy(); }
});


test('预览构造失败释放已注册的作用域资源', async () => {
  const { runtime } = await fixture();
  let cleaned = 0;
  assert.throws(() => runtime.with_frui_host({}, () => {
    runtime.Timeless.getOwner().disposables.push(() => { cleaned++; });
    throw new Error('fixture constructor failed');
  }), /fixture constructor failed/);
  assert.equal(cleaned, 1);
});
