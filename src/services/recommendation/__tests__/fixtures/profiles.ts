import type { Movie, UserRating } from '../../../../types';
import type { Candidate, CandidateSource } from '../../types';

export type ProfileName = 'cold_start' | 'casual' | 'heavy' | 'niche';

export interface EvaluationFixture {
  name: ProfileName;
  description: string;
  ratings: UserRating[];
  pool: Candidate[];
  preferredEras?: string[];
  selectedVibes?: string[];
}

export interface EvaluationFixtures {
  coldStart: EvaluationFixture;
  casual: EvaluationFixture;
  heavy: EvaluationFixture;
  niche: EvaluationFixture;
}

const GENRE_IDS: Record<string, number> = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  'Science Fiction': 878,
  Thriller: 53,
  War: 10752,
  Western: 37,
};

// Carefully curated vocabulary with no leading articles, no subtitles, no digits,
// no Roman numerals, and no franchise alias words so every title yields a unique getSeriesKey.
const TITLE_ADJECTIVES = [
  'Amber',
  'Ashen',
  'Bitter',
  'Broken',
  'Cinder',
  'Copper',
  'Crimson',
  'Distant',
  'Drifting',
  'Emerald',
  'Fading',
  'Fragile',
  'Hollow',
  'Lantern',
  'Midnight',
  'Northern',
  'Obsidian',
  'Restless',
  'Rustic',
  'Silent',
  'Silver',
  'Solitary',
  'Sunken',
  'Velvet',
  'Wandering',
] as const;

const TITLE_NOUNS = [
  'Anchor',
  'Archive',
  'Beacon',
  'Bridge',
  'Cairn',
  'Canyon',
  'Clockwork',
  'Compass',
  'Current',
  'Echo',
  'Estuary',
  'Glacier',
  'Harbor',
  'Horizon',
  'Meadow',
  'Mirage',
  'Orchard',
  'Parcel',
  'Passage',
  'Pendulum',
  'Quarry',
  'Signal',
  'Summit',
  'Threshold',
  'Tide',
  'Valley',
] as const;

/**
 * Deterministic Mulberry32 PRNG (no Math.random).
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeUniqueTitle(index: number): string {
  const total = TITLE_ADJECTIVES.length * TITLE_NOUNS.length;
  const safeIndex = ((index % total) + total) % total;
  const adj = TITLE_ADJECTIVES[safeIndex % TITLE_ADJECTIVES.length];
  const noun = TITLE_NOUNS[Math.floor(safeIndex / TITLE_ADJECTIVES.length)];
  return `${adj} ${noun}`;
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

function pickGenres(names: string[]): { id: number; name: string }[] {
  return names.map((name) => ({
    id: GENRE_IDS[name] ?? 18,
    name,
  }));
}

/**
 * Generates `count` log-distributed vote counts spanning 50 to 2,000,000, sorted ascending.
 */
function buildLogVoteCounts(count: number, rng: () => number): number[] {
  const votes: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      votes.push(50);
    } else if (i === count - 1) {
      votes.push(2_000_000);
    } else {
      const jittered = (i + 0.15 + rng() * 0.7) / (count - 1);
      const u = Math.max(0.001, Math.min(0.999, jittered));
      votes.push(Math.round(50 * Math.pow(40_000, u)));
    }
  }
  return votes.sort((a, b) => a - b);
}

interface MovieSpec {
  id: number;
  titleIndex: number;
  genres: string[];
  director: string;
  keywords: string[];
  decade: number;
  voteAverage: number;
  voteCount: number;
  sources: CandidateSource[];
  seedNeighbour: boolean;
}

function buildMovieAndCandidate(spec: MovieSpec, rng: () => number): Candidate {
  const year = spec.decade + Math.floor(rng() * 10);
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, '0');
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, '0');
  const title = makeUniqueTitle(spec.titleIndex);

  const movie: Movie = {
    id: spec.id,
    title,
    overview: `${title} explores ${spec.keywords.join(', ')} in ${spec.decade}s cinema.`,
    poster_path: `/poster-${spec.id}.jpg`,
    backdrop_path: `/backdrop-${spec.id}.jpg`,
    release_date: `${year}-${month}-${day}`,
    vote_average: Number(spec.voteAverage.toFixed(1)),
    vote_count: spec.voteCount,
    genre_ids: spec.genres.map((g) => GENRE_IDS[g] ?? 18),
    genres: pickGenres(spec.genres),
    director: spec.director,
    keywords: [...spec.keywords],
  };

  return {
    movie,
    sources: [...spec.sources],
    seedNeighbour: spec.seedNeighbour,
  };
}

function buildRating(
  movieId: number,
  titleIndex: number,
  rating: number,
  genres: string[],
  director: string,
  keywords: string[],
  year: number,
  ratedAt: number
): UserRating {
  return {
    movieId,
    title: makeUniqueTitle(titleIndex),
    rating,
    posterPath: `/poster-${movieId}.jpg`,
    year: String(year),
    genres,
    director,
    keywords,
    ratedAt,
  };
}

const BLOCKBUSTER_DIRECTORS = [
  'Marcus Vance',
  'Trenton Cole',
  'Gavin Sterling',
  'Darius Locke',
] as const;

const BASE_TIMESTAMP = 1_700_000_000_000;

interface TieredPoolConfig {
  idOffset: number;
  titleStartIndex: number;
  seed: number;
  /** Genres/directors/keywords favored by the user (safe bets and creator matches). */
  coreGenres: readonly string[][];
  coreDirectors: readonly string[];
  coreKeywords: readonly string[];
  coreDecades: readonly number[];
  /** Adjacent / unfamiliar genres and decades for stretches and wildcards. */
  bridgeGenres: readonly string[][];
  bridgeDirectors: readonly string[];
  bridgeKeywords: readonly string[];
  bridgeDecades: readonly number[];
  /** Disliked genres/directors/keywords for below-floor contrast. */
  dislikedGenres: readonly string[][];
  dislikedDirectors: readonly string[];
  dislikedKeywords: readonly string[];
  /** Optional crossover hits allowed in the 20% popularity head (indices 144..149). */
  crossoverHeadGenres?: readonly string[][];
  /** Optional pre-existing rated candidates to inject into mid-tier slots (verifies exclusion). */
  ratedInjections?: readonly { rating: UserRating; voteCount: number; sources: CandidateSource[]; seedNeighbour: boolean }[];
}

function buildTieredPool(config: TieredPoolConfig): Candidate[] {
  const rng = createSeededRng(config.seed);
  const poolSize = 180;
  const voteCounts = buildLogVoteCounts(poolSize, rng);
  const candidates: Candidate[] = [];

  const injectionCount = config.ratedInjections?.length ?? 0;
  // Place injected rated films in mid-tier slots (indices 75..75+injectionCount-1)
  // so they stay outside the top-30 popularity head and test rated exclusion cleanly.
  const injectionStartIdx = 75;

  for (let i = 0; i < poolSize; i++) {
    const id = config.idOffset + i;
    const titleIndex = config.titleStartIndex + i;
    const voteCount = voteCounts[i];

    if (
      config.ratedInjections &&
      i >= injectionStartIdx &&
      i < injectionStartIdx + injectionCount
    ) {
      const inj = config.ratedInjections[i - injectionStartIdx];
      const r = inj.rating;
      candidates.push({
        movie: {
          id: r.movieId,
          title: r.title,
          overview: `${r.title} explores ${(r.keywords ?? []).join(', ')}.`,
          poster_path: r.posterPath,
          backdrop_path: null,
          release_date: `${r.year ?? '2015'}-06-15`,
          vote_average: 7.8,
          vote_count: voteCount,
          genre_ids: r.genres.map((g) => GENRE_IDS[g] ?? 18),
          genres: pickGenres(r.genres),
          director: r.director,
          keywords: r.keywords ? [...r.keywords] : [],
        },
        sources: [...inj.sources],
        seedNeighbour: inj.seedNeighbour,
      });
      continue;
    }

    let genres: string[];
    let director: string;
    let keywords: string[];
    let decade: number;
    let voteAverage: number;
    let sources: CandidateSource[];
    let seedNeighbour: boolean;

    if (i >= 150) {
      // Top 30 most-voted films: dominated by mainstream franchise-style blockbusters
      // (plus 4 varied popular hits at indices 150..153).
      if (i < 154) {
        genres = [...pick(config.crossoverHeadGenres ?? config.bridgeGenres, rng)];
        director = `Auteur Head ${i}`;
        keywords = ['prestige', `theme-head-${i % 4}`];
        decade = pick(config.coreDecades, rng);
        voteAverage = 7.3 + rng() * 0.4;
        sources = ['acclaimed_baseline', 'seed_graph'];
        seedNeighbour = true;
      } else {
        genres = i % 2 === 0 ? ['Action', 'Adventure'] : ['Action', 'Adventure', 'Science Fiction'];
        director = BLOCKBUSTER_DIRECTORS[i % BLOCKBUSTER_DIRECTORS.length];
        keywords = ['blockbuster', 'spectacle'];
        decade = 2010;
        voteAverage = 6.3 + rng() * 1.1;
        sources = i % 3 === 0 ? ['seed_graph'] : ['acclaimed_baseline'];
        seedNeighbour = i % 3 === 0;
      }
    } else if (i >= 144) {
      // Remaining 6 items of the top 20% popularity head (indices 144..149)
      genres =
        i % 2 === 0 && config.crossoverHeadGenres
          ? [...pick(config.crossoverHeadGenres, rng)]
          : ['Action', 'Adventure'];
      director = i % 2 === 0 ? `Popular Director ${i}` : BLOCKBUSTER_DIRECTORS[i % BLOCKBUSTER_DIRECTORS.length];
      keywords = i % 2 === 0 ? ['mainstream', 'ensemble'] : ['blockbuster', 'spectacle'];
      decade = pick(config.coreDecades, rng);
      voteAverage = 7.1 + rng() * 0.6;
      sources = ['acclaimed_baseline'];
      seedNeighbour = false;
    } else if (i >= 110) {
      // Upper-mid tier (indices 110..143): strong seed_graph & creator_graph matches
      genres = [...pick(config.coreGenres, rng)];
      director =
        i % 3 === 0 ? pick(config.coreDirectors, rng) : `Mid Tier Director ${i % 14}`;
      keywords = [pick(config.coreKeywords, rng), `motif-${i % 7}`];
      decade = pick(config.coreDecades, rng);
      voteAverage = 7.4 + rng() * 1.0;
      if (i % 3 === 0) {
        sources = ['creator_graph'];
        seedNeighbour = false;
      } else {
        sources = ['seed_graph'];
        seedNeighbour = true;
      }
    } else if (i >= 50) {
      // Mid-tail (indices 50..109): mix of core seed/keyword matches, bridges, and ~22 disliked/below-floor films
      if (i >= 88 && i < 110) {
        // Disliked / low-acclaim films exercising the relevance floor
        genres = [...pick(config.dislikedGenres, rng)];
        director = pick(config.dislikedDirectors, rng);
        keywords = [pick(config.dislikedKeywords, rng), 'formulaic'];
        decade = pick(config.bridgeDecades, rng);
        voteAverage = 4.6 + rng() * 1.5;
        sources = i % 2 === 0 ? ['acclaimed_baseline'] : ['seed_graph'];
        seedNeighbour = i % 2 !== 0;
      } else if (i % 2 === 0) {
        genres = [...pick(config.coreGenres, rng)];
        director =
          i % 4 === 0 ? pick(config.coreDirectors, rng) : `Indie Director ${i % 18}`;
        keywords = [pick(config.coreKeywords, rng), `craft-${i % 9}`];
        decade = pick(config.coreDecades, rng);
        voteAverage = 7.3 + rng() * 1.1;
        sources = i % 4 === 0 ? ['keyword_affinity'] : ['seed_graph'];
        seedNeighbour = i % 4 !== 0;
      } else {
        genres = [...pick(config.bridgeGenres, rng)];
        director = pick(config.bridgeDirectors, rng);
        keywords = [pick(config.bridgeKeywords, rng), `tone-${i % 8}`];
        decade = pick(config.bridgeDecades, rng);
        voteAverage = 7.5 + rng() * 1.0;
        sources = i % 3 === 0 ? ['era', 'bridge'] : ['bridge'];
        seedNeighbour = false;
      }
    } else {
      // Long-tail hidden gems (indices 0..49, vote_count 50..~1,000)
      const isCoreGem = i % 2 === 0;
      genres = isCoreGem ? [...pick(config.coreGenres, rng)] : [...pick(config.bridgeGenres, rng)];
      director = isCoreGem
        ? i % 4 === 0
          ? pick(config.coreDirectors, rng)
          : `Festival Director ${i % 16}`
        : `Arthouse Director ${i % 16}`;
      keywords = isCoreGem
        ? [pick(config.coreKeywords, rng), `gem-${i % 6}`]
        : [pick(config.bridgeKeywords, rng), `discovery-${i % 6}`];
      decade = isCoreGem ? pick(config.coreDecades, rng) : pick(config.bridgeDecades, rng);
      voteAverage = 7.4 + rng() * 1.2;
      sources = isCoreGem
        ? i % 4 === 0
          ? ['hidden_gem', 'creator_graph']
          : ['hidden_gem']
        : ['hidden_gem', 'vibe'];
      seedNeighbour = false;
    }

    candidates.push(
      buildMovieAndCandidate(
        {
          id,
          titleIndex,
          genres,
          director,
          keywords,
          decade,
          voteAverage,
          voteCount,
          sources,
          seedNeighbour,
        },
        rng
      )
    );
  }

  return candidates;
}

export function buildColdStartFixture(): EvaluationFixture {
  const ratings: UserRating[] = [
    buildRating(1, 0, 9, ['Drama', 'Mystery'], 'Denis Villeneuve', ['slow-burn', 'memory'], 2016, BASE_TIMESTAMP + 1000),
    buildRating(2, 1, 8, ['Science Fiction', 'Drama'], 'Alex Garland', ['ai', 'isolation'], 2014, BASE_TIMESTAMP + 2000),
    buildRating(3, 2, 4, ['Action', 'Comedy'], 'Trenton Cole', ['blockbuster', 'spectacle'], 2019, BASE_TIMESTAMP + 3000),
  ];

  const pool = buildTieredPool({
    idOffset: 1001,
    titleStartIndex: 3,
    seed: 10101,
    coreGenres: [
      ['Drama', 'Mystery'],
      ['Science Fiction', 'Drama'],
      ['Mystery', 'Thriller'],
      ['Drama'],
    ],
    coreDirectors: ['Denis Villeneuve', 'Alex Garland', 'Claire Denis', 'Kogonada'],
    coreKeywords: ['slow-burn', 'memory', 'ai', 'isolation'],
    coreDecades: [2010, 2000],
    bridgeGenres: [
      ['History', 'War'],
      ['Documentary'],
      ['Animation', 'Fantasy'],
      ['Western'],
      ['Crime', 'Mystery'],
    ],
    bridgeDirectors: ['Kelly Reichardt', 'Celine Sciamma', 'Agnès Varda', 'Abbas Kiarostami', 'Isao Takahata'],
    bridgeKeywords: ['landscape', 'elegy', 'folklore', 'archival', 'expedition'],
    bridgeDecades: [1970, 1980, 1990],
    dislikedGenres: [['Action', 'Comedy'], ['Comedy', 'Family']],
    dislikedDirectors: ['Trenton Cole', 'Marcus Vance'],
    dislikedKeywords: ['blockbuster', 'slapstick'],
  });

  return {
    name: 'cold_start',
    description: 'Cold-start user with 3 ratings (two thoughtful sci-fi/mystery dramas, one disliked action-comedy).',
    ratings,
    pool,
    preferredEras: ['2010s', '1990s'],
    selectedVibes: ['slow-burn'],
  };
}

export function buildCasualFixture(): EvaluationFixture {
  const rng = createSeededRng(20202);
  const ratings: UserRating[] = [];

  const likedGenres: string[][] = [
    ['Drama', 'Crime'],
    ['Comedy', 'Drama'],
    ['Thriller', 'Mystery'],
    ['Crime', 'Thriller'],
  ];
  const likedDirectors = ['Bong Joon-ho', 'Greta Gerwig', 'Joel Coen', 'Noah Baumbach'];
  const likedKeywords = ['satire', 'ensemble', 'investigation', 'character-study'];

  // 16 liked ratings (7..10)
  for (let i = 0; i < 16; i++) {
    ratings.push(
      buildRating(
        100 + i,
        i,
        7 + Math.floor(rng() * 4),
        likedGenres[i % likedGenres.length],
        likedDirectors[i % likedDirectors.length],
        [likedKeywords[i % likedKeywords.length], likedKeywords[(i + 1) % likedKeywords.length]],
        1995 + (i % 28),
        BASE_TIMESTAMP + i * 1000
      )
    );
  }

  // 5 neutral ratings (5..6)
  for (let i = 16; i < 21; i++) {
    ratings.push(
      buildRating(
        100 + i,
        i,
        5 + (i % 2),
        ['Adventure', 'Romance'],
        `Casual Mid Director ${i}`,
        ['road-trip'],
        2002 + (i % 15),
        BASE_TIMESTAMP + i * 1000
      )
    );
  }

  // 4 disliked ratings (2..4)
  for (let i = 21; i < 25; i++) {
    ratings.push(
      buildRating(
        100 + i,
        i,
        2 + (i % 3),
        i % 2 === 0 ? ['Horror', 'Thriller'] : ['Fantasy', 'Action'],
        i % 2 === 0 ? 'Damon Slayton' : 'Trenton Cole',
        ['jump-scare', 'blockbuster'],
        2010 + (i % 10),
        BASE_TIMESTAMP + i * 1000
      )
    );
  }

  const pool = buildTieredPool({
    idOffset: 2001,
    titleStartIndex: 25,
    seed: 20203,
    coreGenres: likedGenres,
    coreDirectors: [...likedDirectors, 'Martin McDonagh', 'Sean Baker'],
    coreKeywords: likedKeywords,
    coreDecades: [2000, 2010, 2020],
    bridgeGenres: [
      ['Documentary', 'Music'],
      ['Animation', 'Family'],
      ['Western'],
      ['History', 'Drama'],
      ['Science Fiction'],
    ],
    bridgeDirectors: ['Wim Wenders', 'Hayao Miyazaki', 'Sergio Leone', 'Hirokazu Kore-eda', 'Satoshi Kon'],
    bridgeKeywords: ['portrait', 'myth', 'nostalgia', 'borderland', 'dreamscape'],
    bridgeDecades: [1960, 1970, 1980],
    dislikedGenres: [['Horror', 'Fantasy'], ['Horror', 'Action']],
    dislikedDirectors: ['Damon Slayton', 'Trenton Cole'],
    dislikedKeywords: ['jump-scare', 'cg-mayhem'],
  });

  return {
    name: 'casual',
    description: 'Casual viewer with 25 ratings favoring drama/crime/smart comedy and disliking horror/fantasy blockbusters.',
    ratings,
    pool,
  };
}

export function buildHeavyFixture(): EvaluationFixture {
  const rng = createSeededRng(30303);
  const ratings: UserRating[] = [];

  const lovedGenres: string[][] = [
    ['Thriller', 'Crime'],
    ['Mystery', 'Drama'],
    ['Science Fiction', 'Thriller'],
    ['Crime', 'Drama'],
    ['Drama', 'Mystery'],
  ];
  const lovedDirectors = [
    'David Fincher',
    'Denis Villeneuve',
    'Park Chan-wook',
    'Bong Joon-ho',
    'Celine Sciamma',
    'Akira Kurosawa',
  ];
  const lovedKeywords = [
    'noir',
    'investigation',
    'slow-burn',
    'psychological',
    'moral-dilemma',
    'time-loop',
  ];
  const lovedDecades = [1970, 1990, 2000, 2010];

  // 195 loved/liked ratings (7..10)
  for (let i = 0; i < 195; i++) {
    const rating = i % 5 === 0 ? 10 : i % 3 === 0 ? 9 : 7 + Math.floor(rng() * 2);
    const decade = lovedDecades[i % lovedDecades.length];
    ratings.push(
      buildRating(
        1 + i,
        i,
        rating,
        lovedGenres[i % lovedGenres.length],
        lovedDirectors[i % lovedDirectors.length],
        [
          lovedKeywords[i % lovedKeywords.length],
          lovedKeywords[(i + 2) % lovedKeywords.length],
        ],
        decade + (i % 10),
        BASE_TIMESTAMP + i * 1000
      )
    );
  }

  // 55 disliked ratings (1..4) in Horror, Romance, Comedy
  const hatedGenres: string[][] = [
    ['Horror', 'Comedy'],
    ['Romance', 'Comedy'],
    ['Horror', 'Romance'],
  ];
  const hatedDirectors = ['Uwe Boll', 'Jason Friedberg', 'Damon Slayton'];
  const hatedKeywords = ['slapstick', 'jump-scare', 'rom-com'];

  for (let i = 195; i < 250; i++) {
    ratings.push(
      buildRating(
        1 + i,
        i,
        1 + (i % 4),
        hatedGenres[i % hatedGenres.length],
        hatedDirectors[i % hatedDirectors.length],
        [hatedKeywords[i % hatedKeywords.length], 'formulaic'],
        2000 + (i % 20),
        BASE_TIMESTAMP + i * 1000
      )
    );
  }

  // 50 mixed ratings (5..6) in Action, Adventure, History, War
  const mixedGenres: string[][] = [
    ['Action', 'Adventure'],
    ['History', 'War'],
  ];
  for (let i = 250; i < 300; i++) {
    ratings.push(
      buildRating(
        1 + i,
        i,
        5 + (i % 2),
        mixedGenres[i % mixedGenres.length],
        `Studio Director ${i % 10}`,
        ['ensemble'],
        1990 + (i % 30),
        BASE_TIMESTAMP + i * 1000
      )
    );
  }

  const pool = buildTieredPool({
    idOffset: 3001,
    titleStartIndex: 300,
    seed: 30304,
    coreGenres: lovedGenres,
    coreDirectors: [...lovedDirectors, 'Michael Mann', 'Sidney Lumet', 'Wong Kar-wai', 'Satoshi Kon'],
    coreKeywords: lovedKeywords,
    coreDecades: [1970, 1990, 2000, 2010],
    bridgeGenres: [
      ['Documentary'],
      ['Animation', 'Fantasy'],
      ['Western'],
      ['Music', 'Documentary'],
      ['Family', 'Animation'],
    ],
    bridgeDirectors: ['Agnès Varda', 'Hayao Miyazaki', 'Sergio Leone', 'Wim Wenders', 'Robert Bresson'],
    bridgeKeywords: ['archival', 'folklore', 'frontier', 'portrait', 'contemplation'],
    bridgeDecades: [1960, 1980, 2020],
    dislikedGenres: hatedGenres,
    dislikedDirectors: hatedDirectors,
    dislikedKeywords: hatedKeywords,
    ratedInjections: [
      { rating: ratings[0], voteCount: 15000, sources: ['seed_graph'], seedNeighbour: true },
      { rating: ratings[1], voteCount: 18000, sources: ['creator_graph'], seedNeighbour: false },
      { rating: ratings[2], voteCount: 22000, sources: ['seed_graph'], seedNeighbour: true },
      { rating: ratings[3], voteCount: 25000, sources: ['keyword_affinity'], seedNeighbour: false },
      { rating: ratings[4], voteCount: 28000, sources: ['seed_graph'], seedNeighbour: true },
    ],
  });

  return {
    name: 'heavy',
    description:
      'Heavy cinephile with 300 ratings: strong thriller/crime/mystery/sci-fi/drama and auteur tastes plus clear horror/romance/slapstick dislikes.',
    ratings,
    pool,
  };
}

export function buildNicheFixture(): EvaluationFixture {
  const rng = createSeededRng(40404);
  const ratings: UserRating[] = [];

  const nicheGenres: string[][] = [
    ['Documentary'],
    ['Music'],
    ['Documentary', 'Music'],
  ];
  const nicheDirectors = [
    'Agnès Varda',
    'Wim Wenders',
    'Werner Herzog',
    'Errol Morris',
    'Frederick Wiseman',
    'D.A. Pennebaker',
  ];
  const nicheKeywords = ['portrait', 'archival', 'concert', 'ethnography', 'jazz', 'cinema-verite'];
  const nicheDecades = [1970, 1990, 2010];

  // 48 high ratings (8..10) concentrated in two rare genres: Documentary and Music
  for (let i = 0; i < 48; i++) {
    const rating = 8 + Math.floor(rng() * 3);
    const decade = nicheDecades[i % nicheDecades.length];
    ratings.push(
      buildRating(
        501 + i,
        i,
        rating,
        nicheGenres[i % nicheGenres.length],
        nicheDirectors[i % nicheDirectors.length],
        [
          nicheKeywords[i % nicheKeywords.length],
          nicheKeywords[(i + 1) % nicheKeywords.length],
        ],
        decade + (i % 10),
        BASE_TIMESTAMP + i * 1000
      )
    );
  }

  // 12 low ratings (3..5) in mainstream Action / Adventure / Comedy / Science Fiction
  const mainstreamDislikes: string[][] = [
    ['Action', 'Adventure'],
    ['Action', 'Adventure', 'Science Fiction'],
    ['Comedy', 'Action'],
  ];
  for (let i = 48; i < 60; i++) {
    ratings.push(
      buildRating(
        501 + i,
        i,
        3 + (i % 3),
        mainstreamDislikes[i % mainstreamDislikes.length],
        BLOCKBUSTER_DIRECTORS[i % BLOCKBUSTER_DIRECTORS.length],
        ['blockbuster', 'spectacle'],
        2012 + (i % 10),
        BASE_TIMESTAMP + i * 1000
      )
    );
  }

  const pool = buildTieredPool({
    idOffset: 4001,
    titleStartIndex: 60,
    seed: 40405,
    coreGenres: nicheGenres,
    coreDirectors: nicheDirectors,
    coreKeywords: nicheKeywords,
    coreDecades: [1970, 1990, 2010],
    bridgeGenres: [
      ['History'],
      ['Animation'],
      ['Mystery'],
      ['Western'],
      ['War', 'History'],
    ],
    bridgeDirectors: ['Chris Marker', 'Jonas Mekas', 'Chantal Akerman', 'Abbas Kiarostami', 'Isao Takahata'],
    bridgeKeywords: ['essay-film', 'oral-history', 'observational', 'travelogue', 'lyric'],
    bridgeDecades: [1960, 1980, 2000, 2020],
    dislikedGenres: mainstreamDislikes,
    dislikedDirectors: [...BLOCKBUSTER_DIRECTORS],
    dislikedKeywords: ['blockbuster', 'spectacle'],
    crossoverHeadGenres: [['Documentary'], ['Music']],
  });

  return {
    name: 'niche',
    description:
      'Niche viewer with 60 ratings (48 high ratings in Documentary & Music, 12 low ratings in mainstream blockbusters).',
    ratings,
    pool,
  };
}

export function buildEvaluationFixtures(): EvaluationFixtures {
  return {
    coldStart: buildColdStartFixture(),
    casual: buildCasualFixture(),
    heavy: buildHeavyFixture(),
    niche: buildNicheFixture(),
  };
}
