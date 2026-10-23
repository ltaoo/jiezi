import { parse } from 'acorn';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const runtime = fileURLToPath(new URL('./source-runtime.js', import.meta.url));

export function inject_source_locations(source, file) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  const identifiers = new Set(), calls = [];
  function visit(node, chain = false) {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Identifier') identifiers.add(node.name);
    if (node.type === 'ChainExpression') {
      // 成员引用必须保留原样，否则会改变 delete 或括号调用的 this。
      if (node.expression.type === 'CallExpression') calls.push(node);
      visit(node.expression, true); return;
    }
    if (['CallExpression', 'NewExpression', 'TaggedTemplateExpression'].includes(node.type) && !chain) calls.push(node);
    for (const [key, value] of Object.entries(node)) {
      const continuation = chain && (key === 'callee' || key === 'object');
      if (Array.isArray(value)) value.forEach(child => visit(child));
      else if (value && typeof value === 'object') visit(value, continuation);
    }
  }
  visit(ast);
  if (!calls.length) return source;
  const unique = name => { while (identifiers.has(name)) name += '_'; identifiers.add(name); return name; };
  const trace = unique('__jiezi_trace'), table = unique('__jiezi_sources');
  const locations = calls.map(node => ({ file, line: node.loc.start.line, column: node.loc.start.column + 1, end_line: node.loc.end.line, end_column: node.loc.end.column + 1 }));
  const edits = calls.flatMap((node, index) => {
    const expression = node.type === 'ChainExpression' ? node.expression : node;
    const callee = expression.callee;
    const method = callee?.type === 'MemberExpression' ? callee.computed ? callee.property.value : callee.property.name : null;
    const creates_node = expression.type === 'NewExpression' || ['createElement', 'createElementNS', 'createTextNode', 'createComment', 'cloneNode', 'importNode'].includes(method);
    return [[node.start, `${trace}(`], [node.end, `,${table}[${index}]${creates_node ? ',true' : ''})`]];
  });
  const start = source.startsWith('#!') ? source.indexOf('\n') + 1 : 0;
  edits.push([start, `import { trace_source as ${trace} } from ${JSON.stringify(runtime)};\nconst ${table}=${JSON.stringify(locations)};\n`]);
  for (const [offset, text] of edits.sort((first, second) => second[0] - first[0])) source = source.slice(0, offset) + text + source.slice(offset);
  return source;
}

// 包装加载结果，保证自定义 loader 与默认 loader 使用同一条追踪链路。
export function source_locations_plugins(roots, plugins = [], sources = new Map()) {
  roots = roots.flatMap(entry => {
    try { return [entry, { ...entry, root: realpathSync(entry.root) }]; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return [entry]; }
  });
  function source_file(path) {
    if (path === runtime || !/\.(js|mjs|frame)$/.test(path)) return null;
    for (const { root, prefix = '' } of roots) {
      const file = relative(root, path);
      if (!isAbsolute(file) && !file.split(sep).some(part => part === '..' || part === 'node_modules')) return prefix + file.split(sep).join('/');
    }
    return null;
  }
  async function instrument(args, result) {
    const file = source_file(args.path);
    if (!file || result?.contents === undefined || result.errors?.length) return result;
    if (result.loader && result.loader !== 'js') return result;
    const source = typeof result.contents === 'string' ? result.contents : new TextDecoder().decode(result.contents);
    sources.set(file, source);
    return { ...result, contents: inject_source_locations(source, file), loader: 'js', resolveDir: result.resolveDir || dirname(args.path) };
  }
  return [...plugins.map(plugin => ({ ...plugin, setup(build) {
    return plugin.setup(new Proxy(build, { get(target, key) {
      if (key === 'onLoad') return (options, callback) => target.onLoad(options, async args => instrument(args, await callback(args)));
      return Reflect.get(target, key);
    } }));
  } })), {
    name: 'jiezi-source-locations',
    setup(build) {
      build.onLoad({ filter: /\.(js|mjs|frame)$/, namespace: 'file' }, async args => {
        if (!source_file(args.path)) return;
        return instrument(args, { contents: await readFile(args.path, 'utf8'), loader: 'js', resolveDir: dirname(args.path) });
      });
    },
  }];
}
