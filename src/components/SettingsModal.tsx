import React, { useState, useEffect } from 'react';
import {
  X,
  Cpu,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  ShieldCheck,
  Trash2,
  Lock,
} from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { aiManager } from '../services/ai/aiManager';
import { GEMINI_AVAILABLE_MODELS } from '../services/ai/geminiProvider';
import { OPENROUTER_AVAILABLE_MODELS } from '../services/ai/openRouterProvider';
import { testTmdbConnection } from '../services/tmdb';
import { credentialStore, TmdbCredentialType } from '../services/credentialStore';
import { isVaultSupported } from '../services/nativeCredentialVault';
import { credentialCoordinator } from '../services/credentialCoordinator';
import { AIProviderId } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { aiSettings, updateAISettings, showToast } = useMovieStore();

  const [provider, setProvider] = useState<AIProviderId>(aiSettings.activeProvider);
  const [geminiModel, setGeminiModel] = useState<string>(aiSettings.geminiModel || 'gemini-3.8-flash');
  const [openRouterModel, setOpenRouterModel] = useState<string>(
    aiSettings.openRouterModel || 'deepseek/deepseek-r1:free'
  );

  // In-memory credentials state
  const [tmdbType, setTmdbType] = useState<TmdbCredentialType>(
    credentialStore.getCredentials().tmdbType
  );
  const [tmdbValue, setTmdbValue] = useState<string>(credentialStore.getCredentials().tmdbValue);
  const [geminiKey, setGeminiKey] = useState<string>(credentialStore.getCredentials().geminiApiKey);
  const [openRouterKey, setOpenRouterKey] = useState<string>(
    credentialStore.getCredentials().openRouterApiKey
  );

  // Coordinator state & remember preference
  const [coordinatorState, setCoordinatorState] = useState(() => credentialCoordinator.getState());
  const [rememberOnDevice, setRememberOnDevice] = useState<boolean>(() => credentialCoordinator.getState().rememberEnabled);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Masking toggles
  const [showTmdbKey, setShowTmdbKey] = useState<boolean>(false);
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [showOpenRouterKey, setShowOpenRouterKey] = useState<boolean>(false);

  // Separate test connection statuses
  const [tmdbTesting, setTmdbTesting] = useState<{ loading: boolean; success?: boolean; message?: string }>({
    loading: false,
  });
  const [aiTesting, setAiTesting] = useState<{ loading: boolean; success?: boolean; message?: string }>({
    loading: false,
  });

  // Subscribe to coordinator state changes
  useEffect(() => {
    const unsubscribe = credentialCoordinator.subscribe(() => {
      setCoordinatorState(credentialCoordinator.getState());
    });
    return unsubscribe;
  }, []);

  // Sync credentials and preferences on open
  useEffect(() => {
    if (isOpen) {
      const creds = credentialStore.getCredentials();
      const coord = credentialCoordinator.getState();
      setTmdbType(creds.tmdbType);
      setTmdbValue(creds.tmdbValue);
      setGeminiKey(creds.geminiApiKey);
      setOpenRouterKey(creds.openRouterApiKey);
      setProvider(aiSettings.activeProvider);
      setGeminiModel(aiSettings.geminiModel || 'gemini-3.8-flash');
      setOpenRouterModel(aiSettings.openRouterModel || 'deepseek/deepseek-r1:free');
      setRememberOnDevice(coord.rememberEnabled);
      setTmdbTesting({ loading: false });
      setAiTesting({ loading: false });
    }
  }, [isOpen, aiSettings]);

  if (!isOpen) return null;

  // Invalidate TMDB test when draft changes
  const handleTmdbValueChange = (val: string) => {
    setTmdbValue(val);
    setTmdbTesting({ loading: false });
  };

  const handleTmdbTypeChange = (type: TmdbCredentialType) => {
    setTmdbType(type);
    setTmdbTesting({ loading: false });
  };

  // Invalidate AI test when drafts change
  const handleGeminiKeyChange = (val: string) => {
    setGeminiKey(val);
    setAiTesting({ loading: false });
  };

  const handleOpenRouterKeyChange = (val: string) => {
    setOpenRouterKey(val);
    setAiTesting({ loading: false });
  };

  const handleProviderChange = (p: AIProviderId) => {
    setProvider(p);
    setAiTesting({ loading: false });
  };

  const handleGeminiModelChange = (m: string) => {
    setGeminiModel(m);
    setAiTesting({ loading: false });
  };

  const handleOpenRouterModelChange = (m: string) => {
    setOpenRouterModel(m);
    setAiTesting({ loading: false });
  };

  const handleTestTmdb = async () => {
    if (!tmdbValue.trim()) {
      setTmdbTesting({ loading: false, success: false, message: 'Please enter a TMDB token or key first.' });
      return;
    }
    setTmdbTesting({ loading: true });
    const version = credentialStore.getVersion();
    try {
      const res = await testTmdbConnection(tmdbType, tmdbValue.trim());
      setTmdbTesting({ loading: false, success: res.success, message: res.message });
      credentialStore.setStatus('tmdb', res.success ? 'valid' : 'invalid', res.message, version);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'TMDB connection test failed.';
      setTmdbTesting({ loading: false, success: false, message: msg });
      credentialStore.setStatus('tmdb', 'invalid', msg, version);
    }
  };

  const handleTestAi = async () => {
    if (provider === 'local') {
      setAiTesting({ loading: false, success: true, message: 'Local Smart Engine is always ready.' });
      return;
    }

    const key = provider === 'gemini' ? geminiKey : openRouterKey;
    if (!key.trim()) {
      setAiTesting({ loading: false, success: false, message: `Please enter your ${provider === 'gemini' ? 'Gemini' : 'OpenRouter'} API key first.` });
      return;
    }

    setAiTesting({ loading: true });
    const version = credentialStore.getVersion();
    const activeProviderObj = aiManager.getProvider(provider);
    const model = provider === 'gemini' ? geminiModel : openRouterModel;

    const statusKey: 'gemini' | 'openRouter' = provider === 'openrouter' ? 'openRouter' : 'gemini';
    try {
      const result = await activeProviderObj.testConnection(key.trim(), model);
      setAiTesting({ loading: false, success: result.success, message: result.message });
      credentialStore.setStatus(statusKey, result.success ? 'valid' : 'invalid', result.message, version);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Connection test failed.';
      setAiTesting({ loading: false, success: false, message: msg });
      credentialStore.setStatus(statusKey, 'invalid', msg, version);
    }
  };

  const handleForgetTmdb = async () => {
    setTmdbValue('');
    setTmdbType('read_access_token');
    setTmdbTesting({ loading: false });
    await credentialCoordinator.forgetProvider('tmdb');
  };

  const handleForgetGemini = async () => {
    setGeminiKey('');
    setAiTesting({ loading: false });
    await credentialCoordinator.forgetProvider('gemini');
  };

  const handleForgetOpenRouter = async () => {
    setOpenRouterKey('');
    setAiTesting({ loading: false });
    await credentialCoordinator.forgetProvider('openRouter');
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 1. Durably coordinate credentials save
      const res = await credentialCoordinator.saveCredentials({
        tmdbType,
        tmdbValue,
        geminiApiKey: geminiKey,
        openRouterApiKey: openRouterKey,
        rememberOnDevice,
      });

      // 2. Commit non-secret preferences to persistent store
      updateAISettings({
        activeProvider: provider,
        geminiModel,
        openRouterModel,
      });

      if (!res.success) {
        showToast(`Keys usable for this session. Persistence error: ${res.error || 'Failed to save to device.'}`);
      } else if (isVaultSupported() && rememberOnDevice && (tmdbValue.trim() || geminiKey.trim() || openRouterKey.trim())) {
        showToast('Keys saved on this device.');
      } else {
        showToast('Keys available for this session only.');
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl max-h-[90dvh] flex flex-col rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden p-6 sm:p-8 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-full palette-tag-secondary">
              <Cpu className="w-5 h-5 text-[var(--accent-secondary)]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">API Credentials & AI Engine</h2>
              <p className="text-xs text-slate-400">Configure direct client-side provider access</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="overflow-y-auto space-y-6 flex-1 pr-1">
          {/* Deletion Warning Recovery Banner */}
          {coordinatorState.deletionFailureWarning && (
            <div
              role="alert"
              className="p-3.5 rounded-2xl bg-amber-950/80 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-3 shadow-md"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{coordinatorState.deletionFailureWarning}</span>
              </div>
              <button
                type="button"
                onClick={() => credentialCoordinator.retryDeletion()}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold shrink-0 transition-colors cursor-pointer text-xs"
              >
                Retry
              </button>
            </div>
          )}

          {/* Security Notice */}
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {isVaultSupported() ? (
                <>
                  <strong>Encrypted Device Storage:</strong> On Android, credentials can be saved encrypted on this device using Android Keystore AES-256 so you don't need to re-enter them on restart. They are never sent to CineMatch servers.
                </>
              ) : (
                <>
                  <strong>Zero-Custody Session Storage:</strong> Credentials remain strictly in your browser session memory. They are never written to disk/localStorage and are sent directly to TMDB & your selected AI provider.
                </>
              )}
            </span>
          </div>

          {/* Android: Remember on this device Switch */}
          {isVaultSupported() && (
            <div className="p-4 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5 pr-4">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-[var(--accent-primary)]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                      Remember on this device
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Save your keys encrypted on this device so you don't have to enter them again.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    aria-label="Remember on this device"
                    checked={rememberOnDevice}
                    onChange={(e) => setRememberOnDevice(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent-primary)]"></div>
                </label>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1 border-t border-white/5">
                {rememberOnDevice ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="w-3.5 h-3.5" />
                    {coordinatorState.isRemembered ? 'Keys saved on this device.' : 'Keys will be saved encrypted on this device.'}
                  </span>
                ) : (
                  <span className="text-slate-400 flex items-center gap-1">
                    Keys available for this session only.
                  </span>
                )}
              </div>
            </div>
          )}

          {/* TMDB Credentials Section */}
          <div className="space-y-3 p-4 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border-subtle)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-[var(--accent-primary)]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  TMDB Credentials (Required for Movies)
                </h3>
              </div>
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-[var(--accent-primary)] hover:underline inline-flex items-center gap-1"
              >
                Get TMDB Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleTmdbTypeChange('read_access_token')}
                  className={`p-2 rounded-xl border text-left transition-all ${
                    tmdbType === 'read_access_token'
                      ? 'bg-[var(--accent-primary)]/15 border-[var(--accent-primary)] text-white'
                      : 'bg-black/20 border-white/5 text-slate-400'
                  }`}
                >
                  <span className="font-semibold block text-slate-200">Read Access Token</span>
                  <span className="text-[10px] text-slate-400">Header auth (v4 Bearer)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleTmdbTypeChange('api_key')}
                  className={`p-2 rounded-xl border text-left transition-all ${
                    tmdbType === 'api_key'
                      ? 'bg-[var(--accent-primary)]/15 border-[var(--accent-primary)] text-white'
                      : 'bg-black/20 border-white/5 text-slate-400'
                  }`}
                >
                  <span className="font-semibold block text-slate-200">API Key</span>
                  <span className="text-[10px] text-slate-400">Query auth (v3)</span>
                </button>
              </div>

              <div className="relative">
                <input
                  type={showTmdbKey ? 'text' : 'password'}
                  value={tmdbValue}
                  onChange={(e) => handleTmdbValueChange(e.target.value)}
                  placeholder={
                    tmdbType === 'read_access_token'
                      ? 'eyJhbGciOiJIUzI1NiJ9... (v4 Access Token)'
                      : '6e19ae2b... (v3 API Key)'
                  }
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[var(--accent-primary)] pr-20 font-mono"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowTmdbKey(!showTmdbKey)}
                    className="p-1.5 text-slate-400 hover:text-white transition-colors"
                  >
                    {showTmdbKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  {tmdbValue && (
                    <button
                      type="button"
                      onClick={handleForgetTmdb}
                      className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                      title="Forget TMDB Credential"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* TMDB Connection Test */}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleTestTmdb}
                  disabled={tmdbTesting.loading || !tmdbValue.trim()}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium border border-white/10 transition-colors inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  {tmdbTesting.loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Test TMDB Connection
                </button>

                {tmdbTesting.message && (
                  <div
                    className={`text-xs flex items-center gap-1.5 ${
                      tmdbTesting.success ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {tmdbTesting.success ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    <span>{tmdbTesting.message}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Provider Section */}
          <div className="space-y-3 p-4 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border-subtle)]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                AI Recommendation Engine
              </h3>
            </div>

            {/* Provider Tabs */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleProviderChange('local')}
                className={`p-2.5 rounded-xl border text-center transition-all ${
                  provider === 'local'
                    ? 'bg-[var(--accent-primary)]/15 border-[var(--accent-primary)] text-white'
                    : 'bg-black/20 border-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="font-semibold block text-xs">Local Engine</span>
                <span className="text-[10px] text-emerald-400">Zero-Key Free</span>
              </button>

              <button
                type="button"
                onClick={() => handleProviderChange('gemini')}
                className={`p-2.5 rounded-xl border text-center transition-all ${
                  provider === 'gemini'
                    ? 'bg-[var(--accent-primary)]/15 border-[var(--accent-primary)] text-white'
                    : 'bg-black/20 border-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="font-semibold block text-xs">Google Gemini</span>
                <span className="text-[10px] text-slate-400">Official API</span>
              </button>

              <button
                type="button"
                onClick={() => handleProviderChange('openrouter')}
                className={`p-2.5 rounded-xl border text-center transition-all ${
                  provider === 'openrouter'
                    ? 'bg-[var(--accent-primary)]/15 border-[var(--accent-primary)] text-white'
                    : 'bg-black/20 border-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="font-semibold block text-xs">OpenRouter</span>
                <span className="text-[10px] text-slate-400">DeepSeek / Llama</span>
              </button>
            </div>

            {/* Provider Details */}
            {provider === 'local' && (
              <div className="p-3 rounded-xl bg-black/20 border border-white/5 text-xs text-slate-300 space-y-1">
                <p className="font-medium text-slate-200">Client-Side Heuristic Scoring</p>
                <p className="text-[11px] text-slate-400">
                  Calculates multidimensional taste affinity on your device with no AI key required. Uses director, genre affinities, negative suppression, and serendipity. Requires a TMDB credential for film candidate discovery.
                </p>
              </div>
            )}

            {provider === 'gemini' && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-300 font-medium">Gemini API Key</label>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-[var(--accent-primary)] hover:underline inline-flex items-center gap-1"
                  >
                    Get Free Key <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="relative">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiKey}
                    onChange={(e) => handleGeminiKeyChange(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[var(--accent-primary)] pr-20 font-mono"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowGeminiKey(!showGeminiKey)}
                      className="p-1.5 text-slate-400 hover:text-white transition-colors"
                    >
                      {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    {geminiKey && (
                      <button
                        type="button"
                        onClick={handleForgetGemini}
                        className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                        title="Forget Gemini Key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Model Selection</label>
                  <select
                    value={geminiModel}
                    onChange={(e) => handleGeminiModelChange(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[var(--accent-primary)]"
                  >
                    {GEMINI_AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {provider === 'openrouter' && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-slate-300 font-medium">OpenRouter API Key</label>
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-[var(--accent-primary)] hover:underline inline-flex items-center gap-1"
                  >
                    Get Key <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="relative">
                  <input
                    type={showOpenRouterKey ? 'text' : 'password'}
                    value={openRouterKey}
                    onChange={(e) => handleOpenRouterKeyChange(e.target.value)}
                    placeholder="sk-or-v1-..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-[var(--accent-primary)] pr-20 font-mono"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}
                      className="p-1.5 text-slate-400 hover:text-white transition-colors"
                    >
                      {showOpenRouterKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    {openRouterKey && (
                      <button
                        type="button"
                        onClick={handleForgetOpenRouter}
                        className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors"
                        title="Forget OpenRouter Key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">Model Selection</label>
                  <select
                    value={openRouterModel}
                    onChange={(e) => handleOpenRouterModelChange(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[var(--accent-primary)]"
                  >
                    {OPENROUTER_AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* AI Connection Test Status */}
            {provider !== 'local' && (
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleTestAi}
                  disabled={aiTesting.loading}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium border border-white/10 transition-colors inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  {aiTesting.loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Test AI Connection
                </button>

                {aiTesting.message && (
                  <div
                    className={`text-xs flex items-center gap-1.5 ${
                      aiTesting.success ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {aiTesting.success ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                    <span>{aiTesting.message}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-[var(--surface-hover)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-xl bg-[var(--accent-primary)] hover:brightness-110 text-black font-semibold text-xs transition-all cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save & Apply Settings
          </button>
        </div>
      </div>
    </div>
  );
};
