import { create_node_picker } from './node-picker.js';
import { create_annotation_composer } from './annotation-composer.js';
import { parts_text } from './annotation.model.js';
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
  const annotations = model.annotation_model(frame.id);
  const pin_targets = new Map();
  const pin_nodes = new Map();
  let pending_node = null, pending_element = null;
  const annotation_orders = () => annotations.state.items.map(item => ({ order: item.order, label: node_label(item.node) }));
  function node_label(node) { return node?.n || node?.tag || '节点'; }

  const pins = part('div', 'annotation-pins', 'annotation-pins'); root.append(pins);
  const prompt_button = button('annotation-prompt-open', '', open_prompt); prompt_button.className = 'annotation-prompt-open';
  const toolbar = document.querySelector('[data-n="board-toolbar"]');
  if (toolbar) toolbar.append(prompt_button); else root.append(prompt_button);
  const prompt_dialog = part('dialog', 'annotation-prompt-dialog', 'annotation-prompt-dialog'); prompt_dialog.setAttribute('aria-labelledby', 'annotation-prompt-title');
  const prompt_heading = part('div', 'annotation-prompt-heading', 'picked-nodes-heading');
  const prompt_title = part('h2', 'annotation-prompt-title', '', 'Prompt 预览'); prompt_title.id = 'annotation-prompt-title';
  const prompt_actions = part('div', 'annotation-prompt-heading-actions', '');
  prompt_actions.append(button('annotation-prompt-copy', '复制', copy_prompt), button('annotation-prompt-close', '关闭', close_prompt));
  prompt_heading.append(prompt_title, prompt_actions);
  const prompt_code = part('pre', 'annotation-prompt-code', 'annotation-prompt-code'); prompt_code.tabIndex = 0;
  const prompt_status = part('p', 'annotation-prompt-status', 'muted'); prompt_status.setAttribute('role', 'status');
  prompt_dialog.append(prompt_heading, prompt_code, prompt_status); root.append(prompt_dialog);
  prompt_dialog.addEventListener('cancel', event => { event.preventDefault(); close_prompt(); });
  prompt_dialog.addEventListener('close', () => { prompt_status.textContent = ''; });
  prompt_dialog.addEventListener('click', event => { if (event.target === prompt_dialog) close_prompt(); });

  const composer = create_annotation_composer({ document, window: document.defaultView, get_orders: annotation_orders, on_submit: submit_annotation });
  root.append(composer.root);

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
  const annotation_section = part('div', 'annotation-list-wrap', 'annotation-list-wrap');
  const annotation_heading = part('div', 'annotation-list-heading', 'annotation-list-heading');
  const annotation_title = part('strong', 'annotation-list-title', '', '标注 · 0');
  annotation_heading.append(annotation_title);
  const annotation_list = part('div', 'annotation-list', 'annotation-list');
  annotation_section.append(annotation_heading, annotation_list);
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
  content.append(hint, parent_source, source_preview, list, json); panel.append(heading, annotation_section, status, content); root.append(panel);
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
  function render_annotations() {
    const items = annotations.state.items;
    annotation_title.textContent = `标注 · ${items.length}`;
    annotation_section.hidden = items.length === 0;
    annotation_list.replaceChildren();
    for (const item of items) {
      const row = part('div', 'annotation-item', 'annotation-item');
      const head = part('div', 'annotation-item-head', 'annotation-item-head');
      head.append(part('span', 'annotation-item-order', 'annotation-item-order', `#${item.order}`), part('span', 'annotation-item-node', 'annotation-item-node', node_label(item.node)));
      const actions = part('div', 'annotation-item-actions', 'annotation-item-actions');
      actions.append(button('annotation-item-edit', '编辑', () => edit_annotation(item.order)), button('annotation-item-delete', '删除', () => delete_annotation(item.order)));
      row.append(head, actions, part('p', 'annotation-item-body', 'annotation-item-body', parts_text(item.parts) || '（空）'));
      annotation_list.append(row);
    }
  }
  function render_pins() {
    const active = new Set();
    for (const item of annotations.state.items) {
      active.add(item.order);
      const element = pin_targets.get(item.order);
      if (!element || element.isConnected === false) { pin_nodes.get(item.order)?.remove(); pin_nodes.delete(item.order); continue; }
      let pin = pin_nodes.get(item.order);
      if (!pin) {
        pin = button('annotation-pin', '', () => edit_annotation(item.order)); pin.className = 'annotation-pin';
        pin_nodes.set(item.order, pin); pins.append(pin);
      }
      const rect = element.getBoundingClientRect();
      pin.textContent = String(item.order);
      pin.title = `编辑标注 #${item.order} · ${node_label(item.node)}`;
      pin.style.left = `${rect.left}px`; pin.style.top = `${rect.top}px`;
    }
    for (const [order, pin] of pin_nodes) if (!active.has(order)) { pin.remove(); pin_nodes.delete(order); }
  }
  function render_prompt_button() {
    const count = annotations.state.items.length;
    prompt_button.textContent = `生成 Prompt · ${count} 条标注`;
    prompt_button.disabled = count === 0;
  }
  function open_prompt() {
    if (!annotations.state.items.length) return;
    prompt_code.textContent = annotations.prompt(frame);
    prompt_status.textContent = '';
    if (!prompt_dialog.open) {
      if (typeof prompt_dialog.showModal === 'function') prompt_dialog.showModal();
      else prompt_dialog.setAttribute('open', '');
    }
  }
  function close_prompt() {
    if (typeof prompt_dialog.close === 'function') prompt_dialog.close();
    else prompt_dialog.removeAttribute('open');
  }
  async function copy_prompt() {
    try {
      await document.defaultView.navigator.clipboard.writeText(prompt_code.textContent);
      prompt_status.textContent = '已复制 Prompt，可直接粘贴给 Agent。';
    } catch {
      prompt_status.textContent = '复制失败，请手动选中文本复制。';
    }
  }
  function submit_annotation(parts, { mode, order } = {}) {
    if (mode === 'edit' && order != null) annotations.update(order, parts);
    else {
      const item = annotations.add({ node: pending_node, parts });
      if (pending_element) pin_targets.set(item.order, pending_element);
    }
    pending_node = null; pending_element = null;
    picker?.clear();
    composer.close();
    render_annotations(); render_pins(); render_prompt_button();
  }
  function edit_annotation(order) {
    const item = annotations.get(order);
    if (!item) return;
    pending_node = item.node;
    pending_element = pin_targets.get(order) || null;
    const rect = pending_element && pending_element.isConnected !== false
      ? pending_element.getBoundingClientRect()
      : { left: 320, top: 140, right: 420, bottom: 180, width: 100, height: 40 };
    composer.open({ mode: 'edit', node: item.node, order, rect, parts: item.parts });
  }
  function delete_annotation(order) {
    annotations.remove(order); pin_targets.delete(order);
    if (composer.is_open() && composer.state.order === order) composer.close();
    render_annotations(); render_pins(); render_prompt_button();
  }
  let picker;
  if (frame.preview === 'direct') picker = create_node_picker({ stage, keyboard_root: document, get_preview, frame,
    on_mode(enabled) { model.set_picking(enabled); render_controls(); on_mode_change(); if (!enabled) composer.close(); },
    on_select(result, location) { model.set_node_selection(result); render_selection(); void source_model.select(result?.payload, location); }, on_reveal,
    on_pick(result, location, rect, elements) {
      const node = result?.payload?.nodes?.[0];
      if (!node) return;
      pending_node = { ...node, total: result.payload.total };
      pending_element = elements?.[0] || null;
      composer.open({ mode: 'create', node: pending_node, rect: rect || pending_element?.getBoundingClientRect() || null, parts: [] });
    },
  });
  if (detail.picking) picker?.toggle();
  render_controls(); render_selection(); render_source_preview(); render_annotations(); render_pins(); render_prompt_button();
  return {
    root,
    refresh_selection() {
      picker?.refresh();
      if (composer.is_open()) {
        const rect = pending_element && pending_element.isConnected !== false ? pending_element.getBoundingClientRect() : null;
        if (rect) composer.reposition(rect);
      }
      render_pins();
    },
    escape() {
      if (composer.is_open()) { composer.cancel(); return true; }
      if (!detail.source_open) return false;
      model.show_source(false); render_controls(); source_button.focus(); return true;
    },
    destroy() {
      composer.destroy(); picker?.destroy(); unsubscribe_source(); unsubscribe_refresh();
      if (source_dialog.open) source_dialog.close();
      if (prompt_dialog.open) close_prompt();
      prompt_button.remove();
      void source_model.select(null); root.remove();
    },
  };
}
