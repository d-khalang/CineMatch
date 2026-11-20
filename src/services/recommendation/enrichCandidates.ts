import type { Movie } from '../../types';
import type { Candidate } from './types';
import { BoundedLRUMap, fetchFromTMDB } from '../tmdbClient';

export const DEFAULT_ENRICH_LIMIT = 40;
export const DEFAULT_ENRICH_CONCURRENCY = 6;
export const DEFAULT_ENRICH_DEADLINE_MS = 6000;
export const ENRICH_CACHE_MAX_ENTRIES = 300;
export const MAX_KEYWORDS_PER_MOVIE = 20;

export interface EnrichCandidatesOptions {
  limit?: number;
  concurrency?: number;
  deadlineMs?: number;
}

interface CachedEnrichment {
  director?: string;
  keywords: string[];
}

const enrichmentCache = new BoundedLRUMap<number, CachedEnrichment>(ENRICH_CACHE_MAX_ENTRIES);

/**
 * Clears the session-scoped candidate enrichment cache (for tests or session resets).
 */
export function clearEnrichmentCache(): void {
  enrichmentCache.clear();
}

function hasDirector(movie: Movie): boolean {
  return typeof movie.director === 'string' && movie.director.trim().length > 0;
}

function extractEnrichment(data: any): CachedEnrichment {
  const crew: unknown[] = Array.isArray(data?.credits?.crew) ? data.credits.crew : [];
  let director: string | undefined;
  for (const member of crew) {
    if (
      member &&
      typeof member === 'object' &&
      (member as { job?: unknown }).job === 'Director' &&
      typeof (member as { name?: unknown }).name === 'string'
    ) {
      const name = (member as { name: string }).name.trim();
      if (name.length > 0) {
        director = name;
        break;
      }
    }
  }

  const rawKeywords: unknown[] = Array.isArray(data?.keywords?.keywords)
    ? data.keywords.keywords
    : [];
  const seenKeywords = new Set<string>();
  const keywords: string[] = [];
  for (const entry of rawKeywords) {
    if (keywords.length >= MAX_KEYWORDS_PER_MOVIE) {
      break;
    }
    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { name?: unknown }).name === 'string'
    ) {
      const name = (entry as { name: string }).name.trim();
      if (name.length > 0) {
        const lower = name.toLowerCase();
        if (!seenKeywords.has(lower)) {
          seenKeywords.add(lower);
          keywords.push(name);
        }
      }
    }
  }

  return { director, keywords };
}

function applyEnrichment(candidate: Candidate, enrichment: CachedEnrichment): Candidate {
  return {
    ...candidate,
    movie: {
      ...candidate.movie,
      ...(enrichment.director !== undefined ? { director: enrichment.director } : {}),
      keywords: [...enrichment.keywords],
    },
  };
}

/**
 * Enriches up to the first `limit` (default 40) shortlist candidates that lack a director
 * by fetching `/movie/{id}?append_to_response=credits,keywords` via `fetchFromTMDB`.
 *
 * - Candidates outside the shortlist (`index >= limit`) stay genre-only.
 * - Preserves candidate order and total count; never drops or throws on per-film failures.
 * - Bounded by `concurrency` (default 6), `limit` (default 40), `deadlineMs` (default 6000),
 *   and a session LRU cache of 300 entries (failures are not cached).
 * - Aborting `signal` or hitting `deadlineMs` stops pending work and returns the full list
 *   with whatever was enriched so far.
 */
export async function enrichCandidates(
  candidates: Candidate[],
  options: EnrichCandidatesOptions = {},
  signal?: AbortSignal
): Promise<Candidate[]> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [];
  }

  const limit =
    typeof options?.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(0, Math.floor(options.limit))
      : DEFAULT_ENRICH_LIMIT;
  const concurrency =
    typeof options?.concurrency === 'number' && Number.isFinite(options.concurrency)
      ? Math.max(1, Math.floor(options.concurrency))
      : DEFAULT_ENRICH_CONCURRENCY;
  const deadlineMs =
    typeof options?.deadlineMs === 'number' && Number.isFinite(options.deadlineMs)
      ? options.deadlineMs
      : DEFAULT_ENRICH_DEADLINE_MS;

  if (limit <= 0 || deadlineMs <= 0 || signal?.aborted) {
    return [...candidates];
  }

  const result = [...candidates];
  const shortlistEnd = Math.min(candidates.length, limit);
  const fetchIndexByMovieId = new Map<number, number[]>();
  const toFetch: Array<{ movieId: number; indices: number[] }> = [];

  for (let i = 0; i < shortlistEnd; i++) {
    const candidate = result[i];
    const movie = candidate?.movie;
    if (!movie || typeof movie.id !== 'number' || !Number.isFinite(movie.id) || movie.id <= 0) {
      continue;
    }
    if (hasDirector(movie)) {
      continue;
    }

    const cached = enrichmentCache.get(movie.id);
    if (cached !== undefined) {
      result[i] = applyEnrichment(candidate, cached);
      continue;
    }

    const existingIndices = fetchIndexByMovieId.get(movie.id);
    if (existingIndices) {
      existingIndices.push(i);
    } else {
      const indices = [i];
      fetchIndexByMovieId.set(movie.id, indices);
      toFetch.push({ movieId: movie.id, indices });
    }
  }

  if (toFetch.length === 0) {
    return result;
  }

  const internalController = new AbortController();
  const internalSignal = internalController.signal;
  let settled = false;

  const safeTimeoutMs = Math.min(deadlineMs, 2_147_483_647);
  const timeoutId = setTimeout(() => {
    internalController.abort(new DOMException('Enrichment deadline expired', 'AbortError'));
  }, safeTimeoutMs);

  const onCallerAbort = () => {
    internalController.abort(
      signal?.reason || new DOMException('The operation was aborted', 'AbortError')
    );
  };

  if (signal) {
    signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const abortedPromise = new Promise<void>((resolve) => {
    if (internalSignal.aborted) {
      resolve();
    } else {
      internalSignal.addEventListener('abort', () => resolve(), { once: true });
    }
  });

  let nextIndex = 0;
  const workerCount = Math.min(concurrency, toFetch.length);

  const runWorker = async (): Promise<void> => {
    while (!internalSignal.aborted) {
      const idx = nextIndex++;
      if (idx >= toFetch.length) {
        break;
      }

      const { movieId, indices } = toFetch[idx];
      const cached = enrichmentCache.get(movieId);
      if (cached !== undefined) {
        if (!settled) {
          for (const candIdx of indices) {
            result[candIdx] = applyEnrichment(result[candIdx], cached);
          }
        }
        continue;
      }

      try {
        const data = await fetchFromTMDB<any>(
          `/movie/${movieId}`,
          { append_to_response: 'credits,keywords' },
          internalSignal
        );
        if (data && typeof data === 'object') {
          const enrichment = extractEnrichment(data);
          enrichmentCache.set(movieId, enrichment);
          if (!settled) {
            for (const candIdx of indices) {
              result[candIdx] = applyEnrichment(result[candIdx], enrichment);
            }
          }
        }
      } catch {
        // Failed, timed-out, or aborted request: leave candidate unchanged and do not cache.
      }
    }
  };

  try {
    const workersPromise = Promise.all(
      Array.from({ length: workerCount }, () => runWorker())
    );
    workersPromise.catch(() => {});
    await Promise.race([workersPromise, abortedPromise]);
  } finally {
    settled = true;
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onCallerAbort);
    }
    internalController.abort();
  }

  return result;
}
