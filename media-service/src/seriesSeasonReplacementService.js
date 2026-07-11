'use strict';

const fs = require('fs');
const path = require('path');

function episodeKeyFromPath(filePath) {
  const match = path.basename(filePath).match(/S(\d{1,3})E(\d{1,4})(?:[-_. ]?P(\d+))?/i);
  return match ? { seasonKey: String(Number(match[1])), episodeKey: String(Number(match[2])), partKey: match[3] ? String(Number(match[3])) : '' } : null;
}

function mediaFiles(root) {
  const extensions = new Set(['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov']);
  const rows = [];
  const visit = (entry) => {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) for (const name of fs.readdirSync(entry)) visit(path.join(entry, name));
    else if (extensions.has(path.extname(entry).toLowerCase())) rows.push(entry);
  };
  visit(root);
  return rows.sort();
}

function inspectPackage(root, currentAssets, seasonKey) {
  const parsedFiles = mediaFiles(root).map((filePath) => ({ filePath, key: episodeKeyFromPath(filePath) })).filter((entry) => entry.key);
  const files = parsedFiles.filter((entry) => entry.key.seasonKey === String(seasonKey));
  if (parsedFiles.length > 0 && files.length === 0) throw Object.assign(new Error('Season package contains a different Season'), { code: 'SERIES_SEASON_PACKAGE_SEASON_MISMATCH', details: { expectedSeasonKey: String(seasonKey), observedSeasonKeys: [...new Set(parsedFiles.map((entry) => entry.key.seasonKey))] } });
  const current = currentAssets.filter((asset) => String(asset.seasonKey) === String(seasonKey));
  const packageKeys = new Set(files.map((entry) => `${entry.key.episodeKey}:${entry.key.partKey}`));
  const missing = current.filter((asset) => !packageKeys.has(`${asset.episodeKey}:${asset.partKey || ''}`)).map((asset) => asset.assetId);
  if (missing.length) throw Object.assign(new Error('Season package is not a superset of managed Episodes'), { code: 'SERIES_SEASON_PACKAGE_NOT_SUPERSET', details: { missing } });
  return { files, current, missing, superset: true };
}

function replaceSeason({ packageRoot, currentAssets, seasonKey, operationId }) {
  const inspection = inspectPackage(packageRoot, currentAssets, seasonKey);
  const currentPaths = inspection.current.map((asset) => asset.canonicalLocator && asset.canonicalLocator.path).filter(Boolean);
  if (!currentPaths.length) throw Object.assign(new Error('Managed Season has no canonical paths'), { code: 'SERIES_SEASON_TARGET_MISSING' });
  const targetDir = path.dirname(currentPaths[0]);
  if (!currentPaths.every((entry) => path.dirname(entry) === targetDir)) throw Object.assign(new Error('Managed Season is not contained by one directory'), { code: 'SERIES_SEASON_TARGET_SPLIT' });
  const parent = path.dirname(targetDir);
  const backup = path.join(parent, `.${path.basename(targetDir)}.shelfdeck-backup-${operationId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
  const incoming = path.join(parent, `.${path.basename(targetDir)}.shelfdeck-incoming-${operationId.replace(/[^A-Za-z0-9_-]/g, '_')}`);
  if (fs.existsSync(backup) && !fs.existsSync(targetDir) && fs.existsSync(incoming)) {
    fs.renameSync(incoming, targetDir);
    try { fs.rmSync(backup, { recursive: true, force: true }); } catch (_) {}
    return { targetPath: targetDir, backupPath: backup, replacedAssetCount: inspection.current.length, packageAssetCount: inspection.files.length, recoveredCommit: true,
      installedAssets: inspection.files.map((entry) => ({ ...entry.key, path: path.join(targetDir, path.relative(packageRoot, entry.filePath)) })) };
  }
  if (fs.existsSync(backup) && fs.existsSync(targetDir)) {
    try { fs.rmSync(backup, { recursive: true, force: true }); } catch (_) {}
    return { targetPath: targetDir, backupPath: backup, replacedAssetCount: inspection.current.length, packageAssetCount: inspection.files.length, recoveredCommit: true,
      installedAssets: inspection.files.map((entry) => ({ ...entry.key, path: path.join(targetDir, path.relative(packageRoot, entry.filePath)) })) };
  }
  if (fs.existsSync(incoming)) fs.rmSync(incoming, { recursive: true, force: true });
  fs.mkdirSync(incoming, { recursive: false });
  try {
    for (const entry of inspection.files) {
      const relative = path.relative(packageRoot, entry.filePath);
      const destination = path.join(incoming, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(entry.filePath, destination, fs.constants.COPYFILE_EXCL);
    }
    for (const name of fs.readdirSync(targetDir)) {
      const source = path.join(targetDir, name);
      const destination = path.join(incoming, name);
      if (!fs.statSync(source).isFile() || fs.existsSync(destination) || episodeKeyFromPath(source)) continue;
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    }
    fs.renameSync(targetDir, backup);
    try { fs.renameSync(incoming, targetDir); } catch (error) { fs.renameSync(backup, targetDir); throw error; }
    let backupRetained = false;
    try { fs.rmSync(backup, { recursive: true, force: true }); } catch (_) { backupRetained = true; }
    return { targetPath: targetDir, backupPath: backup, replacedAssetCount: inspection.current.length, packageAssetCount: inspection.files.length,
      backupRetained, installedAssets: inspection.files.map((entry) => ({ ...entry.key, path: path.join(targetDir, path.relative(packageRoot, entry.filePath)) })) };
  } catch (error) {
    if (fs.existsSync(incoming)) fs.rmSync(incoming, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { episodeKeyFromPath, mediaFiles, inspectPackage, replaceSeason };
