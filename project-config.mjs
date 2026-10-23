import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = dirname(fileURLToPath(import.meta.url));

export async function write_projects(projects, file = join(root, 'project.json')) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  await writeFile(temporary, JSON.stringify(projects, null, 2) + '\n');
  await rename(temporary, file);
}

export async function read_projects(file = join(root, 'project.json')) {
  try {
    const projects = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(projects) || projects.some(project => !project || !['demo', 'xiaoxunrss', 'findrss-admin', 'wx-channels'].includes(project.adapter) || typeof project.source !== 'string' || !isAbsolute(project.source) || typeof project.title !== 'string')) throw new Error('项目列表需要包含 adapter、title 和绝对路径 source');
    const ids = new Set();
    for (const project of projects) {
      if (project.id === undefined) continue;
      if (typeof project.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(project.id) || ids.has(project.id)) throw new Error('项目 id 必须是唯一的字母、数字、下划线或连字符');
      ids.add(project.id);
    }
    if (projects.some(project => project.id === undefined)) {
      for (const project of projects) project.id ??= randomUUID();
      await write_projects(projects, file);
    }
    return projects;
  } catch (error) {
    if (error.code === 'ENOENT' && error.syscall === 'open' && error.path === file) return [];
    throw new Error(`无法读取 ${file}：${error.message}`, { cause: error });
  }
}

export async function configured_project_options(adapter, file = join(root, 'project.json')) {
  // shortcut: 同适配器的集成测试读取首项，需要验证多个源码目录时扩展测试入口。
  const project = (await read_projects(file)).find(project => project.adapter === adapter);
  if (!project) throw new Error(`请在 ${file} 中添加 ${adapter} 项目及其绝对路径 source`);
  return { adapter, source: project.source };
}
