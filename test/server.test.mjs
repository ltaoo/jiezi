import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as http_request } from 'node:http';
import { create_app_server, resolve_asset } from '../server.mjs';
import { frame_url } from '../src/project-route.js';

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
    assert.equal(await fetch(origin + frame_url('project-id', '/content/card')).then(response => response.text()), '<h1>board</h1>');
    assert.equal((await fetch(origin + '/api/settings')).status, 404);
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
    assert.equal(resolve_asset(directory, '/%2e%2e%2fsecret'), null);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('项目深链接打开对应项目，刷新不重建，未知 ID 和构建失败保留当前项目', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-project-route-'));
  const next_dist = join(directory, 'next'); await mkdir(next_dist);
  await writeFile(join(directory, 'index.html'), 'first project');
  await writeFile(join(next_dist, 'index.html'), 'second project');
  const projects = [{ id: 'first' }, { id: 'second' }, { id: 'broken' }];
  let current_id = 'first', current = { dist: directory };
  const opened = [];
  const session = {
    get current() { return current; },
    describe: () => ({ id: current_id, projects }),
    async open(input) {
      opened.push(input);
      if (input.id === 'broken') throw new Error('compile failed');
      current_id = input.id;
      current = { dist: input.id === 'first' ? directory : next_dist };
    },
  };
  const server = create_app_server(directory, session);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const home = await fetch(origin, { redirect: 'manual' });
    assert.equal(home.status, 302); assert.equal(home.headers.get('location'), '/project/first');
    assert.equal(await fetch(origin + '/project/first').then(response => response.text()), 'first project');
    const detail_url = origin + frame_url('second', '/content/中文 ?#.frame');
    assert.equal(await fetch(detail_url).then(response => response.text()), 'second project');
    assert.deepEqual(opened, [{ id: 'second' }]);
    assert.equal(await fetch(detail_url).then(response => response.text()), 'second project');
    assert.equal((await fetch(detail_url, { method: 'HEAD' })).status, 200);
    assert.equal(opened.length, 1);
    assert.equal((await fetch(origin + '/project/unknown')).status, 404);
    assert.equal((await fetch(origin + '/project/first/other')).status, 404);
    assert.equal((await fetch(origin + '/project/second/frame/%ZZ')).status, 400);
    assert.equal(opened.length, 1);
    assert.equal((await fetch(origin + '/project/broken')).status, 500);
    assert.equal(current_id, 'second');
    assert.equal(await fetch(origin + '/project/second').then(response => response.text()), 'second project');
    assert.equal(await fetch(origin + '/project/first').then(response => response.text()), 'first project');
    assert.equal(current_id, 'first');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});

test('项目接口校验本机同源、JSON 和大小，构建成功才切换静态目录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-open-'));
  const next_dist = join(directory, 'next'); await mkdir(next_dist);
  await writeFile(join(directory, 'index.html'), 'original');
  await writeFile(join(next_dist, 'index.html'), 'next project');
  let current = { dist: directory }, calls = 0, release, entered;
  const building = new Promise(resolve => { entered = resolve; });
  const session = {
    get current() { return current; },
    describe: () => ({ title: 'current' }),
    async open(input) {
      calls++;
      if (input.source === 'broken') throw new Error('compile failed');
      if (input.source !== 'valid') throw Object.assign(new Error('invalid project'), { status: 400 });
      await new Promise(resolve => { release = resolve; entered(); });
      current = { dist: next_dist }; return { title: 'next', pages: 1, components: 2 };
    },
  };
  const server = create_app_server(directory, session);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(origin + '/__jiezi/project', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body, signal: AbortSignal.timeout(5000) });
  try {
    assert.equal((await fetch(origin + '/__jiezi/project')).status, 200);
    assert.equal((await fetch(origin + '/__jiezi/missing')).status, 404);
    assert.equal((await post('{}', { Origin: 'http://evil.invalid' })).status, 403);
    assert.equal((await post('{}', { Origin: 'null' })).status, 403);
    const bad_host = await new Promise((resolve, reject) => {
      http_request(origin + '/__jiezi/project', { method: 'POST', headers: { Host: 'evil.invalid', Origin: origin, 'Content-Type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end('{}');
    });
    assert.equal(bad_host, 403);
    assert.equal((await post('{}', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await fetch(origin + '/__jiezi/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await post('{}', { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await post('{')).status, 400);
    assert.equal((await post('x'.repeat(20000))).status, 413);
    assert.equal(calls, 0);
    assert.equal((await post('{"source":"broken"}')).status, 500);
    assert.equal(await fetch(origin).then(response => response.text()), 'original');
    const opening = post('{"source":"valid"}');
    await building;
    assert.equal(await fetch(origin).then(response => response.text()), 'original');
    release();
    assert.equal((await opening).status, 200);
    assert.equal(await fetch(origin).then(response => response.text()), 'next project');
    assert.equal((await fetch(origin + '/api/settings')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
