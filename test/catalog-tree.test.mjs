import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { CatalogTreeModel } from '../src/catalog-tree.model.js';
import { create_catalog_tree } from '../src/catalog-tree.js';

const frame = (path, title, kind = 'page', preview = 'direct') => ({ id: path, path, title, name: title, file: `${path}.frame`, kind, preview });
const frames = [
  frame('/background-queue/1', '后台队列'), frame('/background-queue/2', '文件下载'),
  frame('/background-queue/components/1', '任务详情', 'component'),
  frame('/background-queue/components/fields/1', '筛选字段', 'component'),
  frame('/frui/button/1', 'Button', 'component'), frame('/unused/1', 'Unused', 'component', 'source'),
];
const ids = model => model.rows().filter(row => row.frame).map(row => row.frame.id);

test('path 生成目录节点，两个页面示例同级，组件归入 components 文件夹', () => {
  const model = CatalogTreeModel(frames);
  const root = model.rows().find(row => row.key === '/background-queue');
  assert.ok(root); assert.equal(root.frame, undefined); assert.equal(root.id, root.key);
  assert.equal(model.get_parent('/background-queue/1').id, '/background-queue');
  assert.equal(model.get_parent('/background-queue/2').id, '/background-queue');
  assert.equal(model.get_parent('/background-queue/components/1').id, '/background-queue/components');
  assert.deepEqual(new Set(model.get_children('/background-queue').map(node => node.id)), new Set(['/background-queue/1', '/background-queue/2', '/background-queue/components']));
  assert.ok(!ids(model).includes('/frui/button/1'));
  model.update('', 'all'); model.expand_all(true);
  assert.equal(ids(model).length, frames.length);
  assert.equal(new Set(ids(model)).size, frames.length);
});

test('搜索路径、名称和祖先目录，清空搜索恢复原来的折叠状态', () => {
  const model = CatalogTreeModel(frames);
  model.toggle('/background-queue/components', false);
  model.update('筛选字段', 'page');
  assert.deepEqual(ids(model), ['/background-queue/components/fields/1']);
  assert.deepEqual(model.rows().map(row => row.key), ['/background-queue', '/background-queue/components', '/background-queue/components/fields', '/background-queue/components/fields/1']);
  model.update('', 'page'); assert.ok(!ids(model).includes('/background-queue/components/1'));
  model.update('/background-queue/components', 'page');
  assert.equal(ids(model).length, 2);
  model.update('Button', 'page'); assert.deepEqual(ids(model), []);
  model.update('Button', 'all'); assert.deepEqual(ids(model), ['/frui/button/1']);
  model.update('no-such-node', 'all'); assert.equal(model.rows().length, 0);
});

test('筛选保留目录上下文，空目录可操作，Frame 节点也可拥有子路径', () => {
  const model = CatalogTreeModel(frames);
  model.update('', 'component'); model.expand_all(true);
  assert.deepEqual(new Set(ids(model)), new Set(frames.filter(item => item.kind === 'component').map(item => item.id)));
  model.update('', 'direct'); assert.ok(!ids(model).includes('/unused/1'));
  const nested = CatalogTreeModel([frame('/page', '页面'), frame('/page/child', '子组件', 'component')]);
  assert.equal(nested.get_parent('/page/child').frame.id, '/page');
  nested.reveal('/page/child'); assert.ok(ids(nested).includes('/page/child'));
  const empty = CatalogTreeModel([]); assert.deepEqual(empty.rows(), []);
  assert.doesNotThrow(() => { empty.navigate('ArrowRight'); empty.expand_all(true); empty.reveal('missing'); });
});

test('方向键、Home/End 和外部选中展开定位使用 path', () => {
  const model = CatalogTreeModel(frames);
  model.rows(); model.navigate('End'); assert.equal(model.state.focused, model.rows().at(-1).key);
  model.navigate('Home'); assert.equal(model.state.focused, '/background-queue');
  model.navigate('ArrowLeft'); assert.equal(model.rows().length, 1);
  model.navigate('ArrowRight'); assert.ok(model.rows().length > 1);
  model.reveal('/background-queue/components/fields/1');
  assert.ok(ids(model).includes('/background-queue/components/fields/1'));
  model.navigate('ArrowLeft'); assert.equal(model.state.focused, '/background-queue/components/fields');
});

test('树视图语义、目录展开、稳定节点、高亮与键盘事件隔离', () => {
  const { window, document } = parseHTML('<html><body><div data-n="tree-test"></div></body></html>');
  const root = document.querySelector('div'), model = CatalogTreeModel(frames);
  let selected = null, opened = null, bubbled = 0;
  const tree = create_catalog_tree({ root, model, get_selected: () => selected,
    on_select(frame) { selected = frame.id; model.reveal(frame.id); tree.sync_selection(); },
    on_open(frame) { opened = frame.id; },
  });
  const emit = (node, type, key) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    if (key) event.key = key;
    node.dispatchEvent(event); return event;
  };
  tree.render();
  assert.equal(root.getAttribute('role'), 'tree');
  assert.ok([...root.querySelectorAll('*')].every(node => node.dataset.n));
  const item = root.querySelector('[data-id="/background-queue/1"]');
  emit(item, 'click'); assert.equal(selected, '/background-queue/1');
  emit(item, 'dblclick'); assert.equal(opened, selected);
  const title = item.querySelector('[data-n="catalog-tree-title"]');
  model.update('', 'all'); tree.render();
  assert.equal(root.querySelector('[data-id="/background-queue/1"]'), item);
  assert.equal(item.querySelector('[data-n="catalog-tree-title"]'), title);
  document.body.addEventListener('keydown', () => bubbled++);
  assert.equal(emit(item, 'keydown', 'ArrowUp').defaultPrevented, true); assert.equal(bubbled, 0);
  model.reveal('/background-queue/components/1'); tree.render(); emit(root, 'keydown', 'Enter');
  assert.equal(opened, '/background-queue/components/1');
  assert.equal(root.querySelectorAll('[aria-selected="true"]').length, 1);
  assert.equal(root.querySelectorAll('[tabindex="0"]').length, 1);
  model.update('no-such-node', 'all'); tree.render();
  assert.ok(root.querySelector('[data-n="catalog-tree-empty"]'));
});
