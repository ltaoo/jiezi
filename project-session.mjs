import { watch } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { build_project, options_from_args, root } from './build.mjs';
import { read_projects, write_projects } from './project-config.mjs';

export async function project_options(input) {
  if (!input || !['demo', 'xiaoxunrss', 'findrss-admin', 'wx-channels'].includes(input.adapter) || typeof input.source !== 'string' || input.source.includes('\0') || input.source.length > 4096) throw Object.assign(new Error('请选择项目类型并填写本机目录'), { status: 400 });
  const source = input.source.trim();
  if ((input.adapter !== 'demo' || source) && !isAbsolute(source)) throw Object.assign(new Error('项目目录必须是本机绝对路径'), { status: 400 });
  const options = options_from_args(['--adapter', input.adapter, ...(source ? ['--source', source] : [])]);
  const required = input.adapter === 'demo'
    ? ['views.frame', 'icon.svg', 'preview.css']
    : input.adapter === 'wx-channels'
      ? ['package.json', 'src/store.js', 'src/dmui.js', 'src/dmui.css', 'src/style.css', 'public/logo.svg', 'public/dl.sdk.js', 'public/dl.utils.js', 'public/virtual-list-view.js', ...['timeless', 'timeless.dom', 'timeless.web'].map(name => `public/timeless/0.33.1/${name}.umd.min.js`)]
    : input.adapter === 'findrss-admin'
      ? ['store.js', 'style.css', 'components/ui.js', '../package.json', '../node_modules', '../public/brand/logo.svg', ...['timeless', 'timeless.dom'].map(name => `../public/assets/timeless/0.34.2/${name}.umd.min.js`)]
      : ['package.json', 'frontend/src/routes.js', 'frontend/src/components/frui/index.css', 'frontend/src/style.css', 'public/xiaoxun-logo.svg', ...['timeless', 'timeless.dom', 'timeless.web'].map(name => `public/assets/timeless/0.34.2/${name}.umd.min.js`), 'node_modules'];
  try {
    options.source = await realpath(options.source);
    if (!(await stat(options.source)).isDirectory()) throw new Error('请选择项目文件夹');
    for (const file of required) {
      const info = await stat(join(options.source, file)).catch(() => { throw new Error(`缺少 ${file}${file.endsWith('node_modules') ? '，请先在业务项目安装依赖' : '，请检查项目目录'}`); });
      if (file.endsWith('node_modules') ? !info.isDirectory() : !info.isFile()) throw new Error(`项目资源类型不正确：${file}`);
    }
  } catch (error) { throw Object.assign(new Error(`无法打开项目：${error.message}`), { status: 400 }); }
  return options;
}

export async function create_project_session(options, { build = build_project, watch_directory = watch, registry_file = join(root, 'project.json') } = {}) {
  let projects = await read_projects(registry_file);
  async function build_registered(input) {
    const uid = input.uid || projects.find(project => project.adapter === input.adapter && project.source === input.source)?.id || randomUUID();
    return { ...await build({ ...input, uid }), uid };
  }
  options = { ...options, uid: projects.find(project => project.adapter === options.adapter && project.source === options.source)?.id, source: await realpath(options.source) };
  let current = await build_registered(options), current_options = options;
  let busy = false, again = false, timer, closed = false;
  let watchers = [];
  const describe = project => ({ id: project.uid, adapter: project.adapter.id, title: project.adapter.title, source: project.adapter.source, pages: project.catalog.filter(item => item.kind === 'page').length, components: project.catalog.filter(item => item.kind === 'component').length });
  async function remember(project) {
    const entry = describe(project);
    const next = projects.filter(item => item.id !== entry.id && (item.adapter !== entry.adapter || item.source !== entry.source));
    next.push(entry);
    await write_projects(next, registry_file);
    projects = next;
  }
  await remember(current);
  function schedule() {
    clearTimeout(timer);
    if (!closed) timer = setTimeout(() => { void rebuild(); }, 250);
  }
  function watch_project() {
    clearTimeout(timer); again = false;
    watchers.forEach(watcher => watcher.close()); watchers = [];
    if (closed) return;
    for (const directory of new Set([join(root, 'src'), ...(current.adapter.watch || [])])) {
      try {
        watchers.push(watch_directory(directory, { recursive: true }, (_type, file) => {
          if (!file || (!file.includes('node_modules') && !file.includes('dist/'))) schedule();
        }));
      } catch (error) { console.warn(`无法监听 ${directory}：${error.message}`); }
    }
  }
  async function rebuild() {
    if (closed) return;
    if (busy) { again = true; return; }
    busy = true;
    try { current = await build_registered(current_options); console.log('构建完成，刷新白板查看。'); }
    catch (error) { console.error('构建失败：', error.message); }
    finally { busy = false; if (again) { again = false; schedule(); } }
  }
  watch_project();
  return {
    get current() { return current; },
    describe() {
      return { ...describe(current), projects, status: busy ? 'building' : 'ready' };
    },
    async open(input) {
      if (busy || closed) throw Object.assign(new Error('已有项目正在构建，请稍后重试'), { status: 409 });
      if (input?.id !== undefined) {
        const saved = projects.find(project => project.id === input.id);
        if (!saved) throw Object.assign(new Error('找不到此项目'), { status: 404 });
        input = saved;
      }
      busy = true;
      try {
        const next_options = { ...await project_options(input), uid: input.id };
        const next = await build_registered(next_options);
        await remember(next);
        current = next; current_options = next_options;
        watch_project();
      } finally { busy = false; if (again) { again = false; schedule(); } }
      return this.describe();
    },
    close() { closed = true; clearTimeout(timer); watchers.forEach(watcher => watcher.close()); watchers = []; },
  };
}
