import { rect_from_points, intersect_rect, collect_selected_nodes, collect_clicked_node, NodeSelectionModel } from './node-selection.js';

export function create_node_picker({ stage, keyboard_root, get_preview, frame, on_select, on_mode, on_reveal }) {
  const document = stage.ownerDocument;
  const model = NodeSelectionModel(frame);
  const overlay = document.createElement('div'); overlay.dataset.n = 'node-picker-overlay'; overlay.className = 'node-picker-overlay';
  const box = document.createElement('div'); box.dataset.n = 'node-picker-box'; box.className = 'node-picker-box'; box.setAttribute('aria-hidden', 'true'); box.hidden = true;
  const controls = document.createElement('div'); controls.dataset.n = 'node-picker-controls'; controls.className = 'node-picker-controls'; controls.hidden = true; controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', '选择节点层级');
  function arrow(name, text, label, action) {
    const button = document.createElement('button'); button.dataset.n = name; button.type = 'button'; button.textContent = text; button.title = label; button.setAttribute('aria-label', label);
    listen(button, 'click', event => { prevent(event); action(); render_selection(); }); controls.append(button); return button;
  }
  let enabled = false, modifier = false, active = true, gesture = null, suppress_click = false, destroyed = false;
  const listeners = [];
  function listen(target, type, callback, options) { target.addEventListener(type, callback, options); listeners.push(() => target.removeEventListener(type, callback, options)); }
  const up = arrow('node-picker-parent', '↑', '选择父节点', () => model.select_parent());
  const down = arrow('node-picker-back', '↓', '退回刚才选中的节点', () => model.back());
  overlay.append(box, controls); stage.append(overlay);
  listen(controls, 'pointerdown', event => event.stopPropagation());
  function arm() { const armed = active && (enabled || modifier); stage.classList.toggle('picking-nodes', armed); get_preview()?.host.setAttribute('data-picking', String(armed)); on_mode?.(enabled); }
  function set_enabled(value) { enabled = Boolean(value); arm(); }
  function release() {
    if (gesture && stage.hasPointerCapture?.(gesture.pointer)) stage.releasePointerCapture(gesture.pointer);
    gesture = null;
  }
  function clear() { release(); model.clear(); render_selection(); }
  function draw(rect) {
    const origin = stage.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${rect.left - origin.left}px`; box.style.top = `${rect.top - origin.top}px`;
    box.style.width = `${rect.width}px`; box.style.height = `${rect.height}px`;
    controls.style.left = `${rect.left}px`; controls.style.top = `${rect.top}px`;
  }
  function render_highlight() {
    const current = model.state.current;
    box.hidden = !current?.rect; controls.hidden = !current?.rect || !current.result.elements.length;
    up.disabled = !model.can_parent(); down.disabled = !model.state.history.length;
    if (current?.rect) draw(current.rect);
  }
  function render_selection(location) {
    render_highlight(); on_select?.(model.state.current?.result || null, location);
  }
  function refresh() {
    if (gesture || !model.state.current) return;
    const preview = get_preview();
    model.refresh(preview ? intersect_rect(stage.getBoundingClientRect(), preview.host.getBoundingClientRect()) : null);
    render_highlight();
  }
  function point(event, clip) { return { x: Math.max(clip.left, Math.min(clip.right, event.clientX)), y: Math.max(clip.top, Math.min(clip.bottom, event.clientY)) }; }
  function prevent(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  listen(stage, 'pointerdown', event => {
    if (controls.contains(event.target)) return;
    if (!active || gesture || event.button !== 0 || !(enabled || event.altKey)) return;
    const preview = get_preview();
    if (!preview || preview.host.dataset.status !== 'mounted') return;
    const clip = intersect_rect(stage.getBoundingClientRect(), preview.host.getBoundingClientRect());
    if (!clip || event.clientX < clip.left || event.clientX > clip.right || event.clientY < clip.top || event.clientY > clip.bottom) return;
    prevent(event);
    gesture = { pointer: event.pointerId, first: point(event, clip), last: point(event, clip), clip, target: event.composedPath()[0] };
    suppress_click = true;
    controls.hidden = true;
    stage.setPointerCapture?.(event.pointerId);
    draw(rect_from_points(gesture.first, gesture.last));
  }, true);
  listen(stage, 'pointermove', event => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    prevent(event); gesture.last = point(event, gesture.clip); draw(rect_from_points(gesture.first, gesture.last));
  }, true);
  listen(stage, 'pointerup', event => {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    prevent(event);
    const preview = get_preview();
    let rect = rect_from_points(gesture.first, point(event, gesture.clip));
    const viewport = gesture.clip;
    const target = gesture.target;
    release();
    if (!preview) { clear(); return; }
    const options = { style_for: node => document.defaultView.getComputedStyle?.(node) };
    const clicked = rect.width < 3 && rect.height < 3;
    const selected = clicked
      ? collect_clicked_node(preview.root, target, { x: event.clientX, y: event.clientY }, viewport, options)
      : collect_selected_nodes(preview.root, rect, viewport, options);
    if (clicked) {
      if (!selected.elements.length) { clear(); return; }
      rect = intersect_rect(selected.elements[0].getBoundingClientRect(), viewport);
    }
    model.select(preview.root, preview.host, rect, selected, viewport); render_selection();
  }, true);
  listen(stage, 'pointercancel', event => { if (gesture?.pointer === event.pointerId) { prevent(event); clear(); } }, true);
  listen(stage, 'click', event => { if (!controls.contains(event.target) && suppress_click) { prevent(event); suppress_click = false; } }, true);
  listen(stage, 'pointerdown', () => { suppress_click = false; }, false);
  listen(keyboard_root, 'keydown', event => {
    if (event.target.closest?.('dialog[open]')) return;
    if (!active) return;
    if (event.key === 'Alt') { modifier = true; arm(); }
    if (event.key === 'Escape' && (gesture || model.state.current || enabled)) { prevent(event); clear(); set_enabled(false); }
  }, true);
  listen(keyboard_root, 'keyup', event => { if (event.key === 'Alt') { modifier = false; arm(); } }, true);
  const clear_on_scroll = () => { if (model.state.current || gesture) clear(); };
  listen(stage, 'scroll', clear_on_scroll, true);
  if (get_preview()?.host.shadowRoot) listen(get_preview().host.shadowRoot, 'scroll', clear_on_scroll, true);
  listen(stage, 'wheel', event => { if (gesture) prevent(event); }, { capture: true, passive: false });
  listen(document.defaultView, 'blur', () => { modifier = false; if (gesture) clear(); arm(); });
  listen(document.defaultView, 'resize', clear_on_scroll);
  return {
    toggle() { if (enabled) clear(); set_enabled(!enabled); }, clear, refresh,
    select_source(location) {
      const preview = get_preview();
      if (!active || destroyed || !preview || preview.host.dataset.status !== 'mounted') return false;
      const viewport = intersect_rect(stage.getBoundingClientRect(), preview.host.getBoundingClientRect());
      if (!model.select_source(preview.root, preview.host, location, viewport, { style_for: node => document.defaultView.getComputedStyle?.(node) })) return false;
      release(); render_selection(location); on_reveal?.(model.state.current.rect); refresh(); return true;
    },
    set_active(value) { active = Boolean(value); if (!active) { clear(); set_enabled(false); modifier = false; } arm(); },
    destroy() { if (destroyed) return; destroyed = true; release(); listeners.forEach(remove => remove()); stage.classList.remove('picking-nodes'); get_preview()?.host.removeAttribute('data-picking'); overlay.remove(); model.clear(); },
  };
}
