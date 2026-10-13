import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import Debug from './components/Debug.jsx';

// keep the last few errors so the ?debug panel (and the console) can show why something did not render
window.__naqshaErrors = [];
const keep = (m) => { window.__naqshaErrors.push(String(m).slice(0, 220)); window.__naqshaErrors = window.__naqshaErrors.slice(-6); };
window.addEventListener('error', (e) => keep(e.message));
window.addEventListener('unhandledrejection', (e) => keep(e.reason?.message || e.reason));

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {new URLSearchParams(location.search).has('debug') && <Debug />}
  </StrictMode>,
);
