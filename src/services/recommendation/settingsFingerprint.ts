import type { AISettings } from '../../types';

export function recsSettingsFingerprint(
  s: Pick<AISettings, 'serendipityLevel' | 'preferredEras' | 'selectedVibes' | 'activeProvider'>
): string;
export function recsSettingsFingerprint(
  s: Partial<Pick<AISettings, 'serendipityLevel' | 'preferredEras' | 'selectedVibes' | 'activeProvider'>>
): string;
export function recsSettingsFingerprint(
  s: Partial<Pick<AISettings, 'serendipityLevel' | 'preferredEras' | 'selectedVibes' | 'activeProvider'>>
): string {
  const provider = s?.activeProvider ?? '';
  const serendipity = typeof s?.serendipityLevel === 'number' ? s.serendipityLevel : 0;
  const eras = Array.isArray(s?.preferredEras) ? [...s.preferredEras].sort() : [];
  const vibes = Array.isArray(s?.selectedVibes) ? [...s.selectedVibes].sort() : [];

  return JSON.stringify({
    activeProvider: provider,
    preferredEras: eras,
    selectedVibes: vibes,
    serendipityLevel: serendipity,
  });
}
