import { describe, it, expect } from 'vitest';
import * as tmdbClient from '../tmdbClient';
import * as tmdb from '../tmdb';
import * as candidateSources from '../recommendation/candidateSources';

interface NodeFsReader {
  readFileSync: (path: URL, encoding: string) => string;
}

async function readSourceFile(relativePath: string): Promise<string> {
  const fsModuleName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ fsModuleName)) as NodeFsReader;
  return fs.readFileSync(new URL(relativePath, import.meta.url), 'utf-8');
}

function extractModuleSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importExportFromRegex = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const match of source.matchAll(importExportFromRegex)) {
    specifiers.push(match[1]);
  }
  for (const match of source.matchAll(dynamicImportRegex)) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

describe('tmdbClient leaf module and cycle check', () => {
  it('asserts tmdbClient.ts has no imports from tmdb or recommendation', async () => {
    const tmdbClientSource = await readSourceFile('../tmdbClient.ts');
    const specifiers = extractModuleSpecifiers(tmdbClientSource);

    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/(?:^|\/)tmdb(?:\.[tj]sx?)?$/);
      expect(spec).not.toMatch(/recommendation/);
    }
  });

  it('asserts candidateSources.ts imports from tmdbClient and not from tmdb', async () => {
    const candidateSourcesCode = await readSourceFile('../recommendation/candidateSources.ts');
    const specifiers = extractModuleSpecifiers(candidateSourcesCode);

    expect(specifiers).toContain('../tmdbClient');
    for (const spec of specifiers) {
      expect(spec).not.toMatch(/(?:^|\/)tmdb(?:\.[tj]sx?)?$/);
    }
  });

  it('asserts useMovieStore.tsx imports getCandidateRecommendationPool from recommendation/', async () => {
    const storeCode = await readSourceFile('../../store/useMovieStore.tsx');
    expect(storeCode).toMatch(
      /import\s*\{[^}]*\bgetCandidateRecommendationPool\b[^}]*\}\s*from\s*['"]\.\.\/services\/recommendation\/candidateSources['"]/
    );
  });

  it('exports moved leaf symbols from tmdbClient and re-exports them from tmdb', () => {
    expect(typeof tmdbClient.fetchFromTMDB).toBe('function');
    expect(typeof tmdbClient.GENRE_MAP).toBe('object');
    expect(typeof tmdbClient.getEraDateRange).toBe('function');
    expect(typeof tmdbClient.getGenreIdsForVibes).toBe('function');
    expect(typeof tmdbClient.VIBE_KEYWORD_MAP).toBe('object');
    expect(typeof tmdbClient.MissingTmdbCredentialError).toBe('function');

    expect(tmdb.fetchFromTMDB).toBe(tmdbClient.fetchFromTMDB);
    expect(tmdb.GENRE_MAP).toBe(tmdbClient.GENRE_MAP);
    expect(tmdb.getEraDateRange).toBe(tmdbClient.getEraDateRange);
    expect(tmdb.getGenreIdsForVibes).toBe(tmdbClient.getGenreIdsForVibes);
    expect(tmdb.VIBE_KEYWORD_MAP).toBe(tmdbClient.VIBE_KEYWORD_MAP);
    expect(tmdb.MissingTmdbCredentialError).toBe(tmdbClient.MissingTmdbCredentialError);
    expect(tmdb.clearTmdbCache).toBe(tmdbClient.clearTmdbCache);
    expect(tmdb.BoundedLRUMap).toBe(tmdbClient.BoundedLRUMap);
    expect(tmdb.getCandidateRecommendationPool).toBe(candidateSources.getCandidateRecommendationPool);
  });
});
