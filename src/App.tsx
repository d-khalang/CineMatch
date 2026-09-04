import React, { useState } from 'react';
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

const MainAppContent: React.FC = () => {
  const { activeTab } = useMovieStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState<boolean>(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white pb-16 md:pb-0">
      {/* Header Navigation */}
      <Navbar onOpenSettings={() => setIsSettingsOpen(true)} />

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
