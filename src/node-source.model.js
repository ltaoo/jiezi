export function NodeSourceModel(project_uid, request = globalThis.fetch) {
  const state = { location: null, status: 'idle', lines: [], error: '', expanded: false };
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  let sources;
  return {
    state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    show_full(value) { state.expanded = Boolean(value) && state.status === 'ready'; notify(); },
    report_no_match() { state.error = '此行没有对应的已挂载节点'; notify(); },
    async select(payload, source_location) {
      const location = source_location || (payload?.total > 1 ? payload.parent?.source : payload?.nodes[0]?.source);
      if (source_location && state.status === 'ready' && state.location.file === location.file && Number.isSafeInteger(location.line) && state.lines[location.line - 1]) {
        state.location = location; state.error = ''; state.expanded = false;
        for (const line of state.lines) line.selected = line.number === location.line;
        notify(); return;
      }
      state.location = location || null; state.lines = []; state.error = ''; state.expanded = false; state.status = location ? 'loading' : 'idle'; notify();
      if (!location) return;
      try {
        sources ||= request('/sources.json').then(async response => {
          if (!response.ok) throw new Error('无法加载源码，请刷新画板重新构建');
          const data = await response.json();
          if (data.uid !== project_uid) throw new Error('源码与当前项目不一致，请刷新画板');
          return data.files;
        }).catch(error => { sources = null; throw error; });
        const files = await sources;
        if (state.location !== location) return;
        if (!Object.hasOwn(files, location.file) || typeof files[location.file] !== 'string') throw new Error('构建中未记录此文件的源码');
        const lines = files[location.file].split(/\r\n|\n|\r/);
        if (!Number.isSafeInteger(location.line) || location.line < 1 || location.line > lines.length) throw new Error('源码行号超出文件范围');
        state.lines = lines.map((text, index) => ({ number: index + 1, text, selected: index + 1 === location.line }));
        state.status = 'ready';
      } catch (error) {
        if (state.location !== location) return;
        state.error = error.message; state.status = 'error';
      }
      notify();
    },
  };
}
