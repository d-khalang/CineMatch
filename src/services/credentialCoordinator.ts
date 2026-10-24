import {
  isVaultSupported,
  readVault,
  writeVault,
  clearVault,
  setRememberEnabled as nativeSetRememberEnabled,
  StoredCredentials,
  TmdbCredentialType,
} from './nativeCredentialVault';
import { credentialStore, CredentialsState } from './credentialStore';

export type CoordinatorStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CoordinatorState {
  status: CoordinatorStatus;
  rememberEnabled: boolean;
  isRemembered: boolean;
  deletionFailureWarning: string | null;
  lastError: { code: string; message: string } | null;
}

type CoordinatorListener = () => void;

class CredentialCoordinator {
  private status: CoordinatorStatus = 'idle';
  private rememberEnabled: boolean = true; // Default ON on Android
  private isRemembered: boolean = false;
  private deletionFailureWarning: string | null = null;
  private lastError: { code: string; message: string } | null = null;

  private operationRevision = 0;
  private mutationQueue: Promise<void> = Promise.resolve();
  private initializePromise: Promise<void> | null = null;
  private listeners: Set<CoordinatorListener> = new Set();

  constructor() {
    // If not on Android native, default rememberEnabled to false (browser is session-only)
    if (!isVaultSupported()) {
      this.rememberEnabled = false;
    }
  }

  public getState(): Readonly<CoordinatorState> {
    return {
      status: this.status,
      rememberEnabled: this.rememberEnabled,
      isRemembered: this.isRemembered,
      deletionFailureWarning: this.deletionFailureWarning,
      lastError: this.lastError ? { ...this.lastError } : null,
    };
  }

  public getRevision(): number {
    return this.operationRevision;
  }

  public isReady(): boolean {
    return this.status === 'ready';
  }

  public isLoading(): boolean {
    return this.status === 'loading';
  }

  public resetForTesting(): void {
    this.status = isVaultSupported() ? 'idle' : 'ready';
    this.rememberEnabled = isVaultSupported();
    this.isRemembered = false;
    this.deletionFailureWarning = null;
    this.lastError = null;
    this.initializePromise = null;
    this.operationRevision = 0;
    this.mutationQueue = Promise.resolve();
  }

  public subscribe(listener: CoordinatorListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {
        // ignore
      }
    });
  }

  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.mutationQueue = this.mutationQueue.then(
        async () => {
          try {
            const result = await op();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        },
        async () => {
          try {
            const result = await op();
            resolve(result);
          } catch (err) {
            reject(err);
          }
        }
      );
    });
  }

  /**
   * Idempotent initialization / startup restoration.
   * Multiple calls under React StrictMode return the same in-flight or completed promise.
   */
  public initialize(): Promise<void> {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    if (!isVaultSupported()) {
      this.status = 'ready';
      this.rememberEnabled = false;
      this.isRemembered = false;
      this.notify();
      this.initializePromise = Promise.resolve();
      return this.initializePromise;
    }

    this.status = 'loading';
    this.notify();

    const opRev = ++this.operationRevision;

    this.initializePromise = this.enqueue(async () => {
      try {
        const res = await readVault();

        // If a subsequent user edit/forget occurred while reading, discard stale restore result
        if (opRev !== this.operationRevision) {
          return;
        }

        this.rememberEnabled = res.rememberEnabled;

        if (res.credentials && !this.isCredentialsEmpty(res.credentials)) {
          credentialStore.restoreCredentials({
            tmdbType: res.credentials.tmdbType,
            tmdbValue: res.credentials.tmdbValue,
            geminiApiKey: res.credentials.geminiApiKey,
            openRouterApiKey: res.credentials.openRouterApiKey,
          });
          this.isRemembered = true;
        } else {
          this.isRemembered = false;
        }

        this.status = 'ready';
        this.lastError = null;
      } catch (err: unknown) {
        if (opRev !== this.operationRevision) {
          return;
        }

        const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'READ_FAILED';
        const message = err instanceof Error ? err.message : 'Failed to restore credentials from vault';

        this.status = 'error';
        this.lastError = { code, message };
      } finally {
        this.notify();
      }
    });

    return this.initializePromise;
  }

  /**
   * Retry restoration after an error.
   */
  public retryRestore(): Promise<void> {
    this.initializePromise = null;
    return this.initialize();
  }

  /**
   * Continue session-only without blocking on an unreadable vault.
   */
  public continueSessionOnly(): void {
    this.status = 'ready';
    this.notify();
  }

  /**
   * Reset the vault on irrecoverable corruption or key loss.
   */
  public async resetVault(): Promise<void> {
    const opRev = ++this.operationRevision;
    await this.enqueue(async () => {
      try {
        await clearVault();
        await nativeSetRememberEnabled(true);
        if (opRev === this.operationRevision) {
          credentialStore.forgetAll();
          this.isRemembered = false;
          this.rememberEnabled = true;
          this.deletionFailureWarning = null;
          this.lastError = null;
          this.status = 'ready';
        }
      } catch (err: unknown) {
        const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : 'DELETE_FAILED';
        const message = err instanceof Error ? err.message : 'Failed to reset vault';
        this.lastError = { code, message };
      } finally {
        this.notify();
      }
    });
  }

  /**
   * Save credential changes and apply the remember preference.
   */
  public async saveCredentials(options: {
    tmdbType: TmdbCredentialType;
    tmdbValue: string;
    geminiApiKey: string;
    openRouterApiKey: string;
    rememberOnDevice: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const opRev = ++this.operationRevision;

    // 1. Immediately commit credentials to session memory store
    credentialStore.setTmdbCredential(options.tmdbType, options.tmdbValue);
    credentialStore.setGeminiKey(options.geminiApiKey);
    credentialStore.setOpenRouterKey(options.openRouterApiKey);

    if (!isVaultSupported()) {
      this.notify();
      return { success: true };
    }

    return this.enqueue(async () => {
      try {
        // Durably record preference
        if (options.rememberOnDevice !== this.rememberEnabled) {
          await nativeSetRememberEnabled(options.rememberOnDevice);
          if (opRev === this.operationRevision) {
            this.rememberEnabled = options.rememberOnDevice;
          }
        }

        const snapshot: StoredCredentials = {
          tmdbType: options.tmdbType,
          tmdbValue: options.tmdbValue.trim(),
          geminiApiKey: options.geminiApiKey.trim(),
          openRouterApiKey: options.openRouterApiKey.trim(),
        };

        if (options.rememberOnDevice) {
          if (!this.isCredentialsEmpty(snapshot)) {
            await writeVault(snapshot);
            if (opRev === this.operationRevision) {
              this.isRemembered = true;
              this.deletionFailureWarning = null;
            }
          } else {
            // All keys empty: clears vault
            await clearVault();
            if (opRev === this.operationRevision) {
              this.isRemembered = false;
              this.deletionFailureWarning = null;
            }
          }
        } else {
          // Turning switch off: nativeSetRememberEnabled(false) already cleared vault
          if (opRev === this.operationRevision) {
            this.isRemembered = false;
            this.deletionFailureWarning = null;
          }
        }

        this.notify();
        return { success: true };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to save credentials to device';
        if (opRev === this.operationRevision) {
          this.notify();
        }
        return { success: false, error: message };
      }
    });
  }

  /**
   * Forget credentials for a single provider.
   * Clears session memory immediately, then rewrites remaining saved credentials or clears vault.
   * Preserves remember preference!
   */
  public async forgetProvider(provider: 'tmdb' | 'gemini' | 'openRouter'): Promise<void> {
    const opRev = ++this.operationRevision;

    // 1. Immediate session memory clear
    if (provider === 'tmdb') {
      credentialStore.forgetTmdb();
    } else if (provider === 'gemini') {
      credentialStore.forgetGemini();
    } else if (provider === 'openRouter') {
      credentialStore.forgetOpenRouter();
    }

    if (!isVaultSupported() || !this.rememberEnabled || !this.isRemembered) {
      this.notify();
      return;
    }

    await this.enqueue(async () => {
      const current = credentialStore.getCredentials();
      const remaining: StoredCredentials = {
        tmdbType: current.tmdbType,
        tmdbValue: current.tmdbValue,
        geminiApiKey: current.geminiApiKey,
        openRouterApiKey: current.openRouterApiKey,
      };

      try {
        if (!this.isCredentialsEmpty(remaining)) {
          await writeVault(remaining);
          if (opRev === this.operationRevision) {
            this.isRemembered = true;
          }
        } else {
          await clearVault();
          if (opRev === this.operationRevision) {
            this.isRemembered = false;
          }
        }
      } catch {
        if (opRev === this.operationRevision) {
          this.deletionFailureWarning =
            'Saved keys could not be removed. Retry before closing the app.';
        }
      } finally {
        this.notify();
      }
    });
  }

  /**
   * Forget all credentials in session memory and persistent vault.
   * Preserves the remember preference.
   */
  public async forgetAll(): Promise<void> {
    const opRev = ++this.operationRevision;
    credentialStore.forgetAll();

    if (!isVaultSupported()) {
      this.isRemembered = false;
      this.notify();
      return;
    }

    await this.enqueue(async () => {
      try {
        await clearVault();
        if (opRev === this.operationRevision) {
          this.isRemembered = false;
          this.deletionFailureWarning = null;
        }
      } catch {
        if (opRev === this.operationRevision) {
          this.deletionFailureWarning =
            'Saved keys could not be removed. Retry before closing the app.';
        }
      } finally {
        this.notify();
      }
    });
  }

  /**
   * Clear all data: resets session store, purges native vault, and resets remember preference to default (true).
   */
  public async clearAllData(): Promise<void> {
    const opRev = ++this.operationRevision;
    credentialStore.forgetAll();

    if (!isVaultSupported()) {
      this.isRemembered = false;
      this.notify();
      return;
    }

    await this.enqueue(async () => {
      try {
        await clearVault();
        await nativeSetRememberEnabled(true);
        if (opRev === this.operationRevision) {
          this.isRemembered = false;
          this.rememberEnabled = true;
          this.deletionFailureWarning = null;
        }
      } catch {
        if (opRev === this.operationRevision) {
          this.deletionFailureWarning =
            'Saved keys could not be removed. Retry before closing the app.';
        }
      } finally {
        this.notify();
      }
    });
  }

  /**
   * Retry failed deletion applying the latest intended state.
   */
  public async retryDeletion(): Promise<void> {
    const opRev = ++this.operationRevision;
    await this.enqueue(async () => {
      try {
        if (!this.rememberEnabled) {
          await nativeSetRememberEnabled(false);
          await clearVault();
          if (opRev === this.operationRevision) {
            this.isRemembered = false;
            this.deletionFailureWarning = null;
          }
        } else {
          const current = credentialStore.getCredentials();
          if (this.isCredentialsEmpty(current)) {
            await clearVault();
            if (opRev === this.operationRevision) {
              this.isRemembered = false;
              this.deletionFailureWarning = null;
            }
          } else {
            await writeVault({
              tmdbType: current.tmdbType,
              tmdbValue: current.tmdbValue,
              geminiApiKey: current.geminiApiKey,
              openRouterApiKey: current.openRouterApiKey,
            });
            if (opRev === this.operationRevision) {
              this.isRemembered = true;
              this.deletionFailureWarning = null;
            }
          }
        }
      } catch {
        if (opRev === this.operationRevision) {
          this.deletionFailureWarning =
            'Saved keys could not be removed. Retry before closing the app.';
        }
      } finally {
        this.notify();
      }
    });
  }

  private isCredentialsEmpty(creds: StoredCredentials | CredentialsState): boolean {
    return (
      (!creds.tmdbValue || !creds.tmdbValue.trim()) &&
      (!creds.geminiApiKey || !creds.geminiApiKey.trim()) &&
      (!creds.openRouterApiKey || !creds.openRouterApiKey.trim())
    );
  }
}

export const credentialCoordinator = new CredentialCoordinator();
