import { CatalogTreeModel } from './catalog-tree.model.js';

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function zoom_at(view, scale, point) {
  const next = clamp(scale, 0.08, 2);
  const ratio = next / view.scale;
  return { scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}

export function fit_frames(frames, width, height) {
  if (!frames.length || width <= 0 || height <= 0) return { x: 48, y: 72, scale: 0.5 };
  const left = Math.min(...frames.map(f => f.x));
  const top = Math.min(...frames.map(f => f.y - 38));
  const right = Math.max(...frames.map(f => f.x + f.width));
  const bottom = Math.max(...frames.map(f => f.y + f.height));
  const scale = clamp(Math.min((width - 96) / (right - left), (height - 96) / (bottom - top)), 0.08, 1);
  return { scale, x: (width - (right - left) * scale) / 2 - left * scale, y: (height - (bottom - top) * scale) / 2 - top * scale };
}

export function arrange_frames(items) {
  const groups = CatalogTreeModel(items).groups();
  let y = 90;
  const frames = [];
  for (const group of groups) {
    const columns = group.page ? 3 : 6;
    let x = 80, row_height = 0;
    group.frames.forEach((item, index) => {
      if (index && index % columns === 0) { y += row_height + 100; x = 80; row_height = 0; }
      const width = item.width || (item.kind === 'page' ? 1200 : 520);
      const height = item.height || (item.kind === 'page' ? 800 : 360);
      frames.push({ ...item, group_id: group.id, group_title: group.title, group_root: group.page ? group.id : '', width, height, x, y });
      x += width + 80; row_height = Math.max(row_height, height);
    });
    y += row_height + 260;
  }
  return frames;
}

export function frame_group_bounds(frames) {
  const x = Math.min(...frames.map(frame => frame.x)) - 32;
  const y = Math.min(...frames.map(frame => frame.y)) - 112;
  return { x, y,
    width: Math.max(...frames.map(frame => frame.x + frame.width)) + 32 - x,
    height: Math.max(...frames.map(frame => frame.y + frame.height)) + 32 - y };
}

export function separate_frame_groups(frames) {
  const groups = new Map(), placed = [];
  for (const frame of frames) {
    if (!groups.has(frame.group_id)) groups.set(frame.group_id, []);
    groups.get(frame.group_id).push(frame);
  }
  for (const items of groups.values()) {
    const bounds = frame_group_bounds(items), original_y = bounds.y;
    for (const previous of placed.sort((a, b) => a.y - b.y)) {
      if (bounds.x < previous.x + previous.width && bounds.x + bounds.width > previous.x &&
          bounds.y < previous.y + previous.height && bounds.y + bounds.height > previous.y) {
        bounds.y = previous.y + previous.height + 116;
      }
    }
    for (const frame of items) frame.y += bounds.y - original_y;
    placed.push(bounds);
  }
}
