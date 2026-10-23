import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { collect_catalog, preview_entry } from './catalog.mjs';
import { shadow_styles } from '../../src/shadow_styles.mjs';

const directory = dirname(fileURLToPath(import.meta.url));

export default function wx_channels_adapter({ source, bundle }) {
  return {
    id: 'wx-channels', title: 'Download & Manage', source,
    logo: join(source, 'public/logo.svg'),
    stylesheets: ['/shadow-dmui.css', '/shadow-app.css'],
    entry_points: { adapter: join(directory, 'direct.js'), dmui: join(source, 'src/dmui.css'), app: join(source, 'src/style.css') },
    assets: [{ from: join(source, 'public'), to: 'public' }],
    watch: [join(source, 'src'), join(source, 'public'), directory],
    catalog: () => collect_catalog(source),
    async after_build(dist) {
      for (const name of ['dmui', 'app']) {
        const css = postcss.parse(shadow_styles(await readFile(join(dist, `${name}.css`), 'utf8')));
        css.walkRules(rule => {
          rule.selector = rule.selector.replace(/body\[data-weui-theme=["']dark["']\]|\.dark\b/g, ':host([data-theme="dark"])')
            .replace(/(?<![\w.-])html\b/g, ':host').replace(/(?<![\w.-])body\b/g, '[data-n="preview-document"]').replaceAll('#root', '[data-n="preview-content"]');
        });
        await writeFile(join(dist, `shadow-${name}.css`), css.toString());
      }
    },
    plugins: [{ name: 'wx-channels-preview', setup(build) {
      build.onResolve({ filter: /^wx-preview-runtime$/ }, () => ({ path: 'runtime', namespace: 'wx-preview' }));
      build.onLoad({ filter: /.*/, namespace: 'wx-preview' }, async () => {
        const result = await bundle({
          stdin: { contents: preview_entry(), resolveDir: source }, bundle: true, write: false, format: 'iife', globalName: 'WXPreview', target: 'es2022', charset: 'utf8', logLevel: 'silent',
          plugins: [{ name: 'wx-source', setup(inner) {
            inner.onResolve({ filter: /^wx-shell-preview$/ }, () => ({ path: join(directory, 'shell-preview.js') }));
            inner.onResolve({ filter: /^wx-preview-bootstrap$/ }, () => ({ path: 'bootstrap', namespace: 'wx-bootstrap' }));
            inner.onLoad({ filter: /.*/, namespace: 'wx-bootstrap' }, () => ({ contents: `
import * as store from '@wx/src/store.js';
import * as components from '@wx/src/components/index.js';
window.__store = store; Object.assign(window, components);
store.app$.setTitle = () => {};
store.http_client$.fetch = async ({ url, method, data, headers }) => {
  if (method === 'GET' && data) {
    const target = new URL(url, window.location.origin);
    for (const [key, value] of Object.entries(data)) if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
    url = target.href;
  }
  const response = await window.fetch(url, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.msg || '预览请求失败');
  return { data: result, status: response.status };
};`, loader: 'js', resolveDir: source }));
            inner.onResolve({ filter: /^@wx\// }, args => ({ path: resolve(source, args.path.slice(4)) }));
            inner.onResolve({ filter: /^@\// }, args => ({ path: resolve(source, 'src', args.path.slice(2)) }));
            inner.onLoad({ filter: /\.js$/ }, async args => {
              if (!args.path.startsWith(source + '/')) return;
              let code = await readFile(args.path, 'utf8');
              if (args.path === join(source, 'src/store.js')) code = code.replace('import(module_href)', 'Promise.reject(new Error("请在白板目录选择页面"))');
              if (args.path === join(source, 'src/pages/shell.components.js')) code += '\nexport { CertificateSettingsDetails, MCPSettingsDetails, AboutSettingsDetails };';
              return { contents: code, loader: 'js' };
            });
          } }],
        });
        const runtime = (await Promise.all(['timeless', 'timeless.dom', 'timeless.web'].map(name => readFile(join(source, `public/timeless/0.33.1/${name}.umd.min.js`), 'utf8')))).join('\n');
        const scripts = (await Promise.all(['dl.utils.js', 'dl.sdk.js', 'virtual-list-view.js'].map(name => readFile(join(source, 'public', name), 'utf8')))).join('\n');
        const aliases = ['h', 'View', 'Fragment', 'Img', 'Link', 'SplitView', 'Show', 'For', 'Switch', 'Match', 'ui', 'ref', 'refobj', 'refarr', 'computed', 'combine', 'isElement', 'vm', 'SVG', 'Circle'];
        const code = `${runtime}\nvar Timeless=window.Timeless; ${aliases.map(name => `window.${name}=Timeless.${name}; var ${name}=window.${name};`).join('\n')} window.cn=window.classNames=Timeless.classNames; var cn=window.cn;var classNames=window.classNames;\n${scripts}\n${result.outputFiles[0].text}\nreturn { ...WXPreview, Timeless };`;
        return { contents: `export default ${JSON.stringify(`with(window) { ${code} }`)};`, loader: 'js' };
      });
    } }],
  };
}
