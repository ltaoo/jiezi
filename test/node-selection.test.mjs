import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { rect_from_points, collect_selected_nodes, collect_clicked_node, collect_source_nodes, node_selector, selection_payload, local_rect, NodeSelectionModel } from '../src/node-selection.js';
import { create_node_picker } from '../src/node-picker.js';
import { trace_source } from '../src/source-runtime.js';

const rect = (x, y, width, height) => ({ left: x, top: y, right: x + width, bottom: y + height, width, height });
function setup() {
  const { document, window } = parseHTML('<html><body><dialog><div data-n="stage"></div></dialog></body></html>');
  window.Element.prototype.getBoundingClientRect = function() { return this.test_rect || rect(0, 0, 800, 600); };
  window.getComputedStyle = node => node.test_style || { display: 'block', visibility: 'visible', opacity: '1', overflow: 'visible' };
  const stage = document.querySelector('[data-n="stage"]'); stage.test_rect = rect(20, 40, 500, 400);
  const host = document.createElement('div'); host.dataset.status = 'mounted'; host.test_rect = rect(20, 40, 600, 400); stage.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const root = document.createElement('div'); root.test_rect = host.test_rect; shadow.append(root);
  const group = document.createElement('div'); group.setAttribute('n', 'group'); group.test_rect = rect(50, 80, 200, 100);
  const button = document.createElement('button'); button.setAttribute('n', 'save-button'); button.textContent = '保存'; button.test_rect = rect(60, 100, 80, 32); group.append(button); root.append(group);
  const outside = document.createElement('div'); outside.setAttribute('n', 'offscreen'); outside.test_rect = rect(600, 100, 100, 50); root.append(outside);
  return { document, window, stage, host, shadow, root, group, button, outside, frame: { id: 'test', title: '测试页面', file: 'src/page.js' } };
}

test('反向拖动归一化选区，完整子树只返回一次，局部相交不选整页容器', () => {
  const f = setup();
  const selection = rect_from_points({ x: 260, y: 190 }, { x: 40, y: 70 });
  assert.deepEqual(collect_selected_nodes(f.root, selection, f.stage.test_rect, { style_for: f.window.getComputedStyle }).elements, [f.group]);
  assert.deepEqual(collect_selected_nodes(f.root, rect(90, 110, 10, 10), f.stage.test_rect, { style_for: f.window.getComputedStyle }).elements, [f.button]);
  assert.equal(collect_selected_nodes(f.root, rect(0, 0, 1, 1), f.stage.test_rect).total, 0);
});

test('源码反向查找匹配声明、调用及多行范围，优先具体节点且仅查当前预览', () => {
  const f = setup();
  function bind(node, ...locations) {
    let mounted = null;
    const view = { t: 'view', onMounted() {}, get $elm() { return mounted; }, set $elm(value) { mounted = value; } };
    locations.forEach(source => trace_source(view, source)); view.$elm = node;
  }
  const source = { file: 'view.js', line: 14, column: 3, end_line: 16 };
  bind(f.group, { ...source, line: 10, end_line: 30 });
  bind(f.button, source, { file: 'page.frame', line: 8, column: 5, end_line: 9 });
  const nested = f.document.createElement('div'); nested.test_rect = rect(150, 80, 60, 100); f.group.append(nested);
  const child = f.document.createElement('span'); child.test_rect = rect(160, 100, 30, 32); nested.attachShadow({ mode: 'open' }).append(child); bind(child, source);
  const hidden = f.document.createElement('button'); hidden.test_rect = f.button.test_rect; hidden.test_style = { display: 'none' }; f.group.append(hidden); bind(hidden, source);
  const other_frame = f.document.createElement('button'); f.document.body.append(other_frame); bind(other_frame, source);
  const options = { style_for: f.window.getComputedStyle };
  const selected = collect_source_nodes(f.root, { file: 'view.js', line: 15 }, options);
  assert.deepEqual(selected.elements, [f.button, child]); assert.equal(selected.parent, f.group);
  assert.deepEqual(collect_source_nodes(f.root, { file: 'view.js', line: 17 }, options).elements, [f.group]);
  assert.deepEqual(collect_source_nodes(f.root, { file: 'page.frame', line: 9 }, options).elements, [f.button]);
  const truncated = collect_source_nodes(f.root, { file: 'view.js', line: 14 }, { ...options, limit: 1 });
  assert.equal(truncated.total, 2); assert.equal(truncated.elements.length, 1); assert.equal(truncated.parent, f.group);
  f.button.remove();
  assert.equal(collect_source_nodes(f.root, { file: 'page.frame', line: 8 }, options).total, 0);
  for (const location of [null, { file: 'other.js', line: 14 }, { file: 'view.js', line: 0 }]) assert.equal(collect_source_nodes(f.root, location, options).total, 0);
});

test('源码选择复用节点高亮与详情，无匹配时保留原选择', () => {
  const f = setup(), selections = [], revealed = [];
  f.button.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 12, column: 5 }));
  const picker = create_node_picker({ stage: f.stage, keyboard_root: f.document, frame: f.frame, get_preview: () => ({ host: f.host, root: f.root }), on_select: (result, location) => selections.push({ result, location }), on_reveal: rect => revealed.push(rect) });
  const location = { file: 'view.js', line: 12 };
  assert.equal(picker.select_source(location), true);
  assert.deepEqual(selections[0].result.elements, [f.button]); assert.equal(selections[0].location, location);
  assert.equal(revealed.length, 1);
  assert.equal(f.stage.querySelector('[data-n="node-picker-box"]').style.width, '80px');
  assert.equal(picker.select_source({ file: 'view.js', line: 99 }), false);
  assert.equal(selections.length, 1);
  picker.destroy(); assert.equal(picker.select_source(location), false);
});

test('排除隐藏和视口外节点，并考虑内部滚动容器的裁切', () => {
  const f = setup(), selection = rect(0, 0, 800, 600);
  f.group.test_style = { overflowY: 'auto' }; f.group.test_rect = rect(50, 80, 200, 40);
  f.button.test_rect = rect(60, 140, 80, 32);
  const selected = collect_selected_nodes(f.root, selection, f.stage.test_rect, { style_for: f.window.getComputedStyle });
  assert.ok(!selected.elements.includes(f.button));
  assert.ok(!selected.elements.includes(f.outside));
  f.group.test_style = { display: 'none' };
  assert.equal(collect_selected_nodes(f.root, selection, f.stage.test_rect, { style_for: f.window.getComputedStyle }).total, 0);
});

test('语义选择器、重复标识回退和嵌套 Shadow DOM 路径能定位实际节点', () => {
  const f = setup();
  assert.equal(node_selector(f.button, f.root), '[n="save-button"]');
  f.group.setAttribute('n', 'save-button');
  assert.equal(f.root.querySelector(node_selector(f.button, f.root)), f.button);
  const nested = f.document.createElement('div'); nested.setAttribute('data-n', 'nested'); nested.test_rect = rect(300, 80, 100, 100); f.root.append(nested);
  const nested_shadow = nested.attachShadow({ mode: 'open' });
  const child = f.document.createElement('span'); child.setAttribute('data-n', 'deep'); child.textContent = '深层'; child.test_rect = rect(310, 90, 60, 20); nested_shadow.append(child);
  const selected = collect_selected_nodes(f.root, rect(310, 90, 60, 20), f.stage.test_rect);
  assert.deepEqual(selected.elements, [child]);
  const selector = node_selector(child, f.root);
  const [outer, inner] = selector.split(' >>> ');
  assert.equal(f.root.querySelector(outer).shadowRoot.querySelector(inner), child);
});

test('结果带真实节点内容、来源与 Frame 局部坐标，截断限制明确', () => {
  const f = setup();
  Object.defineProperty(f.host, 'offsetWidth', { value: 1200 }); Object.defineProperty(f.host, 'offsetHeight', { value: 800 });
  assert.deepEqual(local_rect(f.button.test_rect, f.host), { x: 80, y: 120, width: 160, height: 64 });
  const selected = collect_selected_nodes(f.root, rect(55, 95, 90, 40), f.stage.test_rect);
  const payload = selection_payload(f.frame, f.root, f.host, rect(55, 95, 90, 40), selected);
  assert.equal(payload.nodes[0].n, 'save-button');
  assert.equal(payload.nodes[0].text, '保存');
  assert.match(payload.nodes[0].html, /<button/);
  assert.equal(payload.frame.file, 'src/page.js');
  assert.equal(payload.nodes[0].source, null);
  f.button.setAttribute('data-jiezi-source', JSON.stringify({ file: 'components/button.js', line: 12, column: 5 }));
  assert.deepEqual(selection_payload(f.frame, f.root, f.host, rect(55, 95, 90, 40), selected).nodes[0].source, { file: 'components/button.js', line: 12, column: 5 });
  assert.equal(payload.truncated, false);
  assert.equal(collect_selected_nodes(f.root, rect(55, 95, 90, 40), f.stage.test_rect, { limit: 0 }).total, 1);
});

test('多选提供最近公共父节点源码，保留子节点来源，截断前计算共同父节点', () => {
  const f = setup(), area = rect(55, 95, 220, 40);
  const source = (node, line) => node.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line, column: 3 }));
  source(f.group, 5); source(f.button, 8);
  const sibling = f.document.createElement('button'); sibling.test_rect = rect(150, 100, 50, 32); f.group.append(sibling); source(sibling, 12);
  const payload = () => selection_payload(f.frame, f.root, f.host, area, collect_selected_nodes(f.root, area, f.stage.test_rect));
  assert.deepEqual(payload().parent, { selector: '[n="group"]', source: { file: 'view.js', line: 5, column: 3 }, source_details: null });
  assert.deepEqual(payload().nodes.map(node => node.source.line), [8, 12]);
  f.group.removeAttribute('data-jiezi-source'); source(f.root, 1);
  assert.equal(payload().parent.source, null);
  const outside = f.document.createElement('button'); outside.test_rect = rect(220, 100, 40, 32); f.root.append(outside);
  const truncated = selection_payload(f.frame, f.root, f.host, area, collect_selected_nodes(f.root, area, f.stage.test_rect, { limit: 1 }));
  assert.equal(truncated.total, 3);
  assert.equal(truncated.truncated, true);
  assert.equal(truncated.parent.selector, ':scope');
  assert.equal(truncated.parent.source.line, 1);
});

test('跨嵌套 ShadowRoot 的多选以真实宿主链寻找公共父节点', () => {
  const f = setup();
  f.group.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 5, column: 3 }));
  const nested = f.document.createElement('div'); nested.test_rect = rect(150, 80, 60, 100); f.group.append(nested);
  const child = f.document.createElement('span'); child.test_rect = rect(160, 100, 30, 32); nested.attachShadow({ mode: 'open' }).append(child);
  const area = rect(55, 95, 160, 40), selected = collect_selected_nodes(f.root, area, f.stage.test_rect);
  assert.deepEqual(selected.elements, [f.button, child]);
  assert.equal(selection_payload(f.frame, f.root, f.host, area, selected).parent.source.line, 5);
});

test('弹窗框选排除遮罩和被遮挡的整页内容，保留实际节点的共同父节点及源码', () => {
  const f = setup();
  const source = (node, line) => node.setAttribute('data-jiezi-source', JSON.stringify({ file: 'dialog.js', line, column: 3 }));
  source(f.group, 5); source(f.button, 8);
  const sibling = f.document.createElement('input'); sibling.dataset.n = 'dialog-input'; sibling.test_rect = rect(150, 100, 50, 32); source(sibling, 12); f.group.append(sibling);
  const backdrop = f.document.createElement('div'); backdrop.dataset.n = 'dialog-backdrop'; backdrop.test_rect = f.root.test_rect;
  const page = f.document.createElement('section'); page.dataset.n = 'covered-page'; page.test_rect = f.root.test_rect;
  const covered = f.document.createElement('button'); covered.dataset.n = 'covered-button'; covered.test_rect = f.button.test_rect; page.append(covered);
  f.root.prepend(page, backdrop);
  f.host.inert = true; f.host.style.setProperty('pointer-events', 'none'); const style = f.host.style.cssText;
  f.shadow.elementFromPoint = (x, y) => {
    assert.equal(f.host.inert, false);
    assert.equal(f.host.style.getPropertyValue('pointer-events'), 'auto');
    for (const node of [f.button, sibling, f.group]) {
      const box = node.test_rect;
      if (x >= box.left && x < box.right && y >= box.top && y < box.bottom) return node;
    }
    return backdrop;
  };
  const area = rect(55, 95, 150, 40), selected = collect_selected_nodes(f.root, area, f.stage.test_rect, { style_for: f.window.getComputedStyle });
  assert.deepEqual(selected.elements, [f.button, sibling]);
  assert.equal(selected.parent, f.group);
  assert.equal(selection_payload(f.frame, f.root, f.host, area, selected).parent.source.line, 5);
  const around_dialog = rect(40, 70, 220, 120);
  const enclosed = collect_selected_nodes(f.root, around_dialog, f.stage.test_rect);
  assert.deepEqual(enclosed.elements, [f.group]);
  assert.equal(selection_payload(f.frame, f.root, f.host, around_dialog, enclosed).nodes[0].source.line, 5);
  assert.equal(f.host.inert, true); assert.equal(f.host.style.cssText, style);
});

test('框选命中检查保留边缘可见的节点，并沿嵌套 ShadowRoot 检查真实命中', () => {
  const f = setup();
  const child = f.document.createElement('span'); child.dataset.n = 'nested-label'; child.test_rect = f.button.test_rect;
  const shadow = f.button.attachShadow({ mode: 'open' }); shadow.append(child);
  f.shadow.elementFromPoint = () => f.button;
  shadow.elementFromPoint = x => x < 65 ? child : f.root;
  const selected = collect_selected_nodes(f.root, rect(60, 100, 80, 32), f.stage.test_rect);
  assert.deepEqual(selected.elements, [f.button]);
});

test('点选使用真实事件目标，支持嵌套 ShadowRoot 并排除隐藏、裁切和页面外节点', () => {
  const f = setup(), point = { x: 70, y: 110 }, options = { style_for: f.window.getComputedStyle };
  const click = target => collect_clicked_node(f.root, target, point, f.stage.test_rect, options);
  assert.deepEqual(click(f.button).elements, [f.button]);
  assert.deepEqual(click(f.button.firstChild).elements, [f.button]);
  assert.equal(click(f.stage).total, 0);
  assert.equal(click(f.root).total, 0);
  f.group.test_style = { display: 'none' };
  assert.equal(click(f.button).total, 0);
  f.group.test_style = { overflow: 'hidden' }; f.group.test_rect = rect(50, 80, 200, 20);
  assert.equal(click(f.button).total, 0);
  f.group.test_style = {};
  const nested = f.document.createElement('div'); f.root.append(nested);
  const child = f.document.createElement('span'); child.test_rect = f.button.test_rect;
  nested.attachShadow({ mode: 'open' }).append(child);
  assert.deepEqual(click(child).elements, [child]);
});

test('预览屏蔽指针时通过同步命中测试点选，并在成功和异常时恢复交互屏蔽', () => {
  const f = setup();
  f.host.inert = true; f.host.style.setProperty('pointer-events', 'none');
  const style = f.host.style.cssText;
  f.shadow.elementFromPoint = () => {
    assert.equal(f.host.inert, false);
    assert.equal(f.host.style.getPropertyValue('pointer-events'), 'auto');
    return f.button;
  };
  assert.deepEqual(collect_clicked_node(f.root, f.stage, { x: 70, y: 110 }, f.stage.test_rect, { style_for: f.window.getComputedStyle }).elements, [f.button]);
  assert.equal(f.host.inert, true);
  assert.equal(f.host.style.cssText, style);
  f.shadow.elementFromPoint = () => { throw new Error('hit-test'); };
  assert.throws(() => collect_clicked_node(f.root, f.stage, { x: 70, y: 110 }, f.stage.test_rect), /hit-test/);
  assert.equal(f.host.inert, true);
  assert.equal(f.host.style.cssText, style);
});

test('Alt 点击及启用选择后点击输出节点源码，普通点击保持原有交互', () => {
  const f = setup(), selections = [];
  f.button.setAttribute('data-jiezi-source', JSON.stringify({ file: 'view.js', line: 8, column: 3 }));
  const picker = create_node_picker({ stage: f.stage, keyboard_root: f.document.querySelector('dialog'), frame: f.frame, get_preview: () => ({ host: f.host, root: f.root }), on_select: value => selections.push(value) });
  const emit = (type, altKey = false) => {
    const event = new f.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, altKey, clientX: 70, clientY: 110, composedPath: () => [f.button, f.root, f.host, f.stage] });
    f.stage.dispatchEvent(event); return event;
  };
  assert.equal(emit('pointerdown').defaultPrevented, false);
  assert.equal(emit('click').defaultPrevented, false);
  assert.equal(selections.length, 0);
  assert.equal(emit('pointerdown', true).defaultPrevented, true);
  emit('pointerup', true);
  assert.deepEqual(selections.at(-1).elements, [f.button]);
  assert.deepEqual(selections.at(-1).payload.nodes[0].source, { file: 'view.js', line: 8, column: 3 });
  assert.equal(emit('click', true).defaultPrevented, true);
  picker.toggle(); emit('pointerdown'); emit('pointerup');
  assert.equal(selections.at(-1).elements[0], f.button);
  assert.equal(f.stage.querySelector('[data-n="node-picker-box"]').style.width, '80px');
  picker.destroy();
});

test('Alt 框选拦截页面点击、输出实际 DOM，Escape 清除，销毁后恢复普通操作', () => {
  const f = setup(), selections = [];
  const picker = create_node_picker({ stage: f.stage, keyboard_root: f.document.querySelector('dialog'), frame: f.frame, get_preview: () => ({ host: f.host, root: f.root }), on_select: result => selections.push(result) });
  const emit = (type, props) => {
    const event = new f.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, altKey: true, ...props });
    f.stage.dispatchEvent(event); return event;
  };
  assert.equal(emit('pointerdown', { clientX: 55, clientY: 95 }).defaultPrevented, true);
  emit('pointermove', { clientX: 145, clientY: 135 }); emit('pointerup', { clientX: 145, clientY: 135 });
  const selected = selections.at(-1);
  assert.equal(selected.elements[0], f.button);
  assert.equal(selected.payload.nodes[0].selector, '[n="save-button"]');
  assert.equal(f.stage.querySelector('[data-n="node-picker-box"]').style.width, '90px');
  assert.equal(emit('click', {}).defaultPrevented, true);
  const escape = new f.window.Event('keydown', { bubbles: true, cancelable: true }); escape.key = 'Escape'; f.document.querySelector('dialog').dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true); assert.equal(selections.at(-1), null);
  picker.destroy(); picker.destroy();
  assert.equal(emit('pointerdown', { clientX: 55, clientY: 95 }).defaultPrevented, false);
  assert.equal(f.stage.querySelector('[data-n="node-picker-overlay"]'), null);
});

for (const kind of ['siblings', 'shadow', 'root']) test(`多节点框选松手后高亮最近共同父容器，按视口裁切：${kind}`, () => {
  const f = setup(), selections = [];
  const sibling = f.document.createElement('button'); sibling.dataset.n = 'sibling'; sibling.test_rect = rect(150, 100, 50, 32);
  let parent = f.group;
  if (kind === 'shadow') {
    const nested = f.document.createElement('div'); nested.dataset.n = 'nested'; nested.test_rect = rect(150, 80, 60, 100);
    f.group.append(nested); nested.attachShadow({ mode: 'open' }).append(sibling);
  } else if (kind === 'root') {
    parent = f.root; sibling.test_rect = rect(300, 100, 50, 32); parent.append(sibling);
  } else parent.append(sibling);
  const picker = create_node_picker({ stage: f.stage, keyboard_root: f.document, frame: f.frame, get_preview: () => ({ host: f.host, root: f.root }), on_select: value => selections.push(value) });
  const emit = (type, x, y) => {
    const event = new f.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, altKey: true, clientX: x, clientY: y }); f.stage.dispatchEvent(event);
  };
  const right = sibling.test_rect.right + 5;
  const box = f.stage.querySelector('[data-n="node-picker-box"]');
  emit('pointerdown', right, 135); emit('pointermove', 55, 95);
  assert.equal(box.style.width, `${right - 55}px`);
  assert.equal(selections.length, 0);
  emit('pointerup', 55, 95);
  const selected = selections.at(-1);
  assert.deepEqual(selected.elements, [f.button, sibling]);
  assert.equal(selected.payload.parent.selector, kind === 'root' ? ':scope' : '[n="group"]');
  assert.deepEqual(selected.payload.selection, { x: 35, y: 55, width: right - 55, height: 40 });
  assert.equal(box.style.left, kind === 'root' ? '0px' : '30px');
  assert.equal(box.style.top, kind === 'root' ? '0px' : '40px');
  assert.equal(box.style.width, kind === 'root' ? '500px' : '200px');
  assert.equal(box.style.height, kind === 'root' ? '400px' : '100px');
  picker.destroy();
});

test('内部 ShadowRoot 滚动清除旧选区；关闭预览模式后不拦截指针', () => {
  const f = setup(), selections = [];
  const picker = create_node_picker({ stage: f.stage, keyboard_root: f.document.querySelector('dialog'), frame: f.frame, get_preview: () => ({ host: f.host, root: f.root }), on_select: value => selections.push(value) });
  picker.toggle();
  assert.equal(f.host.getAttribute('data-picking'), 'true');
  const event = new f.window.Event('pointerdown', { cancelable: true }); Object.assign(event, { button: 0, pointerId: 1, clientX: 55, clientY: 95 }); f.stage.dispatchEvent(event);
  f.shadow.dispatchEvent(new f.window.Event('scroll'));
  assert.equal(selections.at(-1), null);
  picker.set_active(false);
  assert.equal(f.host.getAttribute('data-picking'), 'false');
  picker.destroy();
});

test('层级 Model 逐层选择父节点并原路退回，根节点使用 :scope 且不会越过预览', () => {
  const f = setup(), model = NodeSelectionModel(f.frame);
  model.select(f.root, f.host, f.button.test_rect, { elements: [f.button], total: 1 }, f.stage.test_rect);
  const initial = model.state.current;
  model.select_parent();
  assert.deepEqual(model.state.current.result.elements, [f.group]);
  assert.equal(model.state.current.result.payload.nodes[0].selector, '[n="group"]');
  const group = model.state.current;
  model.select_parent();
  assert.deepEqual(model.state.current.result.elements, [f.root]);
  assert.equal(model.state.current.result.payload.nodes[0].selector, ':scope');
  assert.equal(model.state.current.rect.width, 500);
  assert.equal(model.can_parent(), false);
  model.select_parent();
  assert.equal(model.state.history.length, 2);
  model.back(); assert.equal(model.state.current, group);
  model.back(); assert.equal(model.state.current, initial);
  model.back(); assert.equal(model.state.current, initial);
  assert.equal(model.state.history.length, 0);
});

test('层级 Model 支持 ShadowRoot 的宿主链，新选择及清除会重置历史', () => {
  const f = setup(), model = NodeSelectionModel(f.frame);
  const child = f.document.createElement('span'); child.dataset.n = 'nested-child'; child.test_rect = f.button.test_rect;
  f.button.attachShadow({ mode: 'open' }).append(child);
  model.select(f.root, f.host, child.test_rect, { elements: [child], total: 1 }, f.stage.test_rect);
  model.select_parent(); assert.equal(model.state.current.node, f.button);
  model.select_parent(); assert.equal(model.state.current.node, f.group);
  model.select(f.root, f.host, f.button.test_rect, { elements: [f.button], total: 1 }, f.stage.test_rect);
  assert.equal(model.state.history.length, 0);
  model.select_parent(); model.clear(); model.back();
  assert.equal(model.state.current, null);
  assert.equal(model.can_parent(), false);
  assert.equal(model.state.history.length, 0);
});

test('移动或缩放后更新可见选框和历史视口，移出视口仍保留选中结果', () => {
  const f = setup(), model = NodeSelectionModel(f.frame);
  model.select(f.root, f.host, f.button.test_rect, { elements: [f.button], total: 1 }, f.stage.test_rect);
  const initial = model.state.current.result;
  model.select_parent();
  f.group.test_rect = rect(100, 110, 400, 200); f.button.test_rect = rect(120, 150, 160, 64);
  const viewport = rect(20, 40, 200, 180);
  model.refresh(viewport);
  assert.deepEqual(model.state.current.rect, rect(100, 110, 120, 110));
  assert.equal(model.state.history.length, 1);
  model.back();
  assert.equal(model.state.current.viewport, viewport);
  assert.equal(model.state.current.result, initial);
  assert.deepEqual(model.state.current.rect, rect(120, 150, 100, 64));
  model.refresh(null);
  assert.equal(model.state.current.rect, null);
  assert.equal(model.state.current.result, initial);
  model.refresh(f.stage.test_rect);
  assert.deepEqual(model.state.current.rect, f.button.test_rect);
});

test('刷新选框只跟随节点位置，不重新选择；移出视口隐藏，移回后恢复箭头', () => {
  const f = setup(), selections = [];
  const picker = create_node_picker({ stage: f.stage, keyboard_root: f.document, frame: f.frame, get_preview: () => ({ host: f.host, root: f.root }), on_select: value => selections.push(value) });
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new f.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, altKey: true, clientX: 70, clientY: 110, composedPath: () => [f.button] }); f.stage.dispatchEvent(event);
  }
  const box = f.stage.querySelector('[data-n="node-picker-box"]'), controls = f.stage.querySelector('[data-n="node-picker-controls"]');
  const initial = selections[0];
  f.button.test_rect = rect(120, 150, 160, 64); picker.refresh();
  assert.equal(box.style.left, '100px'); assert.equal(box.style.top, '110px');
  assert.equal(box.style.width, '160px'); assert.equal(controls.style.left, '120px');
  f.button.test_rect = rect(600, 150, 160, 64); picker.refresh();
  assert.equal(box.hidden, true); assert.equal(controls.hidden, true);
  f.button.test_rect = rect(120, 150, 160, 64); picker.refresh();
  assert.equal(box.hidden, false); assert.equal(controls.hidden, false);
  assert.equal(selections.length, 1); assert.equal(selections[0], initial);
  picker.destroy();
});

test('选区左上角箭头独立响应，向上从共同父容器开始，向下恢复多选及原始选框', () => {
  const f = setup(), selections = [];
  const sibling = f.document.createElement('button'); sibling.dataset.n = 'sibling'; sibling.test_rect = rect(150, 100, 50, 32); f.group.append(sibling);
  const picker = create_node_picker({ stage: f.stage, keyboard_root: f.document, frame: f.frame, get_preview: () => ({ host: f.host, root: f.root }), on_select: value => selections.push(value) });
  const query = name => f.stage.querySelector(`[data-n="${name}"]`);
  const controls = query('node-picker-controls'), up = query('node-picker-parent'), down = query('node-picker-back'), box = query('node-picker-box');
  const emit = (target, type, props = {}) => {
    const event = new f.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, altKey: true, ...props }); target.dispatchEvent(event); return event;
  };
  const click = target => {
    emit(target, 'pointerdown', { clientX: 55, clientY: 85 });
    emit(target, 'pointerup', { clientX: 55, clientY: 85 });
    emit(target, 'click');
  };
  assert.equal(controls.hidden, true);
  emit(f.stage, 'pointerdown', { clientX: 55, clientY: 95 });
  emit(f.stage, 'pointerup', { clientX: 205, clientY: 135 });
  const initial = selections.at(-1);
  assert.deepEqual(initial.elements, [f.button, sibling]);
  assert.equal(controls.hidden, false);
  assert.equal(controls.style.left, '50px');
  assert.equal(controls.style.top, '80px');
  assert.equal(controls.closest('[aria-hidden="true"]'), null);
  assert.equal(up.getAttribute('aria-label'), '选择父节点');
  assert.equal(down.disabled, true);
  assert.equal(up.disabled, false);
  let stage_pointers = 0; f.stage.addEventListener('pointerdown', () => { stage_pointers++; });
  click(up);
  assert.equal(stage_pointers, 0);
  assert.equal(selections.length, 2);
  assert.deepEqual(selections.at(-1).elements, [f.root]);
  assert.equal(up.disabled, true); assert.equal(down.disabled, false);
  assert.equal(box.style.width, '500px');
  click(down);
  assert.equal(selections.length, 3);
  assert.equal(selections.at(-1), initial);
  assert.equal(box.style.width, '200px');
  assert.equal(down.disabled, true);
  click(up);
  emit(f.stage, 'pointerdown', { clientX: 60, clientY: 100, composedPath: () => [f.button] });
  assert.equal(controls.hidden, true);
  emit(f.stage, 'pointerup', { clientX: 60, clientY: 100, composedPath: () => [f.button] });
  assert.deepEqual(selections.at(-1).elements, [f.button]);
  assert.equal(down.disabled, true);
  picker.clear();
  assert.equal(controls.hidden, true); assert.equal(box.hidden, true);
  picker.destroy();
});
