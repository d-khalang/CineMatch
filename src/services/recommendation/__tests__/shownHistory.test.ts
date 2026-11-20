import { describe, it, expect, beforeEach, vi } from 'vitest';

const storageState = vi.hoisted(() => new Map<string, string>());

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>();
  return {
    ...actual,
    safeGetItem: vi.fn((key: string) => storageState.get(key) ?? null),
    safeSetItem: vi.fn((key: string, value: string) => {
      storageState.set(key, value);
      return true;
    }),
  };
});

import { STORAGE_KEYS, safeSetItem } from '../../storage';
import {
  SHOWN_HISTORY_CAP,
  SHOWN_HISTORY_TTL_MS,
  SHOWN_DEMOTE_WINDOW_MS,
  loadShownHistory,
  saveShownHistory,
  recordShown,
  forgetShown,
  demoteRecentlyShown,
  type ShownHistory,
} from '../shownHistory';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('shownHistory service', () => {
  beforeEach(() => {
    storageState.clear();
  });

  describe('loadShownHistory & saveShownHistory', () => {
    it('uses the expected STORAGE_KEYS.SHOWN_HISTORY key', () => {
      expect(STORAGE_KEYS.SHOWN_HISTORY).toBe('cinematch_shown_history_v1');
    });

    it('returns an empty object when nothing is stored or JSON is invalid', () => {
      const now = 1_700_000_000_000;
      expect(loadShownHistory(now)).toEqual({});

      storageState.set(STORAGE_KEYS.SHOWN_HISTORY, '   ');
      expect(loadShownHistory(now)).toEqual({});

      storageState.set(STORAGE_KEYS.SHOWN_HISTORY, '{not valid json');
      expect(loadShownHistory(now)).toEqual({});

      storageState.set(STORAGE_KEYS.SHOWN_HISTORY, 'null');
      expect(loadShownHistory(now)).toEqual({});

      storageState.set(STORAGE_KEYS.SHOWN_HISTORY, '[]');
      expect(loadShownHistory(now)).toEqual({});

      storageState.set(STORAGE_KEYS.SHOWN_HISTORY, '"string"');
      expect(loadShownHistory(now)).toEqual({});

      storageState.set(STORAGE_KEYS.SHOWN_HISTORY, '123');
      expect(loadShownHistory(now)).toEqual({});
    });

    it('drops malformed entries and entries older than 30 days while keeping valid ones', () => {
      const now = 1_700_000_000_000;
      const exactly30DaysAgo = now - SHOWN_HISTORY_TTL_MS;
      const over30DaysAgo = now - SHOWN_HISTORY_TTL_MS - 1;

      storageState.set(
        STORAGE_KEYS.SHOWN_HISTORY,
        JSON.stringify({
          101: { lastShownAt: now - 5 * DAY_MS, timesShown: 2 },
          102: { lastShownAt: exactly30DaysAgo, timesShown: 1 },
          103: { lastShownAt: over30DaysAgo, timesShown: 3 },
          '0104': { lastShownAt: now, timesShown: 1 },
          '+105': { lastShownAt: now, timesShown: 1 },
          0: { lastShownAt: now, timesShown: 1 },
          '-5': { lastShownAt: now, timesShown: 1 },
          '1.5': { lastShownAt: now, timesShown: 1 },
          notANumber: { lastShownAt: now, timesShown: 1 },
          201: null,
          202: [],
          203: { lastShownAt: 'bad', timesShown: 1 },
          204: { lastShownAt: -10, timesShown: 1 },
          205: { lastShownAt: now, timesShown: 0 },
          206: { lastShownAt: now, timesShown: -1 },
          207: { lastShownAt: now, timesShown: 1.5 },
          208: { lastShownAt: now },
          209: { timesShown: 2 },
        })
      );

      expect(loadShownHistory(now)).toEqual({
        101: { lastShownAt: now - 5 * DAY_MS, timesShown: 2 },
        102: { lastShownAt: exactly30DaysAgo, timesShown: 1 },
      });
    });

    it('caps oversized stored history at 500 entries on load', () => {
      const now = 1_700_000_000_000;
      const oversized: ShownHistory = {};
      for (let i = 1; i <= SHOWN_HISTORY_CAP + 5; i++) {
        oversized[i] = { lastShownAt: now - 1000 + i, timesShown: 1 };
      }
      storageState.set(STORAGE_KEYS.SHOWN_HISTORY, JSON.stringify(oversized));

      const loaded = loadShownHistory(now);
      expect(Object.keys(loaded)).toHaveLength(SHOWN_HISTORY_CAP);
      expect(loaded[1]).toBeUndefined();
      expect(loaded[5]).toBeUndefined();
      expect(loaded[6]).toEqual({ lastShownAt: now - 994, timesShown: 1 });
    });

    it('saves and reloads shown history via safeSetItem', () => {
      const now = 1_700_000_000_000;
      const history: ShownHistory = {
        42: { lastShownAt: now, timesShown: 2 },
      };

      expect(saveShownHistory(history)).toBe(true);
      expect(safeSetItem).toHaveBeenCalledWith(
        STORAGE_KEYS.SHOWN_HISTORY,
        JSON.stringify(history)
      );
      expect(loadShownHistory(now + 1000)).toEqual(history);
    });
  });

  describe('recordShown', () => {
    it('adds new entries, bumps existing counts and lastShownAt, and does not mutate input', () => {
      const initial: ShownHistory = {
        10: { lastShownAt: 1000, timesShown: 1 },
        20: { lastShownAt: 1500, timesShown: 2 },
      };
      const snapshot = structuredClone(initial);

      const updated = recordShown(initial, [10, 30, 30, 1.5, -1, 0, Number.NaN], 5000);

      expect(initial).toEqual(snapshot);
      expect(updated).not.toBe(initial);
      expect(updated[10]).toEqual({ lastShownAt: 5000, timesShown: 2 });
      expect(updated[20]).toEqual({ lastShownAt: 1500, timesShown: 2 });
      expect(updated[30]).toEqual({ lastShownAt: 5000, timesShown: 1 });
      expect(Object.keys(updated)).toHaveLength(3);
    });

    it('falls back to current time when now is NaN or negative, and handles empty movieIds', () => {
      const before = Date.now();
      const updatedNeg = recordShown({}, [1], -100);
      const updatedNaN = recordShown(updatedNeg, [1], Number.NaN);
      const after = Date.now();

      expect(updatedNeg[1].lastShownAt).toBeGreaterThanOrEqual(before);
      expect(updatedNeg[1].lastShownAt).toBeLessThanOrEqual(after);
      expect(updatedNaN[1].timesShown).toBe(2);
      expect(updatedNaN[1].lastShownAt).toBeGreaterThanOrEqual(before);

      const unchanged = recordShown(updatedNaN, []);
      expect(unchanged).toEqual(updatedNaN);
      expect(unchanged).not.toBe(updatedNaN);
    });

    it('caps history at 500 entries, dropping the oldest lastShownAt first', () => {
      const history: ShownHistory = {};
      for (let i = 1; i <= SHOWN_HISTORY_CAP; i++) {
        history[i] = { lastShownAt: 1000 + i, timesShown: 1 };
      }

      const updated = recordShown(history, [9991, 9992, 9993], 10_000);

      expect(Object.keys(updated)).toHaveLength(SHOWN_HISTORY_CAP);
      expect(updated[1]).toBeUndefined();
      expect(updated[2]).toBeUndefined();
      expect(updated[3]).toBeUndefined();
      expect(updated[4]).toEqual({ lastShownAt: 1004, timesShown: 1 });
      expect(updated[9991]).toEqual({ lastShownAt: 10_000, timesShown: 1 });
      expect(updated[9992]).toEqual({ lastShownAt: 10_000, timesShown: 1 });
      expect(updated[9993]).toEqual({ lastShownAt: 10_000, timesShown: 1 });
    });

    it('keeps a refreshed oldest entry instead of evicting it before updating', () => {
      const history: ShownHistory = {};
      for (let i = 1; i <= SHOWN_HISTORY_CAP; i++) {
        history[i] = { lastShownAt: 1000 + i, timesShown: 1 };
      }

      const updated = recordShown(history, [1, 9999], 10_000);

      expect(Object.keys(updated)).toHaveLength(SHOWN_HISTORY_CAP);
      expect(updated[1]).toEqual({ lastShownAt: 10_000, timesShown: 2 });
      expect(updated[2]).toBeUndefined();
      expect(updated[3]).toEqual({ lastShownAt: 1003, timesShown: 1 });
      expect(updated[9999]).toEqual({ lastShownAt: 10_000, timesShown: 1 });
    });
  });

  describe('forgetShown', () => {
    it('removes one movieId without mutating the input history', () => {
      const history: ShownHistory = {
        1: { lastShownAt: 1000, timesShown: 2 },
        2: { lastShownAt: 2000, timesShown: 3 },
      };
      const snapshot = structuredClone(history);

      const next = forgetShown(history, 1);

      expect(history).toEqual(snapshot);
      expect(next).toEqual({
        2: { lastShownAt: 2000, timesShown: 3 },
      });
    });

    it('returns a fresh copy unchanged when forgetting an unknown or invalid id, and deletes before capping', () => {
      const history: ShownHistory = {
        1: { lastShownAt: 1000, timesShown: 2 },
      };

      const next = forgetShown(history, 999);
      expect(next).not.toBe(history);
      expect(next).toEqual(history);
      expect(forgetShown({}, 1)).toEqual({});
      expect(forgetShown(history, Number.NaN)).toEqual(history);

      const oversized: ShownHistory = {};
      for (let i = 1; i <= SHOWN_HISTORY_CAP + 1; i++) {
        oversized[i] = { lastShownAt: 1000 + i, timesShown: 1 };
      }
      const afterForget = forgetShown(oversized, SHOWN_HISTORY_CAP + 1);
      expect(Object.keys(afterForget)).toHaveLength(SHOWN_HISTORY_CAP);
      expect(afterForget[1]).toEqual({ lastShownAt: 1001, timesShown: 1 });
      expect(afterForget[SHOWN_HISTORY_CAP + 1]).toBeUndefined();
    });
  });

  describe('demoteRecentlyShown', () => {
    const makeList = (count: number) =>
      Array.from({ length: count }, (_, idx) => ({
        movieId: idx + 1,
        label: `Film ${idx + 1}`,
      }));

    it('handles empty lists, single-item lists, and invalid movieIds or history entries', () => {
      const now = 1_700_000_000_000;
      const history: ShownHistory = {
        1: { lastShownAt: now - DAY_MS, timesShown: 5 },
        2: { lastShownAt: -10, timesShown: 5 },
        3: { lastShownAt: now - DAY_MS, timesShown: Number.NaN },
      };

      expect(demoteRecentlyShown([], history, now)).toEqual([]);

      const single = makeList(1);
      const singleResult = demoteRecentlyShown(single, history, now);
      expect(singleResult).not.toBe(single);
      expect(singleResult).toEqual(single);

      const withInvalidItems = [
        { movieId: Number.NaN, label: 'Bad' },
        { movieId: 2, label: 'Invalid lastShownAt' },
        { movieId: 3, label: 'NaN timesShown' },
        { movieId: 4, label: 'Normal' },
      ];
      expect(demoteRecentlyShown(withInvalidItems, history, now)).toEqual(
        withInvalidItems
      );
    });

    it('does not move a film shown only once or shown more than 14 days ago', () => {
      const now = 1_700_000_000_000;
      const list = makeList(10);
      const history: ShownHistory = {
        1: { lastShownAt: now - 1000, timesShown: 1 },
        2: { lastShownAt: now - SHOWN_DEMOTE_WINDOW_MS - 1, timesShown: 5 },
      };

      const result = demoteRecentlyShown(list, history, now);

      expect(result).not.toBe(list);
      expect(result.map((item) => item.movieId)).toEqual(
        list.map((item) => item.movieId)
      );
    });

    it('moves a film shown 2 times within 14 days down by 6 places', () => {
      const now = 1_700_000_000_000;
      const list = makeList(10);
      const snapshot = structuredClone(list);
      const history: ShownHistory = {
        1: { lastShownAt: now - SHOWN_DEMOTE_WINDOW_MS, timesShown: 2 },
      };

      const result = demoteRecentlyShown(list, history, now);

      expect(list).toEqual(snapshot);
      expect(result.map((item) => item.movieId)).toEqual([
        2, 3, 4, 5, 6, 7, 1, 8, 9, 10,
      ]);
    });

    it('moves a film shown 3, 4, or 5 times within 14 days down by 9, 12, and 12 places', () => {
      const now = 1_700_000_000_000;
      const list = makeList(15);

      expect(
        demoteRecentlyShown(
          list,
          { 1: { lastShownAt: now - 2 * DAY_MS, timesShown: 3 } },
          now
        ).map((item) => item.movieId)
      ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 11, 12, 13, 14, 15]);

      expect(
        demoteRecentlyShown(
          list,
          { 1: { lastShownAt: now - 2 * DAY_MS, timesShown: 4 } },
          now
        ).map((item) => item.movieId)
      ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 14, 15]);

      expect(
        demoteRecentlyShown(
          list,
          { 1: { lastShownAt: now - 2 * DAY_MS, timesShown: 5 } },
          now
        ).map((item) => item.movieId)
      ).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 1, 14, 15]);
    });

    it('clamps moves at the end of the list without losing or duplicating films', () => {
      const now = 1_700_000_000_000;
      const list = makeList(8);
      const history: ShownHistory = {
        2: { lastShownAt: now - DAY_MS, timesShown: 5 }, // 1 + 12 -> clamped to index 7
        6: { lastShownAt: now - DAY_MS, timesShown: 2 }, // 5 + 6 -> clamped to index 7
      };

      const result = demoteRecentlyShown(list, history, now);

      expect(result).toHaveLength(list.length);
      expect(new Set(result.map((item) => item.movieId))).toEqual(
        new Set(list.map((item) => item.movieId))
      );
      // Untouched films [1, 3, 4, 5, 7, 8] keep their relative order ahead of clamped films
      expect(result.map((item) => item.movieId)).toEqual([
        1, 3, 4, 5, 7, 8, 2, 6,
      ]);
    });

    it('preserves untouched film order when multiple films are demoted inside a longer list', () => {
      const now = 1_700_000_000_000;
      const list = makeList(20);
      const history: ShownHistory = {
        1: { lastShownAt: now - DAY_MS, timesShown: 2 }, // moves 6 -> target 6
        5: { lastShownAt: now - DAY_MS, timesShown: 3 }, // moves 9 -> target 13
        10: { lastShownAt: now - DAY_MS, timesShown: 5 }, // moves 12 -> clamped target 19
      };

      const result = demoteRecentlyShown(list, history, now);
      const demotedIds = new Set([1, 5, 10]);
      const untouchedInResult = result
        .map((item) => item.movieId)
        .filter((id) => !demotedIds.has(id));
      const untouchedInInput = list
        .map((item) => item.movieId)
        .filter((id) => !demotedIds.has(id));

      expect(result).toHaveLength(20);
      expect(new Set(result.map((item) => item.movieId)).size).toBe(20);
      expect(untouchedInResult).toEqual(untouchedInInput);
      expect(result.map((item) => item.movieId)).toEqual([
        2, 3, 4, 6, 7, 1, 8, 9, 11, 12, 13, 14, 5, 15, 16, 17, 18, 19, 20, 10,
      ]);
    });
  });
});
