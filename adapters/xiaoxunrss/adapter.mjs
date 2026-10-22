import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { collect_catalog, preview_registry } from './catalog.mjs';
import { shadow_styles } from '../../src/shadow_styles.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
export default function xiaoxunrss_adapter({ source }) {
  let catalog;
  return {
    id: 'xiaoxunrss', title: '小讯', source,
    logo: join(source, 'public/xiaoxun-logo.svg'),
    runtime_scripts: ['/assets/timeless/0.34.2/timeless.umd.min.js', '/assets/timeless/0.34.2/timeless.dom.umd.min.js', '/assets/timeless/0.34.2/timeless.web.umd.min.js'],
    stylesheets: ['/shadow-frui.css', '/shadow-reader.css'],
    entry_points: { adapter: join(directory, 'direct.js'), frui: join(source, 'frontend/src/components/frui/index.css'), reader: join(source, 'frontend/src/style.css') },
    assets: [{ from: join(source, 'public'), to: '.' }],
    watch: [join(source, 'frontend'), join(source, 'plugins'), join(source, 'distributions'), join(source, 'kernel'), join(source, 'player/frontend'), directory],
    async catalog() { catalog = await collect_catalog(source); return catalog; },
    async after_build(dist) {
      for (const name of ['frui', 'reader']) {
        const css = await readFile(join(dist, `${name}.css`), 'utf8');
        await writeFile(join(dist, `shadow-${name}.css`), shadow_styles(css));
      }
    },
    plugins: [{
      name: 'xiaoxunrss-preview-adapter',
      setup(build) {
        build.onLoad({ filter: /\.frame$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'js' }));
        build.onResolve({ filter: /^canvas-preview-registry$/ }, () => ({ path: 'registry', namespace: 'canvas-preview' }));
        build.onLoad({ filter: /.*/, namespace: 'canvas-preview' }, async () => ({ contents: preview_registry(catalog || await collect_catalog(source)), loader: 'js', resolveDir: source }));
        build.onResolve({ filter: /^@project\// }, args => ({ path: resolve(source, args.path.slice('@project/'.length)) }));
        build.onResolve({ filter: /^@(kernel|plugins|distributions)\// }, args => ({ path: resolve(source, args.path.slice(1)) }));
        build.onResolve({ filter: /^@(domain|lib)\// }, args => ({ path: resolve(source, 'frontend/shared', args.path.slice(1)) }));
        build.onResolve({ filter: /^@\// }, args => ({ path: resolve(source, 'frontend/src', args.path.slice(2)) }));
        build.onResolve({ filter: /^\// }, args => args.kind === 'url-token' || args.kind === 'import-rule' ? { path: args.path, external: true } : undefined);
      },
    }],
  };
}
