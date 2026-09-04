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

// Era date range mapping (e.g., '70s' -> 1970-01-01 to 1979-12-31)
export const ERA_DATE_RANGES: Record<string, { gte: string; lte: string }> = {
  '70s': { gte: '1970-01-01', lte: '1979-12-31' },
  '80s': { gte: '1980-01-01', lte: '1989-12-31' },
  '90s': { gte: '1990-01-01', lte: '1999-12-31' },
  '2000s': { gte: '2000-01-01', lte: '2009-12-31' },
  '2010s': { gte: '2010-01-01', lte: '2019-12-31' },
  '2020s': { gte: '2020-01-01', lte: '2029-12-31' },
};

export function getEraDateRange(era: string): { gte: string; lte: string } | null {
  const normalized = era.trim().toLowerCase();
  if (ERA_DATE_RANGES[normalized]) {
    return ERA_DATE_RANGES[normalized];
  }
  // Match 4-digit era like "1970s" or "2000s"
  const fourDigitMatch = normalized.match(/^(\d{4})s?$/);
  if (fourDigitMatch) {
    const startYear = parseInt(fourDigitMatch[1], 10);
    return {
      gte: `${startYear}-01-01`,
      lte: `${startYear + 9}-12-31`,
    };
  }
  // Match 2-digit era like "60s"
  const twoDigitMatch = normalized.match(/^(\d{2})s?$/);
  if (twoDigitMatch) {
    const twoDigits = parseInt(twoDigitMatch[1], 10);
    const startYear = twoDigits >= 30 ? 1900 + twoDigits : 2000 + twoDigits;
    return {
      gte: `${startYear}-01-01`,
      lte: `${startYear + 9}-12-31`,
    };
  }
  return null;
}

// Vibe mapping to TMDB Genre IDs
export const VIBE_GENRE_MAP: Record<string, number[]> = {
  'mind-bending': [878, 9648, 53],       // Sci-Fi, Mystery, Thriller
  'dark & gritty': [80, 53, 27],         // Crime, Thriller, Horror
  'heartfelt': [18, 10749, 35, 10751],   // Drama, Romance, Comedy, Family
  'atmospheric': [9648, 27, 878, 18],    // Mystery, Horror, Sci-Fi, Drama
  'fast-paced': [28, 12, 53],            // Action, Adventure, Thriller
  'philosophical': [18, 878, 9648],      // Drama, Sci-Fi, Mystery
  'visually stunning': [878, 14, 12, 16],// Sci-Fi, Fantasy, Adventure, Animation
  'plot twists': [9648, 53, 80],         // Mystery, Thriller, Crime
  'slow-burn': [18, 9648, 53],           // Drama, Mystery, Thriller
  'high tension': [53, 28, 80],          // Thriller, Action, Crime
};

// Vibe mapping to TMDB Keyword IDs for additional thematic depth
export const VIBE_KEYWORD_MAP: Record<string, number[]> = {
  'mind-bending': [4379, 310, 9715], // time travel, artificial intelligence, psychological thriller
  'dark & gritty': [10714, 5340],     // serial killer, neo-noir
  'plot twists': [275311, 9715],      // plot twist, psychological thriller
  'atmospheric': [9715, 5340],        // psychological thriller, neo-noir
};

export function getGenreIdsForVibes(vibes: string[]): number[] {
  const genreSet = new Set<number>();
  for (const v of vibes) {
    const key = v.trim().toLowerCase();
    if (VIBE_GENRE_MAP[key]) {
      VIBE_GENRE_MAP[key].forEach((id) => genreSet.add(id));
      continue;
    }
    // Keyword or partial matches
    if (key.includes('mind') || key.includes('scifi') || key.includes('sci-fi')) {
      [878, 9648, 53].forEach((id) => genreSet.add(id));
    } else if (key.includes('dark') || key.includes('grit') || key.includes('crime')) {
      [80, 53, 27].forEach((id) => genreSet.add(id));
    } else if (key.includes('heart') || key.includes('feel') || key.includes('romance')) {
      [18, 10749, 35, 10751].forEach((id) => genreSet.add(id));
    } else if (key.includes('twist') || key.includes('mystery')) {
      [9648, 53, 80].forEach((id) => genreSet.add(id));
    } else if (key.includes('action') || key.includes('fast') || key.includes('tension')) {
      [28, 53, 80].forEach((id) => genreSet.add(id));
    } else if (key.includes('horror') || key.includes('scary')) {
      [27, 53, 9648].forEach((id) => genreSet.add(id));
    } else if (key.includes('comedy') || key.includes('funny')) {
      [35, 10749].forEach((id) => genreSet.add(id));
    }
  }
  return Array.from(genreSet);
}

export interface CandidateRecommendationOptions {
  seedMovieIds?: number[];
  genres?: number[];
  minVoteAverage?: number;
  excludeIds?: Set<number>;
  preferredEras?: string[];
  selectedVibes?: string[];
}

export async function getCandidateRecommendationPool(
  options: CandidateRecommendationOptions = {}
): Promise<Movie[]> {
  const {
    seedMovieIds = [],
    genres = [],
    minVoteAverage,
    excludeIds = new Set(),
    preferredEras = [],
    selectedVibes = [],
  } = options;

  // 1. Fetch recommendations & similar movies for top seeds
  const seedPromises = seedMovieIds.slice(0, 4).map(async (id) => {
    try {
      const recs = await fetchFromTMDB<{ results: any[] }>(`/movie/${id}/recommendations`);
      const similar = await fetchFromTMDB<{ results: any[] }>(`/movie/${id}/similar`);
      return [...(recs.results || []), ...(similar.results || [])];
    } catch {
      return [];
    }
  });

  // 2. Discover trending & top critically rated movies as baseline
  const baseDiscoverPromises = [
    fetchFromTMDB<{ results: any[] }>('/discover/movie', {
      sort_by: 'vote_average.desc',
      'vote_count.gte': 800,
      page: 1,
    })
      .then((d) => d.results || [])
      .catch(() => []),
    fetchFromTMDB<{ results: any[] }>('/discover/movie', {
      sort_by: 'popularity.desc',
      'vote_count.gte': 1500,
      page: 1,
    })
      .then((d) => d.results || [])
      .catch(() => []),
    fetchFromTMDB<{ results: any[] }>('/trending/movie/week')
      .then((d) => d.results || [])
      .catch(() => []),
  ];

  // 3. Resolve Genre IDs and Keyword IDs for selected vibes
  const vibeGenreIds = getGenreIdsForVibes(selectedVibes);
  const targetGenreIds = Array.from(new Set([...vibeGenreIds, ...genres]));
  const withGenresParam = targetGenreIds.length > 0 ? targetGenreIds.join('|') : undefined;

  const keywordIds = Array.from(
    new Set(
      selectedVibes.flatMap((v) => VIBE_KEYWORD_MAP[v.trim().toLowerCase()] || [])
    )
  );

  // 4. Era-targeted Discover queries
  const eraPromises: Promise<any[]>[] = [];
  if (preferredEras.length > 0) {
    preferredEras.slice(0, 4).forEach((era) => {
      const range = getEraDateRange(era);
      if (range) {
        // High-rated in this era
        eraPromises.push(
          fetchFromTMDB<{ results: any[] }>('/discover/movie', {
            'primary_release_date.gte': range.gte,
            'primary_release_date.lte': range.lte,
            sort_by: 'vote_average.desc',
            'vote_count.gte': 300,
            page: 1,
          })
            .then((d) => d.results || [])
            .catch(() => [])
        );

        // Popular in this era
        eraPromises.push(
          fetchFromTMDB<{ results: any[] }>('/discover/movie', {
            'primary_release_date.gte': range.gte,
            'primary_release_date.lte': range.lte,
            sort_by: 'popularity.desc',
            'vote_count.gte': 400,
            page: 1,
          })
            .then((d) => d.results || [])
            .catch(() => [])
        );

        // Targeted Era + Vibe genre query
        if (withGenresParam) {
          eraPromises.push(
            fetchFromTMDB<{ results: any[] }>('/discover/movie', {
              'primary_release_date.gte': range.gte,
              'primary_release_date.lte': range.lte,
              with_genres: withGenresParam,
              sort_by: 'vote_average.desc',
              'vote_count.gte': 150,
              page: 1,
            })
              .then((d) => d.results || [])
              .catch(() => [])
          );
        }
      }
    });
  }

  // 5. Vibe-targeted Discover queries (broad across all eras if vibes are selected)
  const vibePromises: Promise<any[]>[] = [];
  if (withGenresParam) {
    vibePromises.push(
      fetchFromTMDB<{ results: any[] }>('/discover/movie', {
        with_genres: withGenresParam,
        sort_by: 'vote_average.desc',
        'vote_count.gte': 600,
        page: 1,
      })
        .then((d) => d.results || [])
        .catch(() => [])
    );
    vibePromises.push(
      fetchFromTMDB<{ results: any[] }>('/discover/movie', {
        with_genres: withGenresParam,
        sort_by: 'popularity.desc',
        'vote_count.gte': 1000,
        page: 1,
      })
        .then((d) => d.results || [])
        .catch(() => [])
    );
  }

  if (keywordIds.length > 0) {
    vibePromises.push(
      fetchFromTMDB<{ results: any[] }>('/discover/movie', {
        with_keywords: keywordIds.join('|'),
        sort_by: 'vote_average.desc',
        'vote_count.gte': 250,
        page: 1,
      })
        .then((d) => d.results || [])
        .catch(() => [])
    );
  }

  // Execute all queries concurrently
  const [seedResultsArray, baseResultsArray, eraResultsArray, vibeResultsArray] = await Promise.all([
    Promise.all(seedPromises),
    Promise.all(baseDiscoverPromises),
    Promise.all(eraPromises),
    Promise.all(vibePromises),
  ]);

  const formatRawMovie = (m: any): Movie | null => {
    if (!m || !m.id || !m.poster_path || excludeIds.has(m.id)) return null;
    if (minVoteAverage && (m.vote_average || 0) < minVoteAverage) return null;
    return {
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
    };
  };

  const toMovieList = (rawList: any[]): Movie[] => {
    const list: Movie[] = [];
    const seen = new Set<number>();
    for (const item of rawList) {
      const formatted = formatRawMovie(item);
      if (formatted && !seen.has(formatted.id)) {
        seen.add(formatted.id);
        list.push(formatted);
      }
    }
    return list;
  };

  const seedList = toMovieList(seedResultsArray.flat());
  const eraList = toMovieList(eraResultsArray.flat());
  const vibeList = toMovieList(vibeResultsArray.flat());
  const baseList = toMovieList(baseResultsArray.flat());

  // 6. Blend candidates: interleave seed similarity, era-targeted, vibe-targeted, and base discoveries
  const poolMap = new Map<number, Movie>();
  const addMovie = (m: Movie) => {
    if (!poolMap.has(m.id)) {
      poolMap.set(m.id, m);
    }
  };

  const streams = [seedList, eraList, vibeList, baseList].filter((s) => s.length > 0);
  const maxLen = Math.max(0, ...streams.map((s) => s.length));

  for (let i = 0; i < maxLen; i++) {
    for (const stream of streams) {
      if (i < stream.length) {
        addMovie(stream[i]);
      }
    }
  }

  return Array.from(poolMap.values());
}

// In-memory cache for fast repeated hydration
const hydrationCache = new Map<string, Movie | null>();

export async function hydrateMovieByTitleAndYear(
  title: string,
  year?: string
): Promise<Movie | null> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return null;

  const cacheKey = `${cleanTitle.toLowerCase()}::${year ? year.trim() : ''}`;
  if (hydrationCache.has(cacheKey)) {
    return hydrationCache.get(cacheKey) || null;
  }

  try {
    const params: Record<string, string | number> = {
      query: cleanTitle,
      include_adult: 'false',
      page: 1,
    };

    if (year) {
      const yearMatch = year.match(/\b(19\d\d|20\d\d)\b/);
      if (yearMatch) {
        params.primary_release_year = yearMatch[1];
      }
    }

    let data = await fetchFromTMDB<{ results: any[] }>('/search/movie', params);

    // If no results found with primary_release_year, retry search without year constraint
    if ((!data.results || data.results.length === 0) && params.primary_release_year) {
      const fallbackParams: Record<string, string | number> = {
        query: cleanTitle,
        include_adult: 'false',
        page: 1,
      };
      data = await fetchFromTMDB<{ results: any[] }>('/search/movie', fallbackParams);
    }

    if (!data.results || data.results.length === 0) {
      hydrationCache.set(cacheKey, null);
      return null;
    }

    // Pick top result (prefer result that has a poster)
    const topResult = data.results.find((m: any) => m.poster_path) || data.results[0];
    if (!topResult || !topResult.id) {
      hydrationCache.set(cacheKey, null);
      return null;
    }

    // Resolve full movie details (director, trailer, cast, runtime, keywords)
    let fullMovie: Movie;
    try {
      fullMovie = await getMovieDetails(topResult.id);
    } catch {
      fullMovie = {
        id: topResult.id,
        title: topResult.title,
        original_title: topResult.original_title,
        overview: topResult.overview || '',
        poster_path: topResult.poster_path,
        backdrop_path: topResult.backdrop_path,
        release_date: topResult.release_date || '',
        vote_average: topResult.vote_average || 0,
        vote_count: topResult.vote_count || 0,
        genre_ids: topResult.genre_ids || [],
        genres: (topResult.genre_ids || []).map((gid: number) => ({
          id: gid,
          name: GENRE_MAP[gid] || 'Other',
        })),
      };
    }

    hydrationCache.set(cacheKey, fullMovie);
    return fullMovie;
  } catch (err) {
    console.warn(`Hydration failed for "${title}" (${year}):`, err);
    hydrationCache.set(cacheKey, null);
    return null;
  }
}

export async function hydrateBatch(
  movies: { title: string; year?: string }[]
): Promise<Movie[]> {
  if (!movies || movies.length === 0) return [];

  const results = await Promise.allSettled(
    movies.map((m) => hydrateMovieByTitleAndYear(m.title, m.year))
  );

  const hydratedMovies: Movie[] = [];
  const seenIds = new Set<number>();

  for (const res of results) {
    if (res.status === 'fulfilled' && res.value) {
      const movie = res.value;
      if (!seenIds.has(movie.id)) {
        seenIds.add(movie.id);
        hydratedMovies.push(movie);
      }
    }
  }

  return hydratedMovies;
}

export async function hydrateBatchWithDiscoveries<T extends { title: string; year?: string }>(
  items: T[]
): Promise<{ item: T; movie: Movie }[]> {
  if (!items || items.length === 0) return [];

  const results = await Promise.allSettled(
    items.map((it) => hydrateMovieByTitleAndYear(it.title, it.year))
  );

  const paired: { item: T; movie: Movie }[] = [];
  const seenIds = new Set<number>();

  results.forEach((res, idx) => {
    if (res.status === 'fulfilled' && res.value) {
      const movie = res.value;
      if (!seenIds.has(movie.id)) {
        seenIds.add(movie.id);
        paired.push({ item: items[idx], movie });
      }
    }
  });

  return paired;
}

