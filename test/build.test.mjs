import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
import { build_project, options_from_args, root } from '../build.mjs';
import { create_app_server } from '../server.mjs';

test('默认构建输出品牌 Logo 和 favicon，详情地址引用的图标可作为 SVG 加载', async () => {
  const { dist, uid } = await build_project(options_from_args([]));
  const server = create_app_server(dist);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(`${origin}/project/${uid}/frame/%2Fhome`);
    const { document } = parseHTML(await page.text());
    const favicon = document.querySelector('link[rel="icon"]');
    assert.equal(favicon.getAttribute('type'), 'image/svg+xml');
    assert.equal(favicon.getAttribute('href'), '/jiezi-logo.svg');
    const logo = await fetch(new URL(favicon.getAttribute('href'), page.url));
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/svg+xml');
    assert.equal(await logo.text(), await readFile(join(root, 'src/logo.svg'), 'utf8'));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
