export function viewport_values(value) {
  return value.replace(
    /("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|url\((?:\\[\s\S]|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^)"'\\])*\)|\/\*[\s\S]*?\*\/)|(?<![\w.\\-])([+-]?(?:\d*\.)?\d+(?:e[+-]?\d+)?)([sld]?v(?:w|h|min|max))(?![\w-])/gi,
    (match, literal, amount, unit) => {
      if (literal) return match;
      const width = 'var(--jiezi-viewport-width)', height = 'var(--jiezi-viewport-height)';
      const dimension = unit.toLowerCase().replace(/^[sld]/, '');
      const size = dimension === 'vw' ? width : dimension === 'vh' ? height : `${dimension === 'vmin' ? 'min' : 'max'}(${width}, ${height})`;
      return `calc(${size} * ${amount} / 100)`;
    },
  );
}

export function observe_viewport_styles(root) {
  function update_style(node) {
    const original = node.getAttribute('style');
    if (!original) return;
    const converted = viewport_values(original);
    if (converted !== original) node.setAttribute('style', converted);
  }
  function update_tree(node) {
    if (node.nodeType !== 1) return;
    update_style(node);
    node.querySelectorAll('[style]').forEach(update_style);
  }
  const observer = new root.ownerDocument.defaultView.MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') update_style(record.target);
      else record.addedNodes.forEach(update_tree);
    }
  });
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  root.querySelectorAll('[style]').forEach(update_style);
  return () => observer.disconnect();
}
