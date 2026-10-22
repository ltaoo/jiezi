import postcss from 'postcss';

// 只改选择器和宽度断点，保留属性值及业务 utility class。
export function shadow_styles(css) {
  const stylesheet = postcss.parse(css);
  stylesheet.walkRules(rule => {
    rule.selector = rule.selector
      .replace(/:root((?:\[[^\]]+\]|:not\([^)]*\))*)/g, (_match, condition) => condition ? `:host(${condition})` : ':host');
  });
  stylesheet.walkAtRules('media', rule => {
    if (/^(?:screen\s+and\s+)?\((?:max-|min-)?width\s*:[^)]+\)(?:\s+and\s+\((?:max-|min-)?width\s*:[^)]+\))*$/.test(rule.params)) {
      rule.name = 'container';
      rule.params = `preview-size ${rule.params.replace(/^screen\s+and\s+/, '')}`;
    }
  });
  // 关于页面不挂载播放器，esbuild 已将其他本地 CSS import 展开。
  stylesheet.walkAtRules('import', rule => {
    if (/^["']\/video-player\.css["']$/.test(rule.params)) rule.remove();
  });
  return stylesheet.toString();
}
