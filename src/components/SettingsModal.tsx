import React, { useState } from 'react';
import { X, Cpu, Key, CheckCircle, AlertCircle, Loader2, Sparkles, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { aiManager } from '../services/ai/aiManager';
import { GEMINI_AVAILABLE_MODELS } from '../services/ai/geminiProvider';
import { OPENROUTER_AVAILABLE_MODELS } from '../services/ai/openRouterProvider';
import { AIProviderId } from '../types';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { aiSettings, updateAISettings, generateRankings } = useMovieStore();

  const [provider, setProvider] = useState<AIProviderId>(aiSettings.activeProvider);
  const [geminiKey, setGeminiKey] = useState<string>(aiSettings.geminiApiKey || '');
  const [geminiModel, setGeminiModel] = useState<string>(aiSettings.geminiModel || 'gemini-2.5-flash');
  const [openRouterKey, setOpenRouterKey] = useState<string>(aiSettings.openRouterApiKey || '');
  const [openRouterModel, setOpenRouterModel] = useState<string>(aiSettings.openRouterModel || 'deepseek/deepseek-r1:free');
  const [showKey, setShowKey] = useState<boolean>(false);

  const [testingStatus, setTestingStatus] = useState<{
    loading: boolean;
    success?: boolean;
    message?: string;
  }>({ loading: false });

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setTestingStatus({ loading: true });
    const selectedProviderObj = aiManager.getProvider(provider);

    const apiKey = provider === 'gemini' ? geminiKey : openRouterKey;
    const model = provider === 'gemini' ? geminiModel : openRouterModel;

    try {
      const result = await selectedProviderObj.testConnection(apiKey, model);
      setTestingStatus({
        loading: false,
        success: result.success,
        message: result.message,
      });
    } catch (err: any) {
      setTestingStatus({
        loading: false,
        success: false,
        message: err.message || 'Connection test failed.',
      });
    }
  };

  const handleSave = () => {
    updateAISettings({
      activeProvider: provider,
      geminiApiKey: geminiKey.trim(),
      geminiModel,
      openRouterApiKey: openRouterKey.trim(),
      openRouterModel,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden p-6 sm:p-8 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">AI Engine & Model Settings</h2>
              <p className="text-xs text-slate-400">Configure your recommendation intelligence provider</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Provider Selector */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
            Select Active Provider
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'gemini', title: 'Google Gemini', desc: 'Official API (Free Tier)' },
              { id: 'openrouter', title: 'OpenRouter', desc: 'Free/Open Models' },
              { id: 'local', title: 'Local Heuristic', desc: 'Zero API Key needed' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setProvider(p.id as AIProviderId);
                  setTestingStatus({ loading: false });
                }}
                className={`p-3 rounded-2xl text-left border transition-all cursor-pointer ${
                  provider === p.id
                    ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-md'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="text-xs font-bold text-slate-100">{p.title}</div>
                <div className="text-[10px] text-slate-400 mt-0.5">{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Gemini Provider Config */}
        {provider === 'gemini' && (
          <div className="space-y-4 p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> Google Gemini API Configuration
              </span>
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 underline"
              >
                Get Free API Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Model Selector */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">Model Selection</label>
              <select
                value={geminiModel}
                onChange={(e) => setGeminiModel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {GEMINI_AVAILABLE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.speed})
                  </option>
                ))}
              </select>
            </div>

            {/* API Key Input */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">Gemini API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="AIzaSy..."
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* OpenRouter Config */}
        {provider === 'openrouter' && (
          <div className="space-y-4 p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" /> OpenRouter Configuration
              </span>
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-purple-400 hover:text-purple-300 flex items-center gap-1 underline"
              >
                Get OpenRouter Key <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Model Selector */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">Model Selection</label>
              <select
                value={openRouterModel}
                onChange={(e) => setOpenRouterModel(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                {OPENROUTER_AVAILABLE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key Input */}
            <div className="space-y-1">
              <label className="text-xs text-slate-400 font-medium">OpenRouter API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="sk-or-v1-..."
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-indigo-500 font-mono"
                />
                <Key className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Local Provider notice */}
        {provider === 'local' && (
          <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-800/40 text-xs text-emerald-200 space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-emerald-300">
              <CheckCircle className="w-4 h-4" /> Local Heuristic & Vector Engine Active
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              No API keys required. Computes multi-factor affinities, director weights, and serendipity discoveries right in your browser instantly.
            </p>
          </div>
        )}

        {/* Connection Test Result */}
        {testingStatus.message && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
              testingStatus.success
                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800 text-rose-300'
            }`}
          >
            {testingStatus.success ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span className="leading-tight">{testingStatus.message}</span>
          </div>
        )}

        {/* Action Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          {provider !== 'local' ? (
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingStatus.loading}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-slate-700 disabled:opacity-50"
            >
              {testingStatus.loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Test Connection
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-950 transition-all cursor-pointer"
            >
              Save & Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
