import React, { useState, useEffect, useCallback } from 'react';
import { Sparkles, Search, Loader2, ArrowRight, CheckCircle2, SlidersHorizontal, Flame, Award, Brain, Clapperboard, Compass, Smile } from 'lucide-react';
import confetti from 'canvas-confetti';
import { useMovieStore } from '../store/useMovieStore';
import { getCalibrationMovies, searchMovies, CALIBRATION_CATEGORIES, IMAGE_BASE_URL } from '../services/tmdb';
import { Movie } from '../types';
import { RatingControl } from './RatingControl';

export const TasteCalibration: React.FC = () => {
  const { ratings, setRating, removeRating, setSelectedMovieForModal, setActiveTab, generateRankings } = useMovieStore();
  
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Movie[] | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  const ratedCount = Object.keys(ratings).length;
  const isProfileReady = ratedCount >= 3;

  // Fetch calibration movies
  const fetchCategoryMovies = useCallback(async (cat: string, pageNum: number, append = false) => {
    setIsLoading(true);
    try {
      const data = await getCalibrationMovies(cat, pageNum);
      setMovies((prev) => (append ? [...prev, ...data.movies] : data.movies));
      setHasMore(pageNum < data.totalPages);
    } catch (err) {
      console.error('Failed to load calibration movies', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    fetchCategoryMovies(activeCategory, 1, false);
  }, [activeCategory, fetchCategoryMovies]);

  // Handle Search
  const handleSearchSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    setIsSearching(true);
    try {
      const data = await searchMovies(searchQuery.trim());
      setSearchResults(data.movies);
    } catch (err) {
      console.error('Search failed', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleRateMovie = (movie: Movie, score: number) => {
    const isNewRating = !ratings[movie.id];
    setRating(movie, score);

    // Fire celebratory confetti when reaching 5 or 10 ratings
    if (isNewRating && (ratedCount + 1 === 3 || ratedCount + 1 === 5 || ratedCount + 1 === 10)) {
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.8 },
      });
    }
  };

  const displayedMovies = searchResults !== null ? searchResults : movies;

  const getCategoryIcon = (iconName: string) => {
    switch (iconName) {
      case 'Brain': return <Brain className="w-3.5 h-3.5" />;
      case 'Award': return <Award className="w-3.5 h-3.5" />;
      case 'Flame': return <Flame className="w-3.5 h-3.5" />;
      case 'Clapperboard': return <Clapperboard className="w-3.5 h-3.5" />;
      case 'Compass': return <Compass className="w-3.5 h-3.5" />;
      case 'Smile': return <Smile className="w-3.5 h-3.5" />;
      default: return <Sparkles className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 pb-20">
      {/* Hero / Taste Calibration Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-950/80 via-slate-900/90 to-purple-950/80 border border-indigo-900/40 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-semibold border border-indigo-500/30">
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
              Taste Calibration
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
              Calibrate Your Movie DNA
            </h1>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
              Rate the movies you have seen on a <strong className="text-white">1–10 scale</strong>. Our multi-factor AI will analyze your director affinities, narrative tropes, and pacing preferences to generate your personalized ranked list.
            </p>
          </div>

          {/* Progress Tracker Card */}
          <div className="glass-panel p-5 rounded-2xl border border-slate-700/60 min-w-[260px] flex flex-col justify-center space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Ratings Logged</span>
              <span className="text-indigo-400 font-bold text-sm">{ratedCount} rated</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-500"
                style={{ width: `${Math.min(100, (ratedCount / 5) * 100)}%` }}
              />
            </div>

            {isProfileReady ? (
              <button
                onClick={() => {
                  generateRankings();
                  setActiveTab('rankings');
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/60 transition-all active:scale-95 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                View Your Ranked List ({ratedCount})
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <p className="text-[11px] text-slate-400 text-center font-medium">
                Rate <strong className="text-indigo-300">{Math.max(0, 3 - ratedCount)} more</strong> to activate AI rankings
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Search & Category Filter Bar */}
      <div className="space-y-4">
        {/* Search Bar */}
        <form onSubmit={handleSearchSubmit} className="relative max-w-xl">
          <input
            type="text"
            placeholder="Search any movie to rate it (e.g. Interstellar, Parasite, Godfather)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-11 pr-24 py-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-inner"
          />
          <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
          <button
            type="submit"
            disabled={isSearching}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all cursor-pointer"
          >
            {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
          </button>
        </form>

        {/* Categories Bar */}
        {searchResults === null && (
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {CALIBRATION_CATEGORIES.map((cat) => {
              const isSelected = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all border cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-950'
                      : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                  }`}
                >
                  {getCategoryIcon(cat.icon)}
                  {cat.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Clear Search filter state */}
        {searchResults !== null && (
          <div className="flex items-center justify-between py-1 text-sm text-slate-400">
            <span>Search Results for "{searchQuery}" ({searchResults.length} found)</span>
            <button
              onClick={() => {
                setSearchResults(null);
                setSearchQuery('');
              }}
              className="text-indigo-400 hover:text-indigo-300 text-xs font-medium underline"
            >
              Clear Search & Back to Iconic Grid
            </button>
          </div>
        )}
      </div>

      {/* Movies Grid */}
      {isLoading && displayedMovies.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="aspect-[2/3] rounded-2xl animate-shimmer" />
          ))}
        </div>
      ) : displayedMovies.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p>No movies found. Try another search or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
          {displayedMovies.map((movie) => {
            const userRating = ratings[movie.id]?.rating;
            const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : null;
            const year = movie.release_date ? movie.release_date.slice(0, 4) : '';

            return (
              <div
                key={movie.id}
                onClick={() => setSelectedMovieForModal(movie)}
                className="group relative flex flex-col rounded-2xl overflow-hidden glass-panel glass-panel-hover cursor-pointer border border-slate-800/80"
              >
                {/* Poster Box */}
                <div className="relative aspect-[2/3] w-full bg-slate-900 overflow-hidden">
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={movie.title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-4 text-center text-xs text-slate-500">
                      No Poster Available
                    </div>
                  )}

                  {/* Gradient Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

                  {/* TMDB Score Badge */}
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-md text-[11px] font-bold text-amber-400 border border-amber-500/20 shadow-md">
                    ★ {movie.vote_average.toFixed(1)}
                  </div>

                  {/* User Rating Indicator Badge */}
                  {userRating && (
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[11px] font-bold shadow-lg shadow-indigo-950 border border-indigo-400/40">
                      Rated: {userRating}/10
                    </div>
                  )}
                </div>

                {/* Content Box */}
                <div className="p-3 flex flex-col flex-grow justify-between gap-2.5 bg-slate-950/90">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-indigo-300 transition-colors">
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

                  {/* 1-10 Rating Control */}
                  <div className="pt-1 border-t border-slate-800/60">
                    <RatingControl
                      currentRating={userRating}
                      onRate={(score) => handleRateMovie(movie, score)}
                      onClear={() => removeRating(movie.id)}
                      compact={true}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Infinite/Pagination "Load More" */}
      {searchResults === null && hasMore && (
        <div className="flex justify-center pt-6">
          <button
            onClick={() => {
              const nextPage = page + 1;
              setPage(nextPage);
              fetchCategoryMovies(activeCategory, nextPage, true);
            }}
            disabled={isLoading}
            className="px-6 py-3 rounded-2xl glass-panel text-slate-200 hover:text-white hover:border-indigo-500 text-sm font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-lg active:scale-95 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-indigo-400" />}
            {isLoading ? 'Loading More Movies...' : 'Explore More Iconic Films'}
          </button>
        </div>
      )}
    </div>
  );
};
