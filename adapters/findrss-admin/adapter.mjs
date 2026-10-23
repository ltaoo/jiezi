import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { collect_admin_catalog, admin_entry } from './catalog.mjs';
import { shadow_styles } from '../../src/shadow_styles.mjs';

const directory = dirname(fileURLToPath(import.meta.url));

export default function findrss_admin_adapter({ source, bundle }) {
  const project_root = dirname(source);
  return {
    id: 'findrss-admin', title: 'FindRSS 管理后台', source,
    logo: join(project_root, 'public/brand/logo.svg'),
    stylesheets: ['/shadow-frui.css', '/shadow-admin.css', '/shadow-editor.css'],
    entry_points: { adapter: join(directory, 'direct.js'), frui: join(source, 'components/frui/tokens.css'), admin: join(source, 'style.css') },
    assets: [{ from: join(project_root, 'public'), to: '.' }],
    watch: [source, join(project_root, 'server/lib'), directory],
    catalog: () => collect_admin_catalog(source),
    async after_build(dist) {
      for (const name of ['frui', 'admin']) await writeFile(join(dist, `shadow-${name}.css`), shadow_styles(await readFile(join(dist, `${name}.css`), 'utf8')));
      const editor = await bundle({ stdin: { contents: '@import "codemirror/lib/codemirror.css"; @import "codemirror/theme/material-darker.css"; @import "prosemirror-view/style/prosemirror.css";', loader: 'css', resolveDir: project_root }, bundle: true, write: false, logLevel: 'silent' });
      await writeFile(join(dist, 'shadow-editor.css'), shadow_styles(editor.outputFiles[0].text));
    },
    plugins: [{
      name: 'findrss-admin-preview',
      setup(build) {
        build.onResolve({ filter: /^admin-preview-runtime$/ }, () => ({ path: 'runtime', namespace: 'admin-preview' }));
        build.onLoad({ filter: /.*/, namespace: 'admin-preview' }, async () => {
          const result = await bundle({
            stdin: { contents: admin_entry(await collect_admin_catalog(source)), resolveDir: source }, bundle: true, write: false, format: 'iife', globalName: 'AdminPreview', target: 'es2022', charset: 'utf8', nodePaths: [join(project_root, 'node_modules')], alias: { '@': source }, logLevel: 'silent',
            plugins: [{ name: 'admin-source', setup(inner) {
              inner.onResolve({ filter: /^@admin\// }, args => ({ path: resolve(source, args.path.slice(7)) }));
              inner.onLoad({ filter: /\.frame$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'js' }));
              inner.onLoad({ filter: /\.js$/ }, async args => {
                const relative = args.path.startsWith(source + '/') ? args.path.slice(source.length + 1) : null;
                if (!relative) return;
                let code = await readFile(args.path, 'utf8');
                if (relative === 'pages/login.js') {
                  const bootstrap = parse(code, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'bootstrap');
                  code = code.slice(0, bootstrap.start) + '\nexport { LoginView };';
                }
                return { contents: code, loader: 'js' };
              });
            } }],
          });
          const runtime_root = join(project_root, 'public/assets/timeless/0.34.2');
          const runtime = (await Promise.all(['timeless', 'timeless.dom'].map(name => readFile(join(runtime_root, `${name}.umd.min.js`), 'utf8')))).join('\n');
          return { contents: `export default ${JSON.stringify(`${runtime}\nvar Timeless=globalThis.Timeless;var vm=Timeless.vm,kit=Timeless.kit,ui=Timeless.ui;\n${result.outputFiles[0].text}\nreturn { ...AdminPreview, Timeless };`)};`, loader: 'js' };
        });
      },
    }],
  };
}
