import { Schema } from 'prosemirror-model';
import { EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { history } from 'prosemirror-history';
import { parts_text } from './annotation.model.js';

export const annotation_schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    ref: {
      group: 'inline', inline: true, atom: true, attrs: { order: {} },
      parseDOM: [{ tag: 'span.annotation-ref', getAttrs: dom => ({ order: Number(dom.getAttribute('data-ref-order')) }) }],
      toDOM: node => ['span', { class: 'annotation-ref', 'data-ref-order': String(node.attrs.order) }, `#${node.attrs.order}`],
    },
  },
});

export function doc_from_parts(parts = []) {
  const paragraphs = [];
  let inline = [];
  const flush = () => { if (inline.length) { paragraphs.push(annotation_schema.node('paragraph', null, inline)); inline = []; } };
  for (const part of parts) {
    if (part.type === 'ref') { inline.push(annotation_schema.node('ref', { order: part.order })); continue; }
    const lines = (part.text || '').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (index > 0) flush();
      if (line) inline.push(annotation_schema.text(line));
    });
  }
  flush();
  // 至少保留一个段落，空文档也允许光标和占位提示。
  if (!paragraphs.length) paragraphs.push(annotation_schema.node('paragraph'));
  return annotation_schema.node('doc', null, paragraphs);
}

export function parts_from_doc(doc) {
  const parts = [];
  doc.forEach((paragraph, offset, index) => {
    if (index > 0) parts.push({ type: 'text', text: '\n' });
    paragraph.forEach(child => {
      if (child.isText) parts.push({ type: 'text', text: child.text });
      else if (child.type.name === 'ref') parts.push({ type: 'ref', order: child.attrs.order });
    });
  });
  return merge_text(parts);
}

function merge_text(parts) {
  const result = [];
  for (const part of parts) {
    if (part.type === 'text') {
      if (!part.text) continue;
      const previous = result.at(-1);
      if (previous?.type === 'text') previous.text += part.text;
      else result.push({ type: 'text', text: part.text });
    } else {
      result.push(part);
    }
  }
  return result;
}

function has_capability(window) {
  return typeof window?.getSelection === 'function' && typeof window?.Element?.prototype?.getClientRects === 'function';
}

export function create_annotation_editor(options) {
  const { document, window, mount, placeholder = '', get_orders = () => [], initial = [], on_submit, on_cancel } = options;
  if (!has_capability(window)) return create_textarea_editor({ document, mount, placeholder, initial, on_submit, on_cancel });
  return create_prose_editor({ document, window, mount, placeholder, get_orders, initial, on_submit, on_cancel });
}

function create_textarea_editor({ document, mount, placeholder, initial, on_submit, on_cancel }) {
  const textarea = document.createElement('textarea');
  textarea.dataset.n = 'annotation-input'; textarea.className = 'annotation-input';
  textarea.rows = 1; textarea.placeholder = placeholder;
  textarea.value = parts_text(initial);
  textarea.setAttribute('aria-label', placeholder || '标注内容');
  function parts() { return textarea.value ? [{ type: 'text', text: textarea.value }] : []; }
  function on_key(event) {
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === 'Enter' && mod) { event.preventDefault(); event.stopPropagation(); on_submit?.(parts()); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); on_cancel?.(); }
  }
  textarea.addEventListener('keydown', on_key);
  mount.append(textarea);
  return {
    mode: 'textarea', parts,
    focus() { textarea.focus(); },
    destroy() { textarea.removeEventListener('keydown', on_key); textarea.remove(); },
  };
}

function create_prose_editor({ document, window, mount, placeholder, get_orders, initial, on_submit, on_cancel }) {
  let menu = null, menu_items = [], menu_index = 0;
  const list_orders = () => (get_orders?.() || []).filter(item => Number.isSafeInteger(item?.order));

  function close_menu() { if (menu) { menu.remove(); menu = null; menu_items = []; } }
  function render_menu() {
    if (!menu) return;
    [...menu.children].forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === menu_index));
      option.classList.toggle('active', index === menu_index);
    });
  }
  function choose(index) {
    const item = menu_items[index];
    if (!item) return;
    close_menu();
    const node = annotation_schema.nodes.ref.create({ order: item.order });
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  }
  function open_menu(from) {
    const items = list_orders();
    if (!items.length) return false;
    close_menu();
    menu_items = items; menu_index = 0;
    let coords = { left: 24, top: 120, bottom: 140 };
    try { coords = view.coordsAtPos(from); } catch { /* 无布局信息时退回固定位置。 */ }
    menu = document.createElement('div');
    menu.dataset.n = 'annotation-ref-menu'; menu.className = 'annotation-ref-menu'; menu.setAttribute('role', 'listbox');
    menu.style.left = `${coords.left}px`; menu.style.top = `${coords.bottom + 4}px`;
    items.forEach((item, index) => {
      const option = document.createElement('button');
      option.type = 'button'; option.dataset.n = 'annotation-ref-option'; option.dataset.order = String(item.order);
      option.className = 'annotation-ref-option'; option.setAttribute('role', 'option');
      option.textContent = `#${item.order} · ${item.label || '节点'}`;
      option.addEventListener('mousedown', event => { event.preventDefault(); choose(index); });
      option.addEventListener('mouseenter', () => { menu_index = index; render_menu(); });
      menu.append(option);
    });
    document.body.append(menu);
    render_menu();
    return true;
  }
  function insert_order(order) {
    if (!list_orders().some(item => item.order === order)) return false;
    close_menu();
    view.dispatch(view.state.tr.replaceSelectionWith(annotation_schema.nodes.ref.create({ order })).scrollIntoView());
    return true;
  }

  const interaction = new Plugin({
    props: {
      handleKeyDown(active, event) {
        const mod = event.metaKey || event.ctrlKey;
        if (menu) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            menu_index = (menu_index + (event.key === 'ArrowDown' ? 1 : -1) + menu_items.length) % menu_items.length;
            render_menu(); return true;
          }
          if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); choose(menu_index); return true; }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close_menu(); return true; }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Backspace' || event.key === 'Delete') close_menu();
        }
        if (event.key === 'Enter' && mod) { event.preventDefault(); event.stopPropagation(); on_submit?.(parts_from_doc(active.state.doc)); return true; }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); on_cancel?.(); return true; }
        if (mod && event.altKey && /^[1-9]$/.test(event.key)) { if (insert_order(Number(event.key))) { event.preventDefault(); event.stopPropagation(); return true; } }
        return false;
      },
      handleTextInput(active, from, to, text) {
        if (text !== '@') { if (menu) close_menu(); return false; }
        return open_menu(from);
      },
    },
  });

  // 占位提示放在可编辑区域之外，避免伪元素进入 contenteditable 后被当成内容而无法编辑。
  const empty_doc = doc => doc.childCount === 1 && doc.firstChild.type.name === 'paragraph' && doc.firstChild.content.size === 0;
  const placeholder_el = document.createElement('div');
  placeholder_el.dataset.n = 'annotation-placeholder'; placeholder_el.className = 'annotation-editor-placeholder';
  placeholder_el.textContent = placeholder; placeholder_el.setAttribute('aria-hidden', 'true');

  const view = new EditorView(mount, {
    state: EditorState.create({ doc: doc_from_parts(initial), plugins: [interaction, history(), keymap(baseKeymap)] }),
    dispatchTransaction(transaction) { this.updateState(this.state.apply(transaction)); sync_placeholder(); },
  });
  mount.append(placeholder_el);
  function sync_placeholder() { placeholder_el.hidden = !placeholder || !empty_doc(view.state.doc); }
  sync_placeholder();
  let destroyed = false;

  return {
    mode: 'prosemirror',
    parts() { return parts_from_doc(view.state.doc); },
    focus() { view.focus(); },
    destroy() { if (destroyed) return; destroyed = true; close_menu(); view.destroy(); placeholder_el.remove(); },
  };
}
