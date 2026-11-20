import { describe, it, expect, beforeEach } from 'vitest';
import {
  STORAGE_KEYS,
  clearInMemoryStoreForTesting,
} from '../../storage';
import {
  loadShownHistory,
  saveShownHistory,
  recordShown,
  forgetShown,
} from '../shownHistory';

describe('shownHistory storage integration (DOM)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
  });

  it('persists and loads shown history through safeSetItem/safeGetItem', () => {
    const t1 = 1_700_000_000_000;
    const t2 = t1 + 60_000;

    let history = loadShownHistory(t1);
    expect(history).toEqual({});

    history = recordShown(history, [101, 202], t1);
    history = recordShown(history, [101], t2);
    expect(saveShownHistory(history)).toBe(true);

    const raw = localStorage.getItem(STORAGE_KEYS.SHOWN_HISTORY);
    expect(raw).not.toBeNull();

    const reloaded = loadShownHistory(t2 + 1000);
    expect(reloaded).toEqual({
      101: { lastShownAt: t2, timesShown: 2 },
      202: { lastShownAt: t1, timesShown: 1 },
    });

    const afterForget = forgetShown(reloaded, 101);
    expect(saveShownHistory(afterForget)).toBe(true);
    expect(loadShownHistory(t2 + 2000)).toEqual({
      202: { lastShownAt: t1, timesShown: 1 },
    });
  });
});
