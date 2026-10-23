import { credentialStore } from './credentialStore';

export class MissingTmdbCredentialError extends Error {
  constructor() {
    super(
      'TMDB credential required. Please configure your TMDB API Read Access Token or API Key in Settings.'
    );
    this.name = 'MissingTmdbCredentialError';
  }
}

// Bounded LRU Map to prevent unbounded memory growth during long browsing sessions
export class BoundedLRUMap<K, V> {
  private max: number;
  private map: Map<K, V>;

  constructor(max = 250) {
    this.max = max;
    this.map = new Map();
  }

  get(key: K): V | undefined {
    const item = this.map.get(key);
    if (item !== undefined) {
      this.map.delete(key);
      this.map.set(key, item);
    }
    return item;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.max) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export const BASE_URL = 'https://api.themoviedb.org/3';

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

const cache = new BoundedLRUMap<string, any>(250);

export function clearTmdbCache(): void {
  cache.clear();
}

// Helper to compose multiple abort signals safely
function composeSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

export async function fetchFromTMDB<T>(
  endpoint: string,
  params: Record<string, string | number> = {},
  signal?: AbortSignal
): Promise<T> {
  const creds = credentialStore.getCredentials();
  if (!creds.tmdbValue) {
    throw new MissingTmdbCredentialError();
  }

  const queryObj: Record<string, string> = {
    language: 'en-US',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  };

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (creds.tmdbType === 'read_access_token') {
    headers['Authorization'] = `Bearer ${creds.tmdbValue}`;
  } else {
    // API key parameter (v3 query auth exception)
    queryObj['api_key'] = creds.tmdbValue;
  }

  const query = new URLSearchParams(queryObj);
  const url = `${BASE_URL}${endpoint}?${query.toString()}`;

  // Cache key excludes credentials
  const cleanCacheKey = `${endpoint}?${new URLSearchParams({
    language: 'en-US',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  }).toString()}`;

  if (cache.has(cleanCacheKey)) {
    return cache.get(cleanCacheKey) as T;
  }

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new Error('TMDB request timed out after 15s')), 15000);
  const combinedSignal = composeSignals([signal, timeoutController.signal]);

  try {
    const response = await fetch(url, { headers, signal: combinedSignal });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Invalid TMDB credential. Please verify your token/key in Settings.');
      }
      if (response.status === 429) {
        throw new Error('TMDB rate limit reached. Please wait a moment before retrying.');
      }
      throw new Error(`TMDB API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    cache.set(cleanCacheKey, data);
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
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
