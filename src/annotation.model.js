const REF_PATTERN = /#(\d+)/g;

function normalize_node(node) {
  const source = node?.source;
  return {
    tag: node?.tag || '',
    n: node?.n ?? null,
    selector: node?.selector || '',
    text: node?.text || '',
    source: source && typeof source.file === 'string' ? { file: source.file, line: source.line, column: source.column } : null,
    total: Number.isFinite(node?.total) ? node.total : 1,
  };
}

function merge_text(parts) {
  const result = [];
  for (const part of parts) {
    if (part.type === 'text') {
      if (!part.text) continue;
      const previous = result.at(-1);
      if (previous?.type === 'text') previous.text += part.text;
      else result.push({ type: 'text', text: part.text });
    } else if (part.type === 'ref') {
      result.push({ type: 'ref', order: part.order });
    }
  }
  return result;
}

export function parts_text(parts = []) {
  return parts.map(part => part.type === 'ref' ? `#${part.order}` : (part.text || '')).join('');
}

export function normalize_references(parts = [], orders = []) {
  const valid = new Set(orders);
  const result = [];
  for (const part of parts) {
    if (part.type === 'ref') { result.push({ type: 'ref', order: part.order }); continue; }
    const text = part.text || '';
    let last = 0, match;
    REF_PATTERN.lastIndex = 0;
    while ((match = REF_PATTERN.exec(text))) {
      const order = Number(match[1]);
      if (!valid.has(order)) continue;
      if (match.index > last) result.push({ type: 'text', text: text.slice(last, match.index) });
      result.push({ type: 'ref', order });
      last = match.index + match[0].length;
    }
    if (last < text.length) result.push({ type: 'text', text: text.slice(last) });
  }
  return merge_text(result);
}

function source_label(source) {
  return source ? `${source.file}:${source.line}:${source.column}` : '未记录';
}

export function AnnotationModel() {
  const state = { items: [] };
  let next = 1;
  function find(order) { return state.items.find(item => item.order === order) || null; }
  return {
    state,
    add({ node, parts = [] } = {}) {
      const item = { order: next++, node: normalize_node(node), parts: parts.slice() };
      state.items.push(item);
      return item;
    },
    update(order, parts = []) {
      const item = find(order);
      if (!item) return null;
      item.parts = parts.slice();
      return item;
    },
    remove(order) {
      const index = state.items.findIndex(item => item.order === order);
      if (index < 0) return false;
      state.items.splice(index, 1);
      return true;
    },
    get(order) { return find(order); },
    orders() { return state.items.map(item => item.order); },
    next_order() { return next; },
    prompt(frame = {}) {
      const lines = ['# 标注修改要求', ''];
      lines.push(`- 页面：${frame.title || frame.id || '未命名 Frame'}`);
      lines.push(`- 文件：${frame.file || '未记录'}`);
      lines.push(`- 路由：${frame.route || '独立组件'}`);
      lines.push('', '以下按标注顺序列出要修改的节点。`#n` 指第 n 条标注对应的节点，可在要求中引用。');
      for (const item of state.items) {
        const label = item.node.n || item.node.tag || '节点';
        lines.push('', `## #${item.order} · ${label}`);
        lines.push(`- 选择器：\`${item.node.selector || ':scope'}\``);
        lines.push(`- 源码：\`${source_label(item.node.source)}\``);
        if (item.node.total > 1) lines.push(`- 选中节点：${item.node.total} 个`);
        lines.push(`- 节点文本：${item.node.text || '（无文本）'}`);
        lines.push(`- 要求：${parts_text(item.parts) || '（未填写）'}`);
      }
      return lines.join('\n');
    },
  };
}
