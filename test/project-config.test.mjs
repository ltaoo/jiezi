import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { read_projects, configured_project_options } from '../project-config.mjs';

test('本机 project.json 记录多个项目的绝对路径，按适配器读取集成测试配置', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jiezi-project-config-'));
  const file = join(directory, 'project.json');
  try {
    assert.deepEqual(await read_projects(file), []);
    await assert.rejects(configured_project_options('findrss-admin', file), /project\.json.*findrss-admin/);
    const projects = [
      { adapter: 'findrss-admin', title: '后台', source: join(directory, 'findrss worker/admin') },
      { adapter: 'wx-channels', title: '下载', source: join(directory, 'download/frontend') },
    ];
    await writeFile(file, JSON.stringify(projects));
    const migrated = await read_projects(file);
    assert.deepEqual(migrated.map(({ id, ...project }) => project), projects);
    assert.equal(new Set(migrated.map(project => project.id)).size, projects.length);
    assert.ok(migrated.every(project => /^[a-f0-9-]{36}$/.test(project.id)));
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), migrated);
    assert.deepEqual(await read_projects(file), migrated);
    for (const project of projects) {
      const options = await configured_project_options(project.adapter, file);
      assert.equal(options.adapter, project.adapter);
      assert.equal(options.source, project.source);
    }
    for (const invalid of ['{broken', '{}', '[null]', JSON.stringify([{ ...projects[0], source: 'relative/admin' }]), JSON.stringify([{ ...projects[0], adapter: '../invalid' }]), JSON.stringify([{ ...projects[0], title: null }]), ...['', null, 123, '../bad', 'a/b'].map(id => JSON.stringify([{ ...projects[0], id }])), JSON.stringify(projects.map(project => ({ ...project, id: 'duplicate' })))]) {
      await writeFile(file, invalid);
      await assert.rejects(read_projects(file), /无法读取.*project\.json/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
