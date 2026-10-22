import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_app_server, resolve_asset } from '../server.mjs';

test('静态服务限制根目录且不会代理业务 API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-'));
  await writeFile(join(directory, 'index.html'), '<h1>board</h1>');
  const server = create_app_server(directory);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(origin);
    assert.equal(await home.text(), '<h1>board</h1>');
    assert.equal(home.headers.get('cache-control'), 'no-store');
    assert.match(home.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(home.headers.get('content-security-policy'), /frame-src 'none'/);
    assert.equal(await fetch(origin + '/settings/reading').then(response => response.text()), '<h1>board</h1>');
    assert.equal((await fetch(origin + '/api/settings')).status, 404);
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
    assert.equal(resolve_asset(directory, '/%2e%2e%2fsecret'), null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
