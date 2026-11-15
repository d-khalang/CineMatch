import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { SettingsModal } from '../SettingsModal';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import { credentialCoordinator } from '../../services/credentialCoordinator';
import { aiManager } from '../../services/ai/aiManager';
import { STORAGE_KEYS, safeSetItem, safeGetItem, clearInMemoryStoreForTesting } from '../../services/storage';

vi.mock('../../services/nativeCredentialVault', () => ({
  isVaultSupported: () => false,
  readVault: vi.fn(),
  writeVault: vi.fn(),
  clearVault: vi.fn(),
  setRememberEnabled: vi.fn(),
}));

const renderModal = (onClose = vi.fn()) => {
  return render(
    <MovieStoreProvider>
      <SettingsModal isOpen={true} onClose={onClose} />
    </MovieStoreProvider>
  );
};

describe('SettingsModal Groq Provider & Live Model Picker (CIN-68)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.forgetAll();
    credentialCoordinator.resetForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Selecting Groq shows the key field and the picker', async () => {
    renderModal();

    const groqTab = screen.getByRole('button', { name: /^Groq/i });
    fireEvent.click(groqTab);

    // Groq API Key field is visible with show/hide toggle
    const keyInput = screen.getByLabelText('Groq API Key') as HTMLInputElement;
    expect(keyInput).toBeInTheDocument();
    expect(keyInput.placeholder).toMatch(/gsk_/);

    // Groq Model picker is visible
    const modelPicker = screen.getByLabelText(/Groq Model/i) as HTMLSelectElement;
    expect(modelPicker).toBeInTheDocument();

    // Link to Groq console keys
    const getKeyLink = screen.getByRole('link', { name: /Get Free Key/i });
    expect(getKeyLink).toHaveAttribute('href', 'https://console.groq.com/keys');
  });

  it('2. Load models fills the picker with the mocked list, and a blank key disables the button', async () => {
    renderModal();

    const groqTab = screen.getByRole('button', { name: /^Groq/i });
    fireEvent.click(groqTab);

    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });
    expect(loadModelsBtn).toBeDisabled();

    // Type a key
    const keyInput = screen.getByLabelText('Groq API Key');
    fireEvent.change(keyInput, { target: { value: 'gsk_test_key_123' } });

    expect(loadModelsBtn).toBeEnabled();

    // Click Load models
    fireEvent.click(loadModelsBtn);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /llama-3.3-70b-versatile/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /llama-3.1-8b-instant/i })).toBeInTheDocument();
    });
  });

  it('3. Choosing a model and saving stores groqModel and the key', async () => {
    const onClose = vi.fn();
    renderModal(onClose);

    const groqTab = screen.getByRole('button', { name: /^Groq/i });
    fireEvent.click(groqTab);

    const keyInput = screen.getByLabelText('Groq API Key');
    fireEvent.change(keyInput, { target: { value: 'gsk_super_secret_groq_key' } });

    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });
    fireEvent.click(loadModelsBtn);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /llama-3.3-70b-versatile/i })).toBeInTheDocument();
    });

    // Select the model
    const modelPicker = screen.getByLabelText(/Groq Model/i);
    fireEvent.change(modelPicker, { target: { value: 'llama-3.3-70b-versatile' } });

    const saveBtn = screen.getByRole('button', { name: /Save & Apply Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    // Check credentials and settings saved
    expect(credentialStore.getCredentials().groqApiKey).toBe('gsk_super_secret_groq_key');
    const stored = JSON.parse(safeGetItem(STORAGE_KEYS.SETTINGS) || '{}');
    expect(stored.groqModel).toBe('llama-3.3-70b-versatile');
    expect(stored.activeProvider).toBe('groq');
  });

  it('4. A failed load shows the error and keeps the selection', async () => {
    server.use(
      http.get('https://api.groq.com/openai/v1/models', () => {
        return HttpResponse.json(
          {
            error: {
              message: 'Rate limit reached for model in organization org_test_secret123: limit 8000 tokens',
              type: 'tokens',
              code: 'rate_limit_exceeded',
            },
          },
          { status: 429 }
        );
      })
    );

    renderModal();

    const groqTab = screen.getByRole('button', { name: /^Groq/i });
    fireEvent.click(groqTab);

    const modelPicker = screen.getByLabelText(/Groq Model/i) as HTMLSelectElement;
    const initialSelectedModel = modelPicker.value;

    const keyInput = screen.getByLabelText('Groq API Key');
    fireEvent.change(keyInput, { target: { value: 'gsk_valid_format_key' } });

    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });
    fireEvent.click(loadModelsBtn);

    await waitFor(() => {
      // 429 on Load models should read as a rate limit without mentioning ratings or the raw org ID
      expect(
        screen.getByText('Groq is rate limiting this key. Try again in a minute.')
      ).toBeInTheDocument();
      expect(screen.queryByText(/ratings/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/org_test_secret123/)).not.toBeInTheDocument();
    });

    // Selection is preserved
    expect(modelPicker.value).toBe(initialSelectedModel);
  });

  it('5. A saved model missing from the list stays selected', async () => {
    safeSetItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        activeProvider: 'groq',
        groqModel: 'custom-saved-groq-model-123',
      })
    );

    renderModal();

    const modelPicker = screen.getByLabelText(/Groq Model/i) as HTMLSelectElement;
    // Initial saved model is displayed with (saved)
    expect(
      screen.getByRole('option', { name: /custom-saved-groq-model-123 \(saved\)/i })
    ).toBeInTheDocument();
    expect(modelPicker.value).toBe('custom-saved-groq-model-123');

    // Enter key and load models
    const keyInput = screen.getByLabelText('Groq API Key');
    fireEvent.change(keyInput, { target: { value: 'gsk_valid_key' } });

    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });
    fireEvent.click(loadModelsBtn);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /llama-3.3-70b-versatile/i })).toBeInTheDocument();
    });

    // The saved model is still in options and stays selected
    expect(
      screen.getByRole('option', { name: /custom-saved-groq-model-123 \(saved\)/i })
    ).toBeInTheDocument();
    expect(modelPicker.value).toBe('custom-saved-groq-model-123');
  });

  it('6. Forget clears the key', async () => {
    credentialStore.setGroqKey('gsk_existing_key_to_forget');

    renderModal();

    const groqTab = screen.getByRole('button', { name: /^Groq/i });
    fireEvent.click(groqTab);

    const keyInput = screen.getByLabelText('Groq API Key') as HTMLInputElement;
    expect(keyInput.value).toBe('gsk_existing_key_to_forget');

    const forgetBtn = screen.getByRole('button', { name: /Forget Groq Key/i });
    expect(forgetBtn).toBeInTheDocument();

    fireEvent.click(forgetBtn);

    await waitFor(() => {
      expect(keyInput.value).toBe('');
      expect(credentialStore.getCredentials().groqApiKey).toBe('');
      expect(screen.queryByRole('button', { name: /Forget Groq Key/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Load models/i })).toBeDisabled();
    });
  });

  it('7. A stale slower response does not overwrite a newer one', async () => {
    let callCount = 0;
    server.use(
      http.get('https://api.groq.com/openai/v1/models', async () => {
        callCount++;
        if (callCount === 1) {
          // Slow first request: 300ms delay, returns stale-slow-model
          await new Promise((r) => setTimeout(r, 300));
          return HttpResponse.json({
            data: [{ id: 'stale-slow-model', active: true }],
          });
        }
        // Fast second request: immediate, returns fresh-fast-model
        return HttpResponse.json({
          data: [{ id: 'fresh-fast-model', active: true }],
        });
      })
    );

    renderModal();

    const groqTab = screen.getByRole('button', { name: /^Groq/i });
    fireEvent.click(groqTab);

    const keyInput = screen.getByLabelText('Groq API Key');
    fireEvent.change(keyInput, { target: { value: 'gsk_test_key_1' } });

    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });

    // Request 1 (slow)
    fireEvent.click(loadModelsBtn);

    // Request 2 (fast)
    fireEvent.change(keyInput, { target: { value: 'gsk_test_key_2' } });
    fireEvent.click(loadModelsBtn);

    // Fast request finishes and displays fresh-fast-model
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /fresh-fast-model/i })).toBeInTheDocument();
    });

    // Wait past the 300ms slow delay
    await new Promise((r) => setTimeout(r, 350));

    // The stale slow-model must NOT have overwritten fresh-fast-model
    expect(screen.getByRole('option', { name: /fresh-fast-model/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /stale-slow-model/i })).not.toBeInTheDocument();
  });

  it('Fix first: Test Connection with Groq selected sends only the Groq key and records groq status', async () => {
    credentialStore.setGeminiKey('gemini-secret-key');
    credentialStore.setOpenRouterKey('openrouter-secret-key');
    credentialStore.setGroqKey('groq-secret-key');

    const groqProvider = aiManager.getProvider('groq');
    const openRouterProvider = aiManager.getProvider('openrouter');
    const geminiProvider = aiManager.getProvider('gemini');

    const groqSpy = vi.spyOn(groqProvider, 'testConnection').mockResolvedValue({
      success: true,
      message: 'Successfully connected to Groq (openai/gpt-oss-120b)!',
    });
    const openRouterSpy = vi.spyOn(openRouterProvider, 'testConnection');
    const geminiSpy = vi.spyOn(geminiProvider, 'testConnection');

    renderModal();

    const groqTab = screen.getByRole('button', { name: /^Groq/i });
    fireEvent.click(groqTab);

    const testBtn = screen.getByRole('button', { name: /Test AI Connection/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(groqSpy).toHaveBeenCalledWith('groq-secret-key', expect.any(String));
      expect(openRouterSpy).not.toHaveBeenCalled();
      expect(geminiSpy).not.toHaveBeenCalled();
      expect(credentialStore.getStatuses().groq.status).toBe('valid');
      expect(credentialStore.getStatuses().openRouter.status).toBe('untested');
      expect(credentialStore.getStatuses().gemini.status).toBe('untested');
    });
  });

  it('automatically starts loading models once when Groq panel opens with a key already present', async () => {
    credentialStore.setGroqKey('gsk_pre_existing_key');
    safeSetItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        activeProvider: 'groq',
      })
    );

    renderModal();

    // Models should automatically start loading and appear in the picker
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /llama-3.3-70b-versatile/i })).toBeInTheDocument();
    });
  });

  it('closing the modal aborts the pending request and does not crash', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    server.use(
      http.get('https://api.groq.com/openai/v1/models', async () => {
        await new Promise((r) => setTimeout(r, 500));
        return HttpResponse.json({ data: [] });
      })
    );

    const { rerender } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={vi.fn()} />
      </MovieStoreProvider>
    );

    const groqTab = screen.getByRole('button', { name: /^Groq/i });
    fireEvent.click(groqTab);

    const keyInput = screen.getByLabelText('Groq API Key');
    fireEvent.change(keyInput, { target: { value: 'gsk_test_key' } });

    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });
    fireEvent.click(loadModelsBtn);

    const modelsCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/openai/v1/models'));
    const signal = modelsCall?.[1]?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    // Close the modal
    rerender(
      <MovieStoreProvider>
        <SettingsModal isOpen={false} onClose={vi.fn()} />
      </MovieStoreProvider>
    );

    expect(signal.aborted).toBe(true);
    fetchSpy.mockRestore();
  });

  it('changing the key clears the list loaded for the old key', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));

    const keyInput = screen.getByLabelText('Groq API Key');
    fireEvent.change(keyInput, { target: { value: 'gsk_first_key' } });
    fireEvent.click(screen.getByRole('button', { name: /Load models/i }));
    await screen.findByRole('option', { name: /llama-3.1-8b-instant/i });

    fireEvent.change(keyInput, { target: { value: 'gsk_second_key' } });

    expect(screen.queryByRole('option', { name: /llama-3.1-8b-instant/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load models/i })).toBeEnabled();
  });

  it('Forget clears loaded models, error alert, and test status, and disables Load models', async () => {
    let callCount = 0;

    server.use(
      http.get('https://api.groq.com/openai/v1/models', () => {
        callCount++;
        if (callCount === 1) {
          return HttpResponse.json({
            data: [{ id: 'loaded-before-error-model', active: true }],
          });
        }
        return HttpResponse.json(
          { error: { message: 'Invalid API Key' } },
          { status: 401 }
        );
      }),
      http.post('https://api.groq.com/openai/v1/chat/completions', () => {
        return HttpResponse.json(
          { error: { message: 'Invalid API Key' } },
          { status: 401 }
        );
      })
    );

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));

    const keyInput = screen.getByLabelText('Groq API Key') as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: 'gsk_first_key' } });

    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });
    fireEvent.click(loadModelsBtn);
    await screen.findByRole('option', { name: /loaded-before-error-model/i });

    fireEvent.click(screen.getByRole('button', { name: /Test AI Connection/i }));
    await screen.findByText(/Groq Error: Invalid API Key/);

    fireEvent.click(loadModelsBtn);
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid API Key/);

    fireEvent.click(screen.getByRole('button', { name: /Forget Groq Key/i }));

    await waitFor(() => {
      expect(keyInput.value).toBe('');
      expect(loadModelsBtn).toBeDisabled();
      expect(
        screen.queryByRole('option', { name: /loaded-before-error-model/i })
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/Groq Error: Invalid API Key/)).not.toBeInTheDocument();
    });
  });

  it('Forget cancels an in-flight load and prevents stale models from filling in', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    let resolveDelayed!: (value: Response) => void;

    server.use(
      http.get('https://api.groq.com/openai/v1/models', async () => {
        return await new Promise<Response>((resolve) => {
          resolveDelayed = resolve;
        });
      })
    );

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));

    const keyInput = screen.getByLabelText('Groq API Key') as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: 'gsk_inflight_key' } });

    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });
    fireEvent.click(loadModelsBtn);

    const modelsCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes('/openai/v1/models')
    );
    const inFlightSignal = modelsCall?.[1]?.signal as AbortSignal;
    expect(inFlightSignal.aborted).toBe(false);
    expect(loadModelsBtn).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(screen.getByRole('button', { name: /Forget Groq Key/i }));

    await waitFor(() => {
      expect(inFlightSignal.aborted).toBe(true);
      expect(keyInput.value).toBe('');
      expect(loadModelsBtn).toBeDisabled();
      expect(loadModelsBtn).toHaveAttribute('aria-busy', 'false');
    });

    // Resolving the aborted request afterward must not repopulate the list or show an error
    resolveDelayed(
      HttpResponse.json({
        data: [{ id: 'stale-after-forget-model', active: true }],
      })
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(
      screen.queryByRole('option', { name: /stale-after-forget-model/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('Forget during an in-flight Test AI Connection prevents the stale error from appearing', async () => {
    let resolveTest!: (value: Response) => void;
    server.use(
      http.post('https://api.groq.com/openai/v1/chat/completions', async () => {
        return await new Promise<Response>((resolve) => {
          resolveTest = resolve;
        });
      })
    );

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));
    fireEvent.change(screen.getByLabelText('Groq API Key'), {
      target: { value: 'gsk_inflight_test_key' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Test AI Connection/i }));
    await waitFor(() => {
      expect(resolveTest).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Forget Groq Key/i }));

    resolveTest(
      HttpResponse.json(
        { error: { message: 'Invalid API Key' } },
        { status: 401 }
      )
    );
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText(/Invalid API Key/i)).not.toBeInTheDocument();
    expect(credentialStore.getStatuses().groq.status).toBe('untested');
  });

  it('closing and reopening the modal does not retain a previously loaded model list', async () => {
    const { rerender } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={vi.fn()} />
      </MovieStoreProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));
    fireEvent.change(screen.getByLabelText('Groq API Key'), {
      target: { value: 'gsk_draft_key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Load models/i }));
    await screen.findByRole('option', { name: /llama-3.1-8b-instant/i });

    rerender(
      <MovieStoreProvider>
        <SettingsModal isOpen={false} onClose={vi.fn()} />
      </MovieStoreProvider>
    );
    rerender(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={vi.fn()} />
      </MovieStoreProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));
    expect(
      screen.queryByRole('option', { name: /llama-3.1-8b-instant/i })
    ).not.toBeInTheDocument();
  });

  it('429 on Test Connection reads as a rate limit and does not mention ratings', async () => {
    server.use(
      http.post('https://api.groq.com/openai/v1/chat/completions', () => {
        return HttpResponse.json(
          {
            error: {
              message: 'Rate limit reached for model in organization org_test_secret123',
            },
          },
          { status: 429 }
        );
      })
    );

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));
    fireEvent.change(screen.getByLabelText('Groq API Key'), {
      target: { value: 'gsk_rate_limited_key' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Test AI Connection/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Groq is rate limiting this key. Try again in a minute.')
      ).toBeInTheDocument();
      expect(screen.queryByText(/ratings/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/org_test_secret123/)).not.toBeInTheDocument();
      expect(credentialStore.getStatuses().groq.status).toBe('invalid');
    });
  });

  it('strips organization org_ ids from non-rate-limit Groq errors in Settings and aiManager fallback label', async () => {
    server.use(
      http.get('https://api.groq.com/openai/v1/models', () => {
        return HttpResponse.json(
          {
            error: {
              message: 'Access denied in organization org_abc: key revoked',
            },
          },
          { status: 403 }
        );
      }),
      http.post('https://api.groq.com/openai/v1/chat/completions', () => {
        return HttpResponse.json(
          {
            error: {
              message: 'Model access disabled for organization org_abc',
            },
          },
          { status: 403 }
        );
      })
    );

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));
    fireEvent.change(screen.getByLabelText('Groq API Key'), {
      target: { value: 'gsk_org_error_key' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Load models/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Access denied: key revoked/);
      expect(screen.queryByText(/org_/)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Test AI Connection/i }));
    await waitFor(() => {
      expect(screen.getByText(/Model access disabled/)).toBeInTheDocument();
      expect(screen.queryByText(/org_/)).not.toBeInTheDocument();
      expect(credentialStore.getStatuses().groq.message).not.toMatch(/org_/);
    });

    const fallbackResult = await aiManager.generateRecommendations('groq', {
      userRatings: [
        {
          movieId: 1,
          title: 'Interstellar',
          rating: 9,
          posterPath: null,
          genres: ['Sci-Fi'],
          ratedAt: 1,
        },
      ],
      candidatePool: [
        {
          id: 101,
          title: 'Arrival',
          overview: 'First contact.',
          release_date: '2016-11-11',
          vote_average: 7.9,
          vote_count: 15000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
      ],
      serendipityLevel: 30,
      apiKey: 'gsk_org_error_key',
    });

    expect(fallbackResult.usedProvider).toMatch(/^Local Engine \(Fallback: /);
    expect(fallbackResult.usedProvider).toContain('Model access disabled');
    expect(fallbackResult.usedProvider).not.toMatch(/org_/);
    expect(fallbackResult.error).not.toMatch(/org_/);
  });

  it('omits the (saved) label on the default model when nothing is saved, and keeps it for a saved model', async () => {
    server.use(
      http.get('https://api.groq.com/openai/v1/models', () => {
        return HttpResponse.json({
          data: [
            { id: 'openai/gpt-oss-120b', active: true },
            { id: 'llama-3.3-70b-versatile', active: true },
            { id: 'llama-3.1-8b-instant', active: true },
          ],
        });
      })
    );

    const { unmount } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));

    const defaultOption = screen.getByRole('option', {
      name: 'openai/gpt-oss-120b',
    }) as HTMLOptionElement;
    expect(defaultOption).toBeInTheDocument();
    expect(defaultOption.textContent).not.toContain('(saved)');

    fireEvent.change(screen.getByLabelText('Groq API Key'), {
      target: { value: 'gsk_test_key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Load models/i }));
    await screen.findByRole('option', { name: /llama-3.3-70b-versatile/i });

    expect(screen.queryByText(/\(saved\)/i)).not.toBeInTheDocument();

    // Save a chosen model, then reopen Settings
    fireEvent.change(screen.getByLabelText(/Groq Model/i), {
      target: { value: 'llama-3.3-70b-versatile' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Save & Apply Settings/i }));
    await waitFor(() => {
      expect(JSON.parse(safeGetItem(STORAGE_KEYS.SETTINGS) || '{}').groqModel).toBe(
        'llama-3.3-70b-versatile'
      );
    });

    unmount();
    renderModal();

    await screen.findByRole('option', { name: /llama-3.1-8b-instant/i });
    expect(
      screen.getByRole('option', { name: 'llama-3.3-70b-versatile (saved)' })
    ).toBeInTheDocument();
  });

  it('places the model picker before Load models in the DOM and sets aria-busy while loading', async () => {
    let resolveModels!: () => void;
    const modelsGate = new Promise<void>((resolve) => {
      resolveModels = resolve;
    });
    server.use(
      http.get('https://api.groq.com/openai/v1/models', async () => {
        await modelsGate;
        return HttpResponse.json({
          data: [{ id: 'llama-3.3-70b-versatile', active: true }],
        });
      })
    );

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /^Groq/i }));

    const modelPicker = screen.getByLabelText(/Groq Model/i);
    const loadModelsBtn = screen.getByRole('button', { name: /Load models/i });

    expect(
      modelPicker.compareDocumentPosition(loadModelsBtn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(loadModelsBtn).toHaveAttribute('aria-busy', 'false');

    fireEvent.change(screen.getByLabelText('Groq API Key'), {
      target: { value: 'gsk_busy_test_key' },
    });
    fireEvent.click(loadModelsBtn);

    expect(loadModelsBtn).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/Loading Groq models/i);

    resolveModels();

    await waitFor(() => {
      expect(loadModelsBtn).toHaveAttribute('aria-busy', 'false');
      expect(screen.getByRole('option', { name: /llama-3.3-70b-versatile/i })).toBeInTheDocument();
    });
  });
});
