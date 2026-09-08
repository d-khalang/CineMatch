import React from 'react';
import { CheckCircle, Share2, X } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';

export const Toast: React.FC = () => {
  const { toastMessage, clearToast } = useMovieStore();

  if (!toastMessage) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 left-4 sm:left-auto sm:right-6 z-50 flex items-center justify-center pointer-events-none animate-fadeIn">
      <div className="pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl bg-[var(--bg-surface-elevated)]/95 border border-[var(--border-focus)] text-slate-100 text-xs sm:text-sm shadow-2xl shadow-[var(--accent-glow)] backdrop-blur-xl max-w-md">
        <div className="p-1 rounded-lg palette-tag-secondary shrink-0">
          <CheckCircle className="w-4 h-4 text-[var(--accent-secondary)]" />
        </div>
        <p className="flex-grow font-medium leading-snug">{toastMessage}</p>
        <button
          onClick={clearToast}
          className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-[var(--bg-surface-hover)] transition-colors shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
