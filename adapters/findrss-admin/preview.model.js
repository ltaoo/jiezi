export function AdminPreviewModel({ empty = false } = {}) {
  const storage = new Map(), settings = new Map(), sockets = new Set();
  let disposed = false;
  const state = { requests: [] };
  const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const defaults = {
    '/admin/api/overview': { generated_at: 1735689600000, devices: [], statistics: { device_count: 2, online_count: 1, offline_count: 1, task_count: 12, token_count: 3, source_count: 8, script_count: 4, source_call_count: 128, cookie_count: 0, route_count: 4, platform_count: 2, tag_count: 3, sources: [] } },
    '/admin/api/management-overview': { devices: [], download_devices: [], methods: [], task_counts: [], access_tokens: [], metrics: {} },
    '/admin/api/background-tasks': { tasks: [{ id: 'preview-task', title: '更新示例订阅源', target: '示例订阅源', status: 'completed', started_at: 1735689600000, finished_at: 1735689603000 }] },
    '/admin/api/access-tokens': { access_tokens: [], total_count: 0 },
    '/admin/api/device-tokens': { device_tokens: [], tokens: [] },
    '/admin/api/discovery/sources': { sources: empty ? [] : [
      { id: 'preview-tech', title: '科技日报', feed_url: 'https://example.invalid/technology.xml', website: 'https://example.invalid', description: '技术与产品资讯', enabled: true, source_type: 'website', tags: ['科技'], credit_cost: 1, snapshot: { saved_at: 1735689600000, articles: [{ title: '本周技术动态', url: 'https://example.invalid/articles/1' }], error: '' }, cache: { status: 'fresh', saved_at: 1735689600000 } },
      { id: 'preview-design', title: '设计周刊', feed_url: 'https://example.invalid/design.xml', enabled: false, require_token: true, source_type: 'website', tags: ['设计'], credit_cost: 2 },
    ], total_count: empty ? 0 : 2, platforms: [{ id: 'website', name: '网站' }], tags: empty ? [] : ['科技', '设计'] },
    '/admin/api/scripts': { scripts: [], total_count: 0 },
    '/admin/api/scripts/routes': { routes: [], platforms: [], tags: [] },
    '/admin/api/scripts/cookie-grants': { grants: [], cookies: [] },
    '/admin/api/clips': { clips: [], total_count: 0 },
    '/admin/api/cookies': { domains: [], cookies: [], groups: [] },
    '/admin/api/network-test/cookie-domains': { domains: [] },
    '/admin/api/storage': { objects: [], delimited_prefixes: [], truncated: false, cursor: null },
    '/admin/api/storage/usage': { size: 0, count: 0, total_size: 0, total_count: 0 },
    '/admin/api/messages': { messages: [], next_before_id: null },
    '/admin/api/users': { users: [], total_count: 0 },
    '/admin/api/redemption-campaigns': { campaigns: [], total_count: 0 },
    '/admin/api/mcp-tokens': { mcp_tokens: [], resource: 'https://preview.invalid/mcp' },
    '/admin/api/settings/cookies': { uuid: '', configured: false },
    '/admin/api/settings/webhook': { url: '', template: '', token_configured: false },
    '/admin/api/settings/snapshots': { policy: { mode: 'interval', interval_minutes: 60 }, max_concurrency: 3 },
    '/admin/api/scripts/agent/settings': { providers: [], roles: [], models: [] },
  };
  return {
    state,
    storage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key), clear: () => storage.clear() },
    async fetch(input, options = {}) {
      if (disposed) return response({ error: '预览已关闭' }, 410);
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const url = new URL(typeof input === 'string' ? input : input.url, 'https://preview.invalid');
      const method = options.method || 'GET';
      state.requests.push({ path: url.pathname, method });
      if (url.origin !== 'https://preview.invalid') return response({ error: '预览不访问外部服务' }, 501);
      if (method === 'GET' && defaults[url.pathname]) return response(settings.get(url.pathname) || defaults[url.pathname]);
      if (['PUT', 'POST'].includes(method) && ['/admin/api/settings/cookies', '/admin/api/settings/webhook', '/admin/api/settings/snapshots', '/admin/api/scripts/agent/settings'].includes(url.pathname)) {
        const value = { ...defaults[url.pathname], ...JSON.parse(options.body || '{}') };
        settings.set(url.pathname, value); return response(value);
      }
      return response({ error: `尚未提供此预览交互：${method} ${url.pathname}` }, 501);
    },
    async login(password) { if (password !== 'preview') throw new Error('示例密码为 preview'); },
    socket(address) {
      if (disposed || new URL(address).pathname !== '/admin/api/loadtest/ws') throw new Error('此连接未提供预览实现');
      const socket = {
        readyState: 0,
        send(text) {
          if (disposed || socket.readyState !== 1) return;
          const message = JSON.parse(text);
          const value = ['hello', 'metrics'].includes(message.type) ? { type: 'hello', sources: [], summary: {}, run: null } : { type: 'error', error: '此预览不执行真实并发任务' };
          Promise.resolve().then(() => { if (!disposed && socket.readyState === 1) socket.onmessage?.({ data: JSON.stringify(value) }); });
        },
        close() { if (socket.readyState === 3) return; socket.readyState = 3; sockets.delete(socket); socket.onclose?.({ code: 1008 }); },
      };
      sockets.add(socket);
      Promise.resolve().then(() => { if (!disposed && socket.readyState === 0) { socket.readyState = 1; socket.onopen?.(); } });
      return socket;
    },
    destroy() { disposed = true; sockets.forEach(socket => socket.close()); storage.clear(); settings.clear(); },
  };
}
