// FROZEN acceptance tests for CIN-47 (Letterboxd watched.csv import). Do not edit or weaken.
//
// Interface contract:
//  - csvService.detectLetterboxdCsvKind(headers: string[]): 'ratings' | 'watched' | 'unknown'
//      Case/whitespace-insensitive. 'ratings' = has Name and Rating columns (ratings.csv).
//      'watched' = has Name and Letterboxd URI (or Year) but NO Rating column (watched.csv: Date,Name,Year,Letterboxd URI).
//      Anything without a Name column is 'unknown'.
//  - csvService.parseWatchedCsv(csv): { accepted: WatchedRow[]; rejected; totalRows }
//      WatchedRow { title; year?; sourceId? (Letterboxd URI); watchedAt? (epoch ms, UTC midnight of Date; undefined if unparseable/future) }.
//      Rows with an empty Name are rejected. A UTF-8 BOM is tolerated.
//  - watchedImport.planWatchedImport(rows, existingRatings, existingHidden, resolved) is PURE.
//      `resolved` maps a row's index in `rows` to its TMDB id (null or absent = unresolved).
//      Per row, in order: unresolved -> unresolved++; id already rated -> skippedRated++;
//      id already hidden (any reason) or already planned by an earlier row -> skippedDuplicate++;
//      else a HiddenFilm { movieId, reason: 'seen', hiddenAt: row.watchedAt ?? 0, title: row.title } is planned.
//      Cap: existing hidden entries are never displaced. Free slots = 2000 - existingHidden.length (min 0).
//      If more are planned than slots, the NEWEST by hiddenAt are kept (ties: earlier row kept), the rest are
//      counted in droppedForCap and omitted from toHide. toHide preserves row order.
import { describe, it, expect } from 'vitest';
import { detectLetterboxdCsvKind, parseWatchedCsv, WatchedRow } from '../csvService';
import { planWatchedImport } from '../watchedImport';
import { HIDDEN_FILMS_CAP } from '../storage';
import { HiddenFilm, UserRating } from '../../types';

const rating = (movieId: number): UserRating => ({
  movieId,
  title: `Rated ${movieId}`,
  rating: 8,
  posterPath: null,
  genres: [],
  ratedAt: 1_600_000_000_000,
});

const row = (title: string, watchedAt?: number, year = '2000'): WatchedRow =>
  watchedAt === undefined ? { title, year } : { title, year, watchedAt };

const resolveAll = (ids: Array<number | null>) => new Map<number, number | null>(ids.map((id, i) => [i, id]));

describe('CIN-47 detectLetterboxdCsvKind (frozen)', () => {
  it('detects watched.csv headers', () => {
    expect(detectLetterboxdCsvKind(['Date', 'Name', 'Year', 'Letterboxd URI'])).toBe('watched');
  });
  it('detects ratings.csv headers', () => {
    expect(detectLetterboxdCsvKind(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'])).toBe('ratings');
  });
  it('is case and whitespace insensitive', () => {
    expect(detectLetterboxdCsvKind([' date ', 'NAME', 'year', 'letterboxd uri'])).toBe('watched');
    expect(detectLetterboxdCsvKind(['name', ' RATING '])).toBe('ratings');
  });
  it('returns unknown without a Name column', () => {
    expect(detectLetterboxdCsvKind(['Title', 'Your Rating'])).toBe('unknown');
    expect(detectLetterboxdCsvKind([])).toBe('unknown');
  });
});

describe('CIN-47 parseWatchedCsv (frozen)', () => {
  it('parses Name, Year, URI and the Date column as UTC midnight', () => {
    const csv = 'Date,Name,Year,Letterboxd URI\n2021-03-04,Heat,1995,https://boxd.it/abc\n';
    const res = parseWatchedCsv(csv);
    expect(res.totalRows).toBe(1);
    expect(res.accepted).toEqual([
      { title: 'Heat', year: '1995', sourceId: 'https://boxd.it/abc', watchedAt: Date.UTC(2021, 2, 4) },
    ]);
  });
  it('leaves watchedAt undefined for an unparseable or future date', () => {
    const csv = 'Date,Name,Year,Letterboxd URI\nnot-a-date,A,2000,u1\n2999-01-01,B,2000,u2\n';
    const res = parseWatchedCsv(csv);
    expect(res.accepted).toHaveLength(2);
    expect(res.accepted[0].watchedAt).toBeUndefined();
    expect(res.accepted[1].watchedAt).toBeUndefined();
  });
  it('rejects rows with an empty Name, tolerates a BOM, handles quoted commas', () => {
    const csv = '﻿Date,Name,Year,Letterboxd URI\n2020-01-01,"Hello, World",2001,u1\n2020-01-02,,2002,u2\n';
    const res = parseWatchedCsv(csv);
    expect(res.accepted.map((r) => r.title)).toEqual(['Hello, World']);
    expect(res.rejected).toHaveLength(1);
    expect(res.totalRows).toBe(2);
  });
});

describe('CIN-47 planWatchedImport (frozen)', () => {
  it('unrated resolved rows become seen hidden entries with hiddenAt from the row date, else 0', () => {
    const rows = [row('A', 1_500_000_000_000), row('B')];
    const plan = planWatchedImport(rows, {}, [], resolveAll([10, 11]));
    expect(plan.toHide).toEqual([
      { movieId: 10, reason: 'seen', hiddenAt: 1_500_000_000_000, title: 'A' },
      { movieId: 11, reason: 'seen', hiddenAt: 0, title: 'B' },
    ]);
    expect(plan).toMatchObject({ skippedRated: 0, skippedDuplicate: 0, unresolved: 0, droppedForCap: 0 });
  });

  it('skips rows that match an existing rating', () => {
    const plan = planWatchedImport([row('A'), row('B')], { 10: rating(10) }, [], resolveAll([10, 11]));
    expect(plan.toHide.map((h) => h.movieId)).toEqual([11]);
    expect(plan.skippedRated).toBe(1);
  });

  it('skips duplicate rows (same resolved id)', () => {
    const plan = planWatchedImport([row('A', 5), row('A again', 9)], {}, [], resolveAll([10, 10]));
    expect(plan.toHide.map((h) => h.movieId)).toEqual([10]);
    expect(plan.toHide[0].title).toBe('A');
    expect(plan.skippedDuplicate).toBe(1);
  });

  it('skips films already hidden, whatever the reason, without changing them', () => {
    const existing: HiddenFilm[] = [
      { movieId: 10, reason: 'not_for_me', hiddenAt: 1 },
      { movieId: 11, reason: 'seen', hiddenAt: 2 },
    ];
    const plan = planWatchedImport([row('A'), row('B'), row('C')], {}, existing, resolveAll([10, 11, 12]));
    expect(plan.toHide.map((h) => h.movieId)).toEqual([12]);
    expect(plan.skippedDuplicate).toBe(2);
  });

  it('counts unresolved rows (null or missing) and plans nothing for them', () => {
    const resolved = new Map<number, number | null>([[0, null], [2, 12]]);
    const plan = planWatchedImport([row('A'), row('B'), row('C')], {}, [], resolved);
    expect(plan.toHide.map((h) => h.movieId)).toEqual([12]);
    expect(plan.unresolved).toBe(2);
  });

  it('an unresolved row is not counted as rated or duplicate', () => {
    const plan = planWatchedImport([row('A')], { 1: rating(1) }, [], resolveAll([null]));
    expect(plan).toMatchObject({ unresolved: 1, skippedRated: 0, skippedDuplicate: 0, toHide: [] });
  });

  it('returns an all-zero empty plan for no rows', () => {
    expect(planWatchedImport([], {}, [], new Map())).toEqual({
      toHide: [],
      skippedRated: 0,
      skippedDuplicate: 0,
      unresolved: 0,
      droppedForCap: 0,
    });
  });

  it('cap: keeps the newest by hiddenAt and reports how many were left out', () => {
    expect(HIDDEN_FILMS_CAP).toBe(2000);
    const total = 2005;
    const rows = Array.from({ length: total }, (_, i) => row(`F${i}`, 1_000_000 + i));
    const ids = Array.from({ length: total }, (_, i) => i + 1);
    const plan = planWatchedImport(rows, {}, [], resolveAll(ids));
    expect(plan.toHide).toHaveLength(2000);
    expect(plan.droppedForCap).toBe(5);
    const kept = new Set(plan.toHide.map((h) => h.movieId));
    for (let id = 1; id <= 5; id++) expect(kept.has(id)).toBe(false); // the 5 oldest
    expect(kept.has(6)).toBe(true);
    expect(kept.has(2005)).toBe(true);
  });

  it('cap: existing hidden entries are never displaced; only the free slots are filled with the newest', () => {
    const existing: HiddenFilm[] = Array.from({ length: 1998 }, (_, i) => ({
      movieId: 100_000 + i,
      reason: 'not_for_me',
      hiddenAt: 1,
    }));
    const rows = [row('Old', 100), row('Newest', 300), row('Mid', 200)];
    const plan = planWatchedImport(rows, {}, existing, resolveAll([1, 2, 3]));
    expect(plan.toHide.map((h) => h.movieId)).toEqual([2, 3]); // row order preserved
    expect(plan.droppedForCap).toBe(1);
  });

  it('cap: a full hidden list drops every new entry', () => {
    const existing: HiddenFilm[] = Array.from({ length: 2000 }, (_, i) => ({
      movieId: 100_000 + i,
      reason: 'seen',
      hiddenAt: 1,
    }));
    const plan = planWatchedImport([row('A', 5), row('B', 6)], {}, existing, resolveAll([1, 2]));
    expect(plan.toHide).toEqual([]);
    expect(plan.droppedForCap).toBe(2);
  });

  it('cap: skipped/unresolved rows never count toward droppedForCap', () => {
    const plan = planWatchedImport([row('A'), row('B')], { 1: rating(1) }, [], resolveAll([1, null]));
    expect(plan.droppedForCap).toBe(0);
  });
});
