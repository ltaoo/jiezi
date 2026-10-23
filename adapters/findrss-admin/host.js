import { AdminPreviewModel } from './preview.model.js';

export function create_admin_host(root, on_error, model = AdminPreviewModel()) {
  const document = root.ownerDocument, browser = document.defaultView;
  const timers = new Set(), intervals = new Set(), cleanups = [];
  let disposed = false;
  const listen = (target, name, callback, options) => { target.addEventListener(name, callback, options); cleanups.push(() => target.removeEventListener(name, callback, options)); };
  const safe = callback => (...args) => { if (disposed) return; try { callback(...args); } catch (error) { on_error?.(error); } };
  const blocked = () => { throw new Error('此操作未提供预览实现'); };
  const scope = {
    fetch: model.fetch,
    setTimeout(callback, delay, ...args) { const id = setTimeout(safe(() => { timers.delete(id); callback(...args); }), delay); timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); clearTimeout(id); },
    setInterval(callback, delay, ...args) { const id = setInterval(safe(() => callback(...args)), delay); intervals.add(id); return id; },
    clearInterval(id) { intervals.delete(id); clearInterval(id); },
    addEventListener: (name, callback, options) => listen(root, name, callback, options),
    removeEventListener: (name, callback, options) => root.removeEventListener(name, callback, options),
    getComputedStyle: element => browser.getComputedStyle(element),
    requestAnimationFrame: callback => scope.setTimeout(() => callback(performance.now()), 16),
    cancelAnimationFrame: id => scope.clearTimeout(id),
    localStorage: model.storage, sessionStorage: model.storage,
    location: { href: 'https://preview.invalid/admin/', origin: 'https://preview.invalid', pathname: '/admin/', search: '', hash: '', assign: blocked, replace: blocked, reload: blocked },
    history: { pushState() {}, replaceState() {} },
    navigator: { userAgent: browser.navigator?.userAgent || '', platform: browser.navigator?.platform || '', clipboard: browser.navigator?.clipboard },
    WebSocket: class { constructor() { blocked(); } }, EventSource: class { constructor() { blocked(); } }, Worker: class { constructor() { blocked(); } }, XMLHttpRequest: class { constructor() { blocked(); } },
    open: blocked, prompt: () => null, confirm: () => false,
    FindRSSAdminAuth: { fetch: model.fetch, login: model.login, logout() {} },
    FindRSSAdminRealtime: { subscribe: () => () => {}, socket: model.socket },
  };
  Object.defineProperties(scope, { innerWidth: { get: () => root.clientWidth || 1200 }, innerHeight: { get: () => root.clientHeight || 800 } });
  const scoped_document = new Proxy(document, { get(target, key) {
    if (key === 'body' || key === 'head' || key === 'documentElement') return root;
    if (key === 'defaultView') return scope;
    if (key === 'querySelector' || key === 'querySelectorAll') return root[key].bind(root);
    if (key === 'getElementById') return id => [...root.querySelectorAll('[id]')].find(node => node.id === id) || null;
    if (key === 'addEventListener' || key === 'removeEventListener') return scope[key];
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  scope.window = scope; scope.self = scope; scope.globalThis = scope; scope.document = scoped_document;
  for (const key of ['URL', 'URLSearchParams', 'AbortController', 'AbortSignal', 'DOMException', 'Response', 'Request', 'Headers', 'Blob', 'File', 'TextEncoder', 'TextDecoder', 'DOMParser', 'Element', 'HTMLElement', 'Node', 'ResizeObserver', 'MutationObserver', 'crypto', 'screen', 'matchMedia', 'getSelection', 'atob', 'btoa']) {
    if (key in scope) continue;
    const value = browser[key] ?? globalThis[key];
    if (value !== undefined) scope[key] = typeof value === 'function' && ['matchMedia', 'getSelection', 'atob', 'btoa'].includes(key) ? value.bind(browser) : value;
  }
  root.style.contain = 'layout paint'; root.style.position = 'relative';
  listen(root, 'click', event => { if (event.target.closest?.('a[href^="/admin/"]')) event.preventDefault(); });
  return { scope, model, destroy() {
    if (disposed) return; disposed = true;
    timers.forEach(id => clearTimeout(id)); intervals.forEach(id => clearInterval(id));
    cleanups.forEach(cleanup => cleanup()); model.destroy();
    root.replaceChildren();
  } };
}
