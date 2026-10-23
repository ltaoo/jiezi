import { create_node_picker } from './node-picker.js';
import { NodeSourceModel } from './node-source.model.js';

export function create_frame_detail({ document, model, project, project_model, stage, get_preview, on_close, on_resize, on_reveal, on_refresh, on_mode_change }) {
  const detail = model.state.detail, frame = detail.frame;
  function part(tag, name, class_name = '', text) {
    const node = document.createElement(tag); node.dataset.n = name; node.className = class_name;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(name, text, action) {
    const node = part('button', name, '', text); node.type = 'button'; node.addEventListener('click', action); return node;
  }
  const root = part('div', 'frame-detail-overlay', 'frame-detail-overlay');
  const header = part('header', 'detail-header', 'detail-header');
  const label = part('div', 'detail-title-wrap', 'detail-title-wrap');
  label.append(part('h1', 'detail-title', '', frame?.title || 'Frame 不存在'), part('code', 'detail-frame-path', 'muted', frame?.path || detail.id || '未指定 Frame'));
  const refresh_button = button('detail-refresh', '刷新', on_refresh);
  function render_refresh() {
    const state = project_model.state;
    refresh_button.disabled = state.status === 'opening' || state.status === 'ready';
    refresh_button.textContent = state.action === 'refresh' && state.status === 'opening' ? '正在刷新…' : '刷新';
  }
  const unsubscribe_refresh = project_model.subscribe(render_refresh); render_refresh();
  header.append(button('detail-close', '返回画板 · Esc', on_close), label, refresh_button); root.append(header);
  if (!frame) {
    const error = part('p', 'detail-route-error', 'detail-route-error', detail.error); error.setAttribute('role', 'alert'); root.append(error);
    return { root, refresh_selection() {}, escape() { return false; }, destroy() { unsubscribe_refresh(); root.remove(); } };
  }
  const actions = part('nav', 'detail-actions', 'detail-actions'); actions.setAttribute('aria-label', 'Frame 检查工具');
  const source_button = button('detail-source-toggle', '查看源码', () => { model.show_source(!detail.source_open); render_controls(); });
  const picker_button = button('pick-nodes-toggle', '', () => picker?.toggle());
  picker_button.disabled = frame.preview !== 'direct';
  const nodes_button = button('picked-nodes-toggle', '节点详情', () => { model.show_nodes(!detail.nodes_visible); render_controls(); });
  const device = part('select', 'preview-device'); device.setAttribute('aria-label', '预览宽度');
  const sizes = [[String(frame.width), `示例 · ${frame.width} × ${frame.height}px`], ...[['1200', '桌面 · 1200px'], ['768', '平板 · 768px'], ['390', '手机 · 390px']].filter(([width]) => Number(width) !== frame.width)];
  for (const [width, title] of sizes) { const option = part('option', 'preview-device-option', '', title); option.value = width; device.append(option); }
  device.value = String(detail.width);
  device.addEventListener('change', () => { picker?.clear(); model.set_detail_width(Number(device.value)); on_resize(); });
  actions.append(source_button, picker_button, nodes_button, device); root.append(actions);

  const source_panel = part('section', 'detail-source-panel', 'detail-source-panel'); source_panel.id = 'frame-source-panel'; source_panel.setAttribute('aria-label', 'Frame 源码');
  const source_heading = part('div', 'detail-source-heading', 'detail-source-heading picked-nodes-heading');
  source_heading.append(part('code', 'detail-source-path', '', frame.file), button('detail-source-close', '关闭源码', () => { model.show_source(false); render_controls(); source_button.focus(); }));
  const source = part('pre', 'detail-source-pane', 'detail-source-pane', frame.source); source.tabIndex = 0; source_panel.append(source_heading, source); root.append(source_panel);

  const panel = part('aside', 'picked-nodes-panel', 'picked-nodes-panel'); panel.id = 'frame-picked-nodes'; panel.setAttribute('aria-label', '节点详情');
  const heading = part('div', 'picked-nodes-heading', 'picked-nodes-heading');
  const title = part('strong', 'picked-nodes-title', '', '节点详情');
  heading.append(title, button('picked-nodes-close', '关闭', () => { model.show_nodes(false); render_controls(); nodes_button.focus(); }));
  const status = part('div', 'picked-nodes-status', 'picked-nodes-status'); status.setAttribute('role', 'status');
  const content = part('div', 'picked-nodes-content', 'picked-nodes-content');
  const hint = part('p', 'picked-nodes-hint', 'muted');
  const parent_source = part('div', 'picked-parent-source-container');
  const source_model = NodeSourceModel(project.uid);
  const source_preview = part('section', 'picked-source-preview', 'picked-source-preview'); source_preview.setAttribute('aria-label', '选中节点源码预览');
  const preview_heading = part('div', 'picked-source-preview-heading', 'picked-source-preview-heading');
  const source_location = part('code', 'picked-source-location', 'source-path');
  const expand_source = button('picked-source-expand', '弹窗查看', () => source_model.show_full(true)); expand_source.setAttribute('aria-haspopup', 'dialog');
  preview_heading.append(source_location, expand_source);
  const source_status = part('p', 'picked-source-status', 'muted'); source_status.setAttribute('role', 'status');
  const source_code = part('pre', 'picked-source-code', 'picked-source-code'); source_code.tabIndex = 0;
  source_preview.append(preview_heading, source_status, source_code);
  const source_dialog = part('dialog', 'picked-source-dialog', 'picked-source-dialog'); source_dialog.setAttribute('aria-labelledby', 'picked-source-dialog-title');
  const full_heading = part('div', 'picked-source-dialog-heading', 'picked-nodes-heading');
  const full_title = part('h2', 'picked-source-dialog-title'); full_title.id = 'picked-source-dialog-title';
  full_heading.append(full_title, button('picked-source-dialog-close', '关闭 · Esc', () => source_model.show_full(false)));
  const full_code = part('pre', 'picked-source-full-code', 'picked-source-code'); full_code.tabIndex = 0;
  const full_status = part('p', 'picked-source-full-status', 'muted'); full_status.setAttribute('role', 'status');
  source_dialog.append(full_heading, full_status, full_code); root.append(source_dialog);
  source_dialog.addEventListener('cancel', event => { event.preventDefault(); source_model.show_full(false); });
  source_dialog.addEventListener('close', () => { if (source_model.state.expanded) source_model.show_full(false); });
  source_dialog.addEventListener('click', event => { if (event.target === source_dialog) source_model.show_full(false); });
  function render_code(code, name) {
    code.replaceChildren();
    for (const line of source_model.state.lines) {
      const row = button(name, `${line.number}  ${line.text}\n`, () => {
        if (!picker?.select_source({ file: source_model.state.location.file, line: line.number, column: 1 })) source_model.report_no_match();
      });
      row.className = 'picked-source-line'; row.title = '选择此行对应的画布节点';
      if (line.selected) row.setAttribute('aria-current', 'true');
      code.append(row);
    }
  }
  function scroll_to_source(code) {
    const line = code.querySelector('[aria-current="true"]');
    if (line) code.scrollTop = Math.max(0, line.offsetTop - code.firstElementChild.offsetTop - (code.clientHeight - line.offsetHeight) / 2);
    code.scrollLeft = 0;
  }
  let rendered_lines;
  function render_source_preview() {
    const state = source_model.state;
    source_preview.hidden = !state.location;
    source_location.textContent = state.location ? `${state.location.file}:${state.location.line}:${state.location.column}` : '';
    source_status.hidden = state.status === 'ready' && !state.error;
    source_status.textContent = state.status === 'loading' ? '正在加载源码…' : state.error;
    source_code.hidden = state.status !== 'ready'; expand_source.disabled = state.status !== 'ready';
    if (rendered_lines !== state.lines) {
      render_code(source_code, 'picked-source-line'); scroll_to_source(source_code); rendered_lines = state.lines;
    } else {
      for (const [index, row] of [...source_code.children].entries()) row.setAttribute('aria-current', String(state.lines[index].selected));
    }
    if (state.expanded) {
      full_title.textContent = source_location.textContent;
      full_status.textContent = state.error; full_status.hidden = !state.error;
      if (!source_dialog.open) { render_code(full_code, 'picked-source-full-line'); source_dialog.showModal(); scroll_to_source(full_code); }
    } else {
      if (source_dialog.open) source_dialog.close();
      full_code.replaceChildren();
    }
  }
  const unsubscribe_source = source_model.subscribe(render_source_preview);
  const list = part('div', 'picked-nodes-list', 'picked-nodes-list');
  const json = part('pre', 'picked-nodes-json', 'picked-nodes-json'); json.tabIndex = 0;
  function source_row(name, source, prefix = '', empty = '未记录源码位置') {
    const row = part('div', `${name}-row`, 'picked-source-row');
    const location = source ? `${source.file}:${source.line}:${source.column}` : '';
    const copy = button(`${name}-copy`, '', async () => {
      try { await document.defaultView.navigator.clipboard.writeText(location); status.textContent = `已复制源码位置：${location}`; }
      catch { status.textContent = '复制失败，请手动选中源码位置复制。'; }
    });
    copy.className = 'source-copy'; copy.disabled = !source;
    copy.title = '复制源码位置'; copy.setAttribute('aria-label', '复制源码位置');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ 'data-n': 'source-copy-icon', viewBox: '0 0 24 24', width: '14', height: '14', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(key, value);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.dataset.n = 'source-copy-icon-path'; path.setAttribute('d', 'M9 9h12v12H9z M5 15H3V3h12v2'); icon.append(path); copy.append(icon);
    row.append(part('code', name, 'source-path', source ? prefix + location : empty), copy);
    return row;
  }
  content.append(hint, parent_source, source_preview, list, json); panel.append(heading, status, content); root.append(panel);
  function render_controls() {
    source_panel.hidden = !detail.source_open; panel.hidden = !detail.nodes_visible;
    source_button.setAttribute('aria-expanded', String(detail.source_open)); source_button.setAttribute('aria-controls', source_panel.id);
    nodes_button.setAttribute('aria-expanded', String(detail.nodes_visible)); nodes_button.setAttribute('aria-controls', panel.id);
    picker_button.setAttribute('aria-pressed', String(detail.picking));
    picker_button.textContent = detail.picking ? '选择模式 · 切换交互' : '交互模式 · 切换选择';
    picker_button.title = '切换交互 / 选择模式；Alt / Option 可临时选择节点';
  }
  function render_selection() {
    const result = detail.selection;
    title.textContent = result ? `节点详情 · ${result.payload.total}` : '节点详情';
    status.textContent = '';
    hint.textContent = result ? (result.payload.total ? '源码行、列从 1 开始；未记录位置的节点不推测来源。' : '选区内没有可见节点，试着扩大选区。') : '按住 Alt / Option 点击或拖动，或启用选择按钮。Esc 清除选区。';
    list.replaceChildren(); json.textContent = result ? JSON.stringify(result.payload, null, 2) : '';
    const multiple = result?.payload.total > 1;
    const parent = result?.payload.parent;
    parent_source.hidden = !multiple;
    parent_source.title = parent?.selector || '';
    parent_source.replaceChildren(source_row('picked-parent-source', parent?.source, '父节点源码：', '父节点未记录源码位置'));
    result?.payload.nodes.forEach((node, index) => {
      const item = part('div', 'picked-node', 'picked-node');
      item.append(part('strong', 'picked-node-name', '', `${index + 1}. ${node.n || node.id || node.tag}`), part('code', 'picked-node-selector', '', node.selector), part('span', 'picked-node-text', 'muted', node.text));
      if (!multiple) {
        item.append(source_row('picked-node-source', node.source));
        for (const usage of node.source_details?.usages || []) item.append(source_row('picked-node-usage', usage, '使用位置：'));
      }
      list.append(item);
    });
    if (result?.payload.truncated) status.textContent = `找到 ${result.payload.total} 个节点，显示前 ${result.elements.length} 个。`;
    render_controls();
  }
  let picker;
  if (frame.preview === 'direct') picker = create_node_picker({ stage, keyboard_root: document, get_preview, frame,
    on_mode(enabled) { model.set_picking(enabled); render_controls(); on_mode_change(); },
    on_select(result, location) { model.set_node_selection(result); render_selection(); void source_model.select(result?.payload, location); }, on_reveal,
  });
  if (detail.picking) picker?.toggle();
  render_controls(); render_selection(); render_source_preview();
  return {
    root,
    refresh_selection() { picker?.refresh(); },
    escape() { if (!detail.source_open) return false; model.show_source(false); render_controls(); source_button.focus(); return true; },
    destroy() { picker?.destroy(); unsubscribe_source(); unsubscribe_refresh(); if (source_dialog.open) source_dialog.close(); void source_model.select(null); root.remove(); },
  };
}
