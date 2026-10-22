import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { create_direct_preview } from '../src/direct-preview.js';
import { shadow_styles } from '../src/shadow_styles.mjs';

const frame = { id: '/home/desktop', path: '/home/desktop', title: '首页', file: 'views.frame' };

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
  preview.destroy(); assert.equal(cleaned, 1);
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
