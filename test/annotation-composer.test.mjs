import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { create_annotation_composer } from '../src/annotation-composer.js';

function setup(orders = [{ order: 1, label: '搜索框' }]) {
  const { document, window } = parseHTML('<html><head></head><body></body></html>');
  const submitted = [], cancelled = [];
  const composer = create_annotation_composer({
    document, window, get_orders: () => orders,
    on_submit: (parts, meta) => submitted.push({ parts, meta }),
    on_cancel: () => cancelled.push(true),
  });
  document.body.append(composer.root);
  const rect = { left: 10, top: 20, right: 110, bottom: 50, width: 100, height: 30 };
  return { composer, document, window, submitted, cancelled, rect };
}
function key(target, key, window, properties = {}) {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true });
  event.key = key; Object.assign(event, properties);
  target.dispatchEvent(event);
  return event;
}

test('缺少布局能力时降级为 textarea，open 渲染编号与节点', () => {
  const { composer, document, rect } = setup();
  composer.open({ mode: 'create', node: { tag: 'input', n: 'search', total: 1 }, rect, parts: [] });
  assert.equal(document.querySelector('[data-n="annotation-composer"]').hidden, false);
  assert.equal(document.querySelector('[data-n="annotation-composer"] .ProseMirror'), null);
  const input = document.querySelector('[data-n="annotation-input"]');
  assert.ok(input, '降级路径应创建 textarea');
  assert.equal(document.querySelector('[data-n="annotation-composer-order"]').textContent, '+');
  assert.equal(document.querySelector('[data-n="annotation-composer-node"]').textContent, 'search');

  composer.open({ mode: 'edit', node: { n: 'button' }, order: 3, rect, parts: [{ type: 'text', text: '已有内容' }] });
  assert.equal(document.querySelector('[data-n="annotation-composer-order"]').textContent, '#3');
  assert.equal(document.querySelector('[data-n="annotation-input"]').value, '已有内容');
});

test('提交时把 #1 转成引用，空内容不提交', () => {
  const { composer, document, submitted, rect } = setup();
  composer.open({ mode: 'create', node: { tag: 'input', n: 'search', total: 1 }, rect, parts: [] });

  composer.submit();
  assert.equal(submitted.length, 0);

  document.querySelector('[data-n="annotation-input"]').value = '参考 #1 调整';
  composer.submit();
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0].parts, [{ type: 'text', text: '参考 ' }, { type: 'ref', order: 1 }, { type: 'text', text: ' 调整' }]);
  assert.deepEqual(submitted[0].meta, { mode: 'create', order: null });
});

test('Esc 取消并关闭，Cmd/Ctrl+Enter 提交', () => {
  const { composer, document, window, submitted, cancelled, rect } = setup();
  composer.open({ mode: 'create', node: { tag: 'div' }, rect, parts: [] });
  const input = document.querySelector('[data-n="annotation-input"]');

  input.value = '确认内容';
  const enter = key(input, 'Enter', window, { metaKey: true });
  assert.equal(enter.defaultPrevented, true);
  assert.equal(submitted.length, 1);

  composer.open({ mode: 'create', node: { tag: 'div' }, rect, parts: [] });
  const escape = key(document.querySelector('[data-n="annotation-input"]'), 'Escape', window);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(cancelled.length, 1);
  assert.equal(composer.is_open(), false);
});
