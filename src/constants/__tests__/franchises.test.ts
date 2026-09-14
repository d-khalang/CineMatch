import { describe, it, expect } from 'vitest';
import { getSeriesKey, matchesFranchiseAlias, normalizeForMatching } from '../franchises';

describe('Franchise Deduplication & Token Normalization', () => {
  it('correctly maps legitimate franchise films to their canonical keys', () => {
    expect(getSeriesKey(1, 'Thor: Ragnarok')).toBe('franchise:thor');
    expect(getSeriesKey(2, 'Thor: Love and Thunder')).toBe('franchise:thor');
    expect(getSeriesKey(3, 'Ted 2')).toBe('franchise:ted');
    expect(getSeriesKey(4, 'Alien: Romulus')).toBe('franchise:alien');
    expect(getSeriesKey(5, 'Blade Runner 2049')).toBe('franchise:blade-runner');
    expect(getSeriesKey(6, 'Madagascar 3: Europe\'s Most Wanted')).toBe('franchise:madagascar');
    expect(getSeriesKey(7, 'Joker: Folie à Deux')).toBe('franchise:joker');
  });

  it('prevents false-positive substring collisions on unrelated movie titles', () => {
    // "thor" must not match "author" or "ghost writer"
    expect(getSeriesKey(10, 'Author: The JT LeRoy Story')).not.toBe('franchise:thor');
    expect(getSeriesKey(11, 'The Ghost Writer')).not.toBe('franchise:thor');

    // "ted" must not match "united" or "wanted" or "haunted"
    expect(getSeriesKey(12, 'United 93')).not.toBe('franchise:ted');
    expect(getSeriesKey(13, 'Wanted')).not.toBe('franchise:ted');
    expect(getSeriesKey(14, 'The Haunted Mansion')).not.toBe('franchise:ted');

    // "alien" must not match "salient" or "alienation"
    expect(getSeriesKey(15, 'Salient')).not.toBe('franchise:alien');
    expect(getSeriesKey(16, 'Alienation')).not.toBe('franchise:alien');
  });

  it('handles diacritics and apostrophes uniformly', () => {
    expect(normalizeForMatching('Folie à Deux')).toBe('folie a deux');
    expect(normalizeForMatching("Europe's Most Wanted")).toBe('europes most wanted');
    expect(matchesFranchiseAlias('joker: folie a deux', 'folie à deux')).toBe(true);
  });

  it('stems sequel numerals and subtitles accurately', () => {
    const keyPart1 = getSeriesKey(20, 'The Godfather: Part I');
    const keyPart2 = getSeriesKey(21, 'The Godfather Part II');
    expect(keyPart1).toBe('franchise:godfather');
    expect(keyPart2).toBe('franchise:godfather');
  });
});
