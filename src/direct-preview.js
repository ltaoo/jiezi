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

export function create_direct_preview({ document, frame, project, theme, on_error, load = load_adapter }) {
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
    :host([data-picking="true"]) * { cursor: crosshair !important; user-select: none !important; }
  `;
  const viewport = document.createElement('div'); viewport.dataset.n = 'preview-document';
  const content = document.createElement('div'); content.dataset.n = 'preview-content';
  content.dataset.layout = frame.layout || 'content';
  const status = document.createElement('p'); status.dataset.n = 'preview-status'; status.setAttribute('role', 'status'); status.textContent = '正在渲染真实页面…';
  content.append(status); viewport.append(content); shadow.append(base, viewport);
  let disposed = false, failed = false, failure, cleanup, error_overlay;
  const abort = new AbortController();
  function cleanup_preview() {
    const release = cleanup; cleanup = undefined;
    release?.();
  }
  function render_error(error) {
    host.dataset.status = 'error';
    if (!error_overlay) {
      error_overlay = document.createElement('div'); error_overlay.dataset.n = 'preview-error-overlay';
      error_overlay.setAttribute('role', 'alert');
      const ns = 'http://www.w3.org/2000/svg';
      const icon = document.createElementNS(ns, 'svg');
      for (const [name, value] of Object.entries({ 'data-n': 'preview-error-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) icon.setAttribute(name, value);
      for (const [tag, attributes] of [['circle', { 'data-n': 'preview-error-icon-circle', cx: '12', cy: '12', r: '10' }], ['path', { 'data-n': 'preview-error-icon-cross', d: 'm15 9-6 6m0-6 6 6' }]]) {
        const node = document.createElementNS(ns, tag);
        for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
        icon.append(node);
      }
      error_overlay.append(icon, status);
    }
    status.removeAttribute('role');
    status.textContent = `页面渲染失败：${error?.message ?? String(error)}\n\n${frame.file || frame.path || frame.id}${error?.stack ? `\n\n${error.stack}` : ''}`;
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
    set_theme(value) { host.dataset.theme = value; },
    destroy() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      try { cleanup_preview(); } finally { shadow.replaceChildren(); host.remove(); }
    },
  };
}

async function load_adapter(document, project) {
  // 适配器声明的运行时按顺序加载，再求值业务模块。
  const adapter_promise = (async () => {
    for (const script of project.runtime_scripts) await load_script(document, script);
    const path = '/adapter.js';
    return import(path);
  })();
  const [adapter, styles] = await Promise.all([adapter_promise, Promise.all(project.stylesheets.map(load_styles))]);
  return { adapter, styles };
}
