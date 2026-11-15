import type { Movie, UserRating } from '../../types';
import type {
  Candidate,
  ScoredCandidate,
  AboveFloorBucket,
  Bucket,
  BucketMix,
  CandidateScores,
} from './types';

export const DEFAULT_RELEVANCE_FLOOR = 0.45;
export const DEFAULT_MMR_LAMBDA = 0.7;

export interface TasteProfile {
  genres: Map<string, number>;
  keywords: Map<string, number>;
  directors: Map<string, number>;
  decades: Map<string, number>;
  totalRatings: number;
  meanCenteredRating: number;
  usualGenres: Set<string>;
  usualDecades: Set<string>;
}

export interface RankedCandidate extends ScoredCandidate {
  rank: number;
}

export interface ScoreCandidatesOptions {
  relevanceFloor?: number;
  preferredEras?: string[];
  selectedVibes?: string[];
}

/**
 * Parses a 4-digit decade (e.g. "1990s", "2010s") from a release date or year string.
 */
export function getDecade(yearOrDate: string | undefined | null): string | null {
  if (!yearOrDate || typeof yearOrDate !== 'string') return null;
  const fourDigit = yearOrDate.match(/(\d{4})(?!\d)/);
  if (fourDigit) {
    const year = parseInt(fourDigit[1], 10);
    if (!isNaN(year) && year >= 1880 && year <= 2100) {
      return `${Math.floor(year / 10) * 10}s`;
    }
  }
  const twoDigit = yearOrDate.match(/\b(\d{2})s\b/i);
  if (twoDigit) {
    const y2 = parseInt(twoDigit[1], 10);
    const y4 = y2 >= 30 ? 1900 + y2 : 2000 + y2;
    return `${Math.floor(y4 / 10) * 10}s`;
  }
  return null;
}

function getGenreNames(movie: Movie): string[] {
  if (Array.isArray(movie.genres)) {
    return movie.genres
      .map((g) => (typeof g === 'string' ? g : g?.name))
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name) => name.trim().toLowerCase());
  }
  return [];
}

function getKeywords(movie: Movie): string[] {
  if (Array.isArray(movie.keywords)) {
    return movie.keywords
      .filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
      .map((k) => k.trim().toLowerCase());
  }
  return [];
}

function getDirector(movie: Movie): string | null {
  if (typeof movie.director === 'string' && movie.director.trim().length > 0) {
    return movie.director.trim().toLowerCase();
  }
  return null;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Builds a taste profile vector from user ratings.
 * Centered around 5.5 so ratings <= 5 count against affinities.
 * Unusual genres are genres below the median affinity (only positive genres at or above
 * the median affinity are added to `usualGenres`).
 */
export function buildTasteProfile(userRatings: UserRating[]): TasteProfile {
  const genres = new Map<string, number>();
  const keywords = new Map<string, number>();
  const directors = new Map<string, number>();
  const decades = new Map<string, number>();
  const usualGenres = new Set<string>();
  const usualDecades = new Set<string>();

  if (!userRatings || userRatings.length === 0) {
    return {
      genres,
      keywords,
      directors,
      decades,
      totalRatings: 0,
      meanCenteredRating: 0,
      usualGenres,
      usualDecades,
    };
  }

  let totalWeight = 0;

  for (const r of userRatings) {
    const rating = typeof r.rating === 'number' && Number.isFinite(r.rating) ? r.rating : 5.5;
    // Centered around 5.5: 10 is +1.0, 5.5 is 0, 1 is -1.0; clamped to [-1, 1]
    const rawWeight = (rating - 5.5) / 4.5;
    const weight = Math.max(-1, Math.min(1, rawWeight));
    totalWeight += weight;

    // Genres
    if (Array.isArray(r.genres)) {
      for (const g of r.genres) {
        if (typeof g === 'string' && g.trim()) {
          const gNorm = g.trim().toLowerCase();
          genres.set(gNorm, (genres.get(gNorm) || 0) + weight);
        }
      }
    }

    // Director
    if (r.director && typeof r.director === 'string' && r.director.trim()) {
      const dNorm = r.director.trim().toLowerCase();
      directors.set(dNorm, (directors.get(dNorm) || 0) + weight * 2.0);
    }

    // Keywords
    if (Array.isArray(r.keywords)) {
      for (const k of r.keywords) {
        if (typeof k === 'string' && k.trim()) {
          const kNorm = k.trim().toLowerCase();
          keywords.set(kNorm, (keywords.get(kNorm) || 0) + weight * 1.5);
        }
      }
    }

    // Decade
    const dec = getDecade(r.year);
    if (dec) {
      decades.set(dec, (decades.get(dec) || 0) + weight);
    }
  }

  // Unusual genres are genres below the median affinity.
  // Only positively rated genres at or above the median affinity count as usual.
  if (genres.size > 0) {
    const genreMedian = computeMedian([...genres.values()]);
    for (const [g, aff] of genres) {
      if (aff > 0 && aff >= genreMedian) {
        usualGenres.add(g);
      }
    }
  }

  for (const [d, aff] of decades) {
    if (aff > 0) usualDecades.add(d);
  }

  const meanCenteredRating = totalWeight / userRatings.length;

  return {
    genres,
    keywords,
    directors,
    decades,
    totalRatings: userRatings.length,
    meanCenteredRating,
    usualGenres,
    usualDecades,
  };
}

/**
 * Computes inverse popularity / vote-count percentiles within the candidate pool.
 */
function computeNovelties(candidates: Candidate[]): Map<number, number> {
  const result = new Map<number, number>();
  const n = candidates.length;
  if (n === 0) return result;
  if (n === 1) {
    result.set(candidates[0].movie.id, 0.5);
    return result;
  }

  const voteCounts = candidates.map((c) =>
    Number.isFinite(c.movie.vote_count) ? c.movie.vote_count : 0
  );
  const minVotes = Math.min(...voteCounts);
  const maxVotes = Math.max(...voteCounts);

  if (minVotes === maxVotes) {
    for (const c of candidates) {
      result.set(c.movie.id, 0.5);
    }
    return result;
  }

  for (let i = 0; i < n; i++) {
    const v = voteCounts[i];
    let countLess = 0;
    let countEqual = 0;
    for (let j = 0; j < n; j++) {
      if (voteCounts[j] < v) countLess++;
      else if (voteCounts[j] === v) countEqual++;
    }
    const midpointPercentile = (countLess + 0.5 * countEqual) / n;
    const pMin = 0.5 / n;
    const pMax = (n - 0.5) / n;
    const popularityPct = pMax > pMin ? (midpointPercentile - pMin) / (pMax - pMin) : 0.5;
    const novelty = Math.max(0, Math.min(1, 1 - popularityPct));
    result.set(candidates[i].movie.id, novelty);
  }

  return result;
}

/**
 * Computes unexpectedness: distance from usual genres and decades plus non-seed-neighbour bonus.
 */
function computeUnexpectedness(candidate: Candidate, profile: TasteProfile): number {
  const genres = getGenreNames(candidate.movie);
  let genreDistance: number;

  if (profile.totalRatings === 0 || genres.length === 0) {
    genreDistance = 0.5;
  } else {
    let usualCount = 0;
    for (const g of genres) {
      if (profile.usualGenres.has(g)) {
        usualCount++;
      }
    }
    genreDistance = 1 - usualCount / genres.length;
  }

  const dec = getDecade(candidate.movie.release_date);
  let decadeDistance: number;
  if (profile.totalRatings === 0 || !dec) {
    decadeDistance = 0.5;
  } else {
    decadeDistance = profile.usualDecades.has(dec) ? 0.0 : 1.0;
  }

  const tasteDistance = 0.7 * genreDistance + 0.3 * decadeDistance;
  const seedBonus = candidate.seedNeighbour ? 0.0 : 0.2;

  const rawUnexpectedness = 0.8 * tasteDistance + seedBonus;
  return Math.max(0, Math.min(1, rawUnexpectedness));
}

interface NormalizedColdStartSignals {
  preferredDecades: Set<string>;
  vibes: string[];
}

function normalizeColdStartSignals(
  options?: ScoreCandidatesOptions
): NormalizedColdStartSignals {
  const preferredDecades = new Set<string>();
  if (Array.isArray(options?.preferredEras)) {
    for (const era of options.preferredEras) {
      const dec = getDecade(era);
      if (dec) {
        preferredDecades.add(dec);
      }
    }
  }

  const vibeSet = new Set<string>();
  if (Array.isArray(options?.selectedVibes)) {
    for (const vibe of options.selectedVibes) {
      if (typeof vibe === 'string' && vibe.trim().length > 0) {
        vibeSet.add(vibe.trim().toLowerCase());
      }
    }
  }

  return { preferredDecades, vibes: [...vibeSet] };
}

function computeColdStartBoost(
  candidate: Candidate,
  signals?: NormalizedColdStartSignals
): number {
  if (!signals || (signals.preferredDecades.size === 0 && signals.vibes.length === 0)) {
    return 0;
  }

  let boost = 0;

  if (signals.preferredDecades.size > 0) {
    const candidateDecade = getDecade(candidate.movie.release_date);
    if (candidateDecade && signals.preferredDecades.has(candidateDecade)) {
      boost += 0.08;
    }
  }

  if (signals.vibes.length > 0) {
    const overview =
      typeof candidate.movie.overview === 'string'
        ? candidate.movie.overview.toLowerCase()
        : '';
    const keywords = getKeywords(candidate.movie);
    let matchedVibes = 0;
    for (const vibe of signals.vibes) {
      if (overview.includes(vibe) || keywords.some((k) => k.includes(vibe))) {
        matchedVibes++;
      }
    }
    if (matchedVibes > 0) {
      boost += Math.min(0.15, matchedVibes * 0.08);
    }
  }

  return boost;
}

/**
 * Computes candidate relevance normalized to 0..1 based on taste profile affinity, quality,
 * and optional cold-start signals (preferredEras and selectedVibes).
 */
function computeCandidateRelevance(
  candidate: Candidate,
  profile: TasteProfile,
  relevanceFloor = DEFAULT_RELEVANCE_FLOOR,
  signals?: NormalizedColdStartSignals
): number {
  const voteAvg = Number.isFinite(candidate.movie.vote_average)
    ? candidate.movie.vote_average
    : 6.0;
  const qualityFactor = Math.max(-0.15, Math.min(0.15, (voteAvg - 6.5) * 0.04));
  const coldStartBoost = computeColdStartBoost(candidate, signals);

  // 1. Empty profile: quality baseline plus cold-start signals
  if (profile.totalRatings === 0) {
    return Math.max(0, Math.min(1, 0.55 + qualityFactor + coldStartBoost));
  }

  // 2. All-negative profile: user has rejected everything they've seen.
  // When mean rating is negative and there are no usual (positively rated) genres,
  // relevance must stay below the floor for all candidates.
  if (profile.meanCenteredRating < -0.3 && profile.usualGenres.size === 0) {
    // Candidates matching disliked genres get penalized even deeper.
    const genres = getGenreNames(candidate.movie);
    let dislikedMatches = 0;
    for (const g of genres) {
      if ((profile.genres.get(g) || 0) < 0) dislikedMatches++;
    }
    const penalty = genres.length > 0 ? (dislikedMatches / genres.length) * 0.2 : 0.1;
    const capped = relevanceFloor - 0.05 - penalty + Math.min(0.03, qualityFactor * 0.3);
    return Math.max(0.05, Math.min(relevanceFloor - 0.01, capped));
  }

  // 3. Normal / sparse / heavy profile
  let genreAff = 0;
  const genres = getGenreNames(candidate.movie);
  if (genres.length > 0) {
    let sum = 0;
    for (const g of genres) {
      sum += profile.genres.get(g) || 0;
    }
    genreAff = sum / genres.length;
  }

  let dirAff = 0;
  const dir = getDirector(candidate.movie);
  if (dir) {
    dirAff = profile.directors.get(dir) || 0;
  }

  let kwAff = 0;
  const keywords = getKeywords(candidate.movie);
  if (keywords.length > 0) {
    let sum = 0;
    for (const k of keywords) {
      sum += profile.keywords.get(k) || 0;
    }
    kwAff = sum / keywords.length;
  }

  let decAff = 0;
  const dec = getDecade(candidate.movie.release_date);
  if (dec) {
    decAff = profile.decades.get(dec) || 0;
  }

  const rawAff = genreAff * 1.0 + dirAff * 1.5 + kwAff * 0.8 + decAff * 0.5;
  const sentimentBias = profile.meanCenteredRating * 0.5;

  const scale = Math.max(1, Math.sqrt(profile.totalRatings) * 1.5);
  const normalizedAff = Math.tanh((rawAff + sentimentBias) / scale);

  const baseRelevance = 0.50 + 0.35 * normalizedAff + qualityFactor + coldStartBoost;
  return Math.max(0, Math.min(1, baseRelevance));
}

/**
 * Assigns a bucket ('safe_bet' | 'stretch' | 'wildcard' | 'below_floor') to a single score set.
 * Enforces the rule that below the relevance floor, a candidate is NEVER a 'safe_bet',
 * 'stretch', or 'wildcard', and instead receives 'below_floor'.
 * For pool-level percentile-relative bucket assignment, use `assignBuckets`.
 */
export function assignBucket(
  scores: CandidateScores,
  relevanceFloor = DEFAULT_RELEVANCE_FLOOR
): Bucket {
  const floor = Number.isFinite(relevanceFloor) ? relevanceFloor : DEFAULT_RELEVANCE_FLOOR;
  if (!Number.isFinite(scores.relevance) || scores.relevance < floor) {
    return 'below_floor';
  }
  if (scores.unexpectedness >= 0.60) {
    return 'wildcard';
  }
  if (scores.serendipity >= 0.35) {
    return 'stretch';
  }
  return 'safe_bet';
}

/**
 * Assigns percentile-relative buckets across a list of candidates:
 * - Below-floor candidates (`relevance < relevanceFloor`) are assigned `'below_floor'`
 *   so weak matches are never labelled `'safe_bet'`.
 * - Wildcard band (top 15%): among above-floor candidates (`N` items), the top
 *   `ceil(0.15 * N)` items ranked by `unexpectedness` (ties broken by `serendipity`,
 *   `novelty`, `relevance`) are assigned `'wildcard'`.
 * - Stretch band (next band, ~35% up to top 50%): among the remaining above-floor
 *   candidates, the next `ceil(0.50 * N) - wildcardCount` items ranked by `serendipity`
 *   (ties broken by `unexpectedness`, `novelty`, `relevance`) are assigned `'stretch'`.
 * - Safe bet band (remaining ~50%): all remaining above-floor candidates are assigned `'safe_bet'`.
 */
export function assignBuckets<T extends { scores: CandidateScores; bucket?: Bucket }>(
  candidates: T[],
  relevanceFloor = DEFAULT_RELEVANCE_FLOOR
): (T & { bucket: Bucket })[] {
  const nTotal = candidates.length;
  if (nTotal === 0) return [];

  const floor = Number.isFinite(relevanceFloor) ? relevanceFloor : DEFAULT_RELEVANCE_FLOOR;
  const buckets = new Array<Bucket>(nTotal).fill('below_floor');
  const aboveIndices: number[] = [];

  for (let i = 0; i < nTotal; i++) {
    if (
      Number.isFinite(candidates[i].scores.relevance) &&
      candidates[i].scores.relevance >= floor
    ) {
      aboveIndices.push(i);
    }
  }

  const nAbove = aboveIndices.length;
  if (nAbove === 1) {
    const idx = aboveIndices[0];
    buckets[idx] = assignBucket(candidates[idx].scores, floor);
  } else if (nAbove >= 2) {
    const wildcardCount = Math.ceil(0.15 * nAbove);
    const stretchCount = Math.max(0, Math.ceil(0.50 * nAbove) - wildcardCount);

    // Top 15% of unexpectedness among above-floor candidates -> 'wildcard'
    const byUnexpectedness = [...aboveIndices].sort((ia, ib) => {
      const a = candidates[ia].scores;
      const b = candidates[ib].scores;
      return (
        b.unexpectedness - a.unexpectedness ||
        b.serendipity - a.serendipity ||
        b.novelty - a.novelty ||
        b.relevance - a.relevance ||
        ia - ib
      );
    });

    const wildcardSet = new Set<number>();
    for (let i = 0; i < wildcardCount && i < byUnexpectedness.length; i++) {
      const idx = byUnexpectedness[i];
      buckets[idx] = 'wildcard';
      wildcardSet.add(idx);
    }

    // Next band (up to top 50% of above-floor candidates) by serendipity -> 'stretch'; rest -> 'safe_bet'
    const remainingAbove = aboveIndices
      .filter((idx) => !wildcardSet.has(idx))
      .sort((ia, ib) => {
        const a = candidates[ia].scores;
        const b = candidates[ib].scores;
        return (
          b.serendipity - a.serendipity ||
          b.unexpectedness - a.unexpectedness ||
          b.novelty - a.novelty ||
          b.relevance - a.relevance ||
          ia - ib
        );
      });

    for (let i = 0; i < remainingAbove.length; i++) {
      const idx = remainingAbove[i];
      buckets[idx] = i < stretchCount ? 'stretch' : 'safe_bet';
    }
  }

  return candidates.map((c, i) => ({
    ...c,
    bucket: buckets[i],
  }));
}

/**
 * Scores candidates for relevance, novelty, unexpectedness and serendipity,
 * and assigns percentile-relative buckets across the candidate pool.
 */
export function scoreCandidates(
  candidates: Candidate[],
  profile: TasteProfile,
  optionsOrFloor: number | ScoreCandidatesOptions = DEFAULT_RELEVANCE_FLOOR
): ScoredCandidate[] {
  const options: ScoreCandidatesOptions =
    typeof optionsOrFloor === 'number'
      ? { relevanceFloor: optionsOrFloor }
      : (optionsOrFloor ?? {});
  const floor =
    typeof options.relevanceFloor === 'number' && Number.isFinite(options.relevanceFloor)
      ? options.relevanceFloor
      : DEFAULT_RELEVANCE_FLOOR;
  const signals = normalizeColdStartSignals(options);

  const noveltyMap = computeNovelties(candidates);

  const prelim = candidates.map((candidate) => {
    const relevance = computeCandidateRelevance(candidate, profile, floor, signals);
    const novelty = noveltyMap.get(candidate.movie.id) ?? 0.5;
    const unexpectedness = computeUnexpectedness(candidate, profile);

    const serendipity =
      relevance < floor
        ? 0
        : Math.max(0, Math.min(1, relevance * (0.5 * novelty + 0.5 * unexpectedness)));

    const scores: CandidateScores = {
      relevance,
      novelty,
      unexpectedness,
      serendipity,
    };

    return {
      ...candidate,
      scores,
    };
  });

  return assignBuckets(prelim, floor);
}

/**
 * Computes bucket mix shares for a serendipity slider level (0..100).
 * Level 30 gives 50/35/15; Level 0 is mostly safe; Level 100 has at most 40% wildcards.
 */
export function mixForSerendipityLevel(level: number): BucketMix {
  const l = Number.isFinite(level) ? Math.max(0, Math.min(100, level)) : 30;
  let safe_bet: number;
  let stretch: number;
  let wildcard: number;

  if (l <= 30) {
    const t = l / 30;
    safe_bet = 0.85 - 0.35 * t;
    stretch = 0.12 + 0.23 * t;
    wildcard = 0.03 + 0.12 * t;
  } else {
    const t = (l - 30) / 70;
    safe_bet = 0.50 - 0.30 * t;
    stretch = 0.35 + 0.05 * t;
    wildcard = 0.15 + 0.25 * t;
  }

  const guardShare = (x: number): number =>
    Number.isFinite(x) ? Math.max(0, x) : 0;

  const gSafe = guardShare(safe_bet);
  const gStretch = guardShare(stretch);
  const gWildcard = guardShare(wildcard);
  const total = gSafe + gStretch + gWildcard;

  return {
    safe_bet: total > 0 ? gSafe / total : 1,
    stretch: total > 0 ? gStretch / total : 0,
    wildcard: total > 0 ? gWildcard / total : 0,
  };
}

/**
 * Computes similarity between two candidates based on director, genre, and keyword overlap.
 */
export function candidateSimilarity(a: Candidate, b: Candidate): number {
  if (a.movie.id === b.movie.id) return 1.0;

  let sim = 0;
  let weightSum = 0;

  // Director overlap (weight 0.4)
  const dirA = getDirector(a.movie);
  const dirB = getDirector(b.movie);
  const dirWeight = 0.4;
  weightSum += dirWeight;
  if (dirA && dirB && dirA === dirB) {
    sim += dirWeight * 1.0;
  }

  // Genre overlap (weight 0.4)
  const genresA = new Set(getGenreNames(a.movie));
  const genresB = new Set(getGenreNames(b.movie));
  const genreWeight = 0.4;
  weightSum += genreWeight;
  if (genresA.size > 0 || genresB.size > 0) {
    let intersection = 0;
    for (const g of genresA) {
      if (genresB.has(g)) intersection++;
    }
    const union = new Set([...genresA, ...genresB]).size;
    if (union > 0) {
      sim += genreWeight * (intersection / union);
    }
  }

  // Keyword overlap (weight 0.2)
  const kwA = new Set(getKeywords(a.movie));
  const kwB = new Set(getKeywords(b.movie));
  const kwWeight = 0.2;
  weightSum += kwWeight;
  if (kwA.size > 0 || kwB.size > 0) {
    let intersection = 0;
    for (const k of kwA) {
      if (kwB.has(k)) intersection++;
    }
    const union = new Set([...kwA, ...kwB]).size;
    if (union > 0) {
      sim += kwWeight * (intersection / union);
    }
  }

  return weightSum > 0 ? Math.max(0, Math.min(1, sim / weightSum)) : 0;
}

/**
 * Ranks candidates within a bucket using Maximal Marginal Relevance (Carbonell and Goldstein 1998).
 * Each pick maximizes lambda * score - (1 - lambda) * max similarity to ALL already-selected items.
 * Ties break on raw score, then on lower movie ID, so the order is deterministic.
 */
export function rankBucketMMR(
  candidates: ScoredCandidate[],
  scoreFn: (c: ScoredCandidate) => number,
  lambda = DEFAULT_MMR_LAMBDA
): ScoredCandidate[] {
  if (candidates.length <= 1) return [...candidates];

  const l = Number.isFinite(lambda) ? Math.max(0, Math.min(1, lambda)) : DEFAULT_MMR_LAMBDA;
  const remaining = [...candidates];
  const selected: ScoredCandidate[] = [];

  while (remaining.length > 0) {
    let bestIdx = -1;
    let bestMmrScore = -Infinity;
    let bestRawScore = -Infinity;
    let bestMovieId = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const rawScore = scoreFn(candidate);

      let maxSim = 0;
      for (const s of selected) {
        const sim = candidateSimilarity(candidate, s);
        if (sim > maxSim) maxSim = sim;
      }

      const mmrScore = l * rawScore - (1 - l) * maxSim;
      const movieId = candidate.movie.id;

      let isBetter: boolean;
      if (bestIdx === -1) {
        isBetter = true;
      } else {
        const diff = mmrScore - bestMmrScore;
        if (Math.abs(diff) > 1e-9) {
          isBetter = diff > 0;
        } else {
          const rawDiff = rawScore - bestRawScore;
          if (Math.abs(rawDiff) > 1e-9) {
            isBetter = rawDiff > 0;
          } else {
            isBetter = movieId < bestMovieId;
          }
        }
      }

      if (isBetter) {
        bestIdx = i;
        bestMmrScore = mmrScore;
        bestRawScore = rawScore;
        bestMovieId = movieId;
      }
    }

    if (bestIdx >= 0) {
      selected.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    } else {
      break;
    }
  }

  return selected;
}

/**
 * Computes wildcard ranking score: unexpectedness weighted with normalized vote_average quality.
 */
function computeWildcardRankScore(candidate: ScoredCandidate): number {
  const unexpectedness = Number.isFinite(candidate.scores.unexpectedness)
    ? Math.max(0, Math.min(1, candidate.scores.unexpectedness))
    : 0;
  const voteAvg = Number.isFinite(candidate.movie.vote_average)
    ? candidate.movie.vote_average
    : 6.0;
  const quality = Math.max(0, Math.min(1, voteAvg / 10));
  return 0.6 * unexpectedness + 0.4 * quality;
}

/**
 * Builds a ranked recommendation list combining safe bets, stretches and wildcards.
 * Interleaves buckets so the top 5 contain at least 3 safe bets and 1 stretch when available,
 * fills deficits from subsequent buckets, drops below-floor items when above-floor supply suffices
 * (or places them last as 'below_floor' when supply runs short), and assigns final ranks.
 */
export function buildRankedList(
  scored: ScoredCandidate[],
  mix: BucketMix,
  size: number,
  lambda = DEFAULT_MMR_LAMBDA
): RankedCandidate[] {
  if (size <= 0 || !scored || scored.length === 0) {
    return [];
  }

  // Guard mix shares: Number.isFinite(x) ? Math.max(0, x) : 0, then renormalize
  const guardShare = (x: number | undefined): number =>
    typeof x === 'number' && Number.isFinite(x) ? Math.max(0, x) : 0;

  const rawSafe = guardShare(mix?.safe_bet);
  const rawStretch = guardShare(mix?.stretch);
  const rawWildcard = guardShare(mix?.wildcard);
  const mixTotal = rawSafe + rawStretch + rawWildcard;

  const normalizedMix: BucketMix =
    mixTotal > 0
      ? {
          safe_bet: rawSafe / mixTotal,
          stretch: rawStretch / mixTotal,
          wildcard: rawWildcard / mixTotal,
        }
      : {
          safe_bet: 1,
          stretch: 0,
          wildcard: 0,
        };

  // 1. Deduplicate input candidates by movie.id
  const seenIds = new Set<number>();
  const deduplicated: ScoredCandidate[] = [];
  for (const c of scored) {
    if (!seenIds.has(c.movie.id)) {
      seenIds.add(c.movie.id);
      deduplicated.push(c);
    }
  }

  const overallTarget = Math.min(size, deduplicated.length);
  if (overallTarget <= 0) return [];

  // Separate above-floor candidates from below-floor candidates.
  // Below-floor films are never 'safe_bet'; they are dropped when above-floor supply is enough,
  // or placed at the tail when above-floor supply runs short.
  const aboveFloorCandidates: ScoredCandidate[] = [];
  const belowFloorCandidates: ScoredCandidate[] = [];

  const isBelowFloor = (c: ScoredCandidate): boolean => {
    if (!Number.isFinite(c.scores.relevance) || c.scores.relevance <= 0) return true;
    if (c.bucket === 'below_floor') return true;
    if (!c.bucket) return c.scores.relevance < DEFAULT_RELEVANCE_FLOOR;
    if (
      c.scores.relevance < DEFAULT_RELEVANCE_FLOOR &&
      c.scores.serendipity === 0 &&
      (c.scores.novelty > 0 || c.scores.unexpectedness > 0)
    ) {
      return true;
    }
    return false;
  };

  for (const c of deduplicated) {
    if (isBelowFloor(c)) {
      belowFloorCandidates.push({
        ...c,
        bucket: 'below_floor',
      });
    } else {
      aboveFloorCandidates.push(c);
    }
  }

  const targetTotal = Math.min(overallTarget, aboveFloorCandidates.length);
  const interleaved: ScoredCandidate[] = [];

  if (targetTotal > 0) {
    // 2. Compute target counts per bucket using Largest Remainder Method
    const buckets: AboveFloorBucket[] = ['safe_bet', 'stretch', 'wildcard'];
    const rawCounts = buckets.map((b) => ({
      bucket: b,
      exact: targetTotal * (normalizedMix[b] ?? 0),
      floor: Math.floor(targetTotal * (normalizedMix[b] ?? 0)),
    }));

    const allocated = rawCounts.reduce((acc, curr) => acc + curr.floor, 0);
    let remainder = targetTotal - allocated;

    const remainders = rawCounts
      .map((r, idx) => ({
        ...r,
        fraction: r.exact - r.floor,
        priority: idx,
      }))
      .sort((a, b) => {
        const diff = b.fraction - a.fraction;
        if (Math.abs(diff) > 1e-9) return diff;
        return a.priority - b.priority;
      });

    const targetCount: Record<AboveFloorBucket, number> = {
      safe_bet: 0,
      stretch: 0,
      wildcard: 0,
    };

    for (const r of remainders) {
      let count = r.floor;
      if (remainder > 0) {
        count++;
        remainder--;
      }
      targetCount[r.bucket] = count;
    }

    // 3. Partition above-floor candidates into buckets
    const bucketCandidates: Record<AboveFloorBucket, ScoredCandidate[]> = {
      safe_bet: [],
      stretch: [],
      wildcard: [],
    };

    for (const c of aboveFloorCandidates) {
      const assigned = c.bucket || assignBucket(c.scores);
      const b: AboveFloorBucket =
        assigned === 'wildcard' || assigned === 'stretch' ? assigned : 'safe_bet';
      bucketCandidates[b].push({ ...c, bucket: b });
    }

    // 4. Rank each bucket using MMR (wildcards ranked by unexpectedness weighted with vote_average)
    const rankedBuckets: Record<AboveFloorBucket, ScoredCandidate[]> = {
      safe_bet: rankBucketMMR(bucketCandidates.safe_bet, (c) => c.scores.relevance, lambda),
      stretch: rankBucketMMR(bucketCandidates.stretch, (c) => c.scores.serendipity, lambda),
      wildcard: rankBucketMMR(bucketCandidates.wildcard, computeWildcardRankScore, lambda),
    };

    // 5. Select items per bucket, filling from the next bucket when a bucket runs short
    const fallbackOrder: Record<AboveFloorBucket, AboveFloorBucket[]> = {
      safe_bet: ['stretch', 'wildcard'],
      stretch: ['safe_bet', 'wildcard'],
      wildcard: ['stretch', 'safe_bet'],
    };

    const selectedBuckets: Record<AboveFloorBucket, ScoredCandidate[]> = {
      safe_bet: [],
      stretch: [],
      wildcard: [],
    };

    const deficits: Record<AboveFloorBucket, number> = {
      safe_bet: 0,
      stretch: 0,
      wildcard: 0,
    };

    for (const b of buckets) {
      const available = rankedBuckets[b];
      const needed = targetCount[b];
      const takeCount = Math.min(available.length, needed);
      selectedBuckets[b] = available.slice(0, takeCount);
      deficits[b] = needed - takeCount;
    }

    const unconsumed: Record<AboveFloorBucket, ScoredCandidate[]> = {
      safe_bet: rankedBuckets.safe_bet.slice(selectedBuckets.safe_bet.length),
      stretch: rankedBuckets.stretch.slice(selectedBuckets.stretch.length),
      wildcard: rankedBuckets.wildcard.slice(selectedBuckets.wildcard.length),
    };

    for (const b of buckets) {
      let deficit = deficits[b];
      if (deficit <= 0) continue;

      for (const nextB of fallbackOrder[b]) {
        if (deficit <= 0) break;
        const pool = unconsumed[nextB];
        const takeCount = Math.min(pool.length, deficit);
        if (takeCount > 0) {
          selectedBuckets[nextB].push(...pool.slice(0, takeCount));
          unconsumed[nextB] = pool.slice(takeCount);
          deficit -= takeCount;
        }
      }
    }

    let currentTotal =
      selectedBuckets.safe_bet.length +
      selectedBuckets.stretch.length +
      selectedBuckets.wildcard.length;

    if (currentTotal < targetTotal) {
      for (const b of buckets) {
        if (currentTotal >= targetTotal) break;
        const pool = unconsumed[b];
        const takeCount = Math.min(pool.length, targetTotal - currentTotal);
        if (takeCount > 0) {
          selectedBuckets[b].push(...pool.slice(0, takeCount));
          unconsumed[b] = pool.slice(takeCount);
          currentTotal += takeCount;
        }
      }
    }

    // 5b. Enforce the top-5 rule:
    // After allocation, the first min(5, n) slots must contain min(3, safe supply) safe bets
    // and min(1, stretch supply) stretches.
    // Promote from unconsumed safe/stretch candidates and drop the lowest-ranked item of the largest other bucket.
    const safeSupply = bucketCandidates.safe_bet.length;
    const stretchSupply = bucketCandidates.stretch.length;
    const topLimit = Math.min(5, targetTotal);

    const targetStretch =
      normalizedMix.stretch > 0 ? Math.min(1, stretchSupply, topLimit) : 0;
    const targetSafe =
      normalizedMix.safe_bet > 0
        ? Math.min(3, safeSupply, Math.max(0, topLimit - targetStretch))
        : 0;

    const promoteAndDrop = (targetBucket: AboveFloorBucket, requiredCount: number) => {
      while (
        selectedBuckets[targetBucket].length < requiredCount &&
        unconsumed[targetBucket].length > 0
      ) {
        const otherBuckets = buckets.filter(
          (b) => b !== targetBucket && selectedBuckets[b].length > 0
        );
        if (otherBuckets.length === 0) break;

        const requiredMins: Record<AboveFloorBucket, number> = {
          safe_bet: targetSafe,
          stretch: targetStretch,
          wildcard: 0,
        };

        const aboveMin = otherBuckets.filter(
          (b) => selectedBuckets[b].length > requiredMins[b]
        );
        const eligible = aboveMin.length > 0 ? aboveMin : otherBuckets;

        const tiePriority: Record<AboveFloorBucket, number> = {
          wildcard: 3,
          stretch: 2,
          safe_bet: 1,
        };

        eligible.sort((a, b) => {
          const countDiff = selectedBuckets[b].length - selectedBuckets[a].length;
          if (countDiff !== 0) return countDiff;
          return tiePriority[b] - tiePriority[a];
        });

        const donorBucket = eligible[0];
        const dropped = selectedBuckets[donorBucket].pop()!;
        unconsumed[donorBucket].unshift(dropped);

        const promoted = unconsumed[targetBucket].shift()!;
        selectedBuckets[targetBucket].push(promoted);
      }
    };

    promoteAndDrop('safe_bet', targetSafe);
    promoteAndDrop('stretch', targetStretch);

    // 6. Interleave buckets so that:
    // - The top 5 contain at least 3 safe bets and 1 stretch when available
    // - Remaining items are interleaved smoothly
    const queues: Record<AboveFloorBucket, ScoredCandidate[]> = {
      safe_bet: [...selectedBuckets.safe_bet],
      stretch: [...selectedBuckets.stretch],
      wildcard: [...selectedBuckets.wildcard],
    };

    const pick = (preferred: AboveFloorBucket): ScoredCandidate | null => {
      if (queues[preferred].length > 0) {
        return queues[preferred].shift()!;
      }
      const remainingBuckets = buckets
        .filter((b) => queues[b].length > 0)
        .sort((a, b) => queues[b].length - queues[a].length);
      if (remainingBuckets.length > 0) {
        return queues[remainingBuckets[0]].shift()!;
      }
      return null;
    };

    const top5Pattern: AboveFloorBucket[] = [
      'safe_bet',
      'safe_bet',
      'stretch',
      'safe_bet',
      'wildcard',
    ];
    for (let i = 0; i < topLimit; i++) {
      const item = pick(top5Pattern[i]);
      if (item) interleaved.push(item);
    }

    while (interleaved.length < targetTotal) {
      const remainingBuckets = buckets
        .filter((b) => queues[b].length > 0)
        .sort((a, b) => {
          const countDiff = queues[b].length - queues[a].length;
          if (countDiff !== 0) return countDiff;
          return buckets.indexOf(a) - buckets.indexOf(b);
        });

      if (remainingBuckets.length === 0) break;
      const item = queues[remainingBuckets[0]].shift()!;
      interleaved.push(item);
    }
  }

  // 6b. When above-floor supply runs short, fill the tail with below-floor candidates last.
  if (interleaved.length < overallTarget && belowFloorCandidates.length > 0) {
    const rankedBelow = rankBucketMMR(
      belowFloorCandidates,
      (c) => c.scores.relevance,
      lambda
    );
    const neededBelow = overallTarget - interleaved.length;
    interleaved.push(...rankedBelow.slice(0, neededBelow));
  }

  // 7. Assign final ranks (1..n)
  return interleaved.map((c, index) => ({
    ...c,
    rank: index + 1,
  }));
}
