/**
 * FROZEN acceptance tests for CIN-23. Do not edit or weaken.
 *
 * Scope: scoring calibration so wildcards exist and labels are honest.
 *
 * Interface assumptions (the implementer must follow these):
 *  - Cold-start signals are passed through the existing options object of
 *    scoreCandidates as `{ preferredEras?: string[]; selectedVibes?: string[] }`
 *    (same names and value formats as AISettings / ERA_OPTIONS: '70s', '80s',
 *    '90s', '2000s', '2010s', '2020s'). A candidate matches an era when
 *    getDecade(release_date) equals getDecade(era), and matches a vibe when the
 *    lowercased vibe text appears in its overview or keywords.
 *  - Only public exports of scoring.ts are used: buildTasteProfile,
 *    scoreCandidates, buildRankedList, mixForSerendipityLevel,
 *    DEFAULT_RELEVANCE_FLOOR. Function signatures stay backwards compatible.
 *  - Below-floor films may be given any internal label except 'safe_bet' in the
 *    ranked output of buildRankedList.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTasteProfile,
  scoreCandidates,
  buildRankedList,
  mixForSerendipityLevel,
  DEFAULT_RELEVANCE_FLOOR,
} from '../scoring';
import type { Candidate, ScoredCandidate } from '../types';
import type { UserRating } from '../../../types';

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const EPS = 1e-9;

type ScoreOptions = Parameters<typeof scoreCandidates>[2];

function rating(id: number, value: number, genres: string[], year: string): UserRating {
  return {
    movieId: id,
    title: `Rated ${id}`,
    rating: value,
    posterPath: null,
    year,
    genres,
    ratedAt: 1_700_000_000_000 + id,
  };
}

function candidate(
  id: number,
  genreNames: string[],
  opts: {
    year?: number;
    voteAverage?: number;
    voteCount?: number;
    seedNeighbour?: boolean;
    overview?: string;
    keywords?: string[];
  } = {}
): Candidate {
  return {
    movie: {
      id,
      title: `Candidate ${id}`,
      overview: opts.overview ?? `Overview ${id}`,
      poster_path: null,
      backdrop_path: null,
      release_date: `${opts.year ?? 2005}-06-01`,
      vote_average: opts.voteAverage ?? 7.0,
      vote_count: opts.voteCount ?? 3000,
      genres: genreNames.map((name, i) => ({ id: i + 1, name })),
      director: '',
      keywords: opts.keywords ?? [],
    },
    sources: ['seed_graph'],
    seedNeighbour: opts.seedNeighbour ?? true,
  };
}

const HEAVY_GENRES = [
  'Drama',
  'Comedy',
  'Action',
  'Thriller',
  'Sci-Fi',
  'Romance',
  'Crime',
  'Adventure',
  'Animation',
  'Fantasy',
  'Mystery',
  'Horror',
];

/** 300 ratings, 12 genres, every genre positively rated but with a clear spread. */
function heavyRaterRatings(): UserRating[] {
  const rng = makeRng(20231);
  const out: UserRating[] = [];
  for (let i = 0; i < 300; i++) {
    const a = Math.floor(rng() * HEAVY_GENRES.length);
    let b = Math.floor(rng() * HEAVY_GENRES.length);
    if (b === a) b = (b + 1) % HEAVY_GENRES.length;
    const idx = Math.min(a, b);
    // Earlier genres are loved more; all stay above the neutral 5.5.
    const value = Math.max(6.5, Math.min(10, 10 - idx * 0.25 + (rng() - 0.5)));
    const year = 1980 + Math.floor(rng() * 41);
    out.push(rating(i + 1, value, [HEAVY_GENRES[a], HEAVY_GENRES[b]], String(year)));
  }
  return out;
}

/** Pool drawn only from genres and decades the heavy rater already knows. */
function heavyPool(size: number, seed: number): Candidate[] {
  const rng = makeRng(seed);
  const out: Candidate[] = [];
  for (let i = 0; i < size; i++) {
    const count = 1 + Math.floor(rng() * 3);
    const genres = new Set<string>();
    while (genres.size < count) {
      genres.add(HEAVY_GENRES[Math.floor(rng() * HEAVY_GENRES.length)]);
    }
    out.push(
      candidate(1000 + i, [...genres], {
        year: 1980 + Math.floor(rng() * 41),
        voteAverage: 5.5 + rng() * 3,
        voteCount: Math.floor(100 + rng() * rng() * 60000),
        seedNeighbour: rng() < 0.6,
      })
    );
  }
  return out;
}

const LOVED = ['Drama', 'Crime', 'Thriller'];
const HATED = ['Horror', 'Romance', 'Musical'];
const MEH = ['Comedy', 'Action', 'Sci-Fi'];

/** Loves Drama/Crime/Thriller, hates Horror/Romance/Musical, lukewarm elsewhere. */
function mixedTasteRatings(seed: number): UserRating[] {
  const rng = makeRng(seed);
  const out: UserRating[] = [];
  for (let i = 0; i < 60; i++) {
    const group = i % 3 === 0 ? HATED : i % 3 === 1 ? LOVED : MEH;
    const g = group[Math.floor(rng() * group.length)];
    const value = group === HATED ? 1 + rng() : group === LOVED ? 9 + rng() : 5 + rng();
    out.push(rating(i + 1, value, [g], String(1985 + Math.floor(rng() * 35))));
  }
  return out;
}

function mixedPool(size: number, seed: number): Candidate[] {
  const rng = makeRng(seed);
  const all = [...LOVED, ...HATED, ...MEH];
  const out: Candidate[] = [];
  for (let i = 0; i < size; i++) {
    const g1 = all[Math.floor(rng() * all.length)];
    const genres = rng() < 0.3 ? [g1, all[Math.floor(rng() * all.length)]] : [g1];
    out.push(
      candidate(3000 + i, [...new Set(genres)], {
        year: 1985 + Math.floor(rng() * 40),
        voteAverage: 5.5 + rng() * 3,
        voteCount: Math.floor(100 + rng() * 30000),
        seedNeighbour: rng() < 0.5,
      })
    );
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function unexpectedOf(scored: ScoredCandidate[], id: number): number {
  return scored.find((c) => c.movie.id === id)!.scores.unexpectedness;
}

function relevanceOf(scored: ScoredCandidate[], id: number): number {
  return scored.find((c) => c.movie.id === id)!.scores.relevance;
}

function aboveFloor(scored: ScoredCandidate[]): ScoredCandidate[] {
  return scored.filter((c) => c.scores.relevance >= DEFAULT_RELEVANCE_FLOOR);
}

/** Top-15% band of unexpectedness, tolerant of ties at the boundary. */
function topBand(above: ScoredCandidate[]): { cutoff: number; maxAllowed: number } {
  const sorted = above.map((c) => c.scores.unexpectedness).sort((a, b) => b - a);
  const k = Math.ceil(0.15 * sorted.length);
  const cutoff = sorted[k - 1];
  const maxAllowed = sorted.filter((u) => u >= cutoff - EPS).length;
  return { cutoff, maxAllowed };
}

// ---------------------------------------------------------------------------

describe('CIN-23 scoring calibration (frozen)', () => {
  describe('scope 1: unusual genres are those below median affinity', () => {
    it('AC1: for a heavy rater, below-median genres count as unusual and above-median ones as usual', () => {
      const profile = buildTasteProfile(heavyRaterRatings());
      const ranked = [...profile.genres.entries()].sort((a, b) => a[1] - b[1]);
      // Precondition: this is exactly the case the issue describes.
      expect(ranked.every(([, aff]) => aff > 0)).toBe(true);
      expect(ranked.length).toBeGreaterThanOrEqual(10);

      const med = median(ranked.map(([, aff]) => aff));
      const below = ranked.filter(([, aff]) => aff < med).map(([g]) => g);
      const above = ranked.filter(([, aff]) => aff > med).map(([g]) => g);
      expect(below.length).toBeGreaterThan(0);
      expect(above.length).toBeGreaterThan(0);
      const lowGenre = below[0];
      const highGenre = above[above.length - 1];

      const cands = [
        candidate(1, [lowGenre], { year: 2000, seedNeighbour: true }),
        candidate(2, [highGenre], { year: 2000, seedNeighbour: true }),
        candidate(3, [lowGenre, highGenre], { year: 2000, seedNeighbour: true }),
      ];
      const scored = scoreCandidates(cands, profile);
      const uLow = unexpectedOf(scored, 1);
      const uHigh = unexpectedOf(scored, 2);
      const uMixed = unexpectedOf(scored, 3);

      expect(uLow).toBeGreaterThan(uHigh);
      expect(uLow).toBeGreaterThan(uMixed);
      expect(uMixed).toBeGreaterThan(uHigh);
    });
  });

  describe('scope 2: percentile-relative bucket thresholds', () => {
    it('AC2a: wildcards are the top 15% of unexpectedness among above-floor candidates (heavy rater)', () => {
      const profile = buildTasteProfile(heavyRaterRatings());
      const scored = scoreCandidates(heavyPool(150, 7), profile);
      const above = aboveFloor(scored);
      expect(above.length).toBeGreaterThanOrEqual(100);

      const wildcards = above.filter((c) => c.bucket === 'wildcard');
      const { cutoff, maxAllowed } = topBand(above);

      expect(wildcards.length).toBeGreaterThanOrEqual(1);
      expect(wildcards.length).toBeLessThanOrEqual(maxAllowed);
      for (const w of wildcards) {
        expect(w.scores.unexpectedness).toBeGreaterThanOrEqual(cutoff - EPS);
      }
    });

    it('AC2b: stretches are a middle band, above safe bets in serendipity and below wildcards in unexpectedness', () => {
      const profile = buildTasteProfile(heavyRaterRatings());
      const scored = scoreCandidates(heavyPool(150, 7), profile);
      const above = aboveFloor(scored);
      const by = (b: string) => above.filter((c) => c.bucket === b);
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

      expect(by('wildcard').length).toBeGreaterThan(0);
      expect(by('stretch').length).toBeGreaterThan(0);
      expect(by('safe_bet').length).toBeGreaterThan(0);
      expect(by('stretch').length).toBeLessThan(above.length * 0.6);

      expect(mean(by('stretch').map((c) => c.scores.serendipity))).toBeGreaterThan(
        mean(by('safe_bet').map((c) => c.scores.serendipity))
      );
      expect(mean(by('wildcard').map((c) => c.scores.unexpectedness))).toBeGreaterThan(
        mean(by('stretch').map((c) => c.scores.unexpectedness))
      );
    });

    it('AC2c: thresholds are relative, so a pool far from a thin profile is not all wildcards', () => {
      // Five Drama/1990s ratings. Almost every candidate is "far" in absolute terms,
      // which made the fixed 0.60 cut-off label nearly all of them wildcards.
      const profile = buildTasteProfile([1, 2, 3, 4, 5].map((i) => rating(i, 9, ['Drama'], '1995')));
      const rng = makeRng(99);
      const others = ['Comedy', 'Action', 'Horror', 'Sci-Fi', 'Romance', 'Western'];
      const pool: Candidate[] = [];
      for (let i = 0; i < 120; i++) {
        const genres = [others[Math.floor(rng() * others.length)]];
        if (rng() < 0.3) genres.push(others[Math.floor(rng() * others.length)]);
        if (rng() < 0.15) genres.push('Drama');
        pool.push(
          candidate(2000 + i, [...new Set(genres)], {
            year: 1960 + Math.floor(rng() * 6) * 10 + 5,
            voteAverage: 6 + rng() * 2.5,
            voteCount: Math.floor(200 + rng() * 40000),
            seedNeighbour: rng() < 0.4,
          })
        );
      }
      const scored = scoreCandidates(pool, profile);
      const above = aboveFloor(scored);
      expect(above.length).toBeGreaterThanOrEqual(80);

      const wildcards = above.filter((c) => c.bucket === 'wildcard');
      const { maxAllowed } = topBand(above);
      expect(wildcards.length).toBeGreaterThanOrEqual(1);
      expect(wildcards.length).toBeLessThanOrEqual(maxAllowed);
      // Never the majority of the pool.
      expect(wildcards.length).toBeLessThan(above.length * 0.5);
    });
  });

  describe('scope 3: below-floor films are never safe bets', () => {
    it('AC3a: with enough supply, below-floor films are dropped from the ranked list', () => {
      const profile = buildTasteProfile(mixedTasteRatings(555));
      const scored = scoreCandidates(mixedPool(200, 31), profile);
      const below = scored.filter((c) => c.scores.relevance < DEFAULT_RELEVANCE_FLOOR);
      expect(below.length).toBeGreaterThanOrEqual(15);
      expect(scored.length - below.length).toBeGreaterThanOrEqual(40);

      const ranked = buildRankedList(scored, mixForSerendipityLevel(30), 30);
      expect(ranked).toHaveLength(30);
      for (const r of ranked) {
        expect(r.scores.relevance).toBeGreaterThanOrEqual(DEFAULT_RELEVANCE_FLOOR);
      }
    });

    it('AC3b: when above-floor supply runs short, below-floor films fill the tail, last, and never as safe_bet', () => {
      const profile = buildTasteProfile(mixedTasteRatings(555));
      const scored = scoreCandidates(mixedPool(200, 31), profile);
      const above = scored.filter((c) => c.scores.relevance >= DEFAULT_RELEVANCE_FLOOR);
      const below = scored.filter((c) => c.scores.relevance < DEFAULT_RELEVANCE_FLOOR);

      const supply = [...above.slice(0, 6), ...below.slice(0, 10)];
      const ranked = buildRankedList(supply, mixForSerendipityLevel(30), 12);

      expect(ranked).toHaveLength(12);
      for (const r of ranked.slice(0, 6)) {
        expect(r.scores.relevance).toBeGreaterThanOrEqual(DEFAULT_RELEVANCE_FLOOR);
      }
      for (const r of ranked.slice(6)) {
        expect(r.scores.relevance).toBeLessThan(DEFAULT_RELEVANCE_FLOOR);
        expect(r.bucket).not.toBe('safe_bet');
      }
    });
  });

  describe('scope 4: wildcards are ranked by unexpectedness weighted with quality', () => {
    function wildcard(id: number, genre: string, unexpectedness: number, voteAverage: number): ScoredCandidate {
      const base = candidate(id, [genre], { voteAverage, seedNeighbour: false });
      return {
        ...base,
        scores: {
          relevance: 0.7,
          novelty: 0.6,
          unexpectedness,
          serendipity: 0.7 * (0.3 + 0.5 * unexpectedness),
        },
        bucket: 'wildcard',
      };
    }
    const wildMix = { safe_bet: 0, stretch: 0, wildcard: 1 };

    it('AC4a: a slightly less unexpected but far better-rated wildcard outranks a poor one', () => {
      const poor = wildcard(1, 'Horror', 0.9, 4.0);
      const great = wildcard(2, 'Western', 0.8, 8.8);
      const ranked = buildRankedList([poor, great], wildMix, 2);
      expect(ranked.map((r) => r.movie.id)).toEqual([2, 1]);
    });

    it('AC4b: with equal quality, higher unexpectedness still ranks first (guard)', () => {
      const a = wildcard(1, 'Horror', 0.95, 7.5);
      const b = wildcard(2, 'Western', 0.7, 7.5);
      const ranked = buildRankedList([b, a], wildMix, 2);
      expect(ranked.map((r) => r.movie.id)).toEqual([1, 2]);
    });
  });

  describe('scope 5: cold-start signals fold into relevance', () => {
    const profiles: Array<[string, () => ReturnType<typeof buildTasteProfile>]> = [
      ['empty profile', () => buildTasteProfile([])],
      [
        'thin profile',
        () => buildTasteProfile([rating(1, 9, ['Drama'], '2001'), rating(2, 8, ['Drama'], '2003')]),
      ],
    ];

    for (const [label, makeProfile] of profiles) {
      it(`AC5a: preferredEras raises relevance of matching-decade films (${label})`, () => {
        const profile = makeProfile();
        const cands = [
          candidate(1, ['Comedy'], { year: 1995, voteAverage: 7 }),
          candidate(2, ['Comedy'], { year: 2015, voteAverage: 7 }),
        ];
        const base = scoreCandidates(cands, profile);
        const withEra = scoreCandidates(cands, profile, {
          relevanceFloor: DEFAULT_RELEVANCE_FLOOR,
          preferredEras: ['90s'],
        } as ScoreOptions);

        expect(relevanceOf(withEra, 1)).toBeGreaterThan(relevanceOf(base, 1) + 0.02);
        expect(relevanceOf(withEra, 1)).toBeLessThanOrEqual(1);
        expect(relevanceOf(withEra, 2)).toBeLessThanOrEqual(relevanceOf(base, 2) + EPS);
        expect(relevanceOf(withEra, 1)).toBeGreaterThan(relevanceOf(withEra, 2));
      });

      it(`AC5b: selectedVibes raises relevance of vibe-matching films (${label})`, () => {
        const profile = makeProfile();
        const cands = [
          candidate(1, ['Comedy'], {
            year: 2005,
            overview: 'A slow-burn story of a quiet town.',
            keywords: ['slow-burn'],
          }),
          candidate(2, ['Comedy'], {
            year: 2005,
            overview: 'A loud story of a busy town.',
            keywords: ['loud'],
          }),
        ];
        const base = scoreCandidates(cands, profile);
        const withVibe = scoreCandidates(cands, profile, {
          relevanceFloor: DEFAULT_RELEVANCE_FLOOR,
          selectedVibes: ['Slow-burn'],
        } as ScoreOptions);

        expect(relevanceOf(withVibe, 1)).toBeGreaterThan(relevanceOf(base, 1) + 0.02);
        expect(relevanceOf(withVibe, 1)).toBeLessThanOrEqual(1);
        expect(relevanceOf(withVibe, 2)).toBeLessThanOrEqual(relevanceOf(base, 2) + EPS);
        expect(relevanceOf(withVibe, 1)).toBeGreaterThan(relevanceOf(withVibe, 2));
      });
    }

    it('AC5c: empty era and vibe lists change nothing (guard)', () => {
      const profile = buildTasteProfile([rating(1, 9, ['Drama'], '2001')]);
      const cands = heavyPool(20, 3);
      const base = scoreCandidates(cands, profile);
      const empty = scoreCandidates(cands, profile, {
        preferredEras: [],
        selectedVibes: [],
      } as ScoreOptions);
      expect(empty.map((c) => c.scores.relevance)).toEqual(base.map((c) => c.scores.relevance));
    });
  });

  describe('issue-mandated end-to-end requirements', () => {
    it('AC6: a heavy rater (300 ratings, broad genres) gets wildcard supply and a bucket mix within +-1 of the level-30 mix', () => {
      const profile = buildTasteProfile(heavyRaterRatings());
      expect(profile.totalRatings).toBe(300);

      const scored = scoreCandidates(heavyPool(150, 11), profile);
      expect(scored.filter((c) => c.bucket === 'wildcard').length).toBeGreaterThan(0);

      const size = 20;
      const mix = mixForSerendipityLevel(30);
      const ranked = buildRankedList(scored, mix, size);
      expect(ranked).toHaveLength(size);

      const count = (b: string) => ranked.filter((r) => r.bucket === b).length;
      expect(Math.abs(count('safe_bet') - Math.round(size * mix.safe_bet))).toBeLessThanOrEqual(1);
      expect(Math.abs(count('stretch') - Math.round(size * mix.stretch))).toBeLessThanOrEqual(1);
      expect(Math.abs(count('wildcard') - Math.round(size * mix.wildcard))).toBeLessThanOrEqual(1);
    });

    it('AC7: scoreCandidates then buildRankedList never labels relevance < 0.45 as safe_bet', () => {
      const profile = buildTasteProfile(mixedTasteRatings(8080));
      const scored = scoreCandidates(mixedPool(200, 4242), profile);
      expect(scored.filter((c) => c.scores.relevance < 0.45).length).toBeGreaterThanOrEqual(15);

      for (const level of [0, 30, 60, 100]) {
        // Size 30 has ample supply; size 200 forces below-floor films into the tail.
        for (const size of [30, 200]) {
          const ranked = buildRankedList(scored, mixForSerendipityLevel(level), size);
          expect(ranked.length).toBeGreaterThan(0);
          for (const r of ranked) {
            if (r.scores.relevance < 0.45) {
              expect(r.bucket).not.toBe('safe_bet');
            }
          }
        }
      }
    });
  });
});
