import { describe, it, expect } from 'vitest';
import { recsSettingsFingerprint } from '../settingsFingerprint';
import { AISettings } from '../../../types';

describe('recsSettingsFingerprint', () => {
  const baseSettings: Pick<AISettings, 'serendipityLevel' | 'preferredEras' | 'selectedVibes' | 'activeProvider'> = {
    activeProvider: 'gemini',
    serendipityLevel: 40,
    preferredEras: ['70s', '80s'],
    selectedVibes: ['Atmospheric', 'Dark & Gritty'],
  };

  it('produces the same fingerprint when eras and vibes are reordered', () => {
    const original = recsSettingsFingerprint(baseSettings);

    const reorderedEras = recsSettingsFingerprint({
      ...baseSettings,
      preferredEras: ['80s', '70s'],
    });
    expect(reorderedEras).toBe(original);

    const reorderedVibes = recsSettingsFingerprint({
      ...baseSettings,
      selectedVibes: ['Dark & Gritty', 'Atmospheric'],
    });
    expect(reorderedVibes).toBe(original);

    const reorderedBoth = recsSettingsFingerprint({
      ...baseSettings,
      preferredEras: ['80s', '70s'],
      selectedVibes: ['Dark & Gritty', 'Atmospheric'],
    });
    expect(reorderedBoth).toBe(original);
  });

  it('produces a different fingerprint for each of the 4 fields changing', () => {
    const original = recsSettingsFingerprint(baseSettings);

    // 1. Changing activeProvider
    const changedProvider = recsSettingsFingerprint({
      ...baseSettings,
      activeProvider: 'openrouter',
    });
    expect(changedProvider).not.toBe(original);

    // 2. Changing serendipityLevel
    const changedSerendipity = recsSettingsFingerprint({
      ...baseSettings,
      serendipityLevel: 85,
    });
    expect(changedSerendipity).not.toBe(original);

    // 3. Changing preferredEras
    const changedEras = recsSettingsFingerprint({
      ...baseSettings,
      preferredEras: ['70s', '90s'],
    });
    expect(changedEras).not.toBe(original);

    // 4. Changing selectedVibes
    const changedVibes = recsSettingsFingerprint({
      ...baseSettings,
      selectedVibes: ['Atmospheric', 'Heartfelt'],
    });
    expect(changedVibes).not.toBe(original);
  });

  it('treats missing arrays as empty', () => {
    const withEmptyArrays = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
      preferredEras: [],
      selectedVibes: [],
    });

    const withOmittedArrays = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
    });

    const withUndefinedArrays = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
      preferredEras: undefined,
      selectedVibes: undefined,
    });

    expect(withOmittedArrays).toBe(withEmptyArrays);
    expect(withUndefinedArrays).toBe(withEmptyArrays);
  });
});
