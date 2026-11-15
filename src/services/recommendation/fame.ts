export const FAME_PENALTY_MAX = 12;

const MIN_VOTE_COUNT = 1000;
const FULL_FAME_LOG_RATIO = Math.log10(30); // Full fame at 30,000 votes (30x of 1,000)
const MIN_SERENDIPITY = 30;
const SERENDIPITY_SPAN = 70;
const MIN_RATING_COUNT = 50;
const RATING_COUNT_SPAN = 350;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Computes a soft score penalty for widely known films (by TMDB vote count),
 * scaled by serendipity level and how many films the user has rated.
 *
 * Returns 0 for missing, invalid, or low vote counts (<= 1,000), low serendipity (<= 30),
 * or newer users (<= 50 ratings). Capped at FAME_PENALTY_MAX (12).
 */
export function famePenalty(
  voteCount: number | undefined,
  serendipity: number,
  ratingCount: number,
): number {
  if (
    typeof voteCount !== 'number' ||
    !Number.isFinite(voteCount) ||
    voteCount <= MIN_VOTE_COUNT
  ) {
    return 0;
  }
  if (
    typeof serendipity !== 'number' ||
    !Number.isFinite(serendipity) ||
    serendipity <= MIN_SERENDIPITY
  ) {
    return 0;
  }
  if (
    typeof ratingCount !== 'number' ||
    !Number.isFinite(ratingCount) ||
    ratingCount <= MIN_RATING_COUNT
  ) {
    return 0;
  }

  const serendipityStrength = clamp01((serendipity - MIN_SERENDIPITY) / SERENDIPITY_SPAN);
  const ratingStrength = clamp01((ratingCount - MIN_RATING_COUNT) / RATING_COUNT_SPAN);
  const strength = serendipityStrength * ratingStrength;

  const fame = clamp01(Math.log10(voteCount / MIN_VOTE_COUNT) / FULL_FAME_LOG_RATIO);

  return FAME_PENALTY_MAX * strength * fame;
}
