// 点击保留原生目标；只有超过移动阈值才捕获指针并启动画布拖动。
export function create_canvas_drag(workspace, { get_view, on_change, on_frame_drop, on_end, threshold = 6 }) {
  const window = workspace.ownerDocument.defaultView;
  let gesture = null, suppress_click = false;
  const listeners = [];
  function listen(target, type, callback, options) { target.addEventListener(type, callback, options); listeners.push(() => target.removeEventListener(type, callback, options)); }
  function release() {
    const pointer = gesture?.pointer;
    const moved = gesture?.moved;
    gesture = null;
    workspace.classList.remove('dragging');
    if (pointer !== undefined && workspace.hasPointerCapture?.(pointer)) workspace.releasePointerCapture(pointer);
    if (moved) on_end?.();
  }
  function cancel() {
    if (gesture?.moved) {
      if (gesture.type === 'frame') { gesture.frame.x = gesture.x; gesture.frame.y = gesture.y; }
      else { get_view().x = gesture.x; get_view().y = gesture.y; }
      on_change(gesture.type === 'frame' ? gesture.frame : undefined);
    }
    release();
  }
  listen(window, 'pointerdown', () => { suppress_click = false; }, true);
  listen(window, 'pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const dx = event.clientX - gesture.start_x, dy = event.clientY - gesture.start_y;
    if (!gesture.moved && Math.hypot(dx, dy) < threshold) return;
    if (!gesture.moved) { gesture.moved = true; workspace.setPointerCapture?.(event.pointerId); workspace.classList.add('dragging'); }
    event.preventDefault();
    if (gesture.type === 'pan') { get_view().x = gesture.x + dx; get_view().y = gesture.y + dy; }
    else { gesture.frame.x = gesture.x + dx / get_view().scale; gesture.frame.y = gesture.y + dy / get_view().scale; }
    on_change(gesture.type === 'frame' ? gesture.frame : undefined);
  }, { passive: false });
  listen(window, 'pointerup', event => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    if (gesture.moved) {
      suppress_click = true;
      event.preventDefault();
      if (gesture.type === 'frame') on_frame_drop();
    }
    release();
  });
  listen(window, 'pointercancel', event => { if (event.pointerId === gesture?.pointer) cancel(); });
  listen(workspace, 'lostpointercapture', event => { if (event.pointerId === gesture?.pointer) cancel(); });
  listen(window, 'blur', cancel);
  listen(workspace, 'click', event => { if (suppress_click) { event.preventDefault(); event.stopImmediatePropagation(); suppress_click = false; } }, true);
  return {
    get active() { return Boolean(gesture?.moved); },
    start(event, data) {
      if (gesture) return;
      gesture = { ...data, pointer: event.pointerId, start_x: event.clientX, start_y: event.clientY, moved: false };
      // 不 preventDefault、不 setPointerCapture：保留标题的 click / dblclick。
    },
    destroy() { cancel(); listeners.forEach(remove => remove()); },
  };
}
