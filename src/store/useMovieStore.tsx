import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Movie, UserRating, Recommendation, AISettings, TasteStats } from '../types';
import { aiManager } from '../services/ai/aiManager';
import { getCandidateRecommendationPool, getMovieDetails, hydrateBatchWithDiscoveries } from '../services/tmdb';

const STORAGE_KEY_RATINGS = 'cinematch_user_ratings_v1';
const STORAGE_KEY_SETTINGS = 'cinematch_ai_settings_v1';
const STORAGE_KEY_WATCHLIST = 'cinematch_watchlist_v1';
const STORAGE_KEY_WATCHLIST_MOVIES = 'cinematch_watchlist_movies_v1';

const DEFAULT_SETTINGS: AISettings = {
  activeProvider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openRouterApiKey: '',
  openRouterModel: 'deepseek/deepseek-r1:free',
  serendipityLevel: 40,
  selectedVibes: [],
  preferredEras: [],
};

interface MovieStoreContextType {
  ratings: Record<number, UserRating>;
  watchlist: number[];
  watchlistMovies: Record<number, Movie>;
  aiSettings: AISettings;
  recommendations: Recommendation[];
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
  importRatingsList: (newRatings: UserRating[]) => void;
  clearAllData: () => void;
  dismissRecommendation: (movieId: number) => void;
  tasteStats: TasteStats;
  toastMessage: string | null;
  showToast: (msg: string) => void;
  clearToast: () => void;
}

const MovieStoreContext = createContext<MovieStoreContextType | null>(null);

export const MovieStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. User Ratings State
  const [ratings, setRatings] = useState<Record<number, UserRating>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_RATINGS);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // 2. Watchlist State
  const [watchlist, setWatchlist] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_WATCHLIST);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [watchlistMovies, setWatchlistMovies] = useState<Record<number, Movie>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_WATCHLIST_MOVIES);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // 3. AI Settings State
  const [aiSettings, setAiSettings] = useState<AISettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  // UI State
  const [activeTab, setActiveTab] = useState<'rankings' | 'calibration' | 'search' | 'library' | 'watchlist'>('calibration');
  const [selectedMovieForModal, setSelectedMovieForModal] = useState<Movie | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isGeneratingRecs, setIsGeneratingRecs] = useState<boolean>(false);
  const [lastProviderUsed, setLastProviderUsed] = useState<string>('');
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [aiTasteAnalysis, setAiTasteAnalysis] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  const clearToast = useCallback(() => {
    setToastMessage(null);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => {
      setToastMessage(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RATINGS, JSON.stringify(ratings));
  }, [ratings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WATCHLIST_MOVIES, JSON.stringify(watchlistMovies));
  }, [watchlistMovies]);

  // Automatically fetch missing movie details for watchlist items if not cached
  useEffect(() => {
    const missingIds = watchlist.filter((id) => !watchlistMovies[id]);
    if (missingIds.length === 0) return;

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
  }, [watchlist, watchlistMovies, ratings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(aiSettings));
  }, [aiSettings]);

  // Set or update rating
  const setRating = useCallback(async (movie: Movie, rating: number) => {
    // If rating is 0 or negative, remove rating
    if (rating <= 0) {
      setRatings((prev) => {
        const next = { ...prev };
        delete next[movie.id];
        return next;
      });
      return;
    }

    // Attempt to enrich movie with director and keywords if not present
    let director = movie.director;
    let keywords = movie.keywords;

    if (!director && movie.id) {
      try {
        const details = await getMovieDetails(movie.id);
        director = details.director;
        keywords = details.keywords;
      } catch (e) {
        console.warn('Failed to enrich movie details', e);
      }
    }

    const newRating: UserRating = {
      movieId: movie.id,
      title: movie.title,
      rating,
      posterPath: movie.poster_path,
      year: movie.release_date ? movie.release_date.slice(0, 4) : undefined,
      genres: (movie.genres || []).map((g) => g.name),
      director,
      keywords,
      ratedAt: Date.now(),
    };

    setRatings((prev) => ({
      ...prev,
      [movie.id]: newRating,
    }));
  }, []);

  const dismissRecommendation = useCallback((movieId: number) => {
    setRecommendations((prev) =>
      prev
        .filter((r) => r.movie.id !== movieId)
        .map((r, idx) => ({ ...r, rank: idx + 1 }))
    );
  }, []);

  const removeRating = useCallback((movieId: number) => {
    setRatings((prev) => {
      const next = { ...prev };
      delete next[movieId];
      return next;
    });
  }, []);

  const toggleWatchlist = useCallback((movieOrId: Movie | number) => {
    const movieId = typeof movieOrId === 'number' ? movieOrId : movieOrId.id;
    const movieObj = typeof movieOrId === 'object' ? movieOrId : null;

    setWatchlist((prev) =>
      prev.includes(movieId) ? prev.filter((id) => id !== movieId) : [movieId, ...prev]
    );

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
    setWatchlist([]);
    setWatchlistMovies({});
    localStorage.removeItem(STORAGE_KEY_WATCHLIST);
    localStorage.removeItem(STORAGE_KEY_WATCHLIST_MOVIES);
  }, []);

  const updateAISettings = useCallback((newPartial: Partial<AISettings>) => {
    setAiSettings((prev) => ({ ...prev, ...newPartial }));
  }, []);

  const importRatingsList = useCallback((newRatings: UserRating[]) => {
    setRatings((prev) => {
      const next = { ...prev };
      newRatings.forEach((r) => {
        next[r.movieId] = r;
      });
      return next;
    });
  }, []);

  const clearAllData = useCallback(() => {
    setRatings({});
    setWatchlist([]);
    setWatchlistMovies({});
    setRecommendations([]);
    setAiTasteAnalysis(null);
    localStorage.removeItem(STORAGE_KEY_RATINGS);
    localStorage.removeItem(STORAGE_KEY_WATCHLIST);
    localStorage.removeItem(STORAGE_KEY_WATCHLIST_MOVIES);
  }, []);

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

  // Generate Personalized Rankings using selected AI Provider
  const generateRankings = useCallback(async () => {
    setIsGeneratingRecs(true);
    setRecommendationError(null);

    try {
      const userRatingsList = Object.values(ratings);
      const ratedIds = new Set(userRatingsList.map((r) => r.movieId));

      // Seeds: take top 4 highest rated movies
      const topSeeds = [...userRatingsList]
        .filter((r) => r.rating >= 7)
        .sort((a, b) => b.rating - a.rating)
        .map((r) => r.movieId);

      // Fetch dynamic pool from TMDB
      const candidatePool = await getCandidateRecommendationPool({
        seedMovieIds: topSeeds,
        excludeIds: ratedIds,
        preferredEras: aiSettings.preferredEras,
        selectedVibes: aiSettings.selectedVibes,
      });

      const providerId = aiSettings.activeProvider;
      const apiKey = providerId === 'gemini' ? aiSettings.geminiApiKey : aiSettings.openRouterApiKey;
      const model = providerId === 'gemini' ? aiSettings.geminiModel : aiSettings.openRouterModel;

      const result = await aiManager.generateRecommendations(providerId, {
        userRatings: userRatingsList,
        candidatePool,
        serendipityLevel: aiSettings.serendipityLevel,
        selectedVibes: aiSettings.selectedVibes,
        preferredEras: aiSettings.preferredEras,
        apiKey,
        model,
      });

      let finalRecommendations: Recommendation[] = [];

      // If AI returned unconstrained discoveries, hydrate them via TMDB
      if (result.unconstrainedDiscoveries && result.unconstrainedDiscoveries.length > 0) {
        const paired = await hydrateBatchWithDiscoveries(result.unconstrainedDiscoveries);

        const discoveryRecs: Recommendation[] = [];
        const seenIds = new Set<number>();

        for (const { item: discovery, movie } of paired) {
          if (!ratedIds.has(movie.id) && !seenIds.has(movie.id)) {
            seenIds.add(movie.id);
            discoveryRecs.push({
              movie,
              score: discovery.score,
              rank: 0,
              reason: discovery.reason,
              serendipityType: 'ai_cinephile_discovery',
              highlightTags: discovery.highlightTags,
              isAiCurated: true,
            });
          }
        }

        // Filter candidate pool recommendations to remove any overlap with discoveries or rated movies
        const poolRecs = (result.recommendations || []).filter(
          (rec) => !seenIds.has(rec.movie.id) && !ratedIds.has(rec.movie.id)
        );

        // Merge both streams and sort by score descending so genuine AI cinephile discoveries appear proudly near the top (#1, #2, #4)
        const merged = [...discoveryRecs, ...poolRecs].sort((a, b) => b.score - a.score);

        // Assign rank numbers 1, 2, 3...
        finalRecommendations = merged.map((rec, idx) => ({
          ...rec,
          rank: idx + 1,
        }));
      } else {
        finalRecommendations = (result.recommendations || [])
          .filter((rec) => !ratedIds.has(rec.movie.id))
          .map((rec, idx) => ({
            ...rec,
            rank: idx + 1,
          }));
      }

      setRecommendations(finalRecommendations);
      setLastProviderUsed(result.usedProvider);
      if (result.tasteAnalysis) {
        setAiTasteAnalysis(result.tasteAnalysis);
      }
      if (result.error) {
        setRecommendationError(result.error);
      }
    } catch (err: any) {
      console.error('Failed to generate rankings:', err);
      setRecommendationError(err.message || 'Failed to generate recommendations');
    } finally {
      setIsGeneratingRecs(false);
    }
  }, [ratings, aiSettings]);

  return (
    <MovieStoreContext.Provider
      value={{
        ratings,
        watchlist,
        watchlistMovies,
        aiSettings,
        recommendations,
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
        importRatingsList,
        clearAllData,
        dismissRecommendation,
        tasteStats,
        toastMessage,
        showToast,
        clearToast,
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
