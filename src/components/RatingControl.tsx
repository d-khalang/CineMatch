import React, { useState } from 'react';
import { EyeOff, Star, Check } from 'lucide-react';

interface RatingControlProps {
  currentRating?: number;
  onRate: (rating: number) => void;
  onClear: () => void;
  compact?: boolean;
}

export const RatingControl: React.FC<RatingControlProps> = ({
  currentRating,
  onRate,
  onClear,
  compact = false,
}) => {
  const [hoveredRating, setHoveredRating] = useState<number | null>(null);

  const getRatingColor = (score: number, isSelected: boolean) => {
    if (!isSelected && hoveredRating === null) {
      return 'bg-slate-800/80 text-slate-300 border-slate-700/60 hover:border-slate-500';
    }

    if (score <= 3) {
      return isSelected
        ? 'bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-900/40 font-bold'
        : 'hover:bg-rose-600/30 text-rose-300 border-rose-800/40';
    }
    if (score <= 6) {
      return isSelected
        ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-lg shadow-amber-900/40 font-bold'
        : 'hover:bg-amber-500/30 text-amber-300 border-amber-800/40';
    }
    if (score <= 8) {
      return isSelected
        ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-lg shadow-emerald-900/40 font-bold'
        : 'hover:bg-emerald-500/30 text-emerald-300 border-emerald-800/40';
    }
    // 9-10 Masterpiece
    return isSelected
      ? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-400 text-white border-indigo-400 shadow-lg shadow-indigo-900/50 font-bold scale-105'
      : 'hover:bg-indigo-600/40 text-indigo-300 border-indigo-800/40';
  };

  const getRatingLabel = (score: number) => {
    switch (score) {
      case 1:
      case 2:
        return 'Terrible';
      case 3:
      case 4:
        return 'Weak';
      case 5:
      case 6:
        return 'Decent';
      case 7:
        return 'Good';
      case 8:
        return 'Great';
      case 9:
        return 'Phenomenal';
      case 10:
        return 'Masterpiece';
      default:
        return '';
    }
  };

  const activeScore = hoveredRating ?? currentRating;

  if (compact) {
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <div className="flex items-center justify-between text-xs px-0.5 text-slate-400">
          <span className="font-medium flex items-center gap-1">
            {currentRating ? (
              <>
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span className="text-white font-semibold">{currentRating}/10</span>
                <span className="text-slate-400 text-[11px]">({getRatingLabel(currentRating)})</span>
              </>
            ) : (
              'Rate 1–10'
            )}
          </span>
          {currentRating && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded bg-slate-800/60 hover:bg-slate-800"
              title="Reset rating"
            >
              <EyeOff className="w-3 h-3" />
              Reset
            </button>
          )}
        </div>

        {/* 1-10 Touch/Click Strip */}
        <div className="grid grid-cols-10 gap-1 w-full" onClick={(e) => e.stopPropagation()}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => {
            const isSelected = currentRating === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => onRate(val)}
                className={`h-7 flex items-center justify-center text-xs font-semibold rounded transition-all duration-150 border ${getRatingColor(
                  val,
                  isSelected
                )}`}
              >
                {val}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Expanded Mode (For Modals and Detail Views)
  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-slate-900/90 border border-slate-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
          <span className="text-sm font-semibold text-slate-200">Your Rating</span>
          {activeScore && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-indigo-300 font-medium border border-slate-700">
              {activeScore}/10 — {getRatingLabel(activeScore)}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onClear}
          className={`text-xs px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition-colors border ${
            currentRating
              ? 'text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 border-slate-800 hover:border-rose-900/50'
              : 'text-slate-500 bg-slate-950/40 border-slate-900'
          }`}
        >
          <EyeOff className="w-3.5 h-3.5" />
          {currentRating ? "Haven't seen / Clear" : "Haven't seen"}
        </button>
      </div>

      {/* 1-10 Button Bar */}
      <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => {
          const isSelected = currentRating === val;
          return (
            <button
              key={val}
              type="button"
              onMouseEnter={() => setHoveredRating(val)}
              onMouseLeave={() => setHoveredRating(null)}
              onClick={() => onRate(val)}
              className={`h-11 flex flex-col items-center justify-center rounded-lg transition-all duration-150 border active:scale-95 ${getRatingColor(
                val,
                isSelected
              )}`}
            >
              <span className="text-sm font-bold">{val}</span>
              {isSelected && <Check className="w-2.5 h-2.5 -mt-0.5" />}
            </button>
          );
        })}
      </div>

      {/* Guidance Labels */}
      <div className="flex justify-between text-[11px] text-slate-500 px-1 font-medium">
        <span>1-3: Poor / Disliked</span>
        <span>5-6: Decent</span>
        <span>7-8: Great</span>
        <span className="text-indigo-400">9-10: Masterpiece</span>
      </div>
    </div>
  );
};
