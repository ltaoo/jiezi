export function create_catalog_tree({ root, model, get_selected, on_select, on_open }) {
  const document = root.ownerDocument;
  root.setAttribute('role', 'tree');
  root.setAttribute('aria-label', '页面与组件目录');
  const toggle_button = document.createElement('button');
  toggle_button.dataset.n = 'catalog-tree-toggle'; toggle_button.className = 'catalog-tree-toggle'; toggle_button.type = 'button';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ 'data-n': 'catalog-tree-toggle-icon', viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) icon.setAttribute(name, value);
  const chevrons = document.createElementNS('http://www.w3.org/2000/svg', 'path'); chevrons.setAttribute('data-n', 'catalog-tree-toggle-chevrons');
  icon.append(chevrons); toggle_button.append(icon);
  toggle_button.addEventListener('click', () => { model.toggle_all(); render(); });
  function part(name, class_name, text) {
    const node = document.createElement('span');
    node.dataset.n = name; node.className = class_name; node.textContent = text;
    return node;
  }
  function render() {
    const selected_id = get_selected();
    const restore_focus = root.contains(document.activeElement);
    const previous = new Map([...root.children].map(node => [node.dataset.key, node]));
    const children = [];
    const rows = model.rows();
    const expanded = model.all_expanded();
    toggle_button.title = expanded ? '收起全部' : '展开全部';
    toggle_button.setAttribute('aria-label', toggle_button.title);
    toggle_button.setAttribute('aria-expanded', String(expanded));
    toggle_button.disabled = !rows.some(row => row.children.length);
    chevrons.setAttribute('d', expanded ? 'm7 11 5-5 5 5M7 18l5-5 5 5' : 'm7 6 5 5 5-5M7 13l5 5 5-5');
    root.tabIndex = rows.length ? -1 : 0;
    for (const row of rows) {
      const existing = previous.get(row.key);
      const node = existing || document.createElement('div');
      node.dataset.n = 'catalog-tree-row'; node.dataset.key = row.key;
      node.className = 'catalog-tree-row'; node.setAttribute('role', 'treeitem');
      node.setAttribute('aria-level', row.depth); node.setAttribute('aria-posinset', row.position); node.setAttribute('aria-setsize', row.siblings);
      node.style.paddingLeft = `${8 + (row.depth - 1) * 16}px`;
      node.tabIndex = model.state.focused === row.key ? 0 : -1;
      if (row.children.length) node.setAttribute('aria-expanded', String(row.open));
      else node.removeAttribute('aria-expanded');
      if (row.frame) {
        node.dataset.id = row.frame.id; node.title = row.frame.file;
        node.setAttribute('aria-selected', String(selected_id === row.frame.id));
      }
      const caret = node.querySelector('[data-n="catalog-tree-caret"]') || part('catalog-tree-caret', 'catalog-tree-caret', '');
      caret.textContent = row.children.length ? row.open ? '⌄' : '›' : '';
      caret.setAttribute('aria-hidden', 'true');
      if (!existing) {
        const icon = part('catalog-tree-icon', 'catalog-icon', row.frame ? row.frame.kind === 'page' ? '▣' : '◇' : '▱');
        icon.setAttribute('aria-hidden', 'true');
        node.append(caret, icon, part('catalog-tree-title', 'catalog-tree-title', row.title), part('catalog-tree-count', 'catalog-tree-count', ''));
      }
      const count = node.querySelector('[data-n="catalog-tree-count"]');
      count.hidden = !row.children.length;
      count.textContent = String(row.children.length);
      if (!existing) {
        node.addEventListener('focus', () => {
          model.focus(row.key);
          for (const sibling of root.querySelectorAll('[role="treeitem"]')) sibling.tabIndex = sibling === node ? 0 : -1;
        });
        node.addEventListener('click', event => {
          model.focus(row.key); node.focus();
          if (!row.frame || (node.hasAttribute('aria-expanded') && event.target === caret)) { model.toggle(row.key); render(); }
          else on_select(row.frame);
        });
        node.addEventListener('dblclick', event => { if (row.frame && event.target !== caret) on_open(row.frame); });
      }
      children.push(node);
    }
    if (!rows.length) children.push(part('catalog-tree-empty', 'catalog-tree-empty', '没有匹配的页面或组件'));
    root.replaceChildren(...children);
    if (restore_focus) focus();
  }
  function focus() {
    [...root.querySelectorAll('[role="treeitem"]')].find(node => node.dataset.key === model.state.focused)?.focus();
  }
  root.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const row = model.rows().find(row => row.key === model.state.focused);
    if (!row) return;
    if (event.key === 'Enter' || event.key === ' ') {
      if (row.frame) (event.key === 'Enter' ? on_open : on_select)(row.frame);
      else { model.toggle(row.key); render(); }
    } else { model.navigate(event.key); render(); }
    focus();
  });
  return { toggle_button, render, sync_selection() {
    const rows = [...root.querySelectorAll('[role="treeitem"]')];
    if (!rows.some(node => node.dataset.key === model.state.focused)) { render(); return; }
    for (const node of rows) {
      if (node.dataset.id) node.setAttribute('aria-selected', String(node.dataset.id === get_selected()));
      node.tabIndex = node.dataset.key === model.state.focused ? 0 : -1;
    }
  } };
}
