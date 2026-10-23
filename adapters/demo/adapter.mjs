import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview_declarations } from '../../src/preview-declarations.mjs';
import { shadow_styles } from '../../src/shadow_styles.mjs';

const directory = dirname(fileURLToPath(import.meta.url));

export default function demo_adapter({ source }) {
  return {
    id: 'demo', title: '芥子示例', source,
    logo: join(source, 'icon.svg'),
    stylesheets: ['/preview.css'],
    entry_points: { adapter: join(directory, 'direct.js') },
    assets: [{ from: join(source, 'preview.css'), to: 'preview.css' }],
    watch: [source, directory],
    async after_build(dist) {
      const path = join(dist, 'preview.css');
      await writeFile(path, shadow_styles(await readFile(path, 'utf8')));
    },
    async catalog() {
      const code = await readFile(join(source, 'views.frame'), 'utf8');
      return preview_declarations(code).map(item => ({
        ...item, id: item.path, title: item.name, preview_name: item.name,
        kind: item.path.includes('/components/') ? 'component' : 'page',
        module: 'views.frame', file: 'views.frame', source: code, preview: 'direct',
      }));
    },
    plugins: [{
      name: 'demo-preview',
      setup(build) {
        build.onResolve({ filter: /^demo-views$/ }, () => ({ path: join(source, 'views.frame') }));
        build.onLoad({ filter: /\.frame$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'js' }));
      },
    }],
  };
}
