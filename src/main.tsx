import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import App from './App';
import './index.css';

import { ErrorBoundary } from './components/ErrorBoundary';
import { runStorageMigration } from './services/storage';
import { credentialCoordinator } from './services/credentialCoordinator';

// Run storage migration (sanitizes stored secrets from v1 into session memory)
runStorageMigration();

// Single idempotent startup restoration for Android Keystore credentials (no-op on web)
credentialCoordinator.initialize();

if (Capacitor.isNativePlatform()) {
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#121c17' }).catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

