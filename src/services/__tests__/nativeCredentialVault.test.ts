import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isVaultSupported,
  validateStoredCredentials,
  readVault,
  writeVault,
  clearVault,
  setRememberEnabled,
  VaultBridgeError,
} from '../nativeCredentialVault';
import { Capacitor } from '@capacitor/core';

vi.mock('@capacitor/core', async () => {
  const actual = await vi.importActual<typeof import('@capacitor/core')>('@capacitor/core');
  return {
    ...actual,
    Capacitor: {
      isNativePlatform: vi.fn(),
      getPlatform: vi.fn(),
    },
    registerPlugin: vi.fn(),
  };
});

describe('nativeCredentialVault bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isVaultSupported', () => {
    it('returns true on Android native platform', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
      expect(isVaultSupported()).toBe(true);
    });

    it('returns false on web / non-Android', () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
      expect(isVaultSupported()).toBe(false);

      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
      expect(isVaultSupported()).toBe(false);
    });
  });

  describe('validateStoredCredentials', () => {
    it('accepts valid credentials object with read_access_token', () => {
      const valid = {
        tmdbType: 'read_access_token',
        tmdbValue: 'valid-token',
        geminiApiKey: 'valid-gemini',
        openRouterApiKey: 'valid-openrouter',
      };
      const result = validateStoredCredentials(valid);
      expect(result).toEqual(valid);
    });

    it('accepts valid credentials object with api_key and empty optional keys', () => {
      const valid = {
        tmdbType: 'api_key',
        tmdbValue: 'api-key-123',
        geminiApiKey: '',
        openRouterApiKey: '',
      };
      const result = validateStoredCredentials(valid);
      expect(result).toEqual(valid);
    });

    it('rejects unexpected additional fields', () => {
      const invalid = {
        tmdbType: 'read_access_token',
        tmdbValue: 'token',
        geminiApiKey: '',
        openRouterApiKey: '',
        unexpectedField: 'malicious',
      };
      expect(() => validateStoredCredentials(invalid)).toThrow(VaultBridgeError);
      expect(() => validateStoredCredentials(invalid)).toThrowError(/Unexpected field/);
    });

    it('rejects invalid TMDB credential type', () => {
      const invalid = {
        tmdbType: 'session_id',
        tmdbValue: 'token',
        geminiApiKey: '',
        openRouterApiKey: '',
      };
      expect(() => validateStoredCredentials(invalid)).toThrow(VaultBridgeError);
      expect(() => validateStoredCredentials(invalid)).toThrowError(/Invalid TMDB credential type/);
    });

    it('rejects fields exceeding the 8 KiB size bound', () => {
      const hugeString = 'a'.repeat(8193);
      const invalid = {
        tmdbType: 'read_access_token',
        tmdbValue: hugeString,
        geminiApiKey: '',
        openRouterApiKey: '',
      };
      expect(() => validateStoredCredentials(invalid)).toThrow(VaultBridgeError);
      expect(() => validateStoredCredentials(invalid)).toThrowError(/exceeds field size limit/);
    });
  });

  describe('non-Android platform behavior', () => {
    beforeEach(() => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    });

    it('readVault returns null credentials and rememberEnabled false without throwing', async () => {
      const res = await readVault();
      expect(res).toEqual({ credentials: null, rememberEnabled: false });
    });

    it('writeVault throws UNAVAILABLE on non-Android platforms', async () => {
      const creds = {
        tmdbType: 'read_access_token' as const,
        tmdbValue: 'tok',
        geminiApiKey: '',
        openRouterApiKey: '',
      };
      await expect(writeVault(creds)).rejects.toThrow(VaultBridgeError);
    });

    it('clearVault and setRememberEnabled no-op cleanly on non-Android', async () => {
      await expect(clearVault()).resolves.toBeUndefined();
      await expect(setRememberEnabled(true)).resolves.toBeUndefined();
    });
  });
});
