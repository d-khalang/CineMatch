import { STORAGE_KEYS, safeGetItem, safeSetItem } from '../storage';

export interface ShownHistoryEntry {
  lastShownAt: number;
  timesShown: number;
}

export type ShownHistory = Record<number, ShownHistoryEntry>;

export const SHOWN_HISTORY_CAP = 500;
export const SHOWN_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SHOWN_DEMOTE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const SHOWN_DEMOTE_MIN_COUNT = 2;
export const SHOWN_DEMOTE_MAX_COUNT = 4;
export const SHOWN_DEMOTE_POSITIONS_PER_SHOW = 3;

function resolveNow(now?: number): number {
  return typeof now === 'number' && Number.isFinite(now) && now >= 0
    ? now
    : Date.now();
}

function isValidMovieId(id: number): boolean {
  return Number.isInteger(id) && id > 0;
}

function isValidEntry(entry: unknown): entry is ShownHistoryEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return false;
  }
  const candidate = entry as Record<string, unknown>;
  return (
    typeof candidate.lastShownAt === 'number' &&
    Number.isFinite(candidate.lastShownAt) &&
    candidate.lastShownAt >= 0 &&
    typeof candidate.timesShown === 'number' &&
    Number.isInteger(candidate.timesShown) &&
    candidate.timesShown >= 1
  );
}

/**
 * Normalizes, optionally expiry-filters, and caps a ShownHistory map to at most
 * `cap` entries, retaining the most recent `lastShownAt` timestamps first.
 */
function normalizeAndCapHistory(
  history: unknown,
  options: { cap?: number; minLastShownAt?: number } = {}
): ShownHistory {
  const { cap = SHOWN_HISTORY_CAP, minLastShownAt } = options;
  if (!history || typeof history !== 'object' || Array.isArray(history)) {
    return {};
  }

  const validEntries: Array<[number, ShownHistoryEntry]> = [];
  for (const [key, value] of Object.entries(history as Record<string, unknown>)) {
    const movieId = Number(key);
    if (!isValidMovieId(movieId) || String(movieId) !== key) continue;
    if (!isValidEntry(value)) continue;
    if (minLastShownAt !== undefined && value.lastShownAt < minLastShownAt) {
      continue;
    }
    validEntries.push([
      movieId,
      { lastShownAt: value.lastShownAt, timesShown: value.timesShown },
    ]);
  }

  if (validEntries.length > cap) {
    validEntries.sort((a, b) => b[1].lastShownAt - a[1].lastShownAt);
  }

  const result: ShownHistory = {};
  const limit = Math.min(validEntries.length, cap);
  for (let i = 0; i < limit; i++) {
    const [movieId, entry] = validEntries[i];
    result[movieId] = entry;
  }
  return result;
}

/**
 * Loads shown film history from storage, dropping malformed entries
 * and entries older than 30 days. Survives invalid JSON.
 */
export function loadShownHistory(now = Date.now()): ShownHistory {
  const effectiveNow = resolveNow(now);
  const raw = safeGetItem(STORAGE_KEYS.SHOWN_HISTORY);
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  return normalizeAndCapHistory(parsed, {
    minLastShownAt: effectiveNow - SHOWN_HISTORY_TTL_MS,
  });
}

/**
 * Persists shown film history to storage using safeSetItem.
 */
export function saveShownHistory(history: ShownHistory): boolean {
  const normalized = normalizeAndCapHistory(history);
  return safeSetItem(STORAGE_KEYS.SHOWN_HISTORY, JSON.stringify(normalized));
}

/**
 * Returns a new ShownHistory with `movieIds` recorded at `now`, bumping `timesShown`
 * and updating `lastShownAt`. Caps at 500 entries, dropping the oldest `lastShownAt` first.
 */
export function recordShown(
  history: ShownHistory,
  movieIds: number[],
  now = Date.now()
): ShownHistory {
  const effectiveNow = resolveNow(now);
  const next = normalizeAndCapHistory(history, {
    cap: Number.MAX_SAFE_INTEGER,
  });

  if (Array.isArray(movieIds)) {
    const uniqueIds = new Set<number>();
    for (const id of movieIds) {
      if (typeof id === 'number' && isValidMovieId(id)) {
        uniqueIds.add(id);
      }
    }

    for (const movieId of uniqueIds) {
      const existing = next[movieId];
      next[movieId] = {
        lastShownAt: effectiveNow,
        timesShown: existing ? existing.timesShown + 1 : 1,
      };
    }
  }

  return normalizeAndCapHistory(next);
}

/**
 * Returns a new ShownHistory with `movieId` removed (e.g. after the user rates,
 * hides, or watchlists the film).
 */
export function forgetShown(
  history: ShownHistory,
  movieId: number
): ShownHistory {
  const next = normalizeAndCapHistory(history, {
    cap: Number.MAX_SAFE_INTEGER,
  });
  if (typeof movieId === 'number' && isValidMovieId(movieId)) {
    delete next[movieId];
  }
  return Object.keys(next).length > SHOWN_HISTORY_CAP
    ? normalizeAndCapHistory(next)
    : next;
}

/**
 * Demotes films shown 2 or more times within the last 14 days without user action.
 * Each qualifying film moves down by `min(timesShown, 4) * 3` positions (clamped to
 * the end of the list). Preserves all items, keeps the relative order of untouched
 * films, and does not mutate the input array.
 */
export function demoteRecentlyShown<T extends { movieId: number }>(
  ranked: T[],
  history: ShownHistory,
  now = Date.now()
): T[] {
  if (!Array.isArray(ranked) || ranked.length === 0) {
    return [];
  }
  if (!history || typeof history !== 'object' || Array.isArray(history)) {
    return [...ranked];
  }

  const effectiveNow = resolveNow(now);
  const lastIndex = ranked.length - 1;

  const keyed = ranked.map((item, index) => {
    const movieId = item?.movieId;
    const entry =
      typeof movieId === 'number' && isValidMovieId(movieId)
        ? history[movieId]
        : undefined;

    let shift = 0;
    if (
      isValidEntry(entry) &&
      entry.timesShown >= SHOWN_DEMOTE_MIN_COUNT &&
      effectiveNow - entry.lastShownAt <= SHOWN_DEMOTE_WINDOW_MS
    ) {
      shift =
        Math.min(entry.timesShown, SHOWN_DEMOTE_MAX_COUNT) *
        SHOWN_DEMOTE_POSITIONS_PER_SHOW;
    }

    const demoted = shift > 0;
    const targetIndex = demoted ? Math.min(lastIndex, index + shift) : index;

    return {
      item,
      index,
      demoted,
      targetIndex,
    };
  });

  keyed.sort((a, b) => {
    if (a.targetIndex !== b.targetIndex) {
      return a.targetIndex - b.targetIndex;
    }
    if (a.demoted !== b.demoted) {
      return a.demoted ? 1 : -1;
    }
    return a.index - b.index;
  });

  return keyed.map((entry) => entry.item);
}
