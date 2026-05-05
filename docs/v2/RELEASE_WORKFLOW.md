# RELEASE_WORKFLOW — 发版工作流

> 状态：v1 定稿
> 目标读者：开发者（人执行 1 条命令）+ Claude Code（辅助自动化）
> 
> 原则：**一键触发，自动执行，人工只做无法自动化的 3 步**。

---

## 全景流程

```
开发者执行:  node scripts/release.js v1.1.0
                │
                ▼
         scripts/release.js  ← 本地自动化
           ├── 1. 验证 git clean + on master
           ├── 2. Bump version (两个 package.json)
           ├── 3. 生成 changelog (from git commits)
           ├── 4. 更新 README 下载链接
           ├── 5. 生成宣传文案草稿 (小红书/知乎)
           ├── 6. git commit + tag
           └── 7. git push --tags
                        │
                        ▼
         .github/workflows/release.yml  ← CI 自动触发 (on tag push)
           ├── Job 1: Build Windows zip (dist-release/)
           ├── Job 2: Build + Push Docker image (:v1.1.0 + :latest)
           ├── Job 3: Generate release announcement assets
           └── Job 4: Create GitHub Release (+ upload zip + changelog)
                        │
                        ▼
         人工收尾 (3 步)
           ├── 1. 上传 zip 到夸克网盘，更新分享链接
           ├── 2. 发布小红书 (审核自动生成的草稿)
           └── 3. 发布知乎 (审核自动生成的草稿)
```

---

## §1 一键发版

### 前置条件

```bash
git checkout master
git pull
# 确认 CI 全绿: https://github.com/<repo>/actions
```

### 执行命令

```bash
node scripts/release.js v1.1.0
```

### 脚本自动完成以下操作

| 步骤  | 操作           | 说明                                                                                                       |
| --- | ------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | 验证环境         | `git status` clean + `git branch` = master                                                               |
| 2   | Bump version | 更新 `media-service/package.json` 和 `media-desktop/package.json` 的 `version` 字段                            |
| 3   | 生成 changelog | 从 `git log <last-tag>..HEAD` 按 conventional commits 分组（feat/fix/refactor/...）                            |
| 4   | 更新 README    | 更新下载链接中的版本号                                                                                              |
| 5   | 生成宣传文案       | 输出到 `release-notes/v1.1.0/`: `changelog.md`, `draft-xiaohongshu.md`, `draft-zhihu.md`, `draft-readme.md` |
| 6   | Commit       | `git add -A` + `git commit -m "release: v1.1.0"`                                                         |
| 7   | Tag + Push   | `git tag -a v1.1.0` + `git push --tags`                                                                  |

---

## §2 CI 自动构建 + 分发

`git push --tags` 后，`.github/workflows/release.yml` 自动执行：

| Job                    | Runner         | 产物                                                      |
| ---------------------- | -------------- | ------------------------------------------------------- |
| Build Windows zip      | windows-latest | `dist-release/ShelfDeck-v1.1.0/` → artifact             |
| Push Docker image      | ubuntu-latest  | `markmahoro/shelfdeck:v1.1.0` + `:latest` on Docker Hub |
| Generate announcements | ubuntu-latest  | `release-notes/v1.1.0/` → artifact                      |
| Create GitHub Release  | ubuntu-latest  | Release with zip + changelog + announcement assets      |

### 确认 CI 完成

访问 GitHub Actions 页面确认 `release.yml` workflow 全部绿色。

---

## §3 人工收尾（3 步）

### Step 1: 夸克网盘

```
□ 下载 GitHub Release 中的 ShelfDeck-v1.1.0.zip
□ 上传到夸克网盘
□ 获取分享链接
□ 更新 README.md 中的夸克下载链接
□ git commit -m "docs: update quark download link for v1.1.0" && git push
```

夸克网盘上传暂无公开 API，需手动操作。如后续夸克支持 WebDAV 或 CLI，可考虑自动化。

### Step 2: 小红书

```
□ 下载 release-notes/v1.1.0/draft-xiaohongshu.md
□ 审核文案，根据实际截图调整
□ 配图：新功能截图 + 界面展示
□ 发布笔记
```

### Step 3: 知乎

```
□ 下载 release-notes/v1.1.0/draft-zhihu.md
□ 审核文案
□ 发布/更新专栏文章
```

---

## §4 `scripts/release.js` 实现说明

```js
// Usage: node scripts/release.js v1.1.0
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const version = process.argv[2];
if (!version || !/^v\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/release.js vX.Y.Z');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..');
const semver = version.replace('v', '');
const lastTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();

// 1. Verify
const status = execSync('git status --porcelain', { encoding: 'utf8' });
if (status.trim()) throw new Error('git working tree not clean');
const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
if (branch !== 'master') throw new Error('must be on master branch');

// 2. Bump versions
for (const pkg of ['media-service/package.json', 'media-desktop/package.json']) {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, pkg), 'utf8'));
  p.version = semver;
  fs.writeFileSync(path.join(ROOT, pkg), JSON.stringify(p, null, 2) + '\n');
}

// 3. Generate changelog from conventional commits
const log = execSync(
  `git log ${lastTag}..HEAD --pretty=format:"%s"`,
  { encoding: 'utf8' },
);
// ... parse into feat/fix/refactor groups, prepend to CHANGELOG.md

// 4. Update README download links (replace old version with new)

// 5. Generate release-notes/vX.Y.Z/
const notesDir = path.join(ROOT, 'release-notes', version);
fs.mkdirSync(notesDir, { recursive: true });
// ... generate draft-xiaohongshu.md, draft-zhihu.md, draft-readme.md

// 6. Commit
execSync('git add -A', { cwd: ROOT, stdio: 'inherit' });
execSync(`git commit -m "release: ${version}"`, { cwd: ROOT, stdio: 'inherit' });

// 7. Tag
execSync(`git tag -a ${version} -m "${version}"`, { cwd: ROOT, stdio: 'inherit' });

// 8. Push
execSync('git push', { cwd: ROOT, stdio: 'inherit' });
execSync('git push --tags', { cwd: ROOT, stdio: 'inherit' });

console.log(`\nReleased ${version}. Watch CI: https://github.com/<repo>/actions`);
console.log('After CI completes, finish the 3 manual steps in RELEASE_WORKFLOW.md §3.');
```

---

## 关联文档

- `docs/v2/DEVELOPMENT_WORKFLOW.md` — 开发工作流（3-Target Impact Checklist）
- `docs/v2/TEST_ARCHITECTURE.md` — 测试架构
- `.github/workflows/release.yml` — 发版 CD pipeline
