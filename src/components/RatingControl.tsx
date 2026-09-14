import React, { useState } from 'react';
import { EyeOff, Star, Check } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

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

  const triggerHaptic = () => {
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    }
  };

  const handleRate = (score: number) => {
    triggerHaptic();
    onRate(score);
  };

  const handleClear = () => {
    triggerHaptic();
    onClear();
  };

  const getRatingColor = (score: number, isSelected: boolean) => {
    if (!isSelected && hoveredRating === null) {
      return 'bg-[var(--bg-surface-elevated)] text-slate-300 border-[var(--border-subtle)] hover:border-[var(--border-focus)]';
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
      ? 'bg-[var(--accent-primary)] text-[var(--accent-text)] border-[var(--border-focus)] shadow-lg shadow-[var(--accent-glow)] font-bold scale-105'
      : 'hover:bg-[var(--accent-secondary-bg)] text-[var(--accent-secondary)] border-[var(--border-subtle)]';
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
      case 8:
        return 'Great';
      case 9:
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
                handleClear();
              }}
              className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors px-2 py-1 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)]"
              title="Reset rating"
              aria-label="Reset rating"
            >
              <EyeOff className="w-3.5 h-3.5" />
              Reset
            </button>
          )}
        </div>

        {/* 1-10 Touch Strip: 2 rows on mobile (>=44px touch targets) and 1 row on tablet/desktop */}
        <div
          className="grid grid-cols-5 sm:grid-cols-10 gap-1.5 w-full"
          onClick={(e) => e.stopPropagation()}
          role="radiogroup"
          aria-label="Movie rating from 1 to 10"
        >
          {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => {
            const isSelected = currentRating === val;
            return (
              <button
                key={val}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Rate ${val} out of 10: ${getRatingLabel(val)}`}
                onClick={() => handleRate(val)}
                className={`h-10 sm:h-8 min-w-[38px] flex items-center justify-center text-xs font-bold rounded-lg transition-all duration-150 border focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:outline-none ${getRatingColor(
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
    <div className="flex flex-col gap-3 p-4 rounded-xl bg-[var(--bg-surface-elevated)] border border-[var(--border-subtle)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
          <span className="text-sm font-semibold text-slate-200">Your Rating</span>
          {activeScore && (
            <span className="text-xs px-2 py-0.5 rounded-full palette-tag-secondary font-medium">
              {activeScore}/10 — {getRatingLabel(activeScore)}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleClear}
          className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors border ${
            currentRating
              ? 'text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 border-[var(--border-subtle)] hover:border-rose-900/50'
              : 'text-slate-500 bg-[var(--bg-surface)] border-[var(--border-subtle)]'
          }`}
          aria-label="Clear rating"
        >
          <EyeOff className="w-3.5 h-3.5" />
          {currentRating ? "Haven't seen / Clear" : "Haven't seen"}
        </button>
      </div>

      {/* 1-10 Button Bar */}
      <div
        className="grid grid-cols-5 sm:grid-cols-10 gap-2"
        role="radiogroup"
        aria-label="Select your rating from 1 to 10"
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((val) => {
          const isSelected = currentRating === val;
          return (
            <button
              key={val}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`Rate ${val} out of 10: ${getRatingLabel(val)}`}
              onMouseEnter={() => setHoveredRating(val)}
              onMouseLeave={() => setHoveredRating(null)}
              onClick={() => handleRate(val)}
              className={`h-12 flex flex-col items-center justify-center rounded-xl transition-all duration-150 border active:scale-95 focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:outline-none ${getRatingColor(
                val,
                isSelected
              )}`}
            >
              <span className="text-sm font-bold">{val}</span>
              {isSelected && <Check className="w-3 h-3 -mt-0.5" />}
            </button>
          );
        })}
      </div>

      {/* Guidance Labels */}
      <div className="flex justify-between text-[11px] text-slate-400 px-1 font-medium">
        <span>1-3: Disliked</span>
        <span>5-6: Decent</span>
        <span>7-8: Great</span>
        <span className="text-[var(--accent-secondary)] font-bold">9-10: Masterpiece</span>
      </div>
    </div>
  );
};
