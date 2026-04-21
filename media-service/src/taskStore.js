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
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to load tasks:', err.message);
    return [];
  }
}

function saveTasks(tasks) {
  ensureDataDir();
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf8');
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
  tasks[index] = {
    ...tasks[index],
    ...updates,
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

function getSchedulableTasks(executionMode, concurrencyLimits) {
  const tasks = loadTasks();
  const byType = { delete: [], transcode: [], upgrade: [] };

  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'failed_hard') continue;
    if (executionMode === 'manual' && task.status === 'pending_manual') continue;
    if (byType[task.actionType]) {
      byType[task.actionType].push(task);
    }
  }

  return byType;
}

module.exports = {
  createTask,
  getTask,
  getTasks,
  updateTask,
  deleteTask,
  loadTasks,
  saveTasks,
  getSchedulableTasks,
};
