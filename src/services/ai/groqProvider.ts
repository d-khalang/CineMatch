import { IAIProvider, RecommendationRequest, AIRecommendationResult } from './types';
import { Movie } from '../../types';
import {
  validateAndSanitizeAIResponse,
  parseAIJsonResponse,
  composeSignals,
} from './aiResponseValidator';
import { buildOpenRouterPrompt } from './openRouterProvider';

// The only model on the free tier that handled a worst-case prompt (checked 2026-11-03, CIN-66).
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

const GROQ_CHAT_COMPLETIONS_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const NON_CHAT_GROQ_MODEL_PATTERN = /whisper|tts|orpheus|guard|embed/i;
// The recommendation prompt reaches about 9,100 input tokens, so smaller models always fail.
const MIN_GROQ_CONTEXT_WINDOW = 16000;
// Free-tier keys get 8,000 tokens per minute, and Groq counts the prompt plus this cap against
// it, so the two must stay under 8,000 or it can return a 413. A worst-case compact prompt is
// about 3,800 tokens, and replies reached about 3,500 (checked 2026-11-08, CIN-70).
const GROQ_MAX_REPLY_TOKENS = 4000;

export function sanitizeGroqModel(model?: string): string {
  if (!model || typeof model !== 'string') return GROQ_DEFAULT_MODEL;
  const trimmed = model.trim();
  return trimmed || GROQ_DEFAULT_MODEL;
}

function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('[REDACTED]');
}

function rethrowRedacted(err: unknown, secret: string): never {
  if (err instanceof Error) {
    if (!secret || !err.message.includes(secret)) {
      throw err;
    }
    const sanitized = new Error(redactSecret(err.message, secret));
    sanitized.name = err.name;
    throw sanitized;
  }
  const text = String(err);
  if (!secret || !text.includes(secret)) {
    throw err;
  }
  throw new Error(redactSecret(text, secret));
}

export async function fetchGroqModels(
  apiKey: string,
  signal?: AbortSignal
): Promise<{ id: string; name: string }[]> {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('Groq API key is required.');
  }

  const trimmedKey = apiKey.trim();
  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new Error('Groq model list request timed out after 10s')),
    10000
  );
  const combinedSignal = composeSignals([signal, timeoutController.signal]);

  try {
    const response = await fetch(GROQ_MODELS_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
      },
      signal: combinedSignal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const rawMsg = errorData?.error?.message || response.statusText || `HTTP ${response.status}`;
      throw new Error(`Groq API error: ${redactSecret(String(rawMsg), trimmedKey)}`);
    }

    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray((payload as { data?: unknown }).data)
    ) {
      throw new Error('Malformed model list response from Groq.');
    }

    const rawModels = (payload as { data: unknown[] }).data;
    const byId = new Map<string, { id: string; name: string }>();

    for (const entry of rawModels) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('Malformed model entry in Groq model list.');
      }
      const item = entry as { id?: unknown; name?: unknown; active?: unknown; context_window?: unknown };
      if (typeof item.id !== 'string' || !item.id.trim()) {
        throw new Error('Malformed model entry in Groq model list.');
      }
      if (item.active === false) {
        continue;
      }
      if (typeof item.context_window === 'number' && item.context_window < MIN_GROQ_CONTEXT_WINDOW) {
        continue;
      }
      const id = item.id.trim();
      if (NON_CHAT_GROQ_MODEL_PATTERN.test(id)) {
        continue;
      }
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id;
      byId.set(id, { id, name });
    }

    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  } catch (err: unknown) {
    rethrowRedacted(err, trimmedKey);
  } finally {
    clearTimeout(timeout);
  }
}

export class GroqProvider implements IAIProvider {
  readonly id = 'groq';
  readonly name = 'Groq';
  readonly description = 'Fast OpenAI-compatible AI curation via Groq';

  async testConnection(
    apiKey: string,
    model: string = GROQ_DEFAULT_MODEL
  ): Promise<{ success: boolean; message: string }> {
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      return { success: false, message: 'Groq API key is required.' };
    }

    const trimmedKey = apiKey.trim();
    const targetModel = sanitizeGroqModel(model);
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error('Groq test timed out after 10s')),
      10000
    );

    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${trimmedKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'Say CONNECTED in JSON: {"status": "CONNECTED"}' }],
        }),
        signal: timeoutController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const rawMsg = errorData?.error?.message || response.statusText;
        return {
          success: false,
          message: `Groq Error: ${redactSecret(String(rawMsg), trimmedKey)}`,
        };
      }

      return { success: true, message: `Successfully connected to Groq (${targetModel})!` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Network error: ${redactSecret(msg, trimmedKey)}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateRecommendations(
    request: RecommendationRequest,
    signal?: AbortSignal
  ): Promise<AIRecommendationResult> {
    const { candidatePool, apiKey, model } = request;

    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Groq API key is required.');
    }

    const trimmedKey = apiKey.trim();
    const targetModel = sanitizeGroqModel(model);

    const candidateMap = new Map<number, Movie>();
    candidatePool.forEach((m) => candidateMap.set(m.id, m));

    const systemPrompt = buildOpenRouterPrompt(request, { compact: true });

    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(new Error('Groq request timed out after 25s')),
      25000
    );
    const combinedSignal = composeSignals([signal, timeoutController.signal]);

    try {
      const response = await fetch(GROQ_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${trimmedKey}`,
        },
        body: JSON.stringify({
          model: targetModel,
          max_tokens: GROQ_MAX_REPLY_TOKENS,
          messages: [
            {
              role: 'system',
              content:
                'You are an AI film recommendation engine. Output strictly valid JSON and no other text.',
            },
            {
              role: 'user',
              content: systemPrompt,
            },
          ],
        }),
        signal: combinedSignal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const rawMsg = errorData?.error?.message || response.statusText;
        throw new Error(`Groq API error: ${redactSecret(String(rawMsg), trimmedKey)}`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;

      if (data?.choices?.[0]?.finish_reason === 'length') {
        throw new Error('Groq reply was cut off before it finished. Try another model.');
      }

      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('Empty response from Groq model.');
      }

      const parsed = parseAIJsonResponse(content, 'Groq');
      return validateAndSanitizeAIResponse(parsed, candidateMap);
    } finally {
      clearTimeout(timeout);
    }
  }
}
