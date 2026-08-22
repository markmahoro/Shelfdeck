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
  assert.match(read('web/src/helix/OverviewPage.tsx'), /需要你处理/);
  assert.match(read('web/src/helix/OverviewPage.tsx'), /systemState/);
  assert.doesNotMatch(read('web/src/helix/OverviewPage.tsx'), /2,430|2,105/);
  assert.doesNotMatch(read('web/src/helix/OverviewPage.tsx'), /已发现的电影|已经上架|已检查健康/);
  assert.match(app, /PeoplePage/);
  assert.match(read('web/src/helix/PeoplePage.tsx'), /listPeople/);
  assert.doesNotMatch(read('web/src/helix/PeoplePage.tsx'), />416<|>3<|>1</);
  for (const slug of ['overview', 'material-fields', 'shelves', 'collection', 'formation', 'offdeck', 'people', 'settings']) assert.match(model, new RegExp(`slug:\\s*'${slug}'`));
  assert.match(model, /文件来源配置/);
  assert.match(model, /收藏架配置/);
  assert.match(read('web/src/App.tsx'), /nav-separator/);
  assert.match(read('web/src/App.tsx'), /QueryClientProvider/);
  assert.match(read('web/src/pages/README.md'), /非 Helix 产品入口/);
  assert.doesNotMatch(model, /slug:\s*'care'/);
  assert.match(read('web/src/helix/CollectionPage.tsx'), /收藏健康/);
  assert.match(read('web/src/helix/CollectionPage.tsx'), /占用空间/);
  assert.match(read('web/src/helix/CollectionPage.tsx'), /aria-label="收藏架"/);
  assert.match(read('src/helix/domains/arca/application/collection-query.js'), /occupancyBytes/);
  assert.match(read('src/helix/domains/arca/application/collection-query.js'), /filterCollectionIndex/);
  assert.doesNotMatch(app, /TasksPage|LibrariesPage|CleanupPage|PoliciesPage/);
});

test('Material Fields admits background Observation and projects scan progress, not Candidate Handoff', () => {
  const app = read('web/src/App.tsx');
  const page = read('web/src/helix/MaterialFieldsPage.tsx');
  const labels = read('web/src/helix/labels.ts');
  const api = read('web/src/helix/api.ts');
  const admin = read('src/helix/domains/procurement/application/admin-facade.js');
  const runtime = read('src/helix/composition/create-procurement-execution-runtime.js');
  assert.match(app, /MaterialFieldsPage/);
  assert.match(api, /\/v1\/admin\/session/);
  assert.match(api, /\/v1\/admin\/material-fields/);
  assert.match(page, /保存文件来源/);
  assert.match(page, /扫描新文件/);
  assert.match(page, /等待扫描/);
  assert.match(page, /正在扫描/);
  assert.match(page, /扫描失败/);
  assert.match(page, /保存时会检查目录是否存在、可读/);
  assert.match(labels, /已扫描完成/);
  assert.match(labels, /扫描失败/);
  assert.match(page, /注销文件来源/);
  assert.match(api, /actions\/deregister/);
  assert.match(api, /observationScan/);
  assert.doesNotMatch(page, />删除文件来源</);
  assert.doesNotMatch(page, /Candidate Package|Handoff A|已交给整理|已发现电影/);
  assert.match(api, /actions\/observe/);
  assert.match(runtime, /active-material-fields/);
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
  assert.match(api, /actions\/bind-template/);
  assert.match(api, /placement\/actions\/preview/);
  assert.match(api, /actions\/copy/);
  assert.match(api, /actions\/publish/);
  assert.match(page, /system-beta-recommended/);
  assert.match(page, /创建收藏架/);
  assert.match(page, /收藏最终目录/);
  assert.match(page, /未评分/);
  assert.match(page, /\$\{branch\.rating\}星/);
  assert.match(page, /保存时会检查目录是否可达/);
  assert.match(page, /复制模板/);
  assert.match(page, /复制后发布/);
  assert.match(page, /系统推荐电影标准/);
  assert.match(page, /复制并修改电影整理标准/);
  assert.match(page, /更换规则模板/);
  assert.doesNotMatch(page, /Beta Recommended/);
  assert.match(page, /调整目录布局/);
  assert.match(page, /预览影响/);
  assert.match(page, /发布目录布局/);
  assert.match(page, /发布电影整理标准/);
  assert.match(page, /不会重新入库/);
  assert.match(page, /收藏健康自动修复/);
  assert.doesNotMatch(page, /standard:\s*\{/);
  assert.doesNotMatch(page, /Aftercare Case|Standard revision|Placement revision/);
  assert.match(page, /expectedTemplateRevision/);
  assert.match(page, /全自动或关键步骤确认/);
  assert.match(api, /\/v1\/admin\/settings\/automatic-operation/);
  assert.match(api, /enableFullAutomaticOperation/);
  assert.match(read('web/src/helix/AutomaticOperationPanel.tsx'), /启用全自动/);
  assert.match(read('web/src/helix/AutomaticOperationPanel.tsx'), /关键步骤确认/);
  assert.match(read('web/src/helix/AutomaticOperationPanel.tsx'), /退出收藏的物理销毁保持独立关闭/);
});

test('Media organization workspace uses user-facing stages after Procurement handoff', () => {
  const model = read('web/src/helix/surface-model.ts');
  const page = read('web/src/helix/FormationPage.tsx');
  const formation = model.split("slug: 'formation'")[1].split("slug: 'offdeck'")[0];
  assert.match(formation, /媒体整理工作区/);
  assert.match(formation, /待整理/);
  assert.match(formation, /需要处理/);
  assert.match(page, /已完成整理/);
  assert.match(page, /整理动作/);
  assert.match(page, /分步进度/);
  assert.match(page, /用户操作/);
  assert.match(page, />加急</);
  assert.match(page, /organizingSteps/);
  assert.match(page, /全部当前/);
  assert.match(page, /需要我处理/);
  assert.match(page, /按片名筛选/);
  assert.match(page, /function shelfNameFor\(item: FormationSubject, shelves: Shelf\[\]\)/);
  assert.match(page, /<CompletedMediaTable items=\{completed\} shelves=\{shelves\}/);
  assert.match(page, /shelfNameFor\(item, shelves\) \|\| '—'/);
  assert.doesNotMatch(page, /尚未形成整理动作/);
  assert.doesNotMatch(formation, /Subject|Routing|Spec|Run|Work|Event|判断开采资格|准备候选包/);
});

test('People page registers, confirms, and does not copy collection cast', () => {
  const page = read('web/src/helix/PeoplePage.tsx');
  const runtime = read('src/helix/composition/create-procurement-execution-runtime.js');
  assert.match(page, /登记一个人/);
  assert.match(page, /待确认登记/);
  assert.match(page, /接受/);
  assert.match(page, /忽略/);
  assert.match(page, /不是某部电影的演员表/);
  assert.match(runtime, /ondeck-person-evidence/);
  assert.match(runtime, /createPeopleProcessServices/);
});

test('Settings splits Douban sync from rating-log refresh', () => {
  const page = read('web/src/helix/SettingsPage.tsx');
  const api = read('web/src/helix/api.ts');
  const runtime = read('src/helix/composition/create-procurement-execution-runtime.js');
  assert.match(page, /正在同步/);
  assert.match(page, /刷新日志/);
  assert.match(page, /正在从豆瓣拉取收藏评分/);
  assert.match(page, /不会去豆瓣同步/);
  assert.match(api, /\/v1\/admin\/perception\/actions\/sync/);
  assert.match(api, /\/v1\/admin\/perception\/sync-state/);
  assert.match(api, /\/v1\/admin\/perception\/records/);
  assert.match(runtime, /periodic-douban-acquisitions/);
  assert.doesNotMatch(page, /同步评分/);
});

test('Off-deck page uses task language and keeps rules collapsed', () => {
  const page = read('web/src/helix/OffdeckPage.tsx');
  assert.match(page, /<details className="offdeck-task">/);
  assert.match(page, /审阅这部/);
  assert.match(page, /先留着/);
  assert.match(page, /核对将删除的文件/);
  assert.match(page, /授权删除/);
  assert.match(page, /取消这次审阅/);
  assert.match(page, /addableRuleKinds/);
  assert.doesNotMatch(page, /emptyRule\('disliked_person'\)/);
  assert.doesNotMatch(page, />进入审阅</);
  assert.doesNotMatch(page, />授权并开始退出</);
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
