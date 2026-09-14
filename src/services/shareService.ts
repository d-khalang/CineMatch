import { Movie } from '../types';
import { BoundedLRUMap } from './tmdb';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

// Bounded in-memory cache for resolved IMDb IDs
const imdbIdCache = new BoundedLRUMap<number, string>(200);

const IMDB_ID_REGEX = /^tt\d{7,10}$/;

export function getShareUrl(movie: Movie): string {
  // 1. Check if movie already has a valid imdb_id
  if (movie.imdb_id && IMDB_ID_REGEX.test(movie.imdb_id)) {
    imdbIdCache.set(movie.id, movie.imdb_id);
    return `https://www.imdb.com/title/${movie.imdb_id}/`;
  }

  // 2. Check cache
  if (imdbIdCache.has(movie.id)) {
    const cachedId = imdbIdCache.get(movie.id)!;
    if (IMDB_ID_REGEX.test(cachedId)) {
      return `https://www.imdb.com/title/${cachedId}/`;
    }
  }

  // 3. Fallback to direct TMDB URL (synchronous to preserve transient user activation for Web Share API)
  return `https://www.themoviedb.org/movie/${movie.id}`;
}

export interface ShareResult {
  success: boolean;
  type: 'shared' | 'copied' | 'cancelled';
  url: string;
}

export async function shareMovie(movie: Movie): Promise<ShareResult> {
  const url = getShareUrl(movie);
  const year = movie.release_date ? movie.release_date.slice(0, 4) : '';
  const title = year ? `${movie.title} (${year})` : movie.title;
  const text = `Check out "${movie.title}" on CineMatch AI!`;

  // 1. Native Capacitor Share (Android / iOS)
  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({
        title,
        text,
        url,
        dialogTitle: `Share ${movie.title}`,
      });
      return { success: true, type: 'shared', url };
    } catch (error: unknown) {
      if (
        (error instanceof Error && error.message?.includes('canceled')) ||
        (typeof error === 'object' && error !== null && 'name' in error && (error as any).name === 'AbortError')
      ) {
        return { success: false, type: 'cancelled', url };
      }
    }
  }

  // 2. Native Web Share API (Desktop/Mobile Web)
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title,
        text,
        url,
      });
      return { success: true, type: 'shared', url };
    } catch (error: unknown) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        (typeof error === 'object' && error !== null && 'name' in error && (error as any).name === 'AbortError')
      ) {
        return { success: false, type: 'cancelled', url };
      }
      console.warn('Native web share failed, falling back to clipboard copy:', error);
    }
  }

  // 3. Fallback: Copy to clipboard
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return { success: true, type: 'copied', url };
    }
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }

  return { success: false, type: 'copied', url };
}
