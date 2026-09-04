import React from 'react';
import { Trophy, SlidersHorizontal, Film, Settings } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';

interface MobileBottomNavProps {
  onOpenSettings: () => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ onOpenSettings }) => {
  const { activeTab, setActiveTab, ratings } = useMovieStore();
  const ratedCount = Object.keys(ratings).length;

  const navItems = [
    { id: 'calibration', label: 'Calibration', icon: SlidersHorizontal, badge: ratedCount > 0 ? `${ratedCount}` : null },
    { id: 'rankings', label: 'Top Ranked', icon: Trophy, badge: null },
    { id: 'library', label: 'My Ratings', icon: Film, badge: null },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-slate-950/90 backdrop-blur-xl border-t border-slate-800/90 safe-pb">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`relative flex flex-col items-center justify-center w-20 py-1 rounded-xl transition-all cursor-pointer ${
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
              <span className="text-[10px] mt-1 tracking-tight">{item.label}</span>
            </button>
          );
        })}

        {/* Settings button on mobile nav */}
        <button
          onClick={onOpenSettings}
          className="flex flex-col items-center justify-center w-20 py-1 text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          <Settings className="w-5 h-5" />
          <span className="text-[10px] mt-1 tracking-tight">AI Settings</span>
        </button>
      </div>
    </nav>
  );
};
