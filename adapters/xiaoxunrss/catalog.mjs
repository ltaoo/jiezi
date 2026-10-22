import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { parse } from 'acorn';
import { preview_declarations } from '../../src/preview-declarations.mjs';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const lists = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
  return lists.flat().sort();
}

export async function collect_catalog(reader_root) {
  const source_root = join(reader_root, 'frontend/src');
  const routes = await readFile(join(source_root, 'routes.js'), 'utf8');
  const imports = new Map([...routes.matchAll(/(\w+):\s*\(await import\("\.\/(pages\/[^"\n]+)"\)\)\s*\.\s*(\w+)/g)].map(match => [match[2], match[1]]));
  const locations = new Map([...routes.matchAll(/pathname:\s*"([^"]+)"\s*,\s*(?:title:\s*"([^"]+)"\s*,\s*)?page:\s*"([^"]+)"/g)].map(match => [match[3], { route: match[1], title: match[2] || match[3] }]));
  const directories = [join(source_root, 'pages'), join(source_root, 'components')];
  for (const plugin of await readdir(join(reader_root, 'plugins'), { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const frontend = join(reader_root, 'plugins', plugin.name, 'frontend');
    try { await readdir(frontend); directories.push(frontend); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const items = [];
  for (const path of (await Promise.all(directories.map(walk))).flat()) {
    if (!path.endsWith('.frame')) continue;
    const source = await readFile(path, 'utf8');
    if (!source.includes('_Preview')) continue;
    let declarations;
    try { declarations = preview_declarations(source); }
    catch (error) { throw new Error(`${relative(reader_root, path)}: ${error.message}`, { cause: error }); }
    if (!declarations.length) continue;
    const module = relative(reader_root, path).split('\\').join('/');
    const business_module = module.replace(/\.frame$/, '.js');
    const names = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
      .filter(node => node.type === 'ImportDeclaration' && node.source.value === `./${basename(business_module)}`)
      .flatMap(node => node.specifiers.filter(specifier => specifier.type === 'ImportSpecifier').map(specifier => specifier.imported.name)).sort();
    const page = module.startsWith('frontend/src/pages/') || module.endsWith('/frontend/page.frame');
    const route_name = imports.get(relative(source_root, path).replace(/\.frame$/, '.js'));
    const location = locations.get(route_name);
    const exported = [...names].find(name => !['_Preview', '_Previews'].includes(name) && !/(?:Model|Core|Host|Context|Provider|Primitive)$/.test(name));
    for (const declaration of declarations) items.push({
      id: declaration.path, path: declaration.path,
      preview_index: declaration.preview_index, preview_name: declaration.name,
      ...(declaration.width ? { width: declaration.width } : {}),
      ...(declaration.height ? { height: declaration.height } : {}),
      kind: page ? 'page' : 'component', title: declaration.name, name: declaration.name,
      exported, module, file: `xiaoxunrss/${module}`, source,
      route: location?.route || (exported === 'LoginPage' ? '/login' : exported === 'SearchPage' ? '/search' : ''),
      preview: 'direct', layout: declaration.height || page && exported !== 'SettingsAboutPage' ? 'fill' : 'content',
      group: page ? (module.includes('/settings') ? '设置' : '页面') : module.includes('/frui/') ? 'frui 基础组件' : '业务组件',
    });
  }
  const paths = new Set();
  for (const item of items) {
    if (paths.has(item.path)) throw new Error(`${item.module}: 重复 path：${item.path}`);
    paths.add(item.path);
  }
  return items;
}

export function preview_registry(catalog) {
  return `export const previews = {\n${[...new Set(catalog.map(item => item.module))].map(module => `${JSON.stringify(module)}: () => import(${JSON.stringify('@project/' + module)})`).join(',\n')}\n};`;
}
