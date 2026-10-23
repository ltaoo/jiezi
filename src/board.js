import { BoardModel } from './board.model.js';
import { create_direct_preview, load_preview } from './direct-preview.js';
import { create_frame_detail } from './frame-detail.js';
import { create_canvas_drag } from './canvas-drag.js';
import { create_catalog_tree } from './catalog-tree.js';
import { ProjectModel } from './project.model.js';
import { create_project_dialog } from './project-dialog.js';

function element(tag, name, class_name, text) {
  const node = document.createElement(tag);
  node.dataset.n = name;
  if (class_name) node.className = class_name;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(name, label, action, class_name = '') {
  const node = element('button', name, class_name, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
const app = document.querySelector('#app');
app.textContent = '正在扫描前端目录…';
let catalog, project, project_model;
try {
  [catalog, project] = await Promise.all(['/catalog.json', '/project.json'].map(path => fetch(path).then(response => { if (!response.ok) throw new Error('目录加载失败'); return response.json(); })));
  project_model = ProjectModel(project);
  if (!project.uid || !project_model.matches_route(location.href)) throw new Error('项目元数据缺失或与地址不一致');
}
catch (error) { app.textContent = `${error.message}，请重启开发服务。`; throw error; }
let storage;
try { storage = localStorage; } catch { storage = { getItem() {}, setItem() {} }; }
const model = BoardModel(catalog, storage, project.layout_id || project.id, project.uid);
document.title = `${project.title} · jiezi`;
const state = model.state;
app.replaceChildren();

const header = element('header', 'board-header', 'board-header');
const brand = element('div', 'board-brand', 'brand');
const brand_logo = element('img', 'brand-logo'); brand_logo.src = '/jiezi-logo.svg'; brand_logo.alt = ''; brand_logo.width = 32; brand_logo.height = 32;
const logo = element('img', 'board-logo'); logo.src = '/project-logo.svg'; logo.alt = ''; logo.width = 32; logo.height = 32;
const header_actions = element('div', 'header-actions', 'header-actions');
async function open_built_project() {
  if (project_model.state.action !== 'refresh' || !state.detail) { location.assign(project_model.opened_url()); return; }
  try {
    const [next_catalog, next_project] = await Promise.all(['/catalog.json', '/project.json'].map(path => fetch(path, { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error('加载最新画板失败，请重试刷新');
      return response.json();
    })));
    if (!Array.isArray(next_catalog) || next_project?.uid !== project.uid) throw new Error('刷新结果与当前项目不一致');
    next_project.revision ||= String(Date.now());
    const loaded = next_catalog.find(frame => frame.id === state.detail?.id)?.preview === 'direct' ? await load_preview(document, next_project) : null;
    detail_tools?.destroy(); detail_tools = undefined;
    for (const preview of mounted_previews.values()) preview.destroy();
    mounted_previews.clear(); preview_errors.clear();
    catalog = next_catalog; Object.assign(project, next_project); preview_load = loaded;
    model.replace_catalog(catalog); catalog_list.replaceChildren();
    sidebar_heading.querySelector('[data-n="catalog-count"]').textContent = `${catalog.length} Frames`;
    header.querySelector('[data-n="preview-mode"]').textContent = `${catalog.filter(frame => frame.kind === 'page').length} 个页面 · ${catalog.filter(frame => frame.kind === 'component').length} 个组件`;
    render_route();
    await mounted_previews.get(state.detail?.id)?.ready;
    project_model.finish_refresh();
  } catch (error) { project_model.finish_refresh(error); }
}
async function refresh_project() { if (await project_model.refresh()) await open_built_project(); }
const project_dialog = create_project_dialog({ document, model: project_model, on_open: open_built_project });
const refresh_button = button('refresh-board', '刷新画板', refresh_project);
const project_switch = element('select', 'project-switch', 'project-switch'); project_switch.setAttribute('aria-label', '切换项目');
function render_project_switch() {
  project_switch.replaceChildren(...project_model.state.projects.map(item => {
    const option = element('option', 'project-switch-option', '', `${item.title} · ${item.source.split('/').at(-1) || '示例'}`);
    option.value = project_model.project_key(item); return option;
  }));
  project_switch.value = project_model.current_key;
  project_switch.disabled = project_model.state.status === 'opening' || project_model.state.status === 'ready';
  refresh_button.disabled = project_switch.disabled;
  refresh_button.textContent = project_model.state.action === 'refresh' && project_model.state.status === 'opening' ? '正在刷新…' : '刷新画板';
}
project_model.subscribe(render_project_switch); render_project_switch();
project_switch.addEventListener('change', async () => { if (await project_model.switch_project(project_switch.value)) location.assign(project_model.opened_url()); });
void project_model.load_projects();
const theme_button = button('theme-toggle', '深色预览', () => {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  theme_button.textContent = state.theme === 'light' ? '深色预览' : '浅色预览';
  for (const preview of mounted_previews.values()) preview.set_theme(state.theme);
});
brand.append(brand_logo, element('strong', 'brand-name', '', 'jiezi'), element('span', 'brand-project', 'muted', '/'), logo, project_switch);
header_actions.append(element('span', 'preview-mode', 'mode-label', `${catalog.filter(frame => frame.kind === 'page').length} 个页面 · ${catalog.filter(frame => frame.kind === 'component').length} 个组件`), button('open-project', '添加项目', () => project_model.show(), 'primary'), refresh_button, theme_button, button('reset-layout', '重新排列', () => { model.reset(); render_frames(); fit(); }));
header.append(brand, header_actions);

const sidebar = element('aside', 'frame-sidebar', 'sidebar');
const sidebar_heading = element('div', 'sidebar-heading', 'sidebar-heading');
const sidebar_actions = element('div', 'sidebar-heading-actions', 'sidebar-heading-actions');
sidebar_heading.append(element('strong', 'sidebar-title', '', '画布目录'), sidebar_actions);
const search_wrap = element('label', 'search-label', 'search-wrap');
const search = element('input', 'frame-search'); search.type = 'search'; search.placeholder = '搜索页面、组件或路径'; search.setAttribute('aria-label', '搜索页面、组件或路径');
search_wrap.append(search);
const catalog_list = element('div', 'frame-list', 'catalog-list');
const catalog_tree = create_catalog_tree({ root: catalog_list, model: model.tree, get_selected: () => state.selected?.id,
  on_select: catalog_tree_select,
  on_open(frame) { catalog_tree_select(frame); open_detail(frame); },
});
sidebar_actions.append(element('span', 'catalog-count', 'muted', `${catalog.length} Frames`), catalog_tree.toggle_button);
sidebar.append(sidebar_heading, search_wrap, catalog_list);

const workspace = element('main', 'whiteboard-workspace', 'workspace'); workspace.tabIndex = 0; workspace.setAttribute('aria-label', '可拖动、缩放的页面和组件白板');
const world = element('div', 'whiteboard-world', 'world');
const empty = element('div', 'board-empty', 'board-empty', '没有找到匹配的 Frame，试试其他关键词。'); empty.hidden = true;
const breadcrumb = element('div', 'board-breadcrumb', 'breadcrumb');
const toolbar = element('div', 'board-toolbar', 'toolbar');
const select_button = button('select-tool', '↖ 选择', () => set_tool('select'));
const hand_button = button('hand-tool', '✥ 平移', () => set_tool('hand'));
const zoom_label = button('zoom-reset', '36%', () => { model.zoom(1, center()); paint(); }); zoom_label.title = '恢复到 100%';
toolbar.append(select_button, hand_button, element('span', 'toolbar-divider', 'divider'), button('zoom-out', '−', () => zoom(1 / 1.2)), zoom_label, button('zoom-in', '+', () => zoom(1.2)), button('fit-all', '适应画布', fit));
const hint = element('div', 'board-hint', 'board-hint', '空白处拖动平移 · Ctrl / ⌘ + 滚轮缩放 · F 适应画布');
workspace.append(world, empty, breadcrumb, toolbar, hint);

const inspector = element('aside', 'frame-inspector', 'inspector');
app.append(header, sidebar, workspace, inspector, project_dialog.dialog);
const frame_nodes = new Map();
const group_nodes = new Map();
const mounted_previews = new Map();
const preview_errors = new Map();
let detail_tools;
let preview_load;
const canvas_drag = create_canvas_drag(workspace, { get_view: () => state.view, on_change: schedule_paint, on_frame_drop: () => model.persist() });
let paint_request = 0;
let query_timer;

function center() { return { x: workspace.clientWidth / 2, y: workspace.clientHeight / 2 }; }
function zoom(ratio) { model.zoom(state.view.scale * ratio, center()); paint(); }
function fit() { model.fit(workspace.clientWidth, workspace.clientHeight); paint(); }
function fit_initial() { model.fit_group(workspace.clientWidth, workspace.clientHeight, model.groups()[0]?.id); paint(); }
function set_tool(tool) { state.tool = tool; select_button.setAttribute('aria-pressed', String(tool === 'select')); hand_button.setAttribute('aria-pressed', String(tool === 'hand')); workspace.dataset.tool = tool; }
function preview_for(frame) {
  return create_direct_preview({ document, frame, project, theme: state.theme, load: preview_load ? async () => preview_load : undefined, on_error(error) {
    preview_errors.set(frame.id, error?.message ?? String(error));
    if (state.selected?.id === frame.id) render_inspector();
  } });
}
function select(frame, focus = false) {
  model.select(frame.id);
  for (const [id, node] of frame_nodes) node.classList.toggle('selected', id === frame.id);
  catalog_tree.sync_selection();
  render_inspector();
  if (focus) {
    if (frame.id === frame.group_root) model.fit_group(workspace.clientWidth, workspace.clientHeight, frame.group_id);
    else model.fit(workspace.clientWidth, workspace.clientHeight, [frame]);
    paint();
  }
}
function catalog_tree_select(frame) {
  if (!model.visible().some(item => item.id === frame.id)) {
    if (!model.matches(frame)) { state.query = ''; search.value = ''; }
    render_catalog(); render_frames();
  }
  select(frame, true);
}
function render_catalog() {
  const items = model.visible();
  model.tree.update(state.query, state.filter); catalog_tree.render();
  breadcrumb.textContent = `${project.title} / 全部画布 / ${items.length} Frames`;
}
function render_frames() {
  const frames = model.visible();
  const visible_ids = new Set(frames.map(frame => frame.id));
  for (const [id, preview] of mounted_previews) if (!visible_ids.has(id)) { preview.destroy(); mounted_previews.delete(id); }
  world.replaceChildren(); frame_nodes.clear(); group_nodes.clear();
  empty.hidden = frames.length > 0;
  for (const group of model.groups()) {
    const node = element('section', 'board-page-group', 'board-page-group');
    node.dataset.groupId = group.id;
    node.setAttribute('aria-label', `${group.title}预览组`);
    node.append(element('div', 'board-page-group-title', 'board-page-group-title', `${group.title} · ${group.frames.length} Frames`));
    group_nodes.set(group.id, node); world.append(node);
  }
  for (const frame of frames) {
    const node = element('section', 'board-frame', `frame ${state.selected?.id === frame.id ? 'selected' : ''}`);
    node.dataset.id = frame.id;
    node.style.width = `${frame.width}px`; node.style.height = `${frame.height}px`;
    const title = button('frame-title', '', () => select(frame), 'frame-title');
    title.append(element('span', 'frame-symbol', 'frame-symbol', frame.kind === 'page' ? '▣' : '◇'), element('strong', 'frame-name', '', frame.title));
    title.title = '拖动移动 · 双击查看详情';
    const enter_button = button('enter-frame', '进入 Frame ↗', () => open_detail(frame), 'frame-enter primary');
    const footer = element('div', 'frame-footer', 'frame-footer');
    footer.append(element('span', 'frame-dimensions', 'frame-dimensions muted', `${frame.width} × ${frame.height}`), enter_button);
    const summary = element('div', 'frame-summary', 'frame-summary');
    summary.append(element('span', 'frame-category', 'frame-category', frame.preview === 'source' ? '待接入渲染' : '真实页面 · 直接渲染'), element('strong', 'frame-summary-name', '', frame.title), element('code', 'frame-path', '', frame.route || frame.file.split('/').at(-1)));
    if (frame.preview === 'source') summary.append(element('pre', 'frame-source-excerpt', 'source-excerpt', frame.source.split('\n').slice(0, 12).join('\n')));
    node.append(summary, title, footer);
    if (mounted_previews.has(frame.id)) { node.prepend(mounted_previews.get(frame.id).host); node.classList.add('has-preview'); }
    node.addEventListener('click', event => {
      if (!state.detail && state.tool !== 'hand' && !space_pressed && !event.altKey && !event.defaultPrevented) select(frame);
    });
    node.addEventListener('dblclick', event => {
      if (!state.detail && state.tool !== 'hand' && !space_pressed && !event.altKey && !event.defaultPrevented && !event.target.closest('[data-n="direct-preview"]')) open_detail(frame);
    });
    node.addEventListener('pointerdown', event => {
      if (state.detail || event.button !== 0 || state.tool === 'hand' || space_pressed) return;
      select(frame);
      if (event.target.closest('.frame-title')) start_gesture(event, { type: 'frame', frame, x: frame.x, y: frame.y });
    });
    frame_nodes.set(frame.id, node); world.append(node);
  }
  paint();
}
function schedule_paint() { if (!paint_request) paint_request = requestAnimationFrame(() => { paint_request = 0; paint(); }); }
function paint() {
  const interactive = Boolean(state.detail?.frame && !state.detail.picking);
  workspace.dataset.interactive = String(interactive);
  const { x, y, scale } = state.view;
  world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  workspace.style.backgroundPosition = `${x}px ${y}px`;
  workspace.style.backgroundSize = `${24 * scale}px ${24 * scale}px`;
  zoom_label.textContent = `${Math.round(scale * 100)}%`;
  for (const group of model.groups()) {
    const node = group_nodes.get(group.id); if (!node) continue;
    const { x, y, width, height } = group.bounds;
    node.style.transform = `translate(${x}px, ${y}px)`;
    node.style.width = `${width}px`; node.style.height = `${height}px`;
  }
  let live_count = 0;
  for (const frame of model.visible()) {
    const node = frame_nodes.get(frame.id); if (!node) continue;
    node.style.transform = `translate(${frame.x}px, ${frame.y}px)`;
    node.style.width = `${model.frame_width(frame)}px`;
    const visible = frame.x * scale + x < workspace.clientWidth + 100 && (frame.x + frame.width) * scale + x > -100 && frame.y * scale + y < workspace.clientHeight + 100 && (frame.y + frame.height) * scale + y > -100;
    const render = frame.preview === 'direct' && (state.detail || visible && scale >= 0.2 && live_count++ < 8);
    if (render && !mounted_previews.has(frame.id)) {
      const preview = preview_for(frame);
      mounted_previews.set(frame.id, preview); node.prepend(preview.host); node.classList.add('has-preview');
    }
    const preview = mounted_previews.get(frame.id);
    if (preview) { preview.host.inert = !interactive && preview.host.dataset.status !== 'error'; preview.set_size(model.frame_width(frame), frame.height); }
    if (!render && mounted_previews.has(frame.id)) {
      mounted_previews.get(frame.id).destroy(); mounted_previews.delete(frame.id); node.classList.remove('has-preview');
    }
  }
  detail_tools?.refresh_selection();
}
function catalog_node_select(node) {
  if (node.frame) return catalog_tree_select(node.frame);
  state.query = ''; search.value = '';
  model.tree.reveal(node.key); model.tree.toggle(node.key, true);
  render_catalog(); render_frames();
  model.fit(workspace.clientWidth, workspace.clientHeight, model.visible().filter(frame => frame.path.startsWith(node.key + '/')));
  paint();
}
function render_inspector() {
  inspector.replaceChildren();
  const heading = element('div', 'inspector-heading', 'inspector-heading', 'Frame 详情');
  inspector.append(heading);
  const content = element('div', 'inspector-content', 'inspector-content');
  inspector.append(content);
  const frame = state.selected;
  if (!frame) {
    content.append(element('div', 'inspector-empty', 'inspector-empty', '选择一个 Frame\n查看页面或组件详情。'), element('div', 'inspector-guide', 'inspector-guide', '按 path 目录查看页面和组件\n同一顶层目录内的示例归入同组\n示例数据和请求保存在内存中'));
    return;
  }
  content.append(element('span', 'inspector-kind', 'frame-category', frame.kind === 'page' ? '页面' : '组件'), element('h2', 'inspector-title', '', frame.title), element('p', 'inspector-status', 'muted', frame.preview === 'source' ? '需要接入渲染适配器' : preview_errors.has(frame.id) ? `渲染错误：${preview_errors.get(frame.id)}` : '真实源码 · DOM 直接挂载 · Shadow DOM 样式隔离'));
  const details = element('dl', 'inspector-properties', 'properties');
  for (const [key, value] of [['目录', frame.path], ['导出', frame.exported], ['分组', frame.group_title], ['尺寸', `${frame.width} × ${frame.height}`], ['路由', frame.route || '独立组件']]) details.append(element('dt', 'property-label', '', key), element('dd', 'property-value', '', value));
  content.append(details, element('div', 'source-label', 'source-label', '源文件'), element('code', 'source-path', 'source-path', frame.file), button('open-detail', '打开详情 ↗', () => open_detail(frame), 'primary wide'));
  const parent = model.tree.get_parent(frame.id);
  if (parent) content.append(element('div', 'parent-frame-title', 'source-label', '目录父节点'), button('parent-frame', parent.title, () => catalog_node_select(parent), 'related-frame'));
  const children = model.tree.get_children(frame.id);
  content.append(element('div', 'related-frames-title', 'source-label', `目录子节点 · ${children.length}`));
  for (const item of children) content.append(button('related-frame', item.title, () => catalog_node_select(item), 'related-frame'));
  if (frame.notes?.length) {
    content.append(element('div', 'frame-notes-title', 'source-label', '预览说明'));
    frame.notes.forEach(note => content.append(element('p', 'frame-note', 'muted', note)));
  }
  const dependencies = [...frame.source.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]);
  if (dependencies.length) {
    content.append(element('div', 'dependency-title', 'source-label', `依赖 · ${dependencies.length}`));
    dependencies.slice(0, 15).forEach(path => content.append(element('code', 'dependency-path', 'dependency-path', path)));
  }
}

function open_detail(frame) {
  if (state.detail?.id === frame.id) return;
  history.pushState({ jiezi_frame: true }, '', model.frame_url(frame.id));
  sync_route();
}
function close_detail() {
  if (history.state?.jiezi_frame) history.back();
  else { history.pushState(null, '', model.project_url()); sync_route(); }
}
function sync_route() {
  if (!project_model.matches_route(location.href)) { location.reload(); return; }
  const was_detail = Boolean(state.detail);
  model.read_route(location.href);
  render_route();
  if (state.detail) { fit(); detail_tools.root.querySelector('button')?.focus(); }
  else if (was_detail) workspace.focus();
}
function render_route() {
  detail_tools?.destroy(); detail_tools = undefined;
  app.dataset.mode = state.detail ? 'frame' : 'board';
  document.title = `${state.detail?.frame ? state.detail.frame.title + ' · ' : ''}${project.title} · jiezi`;
  render_catalog(); render_frames(); render_inspector();
  if (state.detail) {
    detail_tools = create_frame_detail({ document, model, project, project_model, stage: workspace,
      get_preview: () => mounted_previews.get(state.detail?.id),
      on_close: close_detail,
      on_resize: fit,
      on_mode_change: paint,
      on_refresh: refresh_project,
      on_reveal(rect) { model.reveal_rect(rect, workspace.getBoundingClientRect()); paint(); },
    });
    app.append(detail_tools.root);
  }
  paint();
}
window.addEventListener('popstate', sync_route);

search.addEventListener('input', () => { clearTimeout(query_timer); query_timer = setTimeout(() => { state.query = search.value; render_catalog(); render_frames(); fit_initial(); }, 180); });
function start_gesture(event, data) {
  canvas_drag.start(event, data);
}
workspace.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.button !== 1) return;
  if (event.target.closest('.toolbar')) return;
  if (workspace.dataset.interactive === 'true' && event.button === 0 && event.target.closest('[data-n="direct-preview"]')) return;
  if (state.detail || !event.target.closest('.frame') || state.tool === 'hand' || space_pressed || event.button === 1) start_gesture(event, { type: 'pan', x: state.view.x, y: state.view.y });
});
workspace.addEventListener('wheel', event => {
  if (event.target.closest('.toolbar')) return;
  if (workspace.dataset.interactive === 'true' && event.target.closest('[data-n="direct-preview"]') && !event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const bounds = workspace.getBoundingClientRect();
  if (event.ctrlKey || event.metaKey) model.zoom(state.view.scale * Math.exp(-event.deltaY * 0.006), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  else { state.view.x -= event.deltaX; state.view.y -= event.deltaY; }
  schedule_paint();
}, { passive: false });
let space_pressed = false;
window.addEventListener('keydown', event => {
  if (event.defaultPrevented || event.target.closest?.('dialog[open]')) return;
  if (state.detail && event.key === 'Escape' && !project_model.state.visible) { event.preventDefault(); if (!detail_tools?.escape()) close_detail(); return; }
  if (project_model.state.visible || event.target.closest('[data-n="direct-preview"], [role="tree"], [data-n="detail-source-panel"], [data-n="picked-nodes-panel"]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.code === 'Space' && !event.target.closest('button')) { event.preventDefault(); space_pressed = true; workspace.dataset.tool = 'hand'; }
  else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2); }
  else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2); }
  else if (event.key === 'Enter' && state.selected && !state.detail) { event.preventDefault(); open_detail(state.selected); }
});
window.addEventListener('keyup', event => { if (event.code === 'Space') { space_pressed = false; workspace.dataset.tool = state.tool; } });
window.addEventListener('blur', () => { space_pressed = false; workspace.dataset.tool = state.tool; });
new ResizeObserver(schedule_paint).observe(workspace);
set_tool('select'); sync_route();
if (!state.detail) { fit_initial(); if (model.visible()[0]) select(model.visible()[0]); }
