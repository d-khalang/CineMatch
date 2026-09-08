import React from 'react';
import { Sparkles, Compass, Sliders, ShieldCheck, Flame } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';

const VIBE_OPTIONS = [
  'Mind-bending',
  'Dark & Gritty',
  'Heartfelt',
  'Atmospheric',
  'Fast-paced',
  'Philosophical',
  'Visually Stunning',
  'Plot Twists',
  'Slow-burn',
  'High Tension',
];

const ERA_OPTIONS = ['70s', '80s', '90s', '2000s', '2010s', '2020s'];

export const DiscoveryFilters: React.FC = () => {
  const { aiSettings, updateAISettings, generateRankings, isGeneratingRecs } = useMovieStore();

  const handleSerendipityChange = (val: number) => {
    updateAISettings({ serendipityLevel: val });
  };

  const toggleVibe = (vibe: string) => {
    const current = aiSettings.selectedVibes || [];
    const updated = current.includes(vibe) ? current.filter((v) => v !== vibe) : [...current, vibe];
    updateAISettings({ selectedVibes: updated });
  };

  const toggleEra = (era: string) => {
    const current = aiSettings.preferredEras || [];
    const updated = current.includes(era) ? current.filter((e) => e !== era) : [...current, era];
    updateAISettings({ preferredEras: updated });
  };

  const getSerendipityLabel = (level: number) => {
    if (level < 25) return { title: 'Safe Bets', desc: 'Predictable high-accuracy matches matching your proven favorites', color: 'text-[var(--accent-secondary)] font-bold' };
    if (level < 60) return { title: 'Balanced Discovery', desc: 'A smart blend of core favorites and fresh thematic twists', color: 'text-slate-200 font-bold' };
    if (level < 85) return { title: 'Hidden Gems', desc: 'Branching outside usual comfort zones with high-quality under-the-radar cinema', color: 'text-[var(--accent-hover)] font-bold' };
    return { title: 'Wildcard Horizon', desc: 'Bold, genre-defying recommendations sharing deeper emotional & narrative DNA', color: 'text-[var(--accent-primary)] font-extrabold' };
  };

  const currentSerendipity = getSerendipityLabel(aiSettings.serendipityLevel);

  return (
    <div className="glass-panel rounded-2xl p-5 sm:p-6 mb-8 border border-[var(--border-subtle)] shadow-xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-[var(--accent-secondary)]" />
            <h2 className="text-lg font-bold text-white tracking-wide">Discovery & AI Calibration</h2>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Tune how daring or tailored the recommendation algorithm should be.
          </p>
        </div>

        <button
          onClick={generateRankings}
          disabled={isGeneratingRecs}
          className="btn-tactile btn-tactile-primary self-start md:self-auto px-5 py-2.5 text-xs font-bold shadow-lg disabled:opacity-50"
        >
          <Sparkles className={`w-4 h-4 ${isGeneratingRecs ? 'animate-spin' : ''}`} />
          <span>{isGeneratingRecs ? 'Re-Ranking Taste Profile...' : 'Re-Rank with AI'}</span>
        </button>
      </div>

      {/* Serendipity Slider Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-[var(--accent-secondary)]" />
            <span className="text-sm font-semibold text-slate-200">Recommendation Serendipity:</span>
            <span className={`text-sm font-bold ${currentSerendipity.color}`}>
              {aiSettings.serendipityLevel}% — {currentSerendipity.title}
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">{currentSerendipity.desc}</p>

        {/* Custom Range Slider */}
        <div className="relative pt-2">
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={aiSettings.serendipityLevel}
            onChange={(e) => handleSerendipityChange(Number(e.target.value))}
            className="w-full h-2.5 bg-[var(--bg-surface-elevated)] rounded-lg appearance-none cursor-pointer accent-[var(--accent-primary)] focus:outline-none border border-[var(--border-subtle)]"
          />
          <div className="flex justify-between text-[11px] text-slate-400 mt-2 font-mono">
            <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> 0% Safe Bets</span>
            <span>50% Balanced</span>
            <span className="flex items-center gap-1"><Flame className="w-3.5 h-3.5 text-rose-400" /> 100% Wildcard</span>
          </div>
        </div>
      </div>

      {/* Vibe & Mood Filters */}
      <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Filter by Mood / Vibe (Optional)
        </span>
        <div className="flex flex-wrap gap-1.5">
          {VIBE_OPTIONS.map((vibe) => {
            const isSelected = (aiSettings.selectedVibes || []).includes(vibe);
            return (
              <button
                key={vibe}
                onClick={() => toggleVibe(vibe)}
                className={`btn-tactile text-xs px-3 py-1.5 transition-all cursor-pointer ${
                  isSelected
                    ? 'btn-tactile-primary shadow-sm'
                    : 'btn-tactile-secondary'
                }`}
              >
                {vibe}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preferred Eras */}
      <div className="space-y-2">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
          Preferred Eras (Optional)
        </span>
        <div className="flex flex-wrap gap-1.5">
          {ERA_OPTIONS.map((era) => {
            const isSelected = (aiSettings.preferredEras || []).includes(era);
            return (
              <button
                key={era}
                onClick={() => toggleEra(era)}
                className={`btn-tactile text-xs px-3 py-1.5 transition-all cursor-pointer ${
                  isSelected
                    ? 'btn-tactile-primary shadow-sm'
                    : 'btn-tactile-secondary'
                }`}
              >
                {era}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
