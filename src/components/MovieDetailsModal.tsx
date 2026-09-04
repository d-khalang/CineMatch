import React, { useEffect, useState } from 'react';
import { X, Play, Star, Calendar, Clock, Bookmark, BookmarkCheck, ExternalLink, Film, User, Tag, Sparkles } from 'lucide-react';
import { Movie } from '../types';
import { getMovieDetails, BACKDROP_BASE_URL, IMAGE_BASE_URL } from '../services/tmdb';
import { useMovieStore } from '../store/useMovieStore';
import { RatingControl } from './RatingControl';

export const MovieDetailsModal: React.FC = () => {
  const { selectedMovieForModal, setSelectedMovieForModal, ratings, setRating, removeRating, watchlist, toggleWatchlist } = useMovieStore();
  const [movieDetails, setMovieDetails] = useState<Movie | null>(null);
  const [showTrailer, setShowTrailer] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedMovieForModal) {
      setMovieDetails(null);
      setShowTrailer(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

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
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
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
  const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : null;
  const year = movie.release_date ? movie.release_date.slice(0, 4) : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md overflow-y-auto animate-fadeIn"
      onClick={() => setSelectedMovieForModal(null)}
    >
      <div
        className="relative w-full max-w-3xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          onClick={() => setSelectedMovieForModal(null)}
          className="absolute top-4 right-4 z-20 p-2 rounded-full bg-slate-950/80 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors border border-slate-700/60 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Hero Media / Trailer Header */}
        <div className="relative aspect-video w-full bg-slate-950 max-h-80 overflow-hidden">
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
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
              {movie.trailer_key && (
                <button
                  onClick={() => setShowTrailer(true)}
                  className="absolute inset-0 flex items-center justify-center group cursor-pointer"
                >
                  <div className="w-16 h-16 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-2xl shadow-indigo-950 group-hover:scale-110 group-hover:bg-indigo-500 transition-all border border-indigo-400/40">
                    <Play className="w-7 h-7 fill-white ml-1" />
                  </div>
                </button>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-500">
              <Film className="w-12 h-12" />
            </div>
          )}
        </div>

        {/* Body Content */}
        <div className="p-5 sm:p-8 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Main Title & Action Row */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-xl sm:text-3xl font-extrabold text-white tracking-tight">
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
                onClick={() => toggleWatchlist(movie.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 border transition-all cursor-pointer ${
                  inWatchlist
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700 hover:text-white'
                }`}
              >
                {inWatchlist ? <BookmarkCheck className="w-4 h-4 text-amber-400" /> : <Bookmark className="w-4 h-4" />}
                {inWatchlist ? 'In Watchlist' : 'Watchlist'}
              </button>

              {movie.imdb_id && (
                <a
                  href={`https://www.imdb.com/title/${movie.imdb_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-xl text-xs font-semibold bg-amber-400/10 text-amber-300 border border-amber-400/30 flex items-center gap-1 hover:bg-amber-400/20 transition-all"
                >
                  IMDb <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          {/* Genres Chips */}
          <div className="flex flex-wrap gap-2">
            {(movie.genres || []).map((g) => (
              <span
                key={g.id}
                className="text-xs px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 font-medium"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2 border-t border-slate-800">
            {movie.director && (
              <div className="space-y-1">
                <span className="text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-indigo-400" /> Director
                </span>
                <p className="text-white font-medium text-sm">{movie.director}</p>
              </div>
            )}
            {movie.cast && movie.cast.length > 0 && (
              <div className="space-y-1">
                <span className="text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" /> Key Cast
                </span>
                <p className="text-slate-200 font-medium">{movie.cast.join(', ')}</p>
              </div>
            )}
          </div>

          {/* Keywords / Thematic Tags */}
          {movie.keywords && movie.keywords.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-slate-800">
              <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                <Tag className="w-3.5 h-3.5 text-pink-400" /> Themes & Keywords
              </span>
              <div className="flex flex-wrap gap-1.5">
                {movie.keywords.slice(0, 10).map((kw, i) => (
                  <span
                    key={i}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800/60 text-slate-400 border border-slate-800"
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
