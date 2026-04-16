import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

window.addEventListener('error', (event) => {
  // eslint-disable-next-line no-console
  console.error('[renderer-error]', event.error || event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  // eslint-disable-next-line no-console
  console.error('[renderer-unhandledrejection]', event.reason);
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
