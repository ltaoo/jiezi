import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview_declarations } from '../../src/preview-declarations.mjs';

export const pages = [
  ['Overview', 'dashboard', 'OverviewPage', '运行概览', 'overview'],
  ['Devices', 'dashboard', 'DevicesPage', '设备管理', 'devices'],
  ['Tokens', 'dashboard', 'TokensPage', 'Token 管理', 'tokens'],
  ['Discovery', 'discovery', 'DiscoveryPage', '订阅源管理', 'discovery'],
  ['Scripts', 'script', 'ScriptPage', '脚本管理', 'scripts'],
  ['Clips', 'clips', 'ClipsPage', '区域剪藏', 'clips'],
  ['Cookies', 'cookies', 'CookiesPage', 'Cookie 管理', 'cookies'],
  ['Storage', 'storage', 'StoragePage', '存储', 'storage'],
  ['Tasks', 'tasks', 'TasksPage', '任务', 'tasks'],
  ['NetworkTest', 'network', 'NetworkTestPage', '网络测试', 'network'],
  ['Messages', 'messages', 'MessagesPage', '消息', 'messages'],
  ['Users', 'users', 'UsersPage', '用户管理', 'users'],
  ['Activity', 'activity', 'UserActivityPage', '用户日志', 'activity'],
  ['Redemptions', 'redemptions', 'RedemptionCardsPage', '兑换卡管理', 'redemptions'],
  ['LoadTest', 'loadtest', 'LoadTestPage', '并发请求', 'loadtest'],
  ['Settings', 'settings', 'SettingsPage', '设置', 'settings'],
  ['SettingsDeviceTokens', 'settings/device-tokens', 'SettingsDeviceTokensPage', '设备 Token', 'settings.device_tokens'],
  ['SettingsMcpTokens', 'settings/mcp-tokens', 'SettingsMcpTokensPage', 'MCP 授权', 'settings.mcp_tokens'],
  ['SettingsCookies', 'settings/cookies', 'SettingsCookiesPage', 'Cookie 解密', 'settings.cookies'],
  ['SettingsWebhook', 'settings/webhook', 'SettingsWebhookPage', 'Webhook 消息推送', 'settings.webhook'],
  ['SettingsSnapshots', 'settings/snapshots', 'SettingsSnapshotsPage', '订阅源抓取', 'settings.snapshots'],
  ['SettingsModels', 'settings/models', 'SettingsModelsPage', '大模型', 'settings.models'],
  ['SettingsAbout', 'settings/about', 'SettingsAboutPage', '关于', 'settings.about'],
  ['Login', 'login', 'LoginView', '登录', 'login'],
];

export const components = [
  ['button', 'Button', "[UI.Button({ variant: 'primary', attributes: { n: 'preview-primary-button' } }, ['添加订阅']), UI.Button({ disabled: true, attributes: { n: 'preview-disabled-button' } }, ['不可用'])]"],
  ['input', 'Input', "UI.Input({ value: Timeless.ref('示例名称'), attributes: { n: 'preview-input', 'aria-label': '示例名称' } })"],
  ['textarea', 'Textarea', "UI.Textarea({ value: Timeless.ref('在这里输入说明'), attributes: { n: 'preview-textarea', 'aria-label': '说明' } })"],
  ['select', 'Select', "UI.Select({ value: Timeless.ref('all'), options: [{ value: 'all', label: '全部状态' }, { value: 'enabled', label: '已启用' }], attributes: { n: 'preview-select', 'aria-label': '状态' } })"],
  ['checkbox', 'Checkbox', "PreviewCheckbox({ checked: Timeless.ref(true), attributes: { n: 'preview-checkbox', 'aria-label': '启用订阅' } })"],
  ['switch', 'Switch', "UI.Switch({ checked: Timeless.ref(true), attributes: { n: 'preview-switch', 'aria-label': '自动刷新' } })"],
  ['badge', 'Badge', "['success', 'danger', 'neutral'].map(tone => UI.Badge({ tone, attributes: { n: 'preview-badge-' + tone } }, [tone]))"],
  ['card', 'Card', "UI.Card({ title: '订阅源', attributes: { n: 'preview-card' } }, ['示例订阅源内容'])"],
  ['field', 'Field', "UI.Field({ label: '名称', attributes: { n: 'preview-field' } }, [UI.Input({ attributes: { n: 'preview-field-input', 'aria-label': '名称' }, value: Timeless.ref('FindRSS') })])"],
  ['icon-button', 'IconButton', "PreviewIconButton({ icon: 'plus', label: '添加', attributes: { n: 'preview-icon-button' } })"],
  ['dialog', 'Dialog', "UI.Dialog({ open: Timeless.ref(true), title: '订阅设置', attributes: { n: 'preview-dialog' } }, ['这是一个独立的对话框预览。'])"],
  ['page-header', 'PageHeader', "UI.PageHeader({ title: '订阅源管理', attributes: { n: 'preview-page-header' } })"],
  ['empty', 'EmptyCard', "UI.EmptyCard({ name: 'preview-empty', title: '暂无订阅源', description: '添加第一个订阅源开始使用。' })"],
];

async function frame_files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.filter(entry => !['node_modules', '.git', 'dist'].includes(entry.name)).map(entry =>
    entry.isDirectory() ? frame_files(join(directory, entry.name)) : entry.isFile() && entry.name.endsWith('.frame') ? [join(directory, entry.name)] : [],
  ))).flat().sort();
}

export async function collect_admin_catalog(source_root) {
  const routes = new Map(pages.map(page => [`pages/${page[4].replaceAll('.', '/').replaceAll('_', '-')}.frame`, page]));
  const frame_entries = (await Promise.all((await frame_files(source_root)).map(async path => {
    const file = relative(source_root, path).split('\\').join('/');
    const [key, , exported, , route_name] = routes.get(file) || [file];
    const source = await readFile(join(source_root, file), 'utf8');
    let declarations;
    try { declarations = preview_declarations(source); }
    catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
    return declarations.map(declaration => ({
      ...declaration, key, module: file, file, source, exported, route_name,
      kind: file.startsWith('pages/') && !declaration.path.includes('/components/') ? 'page' : 'component',
      route: route_name ? `/admin/${route_name.replaceAll('.', '/').replaceAll('_', '-')}` : undefined,
    }));
  }))).flat();
  const component_entries = await Promise.all(components.map(async ([key, exported]) => {
    const module = key === 'empty' ? 'components/illustration-card.js' : `components/frui/${key}.js`;
    return { key, exported, module, file: module, source: await readFile(join(source_root, module), 'utf8'), name: exported, kind: 'component', path: `/frui/${key}/1` };
  }));
  const paths = new Set();
  return [...frame_entries, ...component_entries].map(entry => {
    if (paths.has(entry.path)) throw new Error(`${entry.file}: 重复 path：${entry.path}`);
    paths.add(entry.path);
    return { ...entry, id: entry.path, title: entry.name, preview: 'direct', width: entry.width || 600, height: entry.height || 420, layout: entry.height || entry.kind === 'page' ? 'fill' : 'content', notes: ['页面使用独立示例数据；设置修改仅保存在本 Frame，未提供的交互会提示。'] };
  });
}

export function admin_entry(catalog) {
  const files = [...new Set(catalog.filter(frame => frame.file.endsWith('.frame')).map(frame => frame.file))];
  return `import '@admin/components/ui.js';
import '@admin/components/shell.js';
import { render_preview_page } from ${JSON.stringify(fileURLToPath(new URL('./page.js', import.meta.url)))};
import { Checkbox as PreviewCheckbox } from '@admin/components/frui/checkbox.js';
import { IconButton as PreviewIconButton } from '@admin/components/frui/icon-button.js';
${files.map((file, index) => `import * as Preview${index} from ${JSON.stringify('@admin/' + file)};`).join('\n')}
const UI = window.FindRSSAdminUI;
const previews = { ${files.map((file, index) => `${JSON.stringify(file)}: Preview${index}._Preview ?? Preview${index}._Previews`).join(', ')} };
export function render(frame) {
  if (frame.kind === 'component' && frame.preview_index === undefined) {
    const renderers = { ${components.map(([key, , expression]) => `${JSON.stringify(key)}: () => (${expression})`).join(',\n')} };
    const content = renderers[frame.key]?.();
    if (!content) throw new Error('组件预览已变化，请刷新画布');
    return UI.View({ class: 'flex flex-wrap gap-space-3', attributes: { n: 'admin-component-preview' } }, Array.isArray(content) ? content : [content]);
  }
  const preview = previews[frame.file]?.[frame.preview_index];
  if (!preview || preview.path !== frame.path) throw new Error('页面预览已变化，请刷新画布');
  const content = preview.render();
  return typeof content === 'function' ? frame.route_name && frame.route_name !== 'login' ? render_preview_page(content, frame.route_name) : content() : content;
}
`;
}
