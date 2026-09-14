import { IAIProvider, RecommendationRequest, AIRecommendationResult } from './types';
import { Movie } from '../../types';
import { validateAndSanitizeAIResponse } from './aiResponseValidator';

export const OPENROUTER_AVAILABLE_MODELS = [
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', tier: 'Free' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta Llama 3.3 70B (Free)', tier: 'Free' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Exp (Free)', tier: 'Free' },
  { id: 'mistralai/mistral-small-24b-instruct-2501:free', name: 'Mistral Small 24B (Free)', tier: 'Free' },
];

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

export class OpenRouterProvider implements IAIProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter AI (Free & Multi-Model)';
  readonly description = 'Access open source and multi-provider AI models with OpenRouter';

  async testConnection(apiKey: string, model = 'deepseek/deepseek-r1:free'): Promise<{ success: boolean; message: string }> {
    if (!apiKey?.trim()) {
      return { success: false, message: 'OpenRouter API key is required.' };
    }

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
          model,
          messages: [{ role: 'user', content: 'Say CONNECTED in JSON: {"status": "CONNECTED"}' }],
        }),
        signal: timeoutController.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, message: `OpenRouter Error: ${errorData.error?.message || response.statusText}` };
      }

      return { success: true, message: `Successfully connected to OpenRouter (${model})!` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Network error: ${msg}` };
    }
  }

  async generateRecommendations(request: RecommendationRequest, signal?: AbortSignal): Promise<AIRecommendationResult> {
    const {
      userRatings,
      candidatePool,
      serendipityLevel = 30,
      selectedVibes = [],
      preferredEras = [],
      apiKey,
      model = 'deepseek/deepseek-r1:free',
    } = request;

    if (!apiKey?.trim()) {
      throw new Error('OpenRouter API key is required.');
    }

    const candidateMap = new Map<number, Movie>();
    candidatePool.forEach((m) => candidateMap.set(m.id, m));

    const ratingsSummary = userRatings.map((r) => ({
      title: r.title,
      user_rating: `${r.rating}/10`,
      genres: r.genres,
      director: r.director,
      year: r.year,
    }));

    const poolSummary = candidatePool.slice(0, 40).map((m) => ({
      id: m.id,
      title: m.title,
      year: m.release_date?.slice(0, 4),
      genres: (m.genres || []).map((g) => g.name),
      tmdb_rating: m.vote_average,
    }));

    const systemPrompt = `You are Cinephile AI, an expert cinematic curator.
Recommend the top films for the user based on their ratings.

User Profile:
${JSON.stringify(ratingsSummary, null, 2)}

Serendipity: ${serendipityLevel}%
Vibes: ${selectedVibes.join(', ') || 'Any'}
Eras: ${preferredEras.join(', ') || 'Any'}

Candidate Pool:
${JSON.stringify(poolSummary, null, 2)}

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
          model,
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
