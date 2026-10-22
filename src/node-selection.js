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

function visible_rect(node, viewport, style_for) {
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
  }
  return visible;
}

export function collect_selected_nodes(root, selection, viewport, { style_for, limit = 200 } = {}) {
  if (!root || selection.width < 3 || selection.height < 3) return { elements: [], total: 0 };
  const hits = [];
  for (const node of all_elements(root)) {
    if (/^(STYLE|SCRIPT|META|LINK|TEMPLATE)$/.test(node.tagName.toUpperCase())) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const visible = visible_rect(node, viewport, style_for);
    if (!visible || !intersect_rect(visible, selection)) continue;
    hits.push({ node, complete: contains_rect(selection, rect) && contains_rect(visible, rect) });
  }
  // 完整包含的最外层子树优先；边界只相交时取最深的节点，排除包住整页的容器。
  const complete = hits.filter(hit => hit.complete).map(hit => hit.node);
  const roots = complete.filter(node => !complete.some(other => other !== node && contains_element(other, node)));
  const partial = hits.filter(hit => !hit.complete && !roots.some(root => contains_element(root, hit.node)) && !hits.some(other => other.node !== hit.node && contains_element(hit.node, other.node))).map(hit => hit.node);
  const selected = hits.map(hit => hit.node).filter(node => roots.includes(node) || partial.includes(node));
  return { elements: selected.slice(0, limit), total: selected.length };
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
    nodes: selection.elements.map(node => {
      const html = node.outerHTML;
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      return {
        tag: node.localName, n: node.getAttribute('n') || node.getAttribute('data-n') || null,
        id: node.id || null, class: node.getAttribute('class') || '',
        selector: node_selector(node, root), text: text.slice(0, 240), text_truncated: text.length > 240,
        bounds: local_rect(node.getBoundingClientRect(), host), html: html.slice(0, 20000), html_truncated: html.length > 20000,
      };
    }),
  };
}
