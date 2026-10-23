import { parse } from 'acorn';

// Read metadata from syntax only. Module code and render bodies are never evaluated here.
export function preview_declarations(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const declarations = ast.body.filter(node => node.type === 'ExportNamedDeclaration' && node.declaration?.kind === 'const')
    .flatMap(node => node.declaration.declarations).filter(node => ['_Preview', '_Previews'].includes(node.id.name));
  if (declarations.length > 1) throw new Error('同一模块只能导出 _Preview 或 _Previews 其中一个');
  const declaration = declarations[0];
  if (!declaration) return [];
  const export_node = ast.body.find(node => node.declaration?.declarations?.includes(declaration));
  if (export_node.declaration.declarations.length !== 1) throw new Error('_Previews 必须单独声明');
  if (declaration.init?.type !== 'ArrayExpression') throw new Error('_Previews 必须是数组字面量');
  const paths = new Set();
  return declaration.init.elements.map((entry, index) => {
    if (entry?.type !== 'ObjectExpression') throw new Error(`_Previews[${index}] 必须是对象字面量`);
    const metadata = { preview_index: index }, fields = new Set();
    for (const property of entry.properties) {
      const key = property.key?.name ?? property.key?.value;
      if (property.type !== 'Property' || property.computed || property.kind !== 'init' || !['name', 'path', 'width', 'height', 'order', 'render'].includes(key) || fields.has(key)) {
        throw new Error(`_Previews[${index}] 仅接受 name、path、width、height、order 和 render，且不可重复`);
      }
      fields.add(key);
      if (key === 'render') {
        if (!['FunctionExpression', 'ArrowFunctionExpression'].includes(property.value.type) || property.value.async || property.value.generator) {
          throw new Error(`_Previews[${index}].render 必须是同步函数`);
        }
      } else if (key === 'order') {
        if (property.value.type !== 'Literal' || !Number.isFinite(property.value.value) || property.value.value < 0) throw new Error(`_Previews[${index}].order 必须是非负有限数`);
        metadata.order = property.value.value;
      } else if (key === 'width' || key === 'height') {
        if (property.value.type !== 'Literal' || !Number.isFinite(property.value.value) || property.value.value <= 0) throw new Error(`_Previews[${index}].${key} 必须是正数`);
        metadata[key] = property.value.value;
      } else {
        if (property.value.type !== 'Literal' || typeof property.value.value !== 'string') throw new Error(`_Previews[${index}].${key} 必须是静态字符串`);
        metadata[key] = property.value.value.trim();
      }
    }
    if (!fields.has('render')) throw new Error(`_Previews[${index}] 缺少 render()`);
    if (!metadata.name) throw new Error(`_Previews[${index}] 必须显式声明非空 name`);
    if (!metadata.path?.startsWith('/') || metadata.path.split('/').slice(1).some(part => !part || part === '.' || part === '..') || /[?#\\\u0000-\u001f]/.test(metadata.path)) {
      throw new Error(`_Previews[${index}].path 必须是 / 开头的目录路径，不含空段、.、..、query 或 hash`);
    }
    if (paths.has(metadata.path)) throw new Error(`_Previews 存在重复 path：${metadata.path}`);
    paths.add(metadata.path);
    return metadata;
  });
}
