import React from 'react';
import { Trophy, SlidersHorizontal, Film, Settings, Sparkles } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';

interface NavbarProps {
  onOpenSettings: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenSettings }) => {
  const { activeTab, setActiveTab, ratings, aiSettings } = useMovieStore();
  const ratedCount = Object.keys(ratings).length;

  const navItems = [
    { id: 'rankings', label: 'Top Ranked', icon: Trophy, badge: null },
    { id: 'calibration', label: 'Taste Calibration', icon: SlidersHorizontal, badge: ratedCount > 0 ? `${ratedCount}` : null },
    { id: 'library', label: 'My Ratings', icon: Film, badge: null },
  ];

  const getProviderName = () => {
    if (aiSettings.activeProvider === 'gemini') return `Gemini AI (${aiSettings.geminiModel || '2.5 Flash'})`;
    if (aiSettings.activeProvider === 'openrouter') return 'OpenRouter AI';
    return 'Local Smart Engine';
  };

  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Logo & Brand */}
        <div
          onClick={() => setActiveTab('calibration')}
          className="flex items-center gap-2.5 cursor-pointer group select-none"
        >
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 p-0.5 shadow-lg shadow-indigo-950 group-hover:scale-105 transition-transform flex items-center justify-center">
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-indigo-400 fill-indigo-400/20" />
            </div>
          </div>
          <div>
            <span className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-1.5">
              CineMatch <span className="text-xs px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 font-bold border border-indigo-500/30">AI</span>
            </span>
            <p className="text-[10px] text-slate-400 font-medium hidden sm:block">
              Continuous Movie Ranking & Discovery
            </p>
          </div>
        </div>

        {/* Desktop Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1.5 p-1 rounded-2xl bg-slate-900/80 border border-slate-800">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isActive ? 'bg-indigo-700 text-white' : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right Actions: AI Model Badge & Settings */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={onOpenSettings}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-slate-700 text-xs text-slate-300 transition-colors cursor-pointer"
            title="Configure AI Provider"
          >
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-medium text-slate-300">{getProviderName()}</span>
          </button>

          <button
            onClick={onOpenSettings}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-600 transition-all cursor-pointer shadow-sm"
            title="Open Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
