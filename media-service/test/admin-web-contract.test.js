'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Admin Web exposes exactly the eight product routes and lazy-loads heavy pages', () => {
  const app = read('web/src/App.tsx');
  const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]);
  assert.deepStrictEqual(routes, ['libraries', 'media', 'people', 'tasks', 'cleanup', 'policies', 'settings', '*']);
  for (const page of ['OverviewPage', 'LibrariesPage', 'MediaPage', 'PeoplePage', 'TasksPage', 'CleanupPage', 'PoliciesPage', 'SettingsPage']) {
    assert.match(app, new RegExp(`lazy\\(\\(\\) => import\\('./pages/${page}'\\)\\)`));
  }
});

test('legacy Admin routes, pages and style layers are absent', () => {
  const removed = [
    'web/src/pages/AdultConfigPage.tsx', 'web/src/pages/AdvancedPage.tsx', 'web/src/pages/OffboardingCandidatesPage.tsx',
    'web/src/pages/TaskMonitorPage.tsx', 'web/src/pages/RuleTemplatesPage.tsx', 'web/src/deleteCandidates.css',
    'web/src/mediaManage.css', 'web/src/taskMonitor.css', 'web/src/kairox/types.ts',
  ];
  for (const file of removed) assert.strictEqual(fs.existsSync(path.join(root, file)), false, file);
  const client = read('web/src/api/client.ts');
  for (const route of ['/v1/config', '/v1/admin/adult/people', '/v1/admin/transcode/config', '/v1/admin/offboarding-candidates', '/v1/admin/delete-candidates']) {
    assert.doesNotMatch(client, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('ordinary pages use product language and keep architecture facts in diagnostics', () => {
  const pages = fs.readdirSync(path.join(root, 'web/src/pages')).filter((name) => name.endsWith('.tsx')).map((name) => read(`web/src/pages/${name}`)).join('\n');
  assert.doesNotMatch(pages, /\bLibra\b|\bNexora\b|\bKairox\b|\bpermit\b|\bblocker\b|Offboarding|Archive/);
  assert.match(pages, /基础信息/);
  assert.match(pages, /不再由 ShelfDeck 管理/);
  assert.match(pages, /删除媒体文件/);
  assert.doesNotMatch(pages, /执行下一步/);
  assert.match(pages, /开始维护/);
  assert.match(pages, /优先维护/);
  const client = read('web/src/api/client.ts');
  assert.doesNotMatch(client, /createByIntent|updatePriority|actions\/execute|actions\/retry|actions\/pause/);
});

test('Task Center hides internal identifiers and translates Library work states', () => {
  const page = read('web/src/pages/TasksPage.tsx');
  assert.doesNotMatch(page, /table-sub[^\n]+row\.(?:id|workId)/);
  assert.match(page, /pending: \{ label: '排队中'/);
  assert.match(page, /retrying: \{ label: '正在恢复'/);
  assert.match(page, /pageSize: 20/);
  assert.match(page, /internalIdentifier/);
});

test('Media page uses server-side search and bounded pagination', () => {
  const media = read('web/src/pages/MediaPage.tsx');
  assert.match(media, /const pageSize = 50/);
  assert.match(media, /offset: \(page - 1\) \* pageSize/);
  assert.match(media, /search: search \|\| undefined/);
  assert.match(media, /上一页/);
  assert.match(media, /下一页/);
  assert.match(media, /queryFn: libraryApi\.getStatus/);
  assert.doesNotMatch(media, /queryFn: subLibraries\.list/);
});

test('People page uses server-side search and bounded pagination', () => {
  const people = read('web/src/pages/PeoplePage.tsx');
  assert.match(people, /const pageSize = 50/);
  assert.match(people, /offset: \(page - 1\) \* pageSize/);
  assert.match(people, /search, contentKind: kind, preference/);
  assert.match(people, /上一页/);
  assert.match(people, /下一页/);
});

test('FFmpeg binaries are resolved from deployment, bundled runtime, then system command', () => {
  const transcode = read('src/services/transcodeService.js');
  assert.match(transcode, /process\.env\.FFMPEG_PATH/);
  assert.match(transcode, /const bundled = getBundledFfmpegPath\(\);\s*return bundled \|\| 'ffmpeg'/);
  assert.match(transcode, /process\.env\.FFPROBE_PATH/);
  assert.match(transcode, /const bundled = getBundledFfprobePath\(\);\s*return bundled \|\| 'ffprobe'/);
  assert.doesNotMatch(transcode, /config\.ffmpegPath|config\.ffprobePath/);
});
