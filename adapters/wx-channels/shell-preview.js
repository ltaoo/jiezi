import ShellLayoutView from '@wx/src/pages/shell.js';
import { ShellViewModel } from '@wx/src/pages/shell.model.js';
import { SettingsDialog, CertificateSettingsDetails, MCPSettingsDetails, AboutSettingsDetails } from '@wx/src/pages/shell.components.js';

export function render_shell_preview(frame, props) {
  if (frame.key === 'shell-layout') return ShellLayoutView(props);
  const model = ShellViewModel(props);
  model.methods.loadCertificate();
  model.models.mcp.methods.load();
  const content_props = {
    tip: props.tip,
    dialog: model.ui.settings_dialog$,
    section: model.state.settings_section,
    version: model.state.version,
    certificate: model.state.certificate,
    loading: model.state.certificate_loading,
    error: model.state.certificate_error,
    certificate_menu_button: model.ui.certificate_menu_button$,
    mcp_menu_button: model.ui.mcp_menu_button$,
    about_menu_button: model.ui.about_menu_button$,
    mcp_model: model.models.mcp,
    mcp_refresh_button: model.models.mcp.ui.refresh_button$,
    refresh_button: model.ui.refresh_certificate_button$,
    retry_button: model.ui.retry_certificate_button$,
    delete_button: model.ui.delete_certificate_button$,
  };
  if (frame.key === 'settings-dialog') model.ui.settings_dialog$.show();
  const content = {
    'settings-dialog': () => SettingsDialog(content_props),
    'settings-certificate': () => CertificateSettingsDetails(content_props),
    'settings-mcp': () => MCPSettingsDetails({ model: model.models.mcp }),
    'settings-about': () => AboutSettingsDetails(content_props),
  };
  try {
    return View({
      class: 'min-w-0 min-h-0 h-full overflow-auto bg-color-bg-canvas text-color-text-primary',
      attributes: { n: frame.key + '-preview' },
      onUnmounted() { model.methods.destroy(); },
    }, [content[frame.key]()]);
  } catch (error) { model.methods.destroy(); throw error; }
}
