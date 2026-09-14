import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../../App';
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

describe('Startup Gating & Error Recovery in App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialStore.forgetAll();
    const coord = credentialCoordinator as unknown as {
      status: string;
      rememberEnabled: boolean;
      isRemembered: boolean;
      deletionFailureWarning: string | null;
      lastError: unknown;
      initializePromise: unknown;
      operationRevision: number;
    };
    coord.status = 'idle';
    coord.rememberEnabled = true;
    coord.isRemembered = false;
    coord.deletionFailureWarning = null;
    coord.lastError = null;
    coord.initializePromise = null;
    coord.operationRevision = 0;
  });

  it('renders restore error recovery banner when startup decryption fails', async () => {
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
    vi.mocked(nativeVault.readVault).mockRejectedValue(
      new nativeVault.VaultBridgeError('READ_FAILED', 'Authentication tag mismatch')
    );

    render(<App />);

    await credentialCoordinator.initialize();

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/Security Storage Alert/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Session Only/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reset Saved Keys/i })).toBeInTheDocument();
    });

    // Clicking Session Only dismisses the banner and allows continuation
    const sessionOnlyBtn = screen.getByRole('button', { name: /Session Only/i });
    fireEvent.click(sessionOnlyBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Security Storage Alert/i)).not.toBeInTheDocument();
      expect(credentialCoordinator.getState().status).toBe('ready');
    });
  });
});
