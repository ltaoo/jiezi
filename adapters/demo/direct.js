import { _Preview } from 'demo-views';

export function mount(frame, root, { signal } = {}) {
  if (signal?.aborted) return;
  const preview = _Preview[frame.preview_index];
  if (!preview || preview.path !== frame.path || preview.name !== frame.preview_name) throw new Error('示例已变化，请刷新白板');
  root.replaceChildren(preview.render());
  return () => root.replaceChildren();
}
