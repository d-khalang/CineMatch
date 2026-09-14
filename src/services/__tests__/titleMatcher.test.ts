import { describe, it, expect } from 'vitest';
import { normalizeTitle, titlesMatch, levenshteinSimilarity } from '../titleMatcher';

describe('Title Matching', () => {
  describe('normalizeTitle', () => {
    it('strips leading articles and punctuation', () => {
      expect(normalizeTitle('The Shawshank Redemption')).toBe('shawshank redemption');
      expect(normalizeTitle('A Beautiful Mind')).toBe('beautiful mind');
      expect(normalizeTitle('An Officer and a Gentleman')).toBe('officer and a gentleman');
    });

    it('collapses whitespace and special characters', () => {
      expect(normalizeTitle('Spider-Man: No Way Home')).toBe('spider man no way home');
    });
  });

  describe('titlesMatch', () => {
    it('matches identical titles', () => {
      expect(titlesMatch('Inception', 'Inception')).toBe(true);
    });

    it('matches titles differing only by articles', () => {
      expect(titlesMatch('The Matrix', 'Matrix')).toBe(true);
    });

    it('rejects "It" matching "Little Women"', () => {
      expect(titlesMatch('It', 'Little Women')).toBe(false);
    });

    it('rejects "Alien" matching "Aliens"', () => {
      expect(titlesMatch('Alien', 'Aliens')).toBe(false);
    });

    it('rejects "Up" matching "Superbad"', () => {
      expect(titlesMatch('Up', 'Superbad')).toBe(false);
    });

    it('rejects short substrings in longer titles', () => {
      expect(titlesMatch('Her', 'The Others')).toBe(false);
      expect(titlesMatch('Us', 'Rush')).toBe(false);
    });

    it('matches close variations of the same title', () => {
      expect(titlesMatch('Star Wars: A New Hope', 'Star Wars A New Hope')).toBe(true);
      expect(titlesMatch('The Lord of the Rings', 'Lord of the Rings')).toBe(true);
    });

    it('rejects clearly different titles', () => {
      expect(titlesMatch('Pulp Fiction', 'Fight Club')).toBe(false);
      expect(titlesMatch('Blade Runner', 'Blade Runner 2049')).toBe(false);
    });
  });

  describe('levenshteinSimilarity', () => {
    it('returns 1 for identical strings', () => {
      expect(levenshteinSimilarity('abc', 'abc')).toBe(1);
    });

    it('returns 0 for completely different strings of equal length', () => {
      expect(levenshteinSimilarity('abc', 'xyz')).toBe(0);
    });

    it('returns correct similarity for close strings', () => {
      const sim = levenshteinSimilarity('kitten', 'sitting');
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(0.8);
    });
  });
});
