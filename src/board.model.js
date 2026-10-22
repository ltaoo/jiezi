import { arrange_frames, fit_frames, frame_group_bounds, zoom_at } from './geometry.js';
import { CatalogTreeModel } from './catalog-tree.model.js';

export function BoardModel(catalog, storage, project_id = 'default') {
  // 保留旧存储键，让更名前保存的画布布局继续可用。
  const storage_key = `frontend-agent:${project_id}:layout:v4`;
  let saved = {};
  try { saved = JSON.parse(storage.getItem(storage_key) || '{}') || {}; } catch { /* 布局损坏时使用默认值。 */ }
  const frames = arrange_frames(catalog).map(frame => {
    const position = saved[frame.id];
    return position && Number.isFinite(position.x) && Number.isFinite(position.y) ? { ...frame, x: position.x, y: position.y } : frame;
  });
  const state = { frames, filter: 'page', query: '', selected: null, theme: 'light', tool: 'select', view: { x: 50, y: 60, scale: 0.36 } };
  const tree = CatalogTreeModel(frames);
  const matches = frame => tree.matches(frame.id, state.query);
  const group_area = group => ({ ...group.bounds, y: group.bounds.y + 38, height: group.bounds.height - 38 });
  return {
    state, tree, matches,
    visible() {
      return frames.filter(frame => (state.filter === 'all' || (state.filter === 'page' && !!frame.group_root) || state.filter === frame.kind || (state.filter === 'direct' && frame.preview === 'direct')) && matches(frame));
    },
    groups() {
      const groups = new Map();
      for (const frame of this.visible()) {
        if (!groups.has(frame.group_id)) groups.set(frame.group_id, { id: frame.group_id, title: frame.group_title, frames: [] });
        groups.get(frame.group_id).frames.push(frame);
      }
      return [...groups.values()].map(group => ({ ...group, bounds: frame_group_bounds(group.frames) }));
    },
    select(id) { state.selected = frames.find(frame => frame.id === id) || null; tree.reveal(id); },
    zoom(scale, point) { state.view = zoom_at(state.view, scale, point); },
    fit(width, height, items) { state.view = fit_frames(items || this.groups().map(group_area), width, height); },
    fit_group(width, height, id) { const group = this.groups().find(group => group.id === id); this.fit(width, height, group ? [group_area(group)] : []); },
    persist() {
      try { storage.setItem(storage_key, JSON.stringify(Object.fromEntries(frames.map(frame => [frame.id, { x: frame.x, y: frame.y }])))); } catch { /* 禁用存储仍可使用白板。 */ }
    },
    reset() {
      const arranged = arrange_frames(catalog);
      frames.forEach(frame => Object.assign(frame, arranged.find(item => item.id === frame.id)));
      this.persist();
    },
  };
}
