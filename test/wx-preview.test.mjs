import test from 'node:test';
import assert from 'node:assert/strict';
import { WXPreviewModel } from '../adapters/wx-channels/preview.model.js';
import { ProjectModel } from '../src/project.model.js';
import { create_project_dialog } from '../src/project-dialog.js';
import { parseHTML } from 'linkedom';

test('下载项目使用独立内存数据，真实地址和未实现操作不回退业务服务', async () => {
  const first = WXPreviewModel(), second = WXPreviewModel();
  try {
    first.storage.setItem('theme', 'dark');
    assert.equal(second.storage.getItem('theme'), null);
    const list = await first.fetch('/api/v1/download_task/list');
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).data.list, []);
    assert.equal((await first.fetch('/api/v1/automation/list_flows', { method: 'POST' })).status, 200);
    assert.equal((await first.fetch('/api/content/list', { method: 'DELETE' })).status, 501);
    assert.equal((await first.fetch('http://127.0.0.1:2022/api/content/list')).status, 501);
    assert.equal((await first.fetch('/api/v1/download_task/create', { method: 'POST' })).status, 501);
    await assert.rejects(first.fetch('/api/status', { signal: AbortSignal.abort() }), error => error.name === 'AbortError');
    first.destroy();
    assert.equal((await first.fetch('/api/status')).status, 410);
    assert.equal(first.storage.getItem('theme'), null);
  } finally { first.destroy(); second.destroy(); }
});

test('添加项目弹窗和 Model 支持 Download & Manage 项目类型', async () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, writable: true, value: '' });
  let sent;
  const model = ProjectModel({ id: 'wx-channels', source: '/project/frontend' }, async (_url, request) => {
    sent = JSON.parse(request.body);
    return { ok: true, json: async () => ({ pages: 13, components: 8 }) };
  });
  const view = create_project_dialog({ document, model, on_open() {} });
  try {
    assert.ok(view.dialog.querySelector('option[value="wx-channels"]'));
    assert.equal(await model.open(), true);
    assert.deepEqual(sent, { adapter: 'wx-channels', source: '/project/frontend' });
  } finally { view.destroy(); }
});

test('Mock 数据覆盖每类页面的读取接口，保留原始空状态并隔离各实例', async () => {
  const populated = WXPreviewModel({ mock: true }), empty = WXPreviewModel(), other = WXPreviewModel({ mock: true });
  try {
    const records = (await (await populated.fetch('/api/content/list')).json()).data.list;
    assert.ok(records.length > 0);
    assert.match(records[0].title, /Mock/);
    records[0].title = 'changed';
    assert.match((await (await other.fetch('/api/content/list')).json()).data.list[0].title, /Mock/);
    assert.deepEqual((await (await empty.fetch('/api/content/list')).json()).data.list, []);
    for (const [method, path] of [['GET', '/api/content/detail'], ['GET', '/api/v1/download_task/detail'], ['GET', '/api/scraper/job'], ['GET', '/api/filehelper/sync'], ['POST', '/api/v1/automation/get_flow']]) {
      const response = await populated.fetch(path, { method });
      assert.equal(response.status, 200, path);
      assert.ok(Object.keys((await response.json()).data).length);
    }
    assert.equal((await populated.fetch('/api/v1/download_task/create', { method: 'POST' })).status, 501);
    assert.equal((await populated.fetch('https://example.com/api/content/list')).status, 501);
    assert.equal((await (await populated.fetch('/api/proxy/certificate/status')).json()).data.trusted, true);
    assert.ok((await (await populated.fetch('/api/mcp/status')).json()).data.tools.includes('fetch_content'));
    assert.equal((await populated.fetch('/api/proxy/certificate/uninstall', { method: 'POST' })).status, 501);
    assert.equal((await populated.fetch('/api/filehelper/synccheck')).status, 200);
    const polling = populated.fetch('/api/filehelper/synccheck');
    populated.destroy();
    assert.equal((await polling).status, 410);
  } finally { populated.destroy(); empty.destroy(); other.destroy(); }
});
