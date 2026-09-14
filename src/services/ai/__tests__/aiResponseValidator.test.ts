import { describe, it, expect } from 'vitest';
import { validateAndSanitizeAIResponse } from '../aiResponseValidator';
import { Movie } from '../../../types';

describe('AI Response Validator & React Safety', () => {
  const candidateMovie1: Movie = {
    id: 101,
    title: 'Inception',
    overview: 'Mind bending heist',
    release_date: '2010-07-16',
    vote_average: 8.4,
    vote_count: 20000,
    poster_path: '/inception.jpg',
    backdrop_path: null,
    genres: [{ id: 878, name: 'Sci-Fi' }],
  };

  const candidateMovie2: Movie = {
    id: 202,
    title: 'Interstellar',
    overview: 'Space journey',
    release_date: '2014-11-07',
    vote_average: 8.6,
    vote_count: 25000,
    poster_path: '/interstellar.jpg',
    backdrop_path: null,
    genres: [{ id: 878, name: 'Sci-Fi' }],
  };

  const candidateMap = new Map<number, Movie>([
    [101, candidateMovie1],
    [202, candidateMovie2],
  ]);

  it('sanitizes object reasons to prevent React child render crashes', () => {
    const rawMalicious = {
      recommendations: [
        {
          movieId: 101,
          score: 95,
          reason: { text: 'This was returned as a nested object by the LLM!' },
          highlightTags: [{ tag: 'mind-bending' }, { text: 'sci-fi' }],
          serendipityType: 'safe_bet',
        },
      ],
      taste_analysis: {
        dominant_theme: 'Complex narratives',
        vector: [0.1, 0.9],
      },
    };

    const sanitized = validateAndSanitizeAIResponse(rawMalicious, candidateMap);
    expect(sanitized.recommendations).toHaveLength(1);

    const rec = sanitized.recommendations[0];
    // reason MUST be a primitive string, never an object
    expect(typeof rec.reason).toBe('string');
    expect(rec.reason).toBe('This was returned as a nested object by the LLM!');

    // highlightTags MUST be an array of primitive strings, never objects
    expect(Array.isArray(rec.highlightTags)).toBe(true);
    rec.highlightTags.forEach((tag) => {
      expect(typeof tag).toBe('string');
    });
    expect(rec.highlightTags).toEqual(['mind-bending', 'sci-fi']);

    // tasteAnalysis MUST be a primitive string, never an object
    expect(typeof sanitized.tasteAnalysis).toBe('string');
    expect(sanitized.tasteAnalysis).toContain('Complex narratives');
  });

  it('handles completely arbitrary object shapes without throwing', () => {
    const rawWeird = {
      recommendations: [
        {
          movieId: 101,
          score: 150, // exceeds max clamp
          reason: { foo: { bar: 123 } }, // no string property
          highlightTags: [null, undefined, 42, { complex: true }],
          serendipityType: 'unknown_unsupported_type',
        },
      ],
      taste_analysis: 99999, // number instead of string
    };

    const sanitized = validateAndSanitizeAIResponse(rawWeird, candidateMap);
    const rec = sanitized.recommendations[0];

    expect(typeof rec.reason).toBe('string');
    expect(rec.score).toBe(99); // clamped to 99
    expect(rec.serendipityType).toBe('safe_bet'); // defaulted to safe_bet
    expect(rec.highlightTags).toEqual(['42']); // only primitive converts
    expect(sanitized.tasteAnalysis).toBeUndefined();
  });

  it('clamps scores between 45 and 99', () => {
    const rawScores = {
      recommendations: [
        { movieId: 101, score: 120, reason: 'High score' },
        { movieId: 202, score: 10, reason: 'Low score' },
      ],
    };

    const sanitized = validateAndSanitizeAIResponse(rawScores, candidateMap);
    expect(sanitized.recommendations[0].score).toBe(99);
    expect(sanitized.recommendations[1].score).toBe(45);
  });

  it('deduplicates recommendations by movieId', () => {
    const rawDuplicates = {
      recommendations: [
        { movieId: 101, score: 90, reason: 'First occurrence' },
        { movieId: 101, score: 85, reason: 'Duplicate occurrence' },
        { movieId: 202, score: 88, reason: 'Second film' },
      ],
    };

    const sanitized = validateAndSanitizeAIResponse(rawDuplicates, candidateMap);
    expect(sanitized.recommendations).toHaveLength(2);
    expect(sanitized.recommendations[0].movie.id).toBe(101);
    expect(sanitized.recommendations[0].score).toBe(90);
    expect(sanitized.recommendations[1].movie.id).toBe(202);
  });

  it('sanitizes and bounds unconstrained discoveries', () => {
    const rawDiscoveries = {
      recommendations: [],
      discoveries: [
        {
          title: 'A Beautiful Film',
          year: 2021,
          reason: { description: 'Magnificent direction' },
          highlight_tags: ['Art-house', { tag: 'Cinematography' }],
          score: 92,
        },
        {
          title: '', // empty title should be rejected
          year: 2020,
        },
      ],
    };

    const sanitized = validateAndSanitizeAIResponse(rawDiscoveries, candidateMap);
    expect(sanitized.unconstrainedDiscoveries).toHaveLength(1);
    const disc = sanitized.unconstrainedDiscoveries![0];
    expect(disc.title).toBe('A Beautiful Film');
    expect(disc.year).toBe('2021');
    expect(disc.reason).toBe('Magnificent direction');
    expect(disc.highlightTags).toEqual(['Art-house', 'Cinematography']);
  });
});
