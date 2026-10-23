import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { load_adapter } from '../../build.mjs';
import { configured_project_options } from '../../project-config.mjs';
import { create_direct_preview } from '../../src/direct-preview.js';
import { node_source_location } from '../../src/node-selection.js';

const adapter = await load_adapter(await configured_project_options('findrss-admin'));
const catalog = await adapter.catalog();
const bundled = await build({ entryPoints: [adapter.entry_points.adapter], bundle: true, write: false, format: 'iife', globalName: 'adapter', plugins: adapter.plugins });

function fixture() {
  const { document, window } = parseHTML('<html><body><p data-n="outside">board</p></body></html>');
  document.getSelection = () => null;
  // linkedom 缺少 CodeMirror 挂载时使用的 Range 测量接口；排版仍由浏览器人工验收。
  const create_range = document.createRange.bind(document);
  document.createRange = () => Object.assign(create_range(), {
    setStart() {}, setEnd() {}, getClientRects: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  window.getComputedStyle = element => ({ getPropertyValue: name => element.style.getPropertyValue(name), position: 'static', direction: 'ltr', display: 'block' });
  window.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 });
  const runtime = { document, window, console, URL, URLSearchParams, AbortController, AbortSignal, DOMException, Response, Request, Headers, TextEncoder, TextDecoder, Blob, setTimeout, clearTimeout, setInterval, clearInterval, performance, queueMicrotask, navigator: { userAgent: 'node', platform: 'test' }, fetch() { throw new Error('不允许真实请求'); } };
  vm.runInNewContext(bundled.outputFiles[0].text, runtime);
  const load = async () => ({ adapter: runtime.adapter, styles: [] });
  return { document, window, runtime, load };
}

test('管理后台全部页面与组件可挂载、销毁，不污染白板、不发起真实请求', async t => {
  for (const path of ['/component/discovery_platform/1', '/component/discovery_platform/2', '/components/xiaoxun-agent/1']) {
    assert.ok(catalog.some(frame => frame.path === path && frame.kind === 'component'), `未发现组件预览：${path}`);
  }
  assert.equal(new Set(catalog.map(frame => frame.id)).size, catalog.length);
  assert.ok(catalog.filter(frame => frame.kind === 'page').length >= 20);
  assert.ok(catalog.filter(frame => frame.kind === 'component').length >= 10);
  const f = fixture();
  for (const frame of catalog) await t.test(frame.title, async () => {
    const preview = create_direct_preview({ document: f.document, frame, project: {}, theme: 'light', load: f.load });
    f.document.body.append(preview.host);
    try {
      await preview.ready;
      await new Promise(resolve => setTimeout(resolve, 40));
      assert.equal(preview.host.dataset.status, 'mounted', preview.host.shadowRoot.querySelector('[data-n="preview-status"]')?.textContent);
      assert.ok(preview.root.children.length);
      if (frame.path === '/discovery/1') assert.match(preview.root.textContent, /科技日报/);
      if (frame.path === '/discovery/2') {
        assert.doesNotMatch(preview.root.textContent, /科技日报/);
        assert.match(preview.root.textContent, /没有匹配的订阅源/);
      }
      assert.deepEqual([...preview.root.querySelectorAll('[role="alert"]')].map(node => node.textContent.trim()).filter(Boolean), []);
      assert.equal(f.window.FindRSSAdminUI, undefined);
      assert.equal(f.window.FindRSSAdminAuth, undefined);
      assert.equal(f.document.querySelector('[data-n="outside"]').textContent, 'board');
      assert.equal(f.document.body.children.length, 2);
      assert.ok([...preview.root.querySelectorAll('*')].some(node => node_source_location(node)?.file), preview.root.innerHTML.slice(0, 1500));
      if (frame.key === 'SettingsMcpTokens') {
        const heading = [...preview.root.querySelectorAll('*')].find(node => !node.children.length && node.textContent === 'MCP 授权');
        assert.ok(heading);
        assert.deepEqual(node_source_location(heading), { file: 'pages/settings/mcp-tokens.js', line: 16, column: 5 });
      }
    } finally { preview.destroy(); }
    assert.equal(f.document.body.children.length, 1);
  });
});

test('管理后台多个 Frame 的业务状态和全局依赖相互隔离', async () => {
  const f = fixture(), frame = catalog.find(frame => frame.key === 'checkbox');
  const previews = [1, 2].map(() => create_direct_preview({ document: f.document, frame, project: {}, theme: 'light', load: f.load }));
  f.document.body.append(...previews.map(preview => preview.host));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(previews.every(preview => preview.host.dataset.status === 'mounted'));
    const boxes = previews.map(preview => preview.root.querySelector('[role="checkbox"]'));
    assert.ok(boxes.every(box => box.getAttribute('aria-checked') === 'true'));
    boxes[0].dispatchEvent(new f.window.Event('click', { bubbles: true }));
    assert.equal(boxes[0].getAttribute('aria-checked'), 'false');
    assert.equal(boxes[1].getAttribute('aria-checked'), 'true');
    previews[0].destroy();
    boxes[1].dispatchEvent(new f.window.Event('click', { bubbles: true }));
    assert.equal(boxes[1].getAttribute('aria-checked'), 'false');
  } finally { previews.forEach(preview => preview.destroy()); }
});


test('新增订阅源组件默认打开、关闭后可重开，多个预览草稿互不影响', async () => {
  const f = fixture(), frame = catalog.find(frame => frame.path === '/discovery/components/create-source/1');
  assert.equal(frame?.kind, 'component');
  const previews = [1, 2].map(() => create_direct_preview({ document: f.document, frame, project: {}, theme: 'light', load: f.load }));
  previews.forEach(preview => preview.set_size(frame.width, frame.height));
  f.document.body.append(...previews.map(preview => preview.host));
  const dialog = preview => preview.root.querySelector('[role="dialog"][aria-label="订阅源表单"]');
  function check_viewport_styles(preview) {
    assert.equal(preview.host.style.getPropertyValue('--jiezi-viewport-height'), '1800px');
    assert.equal(dialog(preview).style.getPropertyValue('max-height'), 'calc(calc(var(--jiezi-viewport-height) * 100 / 100) - 48px)');
    assert.equal(dialog(preview).style.getPropertyValue('--max-height-85-vh'), 'calc(var(--jiezi-viewport-height) * 85 / 100)');
    assert.equal(dialog(preview).style.getPropertyValue('--max-560-max-height'), 'calc(calc(var(--jiezi-viewport-height) * 100 / 100) - 16px)');
    assert.match(dialog(preview).style.width, /var\(--jiezi-viewport-width\)/);
    assert.doesNotMatch(dialog(preview).style.width, /100vw/);
  }
  try {
    await Promise.all(previews.map(preview => preview.ready));
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.ok(previews.every(preview => preview.host.dataset.status === 'mounted'));
    assert.ok(previews.every(dialog));
    previews.forEach(check_viewport_styles);
    assert.match(dialog(previews[0]).textContent, /新增订阅源/);
    const input = dialog(previews[0]).querySelector('input[aria-label="名称"]');
    assert.ok(input);
    input.value = '组件预览草稿';
    input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(dialog(previews[1]).querySelector('input[aria-label="名称"]').value, '');
    dialog(previews[0]).querySelector('[aria-label="关闭订阅源表单"]').dispatchEvent(new f.window.Event('click', { bubbles: true }));
    assert.equal(dialog(previews[0]), null);
    assert.ok(dialog(previews[1]));
    previews[0].root.querySelector('button').dispatchEvent(new f.window.Event('click', { bubbles: true }));
    assert.ok(dialog(previews[0]));
    await new Promise(resolve => setImmediate(resolve));
    check_viewport_styles(previews[0]);
    assert.equal(dialog(previews[0]).querySelector('input[aria-label="名称"]').value, '');
    assert.equal(f.document.querySelectorAll('[role="dialog"]').length, 0);
  } finally { previews.forEach(preview => preview.destroy()); }
  assert.equal(f.document.body.children.length, 1);
});
