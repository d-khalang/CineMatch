import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { GroqProvider, GROQ_DEFAULT_MODEL, fetchGroqModels } from '../groqProvider';
import { buildOpenRouterPrompt } from '../openRouterProvider';
import { OpenRouterProvider } from '../openRouterProvider';
import { parseAIJsonResponse, composeSignals } from '../aiResponseValidator';
import { aiManager } from '../aiManager';
import { MovieStoreProvider, useMovieStore } from '../../../store/useMovieStore';
import { SettingsModal } from '../../../components/SettingsModal';
import {
  STORAGE_KEYS,
  runStorageMigration,
  safeGetItem,
  clearInMemoryStoreForTesting,
} from '../../storage';
import { credentialStore } from '../../credentialStore';
import { credentialCoordinator } from '../../credentialCoordinator';
import * as nativeVault from '../../nativeCredentialVault';

vi.mock('../../nativeCredentialVault', async () => {
  const actual = await vi.importActual<typeof import('../../nativeCredentialVault')>(
    '../../nativeCredentialVault'
  );
  return {
    ...actual,
    isVaultSupported: vi.fn().mockReturnValue(false),
    readVault: vi.fn(),
    writeVault: vi.fn(),
    clearVault: vi.fn(),
    setRememberEnabled: vi.fn(),
  };
});

const storeWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

describe('Groq Part 1 Wiring & Regression Suite (CIN-67)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(false);
    credentialStore.forgetAll();
    credentialCoordinator.resetForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Shared helpers: parseAIJsonResponse & composeSignals', () => {
    it('strips <think> blocks, markdown fences, and prose around JSON', () => {
      const wrapped = `<think>Reasoning step 1\nstep 2</think>\nHere is the payload:\n\`\`\`json\n{"taste_analysis":"Sharp","pool_rankings":[]}\n\`\`\`\nDone.`;
      expect(parseAIJsonResponse(wrapped, 'Groq')).toEqual({
        taste_analysis: 'Sharp',
        pool_rankings: [],
      });
    });

    it('throws provider-specific parse error when no JSON object can be extracted', () => {
      expect(() => parseAIJsonResponse('No braces anywhere here', 'Groq')).toThrow(
        'Failed to parse structured JSON from Groq.'
      );
      expect(() => parseAIJsonResponse('<think>only thoughts</think>', 'OpenRouter')).toThrow(
        'Failed to parse structured JSON from OpenRouter.'
      );
    });

    it('composes AbortSignals including pre-aborted and undefined inputs', () => {
      const preAborted = new AbortController();
      preAborted.abort(new Error('already cancelled'));
      const composedImmediate = composeSignals([undefined, preAborted.signal]);
      expect(composedImmediate.aborted).toBe(true);

      const first = new AbortController();
      const second = new AbortController();
      const composed = composeSignals([undefined, first.signal, second.signal]);
      expect(composed.aborted).toBe(false);
      second.abort();
      expect(composed.aborted).toBe(true);
    });

    it('preserves OpenRouter error messages when using shared helpers', async () => {
      const provider = new OpenRouterProvider();
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'not valid json' } }] }),
        })
      );

      await expect(
        provider.generateRecommendations({
          userRatings: [],
          candidatePool: [],
          serendipityLevel: 30,
          apiKey: 'or-key',
        })
      ).rejects.toThrow('Failed to parse structured JSON from OpenRouter.');
    });
  });

  describe('GroqProvider request payload & MSW handlers', () => {
    const generateBody = async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: JSON.stringify({ taste_analysis: 'Test', pool_rankings: [], unconstrained_discoveries: [] }),
              },
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);
      await new GroqProvider().generateRecommendations({
        userRatings: [
          { movieId: 1, title: 'Rated', rating: 9, posterPath: null, genres: ['Drama'], ratedAt: 1 },
        ],
        candidatePool: [],
        serendipityLevel: 40,
        apiKey: 'groq-test-key',
      });
      return JSON.parse(fetchMock.mock.calls[0][1].body);
    };

    it('caps the reply and sends a compact prompt, so a run fits the free-tier token limit', async () => {
      const body = await generateBody();
      expect(body.max_tokens).toBe(3500);
      const prompt = body.messages[1].content;
      expect(prompt).toContain('[{"title":"Rated"');
      expect(prompt).not.toContain('\n  {\n    "title"');
    });

    it('keeps the pretty-printed prompt for OpenRouter', () => {
      const prompt = buildOpenRouterPrompt({
        userRatings: [
          { movieId: 1, title: 'Rated', rating: 9, posterPath: null, genres: ['Drama'], ratedAt: 1 },
        ],
        candidatePool: [],
      } as never);
      expect(prompt).toContain('\n  {\n    "title": "Rated"');
    });

    it('reports a cut-off reply clearly instead of a raw JSON parse error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ choices: [{ finish_reason: 'length', message: { content: '{"pool_rankings": [' } }] }),
        })
      );

      await expect(
        new GroqProvider().generateRecommendations({
          userRatings: [],
          candidatePool: [],
          serendipityLevel: 40,
          apiKey: 'groq-test-key',
        })
      ).rejects.toThrow('cut off');
    });

    it('does not send response_format in testConnection or generateRecommendations', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  taste_analysis: 'Test',
                  pool_rankings: [],
                  unconstrained_discoveries: [],
                }),
              },
            },
          ],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = new GroqProvider();
      await provider.testConnection('groq-test-key', 'llama-3.3-70b-versatile');
      await provider.generateRecommendations({
        userRatings: [],
        candidatePool: [],
        serendipityLevel: 40,
        apiKey: 'groq-test-key',
        model: 'llama-3.3-70b-versatile',
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const testBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      const genBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(testBody).not.toHaveProperty('response_format');
      expect(genBody).not.toHaveProperty('response_format');
    });

    it('filters embedding models (embed) case-insensitively and rejects malformed entries', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              { id: 'nomic-EMBED-text-v1', active: true },
              { id: 'qwen-qwq-32b', active: true },
            ],
          }),
        })
      );

      const models = await fetchGroqModels('groq-test-key');
      expect(models).toEqual([{ id: 'qwen-qwq-32b', name: 'qwen-qwq-32b' }]);
    });

    it('drops models too small for the recommendation prompt and keeps those with no reported size', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              { id: 'too-small', active: true, context_window: 4096 },
              { id: 'big-enough', active: true, context_window: 131072 },
              { id: 'size-unknown', active: true },
            ],
          }),
        })
      );

      const models = await fetchGroqModels('groq-test-key');
      expect(models.map((m) => m.id)).toEqual(['big-enough', 'size-unknown']);
    });

    it('serves Groq chat completions and model list through MSW handlers without fetch stubs', async () => {
      const models = await fetchGroqModels('msw-groq-key');
      expect(models.map((m) => m.id)).toEqual([
        'llama-3.1-8b-instant',
        'llama-3.3-70b-versatile',
      ]);

      const provider = new GroqProvider();
      const res = await provider.generateRecommendations({
        userRatings: [],
        candidatePool: [
          {
            id: 101,
            title: 'Candidate Film A',
            overview: 'Mind-bending sci-fi thriller',
            poster_path: null,
            backdrop_path: null,
            release_date: '2022-05-10',
            vote_average: 8.2,
            vote_count: 1500,
            genres: [{ id: 878, name: 'Sci-Fi' }],
          },
        ],
        serendipityLevel: 30,
        apiKey: 'msw-groq-key',
      });
      expect(res.recommendations.map((r) => r.movie.id)).toEqual([101]);
      expect(res.tasteAnalysis).toBe('Groq synthesized profile.');
    });
  });

  describe('aiManager no-key fallback message', () => {
    it('returns exact Local Smart Engine Groq prompt when Groq has no key', async () => {
      const res = await aiManager.generateRecommendations('groq', {
        userRatings: [],
        candidatePool: [],
        serendipityLevel: 30,
        apiKey: '',
      });
      expect(res.usedProvider).toBe('Local Smart Engine (Configure Groq Key in Settings)');
    });
  });

  describe('useMovieStore settings & per-provider key/model routing', () => {
    it('sanitizes groqModel on load and persists groqModel without persisting groqApiKey', () => {
      localStorage.setItem(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify({
          activeProvider: 'groq',
          groqModel: '   ',
          groqApiKey: 'should-not-load-from-disk',
        })
      );

      const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: storeWrapper });
      expect(result.current.aiSettings.activeProvider).toBe('groq');
      expect(result.current.aiSettings.groqModel).toBe(GROQ_DEFAULT_MODEL);
      expect(result.current.aiSettings.groqApiKey).toBe('');

      act(() => {
        result.current.updateAISettings({ groqModel: 'llama-3.1-8b-instant' });
      });

      const persisted = JSON.parse(safeGetItem(STORAGE_KEYS.SETTINGS) || '{}');
      expect(persisted.groqModel).toBe('llama-3.1-8b-instant');
      expect(persisted.groqApiKey).toBeUndefined();
      unmount();

      // Reload verifies trimmed custom live model id survives load sanitization
      clearInMemoryStoreForTesting();
      localStorage.setItem(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify({
          activeProvider: 'groq',
          groqModel: '  mixtral-8x7b-32768  ',
        })
      );
      const reloaded = renderHook(() => useMovieStore(), { wrapper: storeWrapper });
      expect(reloaded.result.current.aiSettings.groqModel).toBe('mixtral-8x7b-32768');
      reloaded.unmount();
    });

    it('routes each provider its own key and model in generateRankings (never sending OpenRouter key to Groq)', async () => {
      credentialStore.setTmdbCredential('api_key', 'tmdb-test-key');
      credentialStore.setGeminiKey('gemini-secret-key');
      credentialStore.setOpenRouterKey('openrouter-secret-key');
      credentialStore.setGroqKey('groq-secret-key');

      const generateSpy = vi.spyOn(aiManager, 'generateRecommendations').mockResolvedValue({
        recommendations: [],
        usedProvider: 'Mocked Provider',
      });

      const { result } = renderHook(() => useMovieStore(), { wrapper: storeWrapper });

      // 1. Groq active -> receives groq-secret-key and groq-custom-model
      act(() => {
        result.current.updateAISettings({
          activeProvider: 'groq',
          geminiModel: 'gemini-custom-model',
          openRouterModel: 'openrouter-custom-model',
          groqModel: 'groq-custom-model',
        });
      });

      await act(async () => {
        await result.current.generateRankings();
      });

      expect(generateSpy).toHaveBeenLastCalledWith(
        'groq',
        expect.objectContaining({
          apiKey: 'groq-secret-key',
          model: 'groq-custom-model',
        }),
        expect.any(AbortSignal)
      );

      // 2. OpenRouter active -> receives openrouter-secret-key and openrouter-custom-model
      act(() => {
        result.current.updateAISettings({ activeProvider: 'openrouter' });
      });

      await act(async () => {
        await result.current.generateRankings();
      });

      expect(generateSpy).toHaveBeenLastCalledWith(
        'openrouter',
        expect.objectContaining({
          apiKey: 'openrouter-secret-key',
          model: 'openrouter-custom-model',
        }),
        expect.any(AbortSignal)
      );

      // 3. Gemini active -> receives gemini-secret-key and gemini-custom-model
      act(() => {
        result.current.updateAISettings({ activeProvider: 'gemini' });
      });

      await act(async () => {
        await result.current.generateRankings();
      });

      expect(generateSpy).toHaveBeenLastCalledWith(
        'gemini',
        expect.objectContaining({
          apiKey: 'gemini-secret-key',
          model: 'gemini-custom-model',
        }),
        expect.any(AbortSignal)
      );

      // 4. Local active -> receives empty key and undefined model
      act(() => {
        result.current.updateAISettings({ activeProvider: 'local' });
      });

      await act(async () => {
        await result.current.generateRankings();
      });

      expect(generateSpy).toHaveBeenLastCalledWith(
        'local',
        expect.objectContaining({
          apiKey: '',
          model: undefined,
        }),
        expect.any(AbortSignal)
      );
    });
  });

  describe('storage migration', () => {
    it('sanitizes groqModel and strips legacy groqApiKey during v1 -> v2 migration', () => {
      localStorage.setItem(
        STORAGE_KEYS.LEGACY_SETTINGS,
        JSON.stringify({
          activeProvider: 'groq',
          groqApiKey: 'LEAKED_GROQ_KEY',
          groqModel: '   ',
          serendipityLevel: 45,
        })
      );

      const res = runStorageMigration();
      expect(res.migrated).toBe(true);
      expect(res.secretsStripped).toBe(true);

      const savedSettings = JSON.parse(safeGetItem(STORAGE_KEYS.SETTINGS) || '{}');
      expect(savedSettings.groqApiKey).toBeUndefined();
      expect(savedSettings.groqModel).toBe(GROQ_DEFAULT_MODEL);
    });
  });

  describe('credentialCoordinator retryDeletion & SettingsModal save preservation', () => {
    it('includes groqApiKey when retryDeletion rewrites non-empty vault after a failed forget', async () => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
      vi.mocked(nativeVault.readVault).mockResolvedValue({
        credentials: {
          tmdbType: 'read_access_token',
          tmdbValue: '',
          geminiApiKey: 'gem-key',
          openRouterApiKey: '',
          groqApiKey: 'keep-groq-key',
        },
        rememberEnabled: true,
      });
      credentialCoordinator.resetForTesting();
      await credentialCoordinator.initialize();

      vi.mocked(nativeVault.writeVault).mockRejectedValueOnce(
        new nativeVault.VaultBridgeError('WRITE_FAILED', 'Temporary I/O failure')
      );
      await credentialCoordinator.forgetProvider('gemini');
      expect(credentialCoordinator.getState().deletionFailureWarning).toBeTruthy();

      vi.mocked(nativeVault.writeVault).mockResolvedValueOnce();
      await credentialCoordinator.retryDeletion();

      expect(nativeVault.writeVault).toHaveBeenLastCalledWith({
        tmdbType: 'read_access_token',
        tmdbValue: '',
        geminiApiKey: '',
        openRouterApiKey: '',
        groqApiKey: 'keep-groq-key',
      });
      expect(credentialCoordinator.getState().deletionFailureWarning).toBeNull();
    });

    it('preserves existing groqApiKey in credentialStore when saving SettingsModal', async () => {
      credentialStore.setTmdbCredential('read_access_token', 'existing-tmdb');
      credentialStore.setGroqKey('existing-groq-key');
      const saveSpy = vi.spyOn(credentialCoordinator, 'saveCredentials');
      const onClose = vi.fn();

      render(
        <MovieStoreProvider>
          <SettingsModal isOpen={true} onClose={onClose} />
        </MovieStoreProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: /Save & Apply Settings/i }));

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          groqApiKey: 'existing-groq-key',
        })
      );
      expect(credentialStore.getCredentials().groqApiKey).toBe('existing-groq-key');
    });
  });
});
