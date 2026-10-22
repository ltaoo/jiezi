import { BoardModel } from './board.model.js';
import { create_direct_preview } from './direct-preview.js';
import { create_node_picker } from './node-picker.js';
import { create_canvas_drag } from './canvas-drag.js';
import { create_catalog_tree } from './catalog-tree.js';

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
let catalog, project;
try { [catalog, project] = await Promise.all(['/catalog.json', '/project.json'].map(path => fetch(path).then(response => { if (!response.ok) throw new Error('目录加载失败'); return response.json(); }))); }
catch (error) { app.textContent = `${error.message}，请重启开发服务。`; throw error; }
let storage;
try { storage = localStorage; } catch { storage = { getItem() {}, setItem() {} }; }
const model = BoardModel(catalog, storage, project.id);
document.title = `${project.title} · jiezi`;
const state = model.state;
app.replaceChildren();

const header = element('header', 'board-header', 'board-header');
const brand = element('div', 'board-brand', 'brand');
const logo = element('img', 'board-logo'); logo.src = '/project-logo.svg'; logo.alt = ''; logo.width = 32; logo.height = 32;
brand.append(logo, element('strong', 'brand-name', '', 'jiezi'), element('span', 'brand-project', 'muted', `/ ${project.title}`));
const header_actions = element('div', 'header-actions', 'header-actions');
const theme_button = button('theme-toggle', '深色预览', () => {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  theme_button.textContent = state.theme === 'light' ? '深色预览' : '浅色预览';
  for (const preview of mounted_previews.values()) preview.set_theme(state.theme);
  detail_preview?.set_theme(state.theme);
});
header_actions.append(element('span', 'preview-mode', 'mode-label', '直接渲染 · 本地示例数据'), theme_button, button('reset-layout', '重新排列', () => { model.reset(); render_frames(); fit(); }));
header.append(brand, header_actions);

const sidebar = element('aside', 'frame-sidebar', 'sidebar');
const sidebar_heading = element('div', 'sidebar-heading', 'sidebar-heading');
sidebar_heading.append(element('strong', 'sidebar-title', '', '画布目录'), element('span', 'catalog-count', 'muted', `${catalog.length} Frames`));
const search_wrap = element('label', 'search-label', 'search-wrap');
const search = element('input', 'frame-search'); search.type = 'search'; search.placeholder = '搜索页面、组件或路径'; search.setAttribute('aria-label', '搜索页面、组件或路径');
search_wrap.append(search);
const filters = element('div', 'catalog-filters', 'filters');
for (const [value, label] of [['page', '页面'], ['component', '组件'], ['direct', '可预览'], ['all', '全部']]) {
  const node = button(`filter-${value}`, label, () => { state.filter = value; render_catalog(); render_frames(); fit_initial(); });
  node.dataset.filter = value; filters.append(node);
}
const catalog_list = element('div', 'frame-list', 'catalog-list');
const tree_actions = element('div', 'catalog-tree-actions', 'catalog-tree-actions');
tree_actions.append(...[[true, '展开全部'], [false, '收起全部']].map(([open, label]) => button(open ? 'expand-tree' : 'collapse-tree', label, () => { model.tree.expand_all(open); catalog_tree.render(); })));
const catalog_tree = create_catalog_tree({ root: catalog_list, model: model.tree, get_selected: () => state.selected?.id,
  on_select: catalog_tree_select,
  on_open(frame) { catalog_tree_select(frame); open_detail(frame); },
});
const sidebar_footer = element('div', 'sidebar-footer', 'sidebar-footer', '每个 _Previews 示例对应一个 Frame\n单击定位 · 双击 / Enter 查看详情');
sidebar.append(sidebar_heading, search_wrap, filters, tree_actions, catalog_list, sidebar_footer);

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
app.append(header, sidebar, workspace, inspector);
const frame_nodes = new Map();
const group_nodes = new Map();
const mounted_previews = new Map();
const preview_errors = new Map();
let detail_preview;
let detail_picker;
const canvas_drag = create_canvas_drag(workspace, { get_view: () => state.view, on_change: schedule_paint, on_frame_drop: () => model.persist() });
let paint_request = 0;
let query_timer;

function center() { return { x: workspace.clientWidth / 2, y: workspace.clientHeight / 2 }; }
function zoom(ratio) { model.zoom(state.view.scale * ratio, center()); paint(); }
function fit() { model.fit(workspace.clientWidth, workspace.clientHeight); paint(); }
function fit_initial() { model.fit_group(workspace.clientWidth, workspace.clientHeight, model.groups()[0]?.id); paint(); }
function set_tool(tool) { state.tool = tool; select_button.setAttribute('aria-pressed', String(tool === 'select')); hand_button.setAttribute('aria-pressed', String(tool === 'hand')); workspace.dataset.tool = tool; }
function preview_for(frame) {
  return create_direct_preview({ document, frame, project, theme: state.theme, on_error(error) {
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
    state.filter = 'all';
    if (!model.matches(frame)) { state.query = ''; search.value = ''; }
    render_catalog(); render_frames();
  }
  select(frame, true);
}
function render_catalog() {
  filters.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.filter === state.filter)));
  const items = model.visible();
  model.tree.update(state.query, state.filter); catalog_tree.render();
  breadcrumb.textContent = `${project.title} / ${{ page: '页面', component: '组件', direct: '直接预览', all: '全部画布' }[state.filter]} / ${items.length} Frames`;
}
function render_frames() {
  for (const preview of mounted_previews.values()) preview.destroy();
  mounted_previews.clear();
  world.replaceChildren(); frame_nodes.clear(); group_nodes.clear();
  const frames = model.visible();
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
    title.append(element('span', 'frame-symbol', 'frame-symbol', frame.kind === 'page' ? '▣' : '◇'), element('strong', 'frame-name', '', frame.title), element('span', 'frame-dimensions', 'muted', `${frame.width} × ${frame.height}`));
    title.title = '拖动移动 · 双击查看详情';
    const enter_button = button('enter-frame', '进入 Frame ↗', () => open_detail(frame), 'frame-enter primary');
    const summary = element('div', 'frame-summary', 'frame-summary');
    summary.append(element('span', 'frame-category', 'frame-category', frame.preview === 'source' ? '待接入渲染' : '真实页面 · 直接渲染'), element('strong', 'frame-summary-name', '', frame.title), element('code', 'frame-path', '', frame.route || frame.file.split('/').at(-1)));
    if (frame.preview === 'source') summary.append(element('pre', 'frame-source-excerpt', 'source-excerpt', frame.source.split('\n').slice(0, 12).join('\n')));
    node.append(summary, title, enter_button);
    node.addEventListener('dblclick', event => {
      if (!event.target.closest('[data-n="direct-preview"]')) open_detail(frame);
    });
    node.addEventListener('pointerdown', event => {
      if (event.button !== 0 || state.tool === 'hand' || space_pressed) return;
      select(frame);
      if (event.target.closest('.frame-title')) start_gesture(event, { type: 'frame', frame, x: frame.x, y: frame.y });
    });
    frame_nodes.set(frame.id, node); world.append(node);
  }
  paint();
}
function schedule_paint() { if (!paint_request) paint_request = requestAnimationFrame(() => { paint_request = 0; paint(); }); }
function paint() {
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
    const visible = frame.x * scale + x < workspace.clientWidth + 100 && (frame.x + frame.width) * scale + x > -100 && frame.y * scale + y < workspace.clientHeight + 100 && (frame.y + frame.height) * scale + y > -100;
    const render = visible && scale >= 0.2 && frame.preview === 'direct' && live_count++ < 8;
    if (render && !mounted_previews.has(frame.id)) {
      const preview = preview_for(frame);
      preview.host.inert = true;
      mounted_previews.set(frame.id, preview); node.prepend(preview.host); node.classList.add('has-preview');
    }
    if (!render && mounted_previews.has(frame.id)) {
      mounted_previews.get(frame.id).destroy(); mounted_previews.delete(frame.id); node.classList.remove('has-preview');
    }
  }
}
function catalog_node_select(node) {
  if (node.frame) return catalog_tree_select(node.frame);
  state.filter = 'all';
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

const dialog = element('dialog', 'frame-detail-dialog', 'detail-dialog');
app.append(dialog);
function open_detail(frame) {
  if (dialog.open) return;
  select(frame);
  dialog.replaceChildren();
  const bar = element('div', 'detail-header', 'detail-header');
  const label = element('div', 'detail-title-wrap', 'detail-title-wrap');
  label.append(element('strong', 'detail-title', '', frame.title), element('code', 'detail-source-path', 'muted', frame.file));
  const actions = element('div', 'detail-actions', 'header-actions');
  const preview_tab = button('detail-preview-tab', '交互预览', () => show_tab('preview'));
  preview_tab.disabled = frame.preview === 'source';
  const source_tab = button('detail-source-tab', '源码', () => show_tab('source'));
  const picker_button = button('pick-nodes-toggle', '框选节点 · Alt / ⌥', () => detail_picker?.toggle(), 'primary');
  picker_button.setAttribute('aria-pressed', 'false'); picker_button.disabled = frame.preview !== 'direct';
  actions.append(preview_tab, source_tab, picker_button, button('detail-close', '关闭 · Esc', () => dialog.close()));
  bar.append(label, actions);
  const controls = element('div', 'detail-controls', 'detail-controls');
  const device_select = element('select', 'preview-device'); device_select.setAttribute('aria-label', '预览宽度');
  const device_sizes = [[String(frame.width), `示例 · ${frame.width} × ${frame.height}px`], ...[['1200', '桌面 · 1200px'], ['768', '平板 · 768px'], ['390', '手机 · 390px']].filter(([width]) => Number(width) !== frame.width)];
  for (const [width, title] of device_sizes) { const option = element('option', 'preview-device-option', '', title); option.value = width; device_select.append(option); }
  device_select.value = String(frame.width);
  const notice = element('span', 'preview-notice', 'muted', frame.preview === 'source' ? '尚未接入渲染，展示真实源码。' : frame.notes?.[0] || '真实页面直接渲染；按预览容器宽度响应布局。');
  const controls_actions = element('div', 'detail-controls-actions', 'header-actions');
  controls_actions.append(device_select);
  controls.append(notice, controls_actions);
  const detail_workspace = element('div', 'detail-workspace', 'detail-workspace');
  const stage = element('div', 'detail-preview-stage', 'detail-preview-stage');
  const preview = element('div', 'detail-preview-pane', 'detail-preview-pane');
  stage.append(preview);
  const picked_panel = element('aside', 'picked-nodes-panel', 'picked-nodes-panel');
  const picked_heading = element('div', 'picked-nodes-heading', 'picked-nodes-heading');
  const picked_title = element('strong', 'picked-nodes-title', '', '框选节点');
  picked_heading.append(picked_title, button('clear-picked-nodes', '清除', () => detail_picker?.clear()));
  const picked_actions = element('div', 'picked-nodes-actions', 'picked-nodes-actions');
  const copied_status = element('div', 'picked-nodes-status', 'picked-nodes-status'); copied_status.setAttribute('role', 'status');
  const picked_list = element('div', 'picked-nodes-list', 'picked-nodes-list');
  const picked_json = element('pre', 'picked-nodes-json', 'picked-nodes-json'); picked_json.tabIndex = 0;
  const picked_content = element('div', 'picked-nodes-content', 'picked-nodes-content');
  const picked_hint = element('p', 'picked-nodes-hint', 'muted', '按住 Alt / Option 在页面上拖动，或启用框选按钮。Esc 清除选区。');
  picked_content.append(picked_hint, picked_list, picked_json);
  let selection_result = null;
  const copy_button = button('copy-picked-nodes', '复制节点 JSON', async () => {
    if (!selection_result) return;
    try { await navigator.clipboard.writeText(JSON.stringify(selection_result.payload, null, 2)); copied_status.textContent = '已复制节点 JSON'; }
    catch { copied_status.textContent = '剪贴板不可用，可选中下方 JSON 手动复制。'; picked_json.focus(); }
  });
  const console_button = button('print-picked-nodes', '打印 DOM 到控制台', () => {
    if (!selection_result) return;
    console.log(`[jiezi] ${frame.title} · 框选 DOM 节点`, selection_result.elements);
    copied_status.textContent = `已向控制台打印 ${selection_result.elements.length} 个实际 DOM 节点`;
  });
  copy_button.disabled = true; console_button.disabled = true;
  picked_actions.append(copy_button, console_button);
  picked_panel.append(picked_heading, picked_actions, copied_status, picked_content);
  detail_workspace.append(stage, picked_panel);
  const source = element('pre', 'detail-source-pane', 'detail-source-pane'); source.tabIndex = 0; source.textContent = frame.source;
  if (frame.preview === 'direct') { detail_preview = preview_for(frame); preview.append(detail_preview.host); }
  if (detail_preview) detail_picker = create_node_picker({ stage, keyboard_root: dialog, frame, get_preview: () => detail_preview,
    on_mode(enabled) {
      picker_button.setAttribute('aria-pressed', String(enabled));
      if (enabled) picked_panel.hidden = false;
    },
    on_select(result) {
      selection_result = result;
      copy_button.disabled = !result || !result.elements.length; console_button.disabled = copy_button.disabled;
      copied_status.textContent = '';
      picked_list.replaceChildren(); picked_json.textContent = '';
      picked_title.textContent = result ? `框选节点 · ${result.payload.total}` : '框选节点';
      picked_hint.textContent = result ? (result.payload.total ? '完整子树合并显示；边界相交时保留最深节点。' : '选区内没有可见节点，试着扩大选区。') : '按住 Alt / Option 在页面上拖动，或启用框选按钮。Esc 清除选区。';
      if (!result) return;
      picked_panel.hidden = false;
      result.payload.nodes.forEach((node, index) => {
        const item = element('div', 'picked-node', 'picked-node');
        item.append(element('strong', 'picked-node-name', '', `${index + 1}. ${node.n || node.id || node.tag}`), element('code', 'picked-node-selector', '', node.selector), element('span', 'picked-node-text', 'muted', node.text));
        picked_list.append(item);
      });
      if (result.payload.truncated) copied_status.textContent = `找到 ${result.payload.total} 个节点，显示前 ${result.elements.length} 个。`;
      picked_json.textContent = JSON.stringify(result.payload, null, 2);
    },
  });
  function resize_preview() {
    detail_picker?.clear();
    if (detail_preview) { detail_preview.host.style.width = `${Number(device_select.value)}px`; detail_preview.host.style.height = `${frame.height}px`; }
  }
  device_select.addEventListener('change', resize_preview);
  function show_tab(tab) {
    detail_workspace.hidden = tab !== 'preview'; source.hidden = tab !== 'source'; controls_actions.hidden = tab !== 'preview';
    picker_button.disabled = tab !== 'preview' || frame.preview !== 'direct';
    detail_picker?.set_active(tab === 'preview');
    preview_tab.setAttribute('aria-pressed', String(tab === 'preview')); source_tab.setAttribute('aria-pressed', String(tab === 'source'));
    resize_preview();
  }
  dialog.append(bar, controls, detail_workspace, source);
  dialog.showModal(); show_tab(frame.preview === 'source' ? 'source' : 'preview');
  actions.querySelector('button:not(:disabled)')?.focus();
}
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
dialog.addEventListener('close', () => { detail_picker?.destroy(); detail_picker = undefined; detail_preview?.destroy(); detail_preview = undefined; dialog.replaceChildren(); });

search.addEventListener('input', () => { clearTimeout(query_timer); query_timer = setTimeout(() => { state.query = search.value; render_catalog(); render_frames(); fit_initial(); }, 180); });
function start_gesture(event, data) {
  canvas_drag.start(event, data);
}
workspace.addEventListener('pointerdown', event => {
  if (event.button !== 0 && event.button !== 1) return;
  if (event.target.closest('.toolbar')) return;
  if (!event.target.closest('.frame') || state.tool === 'hand' || space_pressed || event.button === 1) start_gesture(event, { type: 'pan', x: state.view.x, y: state.view.y });
});
workspace.addEventListener('wheel', event => {
  if (event.target.closest('.toolbar')) return;
  if (event.target.closest('[data-n="direct-preview"]') && !event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const bounds = workspace.getBoundingClientRect();
  if (event.ctrlKey || event.metaKey) model.zoom(state.view.scale * Math.exp(-event.deltaY * 0.006), { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  else { state.view.x -= event.deltaX; state.view.y -= event.deltaY; }
  schedule_paint();
}, { passive: false });
let space_pressed = false;
window.addEventListener('keydown', event => {
  if (dialog.open || event.target.closest('[data-n="direct-preview"], [role="tree"]') || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); space_pressed = true; workspace.dataset.tool = 'hand'; }
  else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); }
  else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2); }
  else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2); }
  else if (event.key === 'Enter' && state.selected) { event.preventDefault(); open_detail(state.selected); }
});
window.addEventListener('keyup', event => { if (event.code === 'Space') { space_pressed = false; workspace.dataset.tool = state.tool; } });
window.addEventListener('blur', () => { space_pressed = false; workspace.dataset.tool = state.tool; });
new ResizeObserver(schedule_paint).observe(workspace);
set_tool('select'); render_catalog(); render_frames(); render_inspector(); fit_initial();
if (model.visible()[0]) select(model.visible()[0]);
