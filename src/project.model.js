import { project_url, read_project_route } from './project-route.js';

export function ProjectModel(current, request = globalThis.fetch) {
  const state = { visible: false, action: 'add', adapter: current.id === 'demo' ? 'xiaoxunrss' : current.id, source: current.id === 'demo' ? '' : current.source || '', status: 'idle', error: '', opened: null, target_id: null, projects: [{ id: current.uid, adapter: current.id, title: current.title || current.id, source: current.source || '' }] };
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  return {
    state,
    project_key(project) { return project.id; },
    current_key: current.uid,
    opened_url() { return project_url(state.opened.id); },
    matches_route(url) { const route = read_project_route(url); return !route || route.project_id === current.uid; },
    async load_projects() {
      try {
        const response = await request('/__jiezi/project');
        if (!response.ok) return;
        const result = await response.json();
        if (Array.isArray(result.projects)) { state.projects = result.projects; notify(); }
      } catch { /* 静态产物仍可浏览当前项目。 */ }
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    show() { if (state.status === 'opening') return; state.action = 'add'; state.visible = true; notify(); },
    hide() { if (state.status === 'opening') return; state.visible = false; notify(); },
    set_adapter(value) { if (state.status === 'opening') return; state.adapter = value; state.target_id = null; state.error = ''; state.opened = null; state.status = 'idle'; notify(); },
    set_source(value) { if (state.status === 'opening') return; state.source = value; state.target_id = null; state.error = ''; state.opened = null; state.status = 'idle'; notify(); },
    async switch_project(key) {
      if (state.status === 'opening' || key === this.current_key) return false;
      const project = state.projects.find(project => this.project_key(project) === key);
      if (!project) return false;
      this.set_adapter(project.adapter); this.set_source(project.source); state.target_id = project.id; state.action = 'switch'; state.visible = true; notify();
      return this.open();
    },
    async refresh() {
      if (state.status === 'opening' || state.status === 'ready') return false;
      this.set_adapter(current.id); this.set_source(current.source || '');
      state.action = 'refresh'; state.visible = true;
      return this.open();
    },
    finish_refresh(error) {
      state.status = error ? 'error' : 'idle'; state.error = error?.message || ''; state.visible = Boolean(error);
      if (error) state.opened = null;
      notify();
    },
    async open() {
      if (state.status === 'opening' || state.status === 'ready') return false;
      const source = state.source.trim();
      if (!['demo', 'xiaoxunrss', 'findrss-admin', 'wx-channels'].includes(state.adapter) || (state.adapter !== 'demo' && !source)) {
        state.error = '请选择项目类型并填写项目目录'; state.status = 'error'; notify(); return false;
      }
      state.status = 'opening'; state.error = ''; notify();
      try {
        const response = await request('/__jiezi/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.target_id ? { id: state.target_id } : { adapter: state.adapter, source }) });
        const result = await response.json().catch(() => ({ error: '请通过 npm run dev 启动或重启开发服务' }));
        if (!response.ok || result.error) throw new Error(result.error || '打开项目失败，请检查开发服务输出');
        state.opened = result; state.status = 'ready'; notify(); return true;
      } catch (error) { state.error = error.message; state.status = 'error'; notify(); return false; }
    },
  };
}
