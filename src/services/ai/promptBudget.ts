/**
 * Client-side prompt token estimation and per-key Groq TPM budget tracking.
 * Token limits are kept in memory only, keyed by a one-way hash of the API key.
 */

export const GROQ_FREE_TIER_TOKENS_PER_MINUTE = 8000;

const SAFETY_MARGIN_TOKENS = 200;
const CHARS_PER_TOKEN_ESTIMATE = 3.5;
const MAX_TRACKED_KEYS = 256;

export interface CandidateCountBudgetOptions {
  tokenLimit: number;
  baseTokens: number;
  replyTokens: number;
  perCandidateTokens: number;
  min: number;
  max: number;
}

const groqTokenLimits = new Map<string, number>();

/**
 * Computes a one-way 64-bit FNV-1a hex digest (two 32-bit lanes) so API keys
 * are never stored or reconstructible from in-memory tracking structures.
 */
function hashApiKey(apiKey: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < apiKey.length; i++) {
    const code = apiKey.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${hex1}${hex2}`;
}

/**
 * Estimates token count conservatively (~1 token per 3.5 characters, rounded up).
 */
export function estimateTokens(text: string): number {
  if (typeof text !== 'string' || !text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

/**
 * Computes how many candidates fit within a token-per-minute budget after reserving
 * base prompt tokens, reply tokens, and a 200-token safety margin, clamped to [min, max].
 */
export function candidateCountForBudget({
  tokenLimit,
  baseTokens,
  replyTokens,
  perCandidateTokens,
  min,
  max,
}: CandidateCountBudgetOptions): number {
  const effectiveLimit =
    typeof tokenLimit === 'number' && Number.isFinite(tokenLimit) && tokenLimit > 0
      ? tokenLimit
      : GROQ_FREE_TIER_TOKENS_PER_MINUTE;

  if (
    typeof baseTokens !== 'number' ||
    !Number.isFinite(baseTokens) ||
    typeof replyTokens !== 'number' ||
    !Number.isFinite(replyTokens) ||
    typeof perCandidateTokens !== 'number' ||
    !Number.isFinite(perCandidateTokens) ||
    perCandidateTokens <= 0
  ) {
    return min;
  }

  const available = effectiveLimit - baseTokens - replyTokens - SAFETY_MARGIN_TOKENS;
  const count = Math.floor(available / perCandidateTokens);
  return Math.min(max, Math.max(min, count));
}

/**
 * Records a positive numeric `x-ratelimit-limit-tokens` header value in memory
 * for the given API key (hashed), ignoring missing or invalid values.
 */
export function recordGroqTokenLimit(apiKey: string, headerValue: string | null): void {
  if (typeof apiKey !== 'string' || !apiKey.trim()) return;
  if (typeof headerValue !== 'string') return;

  const trimmedHeader = headerValue.trim();
  if (!trimmedHeader) return;

  const parsed = Number(trimmedHeader);
  if (!Number.isFinite(parsed) || parsed <= 0) return;

  const limit = Math.floor(parsed);
  if (limit <= 0) return;

  const hashedKey = hashApiKey(apiKey.trim());
  if (!groqTokenLimits.has(hashedKey) && groqTokenLimits.size >= MAX_TRACKED_KEYS) {
    const oldestKey = groqTokenLimits.keys().next().value;
    if (oldestKey !== undefined) {
      groqTokenLimits.delete(oldestKey);
    }
  }
  groqTokenLimits.set(hashedKey, limit);
}

/**
 * Returns the last observed token-per-minute limit for the given API key,
 * defaulting to the Groq free-tier limit (8,000 TPM).
 */
export function getGroqTokenLimit(apiKey: string): number {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return GROQ_FREE_TIER_TOKENS_PER_MINUTE;
  }
  return groqTokenLimits.get(hashApiKey(apiKey.trim())) ?? GROQ_FREE_TIER_TOKENS_PER_MINUTE;
}

/** Clears in-memory Groq token limits (for unit tests). */
export function resetGroqTokenLimitsForTesting(): void {
  groqTokenLimits.clear();
}

/** Returns a snapshot of hashed-key limit entries (for unit tests). */
export function groqLimitSnapshotForTesting(): Array<[string, number]> {
  return Array.from(groqTokenLimits.entries());
}
