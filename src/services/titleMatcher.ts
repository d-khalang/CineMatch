/**
 * Normalize a title for fuzzy comparison: lowercase, strip articles/punctuation, collapse whitespace.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/[''":;,.!?()[\]{}\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute normalized Levenshtein similarity between two strings (0 to 1).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return 1 - prev[b.length] / maxLen;
}

/**
 * Check if two titles are similar enough to be considered a match.
 * Requires high Levenshtein similarity (>= 0.85) after normalization.
 */
export function titlesMatch(importedTitle: string, candidateTitle: string): boolean {
  const a = normalizeTitle(importedTitle);
  const b = normalizeTitle(candidateTitle);
  if (a === b) return true;
  return levenshteinSimilarity(a, b) >= 0.85;
}
