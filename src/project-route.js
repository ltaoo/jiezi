export function project_url(id) {
  return `/project/${encodeURIComponent(id)}`;
}

export function frame_url(project_id, frame_id) {
  return `${project_url(project_id)}/frame/${encodeURIComponent(frame_id)}`;
}

export function read_project_route(url) {
  const path = new URL(url, 'http://localhost').pathname;
  const match = /^\/project\/([^/]+)(?:\/frame\/([^/]+))?$/.exec(path);
  if (!match) return null;
  try {
    return { project_id: decodeURIComponent(match[1]), frame_id: match[2] === undefined ? null : decodeURIComponent(match[2]) };
  } catch { throw new Error('无效的项目或 Frame 地址'); }
}
