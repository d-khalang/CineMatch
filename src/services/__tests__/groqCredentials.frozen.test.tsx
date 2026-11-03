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

const baseSave = {
  tmdbType: 'read_access_token' as const,
  tmdbValue: '',
  geminiApiKey: '',
  openRouterApiKey: '',
  groqApiKey: '',
  rememberOnDevice: true,
};

describe('Groq credentials (frozen)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    credentialStore.forgetAll();
    credentialCoordinator.resetForTesting();
  });

  describe('credentialStore', () => {
    it('sets, trims, reports and forgets the Groq key, leaving other keys alone', () => {
      credentialStore.setOpenRouterKey('other-key');
      credentialStore.setGroqKey('  groq-key ');

      expect(credentialStore.getCredentials().groqApiKey).toBe('groq-key');
      expect(credentialStore.hasGroq()).toBe(true);
      expect(credentialStore.getStatuses().groq.status).toBe('untested');

      credentialStore.forgetGroq();

      expect(credentialStore.getCredentials().groqApiKey).toBe('');
      expect(credentialStore.hasGroq()).toBe(false);
      expect(credentialStore.getCredentials().openRouterApiKey).toBe('other-key');
    });

    it('forgetAll wipes the Groq key', () => {
      credentialStore.setGroqKey('groq-key');

      credentialStore.forgetAll();

      expect(credentialStore.getCredentials().groqApiKey).toBe('');
    });

    it('resets the Groq status when the key changes', () => {
      credentialStore.setGroqKey('groq-key');
      credentialStore.setStatus('groq', 'invalid', 'bad key');
      expect(credentialStore.getStatuses().groq.status).toBe('invalid');

      credentialStore.setGroqKey('new-key');

      expect(credentialStore.getStatuses().groq.status).toBe('untested');
    });
  });

  describe('validateStoredCredentials', () => {
    const { validateStoredCredentials, VaultBridgeError } = nativeVault;
    const base = {
      tmdbType: 'read_access_token',
      tmdbValue: '',
      geminiApiKey: '',
      openRouterApiKey: '',
    };

    it('accepts and returns groqApiKey', () => {
      expect(validateStoredCredentials({ ...base, groqApiKey: 'groq-key' }).groqApiKey).toBe('groq-key');
    });

    it('reads a vault written before Groq existed, with an empty key', () => {
      expect(validateStoredCredentials(base).groqApiKey).toBe('');
    });

    it('rejects an oversized groqApiKey', () => {
      expect(() =>
        validateStoredCredentials({ ...base, groqApiKey: 'x'.repeat(100000) })
      ).toThrow(VaultBridgeError);
    });

    it('still rejects unknown fields', () => {
      expect(() => validateStoredCredentials({ ...base, somethingElse: 'x' })).toThrow(VaultBridgeError);
    });
  });

  describe('credentialCoordinator', () => {
    beforeEach(() => {
      vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
      vi.mocked(nativeVault.writeVault).mockResolvedValue(undefined as never);
      vi.mocked(nativeVault.clearVault).mockResolvedValue(undefined as never);
      vi.mocked(nativeVault.setRememberEnabled).mockResolvedValue(undefined as never);
    });

    const init = async (groqApiKey: string) => {
      vi.mocked(nativeVault.readVault).mockResolvedValue({
        credentials: {
          tmdbType: 'read_access_token',
          tmdbValue: '',
          geminiApiKey: '',
          openRouterApiKey: '',
          groqApiKey,
        },
        rememberEnabled: true,
      });
      await credentialCoordinator.initialize();
    };

    it('restores the Groq key, and a Groq-only vault counts as remembered', async () => {
      await init('restored-groq');

      expect(credentialStore.getCredentials().groqApiKey).toBe('restored-groq');
      expect(credentialCoordinator.getState().isRemembered).toBe(true);
    });

    it('writes a Groq-only save to the vault instead of clearing it', async () => {
      await init('');

      await credentialCoordinator.saveCredentials({ ...baseSave, groqApiKey: ' groq-key ' });

      expect(nativeVault.clearVault).not.toHaveBeenCalled();
      expect(nativeVault.writeVault).toHaveBeenCalledWith(
        expect.objectContaining({ groqApiKey: 'groq-key' })
      );
      expect(credentialStore.getCredentials().groqApiKey).toBe('groq-key');
    });

    it('keeps the Groq key in the vault when another provider is forgotten', async () => {
      await init('keep-me');
      credentialStore.setOpenRouterKey('other');

      await credentialCoordinator.forgetProvider('openRouter');

      expect(nativeVault.writeVault).toHaveBeenCalledWith(
        expect.objectContaining({ groqApiKey: 'keep-me', openRouterApiKey: '' })
      );
    });

    it('forgetProvider("groq") wipes memory and clears a Groq-only vault', async () => {
      await init('forget-me');

      await credentialCoordinator.forgetProvider('groq');

      expect(credentialStore.getCredentials().groqApiKey).toBe('');
      expect(nativeVault.clearVault).toHaveBeenCalled();
    });
  });
});
