'use strict';

/**
 * NodeStore — persist worker node registry to data/nodes.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE_PATH = path.join(DATA_DIR, 'nodes.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadNodes() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function saveNodes(nodes) {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(nodes, null, 2), 'utf8');
}

function getNode(id) {
  const nodes = loadNodes();
  return nodes.find((n) => n.id === id) || null;
}

function addNode({ name, address, apiKey, capabilities }) {
  const nodes = loadNodes();
  const id = crypto.randomBytes(8).toString('hex');

  // Mark all devices as not-in-pool by default
  const devices = (capabilities && capabilities.devices || []).map((d) => ({ ...d, inPool: false }));

  const node = {
    id,
    name: String(name || '').trim(),
    address: String(address || '').trim(),
    apiKey: String(apiKey || '').trim(),
    status: 'online',
    capabilities: { devices },
    consecutiveFailures: 0,
    lastSeenAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  nodes.push(node);
  saveNodes(nodes);
  return node;
}

function updateNode(id, patch) {
  const nodes = loadNodes();
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return null;

  const allowed = ['name', 'address', 'apiKey', 'status', 'capabilities',
    'consecutiveFailures', 'lastSeenAt'];
  for (const k of allowed) {
    if (patch[k] !== undefined) nodes[idx][k] = patch[k];
  }
  nodes[idx].updatedAt = new Date().toISOString();
  saveNodes(nodes);
  return nodes[idx];
}

function deleteNode(id) {
  const nodes = loadNodes();
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return false;
  nodes.splice(idx, 1);
  saveNodes(nodes);
  return true;
}

/**
 * Record a health check result.
 * If online, reset consecutiveFailures and update lastSeenAt.
 * If offline, increment consecutiveFailures; mark offline at threshold.
 */
function recordHealthCheck(id, online) {
  const nodes = loadNodes();
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx < 0) return null;

  if (online) {
    nodes[idx].lastSeenAt = new Date().toISOString();
    nodes[idx].consecutiveFailures = 0;
    if (nodes[idx].status === 'offline') {
      nodes[idx].status = 'online';
    }
  } else {
    nodes[idx].consecutiveFailures = (nodes[idx].consecutiveFailures || 0) + 1;
    if (nodes[idx].consecutiveFailures >= 3) {
      nodes[idx].status = 'offline';
    }
  }
  nodes[idx].updatedAt = new Date().toISOString();
  saveNodes(nodes);
  return nodes[idx];
}

function getOnlineNodes() {
  return loadNodes().filter((n) => n.status === 'online');
}

/**
 * Count active (executing) tasks assigned to a node.
 * @param {string} nodeId
 * @param {object} taskStore - taskStore module
 * @returns {number}
 */
function getNodeActiveJobCount(nodeId, taskStore) {
  try {
    const tasks = taskStore.loadTasks();
    return tasks.filter((t) => t.nodeId === nodeId && t.status === 'executing').length;
  } catch (_) { return 0; }
}

/**
 * Merge probed devices into an existing node, preserving inPool flags.
 */
function mergeCapabilities(nodeId, newDevices) {
  const node = getNode(nodeId);
  if (!node) return;

  const oldDevices = (node.capabilities && node.capabilities.devices) || [];
  const oldMap = new Map(oldDevices.map((d) => [d.stableKey, d]));

  const merged = newDevices.map((d) => ({
    ...d,
    inPool: oldMap.has(d.stableKey) ? oldMap.get(d.stableKey).inPool : false,
  }));

  updateNode(nodeId, { capabilities: { devices: merged } });
}

/**
 * Toggle a device in/out of pool for a given node, optionally update priority/maxSlots.
 */
function setDeviceInPool(nodeId, stableKey, inPool, extra) {
  const node = getNode(nodeId);
  if (!node) return false;

  const devices = (node.capabilities && node.capabilities.devices) || [];
  const idx = devices.findIndex((d) => d.stableKey === stableKey);
  if (idx < 0) return false;

  devices[idx] = {
    ...devices[idx],
    inPool: !!inPool,
    priority: extra && typeof extra.priority === 'number' ? extra.priority : devices[idx].priority || 150,
    maxSlots: extra && typeof extra.maxSlots === 'number' ? extra.maxSlots : devices[idx].maxSlots || 1,
  };
  updateNode(nodeId, { capabilities: { devices } });
  return true;
}

module.exports = {
  loadNodes, getNode, addNode, updateNode, deleteNode,
  recordHealthCheck, getOnlineNodes, getNodeActiveJobCount,
  setDeviceInPool, mergeCapabilities,
};
