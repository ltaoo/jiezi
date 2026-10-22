import { rect_from_points, intersect_rect, collect_selected_nodes, selection_payload } from './node-selection.js';

export function create_node_picker({ stage, keyboard_root, get_preview, frame, on_select, on_mode }) {
  const document = stage.ownerDocument;
  const overlay = document.createElement('div'); overlay.dataset.n = 'node-picker-overlay'; overlay.className = 'node-picker-overlay'; overlay.setAttribute('aria-hidden', 'true');
  const box = document.createElement('div'); box.dataset.n = 'node-picker-box'; box.className = 'node-picker-box'; box.hidden = true; overlay.append(box); stage.append(overlay);
  let enabled = false, modifier = false, active = true, gesture = null, suppress_click = false, result = null, destroyed = false;
  const listeners = [];
  function listen(target, type, callback, options) { target.addEventListener(type, callback, options); listeners.push(() => target.removeEventListener(type, callback, options)); }
  function arm() { const armed = active && (enabled || modifier); stage.classList.toggle('picking-nodes', armed); get_preview()?.host.setAttribute('data-picking', String(armed)); on_mode?.(enabled); }
  function set_enabled(value) { enabled = Boolean(value); arm(); }
  function release() {
    if (gesture && stage.hasPointerCapture?.(gesture.pointer)) stage.releasePointerCapture(gesture.pointer);
    gesture = null;
  }
  function clear() { release(); result = null; box.hidden = true; on_select?.(null); }
  function draw(rect) {
    const origin = stage.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${rect.left - origin.left}px`; box.style.top = `${rect.top - origin.top}px`;
    box.style.width = `${rect.width}px`; box.style.height = `${rect.height}px`;
  }
  function point(event, clip) { return { x: Math.max(clip.left, Math.min(clip.right, event.clientX)), y: Math.max(clip.top, Math.min(clip.bottom, event.clientY)) }; }
  function prevent(event) { event.preventDefault(); event.stopImmediatePropagation(); }
  listen(stage, 'pointerdown', event => {
    if (!active || gesture || event.button !== 0 || !(enabled || event.altKey)) return;
    const preview = get_preview();
    if (!preview || preview.host.dataset.status !== 'mounted') return;
    const clip = intersect_rect(stage.getBoundingClientRect(), preview.host.getBoundingClientRect());
    if (!clip || event.clientX < clip.left || event.clientX > clip.right || event.clientY < clip.top || event.clientY > clip.bottom) return;
    prevent(event);
    gesture = { pointer: event.pointerId, first: point(event, clip), last: point(event, clip), clip };
    suppress_click = true;
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
    const rect = rect_from_points(gesture.first, point(event, gesture.clip));
    const viewport = gesture.clip;
    release();
    if (!preview || rect.width < 3 || rect.height < 3) { clear(); return; }
    const selected = collect_selected_nodes(preview.root, rect, viewport, { style_for: node => document.defaultView.getComputedStyle?.(node) });
    result = { elements: selected.elements, payload: selection_payload(frame, preview.root, preview.host, rect, selected) };
    draw(rect); on_select?.(result);
  }, true);
  listen(stage, 'pointercancel', event => { if (gesture?.pointer === event.pointerId) { prevent(event); clear(); } }, true);
  listen(stage, 'click', event => { if (suppress_click) { prevent(event); suppress_click = false; } }, true);
  listen(stage, 'pointerdown', () => { suppress_click = false; }, false);
  listen(keyboard_root, 'keydown', event => {
    if (!active) return;
    if (event.key === 'Alt') { modifier = true; arm(); }
    if (event.key === 'Escape' && (gesture || result || enabled)) { prevent(event); clear(); set_enabled(false); }
  }, true);
  listen(keyboard_root, 'keyup', event => { if (event.key === 'Alt') { modifier = false; arm(); } }, true);
  const clear_on_scroll = () => { if (result || gesture) clear(); };
  listen(stage, 'scroll', clear_on_scroll, true);
  if (get_preview()?.host.shadowRoot) listen(get_preview().host.shadowRoot, 'scroll', clear_on_scroll, true);
  listen(stage, 'wheel', event => { if (gesture) prevent(event); }, { capture: true, passive: false });
  listen(document.defaultView, 'blur', () => { modifier = false; if (gesture) clear(); arm(); });
  listen(document.defaultView, 'resize', clear_on_scroll);
  return {
    toggle() { set_enabled(!enabled); }, clear,
    set_active(value) { active = Boolean(value); if (!active) { clear(); set_enabled(false); modifier = false; } arm(); },
    destroy() { if (destroyed) return; destroyed = true; release(); listeners.forEach(remove => remove()); stage.classList.remove('picking-nodes'); get_preview()?.host.removeAttribute('data-picking'); overlay.remove(); result = null; },
  };
}
