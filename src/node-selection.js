import { source_details } from './source-runtime.js';

export function rect_from_points(first, second) {
  const left = Math.min(first.x, second.x), top = Math.min(first.y, second.y);
  return { left, top, right: Math.max(first.x, second.x), bottom: Math.max(first.y, second.y), width: Math.abs(second.x - first.x), height: Math.abs(second.y - first.y) };
}

export function intersect_rect(first, second) {
  const left = Math.max(first.left, second.left), top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right), bottom = Math.min(first.bottom, second.bottom);
  return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}

const contains_rect = (outer, inner) => inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;
const parent_element = node => node.parentElement || node.getRootNode?.().host || null;
function contains_element(outer, inner) {
  for (let current = inner; current; current = parent_element(current)) if (current === outer) return true;
  return false;
}

function common_parent(root, nodes) {
  if (nodes.length < 2) return null;
  for (let parent = parent_element(nodes[0]); parent && contains_element(root, parent); parent = parent_element(parent)) {
    if (nodes.every(node => node !== parent && contains_element(parent, node))) return parent;
  }
  return null;
}

export function NodeSelectionModel(frame) {
  const state = { current: null, history: [] };
  function selection(root, host, rect, selected, viewport) {
    const highlight = selected.parent && viewport && intersect_rect(selected.parent.getBoundingClientRect(), viewport);
    return { root, host, viewport, node: selected.parent || selected.elements[0] || null, rect: highlight || rect,
      result: { elements: selected.elements, payload: selection_payload(frame, root, host, rect, selected) } };
  }
  function parent() {
    const current = state.current;
    return current?.node && current.node !== current.root ? parent_element(current.node) : null;
  }
  function refresh(viewport) {
    const current = state.current;
    if (!current) return;
    current.viewport = viewport;
    current.rect = current.node && viewport ? intersect_rect(current.node.getBoundingClientRect(), viewport) : null;
  }
  return {
    state, refresh,
    select(root, host, rect, selected, viewport) { state.history = []; state.current = selection(root, host, rect, selected, viewport); },
    select_source(root, host, location, viewport, options) {
      const selected = collect_source_nodes(root, location, options);
      if (!selected.elements.length) return false;
      const rects = selected.elements.map(node => node.getBoundingClientRect());
      const rect = rect_from_points({ x: Math.min(...rects.map(rect => rect.left)), y: Math.min(...rects.map(rect => rect.top)) },
        { x: Math.max(...rects.map(rect => rect.right)), y: Math.max(...rects.map(rect => rect.bottom)) });
      this.select(root, host, rect, selected, viewport);
      return true;
    },
    can_parent() { return Boolean(parent()); },
    select_parent() {
      const node = parent(), current = state.current;
      if (!node || !current.viewport) return;
      const rect = intersect_rect(node.getBoundingClientRect(), current.viewport);
      if (!rect) return;
      state.history.push(current);
      state.current = selection(current.root, current.host, rect, { elements: [node], total: 1 }, current.viewport);
    },
    back() { if (state.history.length) { const viewport = state.current.viewport; state.current = state.history.pop(); refresh(viewport); } },
    clear() { state.current = null; state.history = []; },
  };
}

function all_elements(root) {
  const result = [];
  function visit(parent) {
    for (const child of parent.children || []) {
      result.push(child);
      visit(child);
      if (child.shadowRoot) visit(child.shadowRoot);
    }
  }
  visit(root);
  return result;
}

function visible_rect(node, viewport, style_for, boundary) {
  let visible = intersect_rect(node.getBoundingClientRect(), viewport);
  if (!visible) return null;
  for (let current = node; current; current = parent_element(current)) {
    const style = style_for?.(current);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0')) return null;
    if (current !== node && style) {
      const box = current.getBoundingClientRect();
      const clip_x = /^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow);
      const clip_y = /^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow);
      if (clip_x || clip_y) {
        visible = intersect_rect(visible, { left: clip_x ? box.left : visible.left, right: clip_x ? box.right : visible.right, top: clip_y ? box.top : visible.top, bottom: clip_y ? box.bottom : visible.bottom });
        if (!visible) return null;
      }
    }
    if (current === boundary) break;
  }
  return visible;
}

export function collect_source_nodes(root, location, { style_for, limit = 200 } = {}) {
  if (!root || typeof location?.file !== 'string' || !Number.isSafeInteger(location.line) || location.line < 1) return { elements: [], total: 0 };
  let matches = [], best_span = Infinity;
  for (const node of [root, ...all_elements(root)]) {
    const info = source_details(node);
    const locations = info ? [info.declaration, ...info.usages] : [node_source_location(node)];
    const spans = locations.filter(source => source?.file === location.file && source.line <= location.line && (source.end_line || source.line) >= location.line)
      .map(source => (source.end_line || source.line) - source.line);
    if (!spans.length) continue;
    const span = Math.min(...spans);
    if (span > best_span || !visible_rect(node, node.getBoundingClientRect(), style_for, root)) continue;
    if (span < best_span) { matches = []; best_span = span; }
    matches.push(node);
  }
  return { elements: matches.slice(0, limit), total: matches.length, parent: common_parent(root, matches) };
}

export function collect_selected_nodes(root, selection, viewport, { style_for, limit = 200 } = {}) {
  if (!root || selection.width < 3 || selection.height < 3) return { elements: [], total: 0 };
  const hits = [];
  for (const node of all_elements(root)) {
    if (/^(STYLE|SCRIPT|META|LINK|TEMPLATE)$/.test(node.tagName.toUpperCase())) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const visible = visible_rect(node, viewport, style_for);
    const overlap = visible && intersect_rect(visible, selection);
    if (!overlap || !painted_in_rect(root, node, overlap)) continue;
    hits.push({ node, complete: contains_rect(selection, rect) && contains_rect(visible, rect) });
  }
  // 优先完整包含的最外层子树；没有完整节点时才取相交的最深节点，避免边缘擦到遮罩扩大选区。
  const complete = hits.filter(hit => hit.complete).map(hit => hit.node);
  const roots = complete.filter(node => !complete.some(other => other !== node && contains_element(other, node)));
  const partial = hits.filter(hit => !hit.complete && !roots.some(root => contains_element(root, hit.node)) && !hits.some(other => other.node !== hit.node && contains_element(hit.node, other.node))).map(hit => hit.node);
  const selected = roots.length ? roots : partial;
  return { elements: selected.slice(0, limit), total: selected.length, parent: common_parent(root, selected) };
}

function painted_in_rect(root, node, rect) {
  const shadow = root.getRootNode();
  if (!shadow.host || !shadow.elementFromPoint) return true;
  const inset_x = Math.min(1, rect.width / 2), inset_y = Math.min(1, rect.height / 2);
  // shortcut: 采样中心和四角判断遮挡；复杂遮挡仅露出狭小区域时需扩展命中采样。
  const points = [
    [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
    [rect.left + inset_x, rect.top + inset_y], [rect.right - inset_x, rect.top + inset_y],
    [rect.left + inset_x, rect.bottom - inset_y], [rect.right - inset_x, rect.bottom - inset_y],
  ];
  return points.some(([x, y]) => contains_element(node, node_at_point(root, { x, y })));
}

function node_at_point(root, point) {
  const shadow = root.getRootNode(), host = shadow.host;
  if (!host || !shadow.elementFromPoint) return null;
  const inert = host.inert, style = host.style.cssText;
  try {
    // 仅同步命中测试时解除屏蔽，在任何事件派发前恢复。
    host.inert = false; host.style.setProperty('pointer-events', 'auto', 'important');
    let node = shadow.elementFromPoint(point.x, point.y);
    while (node?.shadowRoot?.elementFromPoint) {
      const child = node.shadowRoot.elementFromPoint(point.x, point.y);
      if (!child || child === node) break;
      node = child;
    }
    return node;
  } finally {
    host.inert = inert;
    host.style.cssText = style;
  }
}

export function collect_clicked_node(root, target, point, viewport, { style_for } = {}) {
  if (!root) return { elements: [], total: 0 };
  let node = target?.nodeType === 3 ? target.parentElement : target;
  if (!node || !contains_element(root, node)) node = node_at_point(root, point);
  if (!root || !node?.getBoundingClientRect || node === root || !contains_element(root, node) || /^(STYLE|SCRIPT|META|LINK|TEMPLATE)$/.test(node.tagName.toUpperCase())) return { elements: [], total: 0 };
  const visible = visible_rect(node, viewport, style_for);
  const hit = visible && point.x >= visible.left && point.x <= visible.right && point.y >= visible.top && point.y <= visible.bottom;
  return { elements: hit ? [node] : [], total: hit ? 1 : 0 };
}

export function node_source_location(node) {
  try {
    const source = source_details(node)?.declaration || JSON.parse(node.getAttribute('data-jiezi-source'));
    if (typeof source?.file === 'string' && source.file && Number.isSafeInteger(source.line) && source.line > 0 && Number.isSafeInteger(source.column) && source.column > 0) {
      return { file: source.file, line: source.line, column: source.column };
    }
  } catch { /* 未注入或无效的节点元数据不影响选择。 */ }
  return null;
}

function quoted_attribute(value) {
  return `"${String(value).replace(/[\\"\x00-\x1f\x7f]/g, character => `\\${character.charCodeAt(0).toString(16)} `)}"`;
}

function selector_in_root(node, root) {
  for (const attribute of ['n', 'data-n', 'id']) {
    const value = node.getAttribute(attribute);
    if (!value) continue;
    const selector = `[${attribute}=${quoted_attribute(value)}]`;
    if (root.querySelectorAll(selector).length === 1) return selector;
  }
  const segments = [];
  for (let current = node; current && current !== root; current = current.parentElement) {
    const siblings = [...(current.parentNode?.children || [])].filter(sibling => sibling.tagName === current.tagName);
    segments.unshift(`${current.localName}:nth-of-type(${siblings.indexOf(current) + 1})`);
  }
  return segments.join(' > ');
}

export function node_selector(node, root) {
  if (node === root) return ':scope';
  const local_root = node.getRootNode();
  if (local_root.host && !root.contains(node)) return `${node_selector(local_root.host, root)} >>> ${selector_in_root(node, local_root)}`;
  return selector_in_root(node, root);
}

export function local_rect(rect, host) {
  const box = host.getBoundingClientRect();
  const scale_x = host.offsetWidth > 0 ? host.offsetWidth / box.width : 1;
  const scale_y = host.offsetHeight > 0 ? host.offsetHeight / box.height : 1;
  const round = value => Math.round(value * 100) / 100;
  return { x: round((rect.left - box.left) * scale_x), y: round((rect.top - box.top) * scale_y), width: round(rect.width * scale_x), height: round(rect.height * scale_y) };
}

export function selection_payload(frame, root, host, rect, selection) {
  return {
    frame: { id: frame.id, title: frame.title, file: frame.file, exported: frame.exported, route: frame.route },
    selection: local_rect(rect, host),
    total: selection.total,
    truncated: selection.total > selection.elements.length,
    parent: selection.parent ? { selector: selection.parent === root ? ':scope' : node_selector(selection.parent, root), source: node_source_location(selection.parent), source_details: source_details(selection.parent) } : null,
    nodes: selection.elements.map(node => {
      const html = node.outerHTML;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        tag: node.localName, n: node.getAttribute('n') || node.getAttribute('data-n') || null,
        source: node_source_location(node),
        source_details: source_details(node),
        id: node.id || null, class: node.getAttribute('class') || '',
        selector: node_selector(node, root), text: text.slice(0, 240), text_truncated: text.length > 240,
        bounds: local_rect(node.getBoundingClientRect(), host), html: html.slice(0, 20000), html_truncated: html.length > 20000,
      };
    }),
  };
}
