import { observe_viewport_styles } from './viewport-styles.js';
import { PreviewErrorModel } from './preview-error.model.js';

const runtime_loads = new Map();
const stylesheet_loads = new Map();

function load_script(document, path) {
  if (!runtime_loads.has(path)) {
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.dataset.n = 'preview-runtime';
      script.src = path;
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); runtime_loads.delete(path); reject(new Error(`运行时加载失败：${path}`)); };
      document.head.append(script);
    });
    runtime_loads.set(path, promise);
  }
  return runtime_loads.get(path);
}

async function load_styles(path) {
  if (!stylesheet_loads.has(path)) {
    stylesheet_loads.set(path, fetch(path).then(response => {
      if (!response.ok) throw new Error(`预览样式加载失败：${path}`);
      return response.text();
    }).catch(error => { stylesheet_loads.delete(path); throw error; }));
  }
  return stylesheet_loads.get(path);
}

export function create_direct_preview({ document, frame, project, theme, on_error, load = load_preview }) {
  const host = document.createElement('div');
  host.dataset.n = 'direct-preview';
  host.dataset.frameId = frame.id;
  host.dataset.theme = theme;
  host.className = 'live-preview';
  host.setAttribute('aria-label', `${frame.title}真实页面预览`);
  const shadow = host.attachShadow({ mode: 'open' });
  const base = document.createElement('style');
  base.dataset.n = 'preview-host-style';
  base.textContent = `
    :host { all: initial; position: relative; display: block; width: 100%; height: 100%; overflow: hidden; font-family: var(--frui-font-family); font-size: var(--frui-font-size); color: var(--frui-color-text); background: var(--frui-color-canvas); }
    [data-n="preview-document"] { box-sizing: border-box; width: 100%; height: 100%; min-height: 0; overflow: auto; container: preview-size / inline-size; }
    [data-n="preview-content"] { min-width: 0; padding: var(--frui-space-6); }
    [data-n="preview-content"][data-layout="fill"] { box-sizing: border-box; height: 100%; min-height: 0; display: flex; flex-direction: column; }
    [data-n="preview-status"] { margin: 0; padding: var(--frui-space-6); font: var(--frui-font-size)/1.7 var(--frui-font-family); color: var(--frui-color-muted); white-space: pre-wrap; }
    [data-n="preview-error-overlay"] { position: absolute; inset: 0; z-index: 2147483647; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 32px 24px; overflow: auto; background: var(--frui-color-canvas, #fff); border: 2px solid #dc2626; }
    [data-n="preview-error-icon"] { display: block; flex-shrink: 0; width: 72px; height: 72px; color: #dc2626; }
    [data-n="preview-error-overlay"] [data-n="preview-status"] { box-sizing: border-box; flex-shrink: 0; width: 100%; padding: 0; color: var(--frui-color-text, #0f172a); overflow-wrap: anywhere; }
    [data-n="preview-error-copy"] { flex-shrink: 0; align-self: flex-start; padding: 8px 12px; border: 1px solid var(--frui-color-border); border-radius: var(--frui-radius-control); font: inherit; color: var(--frui-color-text); background: var(--frui-color-surface); cursor: pointer; }
    [data-n="preview-error-copy"]:disabled { opacity: .45; cursor: wait; }
    [data-n="preview-error-copy"]:focus-visible { outline: 2px solid var(--frui-color-focus); outline-offset: 2px; }
    [data-n="preview-error-copy-status"] { align-self: flex-start; margin: 0; color: var(--frui-color-muted); }
    :host([data-picking="true"]:not([data-status="error"])) * { cursor: crosshair !important; user-select: none !important; }
  `;
  const viewport = document.createElement('div'); viewport.dataset.n = 'preview-document';
  const content = document.createElement('div'); content.dataset.n = 'preview-content';
  content.dataset.layout = frame.layout || 'content';
  const status = document.createElement('p'); status.dataset.n = 'preview-status'; status.setAttribute('role', 'status'); status.textContent = '正在渲染真实页面…';
  content.append(status); viewport.append(content); shadow.append(base, viewport);
  const stop_viewport_styles = observe_viewport_styles(shadow);
  let disposed = false, failed = false, failure, cleanup, error_overlay;
  const abort = new AbortController();
  function cleanup_preview() {
    const release = cleanup; cleanup = undefined;
    release?.();
  }
  function render_error(error) {
    host.dataset.status = 'error';
    host.inert = false;
    if (!error_overlay) {
      const error_model = PreviewErrorModel(frame, error, text => document.defaultView.navigator.clipboard.writeText(text));
      error_overlay = document.createElement('div'); error_overlay.dataset.n = 'preview-error-overlay';
      error_overlay.setAttribute('role', 'alert');
      for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick']) error_overlay.addEventListener(type, event => event.stopPropagation());
      const ns = 'http://www.w3.org/2000/svg';
      const icon = document.createElementNS(ns, 'svg');
      for (const [name, value] of Object.entries({ 'data-n': 'preview-error-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) icon.setAttribute(name, value);
      for (const [tag, attributes] of [['circle', { 'data-n': 'preview-error-icon-circle', cx: '12', cy: '12', r: '10' }], ['path', { 'data-n': 'preview-error-icon-cross', d: 'm15 9-6 6m0-6 6 6' }]]) {
        const node = document.createElementNS(ns, tag);
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
        icon.append(node);
      }
      const copy = document.createElement('button'); copy.dataset.n = 'preview-error-copy'; copy.type = 'button';
      const feedback = document.createElement('p'); feedback.dataset.n = 'preview-error-copy-status'; feedback.setAttribute('role', 'status');
      function render_copy() {
        if (disposed) return;
        copy.disabled = error_model.state.copying;
        copy.textContent = error_model.state.copying ? '正在复制…' : '复制错误';
        feedback.textContent = error_model.state.feedback; feedback.hidden = !error_model.state.feedback;
      }
      error_model.subscribe(render_copy); render_copy();
      copy.addEventListener('click', () => error_model.copy());
      status.textContent = error_model.state.text;
      error_overlay.append(icon, copy, feedback, status);
    }
    status.removeAttribute('role');
    content.replaceChildren();
    shadow.append(error_overlay);
  }
  function report_error(error) {
    if (disposed || failed) return;
    failed = true; failure = error;
    abort.abort();
    try { cleanup_preview(); }
    catch (cleanup_error) { console.error('Frame 清理失败：', cleanup_error); }
    render_error(error);
    on_error?.(error);
  }
  const ready = (async () => {
    try {
      const { adapter, styles } = await load(document, project);
      if (disposed) return;
      for (const css of styles) {
        const node = document.createElement('style'); node.dataset.n = 'preview-project-style'; node.textContent = css; shadow.insertBefore(node, base);
      }
      content.replaceChildren();
      cleanup = await adapter.mount(frame, content, { signal: abort.signal, on_error: report_error });
      if (disposed || failed) {
        try { cleanup_preview(); }
        finally { if (!disposed && failed) render_error(failure); }
        return;
      }
      host.dataset.status = 'mounted';
    } catch (error) {
      report_error(error);
    }
  })();
  return {
    host, root: content, ready,
    set_size(width, height) {
      host.style.width = `${width}px`; host.style.height = `${height}px`;
      host.style.setProperty('--jiezi-viewport-width', `${width}px`);
      host.style.setProperty('--jiezi-viewport-height', `${height}px`);
    },
    set_theme(value) { host.dataset.theme = value; },
    destroy() {
      if (disposed) return;
      disposed = true;
      stop_viewport_styles();
      abort.abort();
      try { cleanup_preview(); } finally { shadow.replaceChildren(); host.remove(); }
    },
  };
}

export async function load_preview(document, project) {
  const asset = path => project.revision ? `${path}${path.includes('?') ? '&' : '?'}revision=${encodeURIComponent(project.revision)}` : path;
  // 适配器声明的运行时按顺序加载，再求值业务模块。
  const adapter_promise = (async () => {
    for (const script of project.runtime_scripts) await load_script(document, asset(script));
    const path = asset('/adapter.js');
    return import(path);
  })();
  const [adapter, styles] = await Promise.all([adapter_promise, Promise.all(project.stylesheets.map(path => load_styles(asset(path))))]);
  return { adapter, styles };
}
