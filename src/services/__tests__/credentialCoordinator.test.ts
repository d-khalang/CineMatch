import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as nativeVault from '../nativeCredentialVault';
import { credentialStore } from '../credentialStore';
import { credentialCoordinator } from '../credentialCoordinator';

vi.mock('../nativeCredentialVault', async () => {
  const actual = await vi.importActual<typeof import('../nativeCredentialVault')>('../nativeCredentialVault');
  return {
    ...actual,
    isVaultSupported: vi.fn(),
    readVault: vi.fn(),
    writeVault: vi.fn(),
    clearVault: vi.fn(),
    setRememberEnabled: vi.fn(),
  };
});

describe('credentialCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialStore.forgetAll();
    credentialCoordinator.resetForTesting();
  });

  describe('Startup Restoration & StrictMode Idempotency', () => {
    it('restores valid credentials into credentialStore atomically under Android', async () => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
      vi.mocked(nativeVault.readVault).mockResolvedValue({
        credentials: {
          tmdbType: 'read_access_token',
          tmdbValue: 'restored-token-123',
          geminiApiKey: 'restored-gemini',
          openRouterApiKey: 'restored-openrouter',
        },
        rememberEnabled: true,
      });

      let notifyCount = 0;
      const unsub = credentialStore.subscribe(() => {
        notifyCount++;
      });

      await credentialCoordinator.initialize();

      expect(notifyCount).toBe(1); // Exactly one notification for atomic restore
      const creds = credentialStore.getCredentials();
      expect(creds.tmdbValue).toBe('restored-token-123');
      expect(creds.geminiApiKey).toBe('restored-gemini');
      expect(creds.openRouterApiKey).toBe('restored-openrouter');

      const statuses = credentialStore.getStatuses();
      expect(statuses.tmdb.status).toBe('untested');
      expect(statuses.gemini.status).toBe('untested');
      expect(statuses.openRouter.status).toBe('untested');

      const state = credentialCoordinator.getState();
      expect(state.status).toBe('ready');
      expect(state.isRemembered).toBe(true);
      expect(state.rememberEnabled).toBe(true);

      unsub();
    });

    it('handles StrictMode duplicate initialization idempotently with a single readVault call', async () => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
      vi.mocked(nativeVault.readVault).mockResolvedValue({
        credentials: null,
        rememberEnabled: true,
      });

      const p1 = credentialCoordinator.initialize();
      const p2 = credentialCoordinator.initialize();
      await Promise.all([p1, p2]);

      expect(nativeVault.readVault).toHaveBeenCalledTimes(1);
      expect(credentialCoordinator.getState().status).toBe('ready');
      expect(credentialCoordinator.getState().isRemembered).toBe(false);
    });

    it('immediately sets ready on web without calling native vault', async () => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(false);

      await credentialCoordinator.initialize();

      expect(nativeVault.readVault).not.toHaveBeenCalled();
      const state = credentialCoordinator.getState();
      expect(state.status).toBe('ready');
      expect(state.rememberEnabled).toBe(false);
      expect(state.isRemembered).toBe(false);
    });

    it('handles read failure gracefully with error status, allows retry and session-only continuation', async () => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
      vi.mocked(nativeVault.readVault).mockRejectedValue(
        new nativeVault.VaultBridgeError('READ_FAILED', 'Corrupted ciphertext tag')
      );

      await credentialCoordinator.initialize();

      const state = credentialCoordinator.getState();
      expect(state.status).toBe('error');
      expect(state.lastError?.code).toBe('READ_FAILED');

      // Continue session-only
      credentialCoordinator.continueSessionOnly();
      expect(credentialCoordinator.getState().status).toBe('ready');

      // Retry
      vi.mocked(nativeVault.readVault).mockResolvedValue({
        credentials: null,
        rememberEnabled: true,
      });
      await credentialCoordinator.retryRestore();
      expect(credentialCoordinator.getState().status).toBe('ready');
    });

    it('discards late restore result if user edited credentials before restore resolved', async () => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);

      let resolveRead!: (val: nativeVault.ReadVaultResult) => void;
      const slowReadPromise = new Promise<nativeVault.ReadVaultResult>((resolve) => {
        resolveRead = resolve;
      });
      vi.mocked(nativeVault.readVault).mockReturnValue(slowReadPromise);

      // Start initialization
      const initPromise = credentialCoordinator.initialize();
      expect(credentialCoordinator.getState().status).toBe('loading');

      // User enters and saves session credentials while read is in-flight
      const savePromise = credentialCoordinator.saveCredentials({
        tmdbType: 'api_key',
        tmdbValue: 'user-new-key',
        geminiApiKey: '',
        openRouterApiKey: '',
        rememberOnDevice: false,
      });

      // Now resolve late restore with stale keys
      resolveRead({
        credentials: {
          tmdbType: 'read_access_token',
          tmdbValue: 'stale-restored-token',
          geminiApiKey: '',
          openRouterApiKey: '',
        },
        rememberEnabled: true,
      });

      await Promise.all([initPromise, savePromise]);

      // The user's new key must NOT be overwritten by the late restore
      expect(credentialStore.getCredentials().tmdbValue).toBe('user-new-key');
      expect(credentialStore.getCredentials().tmdbType).toBe('api_key');
    });
  });

  describe('Save, Preferences & Disabling Remember', () => {
    beforeEach(async () => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
      vi.mocked(nativeVault.readVault).mockResolvedValue({ credentials: null, rememberEnabled: true });
      await credentialCoordinator.initialize();
    });

    it('saves credentials to both memory and native vault when remember is enabled', async () => {
      vi.mocked(nativeVault.writeVault).mockResolvedValue();

      const res = await credentialCoordinator.saveCredentials({
        tmdbType: 'read_access_token',
        tmdbValue: 'my-tmdb',
        geminiApiKey: 'my-gemini',
        openRouterApiKey: 'my-openrouter',
        rememberOnDevice: true,
      });

      expect(res.success).toBe(true);
      expect(nativeVault.writeVault).toHaveBeenCalledWith({
        tmdbType: 'read_access_token',
        tmdbValue: 'my-tmdb',
        geminiApiKey: 'my-gemini',
        openRouterApiKey: 'my-openrouter',
      });
      expect(credentialCoordinator.getState().isRemembered).toBe(true);
      expect(credentialStore.getCredentials().tmdbValue).toBe('my-tmdb');
      expect(credentialStore.getCredentials().geminiApiKey).toBe('my-gemini');
      expect(credentialStore.getCredentials().openRouterApiKey).toBe('my-openrouter');
    });

    it('turning switch off and saving deletes saved copy but retains session credentials in memory', async () => {
      vi.mocked(nativeVault.setRememberEnabled).mockResolvedValue();
      vi.mocked(nativeVault.clearVault).mockResolvedValue();

      // First save with remember enabled
      vi.mocked(nativeVault.writeVault).mockResolvedValue();
      await credentialCoordinator.saveCredentials({
        tmdbType: 'read_access_token',
        tmdbValue: 'tok1',
        geminiApiKey: 'gem1',
        openRouterApiKey: '',
        rememberOnDevice: true,
      });
      expect(credentialCoordinator.getState().isRemembered).toBe(true);

      // Now save with remember disabled
      const res = await credentialCoordinator.saveCredentials({
        tmdbType: 'read_access_token',
        tmdbValue: 'tok1',
        geminiApiKey: 'gem1',
        openRouterApiKey: '',
        rememberOnDevice: false,
      });

      expect(res.success).toBe(true);
      expect(nativeVault.setRememberEnabled).toHaveBeenCalledWith(false);
      expect(credentialCoordinator.getState().rememberEnabled).toBe(false);
      expect(credentialCoordinator.getState().isRemembered).toBe(false);

      // Crucial: session memory credentials remain intact and usable!
      expect(credentialStore.getCredentials().tmdbValue).toBe('tok1');
      expect(credentialStore.getCredentials().geminiApiKey).toBe('gem1');
    });
  });

  describe('Forget Provider and Clear All Data', () => {
    beforeEach(async () => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
      vi.mocked(nativeVault.readVault).mockResolvedValue({
        credentials: {
          tmdbType: 'read_access_token',
          tmdbValue: 'tmdb-token',
          geminiApiKey: 'gemini-key',
          openRouterApiKey: 'openrouter-key',
        },
        rememberEnabled: true,
      });
      await credentialCoordinator.initialize();
    });

    it('forgetting one provider rewrites remaining saved providers and preserves rememberEnabled preference', async () => {
      vi.mocked(nativeVault.writeVault).mockResolvedValue();

      await credentialCoordinator.forgetProvider('tmdb');

      expect(credentialStore.getCredentials().tmdbValue).toBe('');
      expect(credentialStore.getCredentials().geminiApiKey).toBe('gemini-key');
      expect(credentialStore.getCredentials().openRouterApiKey).toBe('openrouter-key');

      expect(nativeVault.writeVault).toHaveBeenCalledWith({
        tmdbType: 'read_access_token',
        tmdbValue: '',
        geminiApiKey: 'gemini-key',
        openRouterApiKey: 'openrouter-key',
      });
      expect(credentialCoordinator.getState().rememberEnabled).toBe(true);
    });

    it('clearAllData purges session keys, clears vault, and resets rememberEnabled preference to default true', async () => {
      vi.mocked(nativeVault.clearVault).mockResolvedValue();
      vi.mocked(nativeVault.setRememberEnabled).mockResolvedValue();

      await credentialCoordinator.clearAllData();

      expect(credentialStore.getCredentials().tmdbValue).toBe('');
      expect(credentialStore.getCredentials().geminiApiKey).toBe('');
      expect(nativeVault.clearVault).toHaveBeenCalled();
      expect(nativeVault.setRememberEnabled).toHaveBeenCalledWith(true);

      const state = credentialCoordinator.getState();
      expect(state.isRemembered).toBe(false);
      expect(state.rememberEnabled).toBe(true);
      expect(state.deletionFailureWarning).toBeNull();
    });

    it('sets sticky warning on deletion failure and clears it on successful retry', async () => {
      vi.mocked(nativeVault.clearVault).mockRejectedValue(
        new nativeVault.VaultBridgeError('DELETE_FAILED', 'Disk locked')
      );

      await credentialCoordinator.forgetAll();

      expect(credentialCoordinator.getState().deletionFailureWarning).toBe(
        'Saved keys could not be removed. Retry before closing the app.'
      );

      // Successful retry
      vi.mocked(nativeVault.clearVault).mockResolvedValue();
      await credentialCoordinator.retryDeletion();

      expect(credentialCoordinator.getState().deletionFailureWarning).toBeNull();
    });
  });
});
