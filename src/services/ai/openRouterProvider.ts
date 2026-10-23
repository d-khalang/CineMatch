import { IAIProvider, RecommendationRequest, AIRecommendationResult } from './types';
import { Movie } from '../../types';
import { validateAndSanitizeAIResponse } from './aiResponseValidator';

export const OPENROUTER_DEFAULT_MODEL = 'openrouter/free';

export const DEPRECATED_OPENROUTER_MODELS = new Set([
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemini-2.0-flash-exp:free',
  'mistralai/mistral-small-24b-instruct-2501:free',
]);

export const OPENROUTER_AVAILABLE_MODELS = [
  { id: 'openrouter/free', name: 'Free Models Router (Auto Best Free)', tier: 'Free' },
  { id: 'google/gemma-4-31b-it:free', name: 'Google Gemma 4 31B (Free)', tier: 'Free' },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Google Gemma 4 26B (Free)', tier: 'Free' },
  { id: 'nvidia/nemotron-3.5-lightning:free', name: 'NVIDIA Nemotron 3.5 Lightning (Free)', tier: 'Free' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'NVIDIA Nemotron 3 Ultra (Free)', tier: 'Free' },
  { id: 'liquid/lfm-2.5-2.6b:free', name: 'LiquidAI LFM 2.5 2.6B (Free)', tier: 'Free' },
  { id: 'thinkingmachines/inkling:free', name: 'Thinking Machines Inkling (Free)', tier: 'Free' },
  { id: 'cohere/north-mini-code:free', name: 'Cohere North Mini Code (Free)', tier: 'Free' },
];

export function sanitizeOpenRouterModel(model?: string): string {
  if (!model || typeof model !== 'string') return OPENROUTER_DEFAULT_MODEL;
  const trimmed = model.trim();
  if (!trimmed || DEPRECATED_OPENROUTER_MODELS.has(trimmed)) {
    return OPENROUTER_DEFAULT_MODEL;
  }
  return trimmed;
}

function composeSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

const MAX_PROMPT_RATINGS = 80;
const TOP_RATINGS_COUNT = 60;
const BOTTOM_RATINGS_COUNT = 20;

export function buildOpenRouterPrompt(request: RecommendationRequest): string {
  const {
    userRatings = [],
    candidatePool = [],
    serendipityLevel = 30,
    selectedVibes = [],
    preferredEras = [],
  } = request;

  const isTruncated = userRatings.length > MAX_PROMPT_RATINGS;
  const selectedRatings = isTruncated
    ? (() => {
        const ratingValue = (r: { rating: number }) => (Number.isFinite(r.rating) ? r.rating : 0);
        const sorted = [...userRatings].sort((a, b) => ratingValue(b) - ratingValue(a));
        return [...sorted.slice(0, TOP_RATINGS_COUNT), ...sorted.slice(-BOTTOM_RATINGS_COUNT)];
      })()
    : userRatings;

  const ratingsSummary = selectedRatings.map((r) => ({
    title: r.title,
    user_rating: `${r.rating}/10`,
    genres: r.genres,
    director: r.director,
    year: r.year,
  }));

  let genreSummaryLine = '';
  if (isTruncated) {
    const genreCounts = new Map<string, number>();
    for (const r of userRatings) {
      for (const g of r.genres ?? []) {
        const name = g.trim();
        if (name) {
          genreCounts.set(name, (genreCounts.get(name) ?? 0) + 1);
        }
      }
    }
    const summaryText = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([genre, count]) => `${genre}: ${count}`)
      .join(', ');
    genreSummaryLine = `\nGenre Summary (all ${userRatings.length} ratings, ${userRatings.length - MAX_PROMPT_RATINGS} omitted above): ${summaryText || 'None'}`;
  }

  const poolSummary = candidatePool.slice(0, 40).map((m) => ({
    id: m.id,
    title: m.title,
    year: m.release_date?.slice(0, 4),
    genres: (m.genres || []).map((g) => g.name),
    tmdb_rating: m.vote_average,
  }));

  const normalizedSerendipity = Number.isFinite(serendipityLevel)
    ? Math.min(100, Math.max(0, serendipityLevel))
    : 30;
  const activeBand =
    normalizedSerendipity <= 30 ? 'low' : normalizedSerendipity <= 70 ? 'mid' : 'high';

  return `You are Cinephile AI, an expert cinematic curator.
Recommend the top films for the user based on their ratings.

User Profile:
${JSON.stringify(ratingsSummary, null, 2)}${genreSummaryLine}

Serendipity: ${normalizedSerendipity}%
Serendipity Rubric:
- 0–30%${activeBand === 'low' ? ' [ACTIVE]' : ''}: mostly close matches to the user's taste.
- 31–70%${activeBand === 'mid' ? ' [ACTIVE]' : ''}: a mix, with some films from adjacent genres or creators.
- 71–100%${activeBand === 'high' ? ' [ACTIVE]' : ''}: mostly films the user would not pick themselves, but with a clear bridge to their taste.
Vibes: ${selectedVibes.join(', ') || 'Any'}
Eras: ${preferredEras.join(', ') || 'Any'}

Candidate Pool:
${JSON.stringify(poolSummary, null, 2)}

Instructions:
1. Return 12–20 films in "pool_rankings" from the Candidate Pool and up to 3 films in "unconstrained_discoveries" outside the pool.
2. Follow the [ACTIVE] Serendipity Rubric band. At high serendipity, avoid obvious acclaimed films the user would pick themselves.
3. For each pick that isn't a safe bet ("safe_bet"), provide a reason that names the bridge to the user's taste and explains why the risk is worth it.
4. Use "serendipityType" values only from the allowed set: "safe_bet", "thematic_gem", "director_match", "wildcard_discovery", "ai_cinephile_discovery".

Output strictly valid JSON with this format:
{
  "taste_analysis": "2-sentence summary of user's taste.",
  "pool_rankings": [
    {
      "id": 12345,
      "score": 95,
      "reason": "Personalized reason",
      "serendipityType": "safe_bet",
      "highlightTags": ["Tag1", "Tag2"]
    }
  ],
  "unconstrained_discoveries": [
    {
      "title": "Movie Title",
      "year": "1994",
      "score": 90,
      "reason": "Reason",
      "highlightTags": ["Discovery"]
    }
  ]
}`;
}

export class OpenRouterProvider implements IAIProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter AI (Free & Multi-Model)';
  readonly description = 'Access open source and multi-provider AI models with OpenRouter';

  async testConnection(apiKey: string, model: string = OPENROUTER_DEFAULT_MODEL): Promise<{ success: boolean; message: string }> {
    if (!apiKey?.trim()) {
      return { success: false, message: 'OpenRouter API key is required.' };
    }

    const targetModel = model?.trim() || OPENROUTER_DEFAULT_MODEL;

    try {
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(new Error('OpenRouter test timed out after 10s')), 10000);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://cinematch.ai',
          'X-Title': 'CineMatch AI',
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: 'user', content: 'Say CONNECTED in JSON: {"status": "CONNECTED"}' }],
        }),
        signal: timeoutController.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, message: `OpenRouter Error: ${errorData.error?.message || response.statusText}` };
      }

      return { success: true, message: `Successfully connected to OpenRouter (${targetModel})!` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Network error: ${msg}` };
    }
  }

  async generateRecommendations(request: RecommendationRequest, signal?: AbortSignal): Promise<AIRecommendationResult> {
    const {
      candidatePool,
      apiKey,
      model = OPENROUTER_DEFAULT_MODEL,
    } = request;

    if (!apiKey?.trim()) {
      throw new Error('OpenRouter API key is required.');
    }

    const targetModel = model?.trim() || OPENROUTER_DEFAULT_MODEL;

    const candidateMap = new Map<number, Movie>();
    candidatePool.forEach((m) => candidateMap.set(m.id, m));

    const systemPrompt = buildOpenRouterPrompt(request);

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error('OpenRouter request timed out after 25s')), 25000);
    const combinedSignal = composeSignals([signal, timeoutController.signal]);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.trim()}`,
          'HTTP-Referer': 'https://cinematch.ai',
          'X-Title': 'CineMatch AI',
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'system',
              content: 'You are an AI film recommendation engine. Output strictly valid JSON and no other text.',
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
        throw new Error(`OpenRouter API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from OpenRouter model.');
      }

      // Strip DeepSeek R1 <think>...</think> reasoning wrappers
      const withoutThinking = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

      // Clean markdown fences
      const cleanJson = withoutThinking
        .replace(/^```json/im, '')
        .replace(/^```/im, '')
        .replace(/```$/im, '')
        .trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleanJson);
      } catch {
        // Fallback: search for first { and last }
        const start = cleanJson.indexOf('{');
        const end = cleanJson.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
          parsed = JSON.parse(cleanJson.slice(start, end + 1));
        } else {
          throw new Error('Failed to parse structured JSON from OpenRouter.');
        }
      }
      return validateAndSanitizeAIResponse(parsed, candidateMap);
    } finally {
      clearTimeout(timeout);
    }
  }
}
