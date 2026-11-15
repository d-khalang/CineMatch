import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RankedFeed } from '../RankedFeed';
import { MovieDetailsModal } from '../MovieDetailsModal';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
import { aiManager } from '../../services/ai/aiManager';
import { rankCandidates } from '../../services/recommendation/rankCandidates';
import type { Candidate } from '../../services/recommendation/types';
import type { Movie, Recommendation, UserRating } from '../../types';

vi.mock('../../services/tmdb', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
    BACKDROP_BASE_URL: 'https://image.tmdb.org/t/p/w1280',
    getMovieDetails: vi.fn().mockResolvedValue(null),
    hydrateBatchWithDiscoveries: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../services/recommendation/candidateSources', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getCandidateRecommendationPool: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../services/credentialStore', () => ({
  credentialStore: {
    hasTmdb: vi.fn().mockReturnValue(true),
    getCredentials: vi.fn().mockReturnValue({ tmdbApiKey: 'test-tmdb-key' }),
    getVersion: vi.fn().mockReturnValue(1),
    subscribe: vi.fn().mockReturnValue(() => {}),
    forgetAll: vi.fn(),
    clearAllData: vi.fn(),
  },
}));

vi.mock('../../services/ai/aiManager', () => ({
  aiManager: {
    generateRecommendations: vi.fn().mockResolvedValue({
      recommendations: [],
      usedProvider: 'local',
    }),
  },
}));

const SEEDED_RATINGS = {
  101: {
    movieId: 101,
    title: 'Rated Film One',
    rating: 9,
    ratedAt: 1000,
    genres: ['Drama'],
  },
  202: {
    movieId: 202,
    title: 'Rated Film Two',
    rating: 8,
    ratedAt: 2000,
    genres: ['Sci-Fi'],
  },
};

function makeMovie(id: number, title: string, overrides: Partial<Movie> = {}): Movie {
  return {
    id,
    title,
    overview: `Overview for ${title}`,
    poster_path: null,
    backdrop_path: null,
    release_date: '2021-01-01',
    vote_average: 8.1,
    vote_count: 1000,
    genres: [{ id: 18, name: 'Drama' }],
    ...overrides,
  };
}

function seedCachedRecommendations(
  recommendations: Recommendation[],
  extra: { tasteAnalysis?: string | null; usedProvider?: string } = {}
) {
  localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(SEEDED_RATINGS));
  localStorage.setItem(
    STORAGE_KEYS.CACHED_RECOMMENDATIONS,
    JSON.stringify({
      recommendations,
      generatedAt: 100000,
      usedProvider: extra.usedProvider ?? 'Local Smart Heuristic (Zero Config)',
      tasteAnalysis: extra.tasteAnalysis ?? null,
      settingsFingerprint: 'fp',
      ratedCount: 2,
    })
  );
}

describe('Bucket labels, bridge reasons, filter chips, and calm copy (CIN-12)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  it('shows the same bucket badge in MovieDetailsModal as on the card when bucket is set', async () => {
    const user = userEvent.setup();
    seedCachedRecommendations([
      {
        movie: makeMovie(701, 'Stretch Film'),
        score: 82,
        rank: 1,
        reason: 'New ground for you, but it shares themes you love.',
        serendipityType: 'thematic_gem',
        bucket: 'stretch',
        highlightTags: ['Drama'],
      },
    ]);

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <MovieDetailsModal />
      </MovieStoreProvider>
    );

    expect(screen.getByText('A stretch for you')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Trailer & Details' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('A stretch for you')).toBeInTheDocument();
  });

  it('does not show a bucket badge in MovieDetailsModal when bucket is not set', async () => {
    const user = userEvent.setup();
    seedCachedRecommendations([
      {
        movie: makeMovie(702, 'Legacy Pick'),
        score: 90,
        rank: 1,
        reason: 'Matches your drama ratings.',
        serendipityType: 'safe_bet',
        highlightTags: [],
      },
    ]);

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <MovieDetailsModal />
      </MovieStoreProvider>
    );

    await user.click(screen.getByRole('button', { name: 'Trailer & Details' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('Safe pick')).toBeNull();
    expect(within(dialog).queryByText('A stretch for you')).toBeNull();
    expect(within(dialog).queryByText('Wildcard')).toBeNull();
    expect(within(dialog).queryByText('Long shot')).toBeNull();
  });

  it('renders full reasons without truncation for stretch and wildcard cards', () => {
    const longStretchReason =
      'A stretch into 1970s Japanese neo-noir cinema that departs from your usual contemporary releases, bridged by the slow-burn investigative tension you consistently rate 9 or 10 — worth the risk for its enduring critical acclaim and singular visual atmosphere.';
    const longWildcardReason =
      'New ground for you in archival silent comedy, a real departure from your usual crime dramas, but it shares the meticulous visual storytelling and dry wit you rate highly — worth the risk for a genuinely memorable change of pace.';

    seedCachedRecommendations([
      {
        movie: makeMovie(711, 'Long Reason Stretch'),
        score: 79,
        rank: 1,
        reason: longStretchReason,
        serendipityType: 'thematic_gem',
        bucket: 'stretch',
        highlightTags: [],
      },
      {
        movie: makeMovie(712, 'Long Reason Wildcard'),
        score: 71,
        rank: 2,
        reason: longWildcardReason,
        serendipityType: 'wildcard_discovery',
        bucket: 'wildcard',
        highlightTags: [],
      },
    ]);

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    const stretchReasonEl = screen.getByText(longStretchReason);
    expect(stretchReasonEl).toBeInTheDocument();
    expect(stretchReasonEl.className).not.toMatch(/line-clamp|truncate/);

    const wildcardReasonEl = screen.getByText(longWildcardReason);
    expect(wildcardReasonEl).toBeInTheDocument();
    expect(wildcardReasonEl.className).not.toMatch(/line-clamp|truncate/);
  });

  it('generates bridge reasons naming liked director, shared keyword, liked decade, or liked genre in preference order', () => {
    const userRatings: UserRating[] = [
      {
        movieId: 1,
        title: 'Loved Film 1',
        rating: 10,
        posterPath: null,
        year: '1994',
        genres: ['Drama', 'Crime'],
        director: 'Safe Director',
        keywords: ['noir'],
        ratedAt: 1000,
      },
      {
        movieId: 2,
        title: 'Loved Film 2',
        rating: 9,
        posterPath: null,
        year: '1998',
        genres: ['Drama'],
        director: 'Safe Director',
        keywords: ['detective'],
        ratedAt: 2000,
      },
      {
        movieId: 3,
        title: 'Loved Director A Film',
        rating: 9,
        posterPath: null,
        year: '2014',
        genres: ['Drama'],
        director: 'Director A',
        keywords: ['time travel'],
        ratedAt: 3000,
      },
    ];

    const safeAnchor: Candidate = {
      movie: makeMovie(100, 'Safe Anchor', {
        genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
        director: 'Safe Director',
        release_date: '1995-05-01',
        vote_count: 50000,
        vote_average: 8.5,
      }),
      sources: ['seed_graph'],
      seedNeighbour: true,
    };

    // 1. Liked director takes precedence over keyword, decade, and genre
    const withDirector: Candidate = {
      movie: makeMovie(101, 'Bridge Director', {
        genres: [{ id: 37, name: 'Western' }, { id: 18, name: 'Drama' }],
        director: 'Director A',
        keywords: ['time travel'],
        release_date: '2014-05-01',
        vote_count: 100,
        vote_average: 8.2,
      }),
      sources: ['creator_graph'],
      seedNeighbour: false,
    };
    const [directorTarget] = rankCandidates([safeAnchor, withDirector], userRatings, {
      serendipityLevel: 60,
    }).filter((r) => r.movie.id === 101);
    expect(directorTarget.bucket).toBe('wildcard');
    expect(directorTarget.reason).toContain('Director A');
    expect(directorTarget.reason).not.toContain('time travel');

    // 2. Shared keyword takes precedence over decade and genre when director is unfamiliar
    const withKeyword: Candidate = {
      movie: makeMovie(102, 'Bridge Keyword', {
        genres: [{ id: 37, name: 'Western' }, { id: 18, name: 'Drama' }],
        director: 'Unfamiliar Director',
        keywords: ['time travel'],
        release_date: '2014-05-01',
        vote_count: 100,
        vote_average: 8.2,
      }),
      sources: ['keyword_affinity'],
      seedNeighbour: false,
    };
    const [keywordTarget] = rankCandidates([safeAnchor, withKeyword], userRatings, {
      serendipityLevel: 60,
    }).filter((r) => r.movie.id === 102);
    expect(keywordTarget.bucket).toBe('wildcard');
    expect(keywordTarget.reason).toContain('time travel');
    expect(keywordTarget.reason).not.toContain('2010s');

    // 3. Liked decade takes precedence over genre when director & keyword are absent
    const withDecade: Candidate = {
      movie: makeMovie(103, 'Bridge Decade', {
        genres: [{ id: 37, name: 'Western' }, { id: 18, name: 'Drama' }],
        director: 'Unfamiliar Director',
        keywords: [],
        release_date: '2014-05-01',
        vote_count: 100,
        vote_average: 8.2,
      }),
      sources: ['hidden_gem'],
      seedNeighbour: false,
    };
    const [decadeTarget] = rankCandidates([safeAnchor, withDecade], userRatings, {
      serendipityLevel: 60,
    }).filter((r) => r.movie.id === 103);
    expect(decadeTarget.bucket).toBe('wildcard');
    expect(decadeTarget.reason).toContain('2010s');

    // 4. Liked genre is used when director, keyword, and decade do not match
    const withGenre: Candidate = {
      movie: makeMovie(104, 'Bridge Genre', {
        genres: [{ id: 37, name: 'Western' }, { id: 18, name: 'Drama' }],
        director: 'Unfamiliar Director',
        keywords: [],
        release_date: '1965-05-01',
        vote_count: 100,
        vote_average: 8.2,
      }),
      sources: ['hidden_gem'],
      seedNeighbour: false,
    };
    const [genreTarget] = rankCandidates([safeAnchor, withGenre], userRatings, {
      serendipityLevel: 60,
    }).filter((r) => r.movie.id === 104);
    expect(genreTarget.bucket).toBe('wildcard');
    expect(genreTarget.reason).toContain('Drama');

    // Also verify a stretch item gets a bridge reason naming Director A
    const stretchWithDirector: Candidate = {
      movie: makeMovie(105, 'Stretch Director', {
        genres: [{ id: 37, name: 'Western' }, { id: 18, name: 'Drama' }],
        director: 'Director A',
        release_date: '1995-05-01',
        vote_count: 1000,
        vote_average: 8.0,
      }),
      sources: ['creator_graph'],
      seedNeighbour: false,
    };
    const stretchWildcardPool = rankCandidates(
      [safeAnchor, stretchWithDirector, withGenre],
      userRatings,
      { serendipityLevel: 60 }
    );
    const stretchRec = stretchWildcardPool.find((r) => r.movie.id === 105)!;
    expect(stretchRec.bucket).toBe('stretch');
    expect(stretchRec.reason).toContain('Director A');
  });

  it('filters visible recommendations via keyboard-operable chips with aria-pressed and shows Long shot only under All', async () => {
    const user = userEvent.setup();
    seedCachedRecommendations([
      {
        movie: makeMovie(801, 'Safe Pick Movie'),
        score: 92,
        rank: 1,
        reason: 'Safe match',
        serendipityType: 'safe_bet',
        bucket: 'safe_bet',
        highlightTags: [],
      },
      {
        movie: makeMovie(802, 'Stretch Pick Movie'),
        score: 84,
        rank: 2,
        reason: 'Stretch match',
        serendipityType: 'thematic_gem',
        bucket: 'stretch',
        highlightTags: [],
      },
      {
        movie: makeMovie(803, 'Wildcard Pick Movie'),
        score: 76,
        rank: 3,
        reason: 'Wildcard match',
        serendipityType: 'wildcard_discovery',
        bucket: 'wildcard',
        highlightTags: [],
      },
      {
        movie: makeMovie(804, 'Long Shot Pick Movie'),
        score: 40,
        rank: 4,
        reason: 'Long shot match',
        serendipityType: 'thematic_gem',
        bucket: 'below_floor',
        highlightTags: [],
      },
    ]);

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    const allChip = screen.getByRole('button', { name: 'All' });
    const safeChip = screen.getByRole('button', { name: 'Safe' });
    const stretchChip = screen.getByRole('button', { name: 'Stretch' });
    const wildcardChip = screen.getByRole('button', { name: 'Wildcard' });

    expect(allChip).toHaveAttribute('aria-pressed', 'true');
    expect(safeChip).toHaveAttribute('aria-pressed', 'false');
    expect(stretchChip).toHaveAttribute('aria-pressed', 'false');
    expect(wildcardChip).toHaveAttribute('aria-pressed', 'false');

    // All shows every item including Long shot
    expect(screen.getByText('Safe Pick Movie')).toBeInTheDocument();
    expect(screen.getByText('Stretch Pick Movie')).toBeInTheDocument();
    expect(screen.getByText('Wildcard Pick Movie')).toBeInTheDocument();
    expect(screen.getByText('Long Shot Pick Movie')).toBeInTheDocument();

    // Activate Stretch chip via keyboard (Enter)
    stretchChip.focus();
    expect(document.activeElement).toBe(stretchChip);
    await user.keyboard('{Enter}');

    expect(stretchChip).toHaveAttribute('aria-pressed', 'true');
    expect(allChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Stretch Pick Movie')).toBeInTheDocument();
    expect(screen.queryByText('Safe Pick Movie')).toBeNull();
    expect(screen.queryByText('Wildcard Pick Movie')).toBeNull();
    expect(screen.queryByText('Long Shot Pick Movie')).toBeNull();

    // Activate Wildcard chip via keyboard (Space)
    wildcardChip.focus();
    await user.keyboard(' ');

    expect(wildcardChip).toHaveAttribute('aria-pressed', 'true');
    expect(stretchChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Wildcard Pick Movie')).toBeInTheDocument();
    expect(screen.queryByText('Safe Pick Movie')).toBeNull();
    expect(screen.queryByText('Stretch Pick Movie')).toBeNull();
    expect(screen.queryByText('Long Shot Pick Movie')).toBeNull();

    // Activate Safe chip via keyboard
    safeChip.focus();
    await user.keyboard('{Enter}');

    expect(safeChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Safe Pick Movie')).toBeInTheDocument();
    expect(screen.queryByText('Long Shot Pick Movie')).toBeNull();

    // Return to All
    allChip.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Long Shot Pick Movie')).toBeInTheDocument();

    // Filtering must not trigger regeneration
    expect(aiManager.generateRecommendations).not.toHaveBeenCalled();
  });

  it('hides filter chips when recommendations do not have bucket data', () => {
    seedCachedRecommendations([
      {
        movie: makeMovie(810, 'Legacy Film'),
        score: 91,
        rank: 1,
        reason: 'Legacy match',
        serendipityType: 'safe_bet',
        highlightTags: [],
      },
    ]);

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    expect(screen.queryByRole('group', { name: /Filter recommendations/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Safe' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stretch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Wildcard' })).toBeNull();
  });

  it('removes "% Taste Match" / "% Match" text and uses "Why this one" plus calm copy', () => {
    seedCachedRecommendations(
      [
        {
          movie: makeMovie(901, 'Calm Copy Film'),
          score: 88,
          rank: 1,
          reason: 'A solid pick for tonight.',
          serendipityType: 'ai_cinephile_discovery',
          highlightTags: [],
        },
      ],
      {
        tasteAnalysis: 'You gravitate toward character-driven thrillers with patient pacing.',
      }
    );

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    expect(screen.queryByText(/Taste Match/i)).toBeNull();
    expect(screen.queryByText(/% Match/i)).toBeNull();
    expect(screen.queryByText(/88%/)).toBeNull();
    expect(screen.queryByText(/Why ranked #/i)).toBeNull();
    expect(screen.getByText(/Why this one:/i)).toBeInTheDocument();

    // Calm copy pass checks
    expect(screen.getByText('Your taste, in a sentence')).toBeInTheDocument();
    expect(screen.queryByText(/AI Cinephile Discovery/i)).toBeNull();
    expect(screen.queryByText(/AI Psychological Taste Synthesis/i)).toBeNull();
    expect(screen.queryByText(/Cross-Genre DNA/i)).toBeNull();
  });

  it('removes "AI Status:" jargon from the recommendation error banner', async () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(SEEDED_RATINGS));
    vi.mocked(aiManager.generateRecommendations).mockResolvedValueOnce({
      recommendations: [],
      usedProvider: 'local',
      error: 'Could not reach provider.',
    });

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    const errText = await screen.findByText(/Could not reach provider\./);
    expect(errText).toBeInTheDocument();
    expect(screen.queryByText(/AI Status:/i)).toBeNull();
  });
});
