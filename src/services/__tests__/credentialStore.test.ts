import { describe, it, expect } from 'vitest';
import { credentialStore } from '../credentialStore';

describe('SessionCredentialStore (In-Memory Security)', () => {
  it('stores credentials in memory and does not write them to localStorage', () => {
    credentialStore.setTmdbCredential('read_access_token', 'test-token-12345');
    credentialStore.setGeminiKey('test-gemini-key-abc');
    credentialStore.setOpenRouterKey('test-openrouter-key-xyz');

    const creds = credentialStore.getCredentials();
    expect(creds.tmdbValue).toBe('test-token-12345');
    expect(creds.geminiApiKey).toBe('test-gemini-key-abc');
    expect(creds.openRouterApiKey).toBe('test-openrouter-key-xyz');

    // Verify localStorage has NO traces of these secrets
    expect(localStorage.getItem('cinematch_user_ratings_v2')).toBeNull();
    expect(localStorage.getItem('cinematch_ai_settings_v2')).toBeNull();
    expect(localStorage.getItem('test-token-12345')).toBeNull();
    expect(localStorage.getItem('test-gemini-key-abc')).toBeNull();
  });

  it('increments version and invalidates inflight connection tests on credential changes', () => {
    const v1 = credentialStore.getVersion();
    credentialStore.setGeminiKey('new-key');
    const v2 = credentialStore.getVersion();
    expect(v2).toBe(v1 + 1);

    // Old version status updates must be rejected
    credentialStore.setStatus('gemini', 'valid', 'Old status', v1);
    expect(credentialStore.getStatuses().gemini.status).toBe('untested');

    // Current version status updates succeed
    credentialStore.setStatus('gemini', 'valid', 'Current status', v2);
    expect(credentialStore.getStatuses().gemini.status).toBe('valid');
  });

  it('forget actions clear secrets and update status', () => {
    credentialStore.setGeminiKey('key-to-forget');
    expect(credentialStore.hasGemini()).toBe(true);

    credentialStore.forgetGemini();
    expect(credentialStore.hasGemini()).toBe(false);
    expect(credentialStore.getCredentials().geminiApiKey).toBe('');
    expect(credentialStore.getStatuses().gemini.status).toBe('untested');
  });
});
