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
  Film,
} from 'lucide-react';
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
    const timers = pendingTimersRef.current;
    return () => {
      Object.values(timers).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const ratedCount = Object.keys(ratings).length;
  const isProfileReady = ratedCount >= 3;

  const ratingsRef = useRef(ratings);
  useEffect(() => {
    ratingsRef.current = ratings;
  }, [ratings]);

  // Fetch calibration movies with user ratings for dynamic taste feedback
  const fetchCategoryMovies = useCallback(async (cat: string, pageNum: number, append = false) => {
    setIsLoading(true);
    try {
      const data = await getCalibrationMovies(cat, pageNum, { userRatings: ratingsRef.current });
      setMovies((prev) => {
        if (!append) return data.movies;
        const existingIds = new Set(prev.map((m) => m.id));
        const newMovies = data.movies.filter((m) => !existingIds.has(m.id));
        return [...prev, ...newMovies];
      });
      setHasMore(pageNum < data.totalPages);
    } catch (err) {
      console.error('Failed to load calibration movies', err);
    } finally {
      setIsLoading(false);
      setIsShuffling(false);
    }
  }, []);

  const handleCategorySelect = useCallback((catId: string) => {
    setActiveCategory(catId);
    setPage(1);
    fetchCategoryMovies(catId, 1, false);
  }, [fetchCategoryMovies]);

  useEffect(() => {
    fetchCategoryMovies('all', 1, false);
  }, [fetchCategoryMovies]);

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

    // Fire celebratory confetti when reaching 3, 5, or 10 ratings
    if (isNewRating && (ratedCount + 1 === 3 || ratedCount + 1 === 5 || ratedCount + 1 === 10)) {
      import('canvas-confetti')
        .then((m) => {
          m.default({
            particleCount: 70,
            spread: 60,
            origin: { y: 0.8 },
          });
        })
        .catch(() => {});
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
      {/* Hero / Taste Calibration Header (Archival Cinephile Console) */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 -mr-20 -mt-20 w-72 h-72 bg-[var(--accent-glow)] rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md palette-tag-secondary text-xs font-mono tracking-wider uppercase">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Taste Profiler & Vector Engine</span>
            </div>
            <h1 className="font-heading text-2xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Calibrate Your Cinephile Index
            </h1>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
              Rate titles you have seen on a <strong className="text-white font-semibold">1–10 scale</strong>. The intelligence engine models director synergies, thematic resonance, and narrative density to rank cinema tailored to your taste.
            </p>
          </div>

          {/* Progress Tracker Card (Archival Step Gauge) */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] p-5 min-w-[270px] shadow-inner flex flex-col justify-center space-y-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Calibrated Sample</span>
              <span className="font-mono text-xs font-bold text-[var(--accent-secondary)]">
                {ratedCount} <span className="text-slate-500 font-normal">/ 5 logged</span>
              </span>
            </div>

            {/* Precision Step Gauge */}
            <div className="space-y-1.5">
              <div className="grid grid-cols-5 gap-1.5 w-full">
                {[1, 2, 3, 4, 5].map((step) => {
                  const isDone = ratedCount >= step;
                  const isCurrent = ratedCount + 1 === step;
                  return (
                    <div
                      key={step}
                      className={`h-2 rounded-sm transition-all duration-300 ${
                        isDone
                          ? 'bg-[var(--accent-primary)] shadow-sm'
                          : isCurrent
                          ? 'bg-white/25 animate-pulse'
                          : 'bg-white/5'
                      }`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>Start</span>
                <span className={ratedCount >= 3 ? 'text-[var(--accent-secondary)] font-semibold' : ''}>
                  3: Ready
                </span>
                <span className={ratedCount >= 5 ? 'text-[var(--accent-secondary)] font-semibold' : ''}>
                  5: Synergies
                </span>
              </div>
            </div>

            {isProfileReady ? (
              <button
                onClick={() => {
                  generateRankings();
                  setActiveTab('rankings');
                }}
                className="btn-tactile btn-tactile-primary w-full py-2.5 px-4 text-xs font-bold shadow-lg"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>View Personalized Rankings ({ratedCount})</span>
              </button>
            ) : (
              <p className="text-[11px] text-slate-400 text-center font-medium">
                Rate <strong className="text-[var(--accent-primary)] font-bold">{Math.max(0, 3 - ratedCount)} more</strong> to activate rankings
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
              className="w-full pl-11 pr-28 py-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-slate-100 placeholder-slate-500 text-sm focus:outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-all shadow-inner"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />

            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {searchQuery.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                type="submit"
                disabled={isSearching}
                className="btn-tactile btn-tactile-primary px-3.5 py-1.5 text-xs disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
              </button>
            </div>
          </form>

          {/* Sub-3 character helper hint */}
          {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
            <p className="text-[11px] text-[var(--accent-secondary)] font-medium pt-1.5 pl-2 flex items-center gap-1.5">
              <span>Type at least 3 characters to search...</span>
            </p>
          )}

          {/* Floating Live Autocomplete Dropdown */}
          {isDropdownOpen && searchQuery.trim().length >= 3 && (
            <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-[var(--bg-surface-elevated)]/95 backdrop-blur-2xl border border-[var(--border-subtle)] rounded-2xl shadow-2xl overflow-hidden">
              {/* Dropdown Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 text-xs text-slate-400">
                <div className="flex items-center gap-1.5 font-medium text-[var(--accent-secondary)]">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Real-Time Suggestions</span>
                </div>
                {isSearching ? (
                  <div className="flex items-center gap-1.5 text-[var(--accent-secondary)] text-[11px]">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Searching TMDB...</span>
                  </div>
                ) : (
                  autocompleteResults && (
                    <span className="text-[11px] text-slate-400 font-mono">
                      {autocompleteResults.length} film{autocompleteResults.length === 1 ? '' : 's'} found
                    </span>
                  )
                )}
              </div>

              {/* Dropdown Body */}
              {isSearching && (!autocompleteResults || autocompleteResults.length === 0) ? (
                <div className="p-6 text-center text-slate-400 text-xs space-y-2">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--accent-primary)] mx-auto" />
                  <p className="text-slate-300">Searching TMDB for "{searchQuery}"...</p>
                </div>
              ) : !isSearching && autocompleteResults && autocompleteResults.length === 0 ? (
                <div className="p-6 text-center text-slate-400 text-xs space-y-1">
                  <Film className="w-6 h-6 text-slate-500 mx-auto mb-1" />
                  <p className="font-semibold text-slate-300">No movies found</p>
                  <p className="text-slate-400 text-[11px]">No results matching "{searchQuery}". Check the spelling or try another title.</p>
                </div>
              ) : autocompleteResults && autocompleteResults.length > 0 ? (
                <>
                  <div className="max-h-[360px] overflow-y-auto divide-y divide-[var(--border-subtle)]">
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
                          className="group flex items-center justify-between p-3 hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer gap-3"
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            {/* Poster Thumbnail */}
                            <div className="w-10 h-14 rounded-lg bg-[var(--bg-surface)] overflow-hidden shrink-0 border border-[var(--border-subtle)] relative">
                              {posterUrl ? (
                                <img
                                  src={posterUrl}
                                  alt={movie.title}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-500">
                                  <Film className="w-4 h-4" />
                                </div>
                              )}
                            </div>

                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-xs font-semibold text-white group-hover:text-[var(--accent-secondary)] transition-colors truncate">
                                  {movie.title}
                                </h4>
                                {year && <span className="text-[11px] text-slate-400 shrink-0">({year})</span>}
                              </div>

                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                                {movie.vote_average > 0 && (
                                  <span className="text-amber-400 font-bold flex items-center gap-0.5">
                                    ★ {movie.vote_average.toFixed(1)}
                                  </span>
                                )}
                                {genres && (
                                  <>
                                    <span className="text-slate-500">•</span>
                                    <span className="truncate text-slate-400">{genres}</span>
                                  </>
                                )}
                              </div>

                              {userRating && (
                                <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold palette-tag-secondary px-1.5 py-0.5 rounded">
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
                                  ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-hover)] border-[var(--border-focus)] shadow-sm'
                                  : 'bg-[var(--bg-surface)] text-slate-400 border-[var(--border-subtle)] hover:text-white'
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
                              className="px-2.5 py-1.5 rounded-lg btn-tactile btn-tactile-secondary text-[11px]"
                            >
                              {userRating ? 'Edit Grade' : 'Rate Film'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Dropdown Footer */}
                  <div className="p-2.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                    <button
                      type="button"
                      onClick={handleViewAllInGrid}
                      className="btn-tactile btn-tactile-primary w-full py-2 px-3 text-xs font-semibold flex items-center justify-center gap-1.5"
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
                    onClick={() => handleCategorySelect(cat.id)}
                    className={`btn-tactile px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-all border cursor-pointer ${
                      isSelected
                        ? 'btn-tactile-primary shadow-md'
                        : 'btn-tactile-secondary'
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
                className="btn-tactile btn-tactile-secondary px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
                title="Shuffle for a fresh randomized batch of iconic films"
              >
                <Shuffle className={`w-3.5 h-3.5 text-[var(--accent-primary)] ${isShuffling ? 'animate-spin' : ''}`} />
                <span>Shuffle Batch</span>
              </button>

              {/* Hide/Show Rated Toggle */}
              <button
                onClick={() => setHideRated((prev) => !prev)}
                className={`btn-tactile px-3.5 py-2 text-xs font-semibold transition-all border cursor-pointer ${
                  hideRated
                    ? 'palette-tag-secondary font-bold'
                    : 'btn-tactile-secondary'
                }`}
                title={hideRated ? 'Click to show already rated movies' : 'Click to hide already rated movies'}
              >
                {hideRated ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-[var(--accent-secondary)]" />
                    <span>Hide Rated</span>
                    <span className="px-1.5 py-0.2 rounded bg-black/20 text-[10px] font-mono font-bold">
                      ON
                    </span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5 text-slate-400" />
                    <span>Show Rated</span>
                    <span className="px-1.5 py-0.2 rounded bg-white/10 text-slate-400 text-[10px] font-mono font-bold">
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
              className="text-[var(--accent-primary)] hover:text-[var(--accent-hover)] text-xs font-semibold underline cursor-pointer"
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
        <div className="text-center py-16 space-y-4 glass-panel rounded-3xl border border-[var(--border-subtle)] p-8">
          <div className="w-12 h-12 rounded-2xl palette-tag-secondary flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 text-[var(--accent-secondary)]" />
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
              className="btn-tactile btn-tactile-primary px-5 py-2.5 text-xs font-bold shadow-lg"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle Fresh Batch</span>
            </button>
            {hideRated && ratedCount > 0 && (
              <button
                onClick={() => setHideRated(false)}
                className="btn-tactile btn-tactile-secondary px-5 py-2.5 text-xs font-semibold"
              >
                <Eye className="w-4 h-4" />
                <span>Show Rated Films ({ratedCount})</span>
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
                    ? 'animate-pulse-glow bg-[var(--bg-surface-elevated)]'
                    : 'border-[var(--border-subtle)]'
                }`}
              >
                {/* Active Pending Grace Indicator Strip */}
                {isPendingRemoval && (
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-[var(--accent-secondary)] via-[var(--accent-primary)] to-[var(--accent-hover)] animate-shimmer z-30 shadow-md" />
                )}

                {/* Poster Box */}
                <div className="relative aspect-[2/3] w-full bg-[var(--bg-canvas)] overflow-hidden">
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
                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-surface)] via-transparent to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

                  {/* Top Left: Score Badge & User Rating Indicator Badge */}
                  <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
                    {movie.vote_average > 0 && (
                      <div className="px-2 py-0.5 rounded-md bg-[var(--bg-surface)]/90 backdrop-blur-md text-[11px] font-bold text-amber-400 border border-[var(--border-subtle)] shadow-md">
                        ★ {movie.vote_average.toFixed(1)}
                      </div>
                    )}

                    {userRating && (
                      <div
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold shadow-lg border transition-all ${
                          isPendingRemoval
                            ? 'bg-[var(--accent-secondary)] text-slate-950 font-black border-[var(--accent-secondary)] flex items-center gap-1'
                            : 'bg-[var(--accent-primary)] text-white border-[var(--border-focus)]'
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
                          ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-hover)] border-[var(--border-focus)] shadow-md'
                          : 'bg-[var(--bg-surface)]/80 text-slate-400 border-[var(--border-subtle)] hover:text-white opacity-90 sm:opacity-0 sm:group-hover:opacity-100'
                      }`}
                      title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                    >
                      {inWatchlist ? <BookmarkCheck className="w-3.5 h-3.5 text-[var(--accent-hover)]" /> : <Bookmark className="w-3.5 h-3.5" />}
                    </button>

                    <ShareButton
                      movie={movie}
                      variant="icon"
                      iconSize="w-3.5 h-3.5"
                      className="p-1.5 rounded-md opacity-90 sm:opacity-0 sm:group-hover:opacity-100 bg-[var(--bg-surface)]/80 border-[var(--border-subtle)]"
                    />
                  </div>
                </div>

                {/* Content Box - Dynamically inherits active palette surface */}
                <div className="p-3 flex flex-col flex-grow justify-between gap-2.5 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)]">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-[var(--accent-secondary)] transition-colors">
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
                  <div className="pt-1 border-t border-[var(--border-subtle)] space-y-1">
                    {isPendingRemoval && (
                      <div className="flex items-center justify-between text-[11px] text-white bg-[var(--bg-surface-elevated)] px-2.5 py-1.5 rounded-lg border border-[var(--border-focus)] shadow-lg shadow-[var(--accent-glow)]">
                        <span className="font-bold flex items-center gap-1.5 text-[var(--accent-secondary)]">
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
            className="btn-tactile btn-tactile-secondary px-6 py-3 text-xs font-semibold shadow-lg active:scale-95 disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4 text-[var(--accent-primary)]" />}
            <span>{isLoading ? 'Loading More Films...' : 'Explore More Iconic Films'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
