import type { Movie, Recommendation, UserRating } from '../../types';
import type { Bucket, Candidate, CandidateSource } from './types';
import { getSeriesKey } from '../../constants/franchises';
import { rejectionPenalty, type RejectedFilm } from './rejectedFilms';
import { famePenalty } from './fame';
import {
  buildTasteProfile,
  scoreCandidates,
  buildRankedList,
  mixForSerendipityLevel,
  DEFAULT_RELEVANCE_FLOOR,
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

  let newAngle: string;
  if (unfamiliarGenres.length > 0 && isNewDecade) {
    newAngle = `${unfamiliarGenres[0]} from the ${movieDecade}`;
  } else if (unfamiliarGenres.length > 0) {
    newAngle = unfamiliarGenres[0];
  } else if (isNewDecade) {
    newAngle = `${movieDecade} cinema`;
  } else if (sources.includes('creator_graph') && director) {
    newAngle = `a different side of ${director}`;
  } else if (sources.includes('hidden_gem')) {
    newAngle = 'an under-the-radar hidden gem';
  } else {
    newAngle = bucket === 'wildcard' ? 'unexplored territory' : 'a fresh tonal direction';
  }

  let bridge: string;
  if (likedDirector) {
    bridge = `your appreciation for ${likedDirector}`;
  } else if (matchedGenres.length > 0) {
    bridge = `your taste for ${matchedGenres[0]}`;
  } else if (profile.totalRatings > 0 && (seedNeighbour || sources.includes('seed_graph'))) {
    bridge = 'titles similar to your top-rated films';
  } else if (topLikedGenre) {
    bridge = `tonal overlap with your ${topLikedGenre} favorites`;
  } else {
    bridge = `strong critical craft (${voteText})`;
  }

  let worthRisk: string;
  if (voteAvg >= 7.5) {
    worthRisk = `its ${voteAvg.toFixed(1)}/10 acclaim`;
  } else if (sources.includes('hidden_gem')) {
    worthRisk = 'standout cinephile word-of-mouth';
  } else if (likedDirector) {
    worthRisk = `${likedDirector}'s track record in your ratings`;
  } else {
    worthRisk = 'a rewarding departure from your usual rotation';
  }

  if (bucket === 'stretch') {
    return `A stretch into ${newAngle}, bridged by ${bridge} — worth the risk for ${worthRisk}.`;
  }

  return `Wildcard discovery exploring ${newAngle}, bridged by ${bridge} — worth the risk for ${worthRisk}.`;
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
  // Penalties ("Not for me" neighbours, fame for heavy raters) lower relevance before list
  // construction. Buckets stay as scored (re-bucketing would move a penalised film into the
  // low-serendipity "safe" band, which is listed first); a film pushed below the relevance
  // floor becomes a long shot.
  const penalised = scored.map((item) => {
    const points =
      (Array.isArray(rejectedFilms) && rejectedFilms.length > 0 ? rejectionPenalty(item.movie, rejectedFilms) : 0) +
      famePenalty(item.movie.vote_count, serendipityLevel, safeRatings.length);
    if (!(points > 0) || !Number.isFinite(item.scores.relevance) || item.scores.relevance <= 0) {
      return item;
    }
    const relevance = Math.max(0, item.scores.relevance - points / 100);
    const belowFloor = relevance < DEFAULT_RELEVANCE_FLOOR;
    return {
      ...item,
      scores: { ...item.scores, relevance, serendipity: belowFloor ? 0 : item.scores.serendipity },
      bucket: belowFloor ? ('below_floor' as const) : item.bucket,
    };
  });
  const ranked = buildRankedList(
    penalised,
    mixForSerendipityLevel(serendipityLevel),
    targetSize
  );

  const topLikedGenre = buildTopLikedGenre(profile, safeRatings);

  return ranked.map((item) => {
    const rawScore = Number.isFinite(item.scores.relevance)
      ? Math.round(100 * item.scores.relevance)
      : 0;
    const score = Math.max(0, Math.min(100, rawScore));

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
