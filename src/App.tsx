import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { MovieStoreProvider, useMovieStore } from './store/useMovieStore';
import { Navbar } from './components/Navbar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { TasteCalibration } from './components/TasteCalibration';
import { RankedFeed } from './components/RankedFeed';
import { MyRatings } from './components/MyRatings';
import { Watchlist } from './components/Watchlist';
import { MovieDetailsModal } from './components/MovieDetailsModal';
import { SettingsModal } from './components/SettingsModal';
import { CsvImportModal } from './components/CsvImportModal';
import { Toast } from './components/Toast';
import { PaletteSwitcher } from './components/PaletteSwitcher';

const MainAppContent: React.FC = () => {
  const { activeTab, setActiveTab, selectedMovieForModal, setSelectedMovieForModal } = useMovieStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState<boolean>(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const backListener = CapApp.addListener('backButton', ({ canGoBack }) => {
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
        CapApp.exitApp();
      }
    });

    return () => {
      backListener.then((handler) => handler.remove());
    };
  }, [selectedMovieForModal, isSettingsOpen, isPaletteOpen, isCsvModalOpen, activeTab, setSelectedMovieForModal, setActiveTab]);

  return (
    <div className="min-h-screen text-slate-100 flex flex-col selection:bg-[var(--accent-primary)] selection:text-black pb-16 md:pb-0 transition-colors duration-300">
      {/* Header Navigation */}
      <Navbar
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenPalette={() => setIsPaletteOpen(true)}
      />

      {/* Main Body Router */}
      <main className="flex-grow pt-6 sm:pt-8">
        {activeTab === 'calibration' && <TasteCalibration />}
        {activeTab === 'rankings' && <RankedFeed />}
        {activeTab === 'watchlist' && <Watchlist />}
        {activeTab === 'library' && (
          <MyRatings onOpenCsvModal={() => setIsCsvModalOpen(true)} />
        )}
      </main>

      {/* Global Modals */}
      <MovieDetailsModal />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <CsvImportModal isOpen={isCsvModalOpen} onClose={() => setIsCsvModalOpen(false)} />
      <PaletteSwitcher isOpen={isPaletteOpen} onClose={() => setIsPaletteOpen(false)} />
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
