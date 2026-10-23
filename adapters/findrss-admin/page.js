import { create_admin_routing, navigation } from '@admin/store.js';
import { OverviewPage as Overview } from '@admin/pages/dashboard.js';
import { DevicesPage as Devices } from '@admin/pages/dashboard.js';
import { TokensPage as Tokens } from '@admin/pages/dashboard.js';
import { DiscoveryPage as Discovery } from '@admin/pages/discovery.js';
import { ScriptPage as Scripts } from '@admin/pages/script.js';
import { ClipsPage as Clips } from '@admin/pages/clips.js';
import { CookiesPage as Cookies } from '@admin/pages/cookies.js';
import { StoragePage as Storage } from '@admin/pages/storage.js';
import { TasksPage as Tasks } from '@admin/pages/tasks.js';
import { NetworkTestPage as NetworkTest } from '@admin/pages/network.js';
import { MessagesPage as Messages } from '@admin/pages/messages.js';
import { UsersPage as Users } from '@admin/pages/users.js';
import { UserActivityPage as Activity } from '@admin/pages/activity.js';
import { RedemptionCardsPage as Redemptions } from '@admin/pages/redemptions.js';
import { LoadTestPage as LoadTest } from '@admin/pages/loadtest.js';
import { SettingsPage as Settings } from '@admin/pages/settings.js';
import { SettingsDeviceTokensPage as SettingsDeviceTokens } from '@admin/pages/settings/device-tokens.js';
import { SettingsMcpTokensPage as SettingsMcpTokens } from '@admin/pages/settings/mcp-tokens.js';
import { SettingsCookiesPage as SettingsCookies } from '@admin/pages/settings/cookies.js';
import { SettingsWebhookPage as SettingsWebhook } from '@admin/pages/settings/webhook.js';
import { SettingsSnapshotsPage as SettingsSnapshots } from '@admin/pages/settings/snapshots.js';
import { SettingsModelsPage as SettingsModels } from '@admin/pages/settings/models.js';
import { SettingsAboutPage as SettingsAbout } from '@admin/pages/settings/about.js';

const pages = { Overview, Devices, Tokens, Discovery, Scripts, Clips, Cookies, Storage, Tasks, NetworkTest, Messages, Users, Activity, Redemptions, LoadTest, Settings, SettingsDeviceTokens, SettingsMcpTokens, SettingsCookies, SettingsWebhook, SettingsSnapshots, SettingsModels, SettingsAbout };

export function render_preview_page(Page, route_name) {
  const UI = window.FindRSSAdminUI;
  const routing = create_admin_routing(kit, { ...pages, Layout: () => UI.View({ attributes: { n: 'preview-route-layout' } }) });
  routing.history.push('root.admin.' + route_name, {}, { ignore: true });
  const view = routing.history.views['root.admin.' + route_name];
  window.preview_routing = routing;
  return Page({ view, history: routing.history, views: routing.views, app: { navigation }, client: {}, storage: {}, hlsPlayer: {} });
}
