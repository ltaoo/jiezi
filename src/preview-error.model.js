export function PreviewErrorModel(frame, error, write) {
  const state = {
    text: `页面渲染失败：${error?.message ?? String(error)}\n\n${frame.file || frame.path || frame.id}${error?.stack ? `\n\n${error.stack}` : ''}`,
    copying: false, feedback: '',
  };
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  return {
    state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async copy() {
      if (state.copying) return;
      state.copying = true; state.feedback = ''; notify();
      try { await write(state.text); state.feedback = '已复制错误'; }
      catch { state.feedback = '复制失败，请手动选中错误信息复制。'; }
      state.copying = false; notify();
    },
  };
}
