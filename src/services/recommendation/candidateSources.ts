import type { Movie, UserRating } from '../../types';
import type { Candidate, CandidateSource, SourceCursor } from './types';
import { annotateCandidateMovies } from './candidateMovies';
import { enrichCandidates } from './enrichCandidates';
import {
  BoundedLRUMap,
  fetchFromTMDB,
  GENRE_MAP,
  getEraDateRange,
  getGenreIdsForVibes,
  VIBE_KEYWORD_MAP,
  MissingTmdbCredentialError,
} from '../tmdbClient';

const MAX_REQUESTS_PER_GENERATION = 45;
const MAX_REQUESTS_PER_LOAD_MORE = 20;
const TMDB_PAGE_SIZE = 20;
const CREATOR_CACHE_MAX_ENTRIES = 200;
const CREATOR_MIN_RATING = 8;
const CREATOR_MIN_HIGH_RATINGS = 3;
const CREATOR_MAX_SEED_MOVIES = 6;
const CREATOR_MAX_PEOPLE = 8;
const CREATOR_MIN_VOTE_COUNT = 30;
const CREATOR_JOBS = new Set(['Director', 'Screenplay', 'Writer']);

interface CachedCreatorRef {
  id: number;
  isDirector: boolean;
}

const movieCreditsCache = new BoundedLRUMap<number, CachedCreatorRef[]>(CREATOR_CACHE_MAX_ENTRIES);
const personMovieCreditsCache = new BoundedLRUMap<number, any[]>(CREATOR_CACHE_MAX_ENTRIES);

/**
 * Clears session-scoped creator-graph credit caches (for tests or session resets).
 */
export function clearCreatorGraphCache(): void {
  movieCreditsCache.clear();
  personMovieCreditsCache.clear();
}

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
  onCursors?: (cursors: SourceCursor[]) => void;
}

export interface GenerateCandidatesResult {
  candidates: Candidate[];
  cursors: SourceCursor[];
}

/**
 * Concurrency and budget limiter for TMDB API calls.
 * Enforces at most 6 requests in-flight simultaneously,
 * and at most 45 requests total per generation by default.
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
    private readonly maxRequests = MAX_REQUESTS_PER_GENERATION
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
 *
 * Scarce-filler tradeoff:
 * The cap only reorders and never drops candidates. When a candidate pool of 40
 * or more has fewer than about 20 non-era and non-vibe films, the over-cap items
 * in `rest` fill the first 40, so the nominal cap is exceeded. That is the
 * intended tradeoff, because the cap reorders and never drops films. Output
 * length always equals input length.
 */
export function applyFirst40CapAndFloors(
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
  // Prefer non-era seed candidates first so they are not rejected by the era cap
  const targetSeed = Math.min(8, totalSeed);
  let seedCount = mustInclude.filter((c) => c.sources.includes('seed_graph')).length;
  for (const c of candidates) {
    if (seedCount >= targetSeed) break;
    if (
      !mustIncludeSet.has(c.movie.id) &&
      c.sources.includes('seed_graph') &&
      !c.sources.includes('era')
    ) {
      if (tryAddMust(c)) {
        seedCount++;
      }
    }
  }
  for (const c of candidates) {
    if (seedCount >= targetSeed) break;
    if (!mustIncludeSet.has(c.movie.id) && c.sources.includes('seed_graph')) {
      if (tryAddMust(c)) {
        seedCount++;
      }
    }
  }

  // 4. Guarantee at least 8 hidden_gem candidates
  // Prefer non-era hidden gem candidates first so they are not rejected by the era cap
  const targetGem = Math.min(8, totalGem);
  let gemCount = mustInclude.filter((c) => c.sources.includes('hidden_gem')).length;
  for (const c of candidates) {
    if (gemCount >= targetGem) break;
    if (
      !mustIncludeSet.has(c.movie.id) &&
      c.sources.includes('hidden_gem') &&
      !c.sources.includes('era')
    ) {
      if (tryAddMust(c)) {
        gemCount++;
      }
    }
  }
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
 * Selects up to 6 distinct rated films with rating >= 8 (highest rating first, then newest ratedAt).
 * Returns an empty array when fewer than 3 qualifying ratings exist.
 */
export function selectCreatorSeedRatings(ratingsList: UserRating[]): UserRating[] {
  const highRatings = ratingsList.filter(
    (r) =>
      !!r &&
      typeof r === 'object' &&
      typeof r.movieId === 'number' &&
      Number.isFinite(r.movieId) &&
      Number.isFinite(r.rating) &&
      r.rating >= CREATOR_MIN_RATING
  );

  const sorted = [...highRatings].sort((a, b) => {
    if (b.rating !== a.rating) {
      return b.rating - a.rating;
    }
    const aTime = typeof a.ratedAt === 'number' && Number.isFinite(a.ratedAt) ? a.ratedAt : 0;
    const bTime = typeof b.ratedAt === 'number' && Number.isFinite(b.ratedAt) ? b.ratedAt : 0;
    return bTime - aTime;
  });

  const seenMovieIds = new Set<number>();
  const uniqueHighRatings: UserRating[] = [];
  for (const r of sorted) {
    if (!seenMovieIds.has(r.movieId)) {
      seenMovieIds.add(r.movieId);
      uniqueHighRatings.push(r);
    }
  }

  if (uniqueHighRatings.length < CREATOR_MIN_HIGH_RATINGS) {
    return [];
  }

  return uniqueHighRatings.slice(0, CREATOR_MAX_SEED_MOVIES);
}

/**
 * Fetches directing and writing credits for up to 8 distinct creators (directors first)
 * derived from the user's top rated films (>= 8), using bounded session caches.
 */
async function fetchCreatorGraphResults(
  seedRatings: UserRating[],
  internalSignal: AbortSignal,
  safeFetchObject: <T>(endpoint: string) => Promise<T | null>
): Promise<any[]> {
  if (seedRatings.length === 0 || internalSignal.aborted) {
    return [];
  }

  const movieCreditsList = await Promise.all(
    seedRatings.map(async (r): Promise<CachedCreatorRef[]> => {
      const cached = movieCreditsCache.get(r.movieId);
      if (cached !== undefined) {
        return cached;
      }

      const data = await safeFetchObject<{ crew?: any[] }>(`/movie/${r.movieId}/credits`);
      if (!data || !Array.isArray(data.crew)) {
        return [];
      }

      const perMovieMap = new Map<number, CachedCreatorRef>();
      for (const member of data.crew) {
        if (
          !member ||
          typeof member.id !== 'number' ||
          !Number.isFinite(member.id) ||
          typeof member.job !== 'string' ||
          !CREATOR_JOBS.has(member.job)
        ) {
          continue;
        }
        const isDirector = member.job === 'Director';
        const existing = perMovieMap.get(member.id);
        if (existing) {
          if (isDirector) {
            existing.isDirector = true;
          }
        } else {
          perMovieMap.set(member.id, { id: member.id, isDirector });
        }
      }

      const refs = Array.from(perMovieMap.values());
      movieCreditsCache.set(r.movieId, refs);
      return refs;
    })
  );

  if (internalSignal.aborted) {
    return [];
  }

  const creatorMap = new Map<number, { id: number; isDirector: boolean; firstFilmIdx: number }>();
  movieCreditsList.forEach((refs, filmIdx) => {
    for (const ref of refs) {
      const existing = creatorMap.get(ref.id);
      if (existing) {
        if (ref.isDirector) {
          existing.isDirector = true;
        }
      } else {
        creatorMap.set(ref.id, {
          id: ref.id,
          isDirector: ref.isDirector,
          firstFilmIdx: filmIdx,
        });
      }
    }
  });

  if (creatorMap.size === 0) {
    return [];
  }

  const selectedCreators = Array.from(creatorMap.values())
    .sort((a, b) => {
      if (a.isDirector !== b.isDirector) {
        return a.isDirector ? -1 : 1;
      }
      return a.firstFilmIdx - b.firstFilmIdx;
    })
    .slice(0, CREATOR_MAX_PEOPLE);

  const personFilmLists = await Promise.all(
    selectedCreators.map(async (creator): Promise<any[]> => {
      const cached = personMovieCreditsCache.get(creator.id);
      if (cached !== undefined) {
        return cached;
      }

      const data = await safeFetchObject<{ crew?: any[] }>(
        `/person/${creator.id}/movie_credits`
      );
      if (!data || !Array.isArray(data.crew)) {
        return [];
      }

      const seenMovieIds = new Set<number>();
      const filtered: any[] = [];
      for (const credit of data.crew) {
        if (
          !credit ||
          typeof credit.id !== 'number' ||
          !Number.isFinite(credit.id) ||
          typeof credit.job !== 'string' ||
          !CREATOR_JOBS.has(credit.job) ||
          typeof credit.poster_path !== 'string' ||
          !credit.poster_path.trim() ||
          typeof credit.vote_count !== 'number' ||
          !Number.isFinite(credit.vote_count) ||
          credit.vote_count < CREATOR_MIN_VOTE_COUNT
        ) {
          continue;
        }
        if (seenMovieIds.has(credit.id)) {
          continue;
        }
        seenMovieIds.add(credit.id);
        filtered.push(credit);
      }

      personMovieCreditsCache.set(creator.id, filtered);
      return filtered;
    })
  );

  // Round-robin interleave across creators so every creator gets early representation
  const combined: any[] = [];
  const maxPersonLen = Math.max(0, ...personFilmLists.map((list) => list.length));
  for (let i = 0; i < maxPersonLen; i++) {
    for (const list of personFilmLists) {
      if (i < list.length) {
        combined.push(list[i]);
      }
    }
  }
  return combined;
}

interface PagedFetchOutcome {
  results: any[];
  executed: boolean;
  succeeded: boolean;
  exhausted: boolean;
  error?: unknown;
}

const EMPTY_PAGED_OUTCOME: PagedFetchOutcome = {
  results: [],
  executed: false,
  succeeded: false,
  exhausted: false,
};

interface CandidateStream {
  items: any[];
  source: CandidateSource;
  isSeed: boolean;
}

interface PagedTaskSpec {
  source: CandidateSource;
  key: string;
  page: number;
  endpoint: string;
  params: Record<string, string | number>;
}

interface ExecutedPagedTask {
  spec: PagedTaskSpec;
  outcome: PagedFetchOutcome;
}

function normalizeRatingsList(
  userRatings: UserRating[] | Record<number, UserRating> = []
): UserRating[] {
  const rawRatingsList: UserRating[] = Array.isArray(userRatings)
    ? userRatings
    : Object.values(userRatings || {});
  return rawRatingsList.filter(
    (r): r is UserRating => !!r && typeof r === 'object' && typeof r.rating === 'number'
  );
}

function encodeDiscoverKey(params: Record<string, string | number>): string {
  const entries = Object.entries(params)
    .filter(([k]) => k !== 'page')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return `discover:${new URLSearchParams(entries).toString()}`;
}

function parseCursorQuery(
  cursor: SourceCursor
): { endpoint: string; params: Record<string, string | number> } | null {
  if (!cursor || typeof cursor.key !== 'string' || !Number.isFinite(cursor.nextPage) || cursor.nextPage < 1) {
    return null;
  }
  const page = Math.floor(cursor.nextPage);
  if (cursor.key.startsWith('recommendations:')) {
    const id = cursor.key.slice('recommendations:'.length).trim();
    return /^\d+$/.test(id) ? { endpoint: `/movie/${id}/recommendations`, params: { page } } : null;
  }
  if (cursor.key.startsWith('similar:')) {
    const id = cursor.key.slice('similar:'.length).trim();
    return /^\d+$/.test(id) ? { endpoint: `/movie/${id}/similar`, params: { page } } : null;
  }
  if (cursor.key.startsWith('discover:')) {
    const qs = cursor.key.slice('discover:'.length);
    const search = new URLSearchParams(qs);
    const params: Record<string, string | number> = {};
    search.forEach((value, key) => {
      params[key] = value;
    });
    params.page = page;
    return { endpoint: '/discover/movie', params };
  }
  if (cursor.key === 'trending:week') {
    return { endpoint: '/trending/movie/week', params: { page } };
  }
  if (cursor.source === 'seed_graph' && /^\d+$/.test(cursor.key)) {
    return { endpoint: `/movie/${cursor.key}/recommendations`, params: { page } };
  }
  return null;
}

function mergeCursorOutcome(
  existing: SourceCursor | undefined,
  source: CandidateSource,
  key: string,
  page: number,
  outcome: PagedFetchOutcome
): SourceCursor | undefined {
  if (!outcome.executed) {
    return existing;
  }
  if (!outcome.succeeded) {
    return existing ?? { source, key, nextPage: page, exhausted: false };
  }
  const nextPage = existing ? Math.max(existing.nextPage, page + 1) : page + 1;
  const exhausted = (existing?.exhausted ?? false) || outcome.exhausted;
  return {
    source,
    key,
    nextPage,
    exhausted,
  };
}

async function runLimitedQuery<T>(
  limiter: RequestLimiter,
  internalSignal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  task: () => Promise<T>,
  fallback: T,
  rethrowMissingCredential: boolean
): Promise<T> {
  if (internalSignal.aborted) {
    if (callerSignal?.aborted) {
      throw callerSignal.reason || new DOMException('The operation was aborted', 'AbortError');
    }
    return fallback;
  }

  try {
    const res = await limiter.schedule(async () => {
      try {
        return await task();
      } catch (err: any) {
        if (callerSignal?.aborted) {
          throw err;
        }
        if (rethrowMissingCredential && err instanceof MissingTmdbCredentialError) {
          throw err;
        }
        return fallback;
      }
    });
    return res ?? fallback;
  } catch (err: any) {
    if (callerSignal?.aborted) {
      throw err;
    }
    if (rethrowMissingCredential && err instanceof MissingTmdbCredentialError) {
      throw err;
    }
    return fallback;
  }
}

function createSafeFetchPaged(
  limiter: RequestLimiter,
  internalSignal: AbortSignal,
  callerSignal: AbortSignal | undefined
) {
  return (
    endpoint: string,
    params: Record<string, string | number> = {},
    page = 1
  ): Promise<PagedFetchOutcome> =>
    runLimitedQuery(
      limiter,
      internalSignal,
      callerSignal,
      async (): Promise<PagedFetchOutcome> => {
        try {
          const data = await fetchFromTMDB<{ results?: any[]; total_pages?: number }>(
            endpoint,
            params,
            internalSignal
          );
          const results = Array.isArray(data?.results) ? data.results : [];
          const totalPages =
            typeof data?.total_pages === 'number' && Number.isFinite(data.total_pages)
              ? data.total_pages
              : undefined;
          const exhausted =
            results.length < TMDB_PAGE_SIZE || (totalPages !== undefined && page >= totalPages);
          return {
            results,
            executed: true,
            succeeded: true,
            exhausted,
          };
        } catch (err: any) {
          if (
            callerSignal?.aborted ||
            err?.name === 'AbortError' ||
            err instanceof MissingTmdbCredentialError
          ) {
            throw err;
          }
          return {
            results: [],
            executed: true,
            succeeded: false,
            exhausted: false,
            error: err,
          };
        }
      },
      EMPTY_PAGED_OUTCOME,
      true
    );
}

function buildCandidatesFromStreams(
  streams: CandidateStream[],
  excludeSet: Set<number>,
  minVoteAverage?: number
): Candidate[] {
  const candidateMap = new Map<number, Candidate>();

  const addRawItem = (m: any, source: CandidateSource, isSeedNeighbour: boolean) => {
    if (!m || typeof m.id !== 'number' || !Number.isFinite(m.id) || !m.poster_path) return;
    if (excludeSet.has(m.id)) return;
    if (minVoteAverage && (m.vote_average || 0) < minVoteAverage) return;

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

/**
 * Generates recommendation candidates and records pagination cursors per paged query:
 * 1. Seed graph: /recommendations and /similar (pages 1-2) for weighted loved seeds
 * 2. Hidden gems: /discover/movie in top 3 genres with vote_count 50-800, vote_avg >= 7 (pages 1-2)
 * 3. Acclaimed baseline: top rated, popular, trending, eras, and vibes (page 1)
 * 4. Creator graph: other directing/writing credits of directors/writers from loved films (>= 8)
 *
 * Deduplicates by movie ID, merging source tags, excluding rated and poster-less films.
 */
export async function generateCandidatesWithCursors(
  userRatings: UserRating[] | Record<number, UserRating> = [],
  options: CandidateOptions = {},
  signal?: AbortSignal
): Promise<GenerateCandidatesResult> {
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

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (deadlineMs <= 0) {
    internalController.abort(new DOMException('The deadline expired', 'AbortError'));
  } else {
    timeoutId = setTimeout(() => {
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

  const limiter = new RequestLimiter(internalSignal, 6, MAX_REQUESTS_PER_GENERATION);

  try {
    const ratingsList = normalizeRatingsList(userRatings);
    const safeFetchPaged = createSafeFetchPaged(limiter, internalSignal, callerSignal);

    const safeFetchObject = <T>(endpoint: string): Promise<T | null> =>
      runLimitedQuery(
        limiter,
        internalSignal,
        callerSignal,
        () => fetchFromTMDB<T>(endpoint, {}, internalSignal),
        null,
        false
      );

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

    const eraSpecs: PagedTaskSpec[] = [];
    if (preferredEras.length > 0) {
      preferredEras.slice(0, 4).forEach((era) => {
        const range = getEraDateRange(era);
        if (range) {
          const p1: Record<string, string | number> = {
            'primary_release_date.gte': range.gte,
            'primary_release_date.lte': range.lte,
            sort_by: 'vote_average.desc',
            'vote_count.gte': 300,
            page: 1,
          };
          eraSpecs.push({
            source: 'era',
            key: encodeDiscoverKey(p1),
            page: 1,
            endpoint: '/discover/movie',
            params: p1,
          });
          const p2: Record<string, string | number> = {
            'primary_release_date.gte': range.gte,
            'primary_release_date.lte': range.lte,
            sort_by: 'popularity.desc',
            'vote_count.gte': 400,
            page: 1,
          };
          eraSpecs.push({
            source: 'era',
            key: encodeDiscoverKey(p2),
            page: 1,
            endpoint: '/discover/movie',
            params: p2,
          });
          if (withGenresParam) {
            const p3: Record<string, string | number> = {
              'primary_release_date.gte': range.gte,
              'primary_release_date.lte': range.lte,
              with_genres: withGenresParam,
              sort_by: 'vote_average.desc',
              'vote_count.gte': 150,
              page: 1,
            };
            eraSpecs.push({
              source: 'era',
              key: encodeDiscoverKey(p3),
              page: 1,
              endpoint: '/discover/movie',
              params: p3,
            });
          }
        }
      });
    }

    // 2. Vibe-targeted queries (guaranteed budget first)
    const vibeSpecs: PagedTaskSpec[] = [];
    if (withGenresParam) {
      const v1: Record<string, string | number> = {
        with_genres: withGenresParam,
        sort_by: 'vote_average.desc',
        'vote_count.gte': 600,
        page: 1,
      };
      vibeSpecs.push({
        source: 'vibe',
        key: encodeDiscoverKey(v1),
        page: 1,
        endpoint: '/discover/movie',
        params: v1,
      });
      const v2: Record<string, string | number> = {
        with_genres: withGenresParam,
        sort_by: 'popularity.desc',
        'vote_count.gte': 1000,
        page: 1,
      };
      vibeSpecs.push({
        source: 'vibe',
        key: encodeDiscoverKey(v2),
        page: 1,
        endpoint: '/discover/movie',
        params: v2,
      });
    }

    if (keywordIds.length > 0) {
      const v3: Record<string, string | number> = {
        with_keywords: keywordIds.join('|'),
        sort_by: 'vote_average.desc',
        'vote_count.gte': 250,
        page: 1,
      };
      vibeSpecs.push({
        source: 'vibe',
        key: encodeDiscoverKey(v3),
        page: 1,
        endpoint: '/discover/movie',
        params: v3,
      });
    }

    // 3. Hidden Gems: /discover/movie in top 3 user genres (guaranteed budget first)
    const topGenreIds = getTopUserGenreIds(ratingsList, options.genres);
    const hiddenGemSpecs: PagedTaskSpec[] = [];
    for (const gid of topGenreIds) {
      const baseGemParams = {
        with_genres: String(gid),
        'vote_average.gte': 7,
        'vote_count.gte': 50,
        'vote_count.lte': 800,
        sort_by: 'vote_average.desc',
      };
      const gemKey = encodeDiscoverKey(baseGemParams);
      hiddenGemSpecs.push({
        source: 'hidden_gem',
        key: gemKey,
        page: 1,
        endpoint: '/discover/movie',
        params: { ...baseGemParams, page: 1 },
      });
      hiddenGemSpecs.push({
        source: 'hidden_gem',
        key: gemKey,
        page: 2,
        endpoint: '/discover/movie',
        params: { ...baseGemParams, page: 2 },
      });
    }

    // 4. Acclaimed Baseline base queries
    const base1Params: Record<string, string | number> = {
      sort_by: 'vote_average.desc',
      'vote_count.gte': 800,
      page: 1,
    };
    const base2Params: Record<string, string | number> = {
      sort_by: 'popularity.desc',
      'vote_count.gte': 1500,
      page: 1,
    };
    const baseSpecs: PagedTaskSpec[] = [
      {
        source: 'acclaimed_baseline',
        key: encodeDiscoverKey(base1Params),
        page: 1,
        endpoint: '/discover/movie',
        params: base1Params,
      },
      {
        source: 'acclaimed_baseline',
        key: encodeDiscoverKey(base2Params),
        page: 1,
        endpoint: '/discover/movie',
        params: base2Params,
      },
      {
        source: 'acclaimed_baseline',
        key: 'trending:week',
        page: 1,
        endpoint: '/trending/movie/week',
        params: {},
      },
    ];

    // Budget reservation per source:
    // Era, vibe, and hidden gems are guaranteed budget first, followed by the 3 base queries.
    const reserved =
      eraSpecs.length +
      vibeSpecs.length +
      hiddenGemSpecs.length +
      baseSpecs.length;

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

    const creatorSeedRatings = selectCreatorSeedRatings(ratingsList);
    const remainingBudget = Math.max(0, MAX_REQUESTS_PER_GENERATION - reserved);
    // Reserve budget for creator graph within the 45-request ceiling when qualifying >= 8
    // ratings exist, while preserving at least 1 seed pair when remainingBudget >= 2.
    const creatorReserve =
      creatorSeedRatings.length > 0
        ? Math.min(
            creatorSeedRatings.length + CREATOR_MAX_PEOPLE,
            Math.max(0, remainingBudget - 2)
          )
        : 0;
    const seedBudget = Math.max(0, remainingBudget - creatorReserve);
    const maxSeedPairs = Math.floor(seedBudget / 2);

    const page1PairsCount = Math.min(chosenSeedIds.length, maxSeedPairs);
    const page2PairsCount = Math.min(
      chosenSeedIds.length,
      Math.max(0, maxSeedPairs - page1PairsCount)
    );

    // Dropping page 2 before dropping seeds, ensuring complete pairs
    const seedPage1Specs: PagedTaskSpec[] = [];
    for (let i = 0; i < page1PairsCount; i++) {
      const id = chosenSeedIds[i];
      seedPage1Specs.push({
        source: 'seed_graph',
        key: `recommendations:${id}`,
        page: 1,
        endpoint: `/movie/${id}/recommendations`,
        params: { page: 1 },
      });
      seedPage1Specs.push({
        source: 'seed_graph',
        key: `similar:${id}`,
        page: 1,
        endpoint: `/movie/${id}/similar`,
        params: { page: 1 },
      });
    }

    const seedPage2Specs: PagedTaskSpec[] = [];
    for (let i = 0; i < page2PairsCount; i++) {
      const id = chosenSeedIds[i];
      seedPage2Specs.push({
        source: 'seed_graph',
        key: `recommendations:${id}`,
        page: 2,
        endpoint: `/movie/${id}/recommendations`,
        params: { page: 2 },
      });
      seedPage2Specs.push({
        source: 'seed_graph',
        key: `similar:${id}`,
        page: 2,
        endpoint: `/movie/${id}/similar`,
        params: { page: 2 },
      });
    }

    const seedSpecs = [...seedPage1Specs, ...seedPage2Specs];

    const runSpec = async (spec: PagedTaskSpec): Promise<ExecutedPagedTask> => ({
      spec,
      outcome: await safeFetchPaged(spec.endpoint, spec.params, spec.page),
    });

    // Guaranteed budget promises first: era, vibe, hidden-gem, base, then seed queries
    const eraPromises = eraSpecs.map(runSpec);
    const vibePromises = vibeSpecs.map(runSpec);
    const hiddenGemPromises = hiddenGemSpecs.map(runSpec);
    const basePromises = baseSpecs.map(runSpec);
    const seedGraphPromises = seedSpecs.map(runSpec);

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
    const [seedGraphExecs, hiddenGemExecs, eraExecs, vibeExecs, baseExecs] = await Promise.all([
      Promise.all(seedGraphPromises),
      Promise.all(hiddenGemPromises),
      Promise.all(eraPromises),
      Promise.all(vibePromises),
      Promise.all(basePromises),
    ]);

    if (callerSignal?.aborted) {
      throw callerSignal.reason || new DOMException('The operation was aborted', 'AbortError');
    }

    // 6. Creator Graph: scheduled after seed graph so tight budget or deadline cuts it first
    const creatorGraphResults = await fetchCreatorGraphResults(
      creatorSeedRatings,
      internalSignal,
      safeFetchObject
    );

    if (callerSignal?.aborted) {
      throw callerSignal.reason || new DOMException('The operation was aborted', 'AbortError');
    }

    const cursorMap = new Map<string, SourceCursor>();
    const recordCursors = (execs: ExecutedPagedTask[]) => {
      for (const { spec, outcome } of execs) {
        const mapKey = `${spec.source}::${spec.key}`;
        const merged = mergeCursorOutcome(
          cursorMap.get(mapKey),
          spec.source,
          spec.key,
          spec.page,
          outcome
        );
        if (merged) {
          cursorMap.set(mapKey, merged);
        }
      }
    };

    recordCursors(seedGraphExecs);
    recordCursors(hiddenGemExecs);
    recordCursors(eraExecs);
    recordCursors(vibeExecs);
    recordCursors(baseExecs);

    const cursors = Array.from(cursorMap.values());

    const seedResults = seedGraphExecs.flatMap((e) => e.outcome.results);
    const hiddenGemResults = hiddenGemExecs.flatMap((e) => e.outcome.results);
    const baseResults = baseExecs.flatMap((e) => e.outcome.results);

    const excludeSet = new Set<number>(options.excludeIds);
    for (const r of ratingsList) {
      excludeSet.add(r.movieId);
    }

    // Interleave streams to ensure a rich balance of eras, vibes, baseline, seeds, hidden gems, and creator graph
    const streams: CandidateStream[] = [
      ...eraExecs.map((e) => ({
        items: e.outcome.results,
        source: 'era' as CandidateSource,
        isSeed: false,
      })),
      ...vibeExecs.map((e) => ({
        items: e.outcome.results,
        source: 'vibe' as CandidateSource,
        isSeed: false,
      })),
      { items: baseResults, source: 'acclaimed_baseline' as CandidateSource, isSeed: false },
      { items: seedResults, source: 'seed_graph' as CandidateSource, isSeed: true },
      { items: hiddenGemResults, source: 'hidden_gem' as CandidateSource, isSeed: false },
      { items: creatorGraphResults, source: 'creator_graph' as CandidateSource, isSeed: false },
    ];

    const rawCandidates = buildCandidatesFromStreams(streams, excludeSet, options.minVoteAverage);
    const candidates = applyFirst40CapAndFloors(rawCandidates, options);
    options.onCursors?.(cursors);
    return { candidates, cursors };
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
    internalController.abort();
    limiter.dispose();
  }
}

export async function generateCandidates(
  userRatings: UserRating[] | Record<number, UserRating> = [],
  options: CandidateOptions = {},
  signal?: AbortSignal
): Promise<Candidate[]> {
  const { candidates } = await generateCandidatesWithCursors(userRatings, options, signal);
  return candidates;
}

/**
 * Pulls the next page from non-exhausted cursors (seed_graph first),
 * bounded by at most 20 requests and 6 in-flight, deduplicated and
 * excluding rated and caller-excluded movie IDs.
 */
export async function loadMoreCandidates(
  cursors: SourceCursor[],
  userRatings: UserRating[] | Record<number, UserRating> = [],
  excludeIds?: Set<number> | Iterable<number>,
  signal?: AbortSignal
): Promise<GenerateCandidatesResult> {
  if (signal?.aborted) {
    throw signal.reason || new DOMException('The operation was aborted', 'AbortError');
  }

  const clonedCursors = (Array.isArray(cursors) ? cursors : []).map((c) => ({ ...c }));
  if (clonedCursors.length === 0) {
    return { candidates: [], cursors: [] };
  }

  const indexedActive = clonedCursors
    .map((cursor, index) => ({
      cursor,
      index,
      query: !cursor.exhausted ? parseCursorQuery(cursor) : null,
    }))
    .filter(
      (entry): entry is { cursor: SourceCursor; index: number; query: NonNullable<ReturnType<typeof parseCursorQuery>> } =>
        !entry.cursor.exhausted && entry.query !== null
    );

  if (indexedActive.length === 0) {
    return { candidates: [], cursors: clonedCursors };
  }

  // Prioritize seed_graph cursors first, preserving relative order within each group
  const prioritized = [
    ...indexedActive.filter((e) => e.cursor.source === 'seed_graph'),
    ...indexedActive.filter((e) => e.cursor.source !== 'seed_graph'),
  ].slice(0, MAX_REQUESTS_PER_LOAD_MORE);

  const callerSignal = signal;
  const internalController = new AbortController();
  const internalSignal = internalController.signal;

  const onCallerAbort = () => {
    internalController.abort(
      callerSignal?.reason || new DOMException('The operation was aborted', 'AbortError')
    );
  };
  if (callerSignal) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const limiter = new RequestLimiter(internalSignal, 6, MAX_REQUESTS_PER_LOAD_MORE);

  try {
    const ratingsList = normalizeRatingsList(userRatings);
    const safeFetchPaged = createSafeFetchPaged(limiter, internalSignal, callerSignal);

    const taskPromises = prioritized.map(async (entry) => ({
      entry,
      outcome: await safeFetchPaged(
        entry.query.endpoint,
        entry.query.params,
        Math.floor(entry.cursor.nextPage)
      ),
    }));
    for (const p of taskPromises) {
      p.catch(() => {});
    }

    const completed = await Promise.all(taskPromises);

    if (callerSignal?.aborted) {
      throw callerSignal.reason || new DOMException('The operation was aborted', 'AbortError');
    }

    const executedOutcomes = completed.filter((c) => c.outcome.executed);
    if (executedOutcomes.length > 0 && !executedOutcomes.some((c) => c.outcome.succeeded)) {
      const firstError = executedOutcomes.find((c) => c.outcome.error !== undefined)?.outcome.error;
      throw firstError instanceof Error
        ? firstError
        : new Error('Failed to load more recommendations');
    }

    const streams: CandidateStream[] = [];
    for (const { entry, outcome } of completed) {
      const updated = mergeCursorOutcome(
        entry.cursor,
        entry.cursor.source,
        entry.cursor.key,
        Math.floor(entry.cursor.nextPage),
        outcome
      );
      if (updated) {
        clonedCursors[entry.index] = updated;
      }
      if (outcome.results.length > 0) {
        streams.push({
          items: outcome.results,
          source: entry.cursor.source,
          isSeed: entry.cursor.source === 'seed_graph',
        });
      }
    }

    const excludeSet = new Set<number>(excludeIds ?? []);
    for (const r of ratingsList) {
      excludeSet.add(r.movieId);
    }

    const candidates = buildCandidatesFromStreams(streams, excludeSet);
    return { candidates, cursors: clonedCursors };
  } finally {
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
    internalController.abort();
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
  return annotateCandidateMovies(await enrichCandidates(candidates, {}, signal));
}
