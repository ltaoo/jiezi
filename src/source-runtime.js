const registry_key = Symbol.for('jiezi.source-locations');

function registry(owner) {
  if (!Object.hasOwn(owner, registry_key)) Object.defineProperty(owner, registry_key, { value: new WeakMap() });
  return owner[registry_key];
}

function bind_node(node, info) {
  if (node?.ownerDocument && typeof node.nodeType === 'number') registry(node.ownerDocument).set(node, info);
}

export function source_details(node) {
  return node?.ownerDocument?.[registry_key]?.get(node) || null;
}

// shortcut: 支持 DOM 和 Timeless 的 $elm 协议；接入其他框架时扩展共享绑定协议。
export function trace_source(value, source, creates_node = false) {
  // 调试元数据不能让原本成功的业务调用因冻结对象或代理而失败。
  try { return track_source(value, source, creates_node); }
  catch { return value; }
}

function track_source(value, source, creates_node) {
  if (!value || typeof value !== 'object') return value;
  const descriptor = Object.getOwnPropertyDescriptor(value, '$elm');
  const Node = globalThis.Node || globalThis.document?.defaultView?.Node;
  const nodes = typeof Node === 'function' && value instanceof Node;
  if (nodes && !value.ownerDocument) return value;
  if (!nodes && !(descriptor?.configurable && typeof descriptor.set === 'function' && typeof Object.getOwnPropertyDescriptor(value, 't')?.value === 'string' && typeof Object.getOwnPropertyDescriptor(value, 'onMounted')?.value === 'function')) return value;
  const records = registry(nodes ? value.ownerDocument : globalThis.document || globalThis);
  let info = records.get(value);
  if (info) {
    const same = location => location?.file === source.file && location.line === source.line && location.column === source.column;
    if (!same(info.declaration) && !info.usages.some(same)) info.usages.push(source);
    return value;
  }
  // 查询或第三方 helper 返回的未知 DOM，不能冒充节点创建位置。
  if (nodes && !creates_node) return value;
  info = { declaration: source, usages: [] };
  records.set(value, info);
  if (nodes) return value;
  let bound = null;
  const renderers = new WeakSet();
  function update(target) {
    const seen = new Set();
    while (target && typeof target.get$elm === 'function' && !seen.has(target)) { seen.add(target); target = target.get$elm(); }
    if (bound && bound !== target && source_details(bound) === info) registry(bound.ownerDocument).delete(bound);
    bound = target?.ownerDocument ? target : null;
    bind_node(bound, info);
  }
  function watch(renderer) {
    if (renderer && typeof renderer.get$elm === 'function' && !renderers.has(renderer)) {
      renderers.add(renderer);
      for (const name of ['render', 'hydrate']) {
        const original = renderer[name];
        if (typeof original !== 'function') continue;
        renderer[name] = function(...args) {
          const result = original.apply(this, args);
          if (descriptor.get?.call(value) === renderer) update(renderer);
          return result;
        };
      }
    }
    update(renderer);
  }
  Object.defineProperty(value, '$elm', {
    ...descriptor,
    set(node) {
      descriptor.set.call(this, node);
      watch(node);
    },
  });
  watch(descriptor.get?.call(value));
  return value;
}
