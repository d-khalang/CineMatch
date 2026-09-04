import { Movie } from '../types';

const TMDB_API_KEY = '6e19ae2b03346d3b682580d657f948ac';
const BASE_URL = 'https://api.themoviedb.org/3';
export const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
export const BACKDROP_BASE_URL = 'https://image.tmdb.org/t/p/w1280';

// In-memory cache for fast repeated views
const cache = new Map<string, any>();

// Genre Dictionary
export const GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

// Curated Taste Calibration Archetypes
export const CALIBRATION_CATEGORIES = [
  { id: 'all', label: 'All Iconic Films', icon: 'Sparkles' },
  { id: 'mind_bending', label: 'Mind-Benders & Sci-Fi', icon: 'Brain' },
  { id: 'masterpieces', label: 'All-Time Masterpieces', icon: 'Award' },
  { id: 'thrillers_crime', label: 'Thrillers & Crime', icon: 'Flame' },
  { id: 'blockbusters', label: 'Epic Blockbusters', icon: 'Clapperboard' },
  { id: 'indie_cult', label: 'Indie & Cult Classics', icon: 'Compass' },
  { id: 'feel_good', label: 'Heartfelt & Comedy', icon: 'Smile' },
];

async function fetchFromTMDB<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const query = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'en-US',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });

  const url = `${BASE_URL}${endpoint}?${query.toString()}`;

  if (cache.has(url)) {
    return cache.get(url) as T;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB API Error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  cache.set(url, data);
  return data;
}

export async function getCalibrationMovies(category = 'all', page = 1): Promise<{ movies: Movie[]; totalPages: number }> {
  let endpoint = '/discover/movie';
  let params: Record<string, string | number> = {
    page,
    include_adult: 'false',
    'vote_count.gte': 1200,
  };

  switch (category) {
    case 'mind_bending':
      params = {
        ...params,
        with_genres: '878,9648,53', // Sci-Fi, Mystery, Thriller
        sort_by: 'vote_average.desc',
        'vote_count.gte': 2000,
      };
      break;
    case 'masterpieces':
      endpoint = '/movie/top_rated';
      params = { ...params, page };
      break;
    case 'thrillers_crime':
      params = {
        ...params,
        with_genres: '53,80',
        sort_by: 'vote_average.desc',
        'vote_count.gte': 2500,
      };
      break;
    case 'blockbusters':
      params = {
        ...params,
        sort_by: 'popularity.desc',
        'vote_count.gte': 6000,
      };
      break;
    case 'indie_cult':
      params = {
        ...params,
        sort_by: 'vote_average.desc',
        'vote_count.gte': 1000,
        'vote_average.gte': 7.8,
      };
      break;
    case 'feel_good':
      params = {
        ...params,
        with_genres: '35,10751,10749',
        sort_by: 'vote_average.desc',
        'vote_count.gte': 1500,
      };
      break;
    default:
      // High-signal diverse iconic films
      params = {
        ...params,
        sort_by: 'popularity.desc',
        'vote_count.gte': 3500,
      };
      break;
  }

  const data = await fetchFromTMDB<{ results: any[]; total_pages: number }>(endpoint, params);
  
  const movies: Movie[] = (data.results || []).map((m: any) => ({
    id: m.id,
    title: m.title,
    original_title: m.original_title,
    overview: m.overview,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    release_date: m.release_date || '',
    vote_average: m.vote_average,
    vote_count: m.vote_count,
    genre_ids: m.genre_ids || [],
    genres: (m.genre_ids || []).map((gid: number) => ({ id: gid, name: GENRE_MAP[gid] || 'Other' })),
  }));

  return { movies, totalPages: data.total_pages || 10 };
}

export async function searchMovies(query: string, page = 1): Promise<{ movies: Movie[]; totalPages: number }> {
  if (!query.trim()) return { movies: [], totalPages: 0 };
  const data = await fetchFromTMDB<{ results: any[]; total_pages: number }>('/search/movie', {
    query,
    page,
    include_adult: 'false',
  });

  const movies: Movie[] = (data.results || []).map((m: any) => ({
    id: m.id,
    title: m.title,
    original_title: m.original_title,
    overview: m.overview,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    release_date: m.release_date || '',
    vote_average: m.vote_average,
    vote_count: m.vote_count,
    genre_ids: m.genre_ids || [],
    genres: (m.genre_ids || []).map((gid: number) => ({ id: gid, name: GENRE_MAP[gid] || 'Other' })),
  }));

  return { movies, totalPages: data.total_pages || 1 };
}

export async function getMovieDetails(movieId: number): Promise<Movie> {
  const data = await fetchFromTMDB<any>(`/movie/${movieId}`, {
    append_to_response: 'credits,videos,keywords,similar',
  });

  const director = data.credits?.crew?.find((c: any) => c.job === 'Director')?.name;
  const cast = (data.credits?.cast || []).slice(0, 5).map((c: any) => c.name);
  const keywords = (data.keywords?.keywords || []).map((k: any) => k.name);
  const trailer = (data.videos?.results || []).find(
    (v: any) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
  )?.key;

  return {
    id: data.id,
    title: data.title,
    original_title: data.original_title,
    overview: data.overview,
    poster_path: data.poster_path,
    backdrop_path: data.backdrop_path,
    release_date: data.release_date || '',
    vote_average: data.vote_average,
    vote_count: data.vote_count,
    genres: data.genres || [],
    runtime: data.runtime,
    director,
    cast,
    keywords,
    trailer_key: trailer,
    imdb_id: data.imdb_id,
  };
}

export async function getCandidateRecommendationPool(options: {
  seedMovieIds?: number[];
  genres?: number[];
  minVoteAverage?: number;
  excludeIds?: Set<number>;
}): Promise<Movie[]> {
  const { seedMovieIds = [], excludeIds = new Set() } = options;
  const poolMap = new Map<number, Movie>();

  // 1. Fetch from recommendations / similar of top seeds
  const seedPromises = seedMovieIds.slice(0, 4).map(async (id) => {
    try {
      const recs = await fetchFromTMDB<{ results: any[] }>(`/movie/${id}/recommendations`);
      const similar = await fetchFromTMDB<{ results: any[] }>(`/movie/${id}/similar`);
      return [...(recs.results || []), ...(similar.results || [])];
    } catch {
      return [];
    }
  });

  // 2. Discover trending & top critically rated
  const discoverPromises = [
    fetchFromTMDB<{ results: any[] }>('/discover/movie', {
      sort_by: 'vote_average.desc',
      'vote_count.gte': 800,
      page: 1,
    }),
    fetchFromTMDB<{ results: any[] }>('/discover/movie', {
      sort_by: 'popularity.desc',
      'vote_count.gte': 1500,
      page: 1,
    }),
    fetchFromTMDB<{ results: any[] }>('/trending/movie/week'),
  ];

  const [seedResultsArray, ...discoverResults] = await Promise.all([
    Promise.all(seedPromises),
    ...discoverPromises,
  ]);

  const allRaw = [
    ...seedResultsArray.flat(),
    ...discoverResults.flatMap((d) => d.results || []),
  ];

  for (const m of allRaw) {
    if (!m || !m.id || !m.poster_path || excludeIds.has(m.id)) continue;
    if (!poolMap.has(m.id)) {
      poolMap.set(m.id, {
        id: m.id,
        title: m.title,
        overview: m.overview || '',
        poster_path: m.poster_path,
        backdrop_path: m.backdrop_path,
        release_date: m.release_date || '',
        vote_average: m.vote_average || 0,
        vote_count: m.vote_count || 0,
        genre_ids: m.genre_ids || [],
        genres: (m.genre_ids || []).map((gid: number) => ({ id: gid, name: GENRE_MAP[gid] || 'Other' })),
      });
    }
  }

  return Array.from(poolMap.values());
}
