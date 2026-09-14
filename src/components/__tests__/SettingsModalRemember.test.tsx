import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';
import { MovieStoreProvider } from '../../store/useMovieStore';
import * as nativeVault from '../../services/nativeCredentialVault';
import { credentialStore } from '../../services/credentialStore';
import { credentialCoordinator } from '../../services/credentialCoordinator';

vi.mock('../../services/nativeCredentialVault', async () => {
  const actual = await vi.importActual<typeof import('../../services/nativeCredentialVault')>(
    '../../services/nativeCredentialVault'
  );
  return {
    ...actual,
    isVaultSupported: vi.fn(),
    readVault: vi.fn(),
    writeVault: vi.fn(),
    clearVault: vi.fn(),
    setRememberEnabled: vi.fn(),
  };
});

const renderModal = (onClose = vi.fn()) => {
  return render(
    <MovieStoreProvider>
      <SettingsModal isOpen={true} onClose={onClose} />
    </MovieStoreProvider>
  );
};

describe('SettingsModal Remember Credentials & Draft Invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialStore.forgetAll();
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
    credentialCoordinator.resetForTesting();
  });

  it('renders Remember on this device switch on Android defaulting to ON', () => {
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);

    renderModal();

    expect(screen.getByText('Remember on this device')).toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: /remember on this device/i });
    expect(checkbox).toBeChecked();
    expect(screen.getByText(/Save your keys encrypted on this device/i)).toBeInTheDocument();
  });

  it('does not render Remember toggle on web and shows Zero-Custody session notice', () => {
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(false);
    credentialCoordinator.resetForTesting();

    renderModal();

    expect(screen.queryByText('Remember on this device')).not.toBeInTheDocument();
    expect(screen.getByText(/Zero-Custody Session Storage/i)).toBeInTheDocument();
  });

  it('invalidates pending connection test result when draft input is modified', async () => {
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);

    renderModal();

    const tmdbInput = screen.getByPlaceholderText(/v4 Access Token/i);
    fireEvent.change(tmdbInput, { target: { value: 'draft-token-1' } });

    // Connection test is untested initially
    expect(screen.queryByText(/Successfully authenticated/i)).not.toBeInTheDocument();

    // Type new characters into draft input
    fireEvent.change(tmdbInput, { target: { value: 'draft-token-2' } });

    // Should remain invalid / cleared
    expect(screen.queryByText(/Successfully authenticated/i)).not.toBeInTheDocument();
  });

  it('allows saving without running connection test for offline compatibility', async () => {
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
    vi.mocked(nativeVault.writeVault).mockResolvedValue();

    const onClose = vi.fn();
    renderModal(onClose);

    const tmdbInput = screen.getByPlaceholderText(/v4 Access Token/i);
    fireEvent.change(tmdbInput, { target: { value: 'offline-token' } });

    const saveButton = screen.getByRole('button', { name: /Save & Apply Settings/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('displays persistent sticky deletion warning with retry button when deletion failed', () => {
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);

    // Force coordinator into deletion failure state
    const coord = credentialCoordinator as unknown as { deletionFailureWarning: string | null };
    coord.deletionFailureWarning = 'Saved keys could not be removed. Retry before closing the app.';

    renderModal();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Saved keys could not be removed. Retry before closing the app./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });
});
