import React, { useState } from 'react';
import { Share2, Check, Loader2 } from 'lucide-react';
import { Movie } from '../types';
import { shareMovie } from '../services/shareService';
import { useMovieStore } from '../store/useMovieStore';

interface ShareButtonProps {
  movie: Movie;
  variant?: 'pill' | 'icon';
  className?: string;
  iconSize?: string;
  title?: string;
}

export const ShareButton: React.FC<ShareButtonProps> = ({
  movie,
  variant = 'icon',
  className = '',
  iconSize = 'w-3.5 h-3.5',
  title,
}) => {
  const { showToast } = useMovieStore();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const handleShare = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (isLoading) return;

    setIsLoading(true);
    try {
      const result = await shareMovie(movie);
      if (result.success) {
        if (result.type === 'copied') {
          setIsCopied(true);
          showToast(`IMDb link for "${movie.title}" copied to clipboard!`);
          setTimeout(() => {
            setIsCopied(false);
          }, 2000);
        } else if (result.type === 'shared') {
          showToast(`Shared "${movie.title}"`);
        }
      }
    } catch (err) {
      console.error('Share action failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (variant === 'pill') {
    return (
      <button
        onClick={handleShare}
        disabled={isLoading}
        className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all cursor-pointer ${
          isCopied
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
            : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:text-white hover:bg-slate-800 hover:border-slate-600'
        } ${className}`}
        title={title || (isCopied ? 'IMDb link copied!' : 'Share IMDb page')}
      >
        {isCopied ? (
          <Check className={`${iconSize} text-emerald-400`} />
        ) : isLoading ? (
          <Loader2 className={`${iconSize} animate-spin text-slate-400`} />
        ) : (
          <Share2 className={iconSize} />
        )}
        <span>{isCopied ? 'Copied IMDb Link' : 'Share'}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      disabled={isLoading}
      className={`p-1.5 rounded-lg backdrop-blur-md border transition-all cursor-pointer ${
        isCopied
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-md'
          : 'bg-slate-950/80 text-slate-400 border-slate-700/60 hover:text-white hover:border-slate-500 shadow-md'
      } ${className}`}
      title={title || (isCopied ? 'IMDb link copied!' : 'Share IMDb page')}
    >
      {isCopied ? (
        <Check className={`${iconSize} text-emerald-400`} />
      ) : isLoading ? (
        <Loader2 className={`${iconSize} animate-spin text-slate-400`} />
      ) : (
        <Share2 className={iconSize} />
      )}
    </button>
  );
};
