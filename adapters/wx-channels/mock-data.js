export function mock_data() {
  const timestamp = 1792548000;
  const cover = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#dbeafe"/><circle cx="490" cy="90" r="42" fill="#fbbf24"/><path d="M0 360 230 90 430 360M250 360 470 160 640 360" fill="#3b8277"/><text x="32" y="320" fill="white" font-size="28">Mock · 山野漫游</text></svg>');
  const accounts = [
    { id: 'mock-account', platform_id: 'wxchannels', external_id: 'mock-travel', nickname: 'Mock · 山野记录者', avatar_url: cover, content_count: 24, created_at: timestamp },
    { id: 'mock-account-2', platform_id: 'bilibili', external_id: 'mock-life', nickname: 'Mock · 生活实验室', avatar_url: cover, content_count: 12, created_at: timestamp },
  ];
  const contents = [
    { id: 'mock-content', title: 'Mock · 山野漫游', description: '沿着山间小路，记录秋日的光影与风声。', platform_id: 'wxchannels', content_type: 'image', url: 'https://example.invalid/mock/travel', cover_url: cover, accounts: [accounts[0]], tags: [{ id: 1, name: '旅行' }, { id: 2, name: '秋日' }], publish_time: timestamp, file_count: 1 },
    { id: 'mock-content-2', title: 'Mock · 城市慢生活', description: '周末街角的咖啡与阅读时光。', platform_id: 'bilibili', content_type: 'video', url: 'https://example.invalid/mock/city', cover_url: cover, accounts: [accounts[1]], tags: [{ id: 3, name: '生活' }], publish_time: timestamp - 86400, file_count: 1 },
  ];
  const file = { id: 'mock-file', task_id: 'mock-task', name: 'Mock · 山野漫游.svg', file_type: 'image', mime_type: 'image/svg+xml', file_url: cover, local_path: '/mock/山野漫游.svg', size: 4096, status: 'done', progress: 100, exists: true };
  const tasks = ['done', 'running', 'pause', 'error'].map((status, index) => ({ id: index ? `mock-task-${index}` : 'mock-task', name: ['Mock · 山野漫游', 'Mock · 城市慢生活', 'Mock · 周末影集', 'Mock · 等待重试'][index], status, content: contents[index % contents.length], files: [file], progress: index ? 45 : 100, downloaded: index ? 4500000 : 10000000, size: 10000000, speed: status === 'running' ? 1024000 : 0, created_at: timestamp - index * 3600, error: status === 'error' ? '示例资源暂时不可用' : '' }));
  const flow = { id: 'mock-flow', name: 'Mock · 每日内容归档', description: '每天整理新内容并归档到本地资料库。', created_at: timestamp, updated_at: timestamp, definition: { start_node: 'start', context_schema: [], nodes: { start: { id: 'start', name: '开始归档', type: 'StartNode', next_node_ids: ['finish'], config: {} }, finish: { id: 'finish', name: '归档完成', type: 'EndNode', next_node_ids: [], config: {} } } } };
  const list = records => ({ list: records, total: records.length, page: 1, page_size: 20 });
  return {
    'GET /api/account/list': list(accounts),
    'GET /api/account/feed/content/list': { ...list(contents), account: accounts[0], tabs: [{ value: 'feed', label: '作品' }] },
    'GET /api/content/list': list(contents),
    'GET /api/content/detail': { ...contents[0], resources: [file], download_tasks: [tasks[0]] },
    'POST /api/browse_history/list': list(contents.map((content, index) => ({ ...content, visited_times: 3 + index, updated_at: timestamp - index * 600 }))),
    'GET /api/v1/download_task/list': { ...list(tasks), stats: { total: 4, done: 1, running: 1, pause: 1, error: 1, waiting: 0 } },
    'GET /api/v1/download_task/detail': tasks[0],
    'POST /api/v1/download_task/check_files': { files: [{ ...file, checked: true }] },
    'POST /api/v1/automation/list_flows': list([flow]),
    'POST /api/v1/automation/get_flow': flow,
    'POST /api/v1/automation/list_flow_nodes': { nodes: [{ type: 'StartNode', name: '开始', config_schema: [], input_schema: [], output_schema: [] }, { type: 'EndNode', name: '结束', config_schema: [], input_schema: [], output_schema: [] }] },
    'POST /api/v1/automation/list_schedules': list([{ id: 'mock-schedule', flow_id: flow.id, name: '每日归档', cron_expr: '0 9 * * *', enabled: true, next_run_at: timestamp + 86400, initial_data: '{}' }]),
    'POST /api/v1/automation/list_runs': list([{ id: 'mock-run', flow_id: flow.id, status: 'SUCCESS', started_at: timestamp, finished_at: timestamp + 12, duration_ms: 12000 }]),
    'GET /api/logs': { ...list([{ index: 1, level: 'info', time: '2026-10-21T09:00:00+08:00', component: 'downloader', message: 'Mock · 下载任务已完成' }, { index: 2, level: 'warn', time: '2026-10-21T09:01:00+08:00', component: 'scraper', message: 'Mock · 请求超时，等待重试' }]), files: [] },
    'GET /api/v1/sync/servers': { servers: [{ id: 1, name: 'Mock · 家庭资料库', url: 'https://preview.invalid' }] },
    'GET /api/status': { version: '1.0.0-preview', api: { status: 'running' }, proxy: { status: 'running' }, channels: { available: true } },
    'GET /api/update/check': { status: 'idle', available: false, current_version: '1.0.0-preview', latest_version: '1.0.0-preview' },
    'GET /api/proxy/certificate/status': { name: 'Mock · Download & Manage Root CA', source: 'generated', installed: true, trusted: true, risk_warnings: [], configured: { name: 'Mock · 本机预览证书', file: '/mock/certificate.crt', key: '/mock/certificate.key' }, detail: { subject_common_name: 'D&M Preview Root CA', issuer_common_name: 'D&M Preview Root CA', organizations: ['Download & Manage Preview'], serial_number: '01:23:45:67:89:AB:CD:EF', is_ca: true, not_before: 1767225600, not_after: 2082758400, expired: false, fingerprint_sha256: '12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF' } },
    'GET /api/mcp/status': { enabled: true, endpoint: 'http://127.0.0.1:2022/mcp', tools: ['get_platform_status', 'fetch_content', 'download_content'] },
    'GET /api/filehelper/status': { logged_in: true },
    'GET /api/filehelper/synccheck': { status: 'hasMsg' },
    'GET /api/filehelper/sync': { BaseResponse: { Ret: 0 }, AddMsgList: [{ MsgId: 'mock-message', MsgType: 1, FromUserName: 'filehelper', Content: 'Mock · 旅途中的照片已收到，可以开始整理。', CreateTime: timestamp }] },
    'GET /api/scraper/job': { id: 'mock-job', url: contents[0].url, platform: 'wxchannels', status: 'completed', progress: { percent: 100, stage: 'finished' }, output: { job_id: 'mock-job', platform: 'wxchannels', url: contents[0].url, content: contents[0], account: accounts[0], content_details: [{ type: 'image', detail: { image_count: 1 }, content_id: contents[0].id }], cache_entries: [], raw_result: { title: contents[0].title } } },
  };
}
