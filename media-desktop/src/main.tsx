import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installDevEmbyStub } from './devEmbyStub';
import './styles.css';

if (import.meta.env.DEV) {
  installDevEmbyStub();
}

function renderFatal(message: string) {
  const root = document.getElementById('root');
  if (!root) return;
  root.innerHTML = `<div style="padding:16px;font-family:Segoe UI, sans-serif;color:#fecaca;background:#111827;">
    <h2 style="margin:0 0 8px;">Renderer Fatal Error</h2>
    <pre style="white-space:pre-wrap;">${message.replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m] || m))}</pre>
  </div>`;
}

window.addEventListener('error', (event) => {
  // eslint-disable-next-line no-console
  console.error('[renderer-error]', event.error || event.message);
  renderFatal(String(event.error || event.message || 'Unknown renderer error'));
});
window.addEventListener('unhandledrejection', (event) => {
  // eslint-disable-next-line no-console
  console.error('[renderer-unhandledrejection]', event.reason);
  renderFatal(String(event.reason || 'Unhandled promise rejection'));
});

try {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[renderer-bootstrap-fatal]', e);
  renderFatal(String(e));
}
