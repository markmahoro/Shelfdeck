/* global window, document */
const ctl = window.trayCtl;

function $(id) {
  return document.getElementById(id);
}

function setDot(kind) {
  const d = $('dot');
  d.className = 'dot dot-' + (kind === 'green' ? 'green' : kind === 'red' ? 'red' : 'yellow');
}

async function refresh() {
  const snap = await ctl.snapshot();
  $('addr').textContent = snap.displayBaseUrl || '未配置服务器地址';
  $('keyLine').textContent = snap.apiKeySet ? 'API Key：已设置' : 'API Key：未设置';
  $('statusText').textContent = snap.statusText || '';
  setDot(snap.dotKind || 'yellow');
  $('queue').textContent = snap.queueSummary || '—';
  $('ctlHint').textContent = snap.controlHint || '';
  const canCtl = Boolean(snap.controlsEnabled);
  $('btnStart').disabled = !canCtl;
  $('btnStop').disabled = !canCtl;
  $('btnRestart').disabled = !canCtl;
  $('chkAutostart').checked = Boolean(snap.settings?.startWithWindows);
  $('chkQuitKill').checked = Boolean(snap.settings?.quitStopLocalService);
}

$('btnDesktop').addEventListener('click', () => {
  void ctl.openDesktop();
});

$('btnConn').addEventListener('click', () => {
  $('connForm').style.display = 'block';
  $('saveMsg').textContent = '';
});

$('btnCancelConn').addEventListener('click', () => {
  $('connForm').style.display = 'none';
});

$('btnSaveConn').addEventListener('click', async () => {
  const btn = $('btnSaveConn');
  btn.disabled = true;
  $('saveMsg').textContent =
    '校验中；若未通过将尝试按地址启动服务（本机可自动启动，远端需先在服务器侧启动），可能需要数十秒…';
  const baseUrl = $('inUrl').value.trim();
  const apiKey = $('inKey').value.trim();
  try {
    const r = await ctl.saveConnection({ baseUrl, apiKey });
    if (r.ok) {
      $('saveMsg').textContent = '已保存，连接可用。';
      $('connForm').style.display = 'none';
      await refresh();
    } else {
      $('saveMsg').textContent = r.message || '保存失败';
    }
  } finally {
    btn.disabled = false;
  }
});

['btnStart', 'btnStop', 'btnRestart'].forEach((id) => {
  $(id).addEventListener('click', async () => {
    if (id === 'btnStart') await ctl.startService();
    if (id === 'btnStop') await ctl.stopService();
    if (id === 'btnRestart') await ctl.restartService();
    await refresh();
  });
});

$('chkAutostart').addEventListener('change', async (e) => {
  await ctl.updateSettings({ startWithWindows: e.target.checked });
  await refresh();
});

$('chkQuitKill').addEventListener('change', async (e) => {
  await ctl.updateSettings({ quitStopLocalService: e.target.checked });
  await refresh();
});

void refresh();
setInterval(() => void refresh(), 2500);
