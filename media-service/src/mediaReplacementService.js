'use strict';

const fs = require('fs');
const path = require('path');
const transcodeService = require('./services/transcodeService');

async function copyDirectory(source, destination) {
  await fs.promises.mkdir(destination, { recursive: true });
  for (const entry of await fs.promises.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name); const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) await fs.promises.copyFile(from, to);
  }
}

async function replaceFolder({ stagedFolder, targetFolder, operationId }) {
  if (!stagedFolder || !targetFolder) throw Object.assign(new Error('Folder replacement paths are missing'), { code: 'FOLDER_REPLACE_PATH_MISSING' });
  const suffix = String(operationId || Date.now()).replace(/[^A-Za-z0-9_-]/g, '_');
  const backupFolder = `${targetFolder}.shelfdeck-backup-${suffix}`;
  const newFolder = `${targetFolder}.shelfdeck-new-${suffix}`;
  const targetExists = fs.existsSync(targetFolder); const stagedExists = fs.existsSync(stagedFolder); const backupExists = fs.existsSync(backupFolder);
  if (!stagedExists && targetExists && !backupExists) return { replacementScope: 'folder', targetFolder, recoveredCommitted: true };
  if (!stagedExists) throw Object.assign(new Error('Staged replacement folder is missing'), { code: 'FOLDER_REPLACE_STAGED_MISSING' });
  await fs.promises.rm(newFolder, { recursive: true, force: true });
  try {
    if (targetExists && !backupExists) await fs.promises.rename(targetFolder, backupFolder);
    await copyDirectory(stagedFolder, newFolder);
    await fs.promises.rename(newFolder, targetFolder);
    await fs.promises.rm(stagedFolder, { recursive: true, force: true });
    await fs.promises.rm(backupFolder, { recursive: true, force: true });
    return { replacementScope: 'folder', targetFolder, backupFolder, committed: true };
  } catch (error) {
    await fs.promises.rm(newFolder, { recursive: true, force: true }).catch(() => {});
    if (!fs.existsSync(targetFolder) && fs.existsSync(backupFolder)) await fs.promises.rename(backupFolder, targetFolder).catch(() => {});
    throw error;
  }
}

async function replaceVerifiedAsset({ config, verifiedAsset, operationId }) {
  const staged = verifiedAsset.stagedAsset || {};
  if (staged.replacementScope === 'folder') return replaceFolder({ stagedFolder: staged.stagedRoot, targetFolder: staged.targetFolder || path.dirname(verifiedAsset.sourcePath), operationId });
  return transcodeService.replaceWithRetries({ config, targetPath: verifiedAsset.sourcePath, partialPath: verifiedAsset.outputPath, ...(staged.replacementScope === 'disc' ? { originalDiscPath: staged.originalDiscPath } : {}) });
}

module.exports = { replaceVerifiedAsset, replaceFolder, copyDirectory };
