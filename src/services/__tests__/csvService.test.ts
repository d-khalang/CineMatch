import { describe, it, expect } from 'vitest';
import { parseMovieCsv, generateRatingsCsv, sanitizeCsvFormula } from '../csvService';
import { UserRating } from '../../types';

describe('CSV Parsing & Sanitization Service', () => {
  it('parses standard IMDb CSV exports with 1-10 ratings', () => {
    const imdbSample = `Const,Your Rating,Date Rated,Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt1375666,10,2023-01-01,Inception,https://www.imdb.com/title/tt1375666/,movie,8.8,148,2010,"Action, Sci-Fi",2500000,2010-07-16,Christopher Nolan
tt0816692,9,2023-02-01,Interstellar,https://www.imdb.com/title/tt0816692/,movie,8.7,169,2014,"Adventure, Drama, Sci-Fi",2000000,2014-11-07,Christopher Nolan`;

    const result = parseMovieCsv(imdbSample);
    expect(result.format).toBe('imdb');
    expect(result.accepted.length).toBe(2);
    expect(result.accepted[0].title).toBe('Inception');
    expect(result.accepted[0].rating).toBe(10);
    expect(result.accepted[0].year).toBe('2010');
    expect(result.accepted[0].sourceId).toBe('tt1375666');
    expect(result.accepted[1].title).toBe('Interstellar');
    expect(result.accepted[1].rating).toBe(9);
  });

  it('parses Letterboxd CSV exports and converts 0.5-5.0 ratings to 1-10', () => {
    const letterboxdSample = `Date,Name,Year,Letterboxd URI,Rating
2024-01-15,Parasite,2019,https://boxd.it/i64K,4.5
2024-02-10,Whiplash,2014,https://boxd.it/72e6,5.0
2024-03-01,The Room,2003,https://boxd.it/1sOq,1.0`;

    const result = parseMovieCsv(letterboxdSample);
    expect(result.format).toBe('letterboxd');
    expect(result.accepted.length).toBe(3);
    // 4.5 * 2 = 9
    expect(result.accepted[0].title).toBe('Parasite');
    expect(result.accepted[0].rating).toBe(9);
    // 5.0 * 2 = 10
    expect(result.accepted[1].title).toBe('Whiplash');
    expect(result.accepted[1].rating).toBe(10);
    // 1.0 * 2 = 2
    expect(result.accepted[2].title).toBe('The Room');
    expect(result.accepted[2].rating).toBe(2);
  });

  it('handles embedded commas and quotes properly (RFC-4180)', () => {
    const quotedSample = `Title,Year,Rating
"Everything Everywhere All at Once, The",2022,9
"Mission: Impossible - Dead Reckoning, Part One",2023,8`;

    const result = parseMovieCsv(quotedSample);
    expect(result.accepted.length).toBe(2);
    expect(result.accepted[0].title).toBe('Everything Everywhere All at Once, The');
    expect(result.accepted[1].title).toBe('Mission: Impossible - Dead Reckoning, Part One');
  });

  it('sanitizes formula injection characters (=, +, -, @) in export', () => {
    expect(sanitizeCsvFormula('=SUM(1+1)')).toBe("'=SUM(1+1)");
    expect(sanitizeCsvFormula('+cmd|')).toBe("'+cmd|");
    expect(sanitizeCsvFormula('-10%')).toBe("'-10%");
    expect(sanitizeCsvFormula('@ALERT')).toBe("'@ALERT");
    expect(sanitizeCsvFormula('Safe Title')).toBe('Safe Title');

    const ratings: Record<number, UserRating> = {
      1: {
        movieId: 1,
        title: '=MALICIOUS_FORMULA',
        rating: 8,
        posterPath: null,
        director: '+ATTACK',
        genres: ['Action'],
        ratedAt: 1600000000000,
      },
    };

    const csvOutput = generateRatingsCsv(ratings);
    expect(csvOutput).toContain("'=MALICIOUS_FORMULA");
    expect(csvOutput).toContain("'+ATTACK");
  });

  it('strips UTF-8 BOM if present', () => {
    const bomSample = `\uFEFFTitle,Year,Rating\nArrival,2016,10`;
    const result = parseMovieCsv(bomSample);
    expect(result.accepted.length).toBe(1);
    expect(result.accepted[0].title).toBe('Arrival');
    expect(result.accepted[0].rating).toBe(10);
  });

  it('preserves TMDB_ID and round-trips CineMatch ratings export without data loss', () => {
    const originalRatings: Record<number, UserRating> = {
      27205: {
        movieId: 27205,
        title: 'Inception',
        rating: 10,
        year: '2010',
        genres: ['Action', 'Sci-Fi'],
        director: 'Christopher Nolan',
        posterPath: null,
        ratedAt: Date.now(),
      },
      157336: {
        movieId: 157336,
        title: 'Interstellar',
        rating: 9,
        year: '2014',
        genres: ['Adventure', 'Drama', 'Sci-Fi'],
        director: 'Christopher Nolan',
        posterPath: null,
        ratedAt: Date.now(),
      },
    };

    const exportedCsv = generateRatingsCsv(originalRatings);
    expect(exportedCsv).toContain('TMDB_ID');
    expect(exportedCsv).toContain('27205');
    expect(exportedCsv).toContain('157336');

    const parsed = parseMovieCsv(exportedCsv);
    expect(parsed.accepted).toHaveLength(2);
    expect(parsed.rejected).toHaveLength(0);

    const inception = parsed.accepted.find((m) => m.title === 'Inception');
    expect(inception).toBeDefined();
    expect(inception!.tmdbId).toBe(27205);
    expect(inception!.rating).toBe(10);
    expect(inception!.year).toBe('2010');

    const interstellar = parsed.accepted.find((m) => m.title === 'Interstellar');
    expect(interstellar).toBeDefined();
    expect(interstellar!.tmdbId).toBe(157336);
    expect(interstellar!.rating).toBe(9);
    expect(interstellar!.year).toBe('2014');
  });

  it('parses files with more than 50 rows without truncation and accounts for all rows', () => {
    const header = 'Title,Year,Rating,TMDB_ID\n';
    const rows = Array.from({ length: 80 })
      .map((_, i) => `"Film ${i + 1}",2020,${(i % 10) + 1},${1000 + i}`)
      .join('\n');

    const invalidRow = '\n"",2020,8,9999\n"Bad Rating Film",2020,15,9998';
    const csvContent = header + rows + invalidRow;

    const parsed = parseMovieCsv(csvContent);
    expect(parsed.totalRows).toBe(82);
    expect(parsed.accepted.length).toBe(80);
    expect(parsed.rejected.length).toBe(2);
    expect(parsed.accepted.length + parsed.rejected.length).toBe(parsed.totalRows);
    expect(parsed.accepted[79].title).toBe('Film 80');
    expect(parsed.accepted[79].tmdbId).toBe(1079);
  });
});
