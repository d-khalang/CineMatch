import React from 'react';
import { Trophy, SlidersHorizontal, Film, Settings, Bookmark, Palette, Sparkles } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { CineMatchLogo } from './CineMatchLogo';

interface NavbarProps {
  onOpenSettings: () => void;
  onOpenPalette?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenSettings, onOpenPalette }) => {
  const { activeTab, setActiveTab, ratings, watchlist, aiSettings } = useMovieStore();
  const ratedCount = Object.keys(ratings).length;
  const watchlistCount = watchlist.length;

  const navItems = [
    { id: 'calibration', label: 'Taste Calibration', icon: SlidersHorizontal, badge: null },
    { id: 'rankings', label: 'Top Ranked', icon: Trophy, badge: null },
    { id: 'watchlist', label: 'Watchlist', icon: Bookmark, badge: watchlistCount > 0 ? `${watchlistCount}` : null },
    { id: 'library', label: 'My Ratings', icon: Film, badge: ratedCount > 0 ? `${ratedCount}` : null },
  ];

  const getProviderName = () => {
    if (aiSettings.activeProvider === 'gemini') return `Gemini AI (${aiSettings.geminiModel || '2.5 Flash'})`;
    if (aiSettings.activeProvider === 'openrouter') return 'OpenRouter AI';
    return 'Local Engine';
  };

  return (
    <header className="sticky top-0 z-40 w-full px-3 sm:px-6 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1 sm:pt-3 transition-all duration-300">
      <div className="max-w-7xl mx-auto rounded-full bg-[var(--bg-surface)]/85 backdrop-blur-2xl border border-[var(--border-subtle)] shadow-[0_8px_32px_rgba(0,0,0,0.36)] h-14 sm:h-16 px-3 sm:px-5 flex items-center justify-between gap-2 sm:gap-4 transition-all duration-300">
        
        {/* 1. Logo & Brand (Organic, free-floating presentation without squircle box) */}
        <div
          onClick={() => setActiveTab('calibration')}
          className="flex items-center gap-2.5 sm:gap-3 cursor-pointer group select-none flex-shrink-0"
        >
          {/* Free-standing logo with ambient backlight glow */}
          <div className="w-8 h-8 sm:w-9 sm:h-9 relative flex items-center justify-center transition-transform duration-300 group-hover:scale-105">
            <div className="absolute inset-0 bg-[var(--accent-primary)] opacity-20 blur-md rounded-full group-hover:opacity-40 transition-opacity" />
            <CineMatchLogo className="w-full h-full relative z-10 drop-shadow-sm" />
          </div>

          <div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-heading text-base sm:text-lg font-black tracking-tight text-white group-hover:text-[var(--accent-hover)] transition-colors">
                CineMatch
              </span>
              <span className="text-[8px] sm:text-[9px] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded-full bg-[var(--accent-secondary-bg)] text-[var(--accent-secondary)] border border-[var(--accent-secondary-border)]">
                INDEX
              </span>
            </div>
            <p className="text-[9px] sm:text-[10px] text-slate-400 font-normal tracking-wide hidden lg:block">
              Cinephile Intelligence & Continuous Discovery
            </p>
          </div>
        </div>

        {/* 2. Desktop Navigation Tabs (Visible on big screens with fluid pill tabs) */}
        <nav className="hidden md:flex items-center gap-1 bg-black/25 p-1 rounded-full border border-white/5 shadow-inner">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 cursor-pointer ${
                  isActive
                    ? 'bg-[var(--accent-primary)] text-[var(--accent-text)] shadow-[0_2px_12px_var(--accent-glow)]'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-inherit' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.badge && (
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                      isActive
                        ? 'bg-black/25 text-inherit'
                        : 'bg-white/10 text-slate-300'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* 3. Direct-Access Action Icons (Theme, AI Keys, Settings - Clean Ghost Icons) */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
          {/* Quick Palette / Theme Switcher direct access */}
          {onOpenPalette && (
            <button
              onClick={onOpenPalette}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title="Change Color Palette & Typography"
              aria-label="Color Palette & Typography"
            >
              <Palette className="w-4 h-4 text-[var(--accent-secondary)]" />
            </button>
          )}

          {/* AI Engine & API Keys direct access */}
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 px-2 sm:px-2.5 h-8 sm:h-9 rounded-full text-xs text-slate-300 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            title={`AI Engine & API Keys (${getProviderName()})`}
            aria-label="AI Engine & API Keys"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <Sparkles className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
            <span className="hidden xl:inline text-[11px] font-medium text-slate-300">
              {getProviderName()}
            </span>
          </button>

          {/* Settings direct access */}
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
            title="App Settings & Data"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
