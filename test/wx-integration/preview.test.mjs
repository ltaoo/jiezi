import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { load_adapter } from '../../build.mjs';
import { configured_project_options } from '../../project-config.mjs';
import { create_direct_preview } from '../../src/direct-preview.js';
import { node_source_location } from '../../src/node-selection.js';

const adapter = await load_adapter(await configured_project_options('wx-channels'));
const catalog = await adapter.catalog();
const bundled = await build({ entryPoints: [adapter.entry_points.adapter], bundle: true, write: false, format: 'iife', globalName: 'adapter', plugins: adapter.plugins });

function fixture() {
  const { document, window } = parseHTML('<html><body><p data-n="outside">board</p></body></html>');
  document.title = '芥子白板';
  window.screen = { availHeight: 800, availWidth: 1200 };
  window.matchMedia = query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.getComputedStyle = element => ({ getPropertyValue: name => element.style.getPropertyValue(name), position: 'static', direction: 'ltr', display: 'block', paddingTop: '0px', paddingBottom: '0px' });
  window.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 });
  const runtime = { document, window, Document: window.Document, console, URL, URLSearchParams, AbortController, AbortSignal, DOMException, Response, Request, Headers, TextEncoder, TextDecoder, Blob, setTimeout, clearTimeout, setInterval, clearInterval, performance, queueMicrotask, fetch() { throw new Error('不允许真实请求'); } };
  runtime.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe(target) { queueMicrotask(() => this.callback([{ target, isIntersecting: true }])); }
    unobserve() {}
    disconnect() {}
  };
  vm.runInNewContext(bundled.outputFiles[0].text, runtime);
  return { document, window, load: async () => ({ adapter: runtime.adapter, styles: [] }) };
}

test('Download & Manage 全部真实页面和组件可挂载、销毁，作用域与请求隔离', async t => {
  assert.equal(catalog.filter(frame => frame.kind === 'page').length, 28);
  assert.equal(catalog.filter(frame => frame.mock).length, 19);
  assert.equal(new Set(catalog.map(frame => frame.path)).size, catalog.length);
  for (const frame of catalog.filter(frame => frame.kind === 'page' && !frame.mock)) {
    assert.ok(catalog.some(mock => mock.mock && mock.key === frame.key && mock.path === `${frame.path}/mock`));
  }
  assert.equal(catalog.filter(frame => frame.kind === 'component').length, 12);
  assert.equal(catalog.find(frame => frame.key === 'browsehistory').path, '/browsehistory');
  assert.equal(catalog.find(frame => frame.key === 'content').path, '/content');
  assert.equal(new Set(catalog.filter(frame => frame.kind === 'page').map(frame => frame.path.split('/')[1])).size, 14);
  const f = fixture();
  for (const frame of catalog) await t.test(frame.title, async () => {
    const errors = [];
    const preview = create_direct_preview({ document: f.document, frame, project: {}, theme: 'light', load: f.load, on_error: error => errors.push(error.message) });
    f.document.body.append(preview.host);
    try {
      await preview.ready;
      await new Promise(resolve => setTimeout(resolve, 60));
      assert.equal(preview.host.dataset.status, 'mounted', preview.host.shadowRoot.querySelector('[data-n="preview-status"]')?.textContent);
      assert.deepEqual(errors, []);
      assert.ok(preview.root.children.length);
      assert.equal(f.window.Timeless, undefined);
      assert.equal(f.window.dl$, undefined);
      assert.equal(f.document.title, '芥子白板');
      assert.equal(f.document.querySelector('[data-n="outside"]').textContent, 'board');
      assert.equal(f.document.body.children.length, 2);
      assert.ok([...preview.root.querySelectorAll('*')].some(node => node_source_location(node)?.file), `${frame.path} 缺少节点来源`);
      if (frame.key !== 'alert') assert.deepEqual([...preview.root.querySelectorAll('[role="alert"]')].map(node => node.textContent.trim()).filter(Boolean), []);
      if (frame.mock && !frame.shell_preview) assert.match(preview.root.textContent + [...preview.root.querySelectorAll('input')].map(node => node.value).join(' '), /Mock · /, `${frame.key} 应显示示例记录`);
    } finally { preview.destroy(); }
    assert.equal(f.document.body.children.length, 1);
  });
});

test('内容管理卡片预览显示真实卡片与封面，原有列表预览保持独立', async () => {
  const f = fixture();
  const previews = ['/content/card', '/content/mock'].map(path => create_direct_preview({ document: f.document, frame: catalog.find(frame => frame.path === path), project: {}, theme: 'light', load: f.load }));
  f.document.body.append(...previews.map(preview => preview.host));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.ok(previews.every(preview => preview.host.dataset.status === 'mounted'));
    const [cards, list] = previews;
    assert.equal(cards.root.querySelectorAll('[n="content-card"]').length, 2);
    assert.match(cards.root.querySelector('[n="content-card-title"]').textContent, /Mock · 山野漫游/);
    assert.equal(cards.root.querySelectorAll('[n="content-card-image"]').length, 2);
    assert.equal(cards.root.querySelector('[n="content-table-panel"]'), null);
    assert.ok(list.root.querySelector('[n="content-table-panel"]'));
    assert.equal(list.root.querySelector('[n="content-card-grid"]'), null);
    assert.equal(f.document.body.children.length, 3);
  } finally { previews.forEach(preview => preview.destroy()); }
});

test('Shell 布局可打开设置，弹窗三个菜单可切换，独立内容预览有真实数据', async () => {
  const f = fixture();
  const previews = catalog.filter(frame => frame.shell_preview).map(frame => create_direct_preview({ document: f.document, frame, project: {}, theme: 'light', load: f.load }));
  f.document.body.append(...previews.map(preview => preview.host));
  const click = (root, selector) => {
    const node = root.querySelector(selector);
    assert.ok(node, selector);
    node.dispatchEvent(new f.window.Event('click', { bubbles: true }));
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 40));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    await settle();
    for (const preview of previews) assert.equal(preview.host.dataset.status, 'mounted', preview.host.shadowRoot.textContent);
    const [shell, settings, certificate, mcp, about] = previews;
    assert.ok(shell.root.querySelector('[n="app-sider"]'));
    assert.match(shell.root.querySelector('[n="app-content"]').textContent, /Mock · 山野漫游/);
    click(shell.root, '[n="app-menu-content"]');
    await settle();
    assert.ok(shell.root.querySelector('[data-name="root.shell.content"]'));
    click(shell.root, '[n="app-settings-action"]');
    await settle();
    assert.match(shell.root.querySelector('[n="settings-dialog"]').textContent, /Mock · Download & Manage Root CA/);
    click(settings.root, '[n="settings-mcp-menu-action"]');
    await settle();
    assert.match(settings.root.textContent, /Streamable HTTP/);
    assert.match(settings.root.textContent, /get_platform_status/);
    click(settings.root, '[n="settings-about-menu-action"]');
    assert.match(settings.root.textContent, /GitHub 仓库/);
    click(settings.root, '[n="settings-certificate-menu-action"]');
    assert.match(settings.root.textContent, /已安装并受信任/);
    assert.match(certificate.root.textContent, /D&M Preview Root CA/);
    assert.match(mcp.root.textContent, /Streamable HTTP/);
    assert.match(about.root.textContent, /GitHub 仓库/);
    assert.equal(f.document.body.children.length, 6);
  } finally { previews.forEach(preview => preview.destroy()); }
  assert.equal(f.document.body.children.length, 1);
});

test('多个组件 Frame 状态独立，卸载一个后另一个仍可交互', async () => {
  const f = fixture(), frame = catalog.find(frame => frame.key === 'checkbox');
  const previews = [1, 2].map(() => create_direct_preview({ document: f.document, frame, project: {}, theme: 'light', load: f.load }));
  f.document.body.append(...previews.map(preview => preview.host));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    assert.ok(previews.every(preview => preview.host.dataset.status === 'mounted'));
    const boxes = previews.map(preview => preview.root.querySelector('[role="checkbox"]'));
    assert.ok(boxes.every(Boolean));
    const initial = boxes[1].getAttribute('aria-checked');
    boxes[0].dispatchEvent(new f.window.Event('click', { bubbles: true }));
    assert.notEqual(boxes[0].getAttribute('aria-checked'), initial);
    assert.equal(boxes[1].getAttribute('aria-checked'), initial);
    previews[0].destroy();
    boxes[1].dispatchEvent(new f.window.Event('click', { bubbles: true }));
    assert.notEqual(boxes[1].getAttribute('aria-checked'), initial);
  } finally { previews.forEach(preview => preview.destroy()); }
});
