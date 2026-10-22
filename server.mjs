import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { build_project, options_from_args, root } from './build.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

export function resolve_asset(dist, url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname); } catch { return null; }
  const path = resolve(dist, `.${pathname}`);
  return path === dist || path.startsWith(dist + sep) ? path : null;
}

export function create_app_server(dist) {
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const path = resolve_asset(dist, request.url);
    if (!path) { response.writeHead(400); response.end('Bad path'); return; }
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/') || pathname.startsWith('/reader/')) { response.writeHead(404); response.end('No backend in jiezi'); return; }
    let file = path;
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      if (extname(pathname)) { response.writeHead(404); response.end('Not found'); return; }
      file = join(dist, 'index.html');
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
  const { dist, adapter } = await build_project(options);
  const server = create_app_server(dist);
  await new Promise((done, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', done); });
  console.log(`白板已就绪：http://127.0.0.1:${options.port} · 源码变更后自动构建，刷新查看`);
  let timer, running = false, again = false;
  async function rebuild() {
    if (running) { again = true; return; }
    running = true;
    try { await build_project(options); console.log('构建完成，刷新白板查看。'); }
    catch (error) { console.error('构建失败：', error.message); }
    finally { running = false; if (again) { again = false; void rebuild(); } }
  }
  const watchers = [];
  for (const directory of [join(root, 'src'), ...adapter.watch || []]) {
    try { watchers.push(watch(directory, { recursive: true }, (_type, file) => { if (!file || file.includes('node_modules') || file.includes('dist/')) return; clearTimeout(timer); timer = setTimeout(rebuild, 250); })); }
    catch (error) { console.warn(`无法监听 ${directory}：${error.message}`); }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { watchers.forEach(watcher => watcher.close()); clearTimeout(timer); server.close(); });
}
