import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Movie, UserRating, HiddenFilm, Recommendation, AISettings, TasteStats } from '../types';
import { aiManager } from '../services/ai/aiManager';
import { getMovieDetails, hydrateBatchWithDiscoveries } from '../services/tmdb';
import { matchesPreferredEras, sortAndRankRecommendations, coerceScore } from './recommendationUtils';
import { getCandidateRecommendationPool } from '../services/recommendation/candidateSources';
import { recsSettingsFingerprint } from '../services/recommendation/settingsFingerprint';
import { credentialStore } from '../services/credentialStore';
import { credentialCoordinator } from '../services/credentialCoordinator';
import {
  readRecommendationCache,
  writeRecommendationCache,
  patchRecommendationCache,
  getFingerprintAndRatedCountFallbacks,
} from './recommendationCache';
import {
  STORAGE_KEYS,
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
  validateRatings,
  validateWatchlist,
  validateWatchlistMovies,
  getStorageStatus,
  subscribeStorageStatus,
  hasUnsavedStorageChanges,
  validateHiddenFilms,
  capHiddenFilms,
} from '../services/storage';
import { OPENROUTER_DEFAULT_MODEL, sanitizeOpenRouterModel } from '../services/ai/openRouterProvider';

const DEFAULT_SETTINGS: AISettings = {
  activeProvider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-3.8-flash',
  openRouterApiKey: '',
  openRouterModel: OPENROUTER_DEFAULT_MODEL,
  serendipityLevel: 40,
  selectedVibes: [],
  preferredEras: [],
};

interface MovieStoreContextType {
  ratings: Record<number, UserRating>;
  watchlist: number[];
  hiddenFilms: HiddenFilm[];
  hideFilm: (movieId: number, reason: HiddenFilm['reason'], title?: string) => void;
  restoreFilm: (movieId: number) => void;
  watchlistMovies: Record<number, Movie>;
  aiSettings: AISettings;
  recommendations: Recommendation[];
  cachedRecsTimestamp: number | null;
  recsSettingsStale: boolean;
  lastRunFingerprint: string | null;
  lastRunRatedCount: number | null;
  isGeneratingRecs: boolean;
  lastProviderUsed: string;
  recommendationError: string | null;
  aiTasteAnalysis: string | null;
  activeTab: 'rankings' | 'calibration' | 'search' | 'library' | 'watchlist';
  setActiveTab: (tab: 'rankings' | 'calibration' | 'search' | 'library' | 'watchlist') => void;
  selectedMovieForModal: Movie | null;
  setSelectedMovieForModal: (movie: Movie | null) => void;
  
  // Actions
  setRating: (movie: Movie, rating: number) => Promise<void>;
  removeRating: (movieId: number) => void;
  toggleWatchlist: (movieOrId: Movie | number) => void;
  clearWatchlist: () => void;
  updateAISettings: (settings: Partial<AISettings>) => void;
  generateRankings: () => Promise<void>;
  cancelGeneration: () => void;
  importRatingsList: (newRatings: UserRating[]) => void;
  replaceRatingsList: (newRatings: UserRating[]) => void;
  clearAllData: () => void;
  dismissRecommendation: (movieId: number) => void;
  tasteStats: TasteStats;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  clearToast: () => void;
  storageWarning: string | null;
}

const MovieStoreContext = createContext<MovieStoreContextType | null>(null);

/**
 * Invalidate a specific legacy rating so it can never resurrect after an explicit removal.
 */
const removeLegacyRatingRecord = (movieId: number): void => {
  const legacyStr = safeGetItem(STORAGE_KEYS.LEGACY_RATINGS);
  if (!legacyStr) return;
  try {
    const parsed = JSON.parse(legacyStr);
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, movieId)) {
      delete parsed[movieId];
      if (Object.keys(parsed).length === 0) {
        safeRemoveItem(STORAGE_KEYS.LEGACY_RATINGS);
      } else {
        safeSetItem(STORAGE_KEYS.LEGACY_RATINGS, JSON.stringify(parsed));
      }
    }
  } catch {
    safeRemoveItem(STORAGE_KEYS.LEGACY_RATINGS);
  }
};

/**
 * Invalidate a specific legacy watchlist entry so it can never resurrect after an explicit removal.
 */
const removeLegacyWatchlistRecord = (movieId: number): void => {
  const legacyWatchlistStr = safeGetItem(STORAGE_KEYS.LEGACY_WATCHLIST);
  if (legacyWatchlistStr) {
    try {
      const parsed = JSON.parse(legacyWatchlistStr);
      if (Array.isArray(parsed) && parsed.includes(movieId)) {
        const filtered = parsed.filter((id) => id !== movieId);
        if (filtered.length === 0) {
          safeRemoveItem(STORAGE_KEYS.LEGACY_WATCHLIST);
        } else {
          safeSetItem(STORAGE_KEYS.LEGACY_WATCHLIST, JSON.stringify(filtered));
        }
      }
    } catch {
      safeRemoveItem(STORAGE_KEYS.LEGACY_WATCHLIST);
    }
  }

  const legacyMoviesStr = safeGetItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
  if (legacyMoviesStr) {
    try {
      const parsed = JSON.parse(legacyMoviesStr);
      if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, movieId)) {
        delete parsed[movieId];
        if (Object.keys(parsed).length === 0) {
          safeRemoveItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
        } else {
          safeSetItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES, JSON.stringify(parsed));
        }
      }
    } catch {
      safeRemoveItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
    }
  }
};

export const MovieStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. User Ratings State
  const [ratings, setRatings] = useState<Record<number, UserRating>>(() => {
    try {
      const saved = safeGetItem(STORAGE_KEYS.RATINGS);
      const parsed = saved ? validateRatings(JSON.parse(saved)) : {};
      const migrationDone = safeGetItem(STORAGE_KEYS.STORAGE_META) === 'migrated_from_v1';
      if (!migrationDone) {
        const legacy = safeGetItem(STORAGE_KEYS.LEGACY_RATINGS);
        if (legacy) {
          try {
            const legacyParsed = validateRatings(JSON.parse(legacy));
            if (Object.keys(legacyParsed).length > 0) {
              // Reconcile: existing v2 takes precedence, missing legacy records are restored
              return { ...legacyParsed, ...parsed };
            }
          } catch {
            // ignore
          }
        }
      }
      return parsed;
    } catch {
      return {};
    }
  });

  // 2. Watchlist State
  const [watchlist, setWatchlist] = useState<number[]>(() => {
    try {
      const saved = safeGetItem(STORAGE_KEYS.WATCHLIST);
      const parsed = saved ? validateWatchlist(JSON.parse(saved)) : [];
      const migrationDone = safeGetItem(STORAGE_KEYS.STORAGE_META) === 'migrated_from_v1';
      if (!migrationDone) {
        const legacy = safeGetItem(STORAGE_KEYS.LEGACY_WATCHLIST);
        if (legacy) {
          try {
            const legacyParsed = validateWatchlist(JSON.parse(legacy));
            if (legacyParsed.length > 0) {
              const seen = new Set(parsed);
              const missing = legacyParsed.filter((id) => !seen.has(id));
              return [...parsed, ...missing];
            }
          } catch {
            // ignore
          }
        }
      }
      return parsed;
    } catch {
      return [];
    }
  });

  const [watchlistMovies, setWatchlistMovies] = useState<Record<number, Movie>>(() => {
    try {
      const saved = safeGetItem(STORAGE_KEYS.WATCHLIST_MOVIES);
      const parsed = saved ? validateWatchlistMovies(JSON.parse(saved)) : {};
      const migrationDone = safeGetItem(STORAGE_KEYS.STORAGE_META) === 'migrated_from_v1';
      if (!migrationDone) {
        const legacy = safeGetItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
        if (legacy) {
          try {
            const legacyParsed = validateWatchlistMovies(JSON.parse(legacy));
            if (Object.keys(legacyParsed).length > 0) {
              return { ...legacyParsed, ...parsed };
            }
          } catch {
            // ignore
          }
        }
      }
      return parsed;
    } catch {
      return {};
    }
  });

  const [hiddenFilms, setHiddenFilms] = useState<HiddenFilm[]>(() => {
    try {
      const saved = safeGetItem(STORAGE_KEYS.HIDDEN_FILMS);
      return saved ? validateHiddenFilms(JSON.parse(saved)) : [];
    } catch {
      return [];
    }
  });

  // 3. AI Settings State (sanitized without keys)
  const [aiSettings, setAiSettings] = useState<AISettings>(() => {
    try {
      const saved = safeGetItem(STORAGE_KEYS.SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_SETTINGS,
          activeProvider: parsed.activeProvider || 'gemini',
          geminiModel: parsed.geminiModel || 'gemini-3.8-flash',
          openRouterModel: sanitizeOpenRouterModel(parsed.openRouterModel),
          serendipityLevel: typeof parsed.serendipityLevel === 'number' ? parsed.serendipityLevel : 40,
          selectedVibes: Array.isArray(parsed.selectedVibes) ? parsed.selectedVibes : [],
          preferredEras: Array.isArray(parsed.preferredEras) ? parsed.preferredEras : [],
        };
      }
      return DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // UI State
  const [activeTab, setActiveTab] = useState<'rankings' | 'calibration' | 'search' | 'library' | 'watchlist'>('calibration');
  const [selectedMovieForModal, setSelectedMovieForModal] = useState<Movie | null>(null);
  
  // Recommendations state (hydrated from cache if present for instant/offline display)
  const [initialCachedRecs] = useState(() => readRecommendationCache());

  const [recommendations, setRecommendations] = useState<Recommendation[]>(() => {
    if (!initialCachedRecs) return [];
    const hiddenIds = new Set(hiddenFilms.map((h) => h.movieId));
    return initialCachedRecs.recommendations
      .filter((r: Recommendation) => !hiddenIds.has(r?.movie?.id))
      .map((r: Recommendation, idx: number) => ({ ...r, rank: idx + 1 }));
  });

  const [cachedRecsTimestamp, setCachedRecsTimestamp] = useState<number | null>(() => {
    return initialCachedRecs ? initialCachedRecs.generatedAt : null;
  });

  const [lastRunFingerprint, setLastRunFingerprint] = useState<string | null>(() => {
    return initialCachedRecs?.settingsFingerprint ?? null;
  });

  const [lastRunRatedCount, setLastRunRatedCount] = useState<number | null>(() => {
    return initialCachedRecs?.ratedCount ?? null;
  });

  const recsSettingsStale = useMemo(() => {
    if (recommendations.length === 0) return false;
    if (!lastRunFingerprint) return false;
    const currentFingerprint = recsSettingsFingerprint(aiSettings);
    return currentFingerprint !== lastRunFingerprint;
  }, [recommendations.length, lastRunFingerprint, aiSettings]);

  const [lastProviderUsed, setLastProviderUsed] = useState<string>(() => {
    return initialCachedRecs ? initialCachedRecs.usedProvider : '';
  });

  const [aiTasteAnalysis, setAiTasteAnalysis] = useState<string | null>(() => {
    return initialCachedRecs?.tasteAnalysis ?? null;
  });

  const [isGeneratingRecs, setIsGeneratingRecs] = useState<boolean>(false);
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [storageStatus, setStorageStatus] = useState(() => getStorageStatus());

  // References for request racing and cancellation
  const activeGenerationIdRef = useRef<number>(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const ratingVersionsRef = useRef<Map<number, number>>(new Map());
  const failedWatchlistIdsRef = useRef<Set<number>>(new Set());
  const storeEpochRef = useRef<number>(0);
  const hiddenFilmsRef = useRef<HiddenFilm[]>(hiddenFilms);
  const recommendationsRef = useRef<Recommendation[]>(recommendations);
  const watchlistRef = useRef<number[]>(watchlist);

  useEffect(() => {
    recommendationsRef.current = recommendations;
  }, [recommendations]);

  useEffect(() => {
    watchlistRef.current = watchlist;
  }, [watchlist]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const clearToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  const cancelGeneration = useCallback(() => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    setIsGeneratingRecs(false);
  }, []);

  // Listen to storage status updates to detect quota limits
  useEffect(() => {
    const unsubscribe = subscribeStorageStatus((status) => {
      setStorageStatus(status);
    });
    return unsubscribe;
  }, []);

  // Listen to credential store updates for generation cancellation and watchlist hydration
  const [credentialVersion, setCredentialVersion] = useState<number>(() => credentialStore.getVersion?.() ?? 0);
  useEffect(() => {
    const unsubscribe = credentialStore.subscribe(() => {
      cancelGeneration();
      setCredentialVersion(credentialStore.getVersion?.() ?? 0);
    });
    return unsubscribe;
  }, [cancelGeneration]);

  const storageWarning = useMemo(() => {
    if (storageStatus.quotaExceeded) {
      return 'Storage quota exceeded. Changes are kept in temporary memory. Please export your ratings to prevent data loss.';
    }
    if (hasUnsavedStorageChanges()) {
      return 'Some data could not be saved to local storage and is kept in temporary memory.';
    }
    return null;
  }, [storageStatus]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Persistence Effects (safe against QuotaExceededError; storage warning banner shown reactively via storageStatus)
  useEffect(() => {
    safeSetItem(STORAGE_KEYS.RATINGS, JSON.stringify(ratings));
  }, [ratings]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.WATCHLIST, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    hiddenFilmsRef.current = hiddenFilms;
    safeSetItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(hiddenFilms));
  }, [hiddenFilms]);

  useEffect(() => {
    safeSetItem(STORAGE_KEYS.WATCHLIST_MOVIES, JSON.stringify(watchlistMovies));
  }, [watchlistMovies]);

  useEffect(() => {
    // Sanitize settings before saving (never persist API keys)
    const sanitizedToSave = {
      activeProvider: aiSettings.activeProvider,
      geminiModel: aiSettings.geminiModel,
      openRouterModel: aiSettings.openRouterModel,
      serendipityLevel: aiSettings.serendipityLevel,
      selectedVibes: aiSettings.selectedVibes,
      preferredEras: aiSettings.preferredEras,
    };
    safeSetItem(STORAGE_KEYS.SETTINGS, JSON.stringify(sanitizedToSave));
  }, [aiSettings]);

  // Automatically fetch missing movie details for watchlist items if not cached
  useEffect(() => {
    const missingIds = watchlist.filter(
      (id) => !watchlistMovies[id] && !failedWatchlistIdsRef.current.has(id)
    );
    if (missingIds.length === 0) return;
    if (!credentialStore.hasTmdb()) return; // Don't hammer TMDB without credentials

    let isMounted = true;
    Promise.all(
      missingIds.map(async (id) => {
        try {
          const rated = ratings[id];
          if (rated) {
            return {
              id: rated.movieId,
              title: rated.title,
              overview: '',
              poster_path: rated.posterPath,
              backdrop_path: null,
              release_date: rated.year ? `${rated.year}-01-01` : '',
              vote_average: rated.rating,
              vote_count: 0,
              director: rated.director,
              genres: (rated.genres || []).map((name, idx) => ({ id: idx, name })),
            } as Movie;
          }
          return await getMovieDetails(id);
        } catch {
          failedWatchlistIdsRef.current.add(id);
          return null;
        }
      })
    ).then((fetched) => {
      if (!isMounted) return;
      const valid = fetched.filter((m): m is Movie => m !== null);
      if (valid.length > 0) {
        setWatchlistMovies((prev) => {
          const next = { ...prev };
          valid.forEach((m) => {
            next[m.id] = m;
          });
          return next;
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [watchlist, watchlistMovies, ratings, credentialVersion]);

  // Set or update rating with race condition guard
  const setRating = useCallback(async (movie: Movie, rating: number) => {
    cancelGeneration();
    const currentEpoch = storeEpochRef.current;
    const currentVersion = (ratingVersionsRef.current.get(movie.id) || 0) + 1;
    ratingVersionsRef.current.set(movie.id, currentVersion);

    // If rating is 0 or negative, remove rating
    if (rating <= 0) {
      setRatings((prev) => {
        const next = { ...prev };
        delete next[movie.id];
        return next;
      });
      removeLegacyRatingRecord(movie.id);
      return;
    }

    const initialRating: UserRating = {
      movieId: movie.id,
      title: movie.title,
      rating,
      posterPath: movie.poster_path,
      year: movie.release_date ? movie.release_date.slice(0, 4) : undefined,
      genres: (movie.genres || []).map((g) => g.name),
      director: movie.director,
      keywords: movie.keywords,
      ratedAt: Date.now(),
    };

    // Save rating immediately
    setRatings((prev) => ({
      ...prev,
      [movie.id]: initialRating,
    }));

    // Asynchronously enrich director/keywords if missing and TMDB is configured
    if (!movie.director && movie.id && credentialStore.hasTmdb()) {
      try {
        const details = await getMovieDetails(movie.id);
        // Ensure this enrichment still belongs to the latest version of this movie rating
        if (details && ratingVersionsRef.current.get(movie.id) === currentVersion && storeEpochRef.current === currentEpoch) {
          setRatings((prev) => {
            if (!prev[movie.id]) return prev; // If deleted in the meantime, discard!
            return {
              ...prev,
              [movie.id]: {
                ...prev[movie.id],
                director: details.director,
                keywords: details.keywords,
              },
            };
          });
        }
      } catch {
        // Non-fatal
      }
    }
  }, [cancelGeneration]);

  const dismissRecommendation = useCallback(
    (movieId: number) => {
      const next = recommendationsRef.current
        .filter((r) => r.movie.id !== movieId)
        .map((r, idx) => ({ ...r, rank: idx + 1 }));

      recommendationsRef.current = next;
      setRecommendations(next);

      const cached = readRecommendationCache();
      if (cached) {
        patchRecommendationCache({
          recommendations: next,
          ...getFingerprintAndRatedCountFallbacks(cached, lastRunFingerprint, lastRunRatedCount),
        });
      } else {
        writeRecommendationCache({
          recommendations: next,
          generatedAt: cachedRecsTimestamp ?? Date.now(),
          usedProvider: lastProviderUsed,
          tasteAnalysis: aiTasteAnalysis,
          ...getFingerprintAndRatedCountFallbacks({}, lastRunFingerprint, lastRunRatedCount),
        });
      }
    },
    [cachedRecsTimestamp, lastProviderUsed, aiTasteAnalysis, lastRunFingerprint, lastRunRatedCount]
  );

  const hideFilm = useCallback(
    (movieId: number, reason: HiddenFilm['reason'], title?: string) => {
      const hiddenAt = Date.now();
      const entry: HiddenFilm =
        title !== undefined
          ? { movieId, reason, hiddenAt, title }
          : { movieId, reason, hiddenAt };

      const applyHide = (list: HiddenFilm[]): HiddenFilm[] => {
        const filtered = list.some((h) => h.movieId === movieId)
          ? list.filter((h) => h.movieId !== movieId)
          : list;
        return capHiddenFilms([...filtered, entry]);
      };

      const nextHidden = applyHide(hiddenFilmsRef.current);
      hiddenFilmsRef.current = nextHidden;
      safeSetItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(nextHidden));
      setHiddenFilms(nextHidden);

      if (recommendationsRef.current.some((r) => r.movie.id === movieId)) {
        const next = recommendationsRef.current
          .filter((r) => r.movie.id !== movieId)
          .map((r, idx) => ({ ...r, rank: idx + 1 }));
        recommendationsRef.current = next;
        setRecommendations(next);

        const cached = readRecommendationCache();
        if (cached) {
          patchRecommendationCache({
            recommendations: next,
            ...getFingerprintAndRatedCountFallbacks(cached, lastRunFingerprint, lastRunRatedCount),
          });
        } else {
          writeRecommendationCache({
            recommendations: next,
            generatedAt: cachedRecsTimestamp ?? Date.now(),
            usedProvider: lastProviderUsed,
            tasteAnalysis: aiTasteAnalysis,
            ...getFingerprintAndRatedCountFallbacks({}, lastRunFingerprint, lastRunRatedCount),
          });
        }
      } else {
        const cached = readRecommendationCache();
        if (cached && cached.recommendations.some((r) => r?.movie?.id === movieId)) {
          const filteredRecs = cached.recommendations
            .filter((r) => r?.movie?.id !== movieId)
            .map((r, idx) => ({ ...r, rank: idx + 1 }));
          patchRecommendationCache({
            recommendations: filteredRecs,
            ...getFingerprintAndRatedCountFallbacks(cached, lastRunFingerprint, lastRunRatedCount),
          });
        }
      }
    },
    [cachedRecsTimestamp, lastProviderUsed, aiTasteAnalysis, lastRunFingerprint, lastRunRatedCount]
  );

  const restoreFilm = useCallback((movieId: number) => {
    const nextHidden = hiddenFilmsRef.current.filter((h) => h.movieId !== movieId);
    hiddenFilmsRef.current = nextHidden;
    safeSetItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(nextHidden));
    setHiddenFilms(nextHidden);
  }, []);

  const removeRating = useCallback((movieId: number) => {
    cancelGeneration();
    // Increment version instead of deleting — prevents stale enrichment from a prior
    // rating of this movie from matching if the movie is re-rated
    const prev = ratingVersionsRef.current.get(movieId) || 0;
    ratingVersionsRef.current.set(movieId, prev + 1);
    setRatings((prev) => {
      const next = { ...prev };
      delete next[movieId];
      return next;
    });
    // Invalidate legacy record so it cannot resurrect
    removeLegacyRatingRecord(movieId);
  }, [cancelGeneration]);

  const toggleWatchlist = useCallback((movieOrId: Movie | number) => {
    const movieId = typeof movieOrId === 'number' ? movieOrId : movieOrId.id;
    const movieObj = typeof movieOrId === 'object' ? movieOrId : null;

    const removing = watchlistRef.current.includes(movieId);
    if (removing) {
      removeLegacyWatchlistRecord(movieId);
      const next = watchlistRef.current.filter((id) => id !== movieId);
      watchlistRef.current = next;
      setWatchlist(next);
    } else {
      const next = [movieId, ...watchlistRef.current];
      watchlistRef.current = next;
      setWatchlist(next);
    }

    setWatchlistMovies((prev) => {
      const next = { ...prev };
      if (next[movieId]) {
        delete next[movieId];
      } else if (movieObj) {
        next[movieId] = movieObj;
      }
      return next;
    });
  }, []);

  const clearWatchlist = useCallback(() => {
    failedWatchlistIdsRef.current.clear();
    watchlistRef.current = [];
    setWatchlist([]);
    setWatchlistMovies({});
    const r1 = safeRemoveItem(STORAGE_KEYS.WATCHLIST);
    const r2 = safeRemoveItem(STORAGE_KEYS.WATCHLIST_MOVIES);
    // Explicitly clear legacy records so recovery never resurrects cleared watchlist
    const r3 = safeRemoveItem(STORAGE_KEYS.LEGACY_WATCHLIST);
    const r4 = safeRemoveItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
    if (!r1 || !r2 || !r3 || !r4 || hasUnsavedStorageChanges()) {
      showToast('Watchlist cleared in memory, but storage could not be updated.');
    }
  }, [showToast]);

  const updateAISettings = useCallback((newPartial: Partial<AISettings>) => {
    cancelGeneration();
    setAiSettings((prev) => ({ ...prev, ...newPartial }));
  }, [cancelGeneration]);

  const importRatingsList = useCallback((newRatings: UserRating[]) => {
    cancelGeneration();
    newRatings.forEach((r) => {
      const currentVersion = (ratingVersionsRef.current.get(r.movieId) || 0) + 1;
      ratingVersionsRef.current.set(r.movieId, currentVersion);
    });
    setRatings((prev) => {
      const next = { ...prev };
      newRatings.forEach((r) => {
        next[r.movieId] = r;
      });
      return next;
    });
  }, [cancelGeneration]);

  const replaceRatingsList = useCallback((newRatings: UserRating[]) => {
    cancelGeneration();
    // Increment epoch so any in-flight enrichment from a previous dataset is invalidated
    storeEpochRef.current++;
    ratingVersionsRef.current.clear();
    const next: Record<number, UserRating> = {};
    const epoch = storeEpochRef.current;
    newRatings.forEach((r) => {
      ratingVersionsRef.current.set(r.movieId, epoch * 1000000 + 1);
      next[r.movieId] = r;
    });
    setRatings(next);

    // Save replaced ratings and remove legacy ratings so stale legacy data cannot merge back
    const ok = safeSetItem(STORAGE_KEYS.RATINGS, JSON.stringify(next));
    const legacyOk = safeRemoveItem(STORAGE_KEYS.LEGACY_RATINGS);
    if (!ok || !legacyOk || hasUnsavedStorageChanges()) {
      showToast('Ratings replaced in memory, but storage could not be updated.');
    }
  }, [cancelGeneration, showToast]);

  const clearAllData = useCallback(() => {
    cancelGeneration();
    // Increment epoch so any in-flight enrichment from before the reset is invalidated
    storeEpochRef.current++;
    ratingVersionsRef.current.clear();
    failedWatchlistIdsRef.current.clear();
    credentialCoordinator.clearAllData();
    setRatings({});
    setWatchlist([]);
    watchlistRef.current = [];
    setWatchlistMovies({});
    setHiddenFilms([]);
    hiddenFilmsRef.current = [];
    setRecommendations([]);
    recommendationsRef.current = [];
    setAiTasteAnalysis(null);
    setCachedRecsTimestamp(null);
    setLastRunFingerprint(null);
    setLastRunRatedCount(null);

    // Explicitly remove v2 keys
    const r1 = safeRemoveItem(STORAGE_KEYS.RATINGS);
    const r2 = safeRemoveItem(STORAGE_KEYS.WATCHLIST);
    const r3 = safeRemoveItem(STORAGE_KEYS.WATCHLIST_MOVIES);
    const r4 = safeRemoveItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
    const rHidden = safeRemoveItem(STORAGE_KEYS.HIDDEN_FILMS);

    // Invalidate and remove all legacy recovery sources so nothing can resurrect
    const r5 = safeRemoveItem(STORAGE_KEYS.LEGACY_RATINGS);
    const r6 = safeRemoveItem(STORAGE_KEYS.LEGACY_WATCHLIST);
    const r7 = safeRemoveItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
    const r8 = safeRemoveItem(STORAGE_KEYS.LEGACY_SETTINGS);

    // Authoritatively mark migration complete so fresh launches never re-migrate
    const r9 = safeSetItem(STORAGE_KEYS.STORAGE_META, 'migrated_from_v1');

    if (!r1 || !r2 || !r3 || !r4 || !rHidden || !r5 || !r6 || !r7 || !r8 || !r9 || hasUnsavedStorageChanges()) {
      showToast('All data cleared in memory, but some storage changes could not be saved.');
    } else {
      showToast('All data cleared.');
    }
  }, [cancelGeneration, showToast]);

  // Compute Taste Profile Stats
  const tasteStats: TasteStats = useMemo(() => {
    const ratingsArray = Object.values(ratings);
    if (ratingsArray.length === 0) {
      return {
        totalRated: 0,
        averageRating: 0,
        topGenres: [],
        topDirectors: [],
        tasteVectorSummary: 'No ratings yet. Rate movies in Taste Calibration to build your taste DNA.',
      };
    }

    const sumRating = ratingsArray.reduce((acc, r) => acc + r.rating, 0);
    const avg = parseFloat((sumRating / ratingsArray.length).toFixed(1));

    // Genre distribution
    const genreMap: Record<string, { count: number; total: number }> = {};
    ratingsArray.forEach((r) => {
      r.genres.forEach((g) => {
        if (!genreMap[g]) genreMap[g] = { count: 0, total: 0 };
        genreMap[g].count += 1;
        genreMap[g].total += r.rating;
      });
    });

    const topGenres = Object.entries(genreMap)
      .map(([genre, data]) => ({
        genre,
        count: data.count,
        avgRating: parseFloat((data.total / data.count).toFixed(1)),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Director distribution
    const directorMap: Record<string, { count: number; total: number }> = {};
    ratingsArray.forEach((r) => {
      if (r.director) {
        if (!directorMap[r.director]) directorMap[r.director] = { count: 0, total: 0 };
        directorMap[r.director].count += 1;
        directorMap[r.director].total += r.rating;
      }
    });

    const topDirectors = Object.entries(directorMap)
      .map(([director, data]) => ({
        director,
        count: data.count,
        avgRating: parseFloat((data.total / data.count).toFixed(1)),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    const favGenreNames = topGenres.slice(0, 3).map((g) => g.genre).join(', ');
    const favDirNames = topDirectors.slice(0, 2).map((d) => d.director).join(', ');

    const tasteVectorSummary = `Affinity for ${favGenreNames || 'diverse cinema'}${
      favDirNames ? ` and works by ${favDirNames}` : ''
    } (Avg Score: ${avg}/10 across ${ratingsArray.length} films).`;

    return {
      totalRated: ratingsArray.length,
      averageRating: avg,
      topGenres,
      topDirectors,
      tasteVectorSummary,
    };
  }, [ratings]);

  // Generate Personalized Rankings using selected AI Provider with full cancellation & race guards
  const generateRankings = useCallback(async () => {
    // Check TMDB credentials before attempting generation
    if (!credentialStore.hasTmdb()) {
      setRecommendationError(
        'TMDB credential is required for candidate discovery. Please enter your TMDB API Read Access Token or API Key in Settings.'
      );
      setActiveTab('calibration');
      showToast('Please configure TMDB credentials in Settings.');
      return;
    }

    // Invalidate/cancel any existing inflight generation
    cancelGeneration();

    const generationId = ++activeGenerationIdRef.current;
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;

    setIsGeneratingRecs(true);
    setRecommendationError(null);

    try {
      const userRatingsList = Object.values(ratings);
      const ratedIds = new Set(userRatingsList.map((r) => r.movieId));
      const hiddenIds = new Set([
        ...hiddenFilms.map((h) => h.movieId),
        ...hiddenFilmsRef.current.map((h) => h.movieId),
      ]);
      const excludedIds = new Set<number>([...ratedIds, ...hiddenIds]);

      // Seeds: top rated movies
      const topSeeds = [...userRatingsList]
        .filter((r) => r.rating >= 7)
        .sort((a, b) => b.rating - a.rating)
        .map((r) => r.movieId);

      // 1. Fetch candidates from TMDB
      const candidatePool = await getCandidateRecommendationPool(
        {
          seedMovieIds: topSeeds,
          excludeIds: excludedIds,
          preferredEras: aiSettings.preferredEras,
          selectedVibes: aiSettings.selectedVibes,
          userRatings: userRatingsList,
        },
        controller.signal
      );

      if (activeGenerationIdRef.current !== generationId || controller.signal.aborted) {
        return;
      }

      const providerId = aiSettings.activeProvider;
      const creds = credentialStore.getCredentials();
      const apiKey = providerId === 'gemini' ? creds.geminiApiKey : creds.openRouterApiKey;
      const model = providerId === 'gemini' ? aiSettings.geminiModel : aiSettings.openRouterModel;

      // 2. Dispatch to AI Provider (or Local fallback)
      const result = await aiManager.generateRecommendations(
        providerId,
        {
          userRatings: userRatingsList,
          candidatePool,
          serendipityLevel: aiSettings.serendipityLevel,
          selectedVibes: aiSettings.selectedVibes,
          preferredEras: aiSettings.preferredEras,
          apiKey,
          model,
        },
        controller.signal
      );

      if (activeGenerationIdRef.current !== generationId || controller.signal.aborted) {
        return;
      }

      let finalRecommendations: Recommendation[] = [];
      const mappedPoolRecs = (result.recommendations || []).map((rec) => ({
        ...rec,
        score: coerceScore(rec.score),
      }));

      // 3. Hydrate AI unconstrained discoveries if present
      if (result.unconstrainedDiscoveries && result.unconstrainedDiscoveries.length > 0 && credentialStore.hasTmdb()) {
        const paired = await hydrateBatchWithDiscoveries(
          result.unconstrainedDiscoveries,
          controller.signal
        );

        if (activeGenerationIdRef.current !== generationId || controller.signal.aborted) {
          return;
        }

        const latestExcludedIds = new Set<number>([
          ...excludedIds,
          ...hiddenFilmsRef.current.map((h) => h.movieId),
        ]);
        const discoveryRecs: Recommendation[] = [];
        const seenIds = new Set<number>();

        for (const { item: discovery, movie } of paired) {
          if (!latestExcludedIds.has(movie.id) && !seenIds.has(movie.id) && matchesPreferredEras(movie.release_date, aiSettings.preferredEras)) {
            seenIds.add(movie.id);
            discoveryRecs.push({
              movie,
              score: coerceScore(discovery.score),
              rank: 0,
              reason: discovery.reason,
              serendipityType: 'ai_cinephile_discovery',
              highlightTags: discovery.highlightTags,
              isAiCurated: true,
            });
          }
        }

        const poolRecs = mappedPoolRecs.filter(
          (rec) => !seenIds.has(rec.movie.id) && !latestExcludedIds.has(rec.movie.id)
        );

        finalRecommendations = sortAndRankRecommendations([...discoveryRecs, ...poolRecs]);
      } else {
        const latestExcludedIds = new Set<number>([
          ...excludedIds,
          ...hiddenFilmsRef.current.map((h) => h.movieId),
        ]);
        const poolRecs = mappedPoolRecs.filter(
          (rec) => !latestExcludedIds.has(rec.movie.id)
        );
        finalRecommendations = sortAndRankRecommendations(poolRecs);
      }

      if (activeGenerationIdRef.current === generationId && !controller.signal.aborted) {
        const timestamp = Date.now();
        const fingerprint = recsSettingsFingerprint(aiSettings);
        const currentRatedCount = userRatingsList.length;

        recommendationsRef.current = finalRecommendations;
        setRecommendations(finalRecommendations);
        setCachedRecsTimestamp(timestamp);
        setLastProviderUsed(result.usedProvider);
        setLastRunFingerprint(fingerprint);
        setLastRunRatedCount(currentRatedCount);
        if (result.tasteAnalysis) {
          setAiTasteAnalysis(result.tasteAnalysis);
        }
        if (result.error) {
          setRecommendationError(result.error);
        }

        // Persist last successful recommendations
        writeRecommendationCache({
          recommendations: finalRecommendations,
          generatedAt: timestamp,
          usedProvider: result.usedProvider,
          tasteAnalysis: result.tasteAnalysis,
          settingsFingerprint: fingerprint,
          ratedCount: currentRatedCount,
        });
      }
    } catch (err: unknown) {
      if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        return; // Normal cancellation
      }
      if (activeGenerationIdRef.current === generationId) {
        const msg = err instanceof Error ? err.message : 'Failed to generate recommendations';
        setRecommendationError(msg);
      }
    } finally {
      if (activeGenerationIdRef.current === generationId) {
        setIsGeneratingRecs(false);
        activeAbortControllerRef.current = null;
      }
    }
  }, [ratings, hiddenFilms, aiSettings, cancelGeneration, showToast]);

  return (
    <MovieStoreContext.Provider
      value={{
        ratings,
        watchlist,
        hiddenFilms,
        hideFilm,
        restoreFilm,
        watchlistMovies,
        aiSettings,
        recommendations,
        cachedRecsTimestamp,
        recsSettingsStale,
        lastRunFingerprint,
        lastRunRatedCount,
        isGeneratingRecs,
        lastProviderUsed,
        recommendationError,
        aiTasteAnalysis,
        activeTab,
        setActiveTab,
        selectedMovieForModal,
        setSelectedMovieForModal,
        setRating,
        removeRating,
        toggleWatchlist,
        clearWatchlist,
        updateAISettings,
        generateRankings,
        cancelGeneration,
        importRatingsList,
        replaceRatingsList,
        clearAllData,
        dismissRecommendation,
        tasteStats,
        toastMessage,
        showToast,
        clearToast,
        storageWarning,
      }}
    >
      {children}
    </MovieStoreContext.Provider>
  );
};

export const useMovieStore = (): MovieStoreContextType => {
  const context = useContext(MovieStoreContext);
  if (!context) {
    throw new Error('useMovieStore must be used within a MovieStoreProvider');
  }
  return context;
};
