import { useState, useEffect, useCallback } from 'react';
import { nodes, type NodeInfo } from '../api/client';
import Modal from '../components/Modal';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';

const POLL_INTERVAL = 5000;

export default function NodesPage() {
  const [nodeList, setNodeList] = useState<NodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [addApiKey, setAddApiKey] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState<NodeInfo | null>(null);
  const [editName, setEditName] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<NodeInfo | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Success message
  const [success, setSuccess] = useState<string | null>(null);

  const fetchNodes = useCallback(async () => {
    try {
      const data = await nodes.list();
      setNodeList(data.nodes);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch nodes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNodes();
    const timer = setInterval(fetchNodes, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [fetchNodes]);

  const handleAdd = async () => {
    if (!addName.trim() || !addAddress.trim() || !addApiKey.trim()) {
      setAddError('All fields are required');
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      await nodes.create({ name: addName.trim(), address: addAddress.trim(), apiKey: addApiKey });
      setShowAdd(false);
      setAddName(''); setAddAddress(''); setAddApiKey('');
      setSuccess('Node added successfully');
      setTimeout(() => setSuccess(null), 3000);
      fetchNodes();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add node');
    } finally {
      setAddBusy(false);
    }
  };

  const handleDelete = async (force: boolean) => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await nodes.remove(deleteTarget.id, force);
      setDeleteTarget(null);
      setSuccess('Node removed');
      setTimeout(() => setSuccess(null), 3000);
      fetchNodes();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete node');
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleProbe = async (node: NodeInfo) => {
    try {
      await nodes.probe(node.id);
      setSuccess(`Probe successful — ${node.name} devices updated`);
      setTimeout(() => setSuccess(null), 3000);
      fetchNodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Probe failed');
    }
  };

  const openEdit = (node: NodeInfo) => {
    setEditTarget(node);
    setEditName(node.name);
    setEditApiKey('');
    setEditError(null);
    setShowEdit(true);
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    if (!editName.trim()) {
      setEditError('Node name is required');
      return;
    }
    setEditBusy(true);
    setEditError(null);
    try {
      const body: { name?: string; apiKey?: string } = {};
      if (editName.trim() !== editTarget.name) body.name = editName.trim();
      if (editApiKey.trim()) body.apiKey = editApiKey;
      if (Object.keys(body).length === 0) {
        setShowEdit(false);
        return;
      }
      await nodes.update(editTarget.id, body);
      setShowEdit(false);
      setEditTarget(null);
      setSuccess('Node updated');
      setTimeout(() => setSuccess(null), 3000);
      fetchNodes();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update node');
    } finally {
      setEditBusy(false);
    }
  };

  const gpuLabel = (node: NodeInfo) => {
    const devs = node.capabilities?.devices;
    if (!devs || devs.length === 0) return '—';
    return devs.map((d) => d.label).join(', ');
  };

  const formatTime = (ts: string | null | undefined) => {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return ts;
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>转码节点管理</h1>
        <button onClick={() => setShowAdd(true)} style={{ padding: '8px 16px' }}>+ 添加节点</button>
      </div>

      {success && <Alert type="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #444', textAlign: 'left' }}>
              <th style={{ padding: 8 }}>节点名称</th>
              <th style={{ padding: 8 }}>地址</th>
              <th style={{ padding: 8 }}>状态</th>
              <th style={{ padding: 8 }}>GPU</th>
              <th style={{ padding: 8 }}>活跃任务</th>
              <th style={{ padding: 8 }}>最近在线</th>
              <th style={{ padding: 8 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {nodeList.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#888' }}>
                  暂无节点，点击"+ 添加节点"添加
                </td>
              </tr>
            ) : (
              nodeList.map((node) => (
                <tr key={node.id} style={{ borderBottom: '1px solid #333' }}>
                  <td style={{ padding: 8 }}>{node.name}</td>
                  <td style={{ padding: 8, fontFamily: 'monospace' }}>{node.address}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{
                      display: 'inline-block',
                      width: 8, height: 8, borderRadius: '50%',
                      backgroundColor: node.status === 'online' ? '#4caf50' : '#f44336',
                      marginRight: 6,
                    }} />
                    {node.status === 'online' ? '在线' : node.consecutiveFailures >= 3 ? '离线' : '离线'}
                  </td>
                  <td style={{ padding: 8, fontSize: '0.85em' }}>{gpuLabel(node)}</td>
                  <td style={{ padding: 8 }}>{node.activeJobCount}</td>
                  <td style={{ padding: 8, fontSize: '0.8em', color: '#aaa' }}>{formatTime(node.lastSeenAt)}</td>
                  <td style={{ padding: 8 }}>
                    <button
                      onClick={() => openEdit(node)}
                      style={{ marginRight: 6, padding: '4px 10px', fontSize: '0.85em' }}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleProbe(node)}
                      style={{ marginRight: 6, padding: '4px 10px', fontSize: '0.85em' }}
                      title="重新探测 GPU"
                    >
                      重试
                    </button>
                    <button
                      onClick={() => setDeleteTarget(node)}
                      style={{ padding: '4px 10px', fontSize: '0.85em', color: '#f44336' }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}

      <p style={{ marginTop: 12, fontSize: '0.85em', color: '#888' }}>
        状态说明: <span style={{ color: '#4caf50' }}>●在线</span> = 健康检查通过 &nbsp;
        <span style={{ color: '#f44336' }}>○离线</span> = 连续 3 次不通 &nbsp;
        (列表每 5 秒自动刷新)
      </p>

      {/* Add Node Modal */}
      <Modal open={showAdd} title="添加转码节点" onClose={() => { setShowAdd(false); setAddError(null); }}>
          {addError && <Alert type="error" message={addError} onClose={() => setAddError(null)} />}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>节点名称</label>
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="例如: GPU-Node-1"
              style={{ width: '100%', padding: '6px 8px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>节点地址</label>
            <input
              type="text"
              value={addAddress}
              onChange={(e) => setAddAddress(e.target.value)}
              placeholder="例如: 192.168.12.100:19000"
              style={{ width: '100%', padding: '6px 8px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 4 }}>API Key</label>
            <input
              type="password"
              value={addApiKey}
              onChange={(e) => setAddApiKey(e.target.value)}
              placeholder="Worker 的 API Key"
              style={{ width: '100%', padding: '6px 8px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={() => { setShowAdd(false); setAddError(null); }} disabled={addBusy}>取消</button>
            <button onClick={handleAdd} disabled={addBusy} style={{ background: '#4caf50', color: '#fff', border: 'none' }}>
              {addBusy ? '探测中...' : '确认添加'}
            </button>
          </div>
        </Modal>

      {/* Edit Node Modal */}
      <Modal open={showEdit} title="编辑节点" onClose={() => { setShowEdit(false); setEditError(null); }}>
        {editError && <Alert type="error" message={editError} onClose={() => setEditError(null)} />}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>节点名称</label>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            style={{ width: '100%', padding: '6px 8px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: 4 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>API Key</label>
          <input
            type="password"
            value={editApiKey}
            onChange={(e) => setEditApiKey(e.target.value)}
            placeholder="留空则不修改"
            style={{ width: '100%', padding: '6px 8px', boxSizing: 'border-box' }}
          />
        </div>
        <p style={{ fontSize: '0.8em', color: '#888', marginTop: 4 }}>仅在有变更时修改。留空表示保持原 API Key 不变。</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={() => { setShowEdit(false); setEditError(null); }} disabled={editBusy}>取消</button>
          <button onClick={handleEdit} disabled={editBusy} style={{ background: '#4caf50', color: '#fff', border: 'none' }}>
            {editBusy ? '保存中...' : '保存'}
          </button>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <Modal open={true} title="删除节点" onClose={() => { setDeleteTarget(null); setDeleteError(null); }}>
          {deleteError && <Alert type="error" message={deleteError} onClose={() => setDeleteError(null)} />}

          {deleteTarget.activeJobCount > 0 ? (
            <>
              <Alert type="error" message={`节点 ${deleteTarget.name} 有 ${deleteTarget.activeJobCount} 个进行中的任务，删除将导致任务失败。`} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>取消</button>
                <button
                  onClick={() => handleDelete(true)}
                  disabled={deleteBusy}
                  style={{ background: '#f44336', color: '#fff', border: 'none' }}
                >
                  {deleteBusy ? '删除中...' : '强制删除并失败任务'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>确认删除节点 <strong>{deleteTarget.name}</strong> ({deleteTarget.address})?</p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>取消</button>
                <button
                  onClick={() => handleDelete(false)}
                  disabled={deleteBusy}
                  style={{ background: '#f44336', color: '#fff', border: 'none' }}
                >
                  {deleteBusy ? '删除中...' : '确认删除'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
