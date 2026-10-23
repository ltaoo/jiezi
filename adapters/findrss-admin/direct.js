import runtime_code from 'admin-preview-runtime';
import { create_admin_host } from './host.js';
import { AdminPreviewModel } from './preview.model.js';

export function mount(frame, root, { signal, on_error } = {}) {
  if (signal?.aborted) return;
  const host = create_admin_host(root, on_error, AdminPreviewModel({ empty: frame.path === '/discovery/2' }));
  let runtime, view, disposed = false;
  const destroy = () => {
    if (disposed) return; disposed = true;
    try {
      if (view) runtime.Timeless.destroyElement(view);
      const routing = host.scope.preview_routing;
      if (routing) {
        Object.values(routing.history.views).forEach(view => view.destroy?.());
        routing.history.destroy?.(); routing.navigator.destroy?.();
      }
      host.scope.FindRSSAdminMessages?.methods.stop();
    } finally { host.destroy(); }
  };
  try {
    // 旧后台通过 window 组合依赖；每个 Frame 在自己的作用域执行整套模块。
    const keys = Object.keys(host.scope);
    runtime = new Function(...keys, runtime_code)(...keys.map(key => host.scope[key]));
    view = runtime.Timeless.ErrorBoundary({ onError: error => { throw error; }, fallback: () => [] }, () => runtime.render(frame));
    runtime.Timeless.DOM.render(view, root);
    return destroy;
  } catch (error) { destroy(); throw error; }
}
