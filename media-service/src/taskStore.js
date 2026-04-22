'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function loadTasks() {
  ensureDataDir();
  if (!fs.existsSync(TASKS_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(TASKS_FILE, 'utf8');
    if (!raw || !raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load tasks:', err.message);
    // JSON 损坏时，尝试备份损坏文件并返回空数组，避免持续崩溃
    try {
      const bakFile = TASKS_FILE + '.bak.' + Date.now();
      fs.copyFileSync(TASKS_FILE, bakFile);
      console.error(`Tasks file corrupted, backed up to ${bakFile}`);
    } catch (_) {}
    return [];
  }
}

function saveTasks(tasks) {
  ensureDataDir();
  // 原子写入：先写临时文件，再 rename。
  // Windows 上 rename 到已存在的目标文件可能 EPERM，需先删除目标。
  const tmpFile = TASKS_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(tasks, null, 2), 'utf8');
  try {
    fs.renameSync(tmpFile, TASKS_FILE);
  } catch (err) {
    if (err.code === 'EPERM') {
      // Windows: 目标文件被占用，先删除再 rename
      try { fs.unlinkSync(TASKS_FILE); } catch (_) {}
      try { fs.renameSync(tmpFile, TASKS_FILE); } catch (_2) {}
    }
  }
}

function createTask(taskData) {
  const tasks = loadTasks();
  const now = new Date().toISOString();
  const task = {
    id: generateId(),
    itemId: taskData.itemId || '',
    itemName: taskData.itemName || '',
    actionType: taskData.actionType,
    status: taskData.status || 'pending_manual',
    progress: 0,
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    ...taskData,
  };
  tasks.push(task);
  saveTasks(tasks);
  return task;
}

function getTask(taskId) {
  const tasks = loadTasks();
  return tasks.find((t) => t.id === taskId);
}

function getTasks(filter = {}) {
  let tasks = loadTasks();
  if (filter.status) {
    tasks = tasks.filter((t) => t.status === filter.status);
  }
  if (filter.actionType) {
    tasks = tasks.filter((t) => t.actionType === filter.actionType);
  }
  if (filter.itemId) {
    tasks = tasks.filter((t) => t.itemId === filter.itemId);
  }
  return tasks;
}

function updateTask(taskId, updates) {
  const tasks = loadTasks();
  const index = tasks.findIndex((t) => t.id === taskId);
  if (index === -1) return null;

  // flowLog 追加语义：如果 updates 中有 flowLog 且为数组，
  // 则将新条目合并到现有 flowLog 后面，而不是整体覆盖
  const current = tasks[index];
  let finalUpdates = { ...updates };
  if (Array.isArray(updates.flowLog)) {
    const existingLog = Array.isArray(current.flowLog) ? current.flowLog : [];
    finalUpdates.flowLog = [...existingLog, ...updates.flowLog];
  }

  tasks[index] = {
    ...tasks[index],
    ...finalUpdates,
    updatedAt: new Date().toISOString(),
  };
  saveTasks(tasks);
  return tasks[index];
}

function deleteTask(taskId) {
  const tasks = loadTasks();
  const filtered = tasks.filter((t) => t.id !== taskId);
  if (filtered.length === tasks.length) return false;
  saveTasks(filtered);
  return true;
}
module.exports = {
  createTask,
  getTask,
  getTasks,
  updateTask,
  deleteTask,
  loadTasks,
  saveTasks,
};
