import type { Movie, Recommendation } from '../../types';
import type { Bucket, Candidate } from './types';
import { candidateSimilarity } from './scoring';

export type BucketShares = Record<Bucket, number>;

function toSimilarityCandidate(item: {
  movie: Movie;
  sources?: Recommendation['sources'];
}): Candidate {
  return {
    movie: item.movie,
    sources: Array.isArray(item.sources) ? item.sources : [],
    seedNeighbour: Boolean(item.movie.seedNeighbour),
  };
}

function finiteVoteCount(movie: Movie): number {
  return typeof movie.vote_count === 'number' && Number.isFinite(movie.vote_count)
    ? movie.vote_count
    : 0;
}

/**
 * Computes per-movie inverse vote-count midpoint percentiles within `pool` (0..1),
 * matching the novelty formulation in `scoring.ts`.
 */
function computePoolNoveltyLookup(pool: readonly Candidate[]): {
  byId: Map<number, number>;
  poolVotes: number[];
} {
  const byId = new Map<number, number>();
  const n = pool.length;
  if (n === 0) {
    return { byId, poolVotes: [] };
  }

  const poolVotes = pool.map((c) => finiteVoteCount(c.movie));
  if (n === 1) {
    byId.set(pool[0].movie.id, 0.5);
    return { byId, poolVotes };
  }

  const minVotes = Math.min(...poolVotes);
  const maxVotes = Math.max(...poolVotes);
  if (minVotes === maxVotes) {
    for (const c of pool) {
      byId.set(c.movie.id, 0.5);
    }
    return { byId, poolVotes };
  }

  const pMin = 0.5 / n;
  const pMax = (n - 0.5) / n;

  for (let i = 0; i < n; i++) {
    const v = poolVotes[i];
    let countLess = 0;
    let countEqual = 0;
    for (let j = 0; j < n; j++) {
      if (poolVotes[j] < v) countLess++;
      else if (poolVotes[j] === v) countEqual++;
    }
    const midpointPercentile = (countLess + 0.5 * countEqual) / n;
    const popularityPct = pMax > pMin ? (midpointPercentile - pMin) / (pMax - pMin) : 0.5;
    const novelty = Math.max(0, Math.min(1, 1 - popularityPct));
    byId.set(pool[i].movie.id, novelty);
  }

  return { byId, poolVotes };
}

function noveltyAgainstPool(voteCount: number, poolVotes: readonly number[]): number {
  const n = poolVotes.length;
  if (n === 0) return 0;
  if (n === 1) return 0.5;

  const minVotes = Math.min(...poolVotes);
  const maxVotes = Math.max(...poolVotes);
  if (minVotes === maxVotes) return 0.5;

  let countLess = 0;
  let countEqual = 0;
  for (let j = 0; j < n; j++) {
    if (poolVotes[j] < voteCount) countLess++;
    else if (poolVotes[j] === voteCount) countEqual++;
  }
  // If the item is outside the pool and strictly above/below all pool items, clamp via pMin..pMax.
  const midpointPercentile = (countLess + 0.5 * countEqual) / n;
  const pMin = 0.5 / n;
  const pMax = (n - 0.5) / n;
  const popularityPct = pMax > pMin ? (midpointPercentile - pMin) / (pMax - pMin) : 0.5;
  return Math.max(0, Math.min(1, 1 - popularityPct));
}

/**
 * Number of returned recommendations.
 */
export function supply(recommendations: readonly Recommendation[]): number {
  if (!Array.isArray(recommendations)) return 0;
  return recommendations.length;
}

/**
 * Mean pairwise `1 - candidateSimilarity(a, b)` across all unordered pairs in the list.
 * Returns 0 when fewer than 2 recommendations are present.
 */
export function intraListDiversity(recommendations: readonly Recommendation[]): number {
  if (!Array.isArray(recommendations) || recommendations.length < 2) {
    return 0;
  }

  const candidates = recommendations.map(toSimilarityCandidate);
  const n = candidates.length;
  let sum = 0;
  let pairs = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sum += 1 - candidateSimilarity(candidates[i], candidates[j]);
      pairs++;
    }
  }

  return pairs > 0 ? sum / pairs : 0;
}

/**
 * Mean inverse vote-count percentile of `recommendations` relative to `pool` (0 = most voted, 1 = least voted).
 */
export function meanNoveltyPercentile(
  recommendations: readonly Recommendation[],
  pool: readonly Candidate[]
): number {
  if (!Array.isArray(recommendations) || recommendations.length === 0) return 0;
  if (!Array.isArray(pool) || pool.length === 0) return 0;

  const { byId, poolVotes } = computePoolNoveltyLookup(pool);
  let sum = 0;

  for (const rec of recommendations) {
    const cached = byId.get(rec.movie.id);
    if (cached !== undefined) {
      sum += cached;
    } else {
      sum += noveltyAgainstPool(finiteVoteCount(rec.movie), poolVotes);
    }
  }

  return sum / recommendations.length;
}

/**
 * Share (0..1) of recommendations in each bucket (`safe_bet`, `stretch`, `wildcard`, `below_floor`).
 */
export function bucketMix(recommendations: readonly Recommendation[]): BucketShares {
  const shares: BucketShares = {
    safe_bet: 0,
    stretch: 0,
    wildcard: 0,
    below_floor: 0,
  };

  if (!Array.isArray(recommendations as unknown) || recommendations.length === 0) {
    return shares;
  }

  const counts: BucketShares = {
    safe_bet: 0,
    stretch: 0,
    wildcard: 0,
    below_floor: 0,
  };

  for (const rec of recommendations) {
    if (
      rec.bucket === 'safe_bet' ||
      rec.bucket === 'stretch' ||
      rec.bucket === 'wildcard' ||
      rec.bucket === 'below_floor'
    ) {
      counts[rec.bucket]++;
    }
  }

  const n = recommendations.length;
  return {
    safe_bet: counts.safe_bet / n,
    stretch: counts.stretch / n,
    wildcard: counts.wildcard / n,
    below_floor: counts.below_floor / n,
  };
}

/**
 * Share (0..1) of recommendations that are NOT direct seed-graph neighbours.
 * Uses `pool` to resolve authoritative `Candidate.seedNeighbour` flags when supplied,
 * falling back to `movie.seedNeighbour` or `sources.includes('seed_graph')`.
 */
export function nonSeedNeighbourShare(
  recommendations: readonly Recommendation[],
  pool?: readonly Candidate[]
): number {
  if (!Array.isArray(recommendations as unknown) || recommendations.length === 0) {
    return 0;
  }

  const poolMap = new Map<number, Candidate>();
  if (Array.isArray(pool)) {
    for (const c of pool) {
      if (!poolMap.has(c.movie.id)) {
        poolMap.set(c.movie.id, c);
      }
    }
  }

  let nonSeedCount = 0;
  for (const rec of recommendations) {
    const poolEntry = poolMap.get(rec.movie.id);
    let isSeedNeighbour: boolean;
    if (poolEntry !== undefined) {
      isSeedNeighbour = Boolean(poolEntry.seedNeighbour);
    } else if (typeof rec.movie.seedNeighbour === 'boolean') {
      isSeedNeighbour = rec.movie.seedNeighbour;
    } else {
      isSeedNeighbour = Array.isArray(rec.sources) && rec.sources.includes('seed_graph');
    }
    if (!isSeedNeighbour) {
      nonSeedCount++;
    }
  }

  return nonSeedCount / recommendations.length;
}

/**
 * Share (0..1) of the top `topN` recommendations that fall in the top `headPercentile`
 * (e.g. `0.20` for top 20%) most-voted films in `pool`.
 */
export function popularityHeadShare(
  recommendations: readonly Recommendation[],
  pool: readonly Candidate[],
  topN = 10,
  headPercentile = 0.2
): number {
  if (!Array.isArray(recommendations) || recommendations.length === 0) return 0;
  if (!Array.isArray(pool) || pool.length === 0) return 0;
  if (!Number.isFinite(topN) || topN <= 0) return 0;
  if (!Number.isFinite(headPercentile) || headPercentile <= 0) return 0;

  const slice = recommendations.slice(0, Math.floor(topN));
  if (slice.length === 0) return 0;

  if (headPercentile >= 1) {
    return 1;
  }

  const sortedVotes = pool.map((c) => finiteVoteCount(c.movie)).sort((a, b) => b - a);
  const headCount = Math.max(1, Math.ceil(sortedVotes.length * headPercentile));
  const cutoff = sortedVotes[Math.min(sortedVotes.length - 1, headCount - 1)];

  let headMatches = 0;
  for (const rec of slice) {
    if (finiteVoteCount(rec.movie) >= cutoff) {
      headMatches++;
    }
  }

  return headMatches / slice.length;
}
