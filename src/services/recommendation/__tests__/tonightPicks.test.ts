import { describe, it, expect } from 'vitest';
import { selectTonightPicks } from '../tonightPicks';
import type { Recommendation } from '../../../types';
import type { Bucket } from '../types';

function makeRec(id: number, rank: number, bucket?: Bucket): Recommendation {
  return {
    movie: {
      id,
      title: `Film ${id}`,
      overview: `Overview ${id}`,
      poster_path: `/poster-${id}.jpg`,
      backdrop_path: null,
      release_date: '2021-01-01',
      vote_average: 7.8,
      vote_count: 1000,
      genres: [{ id: 18, name: 'Drama' }],
    },
    score: Math.max(0, 100 - rank),
    rank,
    reason: `Reason for film ${id}.`,
    serendipityType:
      bucket === 'wildcard'
        ? 'wildcard_discovery'
        : bucket === 'stretch'
        ? 'thematic_gem'
        : 'safe_bet',
    highlightTags: ['Drama'],
    ...(bucket !== undefined ? { bucket } : {}),
  };
}

describe('selectTonightPicks', () => {
  it('picks the best-ranked safe_bet, stretch, and wildcard in slot order when all three buckets are present', () => {
    const recs: Recommendation[] = [
      makeRec(1, 5, 'wildcard'),
      makeRec(2, 4, 'safe_bet'),
      makeRec(3, 6, 'stretch'),
      makeRec(4, 1, 'safe_bet'),
      makeRec(5, 3, 'stretch'),
      makeRec(6, 2, 'wildcard'),
    ];

    const { picks, rest } = selectTonightPicks(recs);

    expect(picks.map((r) => [r.movie.id, r.bucket, r.rank])).toEqual([
      [4, 'safe_bet', 1],
      [5, 'stretch', 3],
      [6, 'wildcard', 2],
    ]);
    expect(rest.map((r) => r.movie.id)).toEqual([1, 2, 3]);
  });

  it('falls back to the next best-ranked safe_bet in the missing stretch slot', () => {
    const recs: Recommendation[] = [
      makeRec(10, 1, 'safe_bet'),
      makeRec(11, 2, 'safe_bet'),
      makeRec(12, 3, 'wildcard'),
      makeRec(13, 4, 'safe_bet'),
    ];

    const { picks, rest } = selectTonightPicks(recs);

    expect(picks.map((r) => [r.movie.id, r.bucket])).toEqual([
      [10, 'safe_bet'],
      [11, 'safe_bet'],
      [12, 'wildcard'],
    ]);
    expect(rest.map((r) => r.movie.id)).toEqual([13]);
  });

  it('prefers an extra safe_bet over better-ranked other buckets when filling an empty slot', () => {
    const recs: Recommendation[] = [
      makeRec(14, 1, 'safe_bet'),
      makeRec(15, 2, 'wildcard'),
      makeRec(16, 3, 'wildcard'),
      makeRec(17, 4),
      makeRec(18, 10, 'safe_bet'),
    ];

    const { picks, rest } = selectTonightPicks(recs);

    expect(picks.map((r) => [r.movie.id, r.bucket])).toEqual([
      [14, 'safe_bet'],
      [18, 'safe_bet'],
      [15, 'wildcard'],
    ]);
    expect(rest.map((r) => r.movie.id)).toEqual([16, 17]);
  });

  it('never picks below_floor and falls back to no-bucket items when only below_floor and no-bucket items exist', () => {
    const recs: Recommendation[] = [
      makeRec(20, 1, 'below_floor'),
      makeRec(21, 3),
      makeRec(22, 2, 'below_floor'),
      makeRec(23, 4),
      makeRec(24, 5),
      makeRec(25, 6),
    ];

    const { picks, rest } = selectTonightPicks(recs);

    expect(picks.map((r) => r.movie.id)).toEqual([21, 23, 24]);
    expect(picks.every((r) => r.bucket !== 'below_floor')).toBe(true);
    expect(rest.map((r) => r.movie.id)).toEqual([20, 22, 25]);
  });

  it('returns fewer than 3 picks when fewer than 3 eligible recommendations exist', () => {
    const twoEligible: Recommendation[] = [
      makeRec(30, 1, 'below_floor'),
      makeRec(31, 2, 'safe_bet'),
      makeRec(32, 3, 'wildcard'),
    ];

    const twoResult = selectTonightPicks(twoEligible);
    expect(twoResult.picks.map((r) => r.movie.id)).toEqual([31, 32]);
    expect(twoResult.rest.map((r) => r.movie.id)).toEqual([30]);

    const onlyBelowFloor: Recommendation[] = [
      makeRec(33, 1, 'below_floor'),
      makeRec(34, 2, 'below_floor'),
    ];
    const noneResult = selectTonightPicks(onlyBelowFloor);
    expect(noneResult.picks).toEqual([]);
    expect(noneResult.rest.map((r) => r.movie.id)).toEqual([33, 34]);

    expect(selectTonightPicks([])).toEqual({ picks: [], rest: [] });

    const singleEligible = [makeRec(35, 1, 'stretch')];
    expect(selectTonightPicks(singleEligible).picks.map((r) => r.movie.id)).toEqual([35]);
    expect(selectTonightPicks(singleEligible).rest).toEqual([]);

    const singleBelowFloor = [makeRec(36, 1, 'below_floor')];
    expect(selectTonightPicks(singleBelowFloor).picks).toEqual([]);
    expect(selectTonightPicks(singleBelowFloor).rest.map((r) => r.movie.id)).toEqual([36]);
  });

  it('handles NaN and non-finite ranks without dropping eligible picks or breaking tie order', () => {
    const recs: Recommendation[] = [
      makeRec(70, Number.NaN, 'safe_bet'),
      makeRec(71, 2, 'safe_bet'),
      makeRec(72, Number.POSITIVE_INFINITY, 'stretch'),
      makeRec(73, Number.NaN, 'stretch'),
      makeRec(74, 1, 'wildcard'),
    ];

    const { picks, rest } = selectTonightPicks(recs);

    expect(picks.map((r) => r.movie.id)).toEqual([71, 72, 74]);
    expect(rest.map((r) => r.movie.id)).toEqual([70, 73]);
  });

  it('preserves original order in rest and excludes all picked items', () => {
    const recs: Recommendation[] = [
      makeRec(40, 10, 'below_floor'),
      makeRec(41, 7, 'stretch'),
      makeRec(42, 2, 'safe_bet'),
      makeRec(43, 9),
      makeRec(44, 4, 'wildcard'),
      makeRec(45, 3, 'safe_bet'),
      makeRec(46, 8, 'stretch'),
    ];

    const { picks, rest } = selectTonightPicks(recs);

    expect(picks.map((r) => r.movie.id)).toEqual([42, 41, 44]);
    const pickedIds = new Set(picks.map((r) => r.movie.id));
    expect(rest.some((r) => pickedIds.has(r.movie.id))).toBe(false);
    expect(rest.map((r) => r.movie.id)).toEqual([40, 43, 45, 46]);
  });

  it('does not mutate the input array or its recommendation objects', () => {
    const recs = [
      Object.freeze(makeRec(50, 3, 'wildcard')),
      Object.freeze(makeRec(51, 2, 'stretch')),
      Object.freeze(makeRec(52, 1, 'safe_bet')),
      Object.freeze(makeRec(53, 4, 'safe_bet')),
    ];
    const frozenInput = Object.freeze([...recs]) as Recommendation[];
    const snapshot = frozenInput.map((r) => ({ movieId: r.movie.id, rank: r.rank, bucket: r.bucket }));

    const { picks, rest } = selectTonightPicks(frozenInput);

    expect(picks.map((r) => r.movie.id)).toEqual([52, 51, 50]);
    expect(rest.map((r) => r.movie.id)).toEqual([53]);
    expect(frozenInput.map((r) => ({ movieId: r.movie.id, rank: r.rank, bucket: r.bucket }))).toEqual(
      snapshot
    );
  });
});
