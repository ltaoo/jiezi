import test from 'node:test';
import assert from 'node:assert/strict';
import { zoom_at, fit_frames, arrange_frames, frame_group_bounds } from '../src/geometry.js';
import { BoardModel } from '../src/board.model.js';
import { CatalogTreeModel } from '../src/catalog-tree.model.js';

const frame = (path, title, kind = 'page', preview = 'direct') => ({ id: path, path, title, name: title, kind, file: `src${path}.frame`, preview });
const catalog = [frame('/home/1', '首页'), frame('/frui/button', 'Button', 'component'), frame('/components/menu', 'Menu', 'component', 'source')];
test('缩放保持指针下的世界坐标，并限制缩放范围', () => {
  const view = { x: -100, y: 80, scale: .5 }, point = { x: 300, y: 240 };
  const next = zoom_at(view, 1.5, point);
  assert.equal((point.x - view.x) / view.scale, (point.x - next.x) / next.scale);
  assert.equal((point.y - view.y) / view.scale, (point.y - next.y) / next.scale);
  assert.equal(zoom_at(view, 99, point).scale, 2);
  assert.equal(zoom_at(view, 0, point).scale, .08);
});
test('适应画布包含标题和移动后的 Frame，并处理空目录', () => {
  const frames = arrange_frames(catalog).slice(0, 1);
  frames[0].x = -500; frames[0].y = -100;
  const view = fit_frames(frames, 900, 600);
  assert.ok(frames[0].x * view.scale + view.x >= 47);
  assert.ok((frames[0].y - 38) * view.scale + view.y >= 47);
  assert.ok((frames[0].x + frames[0].width) * view.scale + view.x <= 853);
  assert.ok(fit_frames([], 900, 600).scale > 0);
});
test('源码反选时把视口外节点移到画布中央，视口内节点不移动且缩放不变', () => {
  const model = BoardModel(catalog, { getItem() {} });
  const viewport = { left: 100, top: 50, right: 1100, bottom: 850 };
  const original = { ...model.state.view };
  model.reveal_rect({ left: 150, top: 100, right: 300, bottom: 200 }, viewport);
  assert.deepEqual(model.state.view, original);
  model.reveal_rect({ left: 2000, top: -300, right: 2200, bottom: -100 }, viewport);
  assert.deepEqual(model.state.view, { x: original.x - 1500, y: original.y + 650, scale: original.scale });
});
test('搜索跨名称和目录路径，布局按项目及 path 保存，改名不丢失位置', () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const model = BoardModel(catalog, storage, 'first');
  model.state.filter = 'all'; model.state.query = '/frui/button';
  assert.deepEqual(model.visible().map(frame => frame.id), ['/frui/button']);
  model.state.query = ''; model.state.filter = 'direct';
  assert.deepEqual(new Set(model.visible().map(frame => frame.id)), new Set(['/home/1', '/frui/button']));
  model.state.frames.find(frame => frame.id === '/home/1').x = 800; model.persist();
  const renamed = catalog.map(frame => frame.id === '/home/1' ? { ...frame, title: '改名' } : frame);
  assert.equal(BoardModel(renamed, storage, 'first').state.frames.find(frame => frame.id === '/home/1').x, 800);
  assert.equal(BoardModel(catalog, storage, 'second').state.frames.find(frame => frame.id === '/home/1').x, 80);
  model.reset(); assert.equal(model.state.frames.find(frame => frame.id === '/home/1').x, 80);
});
test('损坏或被禁用的本地存储不阻止白板启动', () => {
  const model = BoardModel(catalog, { getItem() { return '{bad'; }, setItem() { throw new Error('unavailable'); } });
  assert.equal(model.state.frames.length, 3);
  assert.doesNotThrow(() => model.persist());
});
test('替换目录更新 Frame 和目录树，保留视口、位置与预览宽度，清除旧节点选择', () => {
  const model = BoardModel(catalog, { getItem() {} });
  model.read_route(model.frame_url(catalog[0].id));
  model.state.detail.selection = { elements: ['old node'] };
  model.set_detail_width(390);
  model.state.detail.selection = { elements: ['old node'] };
  const tree = model.tree, previous = model.state.detail.frame, view = { ...model.state.view };
  const next = [{ ...catalog[0], title: '新首页', source: 'updated', width: 1440, height: 1200 }, frame('/new/component', '新组件', 'component')];
  model.replace_catalog(next);
  assert.equal(model.tree, tree);
  assert.equal(model.state.detail.frame.title, '新首页');
  assert.equal(model.state.detail.frame.source, 'updated');
  assert.equal(model.state.detail.frame.x, previous.x);
  assert.equal(model.state.detail.width, 390);
  assert.equal(model.state.detail.selection, null);
  assert.deepEqual(model.state.view, view);
  assert.ok(model.tree.ordered_frames().some(frame => frame.id === '/new/component'));
  assert.equal(model.tree.ordered_frames().some(frame => frame.id === '/frui/button'), false);
  model.replace_catalog([]);
  assert.equal(model.state.detail.frame, undefined);
  assert.match(model.state.detail.error, /找不到/);
  assert.deepEqual(model.visible(), []);
});
test('顶层目录决定 Frames 分组，页面同级与 components 文件夹的示例都在同组', () => {
  const items = [frame('/background-queue/1', '后台队列'), frame('/background-queue/2', '文件下载'),
    frame('/background-queue/components/1', '任务详情', 'component'), frame('/background-queue/components/fields/1', '字段', 'component'),
    frame('/other/1', '另一页'), catalog[1]];
  const model = BoardModel(items, { getItem() {} });
  const by_id = new Map(model.state.frames.map(frame => [frame.id, frame]));
  for (const item of items.filter(item => item.path.startsWith('/background-queue/'))) assert.equal(by_id.get(item.id).group_id, '/background-queue');
  assert.equal(by_id.get('/other/1').group_id, '/other');
  assert.equal(model.visible().length, items.length);
  model.state.query = '/background-queue'; assert.equal(model.visible().length, 4);
  model.state.query = '任务详情'; assert.deepEqual(model.visible().map(frame => frame.id), ['/background-queue/components/1']);
  model.state.query = '';
  const groups = model.groups(); assert.equal(groups.length, 3);
  for (const group of groups) for (const frame of group.frames) {
    assert.ok(frame.x > group.bounds.x && frame.y - 38 > group.bounds.y);
    assert.ok(frame.x + frame.width < group.bounds.x + group.bounds.width);
    assert.ok(frame.y + frame.height < group.bounds.y + group.bounds.height);
  }
  assert.ok(groups[0].bounds.y + groups[0].bounds.height < groups[1].bounds.y);
  const original = frame_group_bounds(groups.find(group => group.id === '/background-queue').frames);
  const child = by_id.get('/background-queue/components/fields/1'), default_x = child.x;
  child.x = -900;
  assert.ok(model.groups().find(group => group.id === '/background-queue').bounds.x < original.x);
  model.fit_group(1000, 700, '/background-queue');
  const { x, y, scale } = model.state.view, bounds = model.groups().find(group => group.id === '/background-queue').bounds;
  assert.ok(bounds.x * scale + x >= 47); assert.ok(bounds.y * scale + y >= 47);
  model.reset(); assert.equal(child.x, default_x);
});
test('新路径布局使用 v4 存储，不读取旧名称 ID 的坐标', () => {
  const keys = [];
  const model = BoardModel(catalog, { getItem(key) { keys.push(key); return JSON.stringify({ 'page:Home': { x: 500, y: 600 } }); } });
  assert.ok(keys[0].endsWith(':layout:v4'));
  assert.notEqual(model.state.frames.find(frame => frame.id === '/home/1').x, 500);
});
test('恢复旧坐标时独立组件分组避开 tasks，保留组内位置且不改变无重叠布局', () => {
  const items = [{ ...frame('/tasks/1', '任务'), order: 1 },
    frame('/components/discovery_platform/1', '来源 Select', 'component'),
    frame('/components/discovery_platform/2', '来源 Select · 选中内容', 'component')];
  const defaults = arrange_frames(items), component_y = defaults[1].y;
  const saved = { '/tasks/1': { x: 80, y: component_y } };
  const model = BoardModel(items, { getItem: () => JSON.stringify(saved) });
  const [tasks, components] = model.groups();
  assert.equal(tasks.id, '/tasks'); assert.equal(components.id, '/components');
  assert.equal(tasks.frames[0].y, component_y);
  assert.ok(components.bounds.y > tasks.bounds.y + tasks.bounds.height);
  assert.equal(components.frames[1].x - components.frames[0].x, defaults[2].x - defaults[1].x);
  assert.equal(components.frames[1].y - components.frames[0].y, defaults[2].y - defaults[1].y);
  assert.deepEqual(BoardModel(items, { getItem() {} }).state.frames, defaults);
  const separate = { '/tasks/1': { x: -5000, y: component_y } };
  assert.equal(BoardModel(items, { getItem: () => JSON.stringify(separate) }).state.frames[0].y, component_y);
});
test('刷新新增组件或扩大 Frame 时，分组整体避让且保持独立空间', () => {
  const task = { ...frame('/tasks/1', '任务'), order: 1 };
  const components = [frame('/components/discovery_platform/1', '来源 Select', 'component'),
    frame('/components/discovery_platform/2', '来源 Select · 选中内容', 'component')];
  const model = BoardModel([task], { getItem() {} });
  model.state.frames[0].y = arrange_frames([task, ...components])[1].y;
  model.replace_catalog([task, ...components]);
  let groups = model.groups();
  assert.ok(groups[1].bounds.y > groups[0].bounds.y + groups[0].bounds.height);
  model.replace_catalog([{ ...task, height: 2400 }, ...components]);
  groups = model.groups();
  assert.ok(groups[1].bounds.y > groups[0].bounds.y + groups[0].bounds.height);
  assert.equal(groups[1].frames[0].y, groups[1].frames[1].y);
});
test('自定义尺寸参与分组排列，同排不重叠且下排避开最高的 Frame', () => {
  const items = [catalog[0], ...Array.from({ length: 7 }, (_, index) => ({ ...frame(`/home/components/${index}`, `组件 ${index}`, 'component'), ...(index === 0 ? { width: 1200, height: 800 } : {}) }))];
  const components = arrange_frames(items).filter(frame => frame.kind === 'component');
  assert.equal(components[0].width, 1200); assert.equal(components[0].height, 800);
  assert.ok(components[1].x >= components[0].x + components[0].width + 80);
  assert.ok(components[6].y >= components[0].y + components[0].height + 100);
});
test('画布顺序与路径树的完整前序遍历一致，折叠目录不改变排列', () => {
  const items = [frame('/z/1', '页面 Z'), frame('/a/components/2', '组件 B', 'component'), frame('/a/1', '页面 A'),
    frame('/a/components/nested/1', '嵌套组件', 'component'), frame('/a/2', '页面 B'), catalog[1]];
  const tree = CatalogTreeModel(items); tree.update('', 'all'); tree.expand_all(true);
  const expected = tree.rows().filter(row => row.frame).map(row => row.frame.id);
  const model = BoardModel(items, { getItem() {} }); model.state.filter = 'all';
  assert.deepEqual(model.state.frames.map(frame => frame.id), expected);
  assert.deepEqual(model.groups().map(group => group.id), ['/a', '/frui', '/z']);
  for (const group of model.groups()) {
    const visual_order = [...group.frames].sort((a, b) => a.y - b.y || a.x - b.x);
    assert.deepEqual(visual_order.map(frame => frame.id), expected.filter(id => group.frames.some(frame => frame.id === id)));
  }
  const positions = model.state.frames.map(({ id, x, y }) => ({ id, x, y }));
  model.tree.expand_all(false); model.reset();
  assert.deepEqual(model.state.frames.map(({ id, x, y }) => ({ id, x, y })), positions);
});
