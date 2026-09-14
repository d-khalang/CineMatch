import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { MovieStoreProvider, useMovieStore } from './store/useMovieStore';
import { Navbar } from './components/Navbar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { TasteCalibration } from './components/TasteCalibration';
import { RankedFeed } from './components/RankedFeed';
import { MyRatings } from './components/MyRatings';
import { Watchlist } from './components/Watchlist';
import { Toast } from './components/Toast';
import { retryPendingStorageChanges } from './services/storage';
import { credentialCoordinator } from './services/credentialCoordinator';

// Code-split secondary modals and views for fast initial load
const MovieDetailsModal = lazy(() =>
  import('./components/MovieDetailsModal').then((m) => ({ default: m.MovieDetailsModal }))
);
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal }))
);
const CsvImportModal = lazy(() =>
  import('./components/CsvImportModal').then((m) => ({ default: m.CsvImportModal }))
);
const PaletteSwitcher = lazy(() =>
  import('./components/PaletteSwitcher').then((m) => ({ default: m.PaletteSwitcher }))
);

const MainAppContent: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    selectedMovieForModal,
    setSelectedMovieForModal,
    showToast,
    storageWarning,
  } = useMovieStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState<boolean>(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);
  const [coordState, setCoordState] = useState(() => credentialCoordinator.getState());
  const lastBackPressRef = useRef<number>(0);

  useEffect(() => {
    return credentialCoordinator.subscribe(() => {
      setCoordState(credentialCoordinator.getState());
    });
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const backListener = CapApp.addListener('backButton', ({ canGoBack }) => {
      // 1. Dismiss modals first in hierarchical order
      if (selectedMovieForModal) {
        setSelectedMovieForModal(null);
      } else if (isSettingsOpen) {
        setIsSettingsOpen(false);
      } else if (isPaletteOpen) {
        setIsPaletteOpen(false);
      } else if (isCsvModalOpen) {
        setIsCsvModalOpen(false);
      } else if (activeTab !== 'rankings') {
        setActiveTab('rankings');
      } else if (canGoBack) {
        window.history.back();
      } else {
        // Double-tap to exit confirmation on root screen
        const now = Date.now();
        if (now - lastBackPressRef.current < 2000) {
          CapApp.exitApp();
        } else {
          lastBackPressRef.current = now;
          showToast('Press back again to exit CineMatch');
        }
      }
    });

    return () => {
      backListener.then((handler) => handler.remove());
    };
  }, [
    selectedMovieForModal,
    isSettingsOpen,
    isPaletteOpen,
    isCsvModalOpen,
    activeTab,
    setSelectedMovieForModal,
    setActiveTab,
    showToast,
  ]);

  return (
    <div className="min-h-screen text-slate-100 flex flex-col selection:bg-[var(--accent-primary)] selection:text-black pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-0 transition-colors duration-300">
      {/* Header Navigation */}
      <Navbar
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenPalette={() => setIsPaletteOpen(true)}
      />

      {/* Vault Restore Error Recovery Banner */}
      {coordState.status === 'error' && (
        <div
          role="alert"
          className="bg-rose-950/80 border-b border-rose-500/30 px-4 py-2.5 text-xs text-rose-200 flex flex-wrap items-center justify-between gap-3 shadow-md"
        >
          <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1">
            <span className="shrink-0 font-bold">⚠️ Security Storage Alert:</span>
            <span>
              Saved credentials could not be decrypted ({coordState.lastError?.message || 'Storage error'}). You can retry, use session-only mode, or reset saved keys. Your movie data is safe.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => credentialCoordinator.retryRestore()}
              className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-bold transition-colors cursor-pointer"
            >
              Retry
            </button>
            <button
              onClick={() => credentialCoordinator.continueSessionOnly()}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-colors cursor-pointer"
            >
              Session Only
            </button>
            <button
              onClick={() => credentialCoordinator.resetVault()}
              className="px-3 py-1 bg-rose-900/60 hover:bg-rose-900 text-rose-300 rounded-lg font-medium transition-colors cursor-pointer"
            >
              Reset Saved Keys
            </button>
          </div>
        </div>
      )}

      {/* Storage Warning Recovery Banner */}
      {storageWarning && (
        <div role="alert" className="bg-amber-950/80 border-b border-amber-500/30 px-4 py-2.5 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1">
            <span className="shrink-0 font-bold">⚠️ Storage Alert:</span>
            <span>{storageWarning} Keep this app open until retry succeeds; unsaved changes may be lost on restart.</span>
          </div>
          <button
            onClick={() => showToast(retryPendingStorageChanges()
              ? 'Storage changes saved.'
              : 'Storage is still unavailable. Your changes remain pending.')}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shrink-0 transition-colors cursor-pointer"
          >
            Retry saving
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shrink-0 transition-colors cursor-pointer"
          >
            Export Ratings
          </button>
        </div>
      )}

      {/* Main Body Router */}
      <main className="flex-grow pt-6 sm:pt-8">
        {activeTab === 'calibration' && <TasteCalibration />}
        {activeTab === 'rankings' && <RankedFeed />}
        {activeTab === 'watchlist' && <Watchlist />}
        {activeTab === 'library' && (
          <MyRatings onOpenCsvModal={() => setIsCsvModalOpen(true)} />
        )}
      </main>

      {/* Lazily Loaded Global Modals */}
      <Suspense fallback={null}>
        <MovieDetailsModal />
        {isSettingsOpen && <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />}
        {isCsvModalOpen && <CsvImportModal isOpen={isCsvModalOpen} onClose={() => setIsCsvModalOpen(false)} />}
        {isPaletteOpen && <PaletteSwitcher isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} />}
      </Suspense>

      <Toast />

      {/* Mobile Bottom Tab Bar */}
      <MobileBottomNav onOpenSettings={() => setIsSettingsOpen(true)} />
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <MovieStoreProvider>
      <MainAppContent />
    </MovieStoreProvider>
  );
};

export default App;
