'use strict';

/**
 * One-click release script for ShelfDeck.
 *
 * Usage:  node scripts/release.js v1.1.0
 *
 * Automates:
 *   1. Verify git clean + on master
 *   2. Bump version in media-service/package.json + media-desktop/package.json
 *   3. Generate changelog from git log since last tag
 *   4. Update README download links
 *   5. Generate release-notes/ drafts (xiaohongshu, zhihu, readme)
 *   6. git commit
 *   7. git tag
 *   8. git push --tags
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// ── parse version ──────────────────────────────────────────────────────────

const version = process.argv[2];
if (!version || !/^v\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release.js vX.Y.Z');
  process.exit(1);
}
const semver = version.replace('v', '');

// ── 1. verify environment ──────────────────────────────────────────────────

const status = execSync('git status --porcelain', { encoding: 'utf8', cwd: ROOT });
if (status.trim()) {
  console.error('ERROR: git working tree is not clean. Commit or stash changes first.');
  console.error(status);
  process.exit(1);
}

const branch = execSync('git branch --show-current', { encoding: 'utf8', cwd: ROOT }).trim();
if (branch !== 'master') {
  console.error(`ERROR: must be on master branch (currently on '${branch}')`);
  process.exit(1);
}

console.log(`[release] environment: clean, on master ✓`);

// ── 2. bump versions ───────────────────────────────────────────────────────

for (const pkgPath of ['media-service/package.json', 'media-desktop/package.json']) {
  const fullPath = path.join(ROOT, pkgPath);
  const p = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const oldVer = p.version;
  p.version = semver;
  fs.writeFileSync(fullPath, JSON.stringify(p, null, 2) + '\n');
  console.log(`[release] ${pkgPath}: ${oldVer} → ${semver}`);
}

// ── 3. generate changelog ──────────────────────────────────────────────────

let lastTag;
try {
  lastTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8', cwd: ROOT }).trim();
} catch {
  console.error('ERROR: no previous git tag found. Create one first (e.g. git tag v1.0.0).');
  process.exit(1);
}

const gitLog = execSync(
  `git log ${lastTag}..HEAD --pretty=format:"%s"`,
  { encoding: 'utf8', cwd: ROOT },
);

const commits = gitLog.split('\n').filter(Boolean);

const groups = {
  feat: [],
  fix: [],
  refactor: [],
  docs: [],
  chore: [],
  other: [],
};

for (const msg of commits) {
  const match = msg.match(/^(\w+)(?:\([^)]*\))?:\s*(.+)/);
  if (match) {
    const type = match[1];
    const desc = match[2];
    if (groups[type]) {
      groups[type].push(desc);
    } else {
      groups.other.push(msg);
    }
  } else {
    groups.other.push(msg);
  }
}

const now = new Date();
const dateStr = now.toISOString().split('T')[0];

let changelogEntry = `## ${version} (${dateStr})\n\n`;

if (groups.feat.length) {
  changelogEntry += `### 新增\n\n${groups.feat.map((s) => `- ${s}`).join('\n')}\n\n`;
}
if (groups.fix.length) {
  changelogEntry += `### 修复\n\n${groups.fix.map((s) => `- ${s}`).join('\n')}\n\n`;
}
if (groups.refactor.length) {
  changelogEntry += `### 变更\n\n${groups.refactor.map((s) => `- ${s}`).join('\n')}\n\n`;
}
if (groups.other.length) {
  changelogEntry += `### 其他\n\n${groups.other.map((s) => `- ${s}`).join('\n')}\n\n`;
}

const changelogPath = path.join(ROOT, 'CHANGELOG.md');
const existingChangelog = fs.existsSync(changelogPath)
  ? fs.readFileSync(changelogPath, 'utf8')
  : '# Changelog\n\n';

// Insert new entry after the title line
const titleLine = existingChangelog.split('\n')[0];
const rest = existingChangelog.split('\n').slice(1).join('\n');
fs.writeFileSync(changelogPath, `${titleLine}\n\n${changelogEntry}${rest.trim()}\n`);
console.log(`[release] updated CHANGELOG.md`);

// ── 4. update README download links ────────────────────────────────────────

const readmePath = path.join(ROOT, 'README.md');
if (fs.existsSync(readmePath)) {
  let readme = fs.readFileSync(readmePath, 'utf8');
  // Replace version references in download URLs
  readme = readme.replace(/ShelfDeck-v\d+\.\d+\.\d+/g, `ShelfDeck-v${semver}`);
  fs.writeFileSync(readmePath, readme);
  console.log(`[release] updated README.md download links`);
}

// ── 5. generate release-notes/ drafts ──────────────────────────────────────

const notesDir = path.join(ROOT, 'release-notes', version);
fs.mkdirSync(notesDir, { recursive: true });

// changelog copy
fs.writeFileSync(path.join(notesDir, 'changelog.md'), changelogEntry);

// xiaohongshu draft
const featList = groups.feat.length
  ? groups.feat.map((s) => `✨ ${s}`).join('\n')
  : '✨ 性能优化和稳定性提升';
const fixList = groups.fix.length
  ? groups.fix.map((s) => `🔧 ${s}`).join('\n')
  : '';

const xhsContent = `# ShelfDeck ${version} 更新啦！

## 新功能
${featList}
${fixList ? '\n## Bug修复\n' + fixList : ''}
## 下载方式
- GitHub: <下载链接>
- 夸克网盘: <夸克链接>

#ShelfDeck #媒体管理 #NAS #Emby
`;
fs.writeFileSync(path.join(notesDir, 'draft-xiaohongshu.md'), xhsContent);

// zhihu draft
const zhContent = `# ShelfDeck ${version} 版本更新日志

ShelfDeck（媒体库管家）发布了 ${version} 版本。

## 更新内容

${changelogEntry}

## 下载与安装

- **Windows 用户**：下载 zip 解压后运行 \`shelfdeck_service启动器.vbs\`
- **Docker/NAS 用户**：\`docker pull markmahoro/shelfdeck:latest\`
- **夸克网盘**：<夸克链接>

更多使用教程请参考 GitHub README。
`;
fs.writeFileSync(path.join(notesDir, 'draft-zhihu.md'), zhContent);

// README download section draft
const readmeDraft = `### 下载

- [GitHub Release](https://github.com/<repo>/releases/tag/${version})
- 夸克网盘：<更新链接>
`;
fs.writeFileSync(path.join(notesDir, 'draft-readme.md'), readmeDraft);

console.log(`[release] generated release-notes/${version}/`);

// ── 6. commit ──────────────────────────────────────────────────────────────

execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
execSync(`git commit -m "release: ${version}"`, { cwd: ROOT, stdio: 'inherit' });
console.log(`[release] committed`);

// ── 7. tag ─────────────────────────────────────────────────────────────────

execSync(`git tag -a ${version} -m "${version}"`, { cwd: ROOT, stdio: 'inherit' });
console.log(`[release] tagged ${version}`);

// ── 8. push ────────────────────────────────────────────────────────────────

execSync('git push', { cwd: ROOT, stdio: 'inherit' });
execSync('git push --tags', { cwd: ROOT, stdio: 'inherit' });
console.log(`[release] pushed to remote`);

// ── done ───────────────────────────────────────────────────────────────────

console.log('');
console.log(`Released ${version}. Watch CI:`);
console.log(`  https://github.com/<repo>/actions`);
console.log('');
console.log('After CI completes, finish the 3 manual steps:');
console.log(`  1. 夸克网盘 — upload dist-release/ShelfDeck-v${semver}.zip`);
console.log(`  2. 小红书   — review release-notes/${version}/draft-xiaohongshu.md → publish`);
console.log(`  3. 知乎     — review release-notes/${version}/draft-zhihu.md → publish`);
