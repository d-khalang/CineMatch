import { describe, it, expect } from 'vitest';
import { rankCandidates } from '../rankCandidates';
import { mixForSerendipityLevel } from '../scoring';
import {
  supply,
  intraListDiversity,
  meanNoveltyPercentile,
  bucketMix,
  nonSeedNeighbourShare,
  popularityHeadShare,
} from '../evaluation';
import type { Candidate, CandidateSource } from '../types';
import type { Movie, Recommendation, UserRating } from '../../../types';
import { getSeriesKey } from '../../../constants/franchises';
import {
  buildEvaluationFixtures,
  type EvaluationFixture,
} from './fixtures/profiles';

/**
 * Documented evaluation thresholds (see docs/recommendation-evaluation.md).
 */
const THRESHOLDS = {
  heavySupplyMin: 30,
  intraListDiversityMin: 0.70,
  meanNoveltyPercentileMin: 0.35,
  bucketMixTolerance: 0.06,
  nonSeedNeighbourShareMinAt30: 0.35,
  nonSeedNeighbourShareMinAt85: 0.50,
  nicheTop10PopularityHeadMax: 0.30,
  topNPopularityHead: 10,
  popularityHeadPercentile: 0.20,
} as const;

function makeTestRec(
  id: number,
  overrides: Partial<Movie> = {},
  extra: Partial<Pick<Recommendation, 'bucket' | 'sources' | 'score' | 'rank'>> = {}
): Recommendation {
  return {
    movie: {
      id,
      title: `Test Film ${id}`,
      overview: `Overview ${id}`,
      poster_path: null,
      backdrop_path: null,
      release_date: '2015-01-01',
      vote_average: 7.5,
      vote_count: 1000,
      genres: [{ id: 18, name: 'Drama' }],
      director: 'Test Director',
      keywords: ['cinema'],
      ...overrides,
    },
    score: 75,
    rank: 1,
    reason: 'Test recommendation reason.',
    serendipityType: 'safe_bet',
    highlightTags: ['Drama'],
    bucket: 'safe_bet',
    sources: ['seed_graph'],
    ...extra,
  };
}

function makeTestCandidate(
  id: number,
  voteCount: number,
  seedNeighbour = false,
  sources: CandidateSource[] = ['hidden_gem']
): Candidate {
  return {
    movie: {
      id,
      title: `Pool Film ${id}`,
      overview: `Overview ${id}`,
      poster_path: null,
      backdrop_path: null,
      release_date: '2015-01-01',
      vote_average: 7.5,
      vote_count: voteCount,
      genres: [{ id: 18, name: 'Drama' }],
      director: 'Pool Director',
      keywords: ['cinema'],
    },
    sources,
    seedNeighbour,
  };
}

/**
 * Naive baseline ranker that filters rated/duplicate films and sorts solely by
 * TMDB `vote_count` descending. Used as a regression guard to verify that quality
 * thresholds reject popularity-only sorting.
 */
function rankByVoteCount(
  candidates: readonly Candidate[],
  userRatings: readonly UserRating[],
  size = 30
): Recommendation[] {
  const ratedIds = new Set(userRatings.map((r) => r.movieId));
  const seenIds = new Set<number>();
  const seenSeries = new Set<string>();
  const filtered: Candidate[] = [];

  for (const c of candidates) {
    const id = c.movie.id;
    if (ratedIds.has(id) || seenIds.has(id)) continue;
    const key = getSeriesKey(id, c.movie.title);
    if (seenSeries.has(key)) continue;
    seenSeries.add(key);
    seenIds.add(id);
    filtered.push(c);
  }

  filtered.sort(
    (a, b) => (b.movie.vote_count - a.movie.vote_count) || (a.movie.id - b.movie.id)
  );

  return filtered.slice(0, size).map((c, index) => ({
    movie: c.movie,
    score: 80,
    rank: index + 1,
    reason: 'Sorted by popularity.',
    serendipityType: 'safe_bet',
    highlightTags: [],
    bucket: 'safe_bet',
    sources: [...c.sources],
  }));
}

describe('recommendation evaluation metrics (unit tests)', () => {
  it('supply returns exact recommendation count', () => {
    expect(supply([])).toBe(0);
    expect(supply([makeTestRec(1)])).toBe(1);
    expect(supply([makeTestRec(1), makeTestRec(2), makeTestRec(3)])).toBe(3);
  });

  it('intraListDiversity computes mean pairwise 1 - candidateSimilarity', () => {
    expect(intraListDiversity([])).toBe(0);
    expect(intraListDiversity([makeTestRec(1)])).toBe(0);

    // Identical metadata across distinct IDs -> similarity = 1, diversity = 0
    const identical = [
      makeTestRec(1, { director: 'Same Dir', genres: [{ id: 18, name: 'Drama' }], keywords: ['noir'] }),
      makeTestRec(2, { director: 'Same Dir', genres: [{ id: 18, name: 'Drama' }], keywords: ['noir'] }),
    ];
    expect(intraListDiversity(identical)).toBeCloseTo(0, 5);

    // Completely disjoint metadata -> similarity = 0, diversity = 1
    const disjoint = [
      makeTestRec(1, { director: 'Dir A', genres: [{ id: 18, name: 'Drama' }], keywords: ['noir'] }),
      makeTestRec(2, { director: 'Dir B', genres: [{ id: 35, name: 'Comedy' }], keywords: ['satire'] }),
    ];
    expect(intraListDiversity(disjoint)).toBeCloseTo(1, 5);

    // Duplicate movie IDs have similarity = 1, diversity = 0
    expect(
      intraListDiversity([
        makeTestRec(1, { director: 'Dir A' }),
        makeTestRec(1, { director: 'Dir B' }),
      ])
    ).toBeCloseTo(0, 5);

    // Known 3-item calculation:
    // sim(1,2) = 0.4(dir) + 0.4(genre) + 0(kw) = 0.8 -> div = 0.2
    // sim(1,3) = 0 -> div = 1.0
    // sim(2,3) = 0 -> div = 1.0
    // mean = (0.2 + 1.0 + 1.0) / 3 = 2.2 / 3
    const mixed = [
      makeTestRec(1, { director: 'D1', genres: [{ id: 18, name: 'Drama' }], keywords: ['k1'] }),
      makeTestRec(2, { director: 'D1', genres: [{ id: 18, name: 'Drama' }], keywords: ['k2'] }),
      makeTestRec(3, { director: 'D2', genres: [{ id: 35, name: 'Comedy' }], keywords: ['k3'] }),
    ];
    expect(intraListDiversity(mixed)).toBeCloseTo(2.2 / 3, 5);
  });

  it('meanNoveltyPercentile computes inverse vote-count midpoint percentiles within the pool', () => {
    const pool = [
      makeTestCandidate(1, 100),
      makeTestCandidate(2, 3000),
      makeTestCandidate(3, 15000),
      makeTestCandidate(4, 50000),
    ];

    expect(meanNoveltyPercentile([], pool)).toBe(0);
    expect(meanNoveltyPercentile([makeTestRec(1)], [])).toBe(0);
    expect(meanNoveltyPercentile([makeTestRec(1)], [pool[0]])).toBe(0.5);

    const tiedPool = [makeTestCandidate(1, 500), makeTestCandidate(2, 500)];
    expect(meanNoveltyPercentile([makeTestRec(1), makeTestRec(2)], tiedPool)).toBe(0.5);

    // Within 4-item distinct pool: novelties are 1.0 (100), 2/3 (3000), 1/3 (15000), 0.0 (50000)
    expect(meanNoveltyPercentile([makeTestRec(1, { vote_count: 100 })], pool)).toBeCloseTo(1.0, 5);
    expect(meanNoveltyPercentile([makeTestRec(4, { vote_count: 50000 })], pool)).toBeCloseTo(0.0, 5);
    expect(
      meanNoveltyPercentile(
        [makeTestRec(1, { vote_count: 100 }), makeTestRec(4, { vote_count: 50000 })],
        pool
      )
    ).toBeCloseTo(0.5, 5);
    expect(
      meanNoveltyPercentile(
        [makeTestRec(1, { vote_count: 100 }), makeTestRec(2, { vote_count: 3000 })],
        pool
      )
    ).toBeCloseTo(5 / 6, 5);

    // Out-of-pool recommendations and non-finite vote_count handling
    expect(meanNoveltyPercentile([makeTestRec(997, { vote_count: 10 })], pool)).toBeCloseTo(1.0, 5);
    expect(meanNoveltyPercentile([makeTestRec(996, { vote_count: 100000 })], pool)).toBeCloseTo(0.0, 5);
    expect(meanNoveltyPercentile([makeTestRec(998, { vote_count: 1000 })], pool)).toBeCloseTo(5 / 6, 5);
    expect(
      meanNoveltyPercentile(
        [makeTestRec(999, { vote_count: 500 })],
        [makeTestCandidate(1, 100), makeTestCandidate(2, 1000)]
      )
    ).toBeCloseTo(0.5, 5);
    expect(
      meanNoveltyPercentile([makeTestRec(995, { vote_count: Number.NaN })], pool)
    ).toBeCloseTo(1.0, 5);
  });

  it('bucketMix computes per-bucket shares summing to 1', () => {
    expect(bucketMix([])).toEqual({
      safe_bet: 0,
      stretch: 0,
      wildcard: 0,
      below_floor: 0,
    });
    expect(bucketMix([makeTestRec(1, {}, { bucket: 'wildcard' })])).toEqual({
      safe_bet: 0,
      stretch: 0,
      wildcard: 1,
      below_floor: 0,
    });
    expect(bucketMix([makeTestRec(1, {}, { bucket: undefined })])).toEqual({
      safe_bet: 0,
      stretch: 0,
      wildcard: 0,
      below_floor: 0,
    });

    const recs: Recommendation[] = [
      ...Array.from({ length: 5 }, (_, i) => makeTestRec(1 + i, {}, { bucket: 'safe_bet' })),
      ...Array.from({ length: 3 }, (_, i) => makeTestRec(10 + i, {}, { bucket: 'stretch' })),
      makeTestRec(20, {}, { bucket: 'wildcard' }),
      makeTestRec(30, {}, { bucket: 'below_floor' }),
    ];

    const mix = bucketMix(recs);
    expect(mix.safe_bet).toBeCloseTo(0.5, 5);
    expect(mix.stretch).toBeCloseTo(0.3, 5);
    expect(mix.wildcard).toBeCloseTo(0.1, 5);
    expect(mix.below_floor).toBeCloseTo(0.1, 5);
    expect(mix.safe_bet + mix.stretch + mix.wildcard + mix.below_floor).toBeCloseTo(1.0, 5);
  });

  it('nonSeedNeighbourShare resolves pool seedNeighbour flags and falls back cleanly', () => {
    expect(nonSeedNeighbourShare([])).toBe(0);

    const pool = [
      makeTestCandidate(1, 1000, true, ['seed_graph']),
      makeTestCandidate(2, 1000, false, ['hidden_gem']),
      makeTestCandidate(3, 1000, false, ['creator_graph']),
      makeTestCandidate(4, 1000, false, ['bridge']),
    ];
    const recs = [makeTestRec(1), makeTestRec(2), makeTestRec(3), makeTestRec(4)];
    expect(nonSeedNeighbourShare(recs, pool)).toBeCloseTo(0.75, 5);

    // Without pool: uses movie.seedNeighbour boolean when present, else sources fallback
    const noPoolRecs = [
      makeTestRec(1, {}, { sources: ['seed_graph'] }),
      makeTestRec(2, {}, { sources: ['hidden_gem'] }),
    ];
    expect(nonSeedNeighbourShare(noPoolRecs)).toBeCloseTo(0.5, 5);

    const explicitFlagRecs = [
      makeTestRec(1, { seedNeighbour: true }, { sources: ['hidden_gem'] }),
      makeTestRec(2, { seedNeighbour: false }, { sources: ['seed_graph'] }),
    ];
    expect(nonSeedNeighbourShare(explicitFlagRecs)).toBeCloseTo(0.5, 5);

    // Duplicate IDs in pool keep the first candidate's flag (matching rankCandidates)
    const duplicatePool = [
      makeTestCandidate(1, 1000, true, ['seed_graph']),
      makeTestCandidate(1, 1000, false, ['hidden_gem']),
    ];
    expect(nonSeedNeighbourShare([makeTestRec(1)], duplicatePool)).toBe(0);
  });

  it('popularityHeadShare computes top-N overlap with the pool popularity head', () => {
    const pool = Array.from({ length: 10 }, (_, i) =>
      makeTestCandidate(i + 1, (i + 1) * 10)
    ); // vote_count 10..100; top 20% = {90, 100}

    expect(popularityHeadShare([], pool, 10, 0.2)).toBe(0);
    expect(popularityHeadShare([makeTestRec(1)], [], 10, 0.2)).toBe(0);
    expect(popularityHeadShare([makeTestRec(1)], pool, 0, 0.2)).toBe(0);
    expect(popularityHeadShare([makeTestRec(1)], pool, 10, 0)).toBe(0);
    expect(popularityHeadShare([makeTestRec(1)], pool, Number.NaN, 0.2)).toBe(0);
    expect(popularityHeadShare([makeTestRec(1)], pool, 10, Number.NaN)).toBe(0);
    expect(popularityHeadShare([makeTestRec(1)], pool, 10, 1)).toBe(1);
    expect(popularityHeadShare([makeTestRec(1, { vote_count: Number.NaN })], pool, 10, 0.2)).toBe(0);

    // Fewer recommendations than topN divides by actual recommendation count
    expect(
      popularityHeadShare(
        [makeTestRec(10, { vote_count: 100 }), makeTestRec(1, { vote_count: 10 })],
        pool,
        10,
        0.2
      )
    ).toBeCloseTo(0.5, 5);

    const halfHead = [
      makeTestRec(10, { vote_count: 100 }),
      makeTestRec(9, { vote_count: 90 }),
      makeTestRec(2, { vote_count: 20 }),
      makeTestRec(1, { vote_count: 10 }),
      makeTestRec(10, { vote_count: 100 }), // head item outside topN=4 must be ignored
    ];
    expect(popularityHeadShare(halfHead, pool, 4, 0.2)).toBeCloseTo(0.5, 5);

    const zeroHead = [
      makeTestRec(4, { vote_count: 40 }),
      makeTestRec(3, { vote_count: 30 }),
      makeTestRec(2, { vote_count: 20 }),
      makeTestRec(1, { vote_count: 10 }),
    ];
    expect(popularityHeadShare(zeroHead, pool, 4, 0.2)).toBe(0);
  });
});

describe('evaluation fixture invariants', () => {
  const fixtures = buildEvaluationFixtures();
  const allFixtures: EvaluationFixture[] = [
    fixtures.coldStart,
    fixtures.casual,
    fixtures.heavy,
    fixtures.niche,
  ];

  it('builds deterministic fixtures across repeated calls', () => {
    const second = buildEvaluationFixtures();
    expect(fixtures.coldStart).toEqual(second.coldStart);
    expect(fixtures.casual).toEqual(second.casual);
    expect(fixtures.heavy).toEqual(second.heavy);
    expect(fixtures.niche).toEqual(second.niche);
  });

  it('satisfies expected rating counts, pool sizes, distinct series keys, log popularity spread, and source mix', () => {
    expect(fixtures.coldStart.ratings).toHaveLength(3);
    expect(fixtures.casual.ratings).toHaveLength(25);
    expect(fixtures.heavy.ratings).toHaveLength(300);
    expect(fixtures.niche.ratings).toHaveLength(60);

    for (const fixture of allFixtures) {
      expect(fixture.pool.length).toBeGreaterThanOrEqual(150);
      expect(fixture.pool.length).toBeLessThanOrEqual(200);

      // Unique movie IDs and distinct getSeriesKey titles across the pool
      const ids = new Set(fixture.pool.map((c) => c.movie.id));
      expect(ids.size).toBe(fixture.pool.length);

      const seriesKeys = new Set(
        fixture.pool.map((c) => getSeriesKey(c.movie.id, c.movie.title))
      );
      expect(seriesKeys.size).toBe(fixture.pool.length);

      // Log-distributed vote counts from ~50 to ~2,000,000
      const votes = fixture.pool.map((c) => c.movie.vote_count);
      const minVotes = Math.min(...votes);
      const maxVotes = Math.max(...votes);
      expect(minVotes).toBeLessThanOrEqual(100);
      expect(maxVotes).toBeGreaterThanOrEqual(1_500_000);
      expect(Math.log10(maxVotes / minVotes)).toBeGreaterThanOrEqual(4.0);
      expect(votes.filter((v) => v <= 1000).length).toBeGreaterThanOrEqual(30);
      expect(votes.filter((v) => v >= 200_000).length).toBeGreaterThanOrEqual(25);

      // Mix of sources and both seedNeighbour values
      const uniqueSources = new Set(fixture.pool.flatMap((c) => c.sources));
      expect(uniqueSources.size).toBeGreaterThanOrEqual(5);
      expect(fixture.pool.some((c) => c.seedNeighbour)).toBe(true);
      expect(fixture.pool.some((c) => !c.seedNeighbour)).toBe(true);
    }
  });
});

describe('offline quality evaluation via rankCandidates', () => {
  const fixtures = buildEvaluationFixtures();
  const allFixtures: EvaluationFixture[] = [
    fixtures.coldStart,
    fixtures.casual,
    fixtures.heavy,
    fixtures.niche,
  ];
  const serendipityLevels = [30, 85] as const;

  for (const fixture of allFixtures) {
    describe(`profile: ${fixture.name}`, () => {
      for (const serendipityLevel of serendipityLevels) {
        it(`meets supply, invariant, diversity, novelty, bucket-mix, and non-seed thresholds at serendipity ${serendipityLevel}`, () => {
          const recs = rankCandidates(fixture.pool, fixture.ratings, {
            serendipityLevel,
            preferredEras: fixture.preferredEras,
            selectedVibes: fixture.selectedVibes,
            size: 30,
          });

          // Supply
          expect(supply(recs)).toBe(30);

          // Determinism
          const rerun = rankCandidates(fixture.pool, fixture.ratings, {
            serendipityLevel,
            preferredEras: fixture.preferredEras,
            selectedVibes: fixture.selectedVibes,
            size: 30,
          });
          expect(recs.map((r) => r.movie.id)).toEqual(rerun.map((r) => r.movie.id));
          expect(recs.map((r) => r.bucket)).toEqual(rerun.map((r) => r.bucket));

          // No rated films, no ID duplicates, no series-key duplicates, valid ranks & scores
          const ratedIds = new Set(fixture.ratings.map((r) => r.movieId));
          const recIds = new Set<number>();
          const recSeriesKeys = new Set<string>();
          recs.forEach((rec, index) => {
            expect(ratedIds.has(rec.movie.id)).toBe(false);
            expect(recIds.has(rec.movie.id)).toBe(false);
            recIds.add(rec.movie.id);

            const seriesKey = getSeriesKey(rec.movie.id, rec.movie.title);
            expect(recSeriesKeys.has(seriesKey)).toBe(false);
            recSeriesKeys.add(seriesKey);

            expect(rec.rank).toBe(index + 1);
            expect(Number.isFinite(rec.score)).toBe(true);
            expect(rec.score).toBeGreaterThanOrEqual(0);
            expect(rec.score).toBeLessThanOrEqual(100);
            expect(rec.reason.trim().length).toBeGreaterThan(0);
          });

          // Diversity & Novelty
          expect(intraListDiversity(recs)).toBeGreaterThanOrEqual(
            THRESHOLDS.intraListDiversityMin
          );
          expect(meanNoveltyPercentile(recs, fixture.pool)).toBeGreaterThanOrEqual(
            THRESHOLDS.meanNoveltyPercentileMin
          );

          // Bucket mix within tolerance
          const actualMix = bucketMix(recs);
          const targetMix = mixForSerendipityLevel(serendipityLevel);
          expect(actualMix.below_floor).toBe(0);
          expect(Math.abs(actualMix.safe_bet - targetMix.safe_bet)).toBeLessThanOrEqual(
            THRESHOLDS.bucketMixTolerance
          );
          expect(Math.abs(actualMix.stretch - targetMix.stretch)).toBeLessThanOrEqual(
            THRESHOLDS.bucketMixTolerance
          );
          expect(Math.abs(actualMix.wildcard - targetMix.wildcard)).toBeLessThanOrEqual(
            THRESHOLDS.bucketMixTolerance
          );

          // Non-seed-neighbour share
          const nonSeedMin =
            serendipityLevel === 30
              ? THRESHOLDS.nonSeedNeighbourShareMinAt30
              : THRESHOLDS.nonSeedNeighbourShareMinAt85;
          expect(nonSeedNeighbourShare(recs, fixture.pool)).toBeGreaterThanOrEqual(nonSeedMin);

          // Niche profile top-10 is not dominated by global popularity head
          if (fixture.name === 'niche') {
            expect(
              popularityHeadShare(
                recs,
                fixture.pool,
                THRESHOLDS.topNPopularityHead,
                THRESHOLDS.popularityHeadPercentile
              )
            ).toBeLessThanOrEqual(THRESHOLDS.nicheTop10PopularityHeadMax);
          }
        });
      }

      it('shifts bucket mix toward wildcards and away from safe bets from serendipity 30 to 85', () => {
        const recs30 = rankCandidates(fixture.pool, fixture.ratings, {
          serendipityLevel: 30,
          preferredEras: fixture.preferredEras,
          selectedVibes: fixture.selectedVibes,
          size: 30,
        });
        const recs85 = rankCandidates(fixture.pool, fixture.ratings, {
          serendipityLevel: 85,
          preferredEras: fixture.preferredEras,
          selectedVibes: fixture.selectedVibes,
          size: 30,
        });

        const mix30 = bucketMix(recs30);
        const mix85 = bucketMix(recs85);

        expect(mix85.wildcard).toBeGreaterThan(mix30.wildcard);
        expect(mix85.safe_bet).toBeLessThan(mix30.safe_bet);
      });
    });
  }

  it('heavy profile yields >= 30 results even when requesting 40 and with injected duplicates', () => {
    const heavy = fixtures.heavy;
    const adversarialPool: Candidate[] = [
      ...heavy.pool,
      // Duplicate existing candidates and inject additional rated movies
      heavy.pool[0],
      heavy.pool[10],
      {
        ...heavy.pool[20],
        movie: {
          ...heavy.pool[20].movie,
          id: heavy.ratings[25].movieId,
          title: heavy.ratings[25].title,
        },
      },
    ];

    const recs = rankCandidates(adversarialPool, heavy.ratings, {
      serendipityLevel: 30,
      size: 40,
    });

    expect(supply(recs)).toBeGreaterThanOrEqual(THRESHOLDS.heavySupplyMin);
    expect(supply(recs)).toBe(40);

    const ratedIds = new Set(heavy.ratings.map((r) => r.movieId));
    const uniqueIds = new Set(recs.map((r) => r.movie.id));
    const uniqueSeries = new Set(recs.map((r) => getSeriesKey(r.movie.id, r.movie.title)));
    expect(uniqueIds.size).toBe(recs.length);
    expect(uniqueSeries.size).toBe(recs.length);
    for (const rec of recs) {
      expect(ratedIds.has(rec.movie.id)).toBe(false);
    }
  });
});

describe('regression guard: naive popularity (vote_count) ranker fails quality gates', () => {
  const fixtures = buildEvaluationFixtures();
  const guardedProfiles: EvaluationFixture[] = [
    fixtures.coldStart,
    fixtures.casual,
    fixtures.heavy,
    fixtures.niche,
  ];

  for (const fixture of guardedProfiles) {
    it(`naive vote_count sorting fails diversity, novelty, and popularity-head thresholds on ${fixture.name}`, () => {
      const naiveRecs = rankByVoteCount(fixture.pool, fixture.ratings, 30);

      expect(supply(naiveRecs)).toBe(30);

      // Proves thresholds are not tuned to pass trivially:
      expect(intraListDiversity(naiveRecs)).toBeLessThan(THRESHOLDS.intraListDiversityMin);
      expect(meanNoveltyPercentile(naiveRecs, fixture.pool)).toBeLessThan(
        THRESHOLDS.meanNoveltyPercentileMin
      );
      expect(
        popularityHeadShare(
          naiveRecs,
          fixture.pool,
          THRESHOLDS.topNPopularityHead,
          THRESHOLDS.popularityHeadPercentile
        )
      ).toBeGreaterThan(THRESHOLDS.nicheTop10PopularityHeadMax);
    });
  }
});
