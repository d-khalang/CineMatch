import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';
import { MovieStoreProvider, useMovieStore } from '../../store/useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import { credentialCoordinator } from '../../services/credentialCoordinator';
import { aiManager } from '../../services/ai/aiManager';
import { OPENROUTER_AVAILABLE_MODELS } from '../../services/ai/openRouterProvider';

import { STORAGE_KEYS, safeSetItem, clearInMemoryStoreForTesting } from '../../services/storage';

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

describe('SettingsModal OpenRouter Models & Custom Model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.forgetAll();
    credentialCoordinator.resetForTesting();
  });

  it('renders OpenRouter provider with updated free models in dropdown', async () => {
    renderModal();

    // Switch to OpenRouter tab
    const openRouterTab = screen.getByRole('button', { name: /OpenRouter/i });
    fireEvent.click(openRouterTab);

    // Check model select contains all verified models
    const modelSelect = screen.getByLabelText(/OpenRouter Model/i) as HTMLSelectElement;
    expect(modelSelect).toBeInTheDocument();

    for (const m of OPENROUTER_AVAILABLE_MODELS) {
      expect(screen.getByRole('option', { name: m.name })).toBeInTheDocument();
    }
    expect(screen.getByRole('option', { name: /Custom Model/i })).toBeInTheDocument();
  });

  it('allows choosing a preset free model without showing custom input', () => {
    renderModal();

    const openRouterTab = screen.getByRole('button', { name: /OpenRouter/i });
    fireEvent.click(openRouterTab);

    const modelSelect = screen.getByLabelText(/OpenRouter Model/i);
    fireEvent.change(modelSelect, { target: { value: 'google/gemma-4-31b-it:free' } });

    expect(screen.queryByLabelText(/Custom OpenRouter Model ID/i)).not.toBeInTheDocument();
  });

  it('selecting Custom Model reveals the custom model text input with helpful guide', () => {
    renderModal();

    const openRouterTab = screen.getByRole('button', { name: /OpenRouter/i });
    fireEvent.click(openRouterTab);

    const modelSelect = screen.getByLabelText(/OpenRouter Model/i);
    fireEvent.change(modelSelect, { target: { value: '__custom__' } });

    const customInput = screen.getByLabelText(/Custom OpenRouter Model ID/i);
    expect(customInput).toBeInTheDocument();
    expect(screen.getByText(/Free models on OpenRouter require the/i)).toBeInTheDocument();
  });

  it('shows "+ Add :free suffix" button when typing a model without :free, and appends on click', () => {
    renderModal();

    const openRouterTab = screen.getByRole('button', { name: /OpenRouter/i });
    fireEvent.click(openRouterTab);

    const modelSelect = screen.getByLabelText(/OpenRouter Model/i);
    fireEvent.change(modelSelect, { target: { value: '__custom__' } });

    const customInput = screen.getByLabelText(/Custom OpenRouter Model ID/i) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: 'meta-llama/llama-3.3-70b-instruct' } });

    const addSuffixBtn = screen.getByRole('button', { name: /\+ Add :free suffix/i });
    expect(addSuffixBtn).toBeInTheDocument();

    fireEvent.click(addSuffixBtn);
    expect(customInput.value).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(screen.queryByRole('button', { name: /\+ Add :free suffix/i })).not.toBeInTheDocument();
  });

  it('handles wrong custom model name during AI connection test and shows descriptive error', async () => {
    const provider = aiManager.getProvider('openrouter');
    const testSpy = vi.spyOn(provider, 'testConnection').mockResolvedValue({
      success: false,
      message: "OpenRouter Error: Model 'invalid/wrong-model:free' not found or invalid",
    });

    renderModal();

    const openRouterTab = screen.getByRole('button', { name: /OpenRouter/i });
    fireEvent.click(openRouterTab);

    // Enter API key
    const keyInput = screen.getByPlaceholderText(/sk-or-v1-/i);
    fireEvent.change(keyInput, { target: { value: 'sk-or-v1-my-key' } });

    // Select custom model
    const modelSelect = screen.getByLabelText(/OpenRouter Model/i);
    fireEvent.change(modelSelect, { target: { value: '__custom__' } });

    // Type wrong custom model
    const customInput = screen.getByLabelText(/Custom OpenRouter Model ID/i) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: 'invalid/wrong-model:free' } });

    // Click test connection
    const testBtn = screen.getByRole('button', { name: /Test AI Connection/i });
    fireEvent.click(testBtn);

    await waitFor(() => {
      expect(testSpy).toHaveBeenCalledWith('sk-or-v1-my-key', 'invalid/wrong-model:free');
      expect(
        screen.getByText("OpenRouter Error: Model 'invalid/wrong-model:free' not found or invalid")
      ).toBeInTheDocument();
    });

    // Verify user input is preserved so user can fix the typo
    expect(customInput.value).toBe('invalid/wrong-model:free');
  });

  it('saves custom model and applies settings', async () => {
    const onClose = vi.fn();
    renderModal(onClose);

    const openRouterTab = screen.getByRole('button', { name: /OpenRouter/i });
    fireEvent.click(openRouterTab);

    const modelSelect = screen.getByLabelText(/OpenRouter Model/i);
    fireEvent.change(modelSelect, { target: { value: '__custom__' } });

    const customInput = screen.getByLabelText(/Custom OpenRouter Model ID/i);
    fireEvent.change(customInput, { target: { value: 'openai/chatgpt-4o-latest' } });

    const saveBtn = screen.getByRole('button', { name: /Save & Apply Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('automatically opens in custom mode when loaded settings contain a custom model ID', async () => {
    safeSetItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        activeProvider: 'openrouter',
        openRouterModel: 'anthropic/claude-3.5-sonnet',
      })
    );

    renderModal();

    await waitFor(() => {
      const modelSelect = screen.getByRole('combobox', { name: /^OpenRouter Model$/i }) as HTMLSelectElement;
      expect(modelSelect.value).toBe('__custom__');
      const customInput = screen.getByRole('textbox', { name: /Custom OpenRouter Model ID/i }) as HTMLInputElement;
      expect(customInput.value).toBe('anthropic/claude-3.5-sonnet');
    });
  });
});
