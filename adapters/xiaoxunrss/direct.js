import Timeless from 'timeless';
import { DOM } from 'timeless-dom';
import { previews } from 'canvas-preview-registry';
import { with_frui_host } from '@project/frontend/src/components/frui/platform.js';
import { create_canvas_host } from '@project/frontend/src/canvas/host.js';

export async function mount(frame, root, { signal, on_error, create_host = create_canvas_host } = {}) {
  const load = previews[frame.module];
  if (!load) throw new Error(`缺少预览入口：${frame.module}`);
  const module = await load();
  if (signal?.aborted) return;
  const preview = (module._Preview ?? module._Previews)?.[frame.preview_index];
  if (!preview || typeof preview.render !== 'function' || preview.name?.trim() !== frame.preview_name || preview.path?.trim() !== frame.path) throw new Error(`预览声明已变化，请刷新白板：${frame.module}`);
  const host = create_host(root);
  let view, failure, disposed = false, mounting = true, failed = false;
  const report_error = error => {
    if (disposed || failed) return;
    failed = true; failure = error;
    // 先让框架完成当前更新，再交给 Frame 清理和展示错误。
    if (!mounting) queueMicrotask(() => { if (!disposed) on_error?.(error); });
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    try { if (view) Timeless.destroyElement(view); }
    finally { host.destroy(); root.replaceChildren(); }
  };
  try {
    view = Timeless.ErrorBoundary({ onError: report_error, fallback: () => [] }, () => with_frui_host(host, () => preview.render()));
    if (failed) throw failure;
    const on_mounted = view.onMounted.bind(view);
    view.onMounted = event => {
      if (disposed || failed) return;
      try { on_mounted(event); } catch (error) { report_error(error); }
    };
    DOM.render(view, root);
    mounting = false;
    if (failed) throw failure;
    return destroy;
  } catch (error) { destroy(); throw error; }
}
