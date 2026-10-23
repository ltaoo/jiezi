import { arrange_frames, fit_frames, frame_group_bounds, separate_frame_groups, zoom_at } from './geometry.js';
import { CatalogTreeModel } from './catalog-tree.model.js';
import { project_url, frame_url, read_project_route } from './project-route.js';

export function BoardModel(catalog, storage, project_id = 'default', project_uid = project_id) {
  // 保留旧存储键，让更名前保存的画布布局继续可用。
  const storage_key = `frontend-agent:${project_id}:layout:v4`;
  let saved = {};
  try { saved = JSON.parse(storage.getItem(storage_key) || '{}') || {}; } catch { /* 布局损坏时使用默认值。 */ }
  const frames = arrange_frames(catalog).map(frame => {
    const position = saved[frame.id];
    return position && Number.isFinite(position.x) && Number.isFinite(position.y) ? { ...frame, x: position.x, y: position.y } : frame;
  });
  separate_frame_groups(frames);
  const state = { frames, filter: 'all', query: '', selected: null, detail: null, theme: 'light', tool: 'select', view: { x: 50, y: 60, scale: 0.36 } };
  let board_view;
  const tree = CatalogTreeModel(frames);
  const matches = frame => tree.matches(frame.id, state.query);
  const group_area = group => ({ ...group.bounds, y: group.bounds.y + 38, height: group.bounds.height - 38 });
  return {
    state, tree, matches,
    project_url() { return project_url(project_uid); },
    frame_url(id) { return frame_url(project_uid, id); },
    replace_catalog(next_catalog) {
      const positions = new Map(frames.map(frame => [frame.id, frame]));
      const next_frames = arrange_frames(next_catalog).map(frame => {
        const previous = positions.get(frame.id);
        return previous ? { ...frame, x: previous.x, y: previous.y } : frame;
      });
      separate_frame_groups(next_frames);
      catalog = next_catalog; frames.splice(0, frames.length, ...next_frames);
      const tree_state = tree.state;
      Object.assign(tree, CatalogTreeModel(frames)); Object.assign(tree.state, tree_state);
      state.selected = frames.find(frame => frame.id === state.selected?.id) || null;
      if (state.detail) {
        const detail = state.detail, previous = detail.frame;
        const frame = detail.frame = frames.find(frame => frame.id === detail.id);
        if (!previous || detail.width === previous.width) detail.width = frame?.width;
        detail.selection = null; detail.error = frame ? '' : '找不到此 Frame，请返回画板选择。';
        detail.picking = frame?.preview === 'direct' && (previous?.preview !== 'direct' || detail.picking);
        if (frame?.preview === 'source') detail.source_open = true;
      }
    },
    read_route(url) {
      const route = read_project_route(url);
      if (route?.project_id !== project_uid || route.frame_id === null) {
        if (state.detail) { state.detail = null; state.view = board_view; }
        return;
      }
      const id = route.frame_id;
      if (state.detail?.id === id) return;
      if (!state.detail) board_view = { ...state.view };
      const frame = frames.find(frame => frame.id === id);
      state.detail = { id, frame, width: frame?.width, source_open: frame?.preview === 'source', nodes_visible: frame?.preview === 'direct', picking: frame?.preview === 'direct', selection: null, error: frame ? '' : '找不到此 Frame，请返回画板选择。' };
      if (frame) this.select(id);
    },
    set_detail_width(width) {
      if (!state.detail?.frame || !Number.isFinite(width) || width <= 0) return;
      state.detail.width = width; state.detail.selection = null;
    },
    show_source(value) { if (state.detail) state.detail.source_open = Boolean(value); },
    show_nodes(value) { if (state.detail) state.detail.nodes_visible = Boolean(value); },
    set_picking(value) { if (state.detail) { state.detail.picking = value; if (value) state.detail.nodes_visible = true; } },
    set_node_selection(result) { if (state.detail) { state.detail.selection = result; if (result) state.detail.nodes_visible = true; } },
    frame_width(frame) { return state.detail?.id === frame.id ? state.detail.width : frame.width; },
    visible() {
      if (state.detail) return state.detail.frame ? [state.detail.frame] : [];
      return frames.filter(frame => (state.filter === 'all' || (state.filter === 'page' && !!frame.group_root) || state.filter === frame.kind || (state.filter === 'direct' && frame.preview === 'direct')) && matches(frame));
    },
    preview_frames(width, height) {
      if (state.detail) return state.detail.frame?.preview === 'direct' ? [state.detail.frame] : [];
      const { x, y, scale } = state.view;
      if (scale < 0.2) return [];
      return this.visible().filter(frame => frame.preview === 'direct' &&
        frame.x * scale + x < width + 100 && (frame.x + frame.width) * scale + x > -100 &&
        frame.y * scale + y < height + 100 && (frame.y + frame.height) * scale + y > -100).slice(0, 8);
    },
    groups(group_id) {
      const groups = new Map();
      for (const frame of this.visible()) {
        if (group_id !== undefined && frame.group_id !== group_id) continue;
        if (!groups.has(frame.group_id)) groups.set(frame.group_id, { id: frame.group_id, title: frame.group_title, frames: [] });
        groups.get(frame.group_id).frames.push(frame);
      }
      return [...groups.values()].map(group => ({ ...group, bounds: frame_group_bounds(group.frames) }));
    },
    select(id) { state.selected = frames.find(frame => frame.id === id) || null; tree.reveal(id); },
    zoom(scale, point) { state.view = zoom_at(state.view, scale, point); },
    reveal_rect(rect, viewport) {
      if (!rect || rect.left >= viewport.left && rect.right <= viewport.right && rect.top >= viewport.top && rect.bottom <= viewport.bottom) return;
      state.view.x += (viewport.left + viewport.right - rect.left - rect.right) / 2;
      state.view.y += (viewport.top + viewport.bottom - rect.top - rect.bottom) / 2;
    },
    fit(width, height, items) {
      if (state.detail?.frame) {
        state.view = fit_frames([{ ...state.detail.frame, width: state.detail.width }], width, Math.max(1, height - 144));
        state.view.y += 72;
      } else state.view = fit_frames(items || this.groups().map(group_area), width, height);
    },
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
