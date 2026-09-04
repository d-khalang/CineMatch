import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Movie, UserRating, Recommendation, AISettings, TasteStats } from '../types';
import { aiManager } from '../services/ai/aiManager';
import { getCandidateRecommendationPool, getMovieDetails } from '../services/tmdb';

const STORAGE_KEY_RATINGS = 'cinematch_user_ratings_v1';
const STORAGE_KEY_SETTINGS = 'cinematch_ai_settings_v1';
const STORAGE_KEY_WATCHLIST = 'cinematch_watchlist_v1';

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
  aiSettings: AISettings;
  recommendations: Recommendation[];
  isGeneratingRecs: boolean;
  lastProviderUsed: string;
  recommendationError: string | null;
  activeTab: 'rankings' | 'calibration' | 'search' | 'library';
  setActiveTab: (tab: 'rankings' | 'calibration' | 'search' | 'library') => void;
  selectedMovieForModal: Movie | null;
  setSelectedMovieForModal: (movie: Movie | null) => void;
  
  // Actions
  setRating: (movie: Movie, rating: number) => Promise<void>;
  removeRating: (movieId: number) => void;
  toggleWatchlist: (movieId: number) => void;
  updateAISettings: (settings: Partial<AISettings>) => void;
  generateRankings: () => Promise<void>;
  importRatingsList: (newRatings: UserRating[]) => void;
  clearAllData: () => void;
  tasteStats: TasteStats;
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
  const [activeTab, setActiveTab] = useState<'rankings' | 'calibration' | 'search' | 'library'>('calibration');
  const [selectedMovieForModal, setSelectedMovieForModal] = useState<Movie | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isGeneratingRecs, setIsGeneratingRecs] = useState<boolean>(false);
  const [lastProviderUsed, setLastProviderUsed] = useState<string>('');
  const [recommendationError, setRecommendationError] = useState<string | null>(null);

  // Persistence Effects
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_RATINGS, JSON.stringify(ratings));
  }, [ratings]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WATCHLIST, JSON.stringify(watchlist));
  }, [watchlist]);

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

  const removeRating = useCallback((movieId: number) => {
    setRatings((prev) => {
      const next = { ...prev };
      delete next[movieId];
      return next;
    });
  }, []);

  const toggleWatchlist = useCallback((movieId: number) => {
    setWatchlist((prev) =>
      prev.includes(movieId) ? prev.filter((id) => id !== movieId) : [...prev, movieId]
    );
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
    setRecommendations([]);
    localStorage.removeItem(STORAGE_KEY_RATINGS);
    localStorage.removeItem(STORAGE_KEY_WATCHLIST);
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

      setRecommendations(result.recommendations);
      setLastProviderUsed(result.usedProvider);
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
        aiSettings,
        recommendations,
        isGeneratingRecs,
        lastProviderUsed,
        recommendationError,
        activeTab,
        setActiveTab,
        selectedMovieForModal,
        setSelectedMovieForModal,
        setRating,
        removeRating,
        toggleWatchlist,
        updateAISettings,
        generateRankings,
        importRatingsList,
        clearAllData,
        tasteStats,
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
