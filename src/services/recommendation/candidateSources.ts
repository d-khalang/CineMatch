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
  deadlineMs?: number;
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
  private onAbortListener?: () => void;

  constructor(
    private signal?: AbortSignal,
    private readonly maxConcurrency = 6,
    private readonly maxRequests = 45
  ) {
    if (this.signal) {
      if (this.signal.aborted) {
        this.abortWaiters();
      } else {
        this.onAbortListener = () => this.abortWaiters();
        this.signal.addEventListener('abort', this.onAbortListener, { once: true });
      }
    }
  }

  dispose() {
    if (this.signal && this.onAbortListener) {
      this.signal.removeEventListener('abort', this.onAbortListener);
      this.onAbortListener = undefined;
    }
    this.abortWaiters();
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

function matchesEra(
  releaseDate: string | undefined,
  range: { gte: string; lte: string } | null
): boolean {
  if (!range || !releaseDate) return true;
  const yearMatch = releaseDate.match(/^(\d{4})/);
  if (!yearMatch) return false;
  const year = parseInt(yearMatch[1], 10);
  const startYear = parseInt(range.gte.slice(0, 4), 10);
  const endYear = parseInt(range.lte.slice(0, 4), 10);
  return year >= startYear && year <= endYear;
}

/**
 * Applies CIN-30 source caps and floors to the first 40 candidates:
 * - At most 20 carry 'era'
 * - At most 4 carry 'vibe' when preferredEras is non-empty, otherwise at most 12
 * - At least 1 era (when eras are selected) and 1 vibe remain
 * - At least 8 seed_graph and 8 hidden_gem remain (when available)
 * - Preferred eras fill at least half the window (20 items) when era candidates are plentiful
 * - Preserves stream interleaving relative order within the first 40 and beyond
 */
function applyFirst40CapAndFloors(
  candidates: Candidate[],
  options: CandidateOptions
): Candidate[] {
  if (candidates.length <= 1) {
    return candidates;
  }

  const preferredEras = (options.preferredEras || []).filter(
    (e) => typeof e === 'string' && e.trim().length > 0
  );
  const selectedVibes = (options.selectedVibes || []).filter(
    (v) => typeof v === 'string' && v.trim().length > 0
  );

  const hasEras = preferredEras.length > 0;
  const hasVibes = selectedVibes.length > 0;

  const maxEra = hasEras ? 20 : 0;
  const maxVibe = hasEras ? 4 : 12;

  const totalEra = candidates.filter((c) => c.sources.includes('era')).length;
  const totalVibe = candidates.filter((c) => c.sources.includes('vibe')).length;
  const totalSeed = candidates.filter((c) => c.sources.includes('seed_graph')).length;
  const totalGem = candidates.filter((c) => c.sources.includes('hidden_gem')).length;
  const totalBase = candidates.filter((c) => c.sources.includes('acclaimed_baseline')).length;

  const mustInclude: Candidate[] = [];
  const mustIncludeSet = new Set<number>();
  let eraCount = 0;
  let vibeCount = 0;

  const tryAddMust = (c: Candidate): boolean => {
    if (mustIncludeSet.has(c.movie.id)) return true;
    const willEra = c.sources.includes('era') ? 1 : 0;
    const willVibe = c.sources.includes('vibe') ? 1 : 0;
    if (eraCount + willEra > maxEra) return false;
    if (vibeCount + willVibe > maxVibe) return false;
    mustInclude.push(c);
    mustIncludeSet.add(c.movie.id);
    eraCount += willEra;
    vibeCount += willVibe;
    return true;
  };

  // 1. If eras are selected, guarantee era representation and floor
  if (hasEras) {
    // 1a. Representation for each selected era
    for (const eraStr of preferredEras) {
      const range = getEraDateRange(eraStr);
      const rep = candidates.find(
        (c) =>
          !mustIncludeSet.has(c.movie.id) &&
          c.sources.includes('era') &&
          matchesEra(c.movie.release_date, range)
      );
      if (rep) {
        tryAddMust(rep);
      }
    }

    // 1b. Floor: up to 20 if available
    const targetEra = Math.min(20, totalEra);
    for (const c of candidates) {
      if (eraCount >= targetEra) break;
      if (!mustIncludeSet.has(c.movie.id) && c.sources.includes('era')) {
        tryAddMust(c);
      }
    }
  }

  // 2. If vibes are selected or present, guarantee at least 1 vibe
  if ((hasVibes || totalVibe > 0) && vibeCount === 0 && maxVibe > 0) {
    const rep = candidates.find(
      (c) => !mustIncludeSet.has(c.movie.id) && c.sources.includes('vibe')
    );
    if (rep) {
      tryAddMust(rep);
    }
  }

  // 3. Guarantee at least 8 seed_graph candidates
  const targetSeed = Math.min(8, totalSeed);
  let seedCount = mustInclude.filter((c) => c.sources.includes('seed_graph')).length;
  for (const c of candidates) {
    if (seedCount >= targetSeed) break;
    if (!mustIncludeSet.has(c.movie.id) && c.sources.includes('seed_graph')) {
      if (tryAddMust(c)) {
        seedCount++;
      }
    }
  }

  // 4. Guarantee at least 8 hidden_gem candidates
  const targetGem = Math.min(8, totalGem);
  let gemCount = mustInclude.filter((c) => c.sources.includes('hidden_gem')).length;
  for (const c of candidates) {
    if (gemCount >= targetGem) break;
    if (!mustIncludeSet.has(c.movie.id) && c.sources.includes('hidden_gem')) {
      if (tryAddMust(c)) {
        gemCount++;
      }
    }
  }

  // 5. Without preferred eras, guarantee at least 1 acclaimed_baseline film
  if (!hasEras && totalBase > 0) {
    const hasBase = mustInclude.some((c) => c.sources.includes('acclaimed_baseline'));
    if (!hasBase) {
      const rep = candidates.find(
        (c) => !mustIncludeSet.has(c.movie.id) && c.sources.includes('acclaimed_baseline')
      );
      if (rep) {
        tryAddMust(rep);
      }
    }
  }

  // 6. Fill remaining slots up to 40
  const selected = [...mustInclude];
  const targetTotal = Math.min(40, candidates.length);

  for (const c of candidates) {
    if (selected.length >= targetTotal) break;
    if (mustIncludeSet.has(c.movie.id)) continue;

    const willEra = c.sources.includes('era') ? 1 : 0;
    const willVibe = c.sources.includes('vibe') ? 1 : 0;

    if (eraCount + willEra > maxEra) continue;
    if (vibeCount + willVibe > maxVibe) continue;

    selected.push(c);
    mustIncludeSet.add(c.movie.id);
    eraCount += willEra;
    vibeCount += willVibe;
  }

  // Sort selected by original index to preserve stream interleaving order
  const candidateIndexMap = new Map<number, number>();
  candidates.forEach((c, idx) => candidateIndexMap.set(c.movie.id, idx));

  selected.sort(
    (a, b) => (candidateIndexMap.get(a.movie.id) ?? 0) - (candidateIndexMap.get(b.movie.id) ?? 0)
  );

  const selectedIdSet = new Set(selected.map((c) => c.movie.id));
  const rest = candidates.filter((c) => !selectedIdSet.has(c.movie.id));

  return [...selected, ...rest];
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

  const callerSignal = signal;
  const rawDeadline = options.deadlineMs;
  const deadlineMs =
    typeof rawDeadline === 'number' && Number.isFinite(rawDeadline)
      ? rawDeadline
      : 12000;

  const internalController = new AbortController();
  const internalSignal = internalController.signal;

  let deadlineExpired = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (deadlineMs <= 0) {
    deadlineExpired = true;
    internalController.abort(new DOMException('The deadline expired', 'AbortError'));
  } else {
    timeoutId = setTimeout(() => {
      deadlineExpired = true;
      internalController.abort(new DOMException('The deadline expired', 'AbortError'));
    }, deadlineMs);
  }

  const onCallerAbort = () => {
    internalController.abort(
      callerSignal?.reason || new DOMException('The operation was aborted', 'AbortError')
    );
  };

  if (callerSignal) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const limiter = new RequestLimiter(internalSignal, 6, 45);

  try {
    const rawRatingsList: UserRating[] = Array.isArray(userRatings)
      ? userRatings
      : Object.values(userRatings || {});
    const ratingsList = rawRatingsList.filter(
      (r): r is UserRating => !!r && typeof r === 'object' && typeof r.rating === 'number'
    );

    const safeFetch = async (
      endpoint: string,
      params: Record<string, string | number> = {}
    ): Promise<any[]> => {
      if (internalSignal.aborted) {
        if (callerSignal?.aborted) {
          throw callerSignal.reason || new DOMException('The operation was aborted', 'AbortError');
        }
        return [];
      }

      try {
        const res = await limiter.schedule(async () => {
          try {
            const data = await fetchFromTMDB<{ results: any[] }>(endpoint, params, internalSignal);
            return data.results || [];
          } catch (err: any) {
            if (callerSignal?.aborted) {
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
      } catch (err: any) {
        if (callerSignal?.aborted) {
          throw err;
        }
        if (err instanceof MissingTmdbCredentialError) {
          throw err;
        }
        return [];
      }
    };

    // 1. Era-targeted queries (guaranteed budget first)
    const preferredEras = (options.preferredEras || []).filter(
      (e) => typeof e === 'string' && e.trim().length > 0
    );
    const selectedVibes = (options.selectedVibes || []).filter(
      (v) => typeof v === 'string' && v.trim().length > 0
    );

    const vibeGenreIds = getGenreIdsForVibes(selectedVibes);
    const validOptionGenres = (options.genres || []).filter(
      (g) => typeof g === 'number' && Number.isFinite(g) && g > 0
    );
    const targetGenreIds = Array.from(new Set([...vibeGenreIds, ...validOptionGenres]));
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

    // 5. Seed Graph: remainder of the 45-request budget, truncated to whole pairs for page 1 and page 2
    const eligibleRatings = ratingsList.filter((r) => r.rating >= 7);
    const rawSeedCount = options.seedCount;
    const requestedSeedCount =
      typeof rawSeedCount === 'number' && Number.isFinite(rawSeedCount)
        ? Math.max(0, Math.floor(rawSeedCount))
        : 8;
    const targetSeedCount = Math.min(eligibleRatings.length, requestedSeedCount);

    let chosenSeedIds: number[] = [];
    if (eligibleRatings.length > 0) {
      const chosenSeeds = selectWeightedSeeds(eligibleRatings, targetSeedCount, options.randomFn);
      chosenSeedIds = chosenSeeds.map((r) => r.movieId);
    } else if (options.seedMovieIds && options.seedMovieIds.length > 0) {
      chosenSeedIds = options.seedMovieIds.slice(0, requestedSeedCount);
    }

    const remainingBudget = Math.max(0, 45 - reserved);
    const maxSeedPairs = Math.floor(remainingBudget / 2);

    const page1PairsCount = Math.min(chosenSeedIds.length, maxSeedPairs);
    const page2PairsCount = Math.min(
      chosenSeedIds.length,
      Math.max(0, maxSeedPairs - page1PairsCount)
    );

    // Dropping page 2 before dropping seeds, ensuring complete pairs
    const seedPage1Tasks: Array<() => Promise<any[]>> = [];
    for (let i = 0; i < page1PairsCount; i++) {
      const id = chosenSeedIds[i];
      seedPage1Tasks.push(() => safeFetch(`/movie/${id}/recommendations`, { page: 1 }));
      seedPage1Tasks.push(() => safeFetch(`/movie/${id}/similar`, { page: 1 }));
    }

    const seedPage2Tasks: Array<() => Promise<any[]>> = [];
    for (let i = 0; i < page2PairsCount; i++) {
      const id = chosenSeedIds[i];
      seedPage2Tasks.push(() => safeFetch(`/movie/${id}/recommendations`, { page: 2 }));
      seedPage2Tasks.push(() => safeFetch(`/movie/${id}/similar`, { page: 2 }));
    }

    const seedQueryTasks = [...seedPage1Tasks, ...seedPage2Tasks];

    // Guaranteed budget promises first: era, vibe, hidden-gem, base, then seed queries
    const eraPromises = eraQueryTasks.map((t) => t());
    const vibePromises = vibeQueryTasks.map((t) => t());
    const hiddenGemPromises = hiddenGemQueryTasks.map((t) => t());
    const basePromises = baseQueryTasks.map((t) => t());
    const seedGraphPromises = seedQueryTasks.map((t) => t());

    const allTaskPromises = [
      ...eraPromises,
      ...vibePromises,
      ...hiddenGemPromises,
      ...basePromises,
      ...seedGraphPromises,
    ];
    for (const p of allTaskPromises) {
      p.catch(() => {});
    }

    // Execute all scheduled tasks with concurrency and ceiling limits
    const [seedGraphArrays, hiddenGemArrays, eraArrays, vibeArrays, baseArrays] = await Promise.all([
      Promise.all(seedGraphPromises),
      Promise.all(hiddenGemPromises),
      Promise.all(eraPromises),
      Promise.all(vibePromises),
      Promise.all(basePromises),
    ]);

    if (callerSignal?.aborted) {
      throw callerSignal.reason || new DOMException('The operation was aborted', 'AbortError');
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
        source: 'era' as CandidateSource,
        isSeed: false,
      })),
      ...vibeArrays.map((items) => ({
        items,
        source: 'vibe' as CandidateSource,
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

    const rawCandidates = Array.from(candidateMap.values());
    return applyFirst40CapAndFloors(rawCandidates, options);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
    limiter.dispose();
  }
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
