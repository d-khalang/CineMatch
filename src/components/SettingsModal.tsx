import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import {
  OPENROUTER_AVAILABLE_MODELS,
  OPENROUTER_DEFAULT_MODEL,
  sanitizeOpenRouterModel,
} from '../services/ai/openRouterProvider';
import {
  GROQ_DEFAULT_MODEL,
  sanitizeGroqModel,
  fetchGroqModels,
} from '../services/ai/groqProvider';
import { testTmdbConnection } from '../services/tmdb';
import { credentialStore, TmdbCredentialType } from '../services/credentialStore';
import { isVaultSupported } from '../services/nativeCredentialVault';
import { credentialCoordinator } from '../services/credentialCoordinator';
import { AIProviderId } from '../types';
import { useModalA11y } from './useModalA11y';

const CUSTOM_OPENROUTER_OPTION = '__custom__';

function formatGroqError(err: unknown): string {
  if (err && typeof err === 'object') {
    const status = 'status' in err ? (err as { status: unknown }).status : undefined;
    if (status === 413 || status === 429) {
      return "This model's free limit is too small for your ratings. Try another model.";
    }
  }
  const msg = err instanceof Error ? err.message : String(err || 'Failed to load Groq models.');
  if (/\b(413|429)\b|rate[ -]?limit/i.test(msg)) {
    return "This model's free limit is too small for your ratings. Try another model.";
  }
  return msg;
}

function buildGroqOptions(
  models: { id: string; name: string }[],
  savedModel: string,
  selectedModel: string
): { id: string; label: string }[] {
  const options: { id: string; label: string }[] = [];
  const seenIds = new Set<string>();

  if (savedModel && !models.some((m) => m.id === savedModel)) {
    options.push({ id: savedModel, label: `${savedModel} (saved)` });
    seenIds.add(savedModel);
  }

  for (const m of models) {
    if (!seenIds.has(m.id)) {
      options.push({ id: m.id, label: m.id === savedModel ? `${m.id} (saved)` : m.name || m.id });
      seenIds.add(m.id);
    }
  }

  if (selectedModel && !seenIds.has(selectedModel)) {
    options.push({ id: selectedModel, label: selectedModel });
  }

  return options;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const modalRef = useModalA11y(isOpen, onClose);
  const { aiSettings, updateAISettings, showToast, hiddenFilms = [], restoreFilm } = useMovieStore();

  const sortedHiddenFilms = useMemo(() => {
    return [...hiddenFilms].sort(
      (a, b) => (Number(b.hiddenAt) || 0) - (Number(a.hiddenAt) || 0)
    );
  }, [hiddenFilms]);

  const visibleHiddenFilms = useMemo(() => {
    return sortedHiddenFilms.slice(0, 50);
  }, [sortedHiddenFilms]);

  const pendingRestoreFocusRef = useRef<{ type: 'button'; movieId: number } | { type: 'heading' } | null>(null);
  const hiddenFilmsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const restoreButtonsRef = useRef<Record<number, HTMLButtonElement | null>>({});

  const handleRestoreFilm = (movieId: number) => {
    const currentIndex = visibleHiddenFilms.findIndex((f) => f.movieId === movieId);
    if (currentIndex !== -1) {
      if (visibleHiddenFilms.length <= 1) {
        pendingRestoreFocusRef.current = { type: 'heading' };
      } else if (currentIndex < visibleHiddenFilms.length - 1) {
        pendingRestoreFocusRef.current = {
          type: 'button',
          movieId: visibleHiddenFilms[currentIndex + 1].movieId,
        };
      } else {
        pendingRestoreFocusRef.current = {
          type: 'button',
          movieId: visibleHiddenFilms[currentIndex - 1].movieId,
        };
      }
    }
    restoreFilm(movieId);
  };

  useEffect(() => {
    if (!pendingRestoreFocusRef.current) return;
    const target = pendingRestoreFocusRef.current;
    pendingRestoreFocusRef.current = null;

    if (target.type === 'heading') {
      hiddenFilmsHeadingRef.current?.focus();
    } else if (target.type === 'button') {
      const btn =
        restoreButtonsRef.current[target.movieId] ||
        document.querySelector<HTMLButtonElement>(`button[aria-label^="Restore:"][data-movie-id="${target.movieId}"]`);
      if (btn) {
        btn.focus();
      } else {
        hiddenFilmsHeadingRef.current?.focus();
      }
    }
  });

  const [provider, setProvider] = useState<AIProviderId>(aiSettings.activeProvider);
  const [geminiModel, setGeminiModel] = useState<string>(aiSettings.geminiModel || 'gemini-3.8-flash');

  const initialOpenRouterModel = sanitizeOpenRouterModel(aiSettings.openRouterModel);
  const isInitialCustomOpenRouter = !OPENROUTER_AVAILABLE_MODELS.some(
    (m) => m.id === initialOpenRouterModel
  );

  const [openRouterModel, setOpenRouterModel] = useState<string>(initialOpenRouterModel);
  const [isCustomOpenRouterModel, setIsCustomOpenRouterModel] = useState<boolean>(
    isInitialCustomOpenRouter
  );
  const [customOpenRouterModelInput, setCustomOpenRouterModelInput] = useState<string>(
    isInitialCustomOpenRouter ? initialOpenRouterModel : ''
  );

  const initialGroqModel = sanitizeGroqModel(aiSettings.groqModel);
  const [groqModel, setGroqModel] = useState<string>(initialGroqModel);
  const [savedGroqModel, setSavedGroqModel] = useState<string>(initialGroqModel);
  const [groqModels, setGroqModels] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingGroqModels, setIsLoadingGroqModels] = useState<boolean>(false);
  const [groqModelsError, setGroqModelsError] = useState<string | null>(null);

  const groqFetchAbortControllerRef = useRef<AbortController | null>(null);
  const groqFetchRequestIdRef = useRef<number>(0);
  const hasAutoLoadedGroqRef = useRef<boolean>(false);

  // In-memory credentials state
  const [tmdbType, setTmdbType] = useState<TmdbCredentialType>(
    credentialStore.getCredentials().tmdbType
  );
  const [tmdbValue, setTmdbValue] = useState<string>(credentialStore.getCredentials().tmdbValue);
  const [geminiKey, setGeminiKey] = useState<string>(credentialStore.getCredentials().geminiApiKey);
  const [openRouterKey, setOpenRouterKey] = useState<string>(
    credentialStore.getCredentials().openRouterApiKey
  );
  const [groqKey, setGroqKey] = useState<string>(
    credentialStore.getCredentials().groqApiKey
  );

  // Coordinator state & remember preference
  const [coordinatorState, setCoordinatorState] = useState(() => credentialCoordinator.getState());
  const [rememberOnDevice, setRememberOnDevice] = useState<boolean>(() => credentialCoordinator.getState().rememberEnabled);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Masking toggles
  const [showTmdbKey, setShowTmdbKey] = useState<boolean>(false);
  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false);
  const [showOpenRouterKey, setShowOpenRouterKey] = useState<boolean>(false);
  const [showGroqKey, setShowGroqKey] = useState<boolean>(false);

  // Separate test connection statuses
  const [tmdbTesting, setTmdbTesting] = useState<{ loading: boolean; success?: boolean; message?: string }>({
    loading: false,
  });
  const [aiTesting, setAiTesting] = useState<{ loading: boolean; success?: boolean; message?: string }>({
    loading: false,
  });

  const handleLoadGroqModels = async (keyToUse: string) => {
    const trimmedKey = keyToUse.trim();
    if (!trimmedKey) return;

    if (groqFetchAbortControllerRef.current) {
      groqFetchAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    groqFetchAbortControllerRef.current = controller;
    const reqId = ++groqFetchRequestIdRef.current;

    setIsLoadingGroqModels(true);
    setGroqModelsError(null);

    try {
      const models = await fetchGroqModels(trimmedKey, controller.signal);
      if (reqId === groqFetchRequestIdRef.current && !controller.signal.aborted) {
        setGroqModels(models);
        setIsLoadingGroqModels(false);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted || reqId !== groqFetchRequestIdRef.current) {
        return;
      }
      setIsLoadingGroqModels(false);
      setGroqModelsError(formatGroqError(err));
    }
  };

  useEffect(() => {
    return () => {
      if (groqFetchAbortControllerRef.current) {
        groqFetchAbortControllerRef.current.abort();
      }
    };
  }, []);

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
      const currentGroqKey = creds.groqApiKey;
      setGroqKey(currentGroqKey);
      setProvider(aiSettings.activeProvider);
      setGeminiModel(aiSettings.geminiModel || 'gemini-3.8-flash');
      const activeModel = sanitizeOpenRouterModel(aiSettings.openRouterModel);
      const isCustom = !OPENROUTER_AVAILABLE_MODELS.some((m) => m.id === activeModel);
      setOpenRouterModel(activeModel);
      setIsCustomOpenRouterModel(isCustom);
      setCustomOpenRouterModelInput(isCustom ? activeModel : '');
      const activeGroqModel = sanitizeGroqModel(aiSettings.groqModel);
      setGroqModel(activeGroqModel);
      setSavedGroqModel(activeGroqModel);
      setGroqModelsError(null);
      setRememberOnDevice(coord.rememberEnabled);
      hasAutoLoadedGroqRef.current = false;
      if (aiSettings.activeProvider === 'groq' && currentGroqKey.trim()) {
        hasAutoLoadedGroqRef.current = true;
        handleLoadGroqModels(currentGroqKey.trim());
      }
      setTmdbTesting({ loading: false });
      setAiTesting({ loading: false });
    } else {
      hasAutoLoadedGroqRef.current = false;
      if (groqFetchAbortControllerRef.current) {
        groqFetchAbortControllerRef.current.abort();
        groqFetchAbortControllerRef.current = null;
      }
      setIsLoadingGroqModels(false);
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

  const handleGroqKeyChange = (val: string) => {
    setGroqKey(val);
    setAiTesting({ loading: false });
    // A list loaded for the old key doesn't apply to this one.
    groqFetchRequestIdRef.current += 1;
    groqFetchAbortControllerRef.current?.abort();
    groqFetchAbortControllerRef.current = null;
    setIsLoadingGroqModels(false);
    setGroqModels([]);
    setGroqModelsError(null);
  };

  const handleOpenRouterKeyChange = (val: string) => {
    setOpenRouterKey(val);
    setAiTesting({ loading: false });
  };

  const handleGroqModelChange = (m: string) => {
    setGroqModel(m);
    setAiTesting({ loading: false });
  };

  const handleProviderChange = (p: AIProviderId) => {
    setProvider(p);
    if (p === 'groq' && groqKey.trim() && !hasAutoLoadedGroqRef.current) {
      hasAutoLoadedGroqRef.current = true;
      handleLoadGroqModels(groqKey.trim());
    }
    setAiTesting({ loading: false });
  };

  const handleGeminiModelChange = (m: string) => {
    setGeminiModel(m);
    setAiTesting({ loading: false });
  };

  const handleOpenRouterSelectChange = (val: string) => {
    setAiTesting({ loading: false });
    if (val === CUSTOM_OPENROUTER_OPTION) {
      setIsCustomOpenRouterModel(true);
      const current = customOpenRouterModelInput.trim();
      setOpenRouterModel(current || OPENROUTER_DEFAULT_MODEL);
    } else {
      setIsCustomOpenRouterModel(false);
      setOpenRouterModel(val);
    }
  };

  const handleCustomOpenRouterModelChange = (val: string) => {
    setCustomOpenRouterModelInput(val);
    setOpenRouterModel(val.trim() || OPENROUTER_DEFAULT_MODEL);
    setAiTesting({ loading: false });
  };

  const handleAppendFreeSuffix = () => {
    const current = customOpenRouterModelInput.trim();
    if (current && !current.endsWith(':free')) {
      const updated = `${current}:free`;
      setCustomOpenRouterModelInput(updated);
      setOpenRouterModel(updated);
      setAiTesting({ loading: false });
    }
  };

  const groqOptions = buildGroqOptions(groqModels, savedGroqModel, groqModel);

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

    let key = '';
    let providerName = '';
    let model = '';
    let statusKey: 'gemini' | 'openRouter' | 'groq' = 'gemini';

    if (provider === 'gemini') {
      key = geminiKey;
      providerName = 'Gemini';
      model = geminiModel;
      statusKey = 'gemini';
    } else if (provider === 'openrouter') {
      key = openRouterKey;
      providerName = 'OpenRouter';
      model = isCustomOpenRouterModel
        ? customOpenRouterModelInput.trim() || OPENROUTER_DEFAULT_MODEL
        : openRouterModel;
      statusKey = 'openRouter';
    } else if (provider === 'groq') {
      key = groqKey;
      providerName = 'Groq';
      model = groqModel || GROQ_DEFAULT_MODEL;
      statusKey = 'groq';
    }
    if (!key.trim()) {
      setAiTesting({ loading: false, success: false, message: `Please enter your ${providerName} API key first.` });
      return;
    }

    setAiTesting({ loading: true });
    const version = credentialStore.getVersion();
    const activeProviderObj = aiManager.getProvider(provider);

    try {
      const result = await activeProviderObj.testConnection(key.trim(), model);
      let displayMessage = result.message;
      if (provider === 'groq' && !result.success && /\b(413|429)\b|rate[ -]?limit/i.test(displayMessage)) {
        displayMessage = "This model's free limit is too small for your ratings. Try another model.";
      }
      setAiTesting({ loading: false, success: result.success, message: displayMessage });
      credentialStore.setStatus(statusKey, result.success ? 'valid' : 'invalid', displayMessage, version);
    } catch (err: unknown) {
      let msg = err instanceof Error ? err.message : 'Connection test failed.';
      if (provider === 'groq' && /\b(413|429)\b|rate[ -]?limit/i.test(msg)) {
        msg = "This model's free limit is too small for your ratings. Try another model.";
      }
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

  const handleForgetGroq = async () => {
    setGroqKey('');
    setAiTesting({ loading: false });
    await credentialCoordinator.forgetProvider('groq');
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
        groqApiKey: groqKey,
        rememberOnDevice,
      });

      const resolvedOpenRouterModel = isCustomOpenRouterModel
        ? customOpenRouterModelInput.trim() || OPENROUTER_DEFAULT_MODEL
        : openRouterModel || OPENROUTER_DEFAULT_MODEL;

      // 2. Commit non-secret preferences to persistent store
      updateAISettings({
        activeProvider: provider,
        geminiModel,
        openRouterModel: resolvedOpenRouterModel,
        groqModel: sanitizeGroqModel(groqModel),
      });

      if (!res.success) {
        showToast(`Keys usable for this session. Persistence error: ${res.error || 'Failed to save to device.'}`);
      } else if (isVaultSupported() && rememberOnDevice && (tmdbValue.trim() || geminiKey.trim() || openRouterKey.trim() || groqKey.trim())) {
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 animate-fadeIn"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="relative w-full max-w-xl max-h-[90dvh] flex flex-col rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-lg overflow-hidden p-6 sm:p-8 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-full palette-tag-secondary">
              <Cpu className="w-5 h-5 text-[var(--accent-secondary)]" />
            </div>
            <div>
              <h2 id="settings-modal-title" className="text-lg font-bold text-white">API Credentials & AI Engine</h2>
              <p className="text-xs text-slate-400">Configure direct client-side provider access</p>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close settings"
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
              className="p-3.5 rounded-2xl bg-amber-950/80 border border-amber-500/40 text-amber-200 text-xs flex items-center justify-between gap-3"
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
            <div className="p-4 rounded-2xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] space-y-2">
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
                  <div className="w-11 h-6 bg-slate-700 focus-ring rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[var(--accent-primary)]"></div>
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
          <div className="space-y-3 p-4 rounded-2xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]">
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
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus-ring pr-20 font-mono"
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
          <div className="space-y-3 p-4 rounded-2xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                AI Recommendation Engine
              </h3>
            </div>

            {/* Provider Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                <span className="text-[10px] text-slate-400">Free & Custom</span>
              </button>

              <button
                type="button"
                onClick={() => handleProviderChange('groq')}
                className={`p-2.5 rounded-xl border text-center transition-all ${
                  provider === 'groq'
                    ? 'bg-[var(--accent-primary)]/15 border-[var(--accent-primary)] text-white'
                    : 'bg-black/20 border-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className="font-semibold block text-xs">Groq</span>
                <span className="text-[10px] text-slate-400">Ultra-Fast</span>
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
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus-ring pr-20 font-mono"
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
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-ring"
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
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus-ring pr-20 font-mono"
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
                  <label htmlFor="openrouter-model-select" className="text-xs text-slate-400 block mb-1">Model Selection</label>
                  <select
                    id="openrouter-model-select"
                    aria-label="OpenRouter Model"
                    value={isCustomOpenRouterModel ? CUSTOM_OPENROUTER_OPTION : openRouterModel}
                    onChange={(e) => handleOpenRouterSelectChange(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-ring"
                  >
                    {OPENROUTER_AVAILABLE_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                    <option value={CUSTOM_OPENROUTER_OPTION}>Custom Model (Type below)...</option>
                  </select>

                  {isCustomOpenRouterModel && (
                    <div className="mt-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="custom-openrouter-model-input" className="text-[11px] font-medium text-slate-300">
                          Custom Model ID
                        </label>
                        {customOpenRouterModelInput.trim() &&
                          !customOpenRouterModelInput.trim().endsWith(':free') &&
                          customOpenRouterModelInput.trim() !== 'openrouter/free' && (
                            <button
                              type="button"
                              onClick={handleAppendFreeSuffix}
                              className="text-[11px] text-[var(--accent-primary)] hover:underline inline-flex items-center gap-1 font-medium transition-colors"
                            >
                              + Add :free suffix
                            </button>
                          )}
                      </div>
                      <input
                        id="custom-openrouter-model-input"
                        aria-label="Custom OpenRouter Model ID"
                        type="text"
                        value={customOpenRouterModelInput}
                        onChange={(e) => handleCustomOpenRouterModelChange(e.target.value)}
                        placeholder="e.g. meta-llama/llama-3.3-70b-instruct:free or openai/gpt-4o"
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 focus-ring font-mono"
                      />
                      <p className="text-[11px] text-slate-400 leading-relaxed">
                        Tip: Free models on OpenRouter require the <code className="text-emerald-400 bg-white/5 px-1 py-0.5 rounded">:free</code> suffix (or use <code className="text-emerald-400 bg-white/5 px-1 py-0.5 rounded">openrouter/free</code>). Paid models do not require a suffix.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {provider === 'groq' && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs">
                  <label htmlFor="groq-api-key-input" className="text-slate-300 font-medium">Groq API Key</label>
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-[var(--accent-primary)] hover:underline inline-flex items-center gap-1"
                  >
                    Get Free Key <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                <div className="relative">
                  <input
                    id="groq-api-key-input"
                    aria-label="Groq API Key"
                    type={showGroqKey ? 'text' : 'password'}
                    value={groqKey}
                    onChange={(e) => handleGroqKeyChange(e.target.value)}
                    placeholder="gsk_..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-600 focus-ring pr-20 font-mono"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={showGroqKey ? 'Hide Groq API key' : 'Show Groq API key'}
                      onClick={() => setShowGroqKey(!showGroqKey)}
                      className="p-1.5 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    {groqKey && (
                      <button
                        type="button"
                        onClick={handleForgetGroq}
                        className="p-1.5 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                        title="Forget Groq Key"
                        aria-label="Forget Groq Key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="groq-model-select" className="text-xs text-slate-400">
                      Model Selection
                    </label>
                    <button
                      type="button"
                      onClick={() => handleLoadGroqModels(groqKey)}
                      disabled={isLoadingGroqModels || !groqKey.trim()}
                      className="text-[11px] text-[var(--accent-primary)] hover:underline inline-flex items-center gap-1 font-medium transition-colors disabled:opacity-40 disabled:no-underline cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isLoadingGroqModels && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Load models
                    </button>
                  </div>

                  <select
                    id="groq-model-select"
                    aria-label="Groq Model"
                    value={groqModel}
                    onChange={(e) => handleGroqModelChange(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus-ring"
                  >
                    {groqOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  {groqModelsError && (
                    <div
                      role="alert"
                      className="text-xs text-rose-400 flex items-center gap-1.5 pt-0.5"
                    >
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{groqModelsError}</span>
                    </div>
                  )}
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

          {/* Hidden Films Section */}
          <div className="space-y-3 p-4 rounded-2xl bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-[var(--accent-primary)]" />
                <h3
                  ref={hiddenFilmsHeadingRef}
                  tabIndex={-1}
                  className="text-xs font-bold uppercase tracking-wider text-slate-200 focus:outline-none"
                >
                  Hidden films ({hiddenFilms.length})
                </h3>
              </div>
            </div>

            {hiddenFilms.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">No hidden films.</p>
            ) : (
              <div className="space-y-2">
                <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                  {visibleHiddenFilms.map((film, index) => {
                    const displayTitle =
                      film.title && film.title.trim() ? film.title.trim() : `#${film.movieId}`;
                    const reasonLabel = film.reason === 'seen' ? 'Seen' : 'Not for me';

                    return (
                      <div
                        key={`${film.movieId}-${film.hiddenAt || index}`}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl bg-black/20 border border-white/5 text-xs"
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-2">
                          <span className="font-medium text-slate-200 truncate">
                            {displayTitle}
                          </span>
                          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full palette-tag-secondary font-medium">
                            {reasonLabel}
                          </span>
                        </div>
                        <button
                          ref={(el) => {
                            if (el) {
                              restoreButtonsRef.current[film.movieId] = el;
                            } else {
                              delete restoreButtonsRef.current[film.movieId];
                            }
                          }}
                          data-movie-id={film.movieId}
                          type="button"
                          onClick={() => handleRestoreFilm(film.movieId)}
                          aria-label={`Restore: ${displayTitle}`}
                          className="shrink-0 px-2.5 py-2 sm:py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white text-xs font-medium border border-white/10 transition-colors cursor-pointer focus-ring"
                        >
                          Restore
                        </button>
                      </div>
                    );
                  })}
                </div>
                {hiddenFilms.length > 50 && (
                  <p className="text-xs text-slate-400 text-center pt-1">
                    …and {hiddenFilms.length - 50} more
                  </p>
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
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-[var(--bg-surface-hover)] transition-colors"
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
