import type { Movie } from '../../types';

// Shared contract for the recommendation pipeline in docs/recommendation-framework.md.

export type CandidateSource =
  | 'seed_graph'
  | 'creator_graph'
  | 'keyword_affinity'
  | 'hidden_gem'
  | 'bridge'
  | 'acclaimed_baseline'
  | 'era'
  | 'vibe';

export interface Candidate {
  movie: Movie;
  /** Every source that produced this film, deduplicated. */
  sources: CandidateSource[];
  /** True when the film came from /recommendations or /similar of a rated seed film. */
  seedNeighbour: boolean;
}

export type AboveFloorBucket = 'safe_bet' | 'stretch' | 'wildcard';

export type Bucket = AboveFloorBucket | 'below_floor';

/** All scores are normalized to 0..1. */
export interface CandidateScores {
  relevance: number;
  novelty: number;
  unexpectedness: number;
  serendipity: number;
}

export interface ScoredCandidate extends Candidate {
  scores: CandidateScores;
  bucket: Bucket;
}

/** Share of the list per bucket; values sum to 1. */
export type BucketMix = Record<AboveFloorBucket, number>;

/** Pagination state for one source query, used by "load more". */
export interface SourceCursor {
  source: CandidateSource;
  /** Stable identifier of the query, for example a seed movie ID or a discover filter. */
  key: string;
  nextPage: number;
  exhausted: boolean;
}
