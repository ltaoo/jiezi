export function matches_frame(frame, query) {
  return `${frame.title} ${frame.name} ${frame.path} ${frame.file} ${frame.route || ''} ${frame.group}`.toLowerCase().includes(query.trim().toLowerCase());
}

// Path segments define both folders and Frame identity; imports do not define ownership.
export function CatalogTreeModel(frames) {
  const nodes = new Map(), parents = new Map(), roots = [];
  function ensure(path) {
    if (nodes.has(path)) return nodes.get(path);
    const node = { id: path, key: path, title: path.split('/').at(-1), children: [] };
    nodes.set(path, node);
    const parent_path = path.slice(0, path.lastIndexOf('/'));
    const parent = parent_path ? ensure(parent_path) : null;
    parents.set(path, parent);
    (parent ? parent.children : roots).push(node);
    return node;
  }
  for (const frame of frames) Object.assign(ensure(frame.path), { title: frame.title, frame });
  function sort(items) {
    for (const node of items) {
      sort(node.children);
      node.order = Math.min(node.frame?.order ?? Infinity, ...node.children.map(child => child.order));
    }
    items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN', { numeric: true }) || a.key.localeCompare(b.key));
  }
  sort(roots);
  function descendants(node) { return [...(node.frame ? [node.frame] : []), ...node.children.flatMap(descendants)]; }
  const groups = roots.map(node => {
    const items = descendants(node);
    return { id: node.key, title: node.title, frames: items, page: items.some(frame => frame.kind === 'page') };
  });
  const state = { query: '', filter: 'all', focused: null, expanded: new Set([...nodes.values()].filter(node => !node.frame).map(node => node.key)), search_expanded: new Map() };
  function matched(node, query) {
    return `${node.title} ${node.key}`.toLowerCase().includes(query.trim().toLowerCase()) || !!node.frame && matches_frame(node.frame, query);
  }
  function subtree_matches(node, query) { return matched(node, query) || node.children.some(child => subtree_matches(child, query)); }
  function project(node, inherited = false) {
    const match = inherited || matched(node, state.query);
    const children = node.children.map(child => project(child, match)).filter(Boolean);
    const allowed = !node.frame || (state.filter !== 'component' || node.frame.kind === 'component') && (state.filter !== 'direct' || node.frame.preview === 'direct');
    if ((!match || !allowed) && !children.length) return null;
    if (!node.frame && !children.length) return null;
    return { ...node, children };
  }
  function is_open(key) { return state.query.trim() ? state.search_expanded.get(key) ?? true : state.expanded.has(key); }
  function rows() {
    const result = [];
    function visit(siblings, depth = 1, parent_key = null) {
      siblings.forEach((node, index) => {
        const open = node.children.length > 0 && is_open(node.key);
        result.push({ ...node, depth, parent_key, open, position: index + 1, siblings: siblings.length });
        if (open) visit(node.children, depth + 1, node.key);
      });
    }
    const included = roots.filter(node => state.filter !== 'page' || groups.find(group => group.id === node.key).page);
    visit(included.map(node => project(node)).filter(Boolean));
    if (!result.some(row => row.key === state.focused)) state.focused = result[0]?.key || null;
    return result;
  }
  return {
    state, rows,
    groups: () => groups,
    ordered_frames: () => groups.flatMap(group => group.frames),
    get_children: id => nodes.get(id)?.children || [],
    get_parent: id => parents.get(id) || null,
    matches(id, query) {
      let node = nodes.get(id);
      if (!node) return false;
      if (subtree_matches(node, query)) return true;
      while ((node = parents.get(node.key))) if (matched(node, query)) return true;
      return false;
    },
    update(query, filter) {
      if (query !== state.query) state.search_expanded.clear();
      state.query = query; state.filter = filter;
    },
    toggle(key, open = !is_open(key)) {
      if (state.query.trim()) state.search_expanded.set(key, open);
      else if (open) state.expanded.add(key);
      else state.expanded.delete(key);
      state.focused = key;
    },
    expand_all(open) {
      for (const node of nodes.values()) if (node.children.length) {
        if (state.query.trim()) state.search_expanded.set(node.key, open);
        else if (open) state.expanded.add(node.key);
        else state.expanded.delete(node.key);
      }
    },
    all_expanded() { return rows().every(row => !row.children.length || row.open); },
    toggle_all() { this.expand_all(!this.all_expanded()); },
    reveal(id) {
      if (!nodes.has(id)) return;
      for (let parent = parents.get(id); parent; parent = parents.get(parent.key)) {
        if (state.query.trim()) state.search_expanded.set(parent.key, true);
        else state.expanded.add(parent.key);
      }
      state.focused = id;
    },
    focus(key) { if (nodes.has(key)) state.focused = key; },
    navigate(key) {
      const visible = rows(), index = visible.findIndex(row => row.key === state.focused), row = visible[index];
      if (!row) return;
      if (key === 'ArrowDown') state.focused = visible[Math.min(index + 1, visible.length - 1)].key;
      if (key === 'ArrowUp') state.focused = visible[Math.max(0, index - 1)].key;
      if (key === 'Home') state.focused = visible[0].key;
      if (key === 'End') state.focused = visible.at(-1).key;
      if (key === 'ArrowRight' && row.children.length) {
        if (!row.open) this.toggle(row.key, true);
        else state.focused = visible[index + 1].key;
      }
      if (key === 'ArrowLeft') {
        if (row.open) this.toggle(row.key, false);
        else if (row.parent_key) state.focused = row.parent_key;
      }
    },
  };
}
