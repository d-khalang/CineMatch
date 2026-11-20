import React, { useId } from 'react';
import { Recommendation } from '../types';
import { BucketBadge } from './RankedFeed';

const TMDB_W342_BASE_URL = 'https://image.tmdb.org/t/p/w342';

function getFirstSentence(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/^[\s\S]+?[.!?]["')\]]*(?=\s|$)/);
  return match ? match[0] : trimmed;
}

export interface TonightPicksProps {
  picks: Recommendation[];
  onOpen: (rec: Recommendation) => void;
}

export const TonightPicks: React.FC<TonightPicksProps> = ({ picks, onOpen }) => {
  const headingId = useId();

  if (!picks || picks.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-2xl sm:rounded-3xl p-4 sm:p-6 bg-[var(--bg-surface-elevated)]/60 border border-[var(--border-subtle)]"
    >
      <div className="space-y-1">
        <h2
          id={headingId}
          className="font-heading text-xl sm:text-2xl font-extrabold text-white tracking-tight"
        >
          Tonight
        </h2>
        <p className="text-xs sm:text-sm text-slate-400">
          Three picks if you only have one evening.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {picks.map((rec) => {
          const { movie, reason, bucket } = rec;
          const title = movie.title && movie.title.trim() ? movie.title.trim() : `#${movie.id}`;
          const year = movie.release_date ? movie.release_date.trim().slice(0, 4) : '';
          const posterUrl = movie.poster_path ? `${TMDB_W342_BASE_URL}${movie.poster_path}` : null;
          const firstSentence = getFirstSentence(reason || '');

          return (
            <button
              key={movie.id}
              type="button"
              onClick={() => onOpen(rec)}
              className="group text-left flex sm:flex-col rounded-2xl overflow-hidden glass-panel glass-panel-hover border border-[var(--border-subtle)] focus-ring cursor-pointer transition-colors duration-200"
            >
              <span className="relative w-24 sm:w-full aspect-[2/3] shrink-0 bg-[var(--bg-canvas)] overflow-hidden block">
                {posterUrl ? (
                  <img
                    src={posterUrl}
                    alt={title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <span className="w-full h-full flex items-center justify-center text-xs text-slate-500 p-2 text-center">
                    No Poster
                  </span>
                )}
              </span>

              <span className="p-4 flex flex-col gap-2 flex-1 min-w-0">
                {bucket && (
                  <span className="flex flex-wrap items-center gap-1.5">
                    <BucketBadge bucket={bucket} />
                  </span>
                )}

                <span className="block font-heading text-base font-bold text-white group-hover:text-[var(--accent-secondary)] transition-colors leading-snug">
                  <span>{title}</span>
                  {year && <span className="text-slate-400 font-normal text-sm ml-1.5">({year})</span>}
                </span>

                {firstSentence && (
                  <span className="block text-xs text-slate-300 leading-relaxed">
                    {firstSentence}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
