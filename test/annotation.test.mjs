import test from 'node:test';
import assert from 'node:assert/strict';
import { AnnotationModel, parts_text, normalize_references } from '../src/annotation.model.js';
import { BoardModel } from '../src/board.model.js';
import { doc_from_parts, parts_from_doc } from '../src/annotation-editor.js';

const catalog = [
  { id: '/home', path: '/home', name: '首页', title: '首页', kind: 'page', file: 'home.frame', source: 'export const home = true;', preview: 'direct', width: 1200, height: 800, route: '/home' },
  { id: '/other', path: '/other', name: '其他', title: '其他', kind: 'page', file: 'other.frame', source: 'export const other = true;', preview: 'direct', width: 390, height: 700 },
];

test('标注按添加顺序编号，删除后不回收、不重排', () => {
  const model = AnnotationModel();
  const first = model.add({ node: { tag: 'input', n: 'search' }, parts: [{ type: 'text', text: '改大一些' }] });
  const second = model.add({ node: { tag: 'button', n: 'submit' }, parts: [] });
  assert.equal(first.order, 1);
  assert.equal(second.order, 2);
  assert.deepEqual(model.orders(), [1, 2]);
  assert.equal(model.next_order(), 3);

  assert.equal(model.remove(1), true);
  assert.equal(model.remove(99), false);
  assert.deepEqual(model.orders(), [2]);
  assert.equal(model.next_order(), 3);

  const third = model.add({ node: { tag: 'div' }, parts: [] });
  assert.equal(third.order, 3);
  assert.deepEqual(model.orders(), [2, 3]);
  assert.equal(model.get(2).node.n, 'submit');
});

test('normalize_references 只把已存在的 #n 转成引用', () => {
  assert.deepEqual(
    normalize_references([{ type: 'text', text: '参考 #2 和 #9' }], [1, 2]),
    [{ type: 'text', text: '参考 ' }, { type: 'ref', order: 2 }, { type: 'text', text: ' 和 #9' }],
  );
  assert.deepEqual(
    normalize_references([{ type: 'text', text: '#1、#2' }], [1, 2]),
    [{ type: 'ref', order: 1 }, { type: 'text', text: '、' }, { type: 'ref', order: 2 }],
  );
  assert.deepEqual(normalize_references([{ type: 'text', text: '无引用' }], [1]), [{ type: 'text', text: '无引用' }]);
});

test('生成 Prompt 含 Frame 信息、选择器、源码与顺序引用', () => {
  const model = AnnotationModel();
  model.add({
    node: { tag: 'input', n: 'search', selector: '[data-n="search"]', text: '搜索', source: { file: 'view.js', line: 41, column: 5 }, total: 1 },
    parts: [{ type: 'text', text: '把间距调大，参考 ' }, { type: 'ref', order: 1 }],
  });
  const prompt = model.prompt({ title: '首页', file: 'home.frame', route: '/home' });
  assert.match(prompt, /首页/);
  assert.match(prompt, /home\.frame/);
  assert.match(prompt, /\/home/);
  assert.match(prompt, /## #1 · search/);
  assert.match(prompt, /\[data-n="search"\]/);
  assert.match(prompt, /view\.js:41:5/);
  assert.match(prompt, /把间距调大，参考 #1/);
});

test('BoardModel 同一 Frame 复用标注模型，不同 Frame 隔离，路由切换后保留', () => {
  const model = BoardModel(catalog, { getItem() {} });
  const home = model.annotation_model('/home');
  assert.equal(model.annotation_model('/home'), home);
  assert.notEqual(model.annotation_model('/other'), home);

  home.add({ node: { tag: 'div' }, parts: [{ type: 'text', text: '保留' }] });
  model.read_route(model.frame_url('/home'));
  model.read_route('/');
  model.read_route(model.frame_url('/home'));
  assert.equal(model.annotation_model('/home').state.items.length, 1);
  assert.equal(model.annotation_model('/other').state.items.length, 0);
});

test('doc_from_parts / parts_from_doc 往返保留段落与引用', () => {
  const parts = [{ type: 'text', text: '第一段\n第二段' }, { type: 'ref', order: 2 }, { type: 'text', text: '继续' }];
  const doc = doc_from_parts(parts);
  assert.equal(doc.childCount, 2);
  assert.equal(doc.firstChild.textContent, '第一段');
  assert.equal(parts_text(parts_from_doc(doc)), parts_text(parts));
  assert.deepEqual(parts_from_doc(doc), parts);

  const ref_only = [{ type: 'ref', order: 3 }];
  assert.deepEqual(parts_from_doc(doc_from_parts(ref_only)), ref_only);
  assert.equal(doc_from_parts([]).childCount, 1);
});
