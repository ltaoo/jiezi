import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeSourceModel } from '../src/node-source.model.js';

const source = { file: 'view.js', line: 10, column: 3 };
const code = Array.from({ length: 20 }, (_, index) => `const line_${index + 1} = ${index + 1};`).join('\r\n');
const payload = location => ({ total: 1, nodes: [{ source: location }] });
const response = (uid = 'project', files = { 'view.js': code }) => ({ ok: true, json: async () => ({ uid, files }) });

test('源码预览保留完整文件及行号，文件首尾的目标行均可高亮', async () => {
  let requests = 0;
  const model = NodeSourceModel('project', async path => { assert.equal(path, '/sources.json'); requests++; return response(); });
  for (const line of [10, 1, 20]) {
    await model.select(payload({ ...source, line }));
    assert.equal(model.state.status, 'ready');
    assert.equal(model.state.lines[0].number, 1);
    assert.equal(model.state.lines.at(-1).number, 20);
    assert.equal(model.state.lines.map(line => line.text).join('\r\n'), code);
    assert.deepEqual(model.state.lines.filter(line => line.selected), [{ number: line, text: `const line_${line} = ${line};`, selected: true }]);
  }
  assert.equal(requests, 1);
});

test('源码加载完成后可打开弹窗，更换节点或清除选择会关闭弹窗', async () => {
  const model = NodeSourceModel('project', async () => response());
  model.show_full(true); assert.equal(model.state.expanded, false);
  await model.select(payload(source));
  model.show_full(true); assert.equal(model.state.expanded, true);
  model.show_full(false); assert.equal(model.state.expanded, false);
  model.show_full(true);
  await model.select(payload({ ...source, line: 5 }));
  assert.equal(model.state.expanded, false);
  model.show_full(true); await model.select(null);
  assert.equal(model.state.expanded, false);
});

test('多选预览共同父节点的源码，未知位置清空且不推测来源', async () => {
  const model = NodeSourceModel('project', async () => response());
  const parent = { ...source, line: 8 };
  await model.select({ total: 2, parent: { source: parent }, nodes: [{ source }] });
  assert.equal(model.state.location, parent);
  assert.equal(model.state.lines.find(line => line.selected).number, 8);
  await model.select({ total: 2, parent: { source: null }, nodes: [{ source }] });
  assert.equal(model.state.location, null);
  assert.equal(model.state.status, 'idle');
  assert.deepEqual(model.state.lines, []);
});

test('反向选择保留点击的源码行，未命中提示不清除现有源码或关闭弹窗', async () => {
  const model = NodeSourceModel('project', async () => response());
  const clicked = { ...source, line: 15 };
  await model.select(payload(source), clicked);
  assert.equal(model.state.location, clicked);
  assert.equal(model.state.lines.find(line => line.selected).number, 15);
  const lines = model.state.lines;
  await model.select(payload(source), { ...clicked, line: 16 });
  assert.equal(model.state.lines, lines);
  assert.equal(model.state.lines.find(line => line.selected).number, 16);
  model.show_full(true); model.report_no_match();
  assert.equal(model.state.expanded, true); assert.equal(model.state.lines, lines);
  assert.match(model.state.error, /没有对应/);
});

test('源码预览拒绝错误项目、缺失文件和越界行，加载失败可重新选择重试', async () => {
  for (const [result, location, message] of [
    [response('other'), source, /项目不一致/],
    [response('project', {}), source, /未记录/],
    [response(), { ...source, file: 'toString' }, /未记录/],
    [response(), { ...source, line: 21 }, /超出/],
    [{ ok: false }, source, /重新构建/],
  ]) {
    const model = NodeSourceModel('project', async () => result);
    await model.select(payload(location));
    assert.equal(model.state.status, 'error');
    assert.match(model.state.error, message);
    assert.deepEqual(model.state.lines, []);
  }
  let requests = 0;
  const model = NodeSourceModel('project', async () => { if (!requests++) throw new Error('网络断开'); return response(); });
  await model.select(payload(source)); assert.equal(model.state.status, 'error');
  await model.select(payload(source)); assert.equal(model.state.status, 'ready');
});

test('快速切换节点或清除选择后，迟到的源码结果不会覆盖当前选择', async () => {
  let finish;
  const model = NodeSourceModel('project', () => new Promise(resolve => { finish = resolve; }));
  const first = model.select(payload(source));
  const next = { ...source, line: 18 };
  const second = model.select(payload(next));
  finish(response()); await Promise.all([first, second]);
  assert.equal(model.state.location, next);
  assert.equal(model.state.lines.find(line => line.selected).number, 18);
  let release;
  const clearing = NodeSourceModel('project', () => new Promise(resolve => { release = resolve; }));
  const pending = clearing.select(payload(source));
  await clearing.select(null); release(response()); await pending;
  assert.equal(clearing.state.status, 'idle');
  assert.deepEqual(clearing.state.lines, []);
});
