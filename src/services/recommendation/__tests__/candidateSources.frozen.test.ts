// FROZEN acceptance tests for CIN-30. Do not edit or weaken.
//
// Interface contract (CIN-30, candidate generation hardening):
//
// 1. Deadline
//    - New option `CandidateOptions.deadlineMs?: number`, default 12000 (ms of wall-clock time
//      measured from the start of generateCandidates).
//    - When the deadline passes, generateCandidates RESOLVES (does not reject) with the candidates
//      collected so far, and every still in-flight TMDB request is aborted (the AbortSignal passed
//      as the 3rd argument of fetchFromTMDB fires). Requests not yet started must not start.
//    - The CALLER's signal is never aborted by the deadline. The signal given to fetchFromTMDB may
//      be an internal one derived from the caller's.
//    - A caller abort still rejects with an AbortError.
//    - If every request finishes before the deadline the result is identical to today's.
//
// 2. Seed pairs
//    - Seed budget is truncated in whole pairs: any seed that gets a /recommendations request for
//      a given page also gets /similar for that page (and vice versa), for page 1 and page 2.
//    - The total request budget (45) is still respected.
//
// 3. Source tags and cap
//    - CandidateSource gains 'era' and 'vibe'. Era discover streams (those filtered by
//      primary_release_date) are tagged exactly ['era']; vibe discover streams (with_genres /
//      with_keywords only, no era dates, no vote_average.gte) exactly ['vibe']; base streams stay
//      'acclaimed_baseline'.
//    - Among the FIRST 40 candidates returned, at most 12 may carry an 'era' or 'vibe' source tag,
//      but at least one era and one vibe candidate stay in those 40, and at least 8 seed_graph and
//      at least 8 hidden_gem candidates must be present in the first 40.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../tmdbClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../tmdbClient')>();
  return { ...actual, fetchFromTMDB: vi.fn() };
});

import { fetchFromTMDB } from '../../tmdbClient';
import { generateCandidates } from '../candidateSources';
import type { UserRating } from '../../../types';

const fetchMock = vi.mocked(fetchFromTMDB) as unknown as ReturnType<typeof vi.fn>;

interface Call {
  endpoint: string;
  params: Record<string, string | number>;
  signal?: AbortSignal;
}

let calls: Call[] = [];

type Kind = 'era' | 'vibe' | 'base' | 'seed' | 'gem';
const ID_BASE: Record<Kind, number> = { era: 10000, vibe: 20000, base: 30000, seed: 40000, gem: 50000 };

function classify(endpoint: string, params: Record<string, string | number>): Kind {
  if (endpoint.startsWith('/movie/')) return 'seed';
  if (params['primary_release_date.gte'] !== undefined) return 'era';
  if (params['vote_average.gte'] !== undefined) return 'gem';
  if (params.with_genres !== undefined || params.with_keywords !== undefined) return 'vibe';
  return 'base';
}

function makeResults(kind: Kind, callIdx: number, n: number) {
  return Array.from({ length: n }, (_, j) => ({
    id: ID_BASE[kind] + callIdx * 100 + j,
    title: `${kind}-${callIdx}-${j}`,
    poster_path: `/p${kind}${callIdx}${j}.jpg`,
    vote_average: 8,
    vote_count: 1000,
    genre_ids: [18],
    release_date: '2000-01-01',
  }));
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

function hang(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) return reject(abortError());
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

function installFetch(opts: { n?: number; hangSeeds?: boolean } = {}) {
  const n = opts.n ?? 20;
  fetchMock.mockImplementation(async (endpoint: string, params: any = {}, signal?: AbortSignal) => {
    const callIdx = calls.length;
    calls.push({ endpoint, params, signal });
    const kind = classify(endpoint, params);
    if (opts.hangSeeds && kind === 'seed') return hang(signal);
    return { results: makeResults(kind, callIdx, n) };
  });
}

function makeRatings(count: number): UserRating[] {
  const names = ['Drama', 'Thriller', 'Comedy'];
  return Array.from({ length: count }, (_, i) => ({
    movieId: i + 1,
    title: `Rated ${i + 1}`,
    rating: 8 + (i % 3),
    posterPath: `/r${i + 1}.jpg`,
    genres: [names[i % 3], names[(i + 1) % 3]],
    ratedAt: 1600000000000 + i * 86400000,
  }));
}

const seq = () => {
  let s = 7;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
};

describe('CIN-30 frozen: wall-clock deadline', () => {
  beforeEach(() => {
    calls = [];
    fetchMock.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const run = (extra: Record<string, unknown> = {}, signal?: AbortSignal) => {
    const state = { settled: false, value: undefined as any, error: undefined as any };
    generateCandidates(makeRatings(3), { seedCount: 3, randomFn: seq(), ...extra }, signal).then(
      (v) => {
        state.settled = true;
        state.value = v;
      },
      (e) => {
        state.settled = true;
        state.error = e;
      }
    );
    return state;
  };

  it('returns partial results at the default 12000ms deadline and aborts in-flight requests', async () => {
    installFetch({ hangSeeds: true });
    const caller = new AbortController();
    const state = run({}, caller.signal);

    await vi.advanceTimersByTimeAsync(11999);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();

    const candidates = state.value as Array<{ sources: string[] }>;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.sources.includes('seed_graph'))).toBe(false);

    const hung = calls.filter((c) => c.endpoint.startsWith('/movie/'));
    expect(hung.length).toBeGreaterThan(0);
    for (const c of hung) {
      expect(c.signal?.aborted).toBe(true);
    }
    expect(caller.signal.aborted).toBe(false);
  });

  it('honours a custom deadlineMs', async () => {
    installFetch({ hangSeeds: true });
    const state = run({ deadlineMs: 500 });

    await vi.advanceTimersByTimeAsync(499);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.settled).toBe(true);
    expect(state.error).toBeUndefined();
    expect((state.value as unknown[]).length).toBeGreaterThan(0);
    for (const c of calls.filter((x) => x.endpoint.startsWith('/movie/'))) {
      expect(c.signal?.aborted).toBe(true);
    }
  });

  it('does not start new requests after the deadline', async () => {
    installFetch({ hangSeeds: true });
    const state = run({ deadlineMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(state.settled).toBe(true);
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(calls.length).toBe(before);
  });

  it('still rejects with AbortError when the caller aborts before the deadline', async () => {
    installFetch({ hangSeeds: true });
    const caller = new AbortController();
    const state = run({}, caller.signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(state.settled).toBe(false);
    caller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    expect(state.error).toMatchObject({ name: 'AbortError' });
  });

  it('rejects with AbortError when the caller signal is already aborted', async () => {
    installFetch();
    const caller = new AbortController();
    caller.abort();
    await expect(
      generateCandidates(makeRatings(3), { deadlineMs: 500 }, caller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('leaves results unchanged when the deadline is never hit', async () => {
    installFetch();
    const baseline = await generateCandidates(makeRatings(3), { seedCount: 3, randomFn: seq() });
    calls = [];
    const withDeadline = await generateCandidates(makeRatings(3), {
      seedCount: 3,
      randomFn: seq(),
      deadlineMs: 60000,
    });
    expect(baseline.length).toBeGreaterThan(0);
    expect(withDeadline.map((c) => c.movie.id)).toEqual(baseline.map((c) => c.movie.id));
    expect(withDeadline.map((c) => c.sources)).toEqual(baseline.map((c) => c.sources));
    expect(withDeadline.some((c) => c.sources.includes('seed_graph'))).toBe(true);
  });
});

describe('CIN-30 frozen: whole seed pairs', () => {
  beforeEach(() => {
    calls = [];
    fetchMock.mockReset();
  });

  it('never fetches /recommendations without /similar (or vice versa) for the same seed and page', async () => {
    installFetch({ n: 3 });
    await generateCandidates(makeRatings(12), {
      seedCount: 12,
      preferredEras: ['1970s', '1980s', '1990s', '2000s'],
      selectedVibes: ['mind-bending', 'dark & gritty'],
      randomFn: seq(),
    });

    // This setup reserves 24 requests, leaving an odd 21 for seeds, which used to split a pair.
    expect(calls.length).toBeLessThanOrEqual(45);

    const seen = new Map<string, Set<string>>();
    for (const c of calls) {
      const m = c.endpoint.match(/^\/movie\/(\d+)\/(recommendations|similar)$/);
      if (!m) continue;
      const key = `${m[1]}:${c.params.page}`;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(m[2]);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const [key, kinds] of seen) {
      expect(kinds.has('recommendations'), `seed:page ${key} missing /recommendations`).toBe(true);
      expect(kinds.has('similar'), `seed:page ${key} missing /similar`).toBe(true);
    }
    const seedCalls = calls.filter((c) => c.endpoint.startsWith('/movie/')).length;
    expect(seedCalls % 2).toBe(0);
  });
});

describe('CIN-30 frozen: era/vibe tags and cap', () => {
  beforeEach(() => {
    calls = [];
    fetchMock.mockReset();
  });

  it('tags era streams as era, vibe streams as vibe, and base streams as acclaimed_baseline', async () => {
    installFetch({ n: 2 });
    const result = await generateCandidates(makeRatings(3), {
      seedCount: 3,
      preferredEras: ['1990s'],
      selectedVibes: ['mind-bending'],
      randomFn: seq(),
    });

    const byRange = (lo: number, hi: number) => result.filter((c) => c.movie.id >= lo && c.movie.id < hi);
    const eras = byRange(ID_BASE.era, ID_BASE.vibe);
    const vibes = byRange(ID_BASE.vibe, ID_BASE.base);
    const bases = byRange(ID_BASE.base, ID_BASE.seed);
    expect(eras.length).toBeGreaterThan(0);
    expect(vibes.length).toBeGreaterThan(0);
    expect(bases.length).toBeGreaterThan(0);
    for (const c of eras) expect(c.sources).toEqual(['era']);
    for (const c of vibes) expect(c.sources).toEqual(['vibe']);
    for (const c of bases) expect(c.sources).toEqual(['acclaimed_baseline']);
  });

  it('caps era+vibe at 12 of the first 40 and keeps seed_graph and hidden_gem represented', async () => {
    installFetch({ n: 20 });
    const result = await generateCandidates(makeRatings(8), {
      seedCount: 8,
      preferredEras: ['1970s', '1980s', '1990s', '2000s'],
      selectedVibes: ['mind-bending', 'dark & gritty'],
      randomFn: seq(),
    });

    expect(result.length).toBeGreaterThan(40);
    const first40 = result.slice(0, 40);
    const count = (tag: string) => first40.filter((c) => c.sources.includes(tag as any)).length;
    const eraVibe = first40.filter(
      (c) => c.sources.includes('era') || c.sources.includes('vibe')
    ).length;

    expect(eraVibe).toBeLessThanOrEqual(12);
    expect(count('era')).toBeGreaterThanOrEqual(1);
    expect(count('vibe')).toBeGreaterThanOrEqual(1);
    expect(count('seed_graph')).toBeGreaterThanOrEqual(8);
    expect(count('hidden_gem')).toBeGreaterThanOrEqual(8);
  });
});
