export interface Movie {
  id: number;
  title: string;
  original_title?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  director?: string;
  cast?: string[];
  keywords?: string[];
  runtime?: number;
  trailer_key?: string;
  imdb_id?: string;
}

export interface UserRating {
  movieId: number;
  title: string;
  rating: number; // 1 to 10
  posterPath: string | null;
  year?: string;
  genres: string[];
  director?: string;
  cast?: string[];
  keywords?: string[];
  ratedAt: number; // timestamp
}

export type SerendipityMode = 'safe' | 'balanced' | 'exploratory' | 'wildcard';

export interface Recommendation {
  movie: Movie;
  score: number; // 0 to 100
  rank: number;
  reason: string;
  serendipityType: 'safe_bet' | 'thematic_gem' | 'director_match' | 'wildcard_discovery';
  highlightTags: string[];
}

export type AIProviderId = 'gemini' | 'openrouter' | 'local';

export interface AISettings {
  activeProvider: AIProviderId;
  geminiApiKey: string;
  geminiModel: string;
  openRouterApiKey: string;
  openRouterModel: string;
  serendipityLevel: number; // 0 (Safe) to 100 (Radical Discovery)
  selectedVibes: string[];
  preferredEras: string[];
}

export interface TasteStats {
  totalRated: number;
  averageRating: number;
  topGenres: { genre: string; count: number; avgRating: number }[];
  topDirectors: { director: string; count: number; avgRating: number }[];
  tasteVectorSummary: string;
}
