import runtime_code from 'wx-preview-runtime';
import { create_admin_host } from '../findrss-admin/host.js';
import { WXPreviewModel } from './preview.model.js';

export function mount(frame, root, { signal, on_error } = {}) {
  if (signal?.aborted) return;
  const host = create_admin_host(root, on_error, WXPreviewModel({ mock: frame.mock, content_layout: frame.content_layout }));
  const { scope } = host;
  scope.location.pathname = '/'; scope.location.href = 'https://preview.invalid/';
  scope.__d_config = { version: 'preview', assets_base_url: '/public' };
  scope.config = scope.__d_config; scope.API_ORIGIN = 'https://preview.invalid';
  scope.queueMicrotask = callback => scope.setTimeout(callback, 0);
  scope.WebSocket = class {
    readyState = 0;
    constructor() { scope.setTimeout(() => { if (this.readyState === 3) return; this.readyState = 1; this.onopen?.({}); }, 0); }
    send() {}
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  };
  let runtime, view, disposed = false;
  const destroy = () => {
    if (disposed) return; disposed = true;
    try { if (view) runtime.Timeless.destroyElement(view); runtime?.destroy(); }
    finally { host.destroy(); }
  };
  try {
    const keys = Object.keys(scope);
    runtime = new Function(...keys, runtime_code)(...keys.map(key => scope[key]));
    view = runtime.Timeless.ErrorBoundary({ onError: error => { throw error; }, fallback: () => [] }, () => runtime.render(frame));
    runtime.Timeless.DOM.render(view, root);
    return destroy;
  } catch (error) { destroy(); throw error; }
}
