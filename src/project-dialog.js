export function create_project_dialog({ document, model, on_open }) {
  function part(tag, name, text) {
    const node = document.createElement(tag); node.dataset.n = name;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const dialog = part('dialog', 'project-dialog'); dialog.className = 'project-dialog'; dialog.setAttribute('aria-labelledby', 'project-dialog-title');
  const form = part('form', 'project-form'); form.className = 'project-form';
  const heading = part('h2', 'project-dialog-title', '打开项目'); heading.id = 'project-dialog-title';
  const description = part('p', 'project-dialog-description', '添加本机项目，之后可在顶部切换。'); description.className = 'muted';
  const adapter_label = part('label', 'project-adapter-label'); adapter_label.className = 'project-field';
  const adapter = part('select', 'project-adapter');
  for (const [value, title] of [['xiaoxunrss', '小讯 · Timeless'], ['findrss-admin', 'FindRSS 管理后台'], ['wx-channels', 'Download & Manage · 视频号下载'], ['demo', '原生 DOM 示例']]) {
    const option = part('option', 'project-adapter-option', title); option.value = value; adapter.append(option);
  }
  adapter_label.append(part('span', 'project-adapter-title', '项目类型'), adapter);
  const source_label = part('label', 'project-source-label'); source_label.className = 'project-field';
  const source = part('input', 'project-source'); source.type = 'text'; source.autocomplete = 'off'; source.spellcheck = false; source.setAttribute('aria-describedby', 'project-source-hint');
  source_label.append(part('span', 'project-source-title', '项目目录'), source);
  const hint = part('p', 'project-source-hint', '填写本机绝对路径，例如 /path/to/xiaoxunrss。'); hint.id = 'project-source-hint'; hint.className = 'muted';
  const status = part('p', 'project-open-status'); status.className = 'project-open-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const error = part('p', 'project-open-error'); error.className = 'project-open-error'; error.setAttribute('role', 'alert');
  const actions = part('div', 'project-dialog-actions'); actions.className = 'project-dialog-actions';
  const cancel = part('button', 'project-open-cancel', '取消'); cancel.type = 'button';
  const submit = part('button', 'project-open-submit', '打开项目'); submit.type = 'submit'; submit.className = 'primary';
  actions.append(cancel, submit); form.append(heading, description, adapter_label, source_label, hint, status, error, actions); dialog.append(form);
  function render() {
    const state = model.state;
    const refreshing = state.action === 'refresh';
    heading.textContent = refreshing ? '刷新画板' : state.action === 'switch' ? '切换项目' : '添加项目';
    description.textContent = refreshing ? '重新构建当前项目，完成后刷新画板。' : '添加本机项目，之后可在顶部切换。';
    adapter_label.hidden = refreshing; source_label.hidden = refreshing; hint.hidden = refreshing;
    if (state.visible && !dialog.open) dialog.showModal();
    else if (!state.visible && dialog.open) dialog.close();
    const busy = state.status === 'opening' || state.status === 'ready';
    adapter.value = state.adapter;
    if (source.value !== state.source) source.value = state.source;
    source.placeholder = state.adapter === 'demo' ? '留空使用内置示例' : '/path/to/xiaoxunrss'; source.required = !refreshing && state.adapter !== 'demo';
    adapter.disabled = busy; source.disabled = busy; submit.disabled = busy; cancel.disabled = busy;
    form.setAttribute('aria-busy', String(busy));
    status.textContent = state.status === 'opening' ? refreshing ? '正在重新构建当前项目，请稍候…' : '正在检查目录并构建预览，请稍候…' : state.opened ? `已${refreshing ? '刷新' : '打开'} ${state.opened.title}：${state.opened.pages} 个页面预览，${state.opened.components} 个组件预览。` : '';
    error.textContent = state.error; error.hidden = !state.error;
    source.setAttribute('aria-invalid', String(Boolean(state.error)));
    submit.textContent = refreshing ? state.status === 'opening' ? '正在刷新…' : '重试刷新' : state.status === 'opening' ? '正在打开…' : state.action === 'switch' ? '切换项目' : '添加并打开';
  }
  adapter.addEventListener('change', () => model.set_adapter(adapter.value));
  source.addEventListener('input', () => model.set_source(source.value));
  cancel.addEventListener('click', () => model.hide());
  dialog.addEventListener('cancel', event => { event.preventDefault(); model.hide(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) model.hide(); });
  dialog.addEventListener('close', () => { if (model.state.visible) model.hide(); });
  form.addEventListener('submit', async event => { event.preventDefault(); if (await model.open()) on_open(); });
  const unsubscribe = model.subscribe(render);
  render();
  return { dialog, destroy() { unsubscribe(); dialog.remove(); } };
}
