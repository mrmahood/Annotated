import React from 'react';
import ReactDOM from 'react-dom/client';
import { installAppearanceRuntime } from '../../utils/appearance';
import App from './App';
import './style.css';

function localStorageOrNull() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

installAppearanceRuntime(
  document.documentElement,
  chrome,
  localStorageOrNull(),
  window.matchMedia.bind(window),
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
