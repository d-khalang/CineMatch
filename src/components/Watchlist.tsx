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
            <Bookmark className="w-6 h-6 sm:w-7 sm:h-7 text-[var(--accent-primary)] fill-[var(--accent-primary)]/15 flex-shrink-0" />
            <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              My Watchlist
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {watchlist.length} {watchlist.length === 1 ? 'film' : 'films'} queued for your upcoming movie nights
          </p>
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
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-rose-400 hover:text-rose-300 hover:border-rose-500/40 flex items-center gap-1.5 transition-all cursor-pointer"
              title="Clear Watchlist"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear Watchlist
            </button>
          )}

          <button
            onClick={() => setActiveTab('rankings')}
            className="btn-tactile btn-tactile-primary px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Trophy className="w-3.5 h-3.5" />
            Browse Top Ranked
          </button>
        </div>
      </div>

      {/* Stats Cards (if watchlist has items) */}
      {stats && watchlist.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <div className="glass-panel p-4 rounded-2xl border border-[var(--border-subtle)] flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Total Saved
              </span>
              <div className="text-2xl font-black text-white">{watchlist.length}</div>
            </div>
            <div className="w-9 h-9 rounded-full palette-tag-primary flex items-center justify-center text-white">
              <Bookmark className="w-4 h-4" />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-[var(--border-subtle)] flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Average TMDB Score
              </span>
              <div className="text-2xl font-black text-[var(--accent-secondary)]">
                {stats.avgRating ? `★ ${stats.avgRating}` : 'N/A'}
              </div>
            </div>
            <div className="w-9 h-9 rounded-full palette-tag-secondary flex items-center justify-center text-[var(--accent-secondary)]">
              <Star className="w-4 h-4" />
            </div>
          </div>

          <div className="glass-panel p-4 rounded-2xl border border-[var(--border-subtle)] flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Already Watched & Rated
              </span>
              <div className="text-2xl font-black text-[var(--accent-primary)]">
                {stats.watchedCount} / {watchlist.length}
              </div>
            </div>
            <div className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[var(--accent-secondary)]">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
        </div>
      )}

      {/* Filter and Sort Toolbar */}
      {watchlist.length > 0 && (
        <div className="space-y-3 glass-panel p-4 rounded-2xl border border-[var(--border-subtle)]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Search */}
            <div className="relative flex-grow max-w-md">
              <input
                type="text"
                placeholder="Search movies in your watchlist..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-slate-200 focus:outline-none focus:border-[var(--border-focus)]"
              />
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            </div>

            {/* Sort Select */}
            <div className="flex items-center gap-2 self-end md:self-auto">
              <span className="text-xs text-slate-400 hidden sm:inline">Sort:</span>
              <select
                value={sortBy}
                onChange={(e: any) => setSortBy(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-slate-300 focus:outline-none focus:border-[var(--border-focus)] cursor-pointer"
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
            <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-[var(--border-subtle)] pb-1 scrollbar-none">
              <button
                onClick={() => setSelectedGenre('all')}
                className={`btn-tactile text-xs px-3 py-1 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                  selectedGenre === 'all'
                    ? 'btn-tactile-primary shadow-sm'
                    : 'btn-tactile-secondary'
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
                    className={`btn-tactile text-xs px-2.5 py-1 rounded-lg whitespace-nowrap transition-all cursor-pointer ${
                      selectedGenre === genre
                        ? 'btn-tactile-primary shadow-sm'
                        : 'btn-tactile-secondary'
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
        <div className="text-center py-20 glass-panel rounded-3xl p-8 sm:p-12 space-y-6 max-w-2xl mx-auto border border-[var(--border-subtle)]">
          <div className="w-20 h-20 mx-auto rounded-3xl palette-tag-secondary flex items-center justify-center shadow-2xl">
            <Bookmark className="w-10 h-10 text-[var(--accent-secondary)]" />
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
              className="btn-tactile btn-tactile-primary w-full sm:w-auto px-6 py-2.5 text-xs font-bold shadow-lg"
            >
              <Trophy className="w-4 h-4" />
              <span>Discover Ranked Movies</span>
            </button>

            <button
              onClick={() => setActiveTab('calibration')}
              className="btn-tactile btn-tactile-secondary w-full sm:w-auto px-6 py-2.5 text-xs font-semibold"
            >
              <SlidersHorizontal className="w-4 h-4 text-[var(--accent-primary)]" />
              <span>Browse Calibration Grid</span>
            </button>
          </div>
        </div>
      ) : filteredMovies.length === 0 ? (
        <div className="text-center py-16 glass-panel rounded-2xl p-8 space-y-3 border border-[var(--border-subtle)]">
          <p className="text-slate-400 text-sm">No movies in your watchlist match this search or filter.</p>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedGenre('all');
            }}
            className="text-xs text-[var(--accent-secondary)] hover:underline font-semibold"
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
                className="group relative flex flex-col rounded-2xl overflow-hidden glass-panel glass-panel-hover border border-[var(--border-subtle)] transition-all"
              >
                {/* Poster Box */}
                <div
                  onClick={() => setSelectedMovieForModal(movie)}
                  className="relative aspect-[2/3] w-full bg-[var(--bg-canvas)] overflow-hidden cursor-pointer"
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
                      <Film className="w-6 h-6 text-slate-600" />
                      <span className="font-semibold text-slate-400">No Poster</span>
                    </div>
                  )}

                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-surface)] via-transparent to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

                  {/* Top Right: Watchlist remove action */}
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(movie);
                      }}
                      className="p-1.5 rounded-lg bg-[var(--bg-surface)]/90 backdrop-blur-md text-[var(--accent-hover)] hover:text-rose-400 border border-[var(--border-subtle)] transition-all shadow-md cursor-pointer"
                      title="Remove from Watchlist"
                    >
                      <BookmarkCheck className="w-3.5 h-3.5" />
                    </button>
                    <ShareButton
                      movie={movie}
                      variant="icon"
                      iconSize="w-3.5 h-3.5"
                      className="p-1.5 rounded-lg opacity-90 sm:opacity-0 sm:group-hover:opacity-100 bg-[var(--bg-surface)]/90 border border-[var(--border-subtle)]"
                    />
                  </div>

                  {/* Top Left Rating Badge */}
                  {movie.vote_average > 0 && (
                    <div className="absolute top-2 left-2 z-10">
                      <span className="px-2 py-0.5 rounded-md bg-[var(--bg-surface)]/90 backdrop-blur-md text-[11px] font-bold text-amber-400 border border-[var(--border-subtle)] shadow-md">
                        ★ {movie.vote_average.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Content Box */}
                <div className="p-3 flex flex-col flex-grow justify-between gap-2.5 card-content-box">
                  <div>
                    <h3
                      onClick={() => setSelectedMovieForModal(movie)}
                      className="text-xs sm:text-sm font-bold text-white line-clamp-1 cursor-pointer group-hover:text-[var(--accent-secondary)] transition-colors"
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
                  <div className="pt-1.5 border-t border-[var(--border-subtle)] space-y-1.5">
                    <RatingControl
                      currentRating={userRating}
                      onRate={(score) => setRating(movie, score)}
                      onClear={() => removeRating(movie.id)}
                      compact={true}
                    />

                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <button
                        onClick={() => setSelectedMovieForModal(movie)}
                        className="text-[var(--accent-primary)] hover:underline font-semibold transition-colors cursor-pointer"
                      >
                        Details
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
