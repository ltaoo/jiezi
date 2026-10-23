import { mock_data } from './mock-data.js';

export function WXPreviewModel({ mock = false, content_layout } = {}) {
  const values = new Map();
  if (content_layout === 'card') values.set('content.layout', 'card');
  const fixtures = mock ? mock_data() : {};
  const polls = new Map();
  let messages_synced = false;
  if (mock) values.set('wx_channels_download', JSON.stringify({ scraper_active_job_id: 'mock-job' }));
  let disposed = false;
  const lists = new Set(['/api/account/list', '/api/content/list', '/api/browse_history/list', '/api/v1/automation/list_flows', '/api/v1/automation/list_schedules', '/api/v1/automation/list_runs', '/api/v1/download_task/list', '/api/logs']);
  return {
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) },
    async fetch(input, options = {}) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const url = new URL(typeof input === 'string' ? input : input.url, 'https://preview.invalid');
      const method = (options.method || input.method || 'GET').toUpperCase();
      if (mock && !disposed && method === 'GET' && url.origin === 'https://preview.invalid' && url.pathname === '/api/filehelper/synccheck') {
        await new Promise(resolve => {
          const timer = setTimeout(() => { polls.delete(timer); resolve(); }, messages_synced ? 1000 : 0);
          polls.set(timer, resolve);
        });
        messages_synced = true;
      }
      let data;
      if (!disposed && url.origin === 'https://preview.invalid') {
        const list_method = url.pathname.startsWith('/api/v1/automation/') || url.pathname === '/api/browse_history/list' ? 'POST' : 'GET';
        if (method === list_method && lists.has(url.pathname)) data = { list: [], total: 0, page: 1, page_size: 20, status_counts: {} };
        if (method === 'POST' && url.pathname === '/api/v1/automation/list_flow_nodes') data = { list: [] };
        if (method === 'GET' && url.pathname === '/api/v1/sync/servers') data = { list: [] };
        if (method === 'GET' && url.pathname === '/api/filehelper/status') data = { logged_in: false, status: 'logged_out' };
        if (method === 'GET' && url.pathname === '/api/status') data = { version: 'preview', api: { status: 'running' }, proxy: { status: 'stopped' } };
        if (mock && Object.hasOwn(fixtures, `${method} ${url.pathname}`)) data = fixtures[`${method} ${url.pathname}`];
      }
      const ok = data !== undefined;
      return new Response(JSON.stringify({ code: ok ? 0 : 501, msg: ok ? '' : '此操作未提供预览实现', data: data ?? {} }), { status: disposed ? 410 : ok ? 200 : 501, headers: { 'Content-Type': 'application/json' } });
    },
    destroy() { disposed = true; values.clear(); polls.forEach((resolve, timer) => { clearTimeout(timer); resolve(); }); polls.clear(); },
  };
}
