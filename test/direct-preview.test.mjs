import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { create_direct_preview } from '../src/direct-preview.js';
import { shadow_styles } from '../src/shadow_styles.mjs';

const frame = { id: '/home/desktop', path: '/home/desktop', title: '首页', file: 'views.frame' };

test('重建版本更新时重新加载预览模块、运行时和样式，相同版本复用运行时与样式', async () => {
  const bundled = await build({ entryPoints: [new URL('../src/direct-preview.js', import.meta.url).pathname], bundle: true, write: false, format: 'iife', globalName: 'preview', supported: { 'dynamic-import': false } });
  const scripts = [], styles = [], imports = [];
  const runtime = {
    require(path) { imports.push(path); return { mount() {} }; },
    fetch: async path => { styles.push(path); return { ok: true, text: async () => `css: ${path}` }; },
  };
  vm.runInNewContext(bundled.outputFiles[0].text, runtime);
  const { document } = parseHTML('<html><head></head><body></body></html>');
  document.head.append = script => { scripts.push(script.src); queueMicrotask(() => script.onload()); };
  const project = { revision: 'first', runtime_scripts: ['/runtime.js'], stylesheets: ['/style.css'] };
  const first = await runtime.preview.load_preview(document, project);
  await runtime.preview.load_preview(document, project);
  const second = await runtime.preview.load_preview(document, { ...project, revision: 'second' });
  assert.deepEqual(scripts, ['/runtime.js?revision=first', '/runtime.js?revision=second']);
  assert.deepEqual(styles, ['/style.css?revision=first', '/style.css?revision=second']);
  assert.deepEqual(imports, ['/adapter.js?revision=first', '/adapter.js?revision=first', '/adapter.js?revision=second']);
  assert.notEqual(first.styles[0], second.styles[0]);
});

test('异步加载期间移除 Frame 不会迟到挂载，反复清理安全', async () => {
  const { document } = parseHTML('<html><body></body></html>');
  let finish, mounts = 0;
  const preview = create_direct_preview({ document, frame, theme: 'light', project: {}, load: () => new Promise(resolve => { finish = resolve; }) });
  document.body.append(preview.host);
  preview.destroy(); preview.destroy();
  finish({ adapter: { mount() { mounts++; } }, styles: [] });
  await preview.ready;
  assert.equal(mounts, 0);
  assert.equal(preview.host.isConnected, false);
});

test('渲染错误显示在 Frame 内，不替换白板或污染其他 Frame', async () => {
  const { document } = parseHTML('<html><body><p data-n="shell">board</p></body></html>');
  const preview = create_direct_preview({ document, frame, theme: 'light', project: {}, load: async () => { throw new Error('missing runtime'); } });
  document.body.append(preview.host);
  await preview.ready;
  assert.equal(preview.host.dataset.status, 'error');
  assert.match(preview.host.shadowRoot.querySelector('[data-n="preview-status"]').textContent, /页面渲染失败：missing runtime/);
  const overlay = preview.host.shadowRoot.querySelector('[data-n="preview-error-overlay"]');
  assert.equal(overlay.parentNode, preview.host.shadowRoot);
  assert.equal(overlay.getAttribute('role'), 'alert');
  assert.equal(overlay.querySelector('[data-n="preview-error-icon"]').getAttribute('aria-hidden'), 'true');
  assert.ok(overlay.querySelector('svg circle'));
  assert.ok(overlay.querySelector('svg path'));
  assert.equal(preview.root.contains(overlay), false);
  const styles = preview.host.shadowRoot.querySelector('[data-n="preview-host-style"]').textContent;
  assert.match(styles, /preview-error-overlay"\]\s*\{[^}]*position: absolute; inset: 0;/);
  assert.match(styles, /preview-error-icon"\]\s*\{[^}]*color: #dc2626;/);
  assert.equal(document.querySelector('[data-n="shell"]').textContent, 'board');
  preview.destroy();
});

test('mount 返回之前上报的错误不被成功状态覆盖，迟到清理保留错误界面', async () => {
  const { document } = parseHTML('<html><body></body></html>');
  let finish, cleaned = 0, reported = 0;
  const preview = create_direct_preview({ document, frame, project: {}, theme: 'light', on_error() { reported++; }, load: async () => ({ styles: [],
    adapter: { mount(_frame, root, { on_error }) {
      on_error(new Error('early render failed'));
      return new Promise(resolve => { finish = () => resolve(() => { cleaned++; root.replaceChildren(); }); });
    } },
  }) });
  document.body.append(preview.host);
  await Promise.resolve();
  finish(); await preview.ready;
  assert.equal(cleaned, 1); assert.equal(reported, 1);
  assert.equal(preview.host.dataset.status, 'error');
  assert.match(preview.host.shadowRoot.querySelector('[role="alert"]').textContent, /early render failed/);
  assert.equal(preview.host.shadowRoot.querySelectorAll('[data-n="preview-error-overlay"]').length, 1);
  assert.equal(preview.host.shadowRoot.querySelectorAll('[data-n="preview-error-copy"]').length, 1);
  preview.destroy(); assert.equal(cleaned, 1);
});

test('复制完整渲染错误，防止重复提交，失败或剪贴板不可用时保留错误并提示', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  const copied = []; let finish;
  const clipboard = { writeText(text) { copied.push(text); return new Promise(resolve => { finish = resolve; }); } };
  Object.defineProperty(document, 'defaultView', { configurable: true, value: new Proxy(window, { get(target, key) { return key === 'navigator' ? { clipboard } : Reflect.get(target, key); } }) });
  const error = new Error('missing runtime');
  const preview = create_direct_preview({ document, frame, project: {}, theme: 'light', load: async () => { throw error; } });
  document.body.append(preview.host); await preview.ready;
  try {
    const shadow = preview.host.shadowRoot;
    const copy = shadow.querySelector('[data-n="preview-error-copy"]');
    const feedback = shadow.querySelector('[data-n="preview-error-copy-status"]');
    const message = shadow.querySelector('[data-n="preview-status"]').textContent;
    assert.equal(preview.host.inert, false);
    assert.ok(message.includes(frame.file)); assert.ok(message.includes(error.stack));
    let bubbled = 0;
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick']) {
      shadow.addEventListener(type, () => bubbled++);
      copy.dispatchEvent(new window.Event(type, { bubbles: true }));
    }
    copy.dispatchEvent(new window.Event('click', { bubbles: true }));
    assert.deepEqual(copied, [message]); assert.equal(bubbled, 0);
    assert.equal(copy.disabled, true); assert.equal(copy.textContent, '正在复制…');
    finish(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(copy.disabled, false); assert.equal(feedback.textContent, '已复制错误');
    for (const write of [async () => { throw new Error('denied'); }, undefined]) {
      clipboard.writeText = write;
      copy.dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise(resolve => setImmediate(resolve));
      assert.match(feedback.textContent, /复制失败/); assert.equal(feedback.hidden, false);
      assert.equal(copy.disabled, false);
      assert.equal(shadow.querySelector('[data-n="preview-status"]').textContent, message);
    }
  } finally { preview.destroy(); }
});

test('已销毁 Frame 忽略迟到的渲染错误', async () => {
  const { document } = parseHTML('<html><body></body></html>');
  let report, errors = 0;
  const preview = create_direct_preview({ document, frame, project: {}, theme: 'light', on_error() { errors++; }, load: async () => ({ styles: [],
    adapter: { mount(_frame, _root, { on_error }) { report = on_error; return () => {}; } },
  }) });
  await preview.ready; preview.destroy(); report(new Error('late error'));
  assert.equal(errors, 0);
  assert.equal(preview.host.shadowRoot.childNodes.length, 0);
});

test('CSS 只在选择器转换根节点，并将宽度断点绑定到 Frame 容器', () => {
  const css = shadow_styles(':root { --body: body; } :root[data-theme="light"] { color: black; } body { margin: 0; } @media (max-width: 720px) { .card { display: grid; } } @media (pointer: coarse) { .card { padding: 16px; } }');
  assert.match(css, /:host\(\[data-theme="light"\]\)/);
  assert.match(css, /--body: body/);
  assert.match(css, /body \{ margin: 0; \}/);
  assert.doesNotMatch(css, /\[data-n="preview-document"\]/);
  assert.match(css, /@container preview-size \(max-width: 720px\)/);
  assert.match(css, /@media \(pointer: coarse\)/);
});

test('视口单位按 Frame 尺寸转换，保留选择器、字符串、URL 和变量名称', () => {
  const css = shadow_styles(`.max-h-\\[85vh\\] {
    max-height: 85vh !important;
    width: min(90vw, calc(100dvw - 24px));
    height: clamp(20svh, 50lvh, 100dvh);
    padding: 2vmin 3vmax;
    margin-top: -.5VH;
    --panel-height: 85vh;
    min-height: var(--panel-height, 10vh);
    content: "85vh" '90vw';
    background: url(/images/85vh.svg), url("/images/a)85vh.svg");
    animation-name: panel-85vh;
    border: var(--85vh);
  }`);
  assert.match(css, /\.max-h-\\\[85vh\\\]/);
  assert.ok(css.includes('max-height: calc(var(--jiezi-viewport-height) * 85 / 100) !important'));
  assert.ok(css.includes('width: min(calc(var(--jiezi-viewport-width) * 90 / 100), calc(calc(var(--jiezi-viewport-width) * 100 / 100) - 24px))'));
  assert.ok(css.includes('height: clamp(calc(var(--jiezi-viewport-height) * 20 / 100), calc(var(--jiezi-viewport-height) * 50 / 100), calc(var(--jiezi-viewport-height) * 100 / 100))'));
  assert.ok(css.includes('padding: calc(min(var(--jiezi-viewport-width), var(--jiezi-viewport-height)) * 2 / 100) calc(max(var(--jiezi-viewport-width), var(--jiezi-viewport-height)) * 3 / 100)'));
  assert.ok(css.includes('margin-top: calc(var(--jiezi-viewport-height) * -.5 / 100)'));
  assert.ok(css.includes('--panel-height: calc(var(--jiezi-viewport-height) * 85 / 100)'));
  assert.ok(css.includes('min-height: var(--panel-height, calc(var(--jiezi-viewport-height) * 10 / 100))'));
  assert.ok(css.includes('content: "85vh" \'90vw\''));
  assert.ok(css.includes('background: url(/images/85vh.svg), url("/images/a)85vh.svg")'));
  assert.ok(css.includes('animation-name: panel-85vh'));
  assert.ok(css.includes('border: var(--85vh)'));
  assert.equal(shadow_styles(css), css);
});

test('Frame 各自提供视口尺寸，切换尺寸不改变其他预览', async () => {
  const { document } = parseHTML('<html><body></body></html>');
  const previews = [0, 1].map(() => create_direct_preview({ document, frame, project: {}, theme: 'light', load: async () => ({ styles: [], adapter: { mount() {} } }) }));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    previews[0].set_size(1200, 800); previews[1].set_size(520, 360);
    previews[0].set_size(390, 800);
    for (const [index, width, height] of [[0, 390, 800], [1, 520, 360]]) {
      const style = previews[index].host.style;
      assert.equal(style.width, `${width}px`); assert.equal(style.height, `${height}px`);
      assert.equal(style.getPropertyValue('--jiezi-viewport-width'), `${width}px`);
      assert.equal(style.getPropertyValue('--jiezi-viewport-height'), `${height}px`);
    }
  } finally { previews.forEach(preview => preview.destroy()); }
});

test('运行时弹窗的行内样式及自定义属性绑定 Frame，后续更新和新增节点同样转换', async () => {
  const { document } = parseHTML('<html><body><div data-n="outside" style="max-height:85vh"></div></body></html>');
  const preview = create_direct_preview({ document, frame, project: {}, theme: 'light', load: async () => ({ styles: [], adapter: {
    mount(_frame, root) {
      const portal = document.createElement('div'); portal.dataset.n = 'dialog-portal';
      const dialog = document.createElement('div'); dialog.dataset.n = 'source-dialog';
      dialog.setAttribute('style', `--width-min-480-pixels-calc-100-vw-32-pixels:min(480px, calc(100vw - 32px)); --max-height-85-vh:85vh; width:min(760px, -32px + 100vw); max-height:calc(100dvh - 48px) !important; --max-560-width:calc(100vw - 16px); --max-560-max-height:calc(100dvh - 16px); --label:"85vh"; background:url(/85vh.svg)`);
      portal.append(dialog); root.append(portal);
    },
  } }) });
  preview.set_size(1000, 1800); document.body.append(preview.host);
  try {
    await preview.ready;
    await new Promise(resolve => setImmediate(resolve));
    const dialog = preview.root.querySelector('[data-n="source-dialog"]');
    assert.equal(dialog.style.getPropertyValue('--max-height-85-vh'), 'calc(var(--jiezi-viewport-height) * 85 / 100)');
    assert.ok(dialog.getAttribute('style').includes('max-height:calc(calc(var(--jiezi-viewport-height) * 100 / 100) - 48px) !important'));
    assert.equal(dialog.style.getPropertyValue('--max-560-max-height'), 'calc(calc(var(--jiezi-viewport-height) * 100 / 100) - 16px)');
    assert.equal(dialog.style.width, 'min(760px, -32px + calc(var(--jiezi-viewport-width) * 100 / 100))');
    assert.equal(dialog.style.getPropertyValue('--width-min-480-pixels-calc-100-vw-32-pixels'), 'min(480px, calc(calc(var(--jiezi-viewport-width) * 100 / 100) - 32px))');
    assert.equal(dialog.style.getPropertyValue('--label'), '"85vh"');
    assert.equal(dialog.style.background, 'url(/85vh.svg)');
    assert.equal(document.querySelector('[data-n="outside"]').style.maxHeight, '85vh');
    dialog.style.cssText = 'max-height:90svh';
    const child = document.createElement('div'); child.dataset.n = 'later-dialog'; child.style.cssText = 'width:80dvw';
    dialog.append(child);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dialog.style.maxHeight, 'calc(var(--jiezi-viewport-height) * 90 / 100)');
    assert.equal(child.style.width, 'calc(var(--jiezi-viewport-width) * 80 / 100)');
    preview.set_size(390, 1800);
    assert.equal(preview.host.style.getPropertyValue('--jiezi-viewport-width'), '390px');
    assert.equal(preview.host.style.getPropertyValue('--jiezi-viewport-height'), '1800px');
    assert.equal(child.style.width, 'calc(var(--jiezi-viewport-width) * 80 / 100)');
    const shadow = preview.host.shadowRoot;
    preview.destroy();
    child.style.cssText = 'width:75vw'; shadow.append(child);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(child.style.width, '75vw');
  } finally { preview.destroy(); }
});

test('异步 mount 返回后才完成销毁，也会释放迟到的清理函数', async () => {
  const { document } = parseHTML('<html><body></body></html>');
  let finish, signal, cleanups = 0;
  const preview = create_direct_preview({ document, frame, theme: 'light', project: {}, load: async () => ({ styles: [], adapter: { mount(_frame, _root, options) { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } } }) });
  await Promise.resolve();
  preview.destroy();
  assert.equal(signal.aborted, true);
  finish(() => { cleanups++; });
  await preview.ready;
  assert.equal(cleanups, 1);
  assert.notEqual(preview.host.dataset.status, 'mounted');
});
