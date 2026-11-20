import { describe, it, expect } from 'vitest';
import type { BucketMix } from '../types';
import {
  OUTCOME_LOG_CAP,
  logShown,
  recordOutcome,
  explorationSummary,
  adaptiveMix,
  type OutcomeLog,
} from '../outcomeLog';

describe('outcomeLog pure functions', () => {
  describe('logShown', () => {
    it('skips below_floor and unbucketed items, and strips extra fields', () => {
      const now = 1_700_000_000_000;
      const shown = [
        {
          movieId: 1,
          bucket: 'safe_bet' as const,
          title: 'Secret Title',
          apiKey: 'should-be-stripped',
        } as { movieId: number; bucket?: 'safe_bet' | 'stretch' | 'wildcard' | 'below_floor' },
        { movieId: 2, bucket: 'stretch' as const },
        { movieId: 3, bucket: 'wildcard' as const },
        { movieId: 4, bucket: 'below_floor' as const },
        { movieId: 5 },
        { movieId: -1, bucket: 'stretch' as const },
        { movieId: 1.5, bucket: 'wildcard' as const },
      ];

      const result = logShown([], shown, now);
      expect(result).toEqual([
        { movieId: 1, bucket: 'safe_bet', shownAt: now },
        { movieId: 2, bucket: 'stretch', shownAt: now },
        { movieId: 3, bucket: 'wildcard', shownAt: now },
      ]);
      expect('title' in result[0]).toBe(false);
      expect('apiKey' in result[0]).toBe(false);
    });

    it('handles empty shown input, duplicate movieIds in one batch, and timestamp edge cases', () => {
      const existing: OutcomeLog = [
        { movieId: 1, bucket: 'safe_bet', shownAt: 500 },
      ];
      expect(logShown(existing, [], 1_000)).toEqual(existing);

      const zeroTs = logShown(
        [],
        [
          { movieId: 10, bucket: 'safe_bet' },
          { movieId: 10, bucket: 'stretch' },
        ],
        0
      );
      expect(zeroTs).toEqual([
        { movieId: 10, bucket: 'stretch', shownAt: 0 },
      ]);

      const nanTs = logShown([], [{ movieId: 11, bucket: 'wildcard' }], Number.NaN);
      expect(nanTs).toHaveLength(1);
      expect(Number.isFinite(nanTs[0].shownAt)).toBe(true);
      expect(nanTs[0].shownAt).toBeGreaterThan(0);
    });

    it('updates bucket and shownAt for an unrated entry without mutating input', () => {
      const t1 = 1_000;
      const t2 = 2_000;
      const initial: OutcomeLog = [
        { movieId: 10, bucket: 'safe_bet', shownAt: t1 },
      ];
      const snapshot = structuredClone(initial);

      const updated = logShown(
        initial,
        [{ movieId: 10, bucket: 'stretch' }],
        t2
      );

      expect(initial).toEqual(snapshot);
      expect(updated).not.toBe(initial);
      expect(updated).toEqual([
        { movieId: 10, bucket: 'stretch', shownAt: t2 },
      ]);
    });

    it('leaves an already-rated entry alone', () => {
      const t1 = 1_000;
      const t2 = 2_000;
      const t3 = 3_000;
      const initial: OutcomeLog = [
        {
          movieId: 10,
          bucket: 'stretch',
          shownAt: t1,
          rating: 9,
          ratedAt: t2,
        },
      ];
      const snapshot = structuredClone(initial);

      const updated = logShown(
        initial,
        [{ movieId: 10, bucket: 'wildcard' }],
        t3
      );

      expect(initial).toEqual(snapshot);
      expect(updated).toEqual(initial);
      expect(updated).not.toBe(initial);
      expect(updated[0]).not.toBe(initial[0]);
    });

    it('evicts the oldest shownAt entry at 501', () => {
      const baseLog: OutcomeLog = [];
      for (let i = 1; i <= OUTCOME_LOG_CAP; i++) {
        baseLog.push({
          movieId: i,
          bucket: 'stretch',
          shownAt: 1_000 + i,
        });
      }
      // Make movieId 2 older than movieId 1 to verify eviction is by shownAt, not index
      baseLog[0].shownAt = 5_000;
      baseLog[1].shownAt = 500;

      const updated = logShown(
        baseLog,
        [{ movieId: 9999, bucket: 'wildcard' }],
        10_000
      );

      expect(updated).toHaveLength(OUTCOME_LOG_CAP);
      expect(updated.some((e) => e.movieId === 2)).toBe(false);
      expect(updated.some((e) => e.movieId === 1)).toBe(true);
      expect(updated.some((e) => e.movieId === 9999)).toBe(true);
    });

    it('evicts oldest unrefreshed entry when the previously oldest entry is refreshed', () => {
      const baseLog: OutcomeLog = [];
      for (let i = 1; i <= OUTCOME_LOG_CAP; i++) {
        baseLog.push({
          movieId: i,
          bucket: 'safe_bet',
          shownAt: 1_000 + i,
        });
      }

      const updated = logShown(
        baseLog,
        [
          { movieId: 1, bucket: 'stretch' },
          { movieId: 9999, bucket: 'wildcard' },
        ],
        10_000
      );

      expect(updated).toHaveLength(OUTCOME_LOG_CAP);
      expect(updated.find((e) => e.movieId === 1)).toEqual({
        movieId: 1,
        bucket: 'stretch',
        shownAt: 10_000,
      });
      expect(updated.some((e) => e.movieId === 2)).toBe(false);
      expect(updated.some((e) => e.movieId === 9999)).toBe(true);
    });
  });

  describe('recordOutcome', () => {
    it('sets rating and ratedAt on the first rating and ignores subsequent ratings', () => {
      const t1 = 1_000;
      const t2 = 2_000;
      const t3 = 3_000;
      const initial: OutcomeLog = [
        { movieId: 42, bucket: 'wildcard', shownAt: t1 },
      ];
      const snapshot = structuredClone(initial);

      const firstRated = recordOutcome(initial, 42, 9, t2);
      expect(initial).toEqual(snapshot);
      expect(firstRated).toEqual([
        {
          movieId: 42,
          bucket: 'wildcard',
          shownAt: t1,
          rating: 9,
          ratedAt: t2,
        },
      ]);

      const secondAttempt = recordOutcome(firstRated, 42, 3, t3);
      expect(secondAttempt).toEqual(firstRated);
      expect(secondAttempt).not.toBe(firstRated);
    });

    it('is a no-op for an empty log, unknown movieId, or invalid rating, and accepts boundary ratings 1 and 10', () => {
      expect(recordOutcome([], 42, 8, 2_000)).toEqual([]);

      const initial: OutcomeLog = [
        { movieId: 42, bucket: 'stretch', shownAt: 1_000 },
        { movieId: 43, bucket: 'wildcard', shownAt: 1_000 },
      ];
      const snapshot = structuredClone(initial);

      const unknown = recordOutcome(initial, 999, 8, 2_000);
      expect(initial).toEqual(snapshot);
      expect(unknown).toEqual(initial);
      expect(unknown).not.toBe(initial);

      expect(recordOutcome(initial, 42, 0, 2_000)).toEqual(initial);
      expect(recordOutcome(initial, 42, 11, 2_000)).toEqual(initial);
      expect(recordOutcome(initial, 42, Number.NaN, 2_000)).toEqual(initial);

      const minRated = recordOutcome(initial, 42, 1, 2_000);
      expect(minRated[0].rating).toBe(1);
      const maxRated = recordOutcome(minRated, 43, 10, 3_000);
      expect(maxRated[1].rating).toBe(10);
    });
  });

  describe('explorationSummary', () => {
    it('counts hits (>= 8) and total over rated stretch and wildcard entries only, deduplicating by movieId', () => {
      const log: OutcomeLog = [
        { movieId: 1, bucket: 'safe_bet', shownAt: 100, rating: 10, ratedAt: 200 },
        { movieId: 2, bucket: 'stretch', shownAt: 100, rating: 8, ratedAt: 200 },
        { movieId: 2, bucket: 'stretch', shownAt: 150, rating: 3, ratedAt: 250 }, // duplicate movieId ignored
        { movieId: 3, bucket: 'stretch', shownAt: 100, rating: 7, ratedAt: 200 },
        { movieId: 4, bucket: 'wildcard', shownAt: 100, rating: 9, ratedAt: 200 },
        { movieId: 5, bucket: 'wildcard', shownAt: 100, rating: 4, ratedAt: 200 },
        { movieId: 6, bucket: 'wildcard', shownAt: 100 }, // unrated
        { movieId: 7, bucket: 'stretch', shownAt: 100 }, // unrated
        { movieId: 8, bucket: 'wildcard', shownAt: 100, rating: Number.NaN, ratedAt: 200 },
      ];

      expect(explorationSummary(log)).toEqual({ hits: 2, total: 4 });
      expect(explorationSummary([])).toEqual({ hits: 0, total: 0 });
      expect(
        explorationSummary([
          { movieId: 9, bucket: 'wildcard', shownAt: 100, rating: 8, ratedAt: 200 },
        ])
      ).toEqual({ hits: 1, total: 1 });
    });
  });

  describe('adaptiveMix', () => {
    const makeOutcomes = (
      ratings: number[],
      bucket: 'stretch' | 'wildcard' = 'wildcard'
    ): OutcomeLog =>
      ratings.map((rating, idx) => ({
        movieId: idx + 1,
        bucket,
        shownAt: 1_000 + idx,
        rating,
        ratedAt: 2_000 + idx,
      }));

    it('returns baseMix unchanged when log is empty, has a single item, or has duplicate movieIds below 5 unique outcomes', () => {
      const base: BucketMix = { safe_bet: 0.50, stretch: 0.35, wildcard: 0.15 };
      expect(adaptiveMix(base, [])).toEqual(base);
      expect(
        adaptiveMix(base, [
          { movieId: 1, bucket: 'wildcard', shownAt: 100, rating: 10, ratedAt: 200 },
        ])
      ).toEqual(base);

      const baseSnapshot = structuredClone(base);
      const log: OutcomeLog = [
        ...makeOutcomes([10, 10, 10, 10], 'stretch'),
        // Duplicate movieId must not push sample size to 5
        { movieId: 1, bucket: 'stretch', shownAt: 1000, rating: 10, ratedAt: 2000 },
        // Safe bets and unrated entries must not push sample size over 5
        { movieId: 100, bucket: 'safe_bet', shownAt: 1000, rating: 10, ratedAt: 2000 },
        { movieId: 101, bucket: 'safe_bet', shownAt: 1000, rating: 10, ratedAt: 2000 },
        { movieId: 102, bucket: 'wildcard', shownAt: 1000 },
      ];

      const adapted = adaptiveMix(base, log);
      expect(base).toEqual(baseSnapshot);
      expect(adapted).toEqual(base);
      expect(adapted).not.toBe(base);
    });

    it('counts mixed stretch and wildcard outcomes together when adapting', () => {
      const base: BucketMix = { safe_bet: 0.50, stretch: 0.35, wildcard: 0.15 };
      const mixedLog: OutcomeLog = [
        ...makeOutcomes([9, 8, 9], 'stretch'),
        { movieId: 10, bucket: 'wildcard', shownAt: 100, rating: 9, ratedAt: 200 },
        { movieId: 11, bucket: 'wildcard', shownAt: 101, rating: 10, ratedAt: 201 },
      ];

      const adapted = adaptiveMix(base, mixedLog);
      expect(adapted.wildcard).toBeCloseTo(0.20, 9);
      expect(adapted.stretch).toBeCloseTo(0.35, 9);
      expect(adapted.safe_bet).toBeCloseTo(0.45, 9);
      expect(adapted.safe_bet + adapted.stretch + adapted.wildcard).toBeCloseTo(1, 9);
    });

    it('raises wildcard by 0.05 when average rating is 8 or more (safe_bet absorbs)', () => {
      const base: BucketMix = { safe_bet: 0.50, stretch: 0.35, wildcard: 0.15 };
      const baseSnapshot = structuredClone(base);
      const log = makeOutcomes([9, 9, 9, 9, 9], 'stretch');

      const adapted = adaptiveMix(base, log);
      expect(base).toEqual(baseSnapshot);
      expect(adapted.wildcard).toBeCloseTo(0.20, 9);
      expect(adapted.stretch).toBeCloseTo(0.35, 9);
      expect(adapted.safe_bet).toBeCloseTo(0.45, 9);
      expect(adapted.safe_bet + adapted.stretch + adapted.wildcard).toBeCloseTo(1, 9);

      // Exact boundary average = 8.0
      const boundary = adaptiveMix(base, makeOutcomes([8, 8, 8, 8, 8]));
      expect(boundary.wildcard).toBeCloseTo(0.20, 9);
      expect(boundary.safe_bet).toBeCloseTo(0.45, 9);
    });

    it('lowers wildcard by 0.05 when average rating is 5 or less (safe_bet absorbs)', () => {
      const base: BucketMix = { safe_bet: 0.45, stretch: 0.35, wildcard: 0.20 };
      const log = makeOutcomes([4, 4, 4, 4, 4], 'wildcard');

      const adapted = adaptiveMix(base, log);
      expect(adapted.wildcard).toBeCloseTo(0.15, 9);
      expect(adapted.stretch).toBeCloseTo(0.35, 9);
      expect(adapted.safe_bet).toBeCloseTo(0.50, 9);
      expect(adapted.safe_bet + adapted.stretch + adapted.wildcard).toBeCloseTo(1, 9);

      // Exact boundary average = 5.0
      const boundary = adaptiveMix(base, makeOutcomes([5, 5, 5, 5, 5]));
      expect(boundary.wildcard).toBeCloseTo(0.15, 9);
      expect(boundary.safe_bet).toBeCloseTo(0.50, 9);
    });

    it('leaves mix unchanged when average rating is strictly between 5 and 8', () => {
      const base: BucketMix = { safe_bet: 0.50, stretch: 0.35, wildcard: 0.15 };
      const log = makeOutcomes([6, 7, 6, 7, 7]);

      const adapted = adaptiveMix(base, log);
      expect(adapted).toEqual(base);
      expect(adapted.safe_bet + adapted.stretch + adapted.wildcard).toBeCloseTo(1, 9);
    });

    it('clamps wildcard to [0.10, 0.30] and keeps sum equal to 1', () => {
      const atCeiling: BucketMix = { safe_bet: 0.35, stretch: 0.35, wildcard: 0.30 };
      const raisedAtCeiling = adaptiveMix(atCeiling, makeOutcomes([9, 9, 9, 9, 9]));
      expect(raisedAtCeiling.wildcard).toBeCloseTo(0.30, 9);
      expect(raisedAtCeiling.stretch).toBeCloseTo(0.35, 9);
      expect(raisedAtCeiling.safe_bet).toBeCloseTo(0.35, 9);
      expect(
        raisedAtCeiling.safe_bet + raisedAtCeiling.stretch + raisedAtCeiling.wildcard
      ).toBeCloseTo(1, 9);

      const nearCeiling: BucketMix = { safe_bet: 0.37, stretch: 0.35, wildcard: 0.28 };
      const raisedNearCeiling = adaptiveMix(
        nearCeiling,
        makeOutcomes([9, 9, 9, 9, 9])
      );
      expect(raisedNearCeiling.wildcard).toBeCloseTo(0.30, 9);
      expect(raisedNearCeiling.stretch).toBeCloseTo(0.35, 9);
      expect(raisedNearCeiling.safe_bet).toBeCloseTo(0.35, 9);
      expect(
        raisedNearCeiling.safe_bet +
          raisedNearCeiling.stretch +
          raisedNearCeiling.wildcard
      ).toBeCloseTo(1, 9);

      const atFloor: BucketMix = { safe_bet: 0.55, stretch: 0.35, wildcard: 0.10 };
      const loweredAtFloor = adaptiveMix(atFloor, makeOutcomes([3, 4, 4, 4, 5]));
      expect(loweredAtFloor.wildcard).toBeCloseTo(0.10, 9);
      expect(loweredAtFloor.stretch).toBeCloseTo(0.35, 9);
      expect(loweredAtFloor.safe_bet).toBeCloseTo(0.55, 9);
      expect(
        loweredAtFloor.safe_bet + loweredAtFloor.stretch + loweredAtFloor.wildcard
      ).toBeCloseTo(1, 9);

      const nearFloor: BucketMix = { safe_bet: 0.53, stretch: 0.35, wildcard: 0.12 };
      const loweredNearFloor = adaptiveMix(
        nearFloor,
        makeOutcomes([3, 4, 4, 4, 5])
      );
      expect(loweredNearFloor.wildcard).toBeCloseTo(0.10, 9);
      expect(loweredNearFloor.stretch).toBeCloseTo(0.35, 9);
      expect(loweredNearFloor.safe_bet).toBeCloseTo(0.55, 9);
      expect(
        loweredNearFloor.safe_bet +
          loweredNearFloor.stretch +
          loweredNearFloor.wildcard
      ).toBeCloseTo(1, 9);
    });
  });
});
