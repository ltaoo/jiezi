import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import * as esbuild from 'esbuild';
import { load_adapter, options_from_args, root } from '../../build.mjs';
import { collect_catalog, preview_registry } from '../../adapters/xiaoxunrss/catalog.mjs';

if (!process.env.JIEZI_TEST_SOURCE) throw new Error('请设置 JIEZI_TEST_SOURCE 为待预览的小讯源码目录');
const options = options_from_args(['--adapter', 'xiaoxunrss', '--source', process.env.JIEZI_TEST_SOURCE]);
const adapter = await load_adapter(options);
const catalog = await adapter.catalog();

test('目录自动发现页面、组件和插件的 .frame 预览，每个示例独立登记', async () => {
  assert.ok(catalog.length > 170);
  assert.ok(catalog.some(item => item.exported === 'SettingsAboutPage'));
  assert.ok(catalog.some(item => item.exported === 'SettingsAIPage' && item.layout === 'fill'));
  assert.ok(catalog.every(item => item.preview === 'direct'));
  const scanned = await collect_catalog(adapter.source);
  assert.equal(new Set(scanned.map(item => item.id)).size, scanned.length);
  assert.ok(scanned.find(item => item.route === '/dashboard'));
  assert.ok(scanned.find(item => item.name === 'Button'));
  assert.ok(catalog.every(item => typeof item.source === 'string' && item.source.length));
  assert.ok(catalog.every(item => !['_Preview', '_Previews'].includes(item.exported)));
  assert.ok(catalog.some(item => item.module === 'plugins/search/frontend/page.frame'));
  assert.ok(catalog.every(item => item.module.endsWith('.frame') && item.file.endsWith('.frame') && !item.module.includes('..')));
  assert.ok(new Set(catalog.map(item => item.module)).size < catalog.length);
  assert.ok(catalog.every(item => item.id === item.path && item.title === item.preview_name && item.title.trim()));
  assert.deepEqual(catalog.filter(item => item.module === 'frontend/src/pages/background-queue.frame').map(item => item.id), ['/background-queue/1', '/background-queue/2']);
  assert.ok(catalog.filter(item => item.module.includes('/frui/')).every(item => item.path.startsWith('/frui/')));
  assert.ok(catalog.find(item => item.exported === 'SettingsAIPage').path.startsWith('/settings/ai/'));

});
test('注册表只包含构建期确定的模块，同模块多个示例共用一次 import', async () => {
  const registry = preview_registry(catalog);
  assert.match(registry, /\(\) => import\("@project\/frontend\/src\/pages\/login\.frame"\)/);
  assert.ok(!registry.includes('import(frame.'));
  assert.equal([...registry.matchAll(/import\("@project\/frontend\/src\/pages\/login\.frame"\)/g)].length, 1);
});
test('适配器参数可指定外部源码目录，拒绝路径穿越名称', () => {
  assert.equal(options_from_args(['--source', '/tmp/project']).source, '/tmp/project');
  assert.throws(() => options_from_args(['--adapter', '../../secret']));
});
test('直接渲染适配器只依赖真实页面，不引入业务启动入口', async () => {
  const runtime = { console, URL, URLSearchParams, Date, AbortSignal, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {} };
  vm.runInNewContext(await readFile(join(adapter.source, 'public/assets/timeless/0.34.2/timeless.umd.min.js'), 'utf8'), runtime);
  runtime.Timeless.DOM = { render(view) { runtime.view = view; } };
  const result = await esbuild.build({ stdin: { contents: `import { mount } from './adapters/xiaoxunrss/direct.js'; globalThis.mount = mount;`, resolveDir: root }, bundle: true, write: false, format: 'iife', metafile: true, plugins: adapter.plugins, nodePaths: [join(adapter.source, 'node_modules')] });
  vm.runInNewContext(result.outputFiles[0].text, runtime);
  const cleanup = await runtime.mount(catalog.find(item => item.exported === 'SettingsAboutPage'), { replaceChildren() {} }, { create_host: () => ({ destroy() {} }) });
  assert.equal(typeof cleanup, 'function');
  const find_page = node => node.state?.attributes?.n === 'settings-about-page' || node.children?.some(find_page);
  assert.ok(find_page(runtime.view));
  cleanup();
  const imports = Object.keys(result.metafile.inputs);
  assert.ok(imports.some(path => path.endsWith('pages/settings.about.js')));
  assert.ok(!imports.some(path => /frontend\/src\/(index|store|auth|routes)\.js$/.test(path)));
});
