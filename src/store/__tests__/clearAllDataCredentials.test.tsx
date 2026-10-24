import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { credentialCoordinator } from '../../services/credentialCoordinator';
import { credentialStore } from '../../services/credentialStore';
import { clearInMemoryStoreForTesting } from '../../services/storage';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

describe('MovieStore clearAllData credentials wiping (CIN-54)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.forgetAll();
    credentialCoordinator.resetForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('store clearAllData calls credentialCoordinator.clearAllData exactly once and real credentialStore is empty afterwards', async () => {
    // 1. Populate real credentialStore with secrets across all providers
    credentialStore.setTmdbCredential('read_access_token', 'real-tmdb-secret');
    credentialStore.setGeminiKey('real-gemini-secret');
    credentialStore.setOpenRouterKey('real-openrouter-secret');

    expect(credentialStore.hasTmdb()).toBe(true);
    expect(credentialStore.hasGemini()).toBe(true);
    expect(credentialStore.hasOpenRouter()).toBe(true);
    expect(credentialStore.getCredentials().tmdbValue).toBe('real-tmdb-secret');
    expect(credentialStore.getCredentials().geminiApiKey).toBe('real-gemini-secret');
    expect(credentialStore.getCredentials().openRouterApiKey).toBe('real-openrouter-secret');

    // 2. Spy on credentialCoordinator.clearAllData without replacing the module
    const clearAllDataSpy = vi.spyOn(credentialCoordinator, 'clearAllData');

    // 3. Render the store hook
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    // 4. Trigger the store's clearAllData action
    act(() => {
      result.current.clearAllData();
    });

    // 5. Must call credentialCoordinator.clearAllData exactly once
    expect(clearAllDataSpy).toHaveBeenCalledTimes(1);

    // 6. Real credentialStore must be completely empty across all providers afterwards
    const creds = credentialStore.getCredentials();
    expect(creds.tmdbValue).toBe('');
    expect(creds.geminiApiKey).toBe('');
    expect(creds.openRouterApiKey).toBe('');
    expect(credentialStore.hasTmdb()).toBe(false);
    expect(credentialStore.hasGemini()).toBe(false);
    expect(credentialStore.hasOpenRouter()).toBe(false);
  });
});
