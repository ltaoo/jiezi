import * as esbuild from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { source_locations_plugins } from './src/source-locations.mjs';
import { read_projects } from './project-config.mjs';

export const root = dirname(fileURLToPath(import.meta.url));
export function options_from_args(args = process.argv.slice(2)) {
  const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const adapter = value('--adapter') || 'demo';
  if (!/^[a-z0-9_-]+$/.test(adapter)) throw new Error('适配器名称只能包含小写字母、数字、下划线和连字符');
  const source = value('--source');
  if (adapter !== 'demo' && !source) throw new Error('外部项目必须通过 --source 显式指定源码目录');
  return { adapter, source: resolve(source || join(root, 'examples/demo')), port: Number(value('--port') || 39980) };
}

export async function load_adapter(options) {
  const module = await import(pathToFileURL(join(root, 'adapters', options.adapter, 'adapter.mjs')));
  const source_roots = [{ root: options.source }, { root: join(root, 'adapters', options.adapter), prefix: `adapters/${options.adapter}/` }];
  const sources = new Map();
  const bundle = settings => esbuild.build({ ...settings, plugins: source_locations_plugins(source_roots, settings.plugins, sources) });
  const adapter = module.default({ source: options.source, bundle });
  if (!adapter.id || !adapter.title || typeof adapter.catalog !== 'function' || !adapter.entry_points?.adapter) throw new Error('适配器需要声明 id、title、catalog() 和 adapter 渲染入口');
  if (!/^[a-z0-9_-]+$/.test(adapter.id)) throw new Error('适配器 ID 必须是安全的目录名');
  adapter.sources = sources;
  adapter.plugins = source_locations_plugins(source_roots, adapter.plugins, sources);
  return adapter;
}

export async function build_project(options = options_from_args()) {
  const adapter = await load_adapter(options);
  const uid = options.uid || (await read_projects()).find(project => project.adapter === adapter.id && project.source === adapter.source)?.id || randomUUID();
  const output_id = adapter.id === 'demo' && adapter.source === join(root, 'examples/demo') ? 'demo' : `${adapter.id}-${createHash('sha256').update(adapter.source).digest('hex').slice(0, 12)}`;
  const published_dist = join(root, 'dist', output_id);
  const dist = join(root, 'dist', `${output_id}.tmp-${process.pid}`);
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  const catalog = await adapter.catalog();
  const ids = new Set();
  for (const item of catalog) {
    if (!item.id || item.id !== item.path || !item.name || ids.has(item.id) || !['page', 'component'].includes(item.kind) || !['direct', 'source'].includes(item.preview)) throw new Error(`非法或重复的 Frame: ${item.id}`);
    ids.add(item.id);
  }
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: { board: 'src/board.js', board_style: 'src/board.css', tokens: 'src/tokens.css', ...adapter.entry_points },
    bundle: true, format: 'esm', splitting: true, outdir: dist, target: 'es2022', charset: 'utf8', nodePaths: [join(adapter.source, 'node_modules')], plugins: adapter.plugins || [], loader: { '.svg': 'dataurl', '.png': 'file', '.woff2': 'file' }, logLevel: 'warning',
  });
  for (const asset of adapter.assets || []) await cp(asset.from, join(dist, asset.to), { recursive: true });
  await cp(join(root, 'index.html'), join(dist, 'index.html'));
  await cp(join(root, 'src/logo.svg'), join(dist, 'jiezi-logo.svg'));
  await adapter.after_build?.(dist);
  await cp(adapter.logo, join(dist, 'project-logo.svg'));
  await writeFile(join(dist, 'catalog.json'), JSON.stringify(catalog));
  await writeFile(join(dist, 'sources.json'), JSON.stringify({ uid, files: Object.fromEntries(adapter.sources) }));
  await writeFile(join(dist, 'project.json'), JSON.stringify({ id: adapter.id, uid, revision: randomUUID(), title: adapter.title, source: adapter.source, layout_id: adapter.id === 'demo' && adapter.source === join(root, 'examples/demo') ? 'demo' : `${adapter.id}:${adapter.source}`, runtime_scripts: adapter.runtime_scripts || [], stylesheets: adapter.stylesheets || [] }));
  const previous_dist = join(root, 'dist', `${output_id}.previous-${process.pid}`);
  await rm(previous_dist, { recursive: true, force: true });
  let previous = false;
  try { await rename(published_dist, previous_dist); previous = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(dist, published_dist); }
  catch (error) { if (previous) await rename(previous_dist, published_dist); throw error; }
  if (previous) await rm(previous_dist, { recursive: true, force: true });
  console.log(`jiezi / ${adapter.title}: ${catalog.filter(i => i.kind === 'page').length} 个页面，${catalog.filter(i => i.kind === 'component').length} 个组件`);
  return { uid, adapter, catalog, dist: published_dist };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await build_project();
