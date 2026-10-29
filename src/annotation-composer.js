import { create_annotation_editor } from './annotation-editor.js';
import { normalize_references, parts_text } from './annotation.model.js';

export function create_annotation_composer({ document, window, get_orders = () => [], on_submit, on_cancel }) {
  function part(tag, name, class_name = '', text) {
    const node = document.createElement(tag); node.dataset.n = name;
    if (class_name) node.className = class_name;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(name, text, action, class_name = '') {
    const node = part('button', name, class_name, text); node.type = 'button'; node.addEventListener('click', action); return node;
  }
  const root = part('div', 'annotation-composer', 'annotation-composer');
  root.hidden = true;
  const head = part('div', 'annotation-composer-head', 'annotation-composer-head');
  const badge = part('span', 'annotation-composer-order', 'annotation-composer-order', '+');
  const label = part('span', 'annotation-composer-node', 'annotation-composer-node');
  head.append(badge, label, button('annotation-composer-close', '×', () => cancel(), 'annotation-composer-close'));
  const editor_mount = part('div', 'annotation-composer-editor', 'annotation-composer-editor');
  const hint = part('div', 'annotation-composer-hint', 'annotation-composer-hint', '⌘/Ctrl + Enter 确认 · @ 引用标注');
  const actions = part('div', 'annotation-composer-actions', 'annotation-actions');
  const cancel_button = button('annotation-composer-cancel', '取消', () => cancel(), 'annotation-composer-cancel');
  const submit_button = button('annotation-composer-submit', '标注', () => submit(), 'primary annotation-composer-submit');
  actions.append(cancel_button, submit_button);
  root.append(head, editor_mount, hint, actions);

  let editor = null;
  const state = { mode: 'create', node: null, order: null, rect: null };

  function label_for(node) {
    const name = node?.n || node?.tag || '节点';
    return node?.total > 1 ? `${name} · 选中 ${node.total} 个` : name;
  }
  function orders() { return (get_orders?.() || []).map(item => item.order); }
  function position(rect) {
    if (!rect) return;
    const innerWidth = window.innerWidth || 1024, innerHeight = window.innerHeight || 768;
    const width = root.offsetWidth || 340, height = root.offsetHeight || 168;
    let left = rect.left ?? 24;
    let top = (rect.bottom ?? 120) + 10;
    if (top + height > innerHeight - 8) top = (rect.top ?? 120) - height - 10;
    top = Math.max(8, top);
    left = Math.min(Math.max(8, left), Math.max(8, innerWidth - width - 8));
    root.style.left = `${left}px`; root.style.top = `${top}px`;
  }
  function render_head() {
    badge.textContent = state.mode === 'edit' ? `#${state.order}` : '+';
    label.textContent = label_for(state.node);
    label.title = state.node?.selector || '';
    submit_button.textContent = state.mode === 'edit' ? '保存' : '标注';
  }
  function open({ mode = 'create', node, order = null, rect = null, parts = [] } = {}) {
    state.mode = mode; state.node = node; state.order = order; state.rect = rect;
    root.hidden = false;
    render_head();
    editor?.destroy();
    editor_mount.replaceChildren();
    editor = create_annotation_editor({
      document, window, mount: editor_mount, get_orders,
      placeholder: mode === 'edit' ? '修改这条标注…' : '描述要修改的内容…（@ 引用其他标注）',
      initial: parts,
      on_submit: value => handle_submit(value),
      on_cancel: () => cancel(),
    });
    position(rect);
    editor.focus();
  }
  function handle_submit(value) {
    const parts = normalize_references(value, orders());
    if (!parts_text(parts).trim()) return;
    on_submit?.(parts, { mode: state.mode, order: state.order });
  }
  function submit() { if (editor) handle_submit(editor.parts()); }
  function close() {
    if (root.hidden) return;
    editor?.destroy(); editor = null;
    editor_mount.replaceChildren();
    root.hidden = true;
  }
  function cancel() { if (root.hidden) return; close(); on_cancel?.(); }
  function reposition(rect) {
    if (root.hidden) return;
    state.rect = rect || state.rect;
    position(state.rect);
  }
  return {
    root, state,
    open, close, cancel, submit, reposition,
    is_open() { return !root.hidden; },
    destroy() { close(); root.remove(); },
  };
}
