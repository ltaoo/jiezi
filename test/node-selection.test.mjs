import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { rect_from_points, collect_selected_nodes, node_selector, selection_payload, local_rect } from '../src/node-selection.js';
import { create_node_picker } from '../src/node-picker.js';

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
  assert.equal(payload.truncated, false);
  assert.equal(collect_selected_nodes(f.root, rect(55, 95, 90, 40), f.stage.test_rect, { limit: 0 }).total, 1);
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
  assert.equal(emit('click', {}).defaultPrevented, true);
  const escape = new f.window.Event('keydown', { bubbles: true, cancelable: true }); escape.key = 'Escape'; f.document.querySelector('dialog').dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true); assert.equal(selections.at(-1), null);
  picker.destroy(); picker.destroy();
  assert.equal(emit('pointerdown', { clientX: 55, clientY: 95 }).defaultPrevented, false);
  assert.equal(f.stage.querySelector('[data-n="node-picker-overlay"]'), null);
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
