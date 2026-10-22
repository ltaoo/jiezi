import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preview_declarations } from '../src/preview-declarations.mjs';
import { collect_catalog } from '../adapters/xiaoxunrss/catalog.mjs';

const entry = (path, name = '默认') => `{ name: ${JSON.stringify(name)}, path: ${JSON.stringify(path)}, render() {} }`;
test('AST 仅读取 name/path 和尺寸，不执行模块或 render，允许同名不同路径', () => {
  const source = `throw new Error('不得执行'); export const _Previews = [
    { name: '登录', path: '/login/1', render() { throw new Error('不得调用'); } },
    { name: '登录', path: '/login/2', width: 390, height: 844, render: () => [{ text: '嵌套 {代码}' }] },
  ];`;
  assert.deepEqual(preview_declarations(source), [
    { name: '登录', path: '/login/1', preview_index: 0 },
    { name: '登录', path: '/login/2', preview_index: 1, width: 390, height: 844 },
  ]);
  assert.deepEqual(preview_declarations('export const _Preview = [];'), []);
  assert.deepEqual(preview_declarations(`export const _Preview = [${entry('/login/1')}];`)[0].path, '/login/1');
  assert.throws(() => preview_declarations('export const _Preview = []; export const _Previews = [];'), /只能导出/);
  assert.deepEqual(preview_declarations('export { _Previews } from "./other.frame";'), []);
});

test('拒绝缺少 name/path、非规范路径、旧 parent、动态属性和无效 render', () => {
  for (const path of ['', '/', 'relative', '/a/', '/a//b', '/a/./b', '/a/../b', '/a?tab=x', '/a#x', '/a\\b', '/a\nb']) {
    assert.throws(() => preview_declarations(`export const _Preview = [${entry(path)}];`), /path/);
  }
  const invalid = [
    'make_previews()', '[{ ...defaults, render() {} }]', '[{ name: get_name(), path: "/a", render() {} }]',
    '[{ name: 1, path: "/a", render() {} }]', '[{ get name() { return "x"; }, render() {} }]',
    '[{ name: "x", path: "/a" }]', '[{ name: "x", path: "/a", render: get_render() }]',
    '[{ name: "x", path: "/a", async render() {} }]', '[{ name: "", path: "/a", render() {} }]',
    '[{ path: "/a", render() {} }]', '[{ name: "x", render() {} }]',
    '[{ name: "x", path: "/a", parent: "", render() {} }]', '[,]',
    '[{ name: "x", path: "/a", width: 0, render() {} }]', '[{ name: "x", path: "/a", height: -1, render() {} }]',
    '[{ name: "x", path: "/a", width: "390", render() {} }]',
    `[${entry('/a')}, ${entry('/a', '重复路径')}]`,
  ];
  for (const value of invalid) assert.throws(() => preview_declarations(`export const _Previews = ${value};`), /_Previews/);
  assert.throws(() => preview_declarations('export const _Previews = [], business = 1;'), /单独声明/);
});

test('只扫描 .frame，path 是稳定 ID，改名/重排不改变身份，跨文件重复路径报错', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-paths-'));
  try {
    await Promise.all(['frontend/src/pages', 'frontend/src/components', 'plugins'].map(path => mkdir(join(directory, path), { recursive: true })));
    const files = {
      'routes.js': '',
      'pages/login.frame': `import { LoginPage } from "./login.js"; export const _Previews = [${entry('/login/1', '登录')}, ${entry('/login/2', '错误密码')}];`,
      'components/form.frame': `import { LoginForm } from "./form.js"; export const _Preview = [${entry('/login/components/1', '登录表单')}];`,
      'components/button.frame': 'import { Button } from "./button.js"; export const _Preview = [{ name: "按钮", path: "/frui/button", width: 390, height: 844, render() {} }];',
      'components/hidden.js': 'export const _Preview = [{ render() {} }];',
      'components/barrel.frame': 'export { _Previews } from "./button.frame";',
      'components/private.frame': 'const _Previews = [{ render() {} }];',
    };
    await Promise.all(Object.entries(files).map(([path, code]) => writeFile(join(directory, 'frontend/src', path), code)));
    const catalog = await collect_catalog(directory);
    assert.equal(catalog.length, 4);
    assert.ok(catalog.every(item => item.id === item.path && item.title === item.preview_name));
    const button = catalog.find(item => item.exported === 'Button');
    assert.equal(button.width, 390); assert.equal(button.height, 844);
    const login = join(directory, 'frontend/src/pages/login.frame');
    await writeFile(login, `import { LoginPage } from "./login.js"; export const _Preview = [${entry('/login/2', '改名')}, ${entry('/login/1', '登录')}];`);
    const reordered = await collect_catalog(directory);
    assert.deepEqual(new Set(reordered.map(item => item.id)), new Set(catalog.map(item => item.id)));
    assert.equal(reordered.find(item => item.id === '/login/2').title, '改名');
    await writeFile(login, `export const _Preview = [${entry('/frui/button')}];`);
    await assert.rejects(collect_catalog(directory), /重复 path.*\/frui\/button/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
