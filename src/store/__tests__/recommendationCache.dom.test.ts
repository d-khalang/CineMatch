import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readRecommendationCache,
  writeRecommendationCache,
  patchRecommendationCache,
  getFingerprintAndRatedCountFallbacks,
} from '../recommendationCache';
import {
  STORAGE_KEYS,
  clearInMemoryStoreForTesting,
  CachedRecommendationsData,
} from '../../services/storage';
import { Recommendation } from '../../types';

describe('recommendationCache module', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
  });

  const sampleRec: Recommendation = {
    movie: {
      id: 10,
      title: 'Arrival',
      overview: 'Linguistics and aliens',
      poster_path: null,
      backdrop_path: null,
      release_date: '2016-11-11',
      vote_average: 8.0,
      vote_count: 15000,
      genres: [{ id: 878, name: 'Sci-Fi' }],
    },
    score: 95,
    rank: 1,
    reason: 'Deep sci-fi masterpiece',
    serendipityType: 'safe_bet',
    highlightTags: ['Mind-bending'],
  };

  const sampleData: CachedRecommendationsData = {
    recommendations: [sampleRec],
    generatedAt: 1700000000000,
    usedProvider: 'gemini',
    tasteAnalysis: 'Strong appreciation for thoughtful sci-fi',
    settingsFingerprint: 'fp-sample-123',
    ratedCount: 25,
  };

  describe('readRecommendationCache', () => {
    it('returns null for a missing cache', () => {
      expect(readRecommendationCache()).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, '{not-valid-json');
      expect(readRecommendationCache()).toBeNull();
    });

    it('returns null for a wrong shape', () => {
      // Non-object or primitives
      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify('string-payload'));
      expect(readRecommendationCache()).toBeNull();

      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(12345));
      expect(readRecommendationCache()).toBeNull();

      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(true));
      expect(readRecommendationCache()).toBeNull();

      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify([]));
      expect(readRecommendationCache()).toBeNull();

      // Missing recommendations
      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({ generatedAt: 1234, usedProvider: 'gemini' })
      );
      expect(readRecommendationCache()).toBeNull();

      // recommendations is not an array
      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({ recommendations: 'not-an-array', generatedAt: 1234, usedProvider: 'gemini' })
      );
      expect(readRecommendationCache()).toBeNull();

      // Missing generatedAt
      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({ recommendations: [], usedProvider: 'gemini' })
      );
      expect(readRecommendationCache()).toBeNull();

      // Non-number generatedAt
      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({ recommendations: [], generatedAt: 'not-a-number', usedProvider: 'gemini' })
      );
      expect(readRecommendationCache()).toBeNull();

      // Missing usedProvider
      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({ recommendations: [], generatedAt: 1234 })
      );
      expect(readRecommendationCache()).toBeNull();

      // Non-string usedProvider
      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({ recommendations: [], generatedAt: 1234, usedProvider: 999 })
      );
      expect(readRecommendationCache()).toBeNull();

      // Invalid recommendation items
      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({
          recommendations: [null],
          generatedAt: 1234,
          usedProvider: 'gemini',
        })
      );
      expect(readRecommendationCache()).toBeNull();

      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({
          recommendations: [{ movie: null }],
          generatedAt: 1234,
          usedProvider: 'gemini',
        })
      );
      expect(readRecommendationCache()).toBeNull();

      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({
          recommendations: [{ movie: { id: 'not-a-number' } }],
          generatedAt: 1234,
          usedProvider: 'gemini',
        })
      );
      expect(readRecommendationCache()).toBeNull();

      // Wrong optional types
      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({
          recommendations: [],
          generatedAt: 1234,
          usedProvider: 'gemini',
          tasteAnalysis: 12345,
        })
      );
      expect(readRecommendationCache()).toBeNull();

      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({
          recommendations: [],
          generatedAt: 1234,
          usedProvider: 'gemini',
          settingsFingerprint: 12345,
        })
      );
      expect(readRecommendationCache()).toBeNull();

      localStorage.setItem(
        STORAGE_KEYS.CACHED_RECOMMENDATIONS,
        JSON.stringify({
          recommendations: [],
          generatedAt: 1234,
          usedProvider: 'gemini',
          ratedCount: 'not-a-number',
        })
      );
      expect(readRecommendationCache()).toBeNull();
    });

    it('returns parsed CachedRecommendationsData for a valid cache', () => {
      writeRecommendationCache(sampleData);
      const read = readRecommendationCache();
      expect(read).toEqual(sampleData);
    });
  });

  describe('writeRecommendationCache', () => {
    it('persists data to storage via safeSetItem and returns true', () => {
      const ok = writeRecommendationCache(sampleData);
      expect(ok).toBe(true);
      const raw = localStorage.getItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual(sampleData);
    });
  });

  describe('patchRecommendationCache', () => {
    it('writes nothing and returns false when cache is empty', () => {
      const ok = patchRecommendationCache({ recommendations: [] });
      expect(ok).toBe(false);
      expect(localStorage.getItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS)).toBeNull();
    });

    it('merges patch and keeps other fields', () => {
      writeRecommendationCache(sampleData);

      const updatedRec: Recommendation = {
        ...sampleRec,
        rank: 2,
        score: 80,
      };

      const ok = patchRecommendationCache({
        recommendations: [updatedRec],
      });
      expect(ok).toBe(true);

      const read = readRecommendationCache();
      expect(read).not.toBeNull();
      // recommendations updated
      expect(read?.recommendations).toEqual([updatedRec]);
      // other fields preserved
      expect(read?.generatedAt).toBe(sampleData.generatedAt);
      expect(read?.usedProvider).toBe(sampleData.usedProvider);
      expect(read?.tasteAnalysis).toBe(sampleData.tasteAnalysis);
      expect(read?.settingsFingerprint).toBe(sampleData.settingsFingerprint);
      expect(read?.ratedCount).toBe(sampleData.ratedCount);
    });

    it('can patch optional fields and keep recommendations intact', () => {
      writeRecommendationCache(sampleData);

      const ok = patchRecommendationCache({
        tasteAnalysis: 'Updated taste analysis',
        ratedCount: 30,
      });
      expect(ok).toBe(true);

      const read = readRecommendationCache();
      expect(read?.tasteAnalysis).toBe('Updated taste analysis');
      expect(read?.ratedCount).toBe(30);
      expect(read?.recommendations).toEqual(sampleData.recommendations);
      expect(read?.generatedAt).toBe(sampleData.generatedAt);
      expect(read?.usedProvider).toBe(sampleData.usedProvider);
      expect(read?.settingsFingerprint).toBe(sampleData.settingsFingerprint);
    });
  });

  describe('getFingerprintAndRatedCountFallbacks', () => {
    it('preserves settingsFingerprint and ratedCount if present on cache', () => {
      const result = getFingerprintAndRatedCountFallbacks(
        { settingsFingerprint: 'existing-fp', ratedCount: 15 },
        'fallback-fp',
        99
      );
      expect(result).toEqual({
        settingsFingerprint: 'existing-fp',
        ratedCount: 15,
      });
    });

    it('falls back to provided in-memory values when cache fields are undefined', () => {
      const result = getFingerprintAndRatedCountFallbacks({}, 'fallback-fp', 99);
      expect(result).toEqual({
        settingsFingerprint: 'fallback-fp',
        ratedCount: 99,
      });
    });

    it('omits fields when neither cache nor in-memory values exist', () => {
      const result = getFingerprintAndRatedCountFallbacks({}, null, null);
      expect(result).toEqual({});
    });
  });
});
