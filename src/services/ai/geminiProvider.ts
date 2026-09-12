import { IAIProvider, RecommendationRequest, AIRecommendationResult } from './types';
import { Movie } from '../../types';
import { validateAndSanitizeAIResponse } from './aiResponseValidator';

export const GEMINI_AVAILABLE_MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash (Latest & Recommended)', speed: 'Fastest', tier: 'Free Quota' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', speed: 'Ultra Fast', tier: 'Free Quota' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', speed: 'Fast', tier: 'Free Quota' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', speed: 'Fast', tier: 'Free Quota' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', speed: 'Fast', tier: 'Free Quota' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Deepest Analysis)', speed: 'High Quality', tier: 'Free Quota' },
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

export class GeminiProvider implements IAIProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini AI';
  readonly description = 'Powered by Google Gemini models for deep contextual cinematic taste synthesis';

  async testConnection(apiKey: string, model = 'gemini-3.8-flash'): Promise<{ success: boolean; message: string }> {
    if (!apiKey?.trim()) {
      return { success: false, message: 'Gemini API key is required.' };
    }

    try {
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(new Error('Connection test timed out after 10s')), 10000);

      // Pass API key via x-goog-api-key header (no secret in URL query parameters)
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey.trim(),
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Respond with the word "CONNECTED" in JSON: {"status": "CONNECTED"}' }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
          signal: timeoutController.signal,
        }
      );
      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        return { success: false, message: `Gemini Error: ${errMsg}` };
      }

      return { success: true, message: `Successfully connected to ${model}!` };
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
      model = 'gemini-3.8-flash',
    } = request;

    if (!apiKey?.trim()) {
      throw new Error('Gemini API key is required to use the Gemini provider.');
    }

    const candidateMap = new Map<number, Movie>();
    candidatePool.forEach((m) => candidateMap.set(m.id, m));

    // Format ratings profile
    const ratingsSummary = userRatings.map((r) => ({
      title: r.title,
      user_rating: `${r.rating}/10`,
      genres: r.genres,
      director: r.director,
      year: r.year,
    }));

    // Format candidate pool (up to 40 candidates)
    const poolSummary = candidatePool.slice(0, 40).map((m) => ({
      id: m.id,
      title: m.title,
      year: m.release_date?.slice(0, 4),
      genres: (m.genres || []).map((g) => g.name),
      tmdb_rating: m.vote_average,
      overview: m.overview ? m.overview.slice(0, 200) + '...' : '',
    }));

    const systemPrompt = `You are Cinephile AI, an expert cinematic curator and film critic.
Synthesize the user's taste based on their 1-10 movie ratings.

User Profile:
${JSON.stringify(ratingsSummary, null, 2)}

Serendipity Preference: ${serendipityLevel}% (0 = Safe bets matching user comfort zone, 100 = Wildcard discoveries).
Vibe Filters: ${selectedVibes.length ? selectedVibes.join(', ') : 'None'}
Preferred Eras: ${preferredEras.length ? preferredEras.join(', ') : 'Any'}

Candidate Pool:
${JSON.stringify(poolSummary, null, 2)}

Instructions:
1. Select and rank the best 10-20 films from Candidate Pool in order of personalized match.
2. Provide a 1-sentence personalized rationale for each choice citing user affinities.
3. Also suggest up to 3 unconstrained discoveries outside the candidate pool if they represent exceptional matches.
4. Output strictly valid JSON matching this schema:
{
  "taste_analysis": "Concise 2-sentence summary of user's cinematic taste DNA.",
  "pool_rankings": [
    {
      "id": 12345,
      "score": 95,
      "reason": "Personalized reason",
      "serendipityType": "safe_bet",
      "highlightTags": ["Atmospheric", "Masterpiece"]
    }
  ],
  "unconstrained_discoveries": [
    {
      "title": "Movie Title",
      "year": "1994",
      "score": 92,
      "reason": "Reason for recommendation",
      "highlightTags": ["Hidden Gem"]
    }
  ]
}`;

    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(new Error('Gemini request timed out after 20s')), 20000);
    const combinedSignal = composeSignals([signal, timeoutController.signal]);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey.trim(),
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7,
            },
          }),
          signal: combinedSignal,
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Gemini API error: ${err.error?.message || response.statusText}`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!rawText) {
        throw new Error('Empty response from Gemini.');
      }

      let parsed: any;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // Clean possible markdown code fence
        const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleanJson);
      }

      return validateAndSanitizeAIResponse(parsed, candidateMap);
    } finally {
      clearTimeout(timeout);
    }
  }
}
