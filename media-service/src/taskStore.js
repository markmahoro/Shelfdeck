'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveDataDir() {
  return (
    process.env.CONTROL_PLANE_DATA_DIR ||
    process.env.MEDIA_SERVICE_DATA_DIR ||
    path.join(__dirname, '..', 'data')
  );
}

function tasksFilePath() {
  return path.join(resolveDataDir(), 'tasks.json');
}

function ensureDataDir() {
  const dir = resolveDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

function loadTasks() {
  ensureDataDir();
  const f = tasksFilePath();
  if (!fs.existsSync(f)) return [];
  try {
    const raw = fs.readFileSync(f, 'utf8');
    if (!raw || !raw.trim()) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('[taskStore] failed to load tasks:', err.message);
    try {
      const bak = f + '.bak.' + Date.now();
      fs.copyFileSync(f, bak);
      console.error('[taskStore] corrupted file backed up to', bak);
    } catch (_) {}
    return [];
  }
}

function saveTasks(tasks) {
  ensureDataDir();
  const f = tasksFilePath();
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(tasks, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, f);
  } catch (err) {
    if (err.code === 'EPERM') {
      try { fs.unlinkSync(f); } catch (_) {}
      fs.renameSync(tmp, f);
    } else {
      throw err;
    }
  }
}

function createTask(taskData) {
  const tasks = loadTasks();
  const now = new Date().toISOString();
  const task = {
    id: generateId(),
    itemId: taskData.itemId || '',
    itemName: taskData.itemName || (taskData.itemInfo && taskData.itemInfo.name) || '',
    actionType: taskData.actionType,
    status: taskData.status || 'created',
    progress: 0,
    phase: null,
    resumePoint: null,
    createdAt: now,
    updatedAt: now,
    logs: [],
    itemInfo: taskData.itemInfo || null,
  };
  tasks.push(task);
  saveTasks(tasks);
  return task;
}

function getTask(taskId) {
  return loadTasks().find((t) => t.id === taskId) || null;
}

function getTasks(filter = {}) {
  let tasks = loadTasks();
  if (filter.status) tasks = tasks.filter((t) => t.status === filter.status);
  if (filter.actionType) tasks = tasks.filter((t) => t.actionType === filter.actionType);
  if (filter.itemId) tasks = tasks.filter((t) => t.itemId === filter.itemId);
  if (filter.q) {
    const q = filter.q.toLowerCase();
    tasks = tasks.filter((t) => {
      const name = (t.itemName || (t.itemInfo && t.itemInfo.name) || t.itemId || '').toLowerCase();
      return name.includes(q);
    });
  }
  return tasks;
}

function updateTask(taskId, updates) {
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;

  const current = tasks[idx];
  let final = { ...updates };

  // Append semantics for logs array
  if (Array.isArray(updates.logs)) {
    const existing = Array.isArray(current.logs) ? current.logs : [];
    final.logs = [...existing, ...updates.logs];
  }

  tasks[idx] = { ...current, ...final, updatedAt: new Date().toISOString() };
  saveTasks(tasks);
  return tasks[idx];
}

function deleteTask(taskId) {
  const tasks = loadTasks();
  const filtered = tasks.filter((t) => t.id !== taskId);
  if (filtered.length === tasks.length) return false;
  saveTasks(filtered);
  return true;
}

module.exports = { createTask, getTask, getTasks, updateTask, deleteTask, loadTasks, saveTasks };
