import { describe, it, expect } from 'vitest';
import {
  buildTasteProfile,
  scoreCandidates,
  mixForSerendipityLevel,
  assignBucket,
  assignBuckets,
  candidateSimilarity,
  rankBucketMMR,
  buildRankedList,
  getDecade,
  DEFAULT_RELEVANCE_FLOOR,
} from '../scoring';
import type { Candidate, CandidateScores, ScoredCandidate, BucketMix } from '../types';
import type { UserRating } from '../../../types';

function createCandidate(
  id: number,
  title: string,
  overrides: Partial<Candidate['movie']> = {},
  seedNeighbour = true
): Candidate {
  return {
    movie: {
      id,
      title,
      overview: 'Overview for ' + title,
      poster_path: null,
      backdrop_path: null,
      release_date: '2015-06-01',
      vote_average: 7.5,
      vote_count: 5000,
      genres: [{ id: 1, name: 'Sci-Fi' }],
      director: 'Christopher Nolan',
      keywords: ['space', 'time'],
      ...overrides,
    },
    sources: ['seed_graph'],
    seedNeighbour,
  };
}

describe('Recommendation Scoring Module', () => {
  describe('getDecade', () => {
    it('parses 4-digit years from full dates or year strings', () => {
      expect(getDecade('2014-11-07')).toBe('2010s');
      expect(getDecade('1994')).toBe('1990s');
      expect(getDecade('1977-05-25')).toBe('1970s');
      expect(getDecade('2023')).toBe('2020s');
    });

    it('parses 2-digit decade strings', () => {
      expect(getDecade('70s')).toBe('1970s');
      expect(getDecade('90s')).toBe('1990s');
      expect(getDecade('20s')).toBe('2020s');
    });

    it('parses 4-digit decade strings ending in s like 1990s', () => {
      expect(getDecade('1990s')).toBe('1990s');
      expect(getDecade('2000s')).toBe('2000s');
      expect(getDecade('1980s')).toBe('1980s');
      expect(getDecade('2020s')).toBe('2020s');
    });

    it('returns null for invalid or missing inputs', () => {
      expect(getDecade(null)).toBeNull();
      expect(getDecade(undefined)).toBeNull();
      expect(getDecade('')).toBeNull();
      expect(getDecade('not a date')).toBeNull();
    });
  });

  describe('buildTasteProfile', () => {
    it('handles an empty profile', () => {
      const profile = buildTasteProfile([]);
      expect(profile.totalRatings).toBe(0);
      expect(profile.meanCenteredRating).toBe(0);
      expect(profile.genres.size).toBe(0);
      expect(profile.directors.size).toBe(0);
      expect(profile.keywords.size).toBe(0);
      expect(profile.decades.size).toBe(0);
      expect(profile.usualGenres.size).toBe(0);
      expect(profile.usualDecades.size).toBe(0);
    });

    it('handles a sparse profile (3 ratings) with positive and negative weighting', () => {
      const ratings: UserRating[] = [
        {
          movieId: 1,
          title: 'Interstellar',
          rating: 10, // weight = +1.0
          posterPath: null,
          year: '2014',
          genres: ['Sci-Fi', 'Drama'],
          director: 'Christopher Nolan',
          keywords: ['wormhole', 'black hole'],
          ratedAt: Date.now(),
        },
        {
          movieId: 2,
          title: 'Inception',
          rating: 9, // weight = (9 - 5.5) / 4.5 = +0.777...
          posterPath: null,
          year: '2010',
          genres: ['Sci-Fi', 'Action'],
          director: 'Christopher Nolan',
          keywords: ['dream', 'heist'],
          ratedAt: Date.now(),
        },
        {
          movieId: 3,
          title: 'The Room',
          rating: 1, // weight = (1 - 5.5) / 4.5 = -1.0
          posterPath: null,
          year: '2003',
          genres: ['Melodrama'],
          director: 'Tommy Wiseau',
          keywords: ['betrayal'],
          ratedAt: Date.now(),
        },
      ];

      const profile = buildTasteProfile(ratings);
      expect(profile.totalRatings).toBe(3);
      // Sci-Fi affinity should be positive (+1.0 + 0.777 = 1.777)
      expect(profile.genres.get('sci-fi')!).toBeGreaterThan(1.5);
      // Director Nolan should have boosted affinity (weight * 2)
      expect(profile.directors.get('christopher nolan')!).toBeGreaterThan(3.0);
      // Melodrama and Tommy Wiseau should have negative affinity
      expect(profile.genres.get('melodrama')!).toBeLessThan(0);
      expect(profile.directors.get('tommy wiseau')!).toBeLessThan(0);

      // Usual genres include Sci-Fi and Drama, but NOT Melodrama
      expect(profile.usualGenres.has('sci-fi')).toBe(true);
      expect(profile.usualGenres.has('drama')).toBe(true);
      expect(profile.usualGenres.has('melodrama')).toBe(false);

      // Usual decades include 2010s, but 2000s has negative weight
      expect(profile.usualDecades.has('2010s')).toBe(true);
      expect(profile.usualDecades.has('2000s')).toBe(false);
    });

    it('handles a heavy profile (50+ ratings)', () => {
      const ratings: UserRating[] = [];
      for (let i = 1; i <= 60; i++) {
        const ratingVal = i % 2 === 0 ? 8 : 4;
        ratings.push({
          movieId: i,
          title: `Movie ${i}`,
          rating: ratingVal,
          posterPath: null,
          year: `${1970 + (i % 50)}`,
          genres: [i % 3 === 0 ? 'Action' : 'Drama', 'Thriller'],
          director: `Director ${i % 10}`,
          keywords: [`theme_${i % 5}`],
          ratedAt: Date.now() - i * 1000,
        });
      }

      const profile = buildTasteProfile(ratings);
      expect(profile.totalRatings).toBe(60);
      expect(profile.genres.size).toBeGreaterThan(0);
      expect(profile.directors.size).toBe(10);
      expect(Number.isFinite(profile.meanCenteredRating)).toBe(true);
    });

    it('handles an all-negative profile', () => {
      const ratings: UserRating[] = [
        {
          movieId: 1,
          title: 'Flop 1',
          rating: 1,
          posterPath: null,
          year: '2020',
          genres: ['Horror'],
          director: 'Bad Director',
          keywords: ['gore'],
          ratedAt: Date.now(),
        },
        {
          movieId: 2,
          title: 'Flop 2',
          rating: 2,
          posterPath: null,
          year: '2021',
          genres: ['Horror', 'Comedy'],
          director: 'Bad Director',
          keywords: ['cheesy'],
          ratedAt: Date.now(),
        },
        {
          movieId: 3,
          title: 'Flop 3',
          rating: 1,
          posterPath: null,
          year: '2019',
          genres: ['Comedy'],
          director: 'Other Bad',
          ratedAt: Date.now(),
        },
      ];

      const profile = buildTasteProfile(ratings);
      expect(profile.totalRatings).toBe(3);
      expect(profile.meanCenteredRating).toBeLessThan(-0.7);
      expect(profile.usualGenres.size).toBe(0);
      expect(profile.usualDecades.size).toBe(0);
      expect(profile.genres.get('horror')!).toBeLessThan(0);
      expect(profile.genres.get('comedy')!).toBeLessThan(0);
    });

    it('clamps rating weights strictly to [-1, 1]', () => {
      const ratings: UserRating[] = [
        {
          movieId: 1,
          title: 'Extreme High Rating',
          rating: 20, // (20 - 5.5) / 4.5 = 3.222, clamps to +1.0
          posterPath: null,
          genres: ['Action'],
          ratedAt: Date.now(),
        },
        {
          movieId: 2,
          title: 'Extreme Low Rating',
          rating: -10, // (-10 - 5.5) / 4.5 = -3.444, clamps to -1.0
          posterPath: null,
          genres: ['Comedy'],
          ratedAt: Date.now(),
        },
      ];

      const profile = buildTasteProfile(ratings);
      expect(profile.genres.get('action')).toBe(1.0);
      expect(profile.genres.get('comedy')).toBe(-1.0);
      expect(profile.meanCenteredRating).toBe(0);
    });
  });

  describe('scoreCandidates', () => {
    it('scores candidates with finite values strictly within 0..1 for empty profile', () => {
      const profile = buildTasteProfile([]);
      const candidates: Candidate[] = [
        createCandidate(1, 'Good Starter', { vote_average: 8.5, vote_count: 10000 }),
        createCandidate(2, 'Average Starter', { vote_average: 6.0, vote_count: 5000 }),
        createCandidate(3, 'Low Starter', { vote_average: 4.0, vote_count: 1000 }),
      ];

      const scored = scoreCandidates(candidates, profile);
      expect(scored.length).toBe(3);
      for (const sc of scored) {
        expect(sc.scores.relevance).toBeGreaterThanOrEqual(0);
        expect(sc.scores.relevance).toBeLessThanOrEqual(1);
        expect(sc.scores.novelty).toBeGreaterThanOrEqual(0);
        expect(sc.scores.novelty).toBeLessThanOrEqual(1);
        expect(sc.scores.unexpectedness).toBeGreaterThanOrEqual(0);
        expect(sc.scores.unexpectedness).toBeLessThanOrEqual(1);
        expect(sc.scores.serendipity).toBeGreaterThanOrEqual(0);
        expect(sc.scores.serendipity).toBeLessThanOrEqual(1);
        expect(['safe_bet', 'stretch', 'wildcard']).toContain(sc.bucket);
      }
    });

    it('boosts relevance for sparse profile matching favorite genre and director', () => {
      const ratings: UserRating[] = [
        {
          movieId: 10,
          title: 'Inception',
          rating: 10,
          posterPath: null,
          genres: ['Sci-Fi', 'Action'],
          director: 'Christopher Nolan',
          ratedAt: Date.now(),
        },
        {
          movieId: 11,
          title: 'Interstellar',
          rating: 10,
          posterPath: null,
          genres: ['Sci-Fi'],
          director: 'Christopher Nolan',
          ratedAt: Date.now(),
        },
        {
          movieId: 12,
          title: 'Oppenheimer',
          rating: 9,
          posterPath: null,
          genres: ['Drama', 'History'],
          director: 'Christopher Nolan',
          ratedAt: Date.now(),
        },
      ];
      const profile = buildTasteProfile(ratings);

      const candidateMatch = createCandidate(101, 'Tenet', {
        genres: [{ id: 1, name: 'Sci-Fi' }, { id: 2, name: 'Action' }],
        director: 'Christopher Nolan',
        vote_average: 7.5,
      });

      const candidateUnrelated = createCandidate(102, 'Random Romance', {
        genres: [{ id: 3, name: 'Romance' }],
        director: 'Someone Else',
        vote_average: 7.5,
      });

      const scored = scoreCandidates([candidateMatch, candidateUnrelated], profile);
      const scoredMatch = scored.find((c) => c.movie.id === 101)!;
      const scoredUnrelated = scored.find((c) => c.movie.id === 102)!;

      expect(scoredMatch.scores.relevance).toBeGreaterThan(scoredUnrelated.scores.relevance);
      expect(scoredMatch.scores.relevance).toBeGreaterThan(0.7);
    });

    it('enforces that in an all-negative profile, candidates are below floor and never a stretch or wildcard', () => {
      const ratings: UserRating[] = [
        {
          movieId: 1,
          title: 'Bad 1',
          rating: 1,
          posterPath: null,
          genres: ['Horror'],
          director: 'Bad Dir',
          ratedAt: Date.now(),
        },
        {
          movieId: 2,
          title: 'Bad 2',
          rating: 1,
          posterPath: null,
          genres: ['Horror'],
          director: 'Bad Dir',
          ratedAt: Date.now(),
        },
        {
          movieId: 3,
          title: 'Bad 3',
          rating: 2,
          posterPath: null,
          genres: ['Horror'],
          director: 'Bad Dir',
          ratedAt: Date.now(),
        },
      ];
      const profile = buildTasteProfile(ratings);

      const candidates: Candidate[] = [
        createCandidate(101, 'Hated Trait Movie', {
          genres: [{ id: 1, name: 'Horror' }],
          director: 'Bad Dir',
          vote_average: 7.0,
          vote_count: 500,
        }, false),
        createCandidate(102, 'Unrelated Movie', {
          genres: [{ id: 2, name: 'Sci-Fi' }],
          director: 'Other Dir',
          vote_average: 8.0,
          vote_count: 200,
        }, false),
      ];

      const scored = scoreCandidates(candidates, profile);
      for (const sc of scored) {
        expect(sc.scores.relevance).toBeLessThan(DEFAULT_RELEVANCE_FLOOR);
        expect(sc.scores.serendipity).toBe(0);
        expect(sc.bucket).toBe('below_floor');
        expect(sc.bucket).not.toBe('safe_bet');
        expect(sc.bucket).not.toBe('stretch');
        expect(sc.bucket).not.toBe('wildcard');
      }
    });

    it('calculates novelty as inverse popularity / vote-count percentile within the pool', () => {
      const profile = buildTasteProfile([]);
      const candidates: Candidate[] = [
        createCandidate(1, 'Blockbuster', { vote_count: 50000 }),
        createCandidate(2, 'Popular', { vote_count: 15000 }),
        createCandidate(3, 'Indie', { vote_count: 3000 }),
        createCandidate(4, 'Hidden Gem', { vote_count: 100 }),
      ];

      const scored = scoreCandidates(candidates, profile);
      const novelty1 = scored.find((c) => c.movie.id === 1)!.scores.novelty;
      const novelty2 = scored.find((c) => c.movie.id === 2)!.scores.novelty;
      const novelty3 = scored.find((c) => c.movie.id === 3)!.scores.novelty;
      const novelty4 = scored.find((c) => c.movie.id === 4)!.scores.novelty;

      // Hidden gem (lowest votes) should have highest novelty (1.0)
      expect(novelty4).toBe(1.0);
      // Blockbuster (highest votes) should have lowest novelty (0.0)
      expect(novelty1).toBe(0.0);
      // Strictly monotonic ordering of novelty
      expect(novelty4).toBeGreaterThan(novelty3);
      expect(novelty3).toBeGreaterThan(novelty2);
      expect(novelty2).toBeGreaterThan(novelty1);
    });

    it('awards unexpectedness bonus when seedNeighbour is false', () => {
      const profile = buildTasteProfile([
        {
          movieId: 1,
          title: 'Favorite',
          rating: 10,
          posterPath: null,
          year: '2010',
          genres: ['Sci-Fi'],
          ratedAt: Date.now(),
        },
      ]);

      const seedCandidate = createCandidate(1, 'Seed Neighbour', {
        genres: [{ id: 1, name: 'Sci-Fi' }],
        release_date: '2012-01-01',
      }, true);

      const nonSeedCandidate = createCandidate(2, 'Non-Seed Discovery', {
        genres: [{ id: 1, name: 'Sci-Fi' }],
        release_date: '2012-01-01',
      }, false);

      const scored = scoreCandidates([seedCandidate, nonSeedCandidate], profile);
      const uSeed = scored.find((c) => c.movie.id === 1)!.scores.unexpectedness;
      const uNonSeed = scored.find((c) => c.movie.id === 2)!.scores.unexpectedness;

      expect(uNonSeed).toBeGreaterThan(uSeed);
    });

    it('relevance floor rule: sets serendipity to 0 and bucket to below_floor when relevance < floor', () => {
      const scoresBelowFloor = {
        relevance: 0.44, // below 0.45
        novelty: 0.95,
        unexpectedness: 0.95,
        serendipity: 0,
      };

      const bucket = assignBucket(scoresBelowFloor, 0.45);
      expect(bucket).toBe('below_floor');
      expect(bucket).not.toBe('safe_bet');
      expect(bucket).not.toBe('stretch');
      expect(bucket).not.toBe('wildcard');

      const scoresAboveFloor = {
        relevance: 0.75,
        novelty: 0.8,
        unexpectedness: 0.7,
        serendipity: 0.75 * (0.5 * 0.8 + 0.5 * 0.7),
      };
      const bucketAbove = assignBucket(scoresAboveFloor, 0.45);
      expect(bucketAbove).toBe('wildcard');
    });

    it('handles heavy profile without NaN or Infinity', () => {
      const ratings: UserRating[] = [];
      for (let i = 1; i <= 100; i++) {
        ratings.push({
          movieId: i,
          title: `Film ${i}`,
          rating: 10,
          posterPath: null,
          genres: ['Sci-Fi', 'Action', 'Thriller'],
          director: 'Popular Director',
          keywords: ['ai', 'future', 'robot'],
          ratedAt: Date.now(),
        });
      }
      const profile = buildTasteProfile(ratings);

      const candidate = createCandidate(500, 'Heavy Candidate', {
        genres: [{ id: 1, name: 'Sci-Fi' }],
        director: 'Popular Director',
        keywords: ['ai'],
      });

      const [scored] = scoreCandidates([candidate], profile);
      expect(Number.isFinite(scored.scores.relevance)).toBe(true);
      expect(Number.isFinite(scored.scores.novelty)).toBe(true);
      expect(Number.isFinite(scored.scores.unexpectedness)).toBe(true);
      expect(Number.isFinite(scored.scores.serendipity)).toBe(true);
      expect(scored.scores.relevance).toBeLessThanOrEqual(1);
      expect(scored.scores.relevance).toBeGreaterThanOrEqual(0);
    });
  });

  describe('mixForSerendipityLevel', () => {
    it('produces about 50/35/15 for level 30', () => {
      const mix = mixForSerendipityLevel(30);
      expect(mix.safe_bet).toBeCloseTo(0.50, 2);
      expect(mix.stretch).toBeCloseTo(0.35, 2);
      expect(mix.wildcard).toBeCloseTo(0.15, 2);
      expect(mix.safe_bet + mix.stretch + mix.wildcard).toBeCloseTo(1.0, 5);
    });

    it('is mostly safe for level 0', () => {
      const mix = mixForSerendipityLevel(0);
      expect(mix.safe_bet).toBeGreaterThanOrEqual(0.80);
      expect(mix.wildcard).toBeLessThanOrEqual(0.05);
      expect(mix.safe_bet + mix.stretch + mix.wildcard).toBeCloseTo(1.0, 5);
    });

    it('has at most 40% wildcards for level 100', () => {
      const mix = mixForSerendipityLevel(100);
      expect(mix.wildcard).toBeLessThanOrEqual(0.40);
      expect(mix.wildcard).toBeGreaterThanOrEqual(0.35);
      expect(mix.safe_bet + mix.stretch + mix.wildcard).toBeCloseTo(1.0, 5);
    });

    it('clamps levels gracefully and always sums to 1', () => {
      const mixNegative = mixForSerendipityLevel(-20);
      const mixOver = mixForSerendipityLevel(150);
      const mixMid = mixForSerendipityLevel(60);

      expect(mixNegative.safe_bet + mixNegative.stretch + mixNegative.wildcard).toBeCloseTo(1.0, 5);
      expect(mixOver.safe_bet + mixOver.stretch + mixOver.wildcard).toBeCloseTo(1.0, 5);
      expect(mixMid.safe_bet + mixMid.stretch + mixMid.wildcard).toBeCloseTo(1.0, 5);
    });
  });

  describe('assignBuckets', () => {
    it('assigns percentile-relative buckets to above-floor candidates and below_floor to weak matches', () => {
      const items: Array<{ scores: CandidateScores }> = [
        {
          scores: { relevance: 0.8, novelty: 0.5, unexpectedness: 0.5, serendipity: 0.32 },
        },
        {
          scores: { relevance: 0.8, novelty: 0.7, unexpectedness: 0.3, serendipity: 0.28 },
        },
        {
          scores: { relevance: 0.85, novelty: 0.2, unexpectedness: 0.1, serendipity: 0.13 },
        },
        {
          scores: { relevance: 0.35, novelty: 0.9, unexpectedness: 0.9, serendipity: 0 },
        },
      ];

      const bucketed = assignBuckets(items);
      expect(bucketed[0].bucket).toBe('wildcard');
      expect(bucketed[1].bucket).toBe('stretch');
      expect(bucketed[2].bucket).toBe('safe_bet');
      expect(bucketed[3].bucket).toBe('below_floor'); // below floor
    });
  });

  describe('candidateSimilarity', () => {
    it('calculates similarity based on director, genre, and keyword overlap', () => {
      const a = createCandidate(1, 'Film A', {
        director: 'David Fincher',
        genres: [{ id: 1, name: 'Thriller' }, { id: 2, name: 'Mystery' }],
        keywords: ['investigation', 'serial killer'],
      });

      const b = createCandidate(2, 'Film B', {
        director: 'David Fincher',
        genres: [{ id: 1, name: 'Thriller' }, { id: 3, name: 'Crime' }],
        keywords: ['investigation', 'cop'],
      });

      const c = createCandidate(3, 'Film C', {
        director: 'Wes Anderson',
        genres: [{ id: 4, name: 'Comedy' }],
        keywords: ['pastel'],
      });

      const simAB = candidateSimilarity(a, b);
      const simAC = candidateSimilarity(a, c);

      expect(simAB).toBeGreaterThan(0.5); // same director + shared genre + shared keyword
      expect(simAC).toBe(0); // nothing in common
    });
  });

  describe('MMR and diversity', () => {
    it('measurably reduces same-director/same-genre runs compared with sorting by score alone (asserted on a fixture)', () => {
      // Fixture: 5 Nolan Sci-Fi movies with high scores, followed by 5 diverse movies
      const fixture: ScoredCandidate[] = [
        {
          ...createCandidate(1, 'Nolan Sci-Fi 1', { director: 'Christopher Nolan', genres: [{ id: 1, name: 'Sci-Fi' }] }),
          scores: { relevance: 0.95, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(2, 'Nolan Sci-Fi 2', { director: 'Christopher Nolan', genres: [{ id: 1, name: 'Sci-Fi' }] }),
          scores: { relevance: 0.94, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(3, 'Nolan Sci-Fi 3', { director: 'Christopher Nolan', genres: [{ id: 1, name: 'Sci-Fi' }] }),
          scores: { relevance: 0.93, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(4, 'Nolan Sci-Fi 4', { director: 'Christopher Nolan', genres: [{ id: 1, name: 'Sci-Fi' }] }),
          scores: { relevance: 0.92, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(5, 'Nolan Sci-Fi 5', { director: 'Christopher Nolan', genres: [{ id: 1, name: 'Sci-Fi' }] }),
          scores: { relevance: 0.91, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(6, 'Miyazaki Animation', { director: 'Hayao Miyazaki', genres: [{ id: 2, name: 'Animation' }] }),
          scores: { relevance: 0.90, novelty: 0.6, unexpectedness: 0.4, serendipity: 0.45 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(7, 'Tarantino Crime', { director: 'Quentin Tarantino', genres: [{ id: 3, name: 'Crime' }] }),
          scores: { relevance: 0.89, novelty: 0.6, unexpectedness: 0.4, serendipity: 0.44 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(8, 'Bong Thriller', { director: 'Bong Joon-ho', genres: [{ id: 4, name: 'Thriller' }] }),
          scores: { relevance: 0.88, novelty: 0.7, unexpectedness: 0.5, serendipity: 0.50 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(9, 'Gerwig Drama', { director: 'Greta Gerwig', genres: [{ id: 5, name: 'Drama' }] }),
          scores: { relevance: 0.87, novelty: 0.7, unexpectedness: 0.5, serendipity: 0.49 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(10, 'Villeneuve Sci-Fi', { director: 'Denis Villeneuve', genres: [{ id: 1, name: 'Sci-Fi' }] }),
          scores: { relevance: 0.86, novelty: 0.7, unexpectedness: 0.4, serendipity: 0.47 },
          bucket: 'safe_bet',
        },
      ];

      // Score-only sort
      const scoreOnlySorted = [...fixture].sort((a, b) => b.scores.relevance - a.scores.relevance);

      // Measure max same-director run in score-only sort
      const maxSameDirectorRun = (list: ScoredCandidate[]): number => {
        let maxRun = 0;
        let currentRun = 0;
        let lastDirector: string | undefined = undefined;
        for (const item of list) {
          if (item.movie.director && item.movie.director === lastDirector) {
            currentRun++;
          } else {
            currentRun = 1;
            lastDirector = item.movie.director;
          }
          if (currentRun > maxRun) maxRun = currentRun;
        }
        return maxRun;
      };

      const scoreOnlyRun = maxSameDirectorRun(scoreOnlySorted);
      expect(scoreOnlyRun).toBe(5); // Nolan Sci-Fi 1 through 5 in a row!

      // Measure max same-genre run in score-only sort
      const maxSameGenreRun = (list: ScoredCandidate[]): number => {
        let maxRun = 0;
        let currentRun = 0;
        let lastGenres: string[] = [];
        for (const item of list) {
          const itemGenres = (item.movie.genres || []).map((g) =>
            (typeof g === 'string' ? g : g.name).toLowerCase()
          );
          const sharesGenre = itemGenres.some((g) => lastGenres.includes(g));
          if (sharesGenre && itemGenres.length > 0) {
            currentRun++;
          } else {
            currentRun = 1;
            lastGenres = itemGenres;
          }
          if (currentRun > maxRun) maxRun = currentRun;
        }
        return maxRun;
      };

      const scoreOnlyGenreRun = maxSameGenreRun(scoreOnlySorted);
      expect(scoreOnlyGenreRun).toBe(5); // Sci-Fi 1 through 5 in a row!

      // MMR sort with lambda 0.7
      const mmrSorted = rankBucketMMR(fixture, (c) => c.scores.relevance, 0.7);
      const mmrRun = maxSameDirectorRun(mmrSorted);

      // Full MMR compares each pick with ALL already-selected items. Once the 5 diverse films are
      // exhausted, the 4 remaining Nolan films cannot be separated by anything, so the whole-list
      // director run is 4. The old `<= 2` whole-list bound only held under the window-2 MMR
      // (which forgot earlier picks) and is replaced by the assertions below.
      expect(mmrRun).toBeLessThan(scoreOnlyRun);

      // While diverse films remain (the first 6 slots: Nolan 1 plus the 5 diverse films), neither
      // the same director nor the same genre may repeat back to back.
      const diversePrefix = mmrSorted.slice(0, 6);
      expect(maxSameDirectorRun(diversePrefix)).toBe(1);
      expect(maxSameGenreRun(diversePrefix)).toBe(1);
      expect(maxSameDirectorRun(diversePrefix)).toBeLessThan(scoreOnlyRun);
      expect(maxSameGenreRun(diversePrefix)).toBeLessThan(scoreOnlyGenreRun);

      // The tail is the exhausted Nolan block, not an interleaving artifact.
      expect(mmrSorted.slice(6).map((c) => c.movie.director)).toEqual(
        Array(4).fill('Christopher Nolan')
      );
    });

    it('does not repeat the director within 3 positions while diverse items remain (comparison of lambda=1 against lambda=0.7)', () => {
      // 3 items with Director Nolan having highest scores, followed by 4 items with diverse directors
      const fixture: ScoredCandidate[] = [
        {
          ...createCandidate(1, 'Nolan Film 1', { director: 'Christopher Nolan', genres: [{ id: 1, name: 'Sci-Fi' }] }),
          scores: { relevance: 0.99, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(2, 'Nolan Film 2', { director: 'Christopher Nolan', genres: [{ id: 2, name: 'Action' }] }),
          scores: { relevance: 0.98, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(3, 'Nolan Film 3', { director: 'Christopher Nolan', genres: [{ id: 3, name: 'Drama' }] }),
          scores: { relevance: 0.97, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(4, 'Tarantino Film', { director: 'Quentin Tarantino', genres: [{ id: 4, name: 'Crime' }] }),
          scores: { relevance: 0.94, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(5, 'Miyazaki Film', { director: 'Hayao Miyazaki', genres: [{ id: 5, name: 'Animation' }] }),
          scores: { relevance: 0.93, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(6, 'Bong Film', { director: 'Bong Joon-ho', genres: [{ id: 6, name: 'Thriller' }] }),
          scores: { relevance: 0.92, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
        {
          ...createCandidate(7, 'Gerwig Film', { director: 'Greta Gerwig', genres: [{ id: 7, name: 'Comedy' }] }),
          scores: { relevance: 0.91, novelty: 0.5, unexpectedness: 0.2, serendipity: 0.35 },
          bucket: 'safe_bet',
        },
      ];

      const mixAllSafe: BucketMix = { safe_bet: 1, stretch: 0, wildcard: 0 };

      // Helper to check if any director repeats within maxDistance positions (i.e. distance <= maxDistance)
      const hasDirectorRepeatWithin = (list: ScoredCandidate[], maxDistance = 3): boolean => {
        for (let i = 0; i < list.length; i++) {
          const dirA = list[i].movie.director;
          if (!dirA) continue;
          for (let j = i + 1; j <= Math.min(i + maxDistance, list.length - 1); j++) {
            if (list[j].movie.director === dirA) {
              return true;
            }
          }
        }
        return false;
      };

      // With lambda = 1 (pure score, no diversity penalty), Nolan repeats consecutively (within 3 positions)
      const listLambda1 = buildRankedList(fixture, mixAllSafe, 6, 1.0);
      expect(hasDirectorRepeatWithin(listLambda1, 3)).toBe(true);

      // With lambda = 0.7, Nolan must not repeat within 3 positions while diverse items remain
      const listLambda07 = buildRankedList(fixture, mixAllSafe, 6, 0.7);
      expect(hasDirectorRepeatWithin(listLambda07, 3)).toBe(false);

      // Verify the first 5 items under lambda=0.7 are all distinct directors
      const directors = listLambda07.slice(0, 5).map((c) => c.movie.director);
      expect(new Set(directors).size).toBe(5);
    });
  });

  describe('buildRankedList', () => {
    const mixLevel30: BucketMix = {
      safe_bet: 0.50,
      stretch: 0.35,
      wildcard: 0.15,
    };

    function generatePool(safeCount: number, stretchCount: number, wildcardCount: number): ScoredCandidate[] {
      const pool: ScoredCandidate[] = [];
      let id = 1;

      for (let i = 0; i < safeCount; i++) {
        pool.push({
          ...createCandidate(id++, `Safe Film ${i + 1}`, {
            director: `Director S${i % 4}`,
            genres: [{ id: 10 + (i % 3), name: `SafeGenre_${i % 3}` }],
          }),
          scores: { relevance: 0.85 - i * 0.01, novelty: 0.3, unexpectedness: 0.2, serendipity: 0.21 },
          bucket: 'safe_bet',
        });
      }

      for (let i = 0; i < stretchCount; i++) {
        pool.push({
          ...createCandidate(id++, `Stretch Film ${i + 1}`, {
            director: `Director St${i % 4}`,
            genres: [{ id: 20 + (i % 3), name: `StretchGenre_${i % 3}` }],
          }, false),
          scores: { relevance: 0.75 - i * 0.01, novelty: 0.6, unexpectedness: 0.5, serendipity: 0.41 - i * 0.005 },
          bucket: 'stretch',
        });
      }

      for (let i = 0; i < wildcardCount; i++) {
        pool.push({
          ...createCandidate(id++, `Wildcard Film ${i + 1}`, {
            director: `Director W${i % 4}`,
            genres: [{ id: 30 + (i % 3), name: `WildGenre_${i % 3}` }],
          }, false),
          scores: { relevance: 0.65 - i * 0.01, novelty: 0.8, unexpectedness: 0.85, serendipity: 0.53 - i * 0.005 },
          bucket: 'wildcard',
        });
      }

      return pool;
    }

    it('assigns sequential ranks 1..n and returns output size <= requested size', () => {
      const pool = generatePool(15, 10, 5);
      const ranked = buildRankedList(pool, mixLevel30, 20);

      expect(ranked.length).toBe(20);
      ranked.forEach((item, index) => {
        expect(item.rank).toBe(index + 1);
      });
    });

    it('handles requests where pool is smaller than requested size', () => {
      const pool = generatePool(4, 2, 1); // 7 total
      const ranked = buildRankedList(pool, mixLevel30, 20);

      expect(ranked.length).toBe(7);
      expect(ranked[0].rank).toBe(1);
      expect(ranked[6].rank).toBe(7);
    });

    it('removes duplicate movie IDs from the input', () => {
      const pool = generatePool(5, 5, 5);
      // Duplicate first candidate
      pool.push({ ...pool[0] });
      pool.push({ ...pool[1] });

      const ranked = buildRankedList(pool, mixLevel30, 15);
      const ids = ranked.map((r) => r.movie.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);
    });

    it('interleaves buckets so the top 5 contain at least 3 safe bets and 1 stretch when available', () => {
      const pool = generatePool(15, 10, 5);
      const ranked = buildRankedList(pool, mixLevel30, 20);

      const top5 = ranked.slice(0, 5);
      const safeBetsInTop5 = top5.filter((r) => r.bucket === 'safe_bet').length;
      const stretchesInTop5 = top5.filter((r) => r.bucket === 'stretch').length;

      expect(safeBetsInTop5).toBeGreaterThanOrEqual(3);
      expect(stretchesInTop5).toBeGreaterThanOrEqual(1);
    });

    it('maintains the bucket mix within ±1 item of requested mix when supply allows', () => {
      const pool = generatePool(20, 15, 10);
      const size = 20;
      const ranked = buildRankedList(pool, mixLevel30, size);

      // Expected for mix 50 / 35 / 15 with size 20:
      // safe: 10, stretch: 7, wildcard: 3
      const safeCount = ranked.filter((r) => r.bucket === 'safe_bet').length;
      const stretchCount = ranked.filter((r) => r.bucket === 'stretch').length;
      const wildcardCount = ranked.filter((r) => r.bucket === 'wildcard').length;

      expect(Math.abs(safeCount - 10)).toBeLessThanOrEqual(1);
      expect(Math.abs(stretchCount - 7)).toBeLessThanOrEqual(1);
      expect(Math.abs(wildcardCount - 3)).toBeLessThanOrEqual(1);
      expect(safeCount + stretchCount + wildcardCount).toBe(20);
    });

    it('when a bucket runs short, fills from the next bucket', () => {
      // Wildcard has only 1 item, but 20 items requested with 15% wildcards (needs 3)
      const pool = generatePool(15, 10, 1);
      const ranked = buildRankedList(pool, mixLevel30, 20);

      expect(ranked.length).toBe(20);
      const wildCount = ranked.filter((r) => r.bucket === 'wildcard').length;
      expect(wildCount).toBe(1); // all available wildcards used

      // Remaining slots were successfully filled from other buckets
      const total = ranked.length;
      expect(total).toBe(20);
      ranked.forEach((item, idx) => {
        expect(item.rank).toBe(idx + 1);
      });
    });

    it('when stretch runs short, fills from safe_bet before wildcard', () => {
      // 10 safe, 1 stretch, 10 wildcard; size 10 with mix 10/50/40 targets 1 safe, 5 stretch, 4 wildcard.
      // Stretch supply is 1, so the deficit of 4 is filled by the fallback order ['safe_bet', 'wildcard'].
      // The top-5 rule alone would only require 3 safe bets, so the exact counts show the fill source.
      const pool = generatePool(10, 1, 10);
      const customMix: BucketMix = { safe_bet: 0.1, stretch: 0.5, wildcard: 0.4 };
      const ranked = buildRankedList(pool, customMix, 10);

      const count = (b: string) => ranked.filter((r) => r.bucket === b).length;
      expect(ranked.length).toBe(10);
      expect(count('stretch')).toBe(1); // all available stretches used
      expect(count('safe_bet')).toBe(5); // 1 target + 4 filled from safe_bet
      expect(count('wildcard')).toBe(4); // untouched target: wildcard did not supply the fill
    });

    describe('top-5 rule across serendipity levels and list sizes', () => {
      const levels = [0, 30, 60, 100];
      const sizes = [5, 10];

      for (const level of levels) {
        for (const size of sizes) {
          it(`enforces at least min(3, safe supply) safe bets and min(1, stretch supply) stretches at level ${level} for size ${size}`, () => {
            const pool = generatePool(15, 10, 5);
            const mix = mixForSerendipityLevel(level);
            const ranked = buildRankedList(pool, mix, size);

            expect(ranked.length).toBe(size);

            const top5 = ranked.slice(0, Math.min(5, size));
            const safeCount = top5.filter((r) => r.bucket === 'safe_bet').length;
            const stretchCount = top5.filter((r) => r.bucket === 'stretch').length;

            expect(safeCount).toBeGreaterThanOrEqual(3);
            expect(stretchCount).toBeGreaterThanOrEqual(1);
          });
        }
      }

      it('corrects level 100 at size 5 from STTWW to containing 3 safe bets and 1 stretch', () => {
        const pool = generatePool(10, 10, 10);
        const mix = mixForSerendipityLevel(100);
        const ranked = buildRankedList(pool, mix, 5);

        const top5 = ranked.slice(0, 5);
        const safeCount = top5.filter((r) => r.bucket === 'safe_bet').length;
        const stretchCount = top5.filter((r) => r.bucket === 'stretch').length;

        expect(safeCount).toBe(3);
        expect(stretchCount).toBe(1);
      });

      it('corrects level 30 at size 5 from SSTTW to containing 3 safe bets and 1 stretch', () => {
        const pool = generatePool(10, 10, 10);
        const mix = mixForSerendipityLevel(30);
        const ranked = buildRankedList(pool, mix, 5);

        const top5 = ranked.slice(0, 5);
        const safeCount = top5.filter((r) => r.bucket === 'safe_bet').length;
        const stretchCount = top5.filter((r) => r.bucket === 'stretch').length;

        expect(safeCount).toBe(3);
        expect(stretchCount).toBe(1);
      });

      it('respects supply constraint when safe supply < 3', () => {
        const pool = generatePool(2, 5, 5); // only 2 safe bets available
        const mix = mixForSerendipityLevel(30);
        const ranked = buildRankedList(pool, mix, 5);

        const top5 = ranked.slice(0, 5);
        const safeCount = top5.filter((r) => r.bucket === 'safe_bet').length;
        const stretchCount = top5.filter((r) => r.bucket === 'stretch').length;

        expect(safeCount).toBe(2); // min(3, safe supply = 2)
        expect(stretchCount).toBeGreaterThanOrEqual(1);
      });

      it('respects supply constraint when stretch supply < 1', () => {
        const pool = generatePool(5, 0, 5); // 0 stretch available
        const mix = mixForSerendipityLevel(30);
        const ranked = buildRankedList(pool, mix, 5);

        const top5 = ranked.slice(0, 5);
        const safeCount = top5.filter((r) => r.bucket === 'safe_bet').length;
        const stretchCount = top5.filter((r) => r.bucket === 'stretch').length;

        expect(safeCount).toBeGreaterThanOrEqual(3);
        expect(stretchCount).toBe(0); // min(1, stretch supply = 0)
      });
    });

    it('guards mix shares with negative, NaN, and non-finite values and renormalizes', () => {
      const pool = generatePool(10, 10, 10);
      const invalidMix: BucketMix = {
        safe_bet: -0.5,
        stretch: NaN,
        wildcard: 0.5,
      };
      // Should guard: safe_bet -> 0, stretch -> 0, wildcard -> 0.5 => normalized to 100% wildcard
      const ranked = buildRankedList(pool, invalidMix, 5);
      expect(ranked.length).toBe(5);
      for (const item of ranked) {
        expect(item.bucket).toBe('wildcard');
      }
    });

    it('guards all-zero or invalid mix gracefully defaulting to safe_bet', () => {
      const pool = generatePool(10, 10, 10);
      const zeroMix: BucketMix = {
        safe_bet: 0,
        stretch: 0,
        wildcard: 0,
      };
      const ranked = buildRankedList(pool, zeroMix, 5);
      expect(ranked.length).toBe(5);
      for (const item of ranked) {
        expect(item.bucket).toBe('safe_bet');
      }
    });

    it('is completely deterministic for identical inputs', () => {
      const pool = generatePool(10, 8, 4);
      const run1 = buildRankedList(pool, mixLevel30, 15);
      const run2 = buildRankedList(pool, mixLevel30, 15);

      expect(run1.map((r) => r.movie.id)).toEqual(run2.map((r) => r.movie.id));
      expect(run1.map((r) => r.scores.serendipity)).toEqual(run2.map((r) => r.scores.serendipity));
      expect(run1.map((r) => r.rank)).toEqual(run2.map((r) => r.rank));
    });

    it('handles size 0 or negative gracefully', () => {
      const pool = generatePool(5, 5, 5);
      expect(buildRankedList(pool, mixLevel30, 0)).toEqual([]);
      expect(buildRankedList(pool, mixLevel30, -5)).toEqual([]);
      expect(buildRankedList([], mixLevel30, 10)).toEqual([]);
    });
  });
});
