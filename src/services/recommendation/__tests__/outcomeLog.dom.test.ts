import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  STORAGE_KEYS,
  clearInMemoryStoreForTesting,
} from '../../storage';
import {
  OUTCOME_LOG_CAP,
  loadOutcomeLog,
  saveOutcomeLog,
  resetOutcomeLog,
  logShown,
  recordOutcome,
  type OutcomeLog,
} from '../outcomeLog';

describe('outcomeLog storage integration (DOM)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
  });

  it('uses the expected STORAGE_KEYS.OUTCOME_LOG key', () => {
    expect(STORAGE_KEYS.OUTCOME_LOG).toBe('cinematch_outcome_log_v1');
  });

  it('returns [] when storage is empty or contains invalid JSON or non-array JSON', () => {
    expect(loadOutcomeLog()).toEqual([]);

    localStorage.setItem(STORAGE_KEYS.OUTCOME_LOG, '   ');
    expect(loadOutcomeLog()).toEqual([]);

    localStorage.setItem(STORAGE_KEYS.OUTCOME_LOG, '{invalid json');
    expect(loadOutcomeLog()).toEqual([]);

    localStorage.setItem(STORAGE_KEYS.OUTCOME_LOG, 'null');
    expect(loadOutcomeLog()).toEqual([]);

    localStorage.setItem(STORAGE_KEYS.OUTCOME_LOG, '{}');
    expect(loadOutcomeLog()).toEqual([]);

    localStorage.setItem(STORAGE_KEYS.OUTCOME_LOG, '"string"');
    expect(loadOutcomeLog()).toEqual([]);
  });

  it('is lenient on load: drops malformed entries, strips extra fields, and caps at 500', () => {
    localStorage.setItem(
      STORAGE_KEYS.OUTCOME_LOG,
      JSON.stringify([
        null,
        'bad',
        { movieId: -5, bucket: 'stretch', shownAt: 100 },
        { movieId: 1.5, bucket: 'stretch', shownAt: 100 },
        { movieId: 10, bucket: 'below_floor', shownAt: 100 },
        { movieId: 11, bucket: 'invalid', shownAt: 100 },
        { movieId: 12, bucket: 'stretch', shownAt: -1 },
        { movieId: 13, bucket: 'stretch', shownAt: 100, rating: 11 },
        { movieId: 14, bucket: 'stretch', shownAt: 100, rating: 'good' },
        {
          movieId: 20,
          bucket: 'wildcard',
          shownAt: 1_000,
          title: 'Secret Title',
          apiKey: 'SHOULD_BE_STRIPPED',
        },
        {
          movieId: 21,
          bucket: 'stretch',
          shownAt: 2_000,
          rating: 9,
          ratedAt: 3_000,
        },
      ])
    );

    expect(loadOutcomeLog()).toEqual([
      { movieId: 20, bucket: 'wildcard', shownAt: 1_000 },
      { movieId: 21, bucket: 'stretch', shownAt: 2_000, rating: 9, ratedAt: 3_000 },
    ]);

    const oversized: OutcomeLog = [];
    for (let i = 1; i <= OUTCOME_LOG_CAP + 3; i++) {
      oversized.push({ movieId: i, bucket: 'safe_bet', shownAt: 1_000 + i });
    }
    localStorage.setItem(STORAGE_KEYS.OUTCOME_LOG, JSON.stringify(oversized));

    const loaded = loadOutcomeLog();
    expect(loaded).toHaveLength(OUTCOME_LOG_CAP);
    expect(loaded[0].movieId).toBe(4);
    expect(loaded.at(-1)?.movieId).toBe(OUTCOME_LOG_CAP + 3);
  });

  it('round-trips save, load, and reset through safeSetItem/safeGetItem/safeRemoveItem', () => {
    const t1 = 1_700_000_000_000;
    const t2 = t1 + 5_000;

    let log = loadOutcomeLog();
    expect(log).toEqual([]);

    log = logShown(
      log,
      [
        { movieId: 101, bucket: 'safe_bet' },
        { movieId: 202, bucket: 'stretch' },
        { movieId: 303, bucket: 'below_floor' },
      ],
      t1
    );
    log = recordOutcome(log, 202, 8, t2);

    expect(saveOutcomeLog(log)).toBe(true);
    const raw = localStorage.getItem(STORAGE_KEYS.OUTCOME_LOG);
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('title');

    expect(loadOutcomeLog()).toEqual([
      { movieId: 101, bucket: 'safe_bet', shownAt: t1 },
      { movieId: 202, bucket: 'stretch', shownAt: t1, rating: 8, ratedAt: t2 },
    ]);

    expect(resetOutcomeLog()).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.OUTCOME_LOG)).toBeNull();
    expect(loadOutcomeLog()).toEqual([]);
  });

  it('returns false from saveOutcomeLog when underlying storage write fails, and resetOutcomeLog clears fallback', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const log: OutcomeLog = [
      { movieId: 101, bucket: 'wildcard', shownAt: 1_000 },
    ];
    expect(saveOutcomeLog(log)).toBe(false);
    expect(loadOutcomeLog()).toEqual(log);

    expect(resetOutcomeLog()).toBe(true);
    expect(loadOutcomeLog()).toEqual([]);
  });
});
