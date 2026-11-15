import type { Movie } from '../../types';
import type { Candidate } from './types';

/**
 * Copies candidate pipeline metadata (`sources` and `seedNeighbour`) onto `Movie` objects
 * so source annotations survive `Movie[]` boundaries without breaking existing consumers.
 */
export function annotateCandidateMovies(candidates: Candidate[]): Movie[] {
  return candidates.map((c) => ({
    ...c.movie,
    candidateSources: Array.isArray(c.sources) ? [...c.sources] : [],
    seedNeighbour: Boolean(c.seedNeighbour),
  }));
}

/**
 * Reconstructs `Candidate[]` from `Movie[]`, defaulting missing annotations to `[]` and `false`.
 */
export function toCandidates(movies: Movie[]): Candidate[] {
  return movies.map((movie) => ({
    movie,
    sources: Array.isArray(movie.candidateSources) ? [...movie.candidateSources] : [],
    seedNeighbour: Boolean(movie.seedNeighbour),
  }));
}
