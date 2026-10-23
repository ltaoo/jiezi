import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { options_from_args, root } from './build.mjs';
import { create_project_session } from './project-session.mjs';
import { project_url, read_project_route } from './src/project-route.js';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function resolve_asset(dist, url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname); } catch { return null; }
  const path = resolve(dist, `.${pathname}`);
  return path === dist || path.startsWith(dist + sep) ? path : null;
}

function read_project_request(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > 16384) { reject(Object.assign(new Error('请求内容过大'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('请求必须是有效的 JSON'), { status: 400 })); }
    });
  });
}

export function create_app_server(dist, session) {
  return createServer(async (request, response) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { response.writeHead(400); response.end('Bad path'); return; }
    if (pathname.startsWith('/__jiezi/')) {
      const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(value)); };
      const host = request.headers.host;
      const local_hosts = ['127.0.0.1', 'localhost', '[::1]'].map(name => `${name}:${request.socket.localPort}`);
      if (!local_hosts.includes(host) || (request.headers.origin && request.headers.origin !== `http://${host}`) || request.headers['sec-fetch-site'] === 'cross-site') { json(403, { error: '仅允许本机同源请求' }); return; }
      if (pathname !== '/__jiezi/project' || !session) { json(404, { error: '请通过 npm run dev 启动或重启开发服务' }); return; }
      if (request.method === 'GET') { json(200, session.describe()); return; }
      if (request.method !== 'POST') { json(405, { error: '仅支持 GET 和 POST' }); return; }
      if (request.headers.origin !== `http://${host}`) { json(403, { error: '打开项目需要本机同源请求' }); return; }
      if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') { json(415, { error: '请使用 application/json' }); return; }
      try { json(200, await session.open(await read_project_request(request))); }
      catch (error) { json(error.status || 500, { error: error.message }); }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let route;
    try { route = read_project_route(request.url); }
    catch (error) { response.writeHead(400); response.end(error.message); return; }
    if (pathname.startsWith('/project/') && !route) { response.writeHead(404); response.end('Not found'); return; }
    if (session) {
      const current = session.describe();
      if (pathname === '/' && current.id) { response.writeHead(302, { Location: project_url(current.id), 'Cache-Control': 'no-store' }); response.end(); return; }
      if (route) {
        if (!current.projects.some(project => project.id === route.project_id)) { response.writeHead(404); response.end('找不到此项目'); return; }
        if (current.id !== route.project_id) {
          try { await session.open({ id: route.project_id }); }
          catch (error) { response.writeHead(error.status || 500); response.end(error.message); return; }
        }
      }
    }
    const active_dist = session?.current.dist || dist;
    const path = resolve_asset(active_dist, request.url);
    if (!path) { response.writeHead(400); response.end('Bad path'); return; }
    if (pathname.startsWith('/api/') || pathname.startsWith('/reader/')) { response.writeHead(404); response.end('No backend in jiezi'); return; }
    let file = route ? join(active_dist, 'index.html') : path;
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      if (extname(pathname)) { response.writeHead(404); response.end('Not found'); return; }
      file = join(active_dist, 'index.html');
    }
    try {
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; manifest-src 'self'" });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) { response.writeHead(500); response.end(error.message); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === join(root, 'server.mjs')) {
  const options = options_from_args();
  const session = await create_project_session(options);
  const server = create_app_server(session.current.dist, session);
  await new Promise((done, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', done); });
  console.log(`白板已就绪：http://127.0.0.1:${options.port} · 源码变更后自动构建，刷新查看`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { session.close(); server.close(); });
}
