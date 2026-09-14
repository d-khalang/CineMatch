import Papa from 'papaparse';
import { UserRating } from '../types';

export interface ParsedCsvMovie {
  title: string;
  year?: string;
  rating: number; // 1-10 normalized
  sourceId?: string; // e.g. tt1234567 for IMDb
  tmdbId?: number; // Parsed from CineMatch export (TMDB_ID)
  director?: string;
  genres?: string[];
}

export interface CsvParseResult {
  format: 'imdb' | 'letterboxd' | 'generic';
  accepted: ParsedCsvMovie[];
  rejected: { row: number; title?: string; reason: string }[];
  totalRows: number;
}

/**
 * Strips CSV formula injection characters (=, +, -, @, tab, cr) by prepending a quote
 */
export function sanitizeCsvFormula(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return trimmed;
}

/**
 * Robust CSV parser supporting IMDb, Letterboxd, and generic exports with RFC-4180 compliance
 */
export function parseMovieCsv(csvContent: string): CsvParseResult {
  // Strip UTF-8 BOM if present
  const cleanContent = csvContent.replace(/^\uFEFF/, '').trim();

  const parseOutput = Papa.parse<Record<string, string>>(cleanContent, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const rows = parseOutput.data;
  const accepted: ParsedCsvMovie[] = [];
  const rejected: { row: number; title?: string; reason: string }[] = [];

  if (!rows || rows.length === 0) {
    return { format: 'generic', accepted, rejected, totalRows: 0 };
  }

  // Detect format from headers
  const firstRow = rows[0];
  const keys = Object.keys(firstRow);

  const isImdb = keys.includes('your rating') && (keys.includes('title') || keys.includes('const'));
  const isLetterboxd = keys.includes('name') && (keys.includes('rating') || keys.includes('letterboxd uri'));

  const format: 'imdb' | 'letterboxd' | 'generic' = isImdb
    ? 'imdb'
    : isLetterboxd
    ? 'letterboxd'
    : 'generic';

  rows.forEach((row, index) => {
    const rowNum = index + 2; // 1-based + 1 for header
    let rawTitle: string;
    let rawYear: string;
    let rawRating: string;
    let sourceId: string | undefined;
    let rawGenres: string | undefined;
    let rawDirector: string | undefined;
    let tmdbId: number | undefined;

    const rawTmdbId = row['tmdb_id'] || row['tmdb id'] || row['movie_id'] || row['movieid'];
    if (rawTmdbId) {
      const parsedId = parseInt(rawTmdbId.trim(), 10);
      if (!isNaN(parsedId) && parsedId > 0) {
        tmdbId = parsedId;
      }
    }

    if (format === 'imdb') {
      rawTitle = row['title'] || '';
      rawYear = row['year'] || '';
      rawRating = row['your rating'] || '';
      sourceId = row['const']; // e.g. tt1234567
      rawGenres = row['genres'];
      rawDirector = row['directors'];
    } else if (format === 'letterboxd') {
      rawTitle = row['name'] || '';
      rawYear = row['year'] || '';
      rawRating = row['rating'] || '';
      sourceId = row['letterboxd uri'];
    } else {
      // Generic fallback
      rawTitle = row['title'] || row['name'] || row['film'] || '';
      rawYear = row['year'] || row['release_year'] || '';
      rawRating = row['rating'] || row['user_rating'] || row['score'] || '';
      rawDirector = row['director'];
      rawGenres = row['genres'] || row['genre'];
    }

    const title = rawTitle.trim();
    if (!title) {
      rejected.push({ row: rowNum, reason: 'Missing movie title' });
      return;
    }

    const parsedNum = parseFloat(rawRating);
    if (isNaN(parsedNum)) {
      rejected.push({ row: rowNum, title, reason: `Invalid rating format "${rawRating}"` });
      return;
    }

    // Convert rating: Letterboxd uses 0.5-5.0 scale; IMDb uses 1-10
    let normalizedRating: number;
    if (format === 'letterboxd') {
      normalizedRating = Math.round(parsedNum * 2);
    } else if (parsedNum <= 5 && !isImdb && rawRating.includes('.')) {
      // Possible 5-star scale
      normalizedRating = Math.round(parsedNum * 2);
    } else {
      normalizedRating = Math.round(parsedNum);
    }

    if (normalizedRating < 1 || normalizedRating > 10) {
      rejected.push({
        row: rowNum,
        title,
        reason: `Rating ${normalizedRating} out of allowable range (1 to 10)`,
      });
      return;
    }

    const genres = rawGenres
      ? rawGenres
          .split(/[,;|]/)
          .map((g) => g.trim())
          .filter(Boolean)
      : undefined;

    accepted.push({
      title,
      year: rawYear ? rawYear.trim().slice(0, 4) : undefined,
      rating: normalizedRating,
      sourceId: sourceId ? sourceId.trim() : undefined,
      tmdbId,
      director: rawDirector ? rawDirector.trim() : undefined,
      genres,
    });
  });

  return {
    format,
    accepted,
    rejected,
    totalRows: rows.length,
  };
}

/**
 * Exports user ratings to an RFC-4180 CSV string with formula injection protection
 */
export function generateRatingsCsv(ratings: Record<number, UserRating>): string {
  const ratingsList = Object.values(ratings);
  const rows = ratingsList.map((r) => ({
    Title: sanitizeCsvFormula(r.title),
    Year: r.year || '',
    Rating: r.rating,
    Genres: (r.genres || []).join('; '),
    Director: sanitizeCsvFormula(r.director || ''),
    TMDB_ID: r.movieId,
    Rated_At: new Date(r.ratedAt).toISOString(),
  }));

  return Papa.unparse(rows, {
    quotes: true,
    header: true,
  });
}
