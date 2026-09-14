import { registerPlugin, Capacitor } from '@capacitor/core';

export type TmdbCredentialType = 'read_access_token' | 'api_key';

export interface StoredCredentials {
  tmdbType: TmdbCredentialType;
  tmdbValue: string;
  geminiApiKey: string;
  openRouterApiKey: string;
}

export interface ReadVaultResult {
  credentials: StoredCredentials | null;
  rememberEnabled: boolean;
}

export type VaultErrorCode =
  | 'UNAVAILABLE'
  | 'READ_FAILED'
  | 'WRITE_FAILED'
  | 'DELETE_FAILED'
  | 'INVALID_DATA'
  | 'UNSUPPORTED_VERSION'
  | 'KEY_UNAVAILABLE';

export class VaultBridgeError extends Error {
  public readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = 'VaultBridgeError';
    this.code = code;
  }
}

interface CredentialVaultPluginInterface {
  read(): Promise<{ credentials: StoredCredentials | null; rememberEnabled: boolean }>;
  write(options: { credentials: StoredCredentials }): Promise<void>;
  clear(): Promise<void>;
  setRememberEnabled(options: { enabled: boolean }): Promise<void>;
}

// Register the local native Capacitor plugin
const CredentialVaultNative = registerPlugin<CredentialVaultPluginInterface>('CredentialVault');

export const isVaultSupported = (): boolean => {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
};

const normalizeErrorCode = (err: unknown): VaultErrorCode => {
  if (err && typeof err === 'object') {
    const code = 'code' in err ? String((err as { code: unknown }).code) : '';
    const message = 'message' in err ? String((err as { message: unknown }).message) : '';

    if (
      code === 'UNAVAILABLE' ||
      code === 'READ_FAILED' ||
      code === 'WRITE_FAILED' ||
      code === 'DELETE_FAILED' ||
      code === 'INVALID_DATA' ||
      code === 'UNSUPPORTED_VERSION' ||
      code === 'KEY_UNAVAILABLE'
    ) {
      return code as VaultErrorCode;
    }

    if (message.includes('UNAVAILABLE')) return 'UNAVAILABLE';
    if (message.includes('KEY_UNAVAILABLE')) return 'KEY_UNAVAILABLE';
    if (message.includes('UNSUPPORTED_VERSION')) return 'UNSUPPORTED_VERSION';
    if (message.includes('INVALID_DATA')) return 'INVALID_DATA';
    if (message.includes('DELETE_FAILED')) return 'DELETE_FAILED';
    if (message.includes('READ_FAILED')) return 'READ_FAILED';
    if (message.includes('WRITE_FAILED')) return 'WRITE_FAILED';
  }
  return 'UNAVAILABLE';
};

const MAX_FIELD_BYTES = 8192;

export const validateStoredCredentials = (creds: unknown): StoredCredentials => {
  if (!creds || typeof creds !== 'object') {
    throw new VaultBridgeError('INVALID_DATA', 'Invalid credentials format');
  }

  const obj = creds as Record<string, unknown>;

  // Check allowed keys only
  const allowedKeys = new Set(['tmdbType', 'tmdbValue', 'geminiApiKey', 'openRouterApiKey']);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      throw new VaultBridgeError('INVALID_DATA', `Unexpected field in credentials: ${key}`);
    }
  }

  const tmdbType = obj.tmdbType;
  if (tmdbType !== 'read_access_token' && tmdbType !== 'api_key') {
    throw new VaultBridgeError('INVALID_DATA', 'Invalid TMDB credential type');
  }

  const tmdbValue = typeof obj.tmdbValue === 'string' ? obj.tmdbValue : '';
  const geminiApiKey = typeof obj.geminiApiKey === 'string' ? obj.geminiApiKey : '';
  const openRouterApiKey = typeof obj.openRouterApiKey === 'string' ? obj.openRouterApiKey : '';

  const encoder = new TextEncoder();
  if (encoder.encode(tmdbValue).length > MAX_FIELD_BYTES) {
    throw new VaultBridgeError('INVALID_DATA', 'tmdbValue exceeds field size limit');
  }
  if (encoder.encode(geminiApiKey).length > MAX_FIELD_BYTES) {
    throw new VaultBridgeError('INVALID_DATA', 'geminiApiKey exceeds field size limit');
  }
  if (encoder.encode(openRouterApiKey).length > MAX_FIELD_BYTES) {
    throw new VaultBridgeError('INVALID_DATA', 'openRouterApiKey exceeds field size limit');
  }

  return {
    tmdbType,
    tmdbValue,
    geminiApiKey,
    openRouterApiKey,
  };
};

export const readVault = async (): Promise<ReadVaultResult> => {
  if (!isVaultSupported()) {
    return { credentials: null, rememberEnabled: false };
  }

  try {
    const raw = await CredentialVaultNative.read();
    const rememberEnabled = typeof raw?.rememberEnabled === 'boolean' ? raw.rememberEnabled : true;
    let credentials: StoredCredentials | null = null;

    if (raw?.credentials) {
      credentials = validateStoredCredentials(raw.credentials);
    }

    return { credentials, rememberEnabled };
  } catch (err: unknown) {
    if (err instanceof VaultBridgeError) throw err;
    const code = normalizeErrorCode(err);
    const msg = err instanceof Error ? err.message : 'Failed to read from credential vault';
    throw new VaultBridgeError(code, msg);
  }
};

export const writeVault = async (credentials: StoredCredentials): Promise<void> => {
  if (!isVaultSupported()) {
    throw new VaultBridgeError('UNAVAILABLE', 'Credential vault is only supported on Android native');
  }

  const validated = validateStoredCredentials(credentials);

  try {
    await CredentialVaultNative.write({ credentials: validated });
  } catch (err: unknown) {
    if (err instanceof VaultBridgeError) throw err;
    const code = normalizeErrorCode(err);
    const msg = err instanceof Error ? err.message : 'Failed to write to credential vault';
    throw new VaultBridgeError(code, msg);
  }
};

export const clearVault = async (): Promise<void> => {
  if (!isVaultSupported()) {
    return;
  }

  try {
    await CredentialVaultNative.clear();
  } catch (err: unknown) {
    if (err instanceof VaultBridgeError) throw err;
    const code = normalizeErrorCode(err);
    const msg = err instanceof Error ? err.message : 'Failed to clear credential vault';
    throw new VaultBridgeError(code, msg);
  }
};

export const setRememberEnabled = async (enabled: boolean): Promise<void> => {
  if (!isVaultSupported()) {
    return;
  }

  try {
    await CredentialVaultNative.setRememberEnabled({ enabled });
  } catch (err: unknown) {
    if (err instanceof VaultBridgeError) throw err;
    const code = normalizeErrorCode(err);
    const msg = err instanceof Error ? err.message : 'Failed to set remember preference';
    throw new VaultBridgeError(code, msg);
  }
};
