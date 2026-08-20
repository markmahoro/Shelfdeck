'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Admin Web exposes eight Helix pages and keeps health in Collection', () => {
  const app = read('web/src/App.tsx');
  const model = read('web/src/helix/surface-model.ts');
  assert.match(app, /pages\.map/);
  assert.match(app, /OverviewPage/);
  assert.match(read('web/src/helix/OverviewPage.tsx'), /getOverview/);
  assert.doesNotMatch(read('web/src/helix/OverviewPage.tsx'), /2,430|2,105/);
  assert.match(app, /PeoplePage/);
  assert.match(read('web/src/helix/PeoplePage.tsx'), /listPeople/);
  assert.doesNotMatch(read('web/src/helix/PeoplePage.tsx'), />416<|>3<|>1</);
  for (const slug of ['overview', 'material-fields', 'shelves', 'collection', 'formation', 'offdeck', 'people', 'settings']) assert.match(model, new RegExp(`slug:'${slug}'`));
  assert.doesNotMatch(model, /slug:'care'/);
  assert.match(read('web/src/helix/CollectionPage.tsx'), /收藏健康/);
  assert.doesNotMatch(app, /TasksPage|LibrariesPage|CleanupPage|PoliciesPage/);
});

test('Material Fields admits background Observation and projects progress toward Handoff A ready', () => {
  const app = read('web/src/App.tsx');
  const page = read('web/src/helix/MaterialFieldsPage.tsx');
  const api = read('web/src/helix/api.ts');
  const admin = read('src/helix/domains/procurement/application/admin-facade.js');
  assert.match(app, /MaterialFieldsPage/);
  assert.match(api, /\/v1\/admin\/session/);
  assert.match(api, /\/v1\/admin\/material-fields/);
  assert.match(page, /保存文件来源/);
  assert.match(page, /观察并准备候选/);
  assert.match(page, /注销文件来源/);
  assert.match(api, /actions\/deregister/);
  assert.match(api, /procurementStatus/);
  assert.doesNotMatch(page, />删除文件来源</);
  assert.match(page, /Candidate Package/);
  assert.match(page, /Handoff A/);
  assert.match(api, /actions\/observe/);
  assert.match(page, /Observation已进入后台队列/);
  assert.match(api, /operationRef/);
  assert.doesNotMatch(admin, /advanceToHandoffAReady/);
  assert.doesNotMatch(admin, /movieRunCoordinator\.advance\(/);
});

test('Shelves configures a probed Template-derived Movie Standard without exposing caller-owned Standard input', () => {
  const app = read('web/src/App.tsx');
  const page = read('web/src/helix/ShelvesPage.tsx');
  const api = read('web/src/helix/api.ts');
  assert.match(app, /ShelvesPage/);
  assert.match(api, /\/v1\/admin\/shelves/);
  assert.match(api, /\/v1\/admin\/rule-templates/);
  assert.match(page, /system-beta-recommended/);
  assert.match(page, /创建收藏架/);
  assert.match(page, /收藏最终目录/);
  assert.match(page, /Target probe/);
  assert.match(page, /未评分/);
  assert.match(page, /\$\{branch\.rating\}星/);
  assert.match(page, /不会建立正式收藏，也不会移动、改名或写入任何媒体文件/);
  assert.doesNotMatch(page, /standard:\s*\{/);
  assert.match(page, /expectedTemplateRevision/);
});

test('Media organization workspace uses user-facing stages after Procurement handoff', () => {
  const model = read('web/src/helix/surface-model.ts');
  const formation = model.split("slug:'formation'")[1].split("slug:'offdeck'")[0];
  assert.match(formation, /媒体整理工作区/);
  assert.match(formation, /待整理/);
  assert.match(formation, /已完成整理/);
  assert.doesNotMatch(formation, /Subject|Routing|Spec|Run|Work|Event|判断开采资格|准备候选包/);
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
