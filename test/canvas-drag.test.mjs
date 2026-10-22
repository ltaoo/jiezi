import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { create_canvas_drag } from '../src/canvas-drag.js';

function setup() {
  const { window, document } = parseHTML('<html><body><main><button>Frame 标题</button></main></body></html>');
  const workspace = document.querySelector('main'), title = document.querySelector('button');
  const captures = [], held = new Set(), view = { x: 0, y: 0, scale: .5 }, frame = { x: 80, y: 90 };
  let drops = 0, changes = 0;
  workspace.setPointerCapture = pointer => { captures.push(pointer); held.add(pointer); };
  workspace.hasPointerCapture = pointer => held.has(pointer);
  workspace.releasePointerCapture = pointer => held.delete(pointer);
  const drag = create_canvas_drag(workspace, { get_view: () => view, on_change: () => changes++, on_frame_drop: () => drops++ });
  title.addEventListener('pointerdown', event => drag.start(event, { type: 'frame', frame, x: frame.x, y: frame.y }));
  const emit = (target, type, x = 0, y = 0) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, pointerId: 1, clientX: x, clientY: y }); target.dispatchEvent(event); return event;
  };
  return { window, workspace, title, view, frame, drag, captures, emit, counts: () => ({ drops, changes }) };
}

test('标题点击与双击不会提前捕获指针或阻止默认行为', () => {
  const f = setup(); let opened = 0;
  f.title.addEventListener('dblclick', () => opened++);
  for (let index = 0; index < 2; index++) {
    assert.equal(f.emit(f.title, 'pointerdown', 100, 100).defaultPrevented, false);
    f.emit(f.window, 'pointermove', 102, 101);
    assert.equal(f.emit(f.window, 'pointerup', 102, 101).defaultPrevented, false);
    assert.equal(f.emit(f.title, 'click').defaultPrevented, false);
  }
  f.emit(f.title, 'dblclick');
  assert.equal(opened, 1);
  assert.equal(f.captures.length, 0);
  assert.deepEqual(f.frame, { x: 80, y: 90 });
  assert.equal(f.counts().drops, 0);
  f.drag.destroy();
});

test('超过阈值后才拖动，按缩放换算位移，并抑制拖动释放后的点击', () => {
  const f = setup();
  f.emit(f.title, 'pointerdown', 100, 100);
  f.emit(f.window, 'pointermove', 110, 115);
  assert.deepEqual(f.captures, [1]);
  assert.deepEqual(f.frame, { x: 100, y: 120 });
  assert.equal(f.workspace.classList.contains('dragging'), true);
  f.emit(f.window, 'pointerup', 110, 115);
  assert.equal(f.counts().drops, 1);
  assert.equal(f.emit(f.workspace, 'click').defaultPrevented, true);
  assert.equal(f.workspace.classList.contains('dragging'), false);
  f.emit(f.title, 'pointerdown', 100, 100); f.emit(f.window, 'pointerup', 100, 100);
  assert.equal(f.emit(f.title, 'click').defaultPrevented, false);
  f.drag.destroy();
});

test('取消拖动恢复位置并释放捕获，移除控制器后不响应事件', () => {
  const f = setup();
  f.emit(f.title, 'pointerdown', 100, 100); f.emit(f.window, 'pointermove', 120, 100);
  f.emit(f.window, 'pointercancel');
  assert.deepEqual(f.frame, { x: 80, y: 90 });
  assert.equal(f.workspace.hasPointerCapture(1), false);
  assert.equal(f.counts().drops, 0);
  f.drag.destroy();
  f.emit(f.window, 'pointermove', 200, 100);
  assert.deepEqual(f.frame, { x: 80, y: 90 });
});
