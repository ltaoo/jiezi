import postcss from 'postcss';
import { viewport_values } from './viewport-styles.js';

// 保留业务 utility class，将视口尺寸绑定到 Frame。
export function shadow_styles(css) {
  const stylesheet = postcss.parse(css);
  stylesheet.walkRules(rule => {
    rule.selector = rule.selector
      .replace(/:root((?:\[[^\]]+\]|:not\([^)]*\))*)/g, (_match, condition) => condition ? `:host(${condition})` : ':host');
  });
  stylesheet.walkDecls(declaration => {
    declaration.value = viewport_values(declaration.value);
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
