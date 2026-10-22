import test from 'node:test';
import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import vm from 'node:vm';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { load_adapter, options_from_args, root } from '../build.mjs';
import { create_direct_preview } from '../src/direct-preview.js';

test('默认示例来自项目内部，外部适配器必须显式指定源码目录', () => {
  const options = options_from_args([]);
  assert.equal(options.adapter, 'demo');
  assert.equal(options.source, join(root, 'examples/demo'));
  assert.equal(options_from_args(['--source', '/tmp/project']).source, '/tmp/project');
  assert.throws(() => options_from_args(['--adapter', '../../secret']));
  assert.throws(() => options_from_args(['--adapter', 'xiaoxunrss']), /--source/);
});

test('内置示例仅打包项目内文件，Model 隔离且可挂载、交互、销毁', async () => {
  const adapter = await load_adapter(options_from_args([]));
  const catalog = await adapter.catalog();
  assert.equal(catalog.filter(frame => frame.kind === 'page').length, 2);
  assert.equal(catalog.filter(frame => frame.kind === 'component').length, 1);
  const result = await build({
    entryPoints: [adapter.entry_points.adapter], bundle: true, write: false,
    format: 'iife', globalName: 'adapter', metafile: true, plugins: adapter.plugins,
    absWorkingDir: root,
  });
  for (const input of Object.keys(result.metafile.inputs)) assert.ok(!relative(root, join(root, input)).startsWith('..'));
  const { document, window } = parseHTML('<html><body></body></html>');
  const runtime = { document };
  vm.runInNewContext(result.outputFiles[0].text, runtime);
  const frame = catalog.find(frame => frame.kind === 'component');
  const load = async () => ({ adapter: runtime.adapter, styles: [] });
  const previews = [frame, frame, ...catalog.filter(frame => frame.kind === 'page')].map(frame =>
    create_direct_preview({ document, frame, project: {}, theme: 'light', load }));
  document.body.append(...previews.map(preview => preview.host));
  try {
    await Promise.all(previews.map(preview => preview.ready));
    for (const preview of previews) {
      assert.equal(preview.host.dataset.status, 'mounted');
      for (const node of preview.root.querySelectorAll('*')) assert.ok(node.dataset.n);
      assert.equal(preview.host.shadowRoot.querySelector('iframe'), null);
    }
    previews[0].root.querySelector('button').dispatchEvent(new window.Event('click'));
    assert.equal(previews[0].root.querySelector('[data-n="demo-counter-value"]').textContent, '当前计数：1');
    assert.equal(previews[1].root.querySelector('[data-n="demo-counter-value"]').textContent, '当前计数：0');
    previews[0].set_theme('dark');
    assert.equal(previews[0].host.dataset.theme, 'dark');
    assert.equal(previews[1].host.dataset.theme, 'light');
    await assert.rejects(async () => runtime.adapter.mount({ ...frame, path: '/changed' }, document.createElement('div')), /示例已变化/);
    assert.equal(runtime.adapter.mount(frame, document.createElement('div'), { signal: AbortSignal.abort() }), undefined);
  } finally { previews.forEach(preview => preview.destroy()); }
  assert.equal(document.body.childNodes.length, 0);
  assert.ok(previews.every(preview => !preview.host.shadowRoot.childNodes.length));
});
