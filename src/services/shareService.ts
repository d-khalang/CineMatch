import { Movie } from '../types';
import { getMovieDetails } from './tmdb';

// In-memory cache for resolved IMDb IDs
const imdbIdCache = new Map<number, string>();

export async function resolveImdbUrl(movie: Movie): Promise<string> {
  // 1. Check if movie already has an imdb_id
  if (movie.imdb_id) {
    imdbIdCache.set(movie.id, movie.imdb_id);
    return `https://www.imdb.com/title/${movie.imdb_id}/`;
  }

  // 2. Check cache
  if (imdbIdCache.has(movie.id)) {
    const cachedId = imdbIdCache.get(movie.id)!;
    return `https://www.imdb.com/title/${cachedId}/`;
  }

  // 3. Fetch details from TMDB to get imdb_id
  try {
    const details = await getMovieDetails(movie.id);
    if (details.imdb_id) {
      imdbIdCache.set(movie.id, details.imdb_id);
      return `https://www.imdb.com/title/${details.imdb_id}/`;
    }
  } catch (err) {
    console.error('Failed to resolve IMDb ID for movie:', movie.id, err);
  }

  // 4. Fallback to TMDB movie page
  return `https://www.themoviedb.org/movie/${movie.id}`;
}

export interface ShareResult {
  success: boolean;
  type: 'shared' | 'copied' | 'cancelled';
  url: string;
}

export async function shareMovie(movie: Movie): Promise<ShareResult> {
  const url = await resolveImdbUrl(movie);
  const year = movie.release_date ? movie.release_date.slice(0, 4) : '';
  const title = year ? `${movie.title} (${year})` : movie.title;
  const text = `Check out "${movie.title}" on IMDb!`;

  // Try Native Web Share API if available
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title,
        text,
        url,
      });
      return { success: true, type: 'shared', url };
    } catch (error: any) {
      // If user cancelled the share dialog, do nothing
      if (error?.name === 'AbortError') {
        return { success: false, type: 'cancelled', url };
      }
      console.warn('Native share failed, falling back to clipboard copy:', error);
    }
  }

  // Fallback: Copy to clipboard
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return { success: true, type: 'copied', url };
    } else {
      // Legacy copy fallback
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        return { success: true, type: 'copied', url };
      }
    }
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }

  return { success: false, type: 'copied', url };
}
