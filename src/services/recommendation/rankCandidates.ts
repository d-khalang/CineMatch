import type { Movie, Recommendation, UserRating } from '../../types';
import type { Bucket, Candidate, CandidateSource } from './types';
import { getSeriesKey } from '../../constants/franchises';
import { rejectionPenalty, type RejectedFilm } from './rejectedFilms';
import {
  buildTasteProfile,
  scoreCandidates,
  buildRankedList,
  mixForSerendipityLevel,
  getDecade,
  type TasteProfile,
  type RankedCandidate,
} from './scoring';

export interface RankCandidatesOptions {
  serendipityLevel: number;
  preferredEras?: string[];
  selectedVibes?: string[];
  rejectedFilms?: RejectedFilm[];
  excludeIds?: Set<number>;
  size?: number;
}

function mapBucketToSerendipityType(
  bucket: Bucket,
  sources: CandidateSource[]
): Recommendation['serendipityType'] {
  switch (bucket) {
    case 'safe_bet':
      return 'safe_bet';
    case 'stretch':
      return sources.includes('creator_graph') ? 'director_match' : 'thematic_gem';
    case 'wildcard':
      return 'wildcard_discovery';
    case 'below_floor':
      return 'thematic_gem';
  }
}

function extractMovieGenreNames(movie: Movie): string[] {
  if (!Array.isArray(movie.genres)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const g of movie.genres) {
    const raw = typeof g === 'string' ? g : g?.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) continue;
    const lower = name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      names.push(name);
    }
  }
  return names;
}

function buildTopLikedGenre(
  profile: TasteProfile,
  userRatings: UserRating[]
): string | null {
  const displayNames = new Map<string, string>();
  for (const r of userRatings) {
    if (!r || !Array.isArray(r.genres)) continue;
    for (const g of r.genres) {
      if (typeof g === 'string' && g.trim()) {
        const trimmed = g.trim();
        const lower = trimmed.toLowerCase();
        if (!displayNames.has(lower)) {
          displayNames.set(lower, trimmed);
        }
      }
    }
  }

  let bestGenre: string | null = null;
  let bestAff = 0;
  for (const [lower, aff] of profile.genres) {
    if (aff > bestAff) {
      bestAff = aff;
      bestGenre = displayNames.get(lower) ?? lower;
    }
  }
  return bestGenre;
}

function getMatchedGenres(movieGenres: string[], profile: TasteProfile): string[] {
  return movieGenres
    .map((name) => ({
      name,
      affinity: profile.genres.get(name.toLowerCase()) ?? 0,
    }))
    .filter((entry) => entry.affinity > 0)
    .sort((a, b) => b.affinity - a.affinity)
    .map((entry) => entry.name);
}

function getSharedLikedKeyword(movie: Movie, profile: TasteProfile): string | null {
  if (!Array.isArray(movie.keywords) || movie.keywords.length === 0) return null;
  let bestKeyword: string | null = null;
  let bestAff = 0;
  for (const raw of movie.keywords) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const aff = profile.keywords.get(trimmed.toLowerCase()) ?? 0;
    if (aff > bestAff) {
      bestAff = aff;
      bestKeyword = trimmed;
    }
  }
  return bestKeyword;
}

function buildReason(
  item: RankedCandidate,
  profile: TasteProfile,
  matchedGenres: string[],
  movieGenres: string[],
  topLikedGenre: string | null
): string {
  const { movie, bucket, sources, seedNeighbour } = item;
  const director =
    typeof movie.director === 'string' && movie.director.trim().length > 0
      ? movie.director.trim()
      : null;
  const likedDirector =
    director && (profile.directors.get(director.toLowerCase()) ?? 0) > 0
      ? director
      : null;

  const voteAvg = Number.isFinite(movie.vote_average) ? movie.vote_average : 0;
  const voteText = voteAvg > 0 ? `${voteAvg.toFixed(1)}/10 TMDB` : 'strong acclaim';

  if (bucket === 'safe_bet') {
    if (likedDirector && matchedGenres.length > 0) {
      return `Close match to your taste: directed by ${likedDirector} with the ${matchedGenres[0]} elements you rate highly.`;
    }
    if (likedDirector) {
      return `Safe pick directed by ${likedDirector}, a filmmaker you rate highly.`;
    }
    if (matchedGenres.length >= 2) {
      return `Strong match for your favorite genres: ${matchedGenres[0]} and ${matchedGenres[1]}.`;
    }
    if (matchedGenres.length === 1) {
      return `Strong match for your high affinity for ${matchedGenres[0]}.`;
    }
    if (topLikedGenre) {
      return `Safe pick with ${voteText} that complements your taste for ${topLikedGenre}.`;
    }
    return `Critically acclaimed pick (${voteText}) well aligned with your taste profile.`;
  }

  if (bucket === 'below_floor') {
    if (matchedGenres.length > 0) {
      return `A long-shot pick sharing ${matchedGenres[0]} elements to round out your list.`;
    }
    return `A long-shot discovery outside your usual genres to broaden your options.`;
  }

  const unfamiliarGenres = movieGenres.filter(
    (name) => !profile.usualGenres.has(name.toLowerCase())
  );
  const movieDecade = getDecade(movie.release_date);
  const isNewDecade = Boolean(
    movieDecade && profile.usualDecades.size > 0 && !profile.usualDecades.has(movieDecade)
  );

  let intro: string;
  if (unfamiliarGenres.length > 0 && isNewDecade) {
    intro =
      bucket === 'wildcard'
        ? `New ground for you (${unfamiliarGenres[0]} from the ${movieDecade})`
        : `A stretch into ${unfamiliarGenres[0]} from the ${movieDecade}`;
  } else if (unfamiliarGenres.length > 0) {
    intro =
      bucket === 'wildcard'
        ? `New ground for you in ${unfamiliarGenres[0]}`
        : `A stretch into ${unfamiliarGenres[0]}`;
  } else if (isNewDecade) {
    intro =
      bucket === 'wildcard'
        ? `New ground for you in ${movieDecade} cinema`
        : `A stretch into ${movieDecade} cinema`;
  } else if (sources.includes('creator_graph') && director && !likedDirector) {
    intro =
      bucket === 'wildcard'
        ? `New ground for you with ${director}`
        : `A stretch into a different side of ${director}`;
  } else if (sources.includes('hidden_gem')) {
    intro =
      bucket === 'wildcard'
        ? 'New ground for you with an under-the-radar pick'
        : 'A stretch into an under-the-radar hidden gem';
  } else {
    intro = 'New ground for you';
  }

  const sharedKeyword = getSharedLikedKeyword(movie, profile);
  const likedDecade =
    movieDecade && (profile.decades.get(movieDecade) ?? 0) > 0 ? movieDecade : null;

  // Bridge link preference order: liked director -> shared keyword -> liked decade -> liked genre
  let bridgeKind: 'director' | 'keyword' | 'decade' | 'genre' | 'fallback';
  let bridgeClause: string;
  if (likedDirector) {
    bridgeKind = 'director';
    bridgeClause = `it's by ${likedDirector}, whose films you rate highly`;
  } else if (sharedKeyword) {
    bridgeKind = 'keyword';
    bridgeClause = `it shares the "${sharedKeyword}" theme you rate highly`;
  } else if (likedDecade) {
    bridgeKind = 'decade';
    bridgeClause = `it's from the ${likedDecade}, an era you rate highly`;
  } else if (matchedGenres.length > 0) {
    bridgeKind = 'genre';
    bridgeClause = `it brings in the ${matchedGenres[0]} elements you rate highly`;
  } else {
    bridgeKind = 'fallback';
    if (profile.totalRatings > 0 && (seedNeighbour || sources.includes('seed_graph'))) {
      bridgeClause = 'it connects to films you rated highly';
    } else if (topLikedGenre) {
      bridgeClause = `it echoes the tone of your ${topLikedGenre} favorites`;
    } else {
      bridgeClause = `it stands out on strong critical craft (${voteText})`;
    }
  }

  let worthRisk: string;
  if (voteAvg >= 7.5) {
    worthRisk = `its ${voteAvg.toFixed(1)}/10 acclaim`;
  } else if (sources.includes('hidden_gem')) {
    worthRisk = 'standout cinephile word-of-mouth';
  } else if (likedDirector && bridgeKind !== 'director') {
    worthRisk = `${likedDirector}'s track record in your ratings`;
  } else {
    worthRisk = 'a rewarding departure from your usual rotation';
  }

  return `${intro}, but ${bridgeClause} — worth the risk for ${worthRisk}.`;
}

/**
 * Filters out rated, excluded, duplicate, and same-franchise candidates,
 * scores the remaining pool against the user's taste profile, and constructs
 * a bucket-balanced ranked recommendation list.
 */
export function rankCandidates(
  candidates: Candidate[],
  userRatings: UserRating[],
  options: RankCandidatesOptions
): Recommendation[] {
  const {
    serendipityLevel = 30,
    preferredEras,
    selectedVibes,
    rejectedFilms = [],
    excludeIds,
    size = 30,
  } = options;

  const targetSize = typeof size === 'number' && Number.isFinite(size) ? Math.floor(size) : 30;
  if (!Array.isArray(candidates) || candidates.length === 0 || targetSize <= 0) {
    return [];
  }

  const safeRatings = Array.isArray(userRatings)
    ? userRatings.filter((r): r is UserRating => Boolean(r) && typeof r.movieId === 'number')
    : [];
  const ratedIds = new Set(safeRatings.map((r) => r.movieId));
  const seenIds = new Set<number>();
  const seenSeries = new Set<string>();
  const filtered: Candidate[] = [];

  for (const candidate of candidates) {
    if (!candidate?.movie || typeof candidate.movie.id !== 'number' || !Number.isFinite(candidate.movie.id)) {
      continue;
    }
    const id = candidate.movie.id;
    if (ratedIds.has(id) || excludeIds?.has(id) || seenIds.has(id)) {
      continue;
    }

    const title = typeof candidate.movie.title === 'string' ? candidate.movie.title.trim() : '';
    if (title.length > 0) {
      const seriesKey = getSeriesKey(id, title);
      if (seenSeries.has(seriesKey)) {
        continue;
      }
      seenSeries.add(seriesKey);
    }

    seenIds.add(id);
    filtered.push(candidate);
  }

  if (filtered.length === 0) {
    return [];
  }

  const profile = buildTasteProfile(safeRatings);
  const scored = scoreCandidates(filtered, profile, {
    preferredEras,
    selectedVibes,
  });
  const ranked = buildRankedList(
    scored,
    mixForSerendipityLevel(serendipityLevel),
    targetSize
  );

  const topLikedGenre = buildTopLikedGenre(profile, safeRatings);

  return ranked.map((item) => {
    const rawScore = Number.isFinite(item.scores.relevance)
      ? Math.round(100 * item.scores.relevance)
      : 0;
    const penalty =
      Array.isArray(rejectedFilms) && rejectedFilms.length > 0
        ? rejectionPenalty(item.movie, rejectedFilms)
        : 0;
    const score = Math.max(0, Math.min(100, rawScore - penalty));

    const movieGenres = extractMovieGenreNames(item.movie);
    const matchedGenres = getMatchedGenres(movieGenres, profile);
    const highlightTags =
      matchedGenres.length > 0
        ? matchedGenres.slice(0, 3)
        : profile.totalRatings === 0
        ? movieGenres.slice(0, 2)
        : [];

    const sources = Array.isArray(item.sources) ? [...item.sources] : [];

    return {
      movie: item.movie,
      score,
      rank: item.rank,
      reason: buildReason(item, profile, matchedGenres, movieGenres, topLikedGenre),
      serendipityType: mapBucketToSerendipityType(item.bucket, sources),
      highlightTags,
      bucket: item.bucket,
      sources,
    };
  });
}
