import React, { useEffect, useState } from 'react';
import { X, Play, Star, Calendar, Clock, Bookmark, BookmarkCheck, ExternalLink, Film, User, Tag, Sparkles } from 'lucide-react';
import { Movie } from '../types';
import { getMovieDetails, BACKDROP_BASE_URL } from '../services/tmdb';
import { useMovieStore } from '../store/useMovieStore';
import { RatingControl } from './RatingControl';
import { ShareButton } from './ShareButton';

export const MovieDetailsModal: React.FC = () => {
  const { selectedMovieForModal, setSelectedMovieForModal, ratings, setRating, removeRating, watchlist, toggleWatchlist } = useMovieStore();
  const [movieDetails, setMovieDetails] = useState<Movie | null>(null);
  const [showTrailer, setShowTrailer] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedMovieForModal) {
      setMovieDetails(null);
      setShowTrailer(false);
      return;
    }

    let isMounted = true;

    getMovieDetails(selectedMovieForModal.id)
      .then((details) => {
        if (isMounted) {
          setMovieDetails(details);
        }
      })
      .catch((err) => {
        console.error('Failed to load full movie details', err);
        if (isMounted) {
          setMovieDetails(selectedMovieForModal);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [selectedMovieForModal]);

  if (!selectedMovieForModal) return null;

  const movie = movieDetails || selectedMovieForModal;
  const userRating = ratings[movie.id]?.rating;
  const inWatchlist = watchlist.includes(movie.id);
  const backdropUrl = movie.backdrop_path ? `${BACKDROP_BASE_URL}${movie.backdrop_path}` : null;
  const year = movie.release_date ? movie.release_date.slice(0, 4) : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-[var(--bg-canvas)]/85 backdrop-blur-md overflow-y-auto animate-fadeIn"
      onClick={() => setSelectedMovieForModal(null)}
    >
      <div
        className="relative w-full max-w-3xl rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={() => setSelectedMovieForModal(null)}
          className="absolute top-4 right-4 z-20 p-2 rounded-full bg-[var(--bg-surface-elevated)] text-slate-300 hover:text-white hover:border-[var(--border-focus)] transition-colors border border-[var(--border-subtle)] cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Hero Media / Trailer Header */}
        <div className="relative aspect-video w-full bg-[var(--bg-canvas)] max-h-80 overflow-hidden">
          {showTrailer && movie.trailer_key ? (
            <iframe
              src={`https://www.youtube.com/embed/${movie.trailer_key}?autoplay=1`}
              title="Movie Trailer"
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : backdropUrl ? (
            <>
              <img src={backdropUrl} alt={movie.title} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-surface)] via-[var(--bg-surface)]/40 to-transparent" />
              {movie.trailer_key && (
                <button
                  onClick={() => setShowTrailer(true)}
                  className="absolute inset-0 flex items-center justify-center group cursor-pointer"
                >
                  <div className="w-16 h-16 rounded-full bg-[var(--accent-primary)] text-[var(--accent-text)] flex items-center justify-center shadow-2xl shadow-[var(--accent-glow)] group-hover:scale-110 group-hover:bg-[var(--accent-hover)] transition-all border border-[var(--border-focus)]">
                    <Play className="w-7 h-7 fill-current ml-1" />
                  </div>
                </button>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[var(--bg-canvas)] text-slate-500">
              <Film className="w-12 h-12" />
            </div>
          )}
        </div>

        {/* Body Content */}
        <div className="p-5 sm:p-8 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Main Title & Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="font-heading text-xl sm:text-3xl font-extrabold text-white tracking-tight">
                {movie.title}
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-xs sm:text-sm text-slate-400">
                {year && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    {year}
                  </span>
                )}
                {movie.runtime && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    {movie.runtime} mins
                  </span>
                )}
                <span className="flex items-center gap-1 text-amber-400 font-bold">
                  <Star className="w-3.5 h-3.5 fill-amber-400" />
                  {movie.vote_average.toFixed(1)} / 10 TMDB ({movie.vote_count} votes)
                </span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleWatchlist(movie)}
                className={`btn-tactile px-3.5 py-1.5 text-xs font-semibold flex items-center gap-2 border transition-all cursor-pointer ${
                  inWatchlist
                    ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-hover)] border-[var(--border-focus)]'
                    : 'btn-tactile-secondary'
                }`}
              >
                {inWatchlist ? <BookmarkCheck className="w-4 h-4 text-[var(--accent-hover)]" /> : <Bookmark className="w-4 h-4" />}
                {inWatchlist ? 'In Watchlist' : 'Watchlist'}
              </button>

              {movie.imdb_id && (
                <a
                  href={`https://www.imdb.com/title/${movie.imdb_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-tactile btn-tactile-secondary px-3 py-1.5 text-xs font-semibold flex items-center gap-1"
                >
                  IMDb <ExternalLink className="w-3 h-3" />
                </a>
              )}

              <ShareButton movie={movie} variant="pill" />
            </div>
          </div>

          {/* Genres Chips */}
          <div className="flex flex-wrap gap-2">
            {(movie.genres || []).map((g) => (
              <span
                key={g.id}
                className="text-xs px-2.5 py-1 rounded-md palette-tag-secondary font-medium"
              >
                {g.name}
              </span>
            ))}
          </div>

          {/* Synopsis */}
          <div className="space-y-1.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Synopsis</h4>
            <p className="text-sm text-slate-200 leading-relaxed">{movie.overview}</p>
          </div>

          {/* Cast & Director */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2 border-t border-[var(--border-subtle)]">
            {movie.director && (
              <div className="space-y-1">
                <span className="text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-[var(--accent-secondary)]" /> Director
                </span>
                <p className="text-white font-medium text-sm">{movie.director}</p>
              </div>
            )}
            {movie.cast && movie.cast.length > 0 && (
              <div className="space-y-1">
                <span className="text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-[var(--accent-secondary)]" /> Key Cast
                </span>
                <p className="text-slate-200 font-medium">{movie.cast.join(', ')}</p>
              </div>
            )}
          </div>

          {/* Keywords / Thematic Tags */}
          {movie.keywords && movie.keywords.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-[var(--border-subtle)]">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-[var(--accent-primary)]" /> Themes & Keywords
              </span>
              <div className="flex flex-wrap gap-1.5">
                {movie.keywords.slice(0, 10).map((kw, i) => (
                  <span
                    key={i}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-[var(--bg-surface-elevated)] text-slate-300 border border-[var(--border-subtle)]"
                  >
                    #{kw}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 1 to 10 Interactive Rating Control */}
          <div className="pt-2">
            <RatingControl
              currentRating={userRating}
              onRate={(score) => setRating(movie, score)}
              onClear={() => removeRating(movie.id)}
              compact={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
