// FROZEN acceptance tests for CIN-28 (owner report CIN-27: "8 suggestions became 4").
// Do not edit or weaken these tests. Implement until they pass.
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { credentialStore } from '../../credentialStore';
import { clearTmdbCache, getCandidateRecommendationPool } from '../../tmdb';
import type { UserRating } from '../../../types';

// The AI providers only see the first 40 pool items (openRouterProvider/geminiProvider).
const AI_WINDOW = 40;

// Every distinct request URL gets its own id range, so sources never overlap by accident.
function idBaseFor(url: URL, ranges: Map<string, number>): number {
  const key = url.pathname + url.search;
  if (!ranges.has(key)) ranges.set(key, (ranges.size + 1) * 1000);
  return ranges.get(key)!;
}

function film(id: number, year: number) {
  return {
    id,
    title: `Film ${id}`,
    overview: '',
    poster_path: `/p${id}.jpg`,
    backdrop_path: null,
    release_date: `${year}-06-01`,
    vote_average: 7.5,
    vote_count: 1000,
    genre_ids: [18],
  };
}

function page(base: number, year: number) {
  return { results: Array.from({ length: 20 }, (_, i) => film(base + i, year)) };
}

// A cinephile profile like the owner's: many highly rated films.
const ratings: UserRating[] = Array.from({ length: 12 }, (_, i) => ({
  movieId: 900000 + i,
  title: `Rated ${i}`,
  rating: 8 + (i % 3),
  posterPath: null,
  genres: ['Drama', 'Animation'],
  ratedAt: 1700000000000 + i,
}));

function installHandlers() {
  const ranges = new Map<string, number>();
  server.use(
    http.get('https://api.themoviedb.org/3/discover/movie', ({ request }) => {
      const url = new URL(request.url);
      const gte = url.searchParams.get('primary_release_date.gte');
      // Era-targeted queries return films from that era; every other query returns pre-2000 classics.
      const year = gte ? Number(gte.slice(0, 4)) + 3 : 1985;
      return HttpResponse.json(page(idBaseFor(url, ranges), year));
    }),
    http.get('https://api.themoviedb.org/3/trending/movie/:window', ({ request }) =>
      HttpResponse.json(page(idBaseFor(new URL(request.url), ranges), 1990))
    ),
    http.get('https://api.themoviedb.org/3/movie/:id/recommendations', ({ request }) =>
      HttpResponse.json(page(idBaseFor(new URL(request.url), ranges), 1995))
    ),
    http.get('https://api.themoviedb.org/3/movie/:id/similar', ({ request }) =>
      HttpResponse.json(page(idBaseFor(new URL(request.url), ranges), 1975))
    )
  );
}

const year = (m: { release_date?: string }) => Number((m.release_date || '0').slice(0, 4));

describe('CIN-28: preferred eras reach the AI window', () => {
  beforeEach(() => {
    credentialStore.setTmdbCredential('read_access_token', 'mock-token');
    clearTmdbCache();
    installHandlers();
  });

  it('AC1: with eras 2000s/2010s/2020s, at least half of the first 40 pool items are from those eras', async () => {
    const pool = await getCandidateRecommendationPool({
      userRatings: ratings,
      excludeIds: new Set(ratings.map((r) => r.movieId)),
      preferredEras: ['2000s', '2010s', '2020s'],
      selectedVibes: [],
    });

    const window = pool.slice(0, AI_WINDOW);
    expect(window).toHaveLength(AI_WINDOW);
    const inEra = window.filter((m) => year(m) >= 2000);
    expect(inEra.length).toBeGreaterThanOrEqual(AI_WINDOW / 2);
  });

  it('AC2: every selected era is represented in the first 40 pool items', async () => {
    const pool = await getCandidateRecommendationPool({
      userRatings: ratings,
      excludeIds: new Set(ratings.map((r) => r.movieId)),
      preferredEras: ['2000s', '2010s', '2020s'],
      selectedVibes: [],
    });

    const decades = new Set(pool.slice(0, AI_WINDOW).map((m) => Math.floor(year(m) / 10) * 10));
    expect(decades.has(2000)).toBe(true);
    expect(decades.has(2010)).toBe(true);
    expect(decades.has(2020)).toBe(true);
  });

  it('AC3: without preferred eras the pool still mixes seed-graph and baseline films in the first 40', async () => {
    const pool = await getCandidateRecommendationPool({
      userRatings: ratings,
      excludeIds: new Set(ratings.map((r) => r.movieId)),
      preferredEras: [],
      selectedVibes: [],
    });

    const window = pool.slice(0, AI_WINDOW);
    expect(window).toHaveLength(AI_WINDOW);
    // Seed-graph films are dated 1995 (recommendations) or 1975 (similar) in this fixture.
    expect(window.some((m) => year(m) === 1995 || year(m) === 1975)).toBe(true);
    // Baseline (discover/trending) films are dated 1985 or 1990.
    expect(window.some((m) => year(m) === 1985 || year(m) === 1990)).toBe(true);
  });
});
