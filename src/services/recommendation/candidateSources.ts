import type { Movie, UserRating } from '../../types';
import type { Candidate, CandidateSource } from './types';
import {
  fetchFromTMDB,
  GENRE_MAP,
  getEraDateRange,
  getGenreIdsForVibes,
  VIBE_KEYWORD_MAP,
  MissingTmdbCredentialError,
} from '../tmdbClient';

export interface CandidateOptions {
  seedMovieIds?: number[];
  genres?: number[];
  minVoteAverage?: number;
  excludeIds?: Set<number>;
  preferredEras?: string[];
  selectedVibes?: string[];
  randomFn?: () => number;
  seedCount?: number;
  deadlineMs?: number; // CIN-30 stub
}

/**
 * Concurrency and budget limiter for TMDB API calls.
 * Enforces at most 6 requests in-flight simultaneously,
 * and at most 45 requests total per generation.
 */
export class RequestLimiter {
  private running = 0;
  private totalRequests = 0;
  private waiters: Array<{
    resolve: () => void;
    reject: (err: any) => void;
  }> = [];

  constructor(
    private signal?: AbortSignal,
    private readonly maxConcurrency = 6,
    private readonly maxRequests = 45
  ) {
    if (this.signal) {
      if (this.signal.aborted) {
        this.abortWaiters();
      } else {
        this.signal.addEventListener('abort', () => this.abortWaiters(), { once: true });
      }
    }
  }

  private abortWaiters() {
    const err = this.signal?.reason || new DOMException('The operation was aborted', 'AbortError');
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) {
      w.reject(err);
    }
  }

  async schedule<T>(task: () => Promise<T>): Promise<T | null> {
    if (this.signal?.aborted) {
      throw this.signal.reason || new DOMException('The operation was aborted', 'AbortError');
    }

    if (this.totalRequests >= this.maxRequests) {
      return null;
    }

    if (this.running >= this.maxConcurrency || this.waiters.length > 0) {
      await new Promise<void>((resolve, reject) => {
        this.waiters.push({ resolve, reject });
      });
    } else {
      this.running++;
    }

    if (this.signal?.aborted) {
      this.running--;
      this.release();
      throw this.signal.reason || new DOMException('The operation was aborted', 'AbortError');
    }

    if (this.totalRequests >= this.maxRequests) {
      this.running--;
      this.release();
      return null;
    }

    this.totalRequests++;

    let onAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      if (this.signal?.aborted) {
        reject(this.signal.reason || new DOMException('The operation was aborted', 'AbortError'));
      } else if (this.signal) {
        onAbort = () => {
          reject(this.signal!.reason || new DOMException('The operation was aborted', 'AbortError'));
        };
        this.signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    const taskPromise = task();
    taskPromise.catch(() => {});

    try {
      return await (this.signal ? Promise.race([taskPromise, abortPromise]) : taskPromise);
    } finally {
      if (this.signal && onAbort) {
        this.signal.removeEventListener('abort', onAbort);
      }
      this.running--;
      this.release();
    }
  }

  private release() {
    if (this.waiters.length > 0 && this.running < this.maxConcurrency) {
      if (this.signal?.aborted) {
        this.abortWaiters();
        return;
      }
      this.running++;
      const next = this.waiters.shift()!;
      next.resolve();
    }
  }

  get inFlight(): number {
    return this.running;
  }

  get totalExecuted(): number {
    return this.totalRequests;
  }
}

/**
 * Weighted random selection of seeds without replacement.
 * Weights are calculated using both rating (ratings >= 7) and recency.
 */
export function selectWeightedSeeds(
  ratings: UserRating[],
  count: number,
  randomFn: () => number = Math.random
): UserRating[] {
  if (ratings.length <= count) {
    return [...ratings];
  }

  const ratingsWithTime = ratings.filter(
    (r): r is UserRating & { ratedAt: number } => typeof r.ratedAt === 'number' && Number.isFinite(r.ratedAt)
  );

  let minTime = 0;
  let timeSpan = 0;
  if (ratingsWithTime.length > 0) {
    minTime = ratingsWithTime.reduce(
      (min, r) => (r.ratedAt < min ? r.ratedAt : min),
      ratingsWithTime[0].ratedAt
    );
    const maxTime = ratingsWithTime.reduce(
      (max, r) => (r.ratedAt > max ? r.ratedAt : max),
      ratingsWithTime[0].ratedAt
    );
    timeSpan = maxTime - minTime;
  }

  const pool = ratings.map((r) => {
    // Rating factor: 7 -> 1, 8 -> 2, 9 -> 3, 10 -> 4
    const ratingWeight = Math.max(1, r.rating - 6);
    // Recency factor: 0.5 (oldest) to 1.0 (newest); ignore ratings without ratedAt (recencyWeight = 1)
    const hasRatedAt = typeof r.ratedAt === 'number' && Number.isFinite(r.ratedAt);
    const recencyWeight =
      hasRatedAt && timeSpan > 0 ? 0.5 + 0.5 * ((r.ratedAt - minTime) / timeSpan) : 1;
    return {
      rating: r,
      weight: ratingWeight * recencyWeight,
    };
  });

  const selected: UserRating[] = [];
  const remaining = [...pool];

  while (selected.length < count && remaining.length > 0) {
    const totalWeight = remaining.reduce((sum, item) => sum + item.weight, 0);
    if (totalWeight <= 0) {
      const idx = Math.floor(randomFn() * remaining.length);
      selected.push(remaining.splice(idx, 1)[0].rating);
      continue;
    }

    let threshold = randomFn() * totalWeight;
    let chosenIdx = remaining.length - 1;

    for (let i = 0; i < remaining.length; i++) {
      threshold -= remaining[i].weight;
      if (threshold <= 0) {
        chosenIdx = i;
        break;
      }
    }

    selected.push(remaining.splice(chosenIdx, 1)[0].rating);
  }

  return selected;
}

/**
 * Resolves user's top 3 genres by rating count and average score.
 */
export function getTopUserGenreIds(
  userRatings: UserRating[],
  fallbackGenres?: number[]
): number[] {
  const genreStats = new Map<number, { count: number; sum: number }>();

  // Map genre name to ID (from GENRE_MAP)
  const nameToId = new Map<string, number>();
  for (const [idStr, name] of Object.entries(GENRE_MAP)) {
    nameToId.set(name.toLowerCase(), Number(idStr));
  }

  const likedRatings = userRatings.filter((r) => r.rating >= 7);

  for (const r of likedRatings) {
    for (const g of r.genres || []) {
      const id = typeof g === 'number' ? g : nameToId.get(String(g).trim().toLowerCase());
      if (id !== undefined) {
        const curr = genreStats.get(id) || { count: 0, sum: 0 };
        genreStats.set(id, { count: curr.count + 1, sum: curr.sum + r.rating });
      }
    }
  }

  const sortedGenres = Array.from(genreStats.entries())
    .sort((a, b) => b[1].sum - a[1].sum || b[1].count - a[1].count)
    .map(([id]) => id);

  if (fallbackGenres) {
    for (const fg of fallbackGenres) {
      if (!sortedGenres.includes(fg)) {
        sortedGenres.push(fg);
      }
    }
  }

  return sortedGenres.slice(0, 3);
}

/**
 * Generates recommendation candidates across multi-source queries:
 * 1. Seed graph: /recommendations and /similar (pages 1-2) for weighted loved seeds
 * 2. Hidden gems: /discover/movie in top 3 genres with vote_count 50-800, vote_avg >= 7 (pages 1-2)
 * 3. Acclaimed baseline: top rated, popular, trending, eras, and vibes (page 1)
 *
 * Deduplicates by movie ID, merging source tags, excluding rated and poster-less films.
 */
export async function generateCandidates(
  userRatings: UserRating[] | Record<number, UserRating> = [],
  options: CandidateOptions = {},
  signal?: AbortSignal
): Promise<Candidate[]> {
  if (signal?.aborted) {
    throw signal.reason || new DOMException('The operation was aborted', 'AbortError');
  }

  const ratingsList: UserRating[] = Array.isArray(userRatings)
    ? userRatings
    : Object.values(userRatings || {});

  const limiter = new RequestLimiter(signal, 6, 45);

  const safeFetch = async (
    endpoint: string,
    params: Record<string, string | number> = {}
  ): Promise<any[]> => {
    const res = await limiter.schedule(async () => {
      try {
        const data = await fetchFromTMDB<{ results: any[] }>(endpoint, params, signal);
        return data.results || [];
      } catch (err: any) {
        if (signal?.aborted || err?.name === 'AbortError') {
          throw err;
        }
        if (err instanceof MissingTmdbCredentialError) {
          throw err;
        }
        // Failing individual query must not fail the whole candidate pool
        return [];
      }
    });
    return res || [];
  };

  // 1. Era-targeted queries (guaranteed budget first)
  const preferredEras = options.preferredEras || [];
  const selectedVibes = options.selectedVibes || [];

  const vibeGenreIds = getGenreIdsForVibes(selectedVibes);
  const targetGenreIds = Array.from(new Set([...vibeGenreIds, ...(options.genres || [])]));
  const withGenresParam = targetGenreIds.length > 0 ? targetGenreIds.join('|') : undefined;

  const keywordIds = Array.from(
    new Set(selectedVibes.flatMap((v) => VIBE_KEYWORD_MAP[v.trim().toLowerCase()] || []))
  );

  const eraQueryTasks: Array<() => Promise<any[]>> = [];
  if (preferredEras.length > 0) {
    preferredEras.slice(0, 4).forEach((era) => {
      const range = getEraDateRange(era);
      if (range) {
        eraQueryTasks.push(() =>
          safeFetch('/discover/movie', {
            'primary_release_date.gte': range.gte,
            'primary_release_date.lte': range.lte,
            sort_by: 'vote_average.desc',
            'vote_count.gte': 300,
            page: 1,
          })
        );
        eraQueryTasks.push(() =>
          safeFetch('/discover/movie', {
            'primary_release_date.gte': range.gte,
            'primary_release_date.lte': range.lte,
            sort_by: 'popularity.desc',
            'vote_count.gte': 400,
            page: 1,
          })
        );
        if (withGenresParam) {
          eraQueryTasks.push(() =>
            safeFetch('/discover/movie', {
              'primary_release_date.gte': range.gte,
              'primary_release_date.lte': range.lte,
              with_genres: withGenresParam,
              sort_by: 'vote_average.desc',
              'vote_count.gte': 150,
              page: 1,
            })
          );
        }
      }
    });
  }

  // 2. Vibe-targeted queries (guaranteed budget first)
  const vibeQueryTasks: Array<() => Promise<any[]>> = [];
  if (withGenresParam) {
    vibeQueryTasks.push(() =>
      safeFetch('/discover/movie', {
        with_genres: withGenresParam,
        sort_by: 'vote_average.desc',
        'vote_count.gte': 600,
        page: 1,
      })
    );
    vibeQueryTasks.push(() =>
      safeFetch('/discover/movie', {
        with_genres: withGenresParam,
        sort_by: 'popularity.desc',
        'vote_count.gte': 1000,
        page: 1,
      })
    );
  }

  if (keywordIds.length > 0) {
    vibeQueryTasks.push(() =>
      safeFetch('/discover/movie', {
        with_keywords: keywordIds.join('|'),
        sort_by: 'vote_average.desc',
        'vote_count.gte': 250,
        page: 1,
      })
    );
  }

  // 3. Hidden Gems: /discover/movie in top 3 user genres (guaranteed budget first)
  const topGenreIds = getTopUserGenreIds(ratingsList, options.genres);
  const hiddenGemQueryTasks: Array<() => Promise<any[]>> = [];
  for (const gid of topGenreIds) {
    hiddenGemQueryTasks.push(() =>
      safeFetch('/discover/movie', {
        with_genres: String(gid),
        'vote_average.gte': 7,
        'vote_count.gte': 50,
        'vote_count.lte': 800,
        sort_by: 'vote_average.desc',
        page: 1,
      })
    );
    hiddenGemQueryTasks.push(() =>
      safeFetch('/discover/movie', {
        with_genres: String(gid),
        'vote_average.gte': 7,
        'vote_count.gte': 50,
        'vote_count.lte': 800,
        sort_by: 'vote_average.desc',
        page: 2,
      })
    );
  }

  // 4. Acclaimed Baseline base queries
  const baseQueryTasks: Array<() => Promise<any[]>> = [
    () =>
      safeFetch('/discover/movie', {
        sort_by: 'vote_average.desc',
        'vote_count.gte': 800,
        page: 1,
      }),
    () =>
      safeFetch('/discover/movie', {
        sort_by: 'popularity.desc',
        'vote_count.gte': 1500,
        page: 1,
      }),
    () => safeFetch('/trending/movie/week', {}),
  ];

  // Budget reservation per source:
  // Era, vibe, and hidden gems are guaranteed budget first, followed by the 3 base queries.
  const reserved =
    eraQueryTasks.length +
    vibeQueryTasks.length +
    hiddenGemQueryTasks.length +
    baseQueryTasks.length;

  // 5. Seed Graph: remainder of the 45-request budget
  const eligibleRatings = ratingsList.filter((r) => r.rating >= 7);
  const requestedSeedCount = options.seedCount ?? 8;
  const targetSeedCount = Math.min(eligibleRatings.length, requestedSeedCount);

  let chosenSeedIds: number[] = [];
  if (eligibleRatings.length > 0) {
    const chosenSeeds = selectWeightedSeeds(eligibleRatings, targetSeedCount, options.randomFn);
    chosenSeedIds = chosenSeeds.map((r) => r.movieId);
  } else if (options.seedMovieIds && options.seedMovieIds.length > 0) {
    chosenSeedIds = options.seedMovieIds.slice(0, requestedSeedCount);
  }

  const seedRequests = Math.min(chosenSeedIds.length * 4, Math.max(0, 45 - reserved));

  // Dropping page 2 before dropping seeds
  const seedPage1Tasks: Array<() => Promise<any[]>> = [];
  for (const id of chosenSeedIds) {
    seedPage1Tasks.push(() => safeFetch(`/movie/${id}/recommendations`, { page: 1 }));
    seedPage1Tasks.push(() => safeFetch(`/movie/${id}/similar`, { page: 1 }));
  }

  const seedPage2Tasks: Array<() => Promise<any[]>> = [];
  for (const id of chosenSeedIds) {
    seedPage2Tasks.push(() => safeFetch(`/movie/${id}/recommendations`, { page: 2 }));
    seedPage2Tasks.push(() => safeFetch(`/movie/${id}/similar`, { page: 2 }));
  }

  const allSeedTasks = [...seedPage1Tasks, ...seedPage2Tasks];
  const seedQueryTasks = allSeedTasks.slice(0, seedRequests);

  // Guaranteed budget promises first: era, vibe, hidden-gem, base, then seed queries
  const eraPromises = eraQueryTasks.map((t) => t());
  const vibePromises = vibeQueryTasks.map((t) => t());
  const hiddenGemPromises = hiddenGemQueryTasks.map((t) => t());
  const basePromises = baseQueryTasks.map((t) => t());
  const seedGraphPromises = seedQueryTasks.map((t) => t());

  // Execute all scheduled tasks with concurrency and ceiling limits
  const [seedGraphArrays, hiddenGemArrays, eraArrays, vibeArrays, baseArrays] = await Promise.all([
    Promise.all(seedGraphPromises),
    Promise.all(hiddenGemPromises),
    Promise.all(eraPromises),
    Promise.all(vibePromises),
    Promise.all(basePromises),
  ]);

  if (signal?.aborted) {
    throw signal.reason || new DOMException('The operation was aborted', 'AbortError');
  }

  const seedResults = seedGraphArrays.flat();
  const hiddenGemResults = hiddenGemArrays.flat();
  const baseResults = baseArrays.flat();

  // Deduplication & source tagging
  const excludeSet = new Set<number>(options.excludeIds);
  for (const r of ratingsList) {
    excludeSet.add(r.movieId);
  }

  const candidateMap = new Map<number, Candidate>();

  const addRawItem = (m: any, source: CandidateSource, isSeedNeighbour: boolean) => {
    if (!m || !m.id || !m.poster_path) return;
    if (excludeSet.has(m.id)) return;
    if (options.minVoteAverage && (m.vote_average || 0) < options.minVoteAverage) return;

    const existing = candidateMap.get(m.id);
    if (existing) {
      if (!existing.sources.includes(source)) {
        existing.sources.push(source);
      }
      if (isSeedNeighbour) {
        existing.seedNeighbour = true;
      }
    } else {
      const movie: Movie = {
        id: m.id,
        title: m.title || '',
        original_title: m.original_title,
        overview: m.overview || '',
        poster_path: m.poster_path,
        backdrop_path: m.backdrop_path || null,
        release_date: m.release_date || '',
        vote_average: m.vote_average || 0,
        vote_count: m.vote_count || 0,
        genre_ids: m.genre_ids || [],
        genres: (m.genre_ids || []).map((gid: number) => ({
          id: gid,
          name: GENRE_MAP[gid] || 'Other',
        })),
      };
      candidateMap.set(m.id, {
        movie,
        sources: [source],
        seedNeighbour: isSeedNeighbour,
      });
    }
  };

  // Interleave streams to ensure a rich balance of eras, vibes, baseline, seeds, and hidden gems
  const streams = [
    ...eraArrays.map((items) => ({
      items,
      source: 'acclaimed_baseline' as CandidateSource,
      isSeed: false,
    })),
    ...vibeArrays.map((items) => ({
      items,
      source: 'acclaimed_baseline' as CandidateSource,
      isSeed: false,
    })),
    { items: baseResults, source: 'acclaimed_baseline' as CandidateSource, isSeed: false },
    { items: seedResults, source: 'seed_graph' as CandidateSource, isSeed: true },
    { items: hiddenGemResults, source: 'hidden_gem' as CandidateSource, isSeed: false },
  ];
  const maxLen = Math.max(0, ...streams.map((s) => s.items.length));

  for (let i = 0; i < maxLen; i++) {
    for (const stream of streams) {
      if (i < stream.items.length) {
        addRawItem(stream.items[i], stream.source, stream.isSeed);
      }
    }
  }

  return Array.from(candidateMap.values());
}

export interface CandidateRecommendationOptions extends CandidateOptions {
  userRatings?: UserRating[] | Record<number, UserRating>;
}

export async function getCandidateRecommendationPool(
  options: CandidateRecommendationOptions = {},
  signal?: AbortSignal
): Promise<Movie[]> {
  const candidates = await generateCandidates(
    options.userRatings || [],
    options,
    signal
  );
  return candidates.map((c) => c.movie);
}
