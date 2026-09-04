import React from 'react';
import { Trophy, SlidersHorizontal, Film, Settings, Bookmark } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';

interface MobileBottomNavProps {
  onOpenSettings: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onOpenSettings }) => {
  const { activeTab, setActiveTab, ratings, watchlist } = useMovieStore();
  const ratedCount = Object.keys(ratings).length;
  const watchlistCount = watchlist.length;

  const navItems = [
    { id: 'calibration', label: 'Calibration', icon: SlidersHorizontal, badge: null },
    { id: 'rankings', label: 'Top Ranked', icon: Trophy, badge: null },
    { id: 'watchlist', label: 'Watchlist', icon: Bookmark, badge: watchlistCount > 0 ? `${watchlistCount}` : null },
    { id: 'library', label: 'Ratings', icon: Film, badge: ratedCount > 0 ? `${ratedCount}` : null },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/90 backdrop-blur-xl border-t border-slate-800/90 safe-pb">
      <div className="flex items-center justify-around h-16 px-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`relative flex-1 max-w-[76px] flex flex-col items-center justify-center py-1 rounded-xl transition-all cursor-pointer ${
                isActive ? 'text-indigo-400 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />
                {item.badge && (
                  <span className="absolute -top-1.5 -right-2.5 px-1.5 py-0.2 bg-indigo-600 text-white text-[9px] font-extrabold rounded-full shadow-sm">
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] mt-1 tracking-tight truncate max-w-full">{item.label}</span>
            </button>
          );
        })}

        {/* Settings button on mobile nav */}
        <button
          onClick={onOpenSettings}
          className="flex-1 max-w-[76px] flex flex-col items-center justify-center py-1 text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] mt-1 tracking-tight">Settings</span>
        </button>
      </div>
    </nav>
  );
};
