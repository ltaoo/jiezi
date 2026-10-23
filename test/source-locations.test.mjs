import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { inject_source_locations, source_locations_plugins } from '../src/source-locations.mjs';
import { node_source_location } from '../src/node-selection.js';
import { source_details, trace_source } from '../src/source-runtime.js';

async function execute(source, context = {}) {
  const { document } = parseHTML('<html><body></body></html>');
  const runtime = { document, ...context };
  const result = await build({ stdin: { contents: inject_source_locations(source, 'view.frame'), loader: 'js', resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', logLevel: 'silent' });
  vm.runInNewContext(result.outputFiles[0].text, runtime);
  return runtime;
}

function position(source, snippet) {
  const offset = source.indexOf(snippet), lines = source.slice(0, offset).split('\n');
  assert.ok(offset >= 0);
  return { file: 'view.frame', line: lines.length, column: lines.at(-1).length + 1 };
}

// 模拟框架公开的视图/$elm 协议；真实版本兼容在显式集成测试中验证。
function View(props = {}, children = []) {
  let element = null;
  return { t: 'view', props, children, onMounted() {}, get $elm() { return element; }, set $elm(value) { element = value; } };
}
function render(view, document) {
  const node = document.createElement(view.props.as || 'div');
  view.$elm = node;
  for (const child of view.children) node.append(typeof child === 'string' ? child : render(child, document));
  return node;
}

test('原生 DOM、别名与任意 helper 自动追踪，声明和调用位置分别保留', async () => {
  const source = `function make(tag) {
  return document.createElement(tag);
}
globalThis.first = make('section');
globalThis.loop = [1, 2].map(() => make('p'));
const doc = document;
globalThis.icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');`;
  const runtime = await execute(source);
  assert.deepEqual(node_source_location(runtime.first), position(source, 'document.createElement(tag)'));
  assert.deepEqual(node_source_location(runtime.loop[0]), node_source_location(runtime.loop[1]));
  assert.deepEqual({ ...source_details(runtime.first).usages[0], end_line: undefined, end_column: undefined }, { ...position(source, "make('section')"), end_line: undefined, end_column: undefined });
  assert.deepEqual(node_source_location(runtime.icon), position(source, "doc.createElementNS("));
  assert.equal(runtime.first.hasAttribute('data-jiezi-source'), false);
});

test('查询和 innerHTML 产生的未知节点不冒充精确创建位置', async () => {
  const source = `document.body.innerHTML = '<section data-n="generated"><i data-n="icon"></i></section>';
globalThis.node = document.querySelector('i');`;
  const runtime = await execute(source);
  assert.equal(node_source_location(runtime.node), null);
});

test('无 attributes、变量配置、展开和包装组件均绑定实际 DOM，不修改配置', async () => {
  const source = `const shared = Object.freeze({ class: 'panel' });
function Wrapper(props) { return View(props, [View({ as: 'span' })]); }
globalThis.views = [View(), View(shared), View({ ...shared }), Wrapper(shared)];
globalThis.shared = shared;`;
  const runtime = await execute(source, { View });
  const nodes = runtime.views.map(view => render(view, runtime.document));
  for (const [index, snippet] of ['View()', 'View(shared)', 'View({ ...shared })', 'View(props,'].entries()) assert.deepEqual(node_source_location(nodes[index]), position(source, snippet));
  assert.deepEqual(node_source_location(nodes[3].firstElementChild), position(source, "View({ as: 'span' })"));
  assert.equal(source_details(nodes[3]).usages[0].column, position(source, 'Wrapper(shared)').column);
  assert.deepEqual(Object.keys(runtime.shared), ['class']);
  assert.ok(source_details(nodes[0]).declaration.end_column > source_details(nodes[0]).declaration.column);
});

test('隔离运行时与外层调用共享来源，外层包装不会覆盖声明', async () => {
  const first_source = `globalThis.view = View({ class: 'original' });`;
  const first = await execute(first_source, { View });
  const second = await execute(`globalThis.wrapped = identity(existing);`, { document: first.document, existing: first.view, identity: value => value });
  const node = render(second.wrapped, first.document);
  assert.deepEqual(node_source_location(node), position(first_source, "View({ class: 'original' })"));
  assert.equal(source_details(node).usages.length, 1);
});

test('业务返回值的 getter 不会因追踪而执行', async () => {
  const value = Object.defineProperties({}, { ownerDocument: { get() { throw new Error('不应读取'); } }, t: { get() { throw new Error('不应读取'); } } });
  const runtime = await execute('globalThis.result = identity(value);', { value, identity: value => value });
  assert.equal(runtime.result, value);
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.equal((await execute('globalThis.result = identity(value);', { value: proxy, identity: value => value })).result, proxy);
  const error = new Error('原始调用失败');
  await assert.rejects(execute('fail();', { fail() { throw error; } }), value => value === error);
  const documents = await execute('globalThis.scoped = new Proxy(document, {});');
  assert.equal(documents.scoped.nodeType, 9);
});

test('延迟回调、循环、Portal 和 ShadowRoot 不依赖 DOM 父子关系传递来源', async () => {
  const source = `globalThis.later = () => View({ as: 'article' }, [View({ as: 'strong' })]);
globalThis.items = [1, 2].map(() => View({ as: 'p' }));`;
  const runtime = await execute(source, { View });
  await Promise.resolve();
  const portal = render(runtime.later(), runtime.document);
  runtime.document.body.append(portal);
  const host = runtime.document.createElement('div'), shadow = host.attachShadow({ mode: 'open' });
  shadow.append(render(runtime.items[0], runtime.document));
  assert.deepEqual(node_source_location(portal), position(source, "View({ as: 'article' }"));
  assert.deepEqual(node_source_location(portal.firstElementChild), position(source, "View({ as: 'strong' })"));
  assert.deepEqual(node_source_location(shadow.firstElementChild), position(source, "View({ as: 'p' })"));
  assert.deepEqual(node_source_location(render(runtime.items[1], runtime.document)), node_source_location(shadow.firstElementChild));
});

test('节点替换、卸载和已挂载视图更新绑定，未知节点不借用祖先来源', () => {
  const { document } = parseHTML('<html><body></body></html>');
  const source = { file: 'view.js', line: 3, column: 2 }, view = View();
  const old = render(view, document);
  trace_source(view, source);
  assert.deepEqual(node_source_location(old), source);
  const next = document.createElement('section');
  view.$elm = next;
  assert.equal(node_source_location(old), null);
  assert.deepEqual(node_source_location(next), source);
  const child = document.createElement('span'); next.append(child);
  assert.equal(node_source_location(child), null);
  view.$elm = null;
  assert.equal(node_source_location(next), null);
  assert.equal(trace_source(Object.freeze({ t: 'other', $elm: null }), source).t, 'other');
});

test('Timeless 渲染句柄在 render/hydrate 后绑定 DOM，重建后清除旧位置', () => {
  const { document } = parseHTML('<html></html>');
  const source = { file: 'view.js', line: 4, column: 3 }, view = trace_source(View(), source);
  let element = null;
  const handle = { get$elm: () => element, render() { element = document.createElement('div'); return element; }, hydrate(node) { element = node; } };
  view.$elm = handle;
  const first = handle.render();
  assert.deepEqual(node_source_location(first), source);
  const second = handle.render();
  assert.equal(node_source_location(first), null);
  assert.deepEqual(node_source_location(second), source);
  const third = document.createElement('p'); handle.hydrate(third);
  assert.equal(node_source_location(second), null);
  assert.deepEqual(node_source_location(third), source);
  view.$elm = null;
  assert.equal(node_source_location(third), null);
});

test('插桩保留 this、可选链短路、直接 eval、构造器、模板及异步调用语义', async () => {
  const source = `const __jiezi_trace = 'occupied', __jiezi_sources = 'occupied';
const receiver = { value: 7, get() { return this.value; } };
let side_effects = 0;
const absent = null;
globalThis.values = [receiver.get(), absent?.get(side_effects++).next(), absent?.[receiver.get()]?.(), side_effects, (receiver?.get)()];
const removable = { value: 1 }; delete removable?.value;
globalThis.deleted = !('value' in removable);
function local() { const secret = 42; return eval('secret'); }
class Base { constructor(value) { this.value = value; } }
class Derived extends Base { constructor() { super(8); } }
globalThis.secret = local();
globalThis.instance = new Derived();
const tag = values => values[0]; globalThis.tag = tag\`text\`;
globalThis.later = async () => View({ as: 'aside' });
globalThis.generator = function* () { return View({ class: yield 1 }); };`;
  const runtime = await execute(source, { View });
  assert.deepEqual(Array.from(runtime.values), [7, undefined, undefined, 0, 7]);
  assert.equal(runtime.deleted, true);
  assert.equal(runtime.secret, 42); assert.equal(runtime.instance.value, 8); assert.equal(runtime.tag, 'text');
  const node = render(await runtime.later(), runtime.document);
  assert.deepEqual(node_source_location(node), position(source, "View({ as: 'aside' })"));
  const iterator = runtime.generator(); iterator.next();
  assert.deepEqual(node_source_location(render(iterator.next('x').value, runtime.document)), position(source, 'View({ class: yield 1 })'));
});

test('旧标记兼容读取，非法位置与缺失标记不猜测来源', () => {
  const { document } = parseHTML('<div><span></span></div>');
  const parent = document.querySelector('div'), child = document.querySelector('span');
  parent.setAttribute('data-jiezi-source', JSON.stringify({ file: 'page.js', line: 2, column: 3 }));
  assert.equal(node_source_location(child), null);
  for (const value of ['{', 'null', '{}', '{"file":"x","line":0,"column":1}', '{"file":"x","line":1,"column":1.5}']) {
    child.setAttribute('data-jiezi-source', value);
    assert.equal(node_source_location(child), null);
  }
});

test('统一加载链覆盖默认文件、自定义 loader、虚拟源码和 .frame，跳过依赖', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-source-'));
  await mkdir(join(directory, 'node_modules', 'dependency'), { recursive: true });
  await writeFile(join(directory, 'node_modules', 'dependency', 'index.js'), 'export default () => document.createElement("i");');
  await writeFile(join(directory, 'plain.mjs'), 'export default () => document.createElement("aside");');
  await writeFile(join(directory, 'page.frame'), 'unused');
  const roots = [{ root: directory }];
  const sources = new Map();
  const custom = { name: 'custom-load', setup(builder) {
    builder.onResolve({ filter: /^virtual$/ }, () => ({ path: join(directory, 'virtual.js'), namespace: 'generated' }));
    builder.onLoad({ filter: /\.frame$/ }, () => ({ contents: 'export default () => document.createElement("main");', loader: 'js' }));
    builder.onLoad({ filter: /.*/, namespace: 'generated' }, () => ({ contents: new TextEncoder().encode('export default () => document.createElement("nav");'), loader: 'js' }));
  } };
  const result = await build({ stdin: { contents: 'import page from "./page.frame"; import plain from "./plain.mjs"; import virtual from "virtual"; import dependency from "dependency"; globalThis.nodes = [page(), plain(), virtual(), dependency()];', resolveDir: directory }, bundle: true, write: false, format: 'iife', plugins: source_locations_plugins(roots, [custom], sources) });
  const { document } = parseHTML('<html></html>'), runtime = { document };
  vm.runInNewContext(result.outputFiles[0].text, runtime);
  assert.deepEqual(Array.from(runtime.nodes, node => node_source_location(node)?.file || null), ['page.frame', 'plain.mjs', 'virtual.js', null]);
  assert.deepEqual([...sources.keys()].sort(), ['page.frame', 'plain.mjs', 'virtual.js']);
  assert.equal(sources.get('virtual.js'), 'export default () => document.createElement("nav");');
  assert.equal(sources.get('page.frame'), 'export default () => document.createElement("main");');
  assert.equal(sources.get('plain.mjs'), 'export default () => document.createElement("aside");');
});
