export type TmdbCredentialType = 'read_access_token' | 'api_key';

export interface CredentialsState {
  tmdbType: TmdbCredentialType;
  tmdbValue: string;
  geminiApiKey: string;
  openRouterApiKey: string;
  groqApiKey: string;
}

export type ConnectionStatus = 'untested' | 'testing' | 'valid' | 'invalid';

export interface ProviderStatus {
  status: ConnectionStatus;
  message?: string;
  testedAt?: number;
}

export interface CredentialStatusState {
  tmdb: ProviderStatus;
  gemini: ProviderStatus;
  openRouter: ProviderStatus;
  groq: ProviderStatus;
}

type CredentialListener = () => void;

class SessionCredentialStore {
  // Credentials held exclusively in JavaScript heap / session memory
  private credentials: CredentialsState = {
    tmdbType: 'read_access_token',
    tmdbValue: '',
    geminiApiKey: '',
    openRouterApiKey: '',
    groqApiKey: '',
  };

  private statuses: CredentialStatusState = {
    tmdb: { status: 'untested' },
    gemini: { status: 'untested' },
    openRouter: { status: 'untested' },
    groq: { status: 'untested' },
  };

  // Generation/version token to invalidate inflight connection tests on credential changes
  private versionToken = 0;
  private listeners: Set<CredentialListener> = new Set();

  public getCredentials(): Readonly<CredentialsState> {
    return { ...this.credentials };
  }

  public getStatuses(): Readonly<CredentialStatusState> {
    return {
      tmdb: { ...this.statuses.tmdb },
      gemini: { ...this.statuses.gemini },
      openRouter: { ...this.statuses.openRouter },
      groq: { ...this.statuses.groq },
    };
  }

  public getVersion(): number {
    return this.versionToken;
  }

  public setTmdbCredential(type: TmdbCredentialType, value: string): void {
    this.versionToken += 1;
    this.credentials.tmdbType = type;
    this.credentials.tmdbValue = value.trim();
    this.statuses.tmdb = { status: 'untested' };
    this.notify();
  }

  public setGeminiKey(key: string): void {
    this.versionToken += 1;
    this.credentials.geminiApiKey = key.trim();
    this.statuses.gemini = { status: 'untested' };
    this.notify();
  }

  public setOpenRouterKey(key: string): void {
    this.versionToken += 1;
    this.credentials.openRouterApiKey = key.trim();
    this.statuses.openRouter = { status: 'untested' };
    this.notify();
  }

  public setGroqKey(key: string): void {
    this.versionToken += 1;
    this.credentials.groqApiKey = key.trim();
    this.statuses.groq = { status: 'untested' };
    this.notify();
  }

  public forgetTmdb(): void {
    this.versionToken += 1;
    this.credentials.tmdbValue = '';
    this.statuses.tmdb = { status: 'untested' };
    this.notify();
  }

  public forgetGemini(): void {
    this.versionToken += 1;
    this.credentials.geminiApiKey = '';
    this.statuses.gemini = { status: 'untested' };
    this.notify();
  }

  public forgetOpenRouter(): void {
    this.versionToken += 1;
    this.credentials.openRouterApiKey = '';
    this.statuses.openRouter = { status: 'untested' };
    this.notify();
  }

  public forgetGroq(): void {
    this.versionToken += 1;
    this.credentials.groqApiKey = '';
    this.statuses.groq = { status: 'untested' };
    this.notify();
  }

  public forgetAll(): void {
    this.versionToken += 1;
    this.credentials = {
      tmdbType: 'read_access_token',
      tmdbValue: '',
      geminiApiKey: '',
      openRouterApiKey: '',
      groqApiKey: '',
    };
    this.statuses = {
      tmdb: { status: 'untested' },
      gemini: { status: 'untested' },
      openRouter: { status: 'untested' },
      groq: { status: 'untested' },
    };
    this.notify();
  }

  public restoreCredentials(creds: CredentialsState): void {
    this.versionToken += 1;
    this.credentials = {
      tmdbType: creds.tmdbType,
      tmdbValue: creds.tmdbValue.trim(),
      geminiApiKey: creds.geminiApiKey.trim(),
      openRouterApiKey: creds.openRouterApiKey.trim(),
      groqApiKey: creds.groqApiKey.trim(),
    };
    this.statuses = {
      tmdb: { status: 'untested' },
      gemini: { status: 'untested' },
      openRouter: { status: 'untested' },
      groq: { status: 'untested' },
    };
    this.notify();
  }

  public setStatus(
    provider: 'tmdb' | 'gemini' | 'openRouter' | 'groq',
    status: ConnectionStatus,
    message?: string,
    versionAtTestStart?: number
  ): void {
    // If version changed while test was running, reject outdated status update
    if (versionAtTestStart !== undefined && versionAtTestStart !== this.versionToken) {
      return;
    }
    this.statuses[provider] = {
      status,
      message,
      testedAt: Date.now(),
    };
    this.notify();
  }

  public hasTmdb(): boolean {
    return Boolean(this.credentials.tmdbValue);
  }

  public hasGemini(): boolean {
    return Boolean(this.credentials.geminiApiKey);
  }

  public hasOpenRouter(): boolean {
    return Boolean(this.credentials.openRouterApiKey);
  }

  public hasGroq(): boolean {
    return Boolean(this.credentials.groqApiKey);
  }

  public subscribe(listener: CredentialListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const credentialStore = new SessionCredentialStore();
