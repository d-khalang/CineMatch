import React, { useState, useMemo } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Search,
  SlidersHorizontal,
  Trash2,
  Trophy,
  Star,
  Film,
  Sparkles,
  Calendar,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { IMAGE_BASE_URL } from '../services/tmdb';
import { RatingControl } from './RatingControl';
import { ShareButton } from './ShareButton';
import { Movie } from '../types';

export const Watchlist: React.FC = () => {
  const {
    watchlist,
    watchlistMovies,
    ratings,
    setRating,
    removeRating,
    toggleWatchlist,
    clearWatchlist,
    setSelectedMovieForModal,
    setActiveTab,
  } = useMovieStore();

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedGenre, setSelectedGenre] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'rating-desc' | 'year-desc' | 'year-asc' | 'title'>('recent');

  // Build the list of movies in watchlist
  const watchlistItems: Movie[] = useMemo(() => {
    return watchlist.map((id) => {
      if (watchlistMovies[id]) {
        return watchlistMovies[id];
      }
      // If movie is in user's rated list
      if (ratings[id]) {
        const r = ratings[id];
        return {
          id: r.movieId,
          title: r.title,
          overview: '',
          poster_path: r.posterPath,
          backdrop_path: null,
          release_date: r.year ? `${r.year}-01-01` : '',
          vote_average: r.rating,
          vote_count: 0,
          director: r.director,
          genres: (r.genres || []).map((name, idx) => ({ id: idx, name })),
        };
      }
      // Fallback placeholder
      return {
        id,
        title: `Movie #${id}`,
        overview: '',
        poster_path: null,
        backdrop_path: null,
        release_date: '',
        vote_average: 0,
        vote_count: 0,
        genres: [],
      };
    });
  }, [watchlist, watchlistMovies, ratings]);

  // Extract unique genres across watchlist items
  const availableGenres = useMemo(() => {
    const genreSet = new Set<string>();
    watchlistItems.forEach((m) => {
      (m.genres || []).forEach((g) => {
        if (g.name && g.name !== 'Other') {
          genreSet.add(g.name);
        }
      });
    });
    return Array.from(genreSet).sort();
  }, [watchlistItems]);

  // Filter and sort items
  const filteredMovies = useMemo(() => {
    let result = watchlistItems.filter((movie) => {
      // Search query
      if (searchQuery.trim() && !movie.title.toLowerCase().includes(searchQuery.toLowerCase().trim())) {
        return false;
      }
      // Genre filter
      if (selectedGenre !== 'all') {
        const hasGenre = (movie.genres || []).some(
          (g) => g.name.toLowerCase() === selectedGenre.toLowerCase()
        );
        if (!hasGenre) return false;
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      if (sortBy === 'rating-desc') {
        return (b.vote_average || 0) - (a.vote_average || 0);
      }
      if (sortBy === 'year-desc') {
        const yearA = a.release_date ? parseInt(a.release_date.slice(0, 4), 10) || 0 : 0;
        const yearB = b.release_date ? parseInt(b.release_date.slice(0, 4), 10) || 0 : 0;
        return yearB - yearA;
      }
      if (sortBy === 'year-asc') {
        const yearA = a.release_date ? parseInt(a.release_date.slice(0, 4), 10) || 0 : 0;
        const yearB = b.release_date ? parseInt(b.release_date.slice(0, 4), 10) || 0 : 0;
        return yearA - yearB;
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      // 'recent': order is already preserved by watchlist array (most recent first)
      return 0;
    });

    return result;
  }, [watchlistItems, searchQuery, selectedGenre, sortBy]);

  // Summary stats
  const stats = useMemo(() => {
    if (watchlistItems.length === 0) return null;
    const withRatings = watchlistItems.filter((m) => m.vote_average > 0);
    const avgRating =
      withRatings.length > 0
        ? (withRatings.reduce((acc, m) => acc + m.vote_average, 0) / withRatings.length).toFixed(1)
        : null;
    const watchedCount = watchlistItems.filter((m) => ratings[m.id]).length;
    return { avgRating, watchedCount };
  }, [watchlistItems, ratings]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-24 space-y-8 animate-fadeIn">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Bookmark className="w-6 h-6 fill-amber-400/20" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                My Watchlist
              </h1>
              <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
                {watchlist.length} {watchlist.length === 1 ? 'film' : 'films'} queued for your upcoming movie nights
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {watchlist.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm('Are you sure you want to clear your entire watchlist?')) {
                  clearWatchlist();
                }
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 border border-slate-800 text-rose-400 hover:text-rose-300 hover:border-rose-900/40 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Clear Watchlist"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Watchlist
            </button>
          )}

          <button
            onClick={() => setActiveTab('rankings')}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition-all shadow-md shadow-indigo-950 cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5" />
            Browse Top Ranked
          </button>
        </div>
      </div>

      {/* Stats Cards (if watchlist has items) */}
      {stats && watchlist.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Saved
              </span>
              <div className="text-2xl font-black text-white">{watchlist.length}</div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Bookmark className="w-5 h-5" />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Average TMDB Score
              </span>
              <div className="text-2xl font-black text-amber-400">
                {stats.avgRating ? `★ ${stats.avgRating}` : 'N/A'}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Star className="w-5 h-5" />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Already Watched & Rated
              </span>
              <div className="text-2xl font-black text-emerald-400">
                {stats.watchedCount} / {watchlist.length}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
          </div>
        </div>
      )}

      {/* Filter and Sort Toolbar */}
      {watchlist.length > 0 && (
        <div className="space-y-3 glass-panel p-4 rounded-2xl border border-slate-800">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-grow max-w-md">
              <input
                type="text"
                placeholder="Search movies in your watchlist..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>

            {/* Sort Select */}
            <div className="flex items-center gap-2 self-end md:self-auto">
              <span className="text-xs text-slate-400 hidden sm:inline">Sort:</span>
              <select
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="recent">Recently Added</option>
                <option value="rating-desc">Highest TMDB Rating</option>
                <option value="year-desc">Release Year (Newest)</option>
                <option value="year-asc">Release Year (Oldest)</option>
                <option value="title">Title (A–Z)</option>
              </select>
            </div>
          </div>

          {/* Genre Chips */}
          {availableGenres.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-slate-800/60 pb-1 scrollbar-none">
              <button
                onClick={() => setSelectedGenre('all')}
                className={`text-xs px-3 py-1 rounded-lg whitespace-nowrap transition-all border cursor-pointer ${
                  selectedGenre === 'all'
                    ? 'bg-indigo-600 text-white border-indigo-500 font-semibold shadow-sm'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                All Genres ({watchlistItems.length})
              </button>
              {availableGenres.map((genre) => {
                const count = watchlistItems.filter((m) =>
                  (m.genres || []).some((g) => g.name.toLowerCase() === genre.toLowerCase())
                ).length;
                return (
                  <button
                    key={genre}
                    onClick={() => setSelectedGenre(genre)}
                    className={`text-xs px-2.5 py-1 rounded-lg whitespace-nowrap transition-all border cursor-pointer ${
                      selectedGenre === genre
                        ? 'bg-indigo-600 text-white border-indigo-500 font-semibold shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {genre} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Main Watchlist Grid or Empty State */}
      {watchlist.length === 0 ? (
        <div className="text-center py-20 glass-panel rounded-3xl p-8 sm:p-12 space-y-6 max-w-2xl mx-auto border border-slate-800">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-2xl shadow-amber-950/40">
            <Bookmark className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Your Watchlist is Empty
            </h2>
            <p className="text-slate-400 text-sm leading-relaxed max-w-md mx-auto">
              Save movies you want to watch by clicking the bookmark icon on any movie card in Top Ranked recommendations, Taste Calibration, or the details modal.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={() => setActiveTab('rankings')}
              className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-950 transition-all cursor-pointer"
            >
              <Trophy className="w-4 h-4 text-amber-400" />
              Discover AI Ranked Movies
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setActiveTab('calibration')}
              className="w-full sm:w-auto px-6 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
              Browse Iconic Calibration Grid
            </button>
          </div>
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="text-center py-16 glass-panel rounded-2xl p-8 space-y-3">
          <p className="text-slate-400 text-sm">No movies in your watchlist match this search or filter.</p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedGenre('all');
            }}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
          {filteredMovies.map((movie) => {
            const userRating = ratings[movie.id]?.rating;
            const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : null;
            const year = movie.release_date ? movie.release_date.slice(0, 4) : '';

            return (
              <div
                key={movie.id}
                className="group relative flex flex-col rounded-2xl overflow-hidden glass-panel glass-panel-hover border border-slate-800 transition-all"
              >
                {/* Poster Box */}
                <div
                  onClick={() => setSelectedMovieForModal(movie)}
                  className="relative aspect-[2/3] w-full bg-slate-900 overflow-hidden cursor-pointer"
                >
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={movie.title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-3 text-center text-xs text-slate-500 gap-1">
                      <Film className="w-8 h-8 text-slate-600" />
                      <span>{movie.title}</span>
                    </div>
                  )}

                  {/* Top Badges */}
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
                    <ShareButton movie={movie} variant="icon" iconSize="w-4 h-4" />
                    {/* Quick remove from watchlist button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(movie);
                      }}
                      className="p-1.5 rounded-lg bg-slate-950/80 backdrop-blur-md text-amber-400 hover:text-rose-400 hover:bg-rose-950/80 border border-amber-500/30 transition-all shadow-md cursor-pointer"
                      title="Remove from Watchlist"
                    >
                      <BookmarkCheck className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Rating / Score Badges */}
                  <div className="absolute bottom-2 left-2 flex flex-col gap-1">
                    {movie.vote_average > 0 && (
                      <span className="px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-md text-[11px] font-bold text-amber-400 border border-amber-500/20 shadow-md">
                        ★ {movie.vote_average.toFixed(1)}
                      </span>
                    )}

                    {userRating && (
                      <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-bold shadow-md border border-indigo-400/40">
                        Rated: {userRating}/10
                      </span>
                    )}
                  </div>
                </div>

                {/* Content Box */}
                <div className="p-3 flex flex-col flex-grow justify-between gap-2.5 bg-slate-950/90">
                  <div>
                    <h3
                      onClick={() => setSelectedMovieForModal(movie)}
                      className="text-xs sm:text-sm font-bold text-white line-clamp-1 cursor-pointer group-hover:text-indigo-300 transition-colors"
                    >
                      {movie.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                      {year && <span>{year}</span>}
                      {movie.genres && movie.genres.length > 0 && (
                        <>
                          <span>•</span>
                          <span className="line-clamp-1">{movie.genres[0]?.name}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Rating & Action Control */}
                  <div className="pt-1.5 border-t border-slate-800/60 space-y-1.5">
                    <RatingControl
                      currentRating={userRating}
                      onRate={(score) => setRating(movie, score)}
                      onClear={() => removeRating(movie.id)}
                      compact={true}
                    />

                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <button
                        onClick={() => setSelectedMovieForModal(movie)}
                        className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors cursor-pointer"
                      >
                        Details →
                      </button>

                      <button
                        onClick={() => toggleWatchlist(movie)}
                        className="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        title="Remove from Watchlist"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
