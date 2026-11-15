import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateHiddenFilms,
  capHiddenFilms,
  HIDDEN_FILMS_CAP,
  STORAGE_KEYS,
  runStorageMigration,
  safeGetItem,
  clearInMemoryStoreForTesting,
} from '../storage';

describe('Storage hiddenAt invalid fallback and eviction (CIN-45)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
  });

  it('falls back to 0 for missing, non-numeric, or non-finite hiddenAt, preserving valid entries', () => {
    const rawData = [
      { movieId: 1, reason: 'seen', hiddenAt: 'not-a-timestamp', title: 'String timestamp' },
      { movieId: 2, reason: 'seen', hiddenAt: NaN, title: 'NaN timestamp' },
      { movieId: 3, reason: 'not_for_me', title: 'Missing timestamp' },
      { movieId: 4, reason: 'seen', hiddenAt: Infinity, title: 'Infinity timestamp' },
      { movieId: 5, reason: 'not_for_me', hiddenAt: -Infinity, title: '-Infinity timestamp' },
      { movieId: 6, reason: 'seen', hiddenAt: null, title: 'Null timestamp' },
      { movieId: 7, reason: 'seen', hiddenAt: 1700000050000, title: 'Valid timestamp' },
      { movieId: 8, reason: 'seen', hiddenAt: true, title: 'Boolean timestamp' },
      { movieId: 9, reason: 'not_for_me', hiddenAt: {}, title: 'Object timestamp' },
      { movieId: 10, reason: 'seen', hiddenAt: 0, title: 'Zero timestamp' },
    ];

    const validated = validateHiddenFilms(rawData);
    const byId = new Map(validated.map((f) => [f.movieId, f]));

    expect(byId.get(1)?.hiddenAt).toBe(0);
    expect(byId.get(2)?.hiddenAt).toBe(0);
    expect(byId.get(3)?.hiddenAt).toBe(0);
    expect(byId.get(4)?.hiddenAt).toBe(0);
    expect(byId.get(5)?.hiddenAt).toBe(0);
    expect(byId.get(6)?.hiddenAt).toBe(0);
    expect(byId.get(7)?.hiddenAt).toBe(1700000050000);
    expect(byId.get(8)?.hiddenAt).toBe(0);
    expect(byId.get(9)?.hiddenAt).toBe(0);
    expect(byId.get(10)?.hiddenAt).toBe(0);

    // Single item edge cases
    expect(validateHiddenFilms([{ movieId: 101, reason: 'seen', hiddenAt: 'string' }])).toEqual([
      { movieId: 101, reason: 'seen', hiddenAt: 0 },
    ]);
    expect(validateHiddenFilms([{ movieId: 102, reason: 'seen', hiddenAt: NaN }])).toEqual([
      { movieId: 102, reason: 'seen', hiddenAt: 0 },
    ]);
    expect(validateHiddenFilms([{ movieId: 103, reason: 'not_for_me' }])).toEqual([
      { movieId: 103, reason: 'not_for_me', hiddenAt: 0 },
    ]);
  });

  it('evicts a corrupt entry with missing hiddenAt before valid old entries when cap is reached, regardless of position', () => {
    const corruptId = 999999;
    const validFilms = Array.from({ length: HIDDEN_FILMS_CAP }, (_, i) => ({
      movieId: i + 1,
      reason: 'seen' as const,
      hiddenAt: 10000 + i,
      title: `Film ${i + 1}`,
    }));

    const corruptFilm = {
      movieId: corruptId,
      reason: 'not_for_me' as const,
      title: 'Corrupted Film',
    };

    // Test with corrupt entry at end: total 2001 entries, cap is 2000
    const resultAtEnd = validateHiddenFilms([...validFilms, corruptFilm]);
    expect(resultAtEnd).toHaveLength(HIDDEN_FILMS_CAP);
    expect(resultAtEnd.some((f) => f.movieId === corruptId)).toBe(false);
    expect(resultAtEnd.some((f) => f.movieId === 1)).toBe(true);
    expect(resultAtEnd.some((f) => f.movieId === HIDDEN_FILMS_CAP)).toBe(true);

    // Test with corrupt entry at front: must still sort to 0 and be evicted first
    const resultAtFront = validateHiddenFilms([corruptFilm, ...validFilms]);
    expect(resultAtFront).toHaveLength(HIDDEN_FILMS_CAP);
    expect(resultAtFront.some((f) => f.movieId === corruptId)).toBe(false);
    expect(resultAtFront.some((f) => f.movieId === 1)).toBe(true);
    expect(resultAtFront.some((f) => f.movieId === HIDDEN_FILMS_CAP)).toBe(true);
  });

  it('evicts a corrupt entry with string hiddenAt before valid old entries when cap is reached', () => {
    const corruptId = 888888;
    const validFilms = Array.from({ length: HIDDEN_FILMS_CAP }, (_, i) => ({
      movieId: i + 1,
      reason: 'seen' as const,
      hiddenAt: 20000 + i,
      title: `Film ${i + 1}`,
    }));

    const corruptFilm = {
      movieId: corruptId,
      reason: 'seen' as const,
      hiddenAt: 'corrupted-timestamp' as unknown as number,
      title: 'String Corrupted Film',
    };

    // Position at beginning: tests that hiddenAt=0 drives eviction, not array position
    const result = validateHiddenFilms([corruptFilm, ...validFilms]);
    expect(result).toHaveLength(HIDDEN_FILMS_CAP);
    expect(result.some((f) => f.movieId === corruptId)).toBe(false);
    expect(result.some((f) => f.movieId === 1)).toBe(true);
  });

  it('evicts a corrupt entry with NaN hiddenAt before valid old entries when cap is reached', () => {
    const corruptId = 777777;
    const validFilms = Array.from({ length: HIDDEN_FILMS_CAP }, (_, i) => ({
      movieId: i + 1,
      reason: 'seen' as const,
      hiddenAt: 30000 + i,
      title: `Film ${i + 1}`,
    }));

    const corruptFilm = {
      movieId: corruptId,
      reason: 'not_for_me' as const,
      hiddenAt: NaN,
      title: 'NaN Corrupted Film',
    };

    // Position in middle of valid entries
    const mid = Math.floor(HIDDEN_FILMS_CAP / 2);
    const result = validateHiddenFilms([
      ...validFilms.slice(0, mid),
      corruptFilm,
      ...validFilms.slice(mid),
    ]);
    expect(result).toHaveLength(HIDDEN_FILMS_CAP);
    expect(result.some((f) => f.movieId === corruptId)).toBe(false);
    expect(result.some((f) => f.movieId === 1)).toBe(true);
  });

  it('evicts multiple corrupt entries with NaN, string, and missing hiddenAt before valid entries', () => {
    const validFilms = Array.from({ length: HIDDEN_FILMS_CAP }, (_, i) => ({
      movieId: i + 10,
      reason: 'seen' as const,
      hiddenAt: 50000 + i,
      title: `Valid Film ${i + 10}`,
    }));

    const corruptFilms = [
      { movieId: 1, reason: 'seen' as const, hiddenAt: NaN, title: 'Corrupt 1' },
      { movieId: 2, reason: 'seen' as const, hiddenAt: 'invalid' as unknown as number, title: 'Corrupt 2' },
      { movieId: 3, reason: 'not_for_me' as const, title: 'Corrupt 3' },
    ];

    const result = validateHiddenFilms([...validFilms, ...corruptFilms]);

    expect(result).toHaveLength(HIDDEN_FILMS_CAP);
    expect(result.some((f) => f.movieId === 1)).toBe(false);
    expect(result.some((f) => f.movieId === 2)).toBe(false);
    expect(result.some((f) => f.movieId === 3)).toBe(false);
    expect(result.some((f) => f.movieId === 10)).toBe(true);
  });

  it('persists through storage migration without evicting valid old entries', () => {
    const corruptFilm = { movieId: 9999, reason: 'seen', hiddenAt: NaN };
    const validFilms = Array.from({ length: HIDDEN_FILMS_CAP }, (_, i) => ({
      movieId: i + 1,
      reason: 'seen',
      hiddenAt: 20000 + i,
    }));

    localStorage.setItem(STORAGE_KEYS.STORAGE_META, 'migrated_from_v1');
    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify([...validFilms, corruptFilm]));

    runStorageMigration();

    const stored = JSON.parse(safeGetItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]');
    expect(stored).toHaveLength(HIDDEN_FILMS_CAP);
    expect(stored.some((f: any) => f.movieId === 9999)).toBe(false);
    expect(stored.some((f: any) => f.movieId === 1)).toBe(true);
  });
});
