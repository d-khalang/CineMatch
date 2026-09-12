import { Movie, Recommendation } from '../../types';
import { AIRecommendationResult, UnconstrainedDiscovery } from './types';

const VALID_SERENDIPITY_TYPES = new Set<Recommendation['serendipityType']>([
  'safe_bet',
  'thematic_gem',
  'director_match',
  'wildcard_discovery',
  'ai_cinephile_discovery',
]);

export function sanitizeString(val: unknown, fallback: string, maxLength = 500): string {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.length > 0) {
      return trimmed.slice(0, maxLength);
    }
  } else if (val && typeof val === 'object') {
    // If an object was passed by LLM, extract first non-empty string property
    const obj = val as Record<string, unknown>;
    for (const key of ['text', 'message', 'reason', 'description', 'summary', 'content', 'value']) {
      if (typeof obj[key] === 'string' && (obj[key] as string).trim().length > 0) {
        return (obj[key] as string).trim().slice(0, maxLength);
      }
    }
    for (const v of Object.values(obj)) {
      if (typeof v === 'string' && v.trim().length > 0) {
        return v.trim().slice(0, maxLength);
      }
    }
  }
  return fallback;
}

export function sanitizeTags(
  tags: unknown,
  fallback: string[] = ['Top Pick'],
  maxTags = 5,
  maxTagLength = 35
): string[] {
  if (Array.isArray(tags)) {
    const validTags: string[] = [];
    for (const item of tags) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length > 0) {
          validTags.push(trimmed.slice(0, maxTagLength));
        }
      } else if (typeof item === 'number' && !isNaN(item)) {
        validTags.push(String(item));
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        for (const k of ['name', 'tag', 'label', 'text', 'value']) {
          if (typeof obj[k] === 'string' && (obj[k] as string).trim().length > 0) {
            validTags.push((obj[k] as string).trim().slice(0, maxTagLength));
            break;
          }
        }
      }
      if (validTags.length >= maxTags) break;
    }
    if (validTags.length > 0) return validTags;
  }
  return fallback;
}

export function sanitizeScore(val: unknown, defaultScore = 85): number {
  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) return defaultScore;
  return Math.min(99, Math.max(45, Math.round(num)));
}

export function sanitizeSerendipityType(val: unknown, fallback: Recommendation['serendipityType'] = 'thematic_gem'): Recommendation['serendipityType'] {
  if (typeof val === 'string' && VALID_SERENDIPITY_TYPES.has(val as Recommendation['serendipityType'])) {
    return val as Recommendation['serendipityType'];
  }
  return fallback;
}

/**
 * Validates, deduplicates, and sanitizes complete AI response payloads.
 * Protects React rendering against unexpected object children, duplicate keys,
 * or unbounded arrays.
 */
export function validateAndSanitizeAIResponse(
  parsed: any,
  candidateMap: Map<number, Movie>
): AIRecommendationResult {
  const poolRecommendations: Recommendation[] = [];
  const seenMovieIds = new Set<number>();
  const rawPoolItems = Array.isArray(parsed?.pool_rankings)
    ? parsed.pool_rankings
    : Array.isArray(parsed?.rankings)
    ? parsed.rankings
    : Array.isArray(parsed?.recommendations)
    ? parsed.recommendations
    : [];

  // 1. Sanitize candidate pool rankings
  for (const item of rawPoolItems) {
    if (!item || typeof item !== 'object') continue;

    const rawId = item.id ?? item.movieId ?? item.movie_id;
    const movieId = Number(rawId);
    if (isNaN(movieId) || seenMovieIds.has(movieId)) continue;

    const movie = candidateMap.get(movieId);
    if (movie) {
      seenMovieIds.add(movie.id);
      poolRecommendations.push({
        movie,
        score: sanitizeScore(item.score, 85),
        rank: poolRecommendations.length + 1,
        reason: sanitizeString(
          item.reason,
          'Curated specifically based on your unique cinematic profile.',
          500
        ),
        serendipityType: sanitizeSerendipityType(
          item.serendipityType ?? item.serendipity_type,
          'safe_bet'
        ),
        highlightTags: sanitizeTags(item.highlightTags ?? item.highlight_tags, ['Top Pick']),
        isAiCurated: true,
      });

      if (poolRecommendations.length >= 30) break; // Bounded count
    }
  }

  // 2. Sanitize unconstrained discoveries
  const unconstrainedDiscoveries: UnconstrainedDiscovery[] = [];
  const seenDiscoveries = new Set<string>();
  const rawDiscoveries = Array.isArray(parsed?.unconstrained_discoveries)
    ? parsed.unconstrained_discoveries
    : Array.isArray(parsed?.discoveries)
    ? parsed.discoveries
    : [];

  for (const item of rawDiscoveries) {
    if (!item || typeof item !== 'object') continue;

    const title = sanitizeString(item.title, '', 150);
    if (!title) continue;

    const year = typeof item.year === 'string' && item.year.trim().length > 0
      ? item.year.trim().slice(0, 10)
      : typeof item.year === 'number'
      ? String(item.year)
      : undefined;

    const dedupKey = `${title.toLowerCase()}::${year || ''}`;
    if (seenDiscoveries.has(dedupKey)) continue;
    seenDiscoveries.add(dedupKey);

    unconstrainedDiscoveries.push({
      title,
      year,
      score: sanitizeScore(item.score, 90),
      reason: sanitizeString(
        item.reason,
        'A cross-genre cinephile discovery matching your psychological and structural taste DNA.',
        500
      ),
      highlightTags: sanitizeTags(
        item.highlightTags ?? item.highlight_tags,
        ['AI Discovery', 'Cross-Genre']
      ),
    });

    if (unconstrainedDiscoveries.length >= 10) break; // Bounded count
  }

  // 3. Sanitize taste analysis (must be string or undefined)
  let tasteAnalysis: string | undefined;
  if (typeof parsed?.taste_analysis === 'string') {
    const trimmed = parsed.taste_analysis.trim();
    if (trimmed.length > 0) {
      tasteAnalysis = trimmed.slice(0, 1000);
    }
  } else if (parsed?.taste_analysis && typeof parsed.taste_analysis === 'object') {
    tasteAnalysis = sanitizeString(parsed.taste_analysis, '', 1000) || undefined;
  }

  return {
    recommendations: poolRecommendations,
    unconstrainedDiscoveries,
    tasteAnalysis,
  };
}
