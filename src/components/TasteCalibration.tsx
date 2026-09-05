import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Search,
  Loader2,
  ArrowRight,
  CheckCircle2,
  SlidersHorizontal,
  Flame,
  Award,
  Brain,
  Clapperboard,
  Compass,
  Smile,
  Bookmark,
  BookmarkCheck,
  Shuffle,
  Eye,
  EyeOff,
  X,
  Star,
  Film,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useMovieStore } from '../store/useMovieStore';
import { getCalibrationMovies, searchMovies, CALIBRATION_CATEGORIES, IMAGE_BASE_URL } from '../services/tmdb';
import { Movie } from '../types';
import { RatingControl } from './RatingControl';
import { ShareButton } from './ShareButton';
import { useDebounce } from '../hooks/useDebounce';

export const TasteCalibration: React.FC = () => {
  const { ratings, watchlist, toggleWatchlist, setRating, removeRating, setSelectedMovieForModal, setActiveTab, generateRankings } = useMovieStore();
  
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [movies, setMovies] = useState<Movie[]>([]);
  const [page, setPage] = useState<number>(1);
  const [hasMore, setHasMore] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isShuffling, setIsShuffling] = useState<boolean>(false);
  const [hideRated, setHideRated] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Movie[] | null>(null);
  const [autocompleteResults, setAutocompleteResults] = useState<Movie[] | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 400ms debounce for real-time movie search
  const debouncedSearchQuery = useDebounce(searchQuery, 400);

  // Grace-period for rated movies: keeps card visible & fully interactive with a pulse before auto-hiding
  const [pendingRemovalIds, setPendingRemovalIds] = useState<Record<number, boolean>>({});
  const pendingTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Clean up all pending removal timers on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingTimersRef.current).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const ratedCount = Object.keys(ratings).length;
  const isProfileReady = ratedCount >= 3;

  const ratingsRef = useRef(ratings);
  ratingsRef.current = ratings;

  // Fetch calibration movies with user ratings for dynamic taste feedback
  const fetchCategoryMovies = useCallback(async (cat: string, pageNum: number, append = false) => {
    setIsLoading(true);
    try {
      const data = await getCalibrationMovies(cat, pageNum, { userRatings: ratingsRef.current });
      setMovies((prev) => (append ? [...prev, ...data.movies] : data.movies));
      setHasMore(pageNum < data.totalPages);
    } catch (err) {
      console.error('Failed to load calibration movies', err);
    } finally {
      setIsLoading(false);
      setIsShuffling(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    fetchCategoryMovies(activeCategory, 1, false);
  }, [activeCategory, fetchCategoryMovies]);

  // Real-time search effect with 400ms debounce and AbortController request cancellation
  useEffect(() => {
    const trimmed = debouncedSearchQuery.trim();

    // If query is empty, reset search results and autocomplete
    if (!trimmed) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setAutocompleteResults(null);
      setSearchResults(null);
      setIsDropdownOpen(false);
      setIsSearching(false);
      return;
    }

    // Require at least 3 characters for live searching
    if (trimmed.length < 3) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setAutocompleteResults(null);
      setIsDropdownOpen(false);
      setIsSearching(false);
      return;
    }

    // Abort previous in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsSearching(true);
    setIsDropdownOpen(true);

    searchMovies(trimmed, 1, controller.signal)
      .then((data) => {
        setAutocompleteResults(data.movies);
        setIsSearching(false);
      })
      .catch((err: any) => {
        if (err.name !== 'AbortError') {
          console.error('Real-time search failed', err);
          setIsSearching(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [debouncedSearchQuery]);

  // Click outside to close autocomplete dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle Search Submit (Immediate manual bypass via Enter key or Search button)
  const handleSearchSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults(null);
      setAutocompleteResults(null);
      setIsDropdownOpen(false);
      return;
    }

    if (trimmed.length < 3) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsDropdownOpen(false);
    setIsSearching(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const data = await searchMovies(trimmed, 1, controller.signal);
      setSearchResults(data.movies);
      setAutocompleteResults(data.movies);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Search failed', err);
      }
    } finally {
      setIsSearching(false);
    }
  };

  const handleClearSearch = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setSearchQuery('');
    setAutocompleteResults(null);
    setSearchResults(null);
    setIsDropdownOpen(false);
    setIsSearching(false);
  };

  const handleViewAllInGrid = () => {
    if (autocompleteResults && autocompleteResults.length > 0) {
      setSearchResults(autocompleteResults);
      setIsDropdownOpen(false);
    } else {
      handleSearchSubmit();
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

    // If hideRated is active, give the user a 2.5s grace window with a pulsing confirmation
    // so they can verify their click, feel confident, or adjust the grade before it leaves the grid.
    if (hideRated) {
      if (pendingTimersRef.current[movie.id]) {
        clearTimeout(pendingTimersRef.current[movie.id]);
      }
      setPendingRemovalIds((prev) => ({ ...prev, [movie.id]: true }));

      pendingTimersRef.current[movie.id] = setTimeout(() => {
        setPendingRemovalIds((prev) => {
          const next = { ...prev };
          delete next[movie.id];
          return next;
        });
        delete pendingTimersRef.current[movie.id];
      }, 4000);
    }
  };

  const handleClearRating = (movieId: number) => {
    // If the movie was in its grace period, cancel the removal timer
    if (pendingTimersRef.current[movieId]) {
      clearTimeout(pendingTimersRef.current[movieId]);
      delete pendingTimersRef.current[movieId];
    }
    setPendingRemovalIds((prev) => {
      const next = { ...prev };
      delete next[movieId];
      return next;
    });
    removeRating(movieId);
  };

  const handleShuffle = () => {
    setIsShuffling(true);
    const pageCandidates = [1, 2, 3, 4, 5, 6].filter((p) => p !== page);
    const randomPage = pageCandidates[Math.floor(Math.random() * pageCandidates.length)] || 1;
    setPage(randomPage);
    fetchCategoryMovies(activeCategory, randomPage, false);
  };

  // When hideRated is active, quietly append next page in background only when remaining unrated films get critically low (< 4)
  useEffect(() => {
    if (hideRated && searchResults === null && !isLoading && !isShuffling && hasMore && movies.length > 0) {
      const unratedCount = movies.filter((m) => !ratingsRef.current[m.id]).length;
      if (unratedCount < 4) {
        setPage((prevPage) => {
          const nextPage = prevPage + 1;
          fetchCategoryMovies(activeCategory, nextPage, true);
          return nextPage;
        });
      }
    }
  }, [movies.length, hideRated, searchResults, isLoading, isShuffling, hasMore, activeCategory, fetchCategoryMovies]);

  // Search results are 100% uncapped; browse grid applies hideRated filter but retains pending removal items during grace window
  const displayedMovies = searchResults !== null
    ? searchResults
    : (hideRated
        ? movies.filter((m) => !ratings[m.id] || Boolean(pendingRemovalIds[m.id]))
        : movies);

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
        {/* Search Bar & Autocomplete Container */}
        <div ref={searchContainerRef} className="relative max-w-xl">
          <form onSubmit={handleSearchSubmit} className="relative">
            <input
              type="text"
              placeholder="Search any movie to rate it (e.g. Interstellar, Parasite, Godfather)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => {
                if (searchQuery.trim().length >= 3 && autocompleteResults !== null) {
                  setIsDropdownOpen(true);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsDropdownOpen(false);
                }
              }}
              className="w-full pl-11 pr-28 py-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all shadow-inner"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />

            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                type="submit"
                disabled={isSearching}
                className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-md shadow-indigo-950/40 disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
              </button>
            </div>
          </form>

          {/* Sub-3 character helper hint */}
          {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
            <p className="text-[11px] text-indigo-400/90 font-medium pt-1.5 pl-2 flex items-center gap-1.5">
              <span>Type at least 3 characters to search...</span>
            </p>
          )}

          {/* Floating Live Autocomplete Dropdown */}
          {isDropdownOpen && searchQuery.trim().length >= 3 && (
            <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-slate-900/95 backdrop-blur-2xl border border-slate-700/80 rounded-2xl shadow-2xl shadow-slate-950/90 overflow-hidden">
              {/* Dropdown Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800/80 bg-slate-950/50 text-xs text-slate-400">
                <div className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Real-Time Suggestions</span>
                </div>
                {isSearching ? (
                  <div className="flex items-center gap-1.5 text-indigo-400 text-[11px]">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Searching TMDB...</span>
                  </div>
                ) : (
                  autocompleteResults && (
                    <span className="text-[11px] text-slate-500">
                      {autocompleteResults.length} film{autocompleteResults.length === 1 ? '' : 's'} found
                    </span>
                  )
                )}
              </div>

              {/* Dropdown Body */}
              {isSearching && (!autocompleteResults || autocompleteResults.length === 0) ? (
                <div className="p-6 text-center text-slate-400 text-xs space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-500 mx-auto" />
                  <p className="text-slate-300">Searching TMDB for "{searchQuery}"...</p>
                </div>
              ) : !isSearching && autocompleteResults && autocompleteResults.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs space-y-1">
                  <Film className="w-6 h-6 text-slate-600 mx-auto mb-1" />
                  <p className="font-semibold text-slate-300">No movies found</p>
                  <p className="text-slate-500 text-[11px]">No results matching "{searchQuery}". Check the spelling or try another title.</p>
                </div>
              ) : autocompleteResults && autocompleteResults.length > 0 ? (
                <>
                  <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-800/60">
                    {autocompleteResults.slice(0, 7).map((movie) => {
                      const userRating = ratings[movie.id]?.rating;
                      const inWatchlist = watchlist.includes(movie.id);
                      const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : null;
                      const year = movie.release_date ? movie.release_date.slice(0, 4) : '';
                      const genres = (movie.genres || []).slice(0, 2).map((g) => g.name).join(', ');

                      return (
                        <div
                          key={movie.id}
                          onClick={() => {
                            setSelectedMovieForModal(movie);
                            setIsDropdownOpen(false);
                          }}
                          className="group flex items-center justify-between p-3 hover:bg-slate-800/70 transition-colors cursor-pointer gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Poster Thumbnail */}
                            <div className="w-10 h-14 rounded-lg bg-slate-800 overflow-hidden shrink-0 border border-slate-700/50 relative">
                              {posterUrl ? (
                                <img
                                  src={posterUrl}
                                  alt={movie.title}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-600">
                                  <Film className="w-4 h-4" />
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-xs font-semibold text-white group-hover:text-indigo-300 transition-colors truncate">
                                  {movie.title}
                                </h4>
                                {year && <span className="text-[11px] text-slate-500 shrink-0">({year})</span>}
                              </div>

                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                                {movie.vote_average > 0 && (
                                  <span className="text-amber-400 font-bold flex items-center gap-0.5">
                                    ★ {movie.vote_average.toFixed(1)}
                                  </span>
                                )}
                                {genres && (
                                  <>
                                    <span className="text-slate-600">•</span>
                                    <span className="truncate text-slate-400">{genres}</span>
                                  </>
                                )}
                              </div>

                              {userRating && (
                                <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  <span>Rated {userRating}/10</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Quick Actions */}
                          <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => toggleWatchlist(movie)}
                              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                                inWatchlist
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                                  : 'bg-slate-800/80 text-slate-400 border-slate-700/60 hover:text-white hover:border-slate-500'
                              }`}
                              title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                            >
                              {inWatchlist ? <BookmarkCheck className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
                            </button>

                            <button
                              onClick={() => {
                                setSelectedMovieForModal(movie);
                                setIsDropdownOpen(false);
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 text-[11px] font-medium transition-all cursor-pointer"
                            >
                              {userRating ? 'Edit Grade' : 'Rate Film'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Dropdown Footer */}
                  <div className="p-2.5 border-t border-slate-800/80 bg-slate-950/60">
                    <button
                      type="button"
                      onClick={handleViewAllInGrid}
                      className="w-full py-2 px-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 hover:text-indigo-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <span>View all {autocompleteResults.length} results in main grid</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Categories Bar & Calibration Controls */}
        {searchResults === null && (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Category Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1.5 scrollbar-none flex-1">
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

            {/* Grid Tools: Shuffle Batch & Hide Rated Toggle */}
            <div className="flex items-center gap-2 shrink-0 self-start md:self-auto">
              {/* Shuffle Button */}
              <button
                onClick={handleShuffle}
                disabled={isLoading || isShuffling}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-200 hover:text-white text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer disabled:opacity-50"
                title="Shuffle for a fresh randomized batch of iconic films"
              >
                <Shuffle className={`w-3.5 h-3.5 text-purple-400 ${isShuffling ? 'animate-spin' : ''}`} />
                <span>Shuffle Batch</span>
              </button>

              {/* Hide/Show Rated Toggle */}
              <button
                onClick={() => setHideRated((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border cursor-pointer ${
                  hideRated
                    ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/30 shadow-sm'
                    : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                }`}
                title={hideRated ? 'Click to show already rated movies' : 'Click to hide already rated movies'}
              >
                {hideRated ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Hide Rated</span>
                    <span className="px-1.5 py-0.5 bg-indigo-500/30 text-indigo-200 rounded-md text-[10px] font-bold">
                      ON
                    </span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                    <span>Show Rated</span>
                    <span className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-md text-[10px] font-bold">
                      OFF
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Clear Search filter state */}
        {searchResults !== null && (
          <div className="flex items-center justify-between py-1 text-sm text-slate-400">
            <span>Search Results for "{searchQuery}" ({searchResults.length} found)</span>
            <button
              onClick={handleClearSearch}
              className="text-indigo-400 hover:text-indigo-300 text-xs font-medium underline cursor-pointer"
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
        <div className="text-center py-16 space-y-4 glass-panel rounded-3xl border border-slate-800/80 p-8">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto text-indigo-400">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">
              {hideRated && movies.length > 0 ? 'All Movies in this Batch Rated!' : 'No movies found.'}
            </h3>
            <p className="text-slate-400 text-sm max-w-md mx-auto">
              {hideRated && movies.length > 0
                ? "You've calibrated every film shown in this batch. Shuffle for a fresh set, or toggle \"Show Rated\" to review your ratings."
                : 'Try another search query or choose a different category.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={handleShuffle}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-bold flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-950/60 transition-all active:scale-95"
            >
              <Shuffle className="w-4 h-4" />
              Shuffle Fresh Batch
            </button>
            {hideRated && ratedCount > 0 && (
              <button
                onClick={() => setHideRated(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-2 cursor-pointer transition-all border border-slate-700/60"
              >
                <Eye className="w-4 h-4" />
                Show Rated Films ({ratedCount})
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
          {displayedMovies.map((movie) => {
            const userRating = ratings[movie.id]?.rating;
            const inWatchlist = watchlist.includes(movie.id);
            const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : null;
            const year = movie.release_date ? movie.release_date.slice(0, 4) : '';
            const isPendingRemoval = Boolean(pendingRemovalIds[movie.id]);

            return (
              <div
                key={movie.id}
                onClick={() => setSelectedMovieForModal(movie)}
                className={`group relative flex flex-col rounded-2xl overflow-hidden glass-panel glass-panel-hover cursor-pointer border transition-all duration-300 ${
                  isPendingRemoval
                    ? 'animate-pulse-glow bg-slate-900/95'
                    : 'border-slate-800/80'
                }`}
              >
                {/* Active Pending Grace Indicator Strip */}
                {isPendingRemoval && (
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-400 via-indigo-400 to-purple-400 animate-shimmer z-30 shadow-md shadow-indigo-500/50" />
                )}

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

                  {/* Top Left: Score Badge & User Rating Indicator Badge */}
                  <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
                    {movie.vote_average > 0 && (
                      <div className="px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-md text-[11px] font-bold text-amber-400 border border-amber-500/20 shadow-md">
                        ★ {movie.vote_average.toFixed(1)}
                      </div>
                    )}

                    {userRating && (
                      <div
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold shadow-lg shadow-indigo-950 border transition-all ${
                          isPendingRemoval
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black border-emerald-300 shadow-emerald-950/80 flex items-center gap-1'
                            : 'bg-indigo-600 text-white border-indigo-400/40'
                        }`}
                      >
                        {isPendingRemoval ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-slate-950 stroke-[2.5]" />
                            <span>Rated: {userRating}/10</span>
                          </>
                        ) : (
                          <span>Rated: {userRating}/10</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Top Right: Watchlist & Share Action Buttons */}
                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(movie);
                      }}
                      className={`p-1.5 rounded-md backdrop-blur-md border transition-all cursor-pointer ${
                        inWatchlist
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-md'
                          : 'bg-slate-950/80 text-slate-400 border-slate-700/60 hover:text-white opacity-90 sm:opacity-0 sm:group-hover:opacity-100'
                      }`}
                      title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                    >
                      {inWatchlist ? <BookmarkCheck className="w-3.5 h-3.5 text-amber-400" /> : <Bookmark className="w-3.5 h-3.5" />}
                    </button>

                    <ShareButton
                      movie={movie}
                      variant="icon"
                      iconSize="w-3.5 h-3.5"
                      className="p-1.5 rounded-md opacity-90 sm:opacity-0 sm:group-hover:opacity-100"
                    />
                  </div>
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
                  <div className="pt-1 border-t border-slate-800/60 space-y-1">
                    {isPendingRemoval && (
                      <div className="flex items-center justify-between text-[11px] text-white bg-gradient-to-r from-indigo-900 via-purple-900 to-indigo-900 px-2.5 py-1.5 rounded-lg border border-indigo-400 shadow-lg shadow-indigo-950">
                        <span className="font-bold flex items-center gap-1.5 text-emerald-300">
                          ✓ Grade saved! Hiding soon...
                        </span>
                      </div>
                    )}

                    <RatingControl
                      currentRating={userRating}
                      onRate={(score) => handleRateMovie(movie, score)}
                      onClear={() => handleClearRating(movie.id)}
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
