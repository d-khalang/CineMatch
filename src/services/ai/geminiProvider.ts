import { IAIProvider, RecommendationRequest } from './types';
import { Recommendation, Movie } from '../../types';

export const GEMINI_AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Latest & Recommended)', speed: 'Fastest', tier: 'Free Quota' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', speed: 'Ultra Fast', tier: 'Free Quota' },
  { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', speed: 'Fast', tier: 'Free Quota' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro (Deepest Analysis)', speed: 'High Quality', tier: 'Free Quota' },
];

export class GeminiProvider implements IAIProvider {
  readonly id = 'gemini';
  readonly name = 'Google Gemini AI';
  readonly description = 'Powered by Google Gemini models for deep contextual cinematic taste synthesis';

  async testConnection(apiKey: string, model = 'gemini-2.5-flash'): Promise<{ success: boolean; message: string }> {
    if (!apiKey?.trim()) {
      return { success: false, message: 'API key is required.' };
    }

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Respond with the word "CONNECTED" in JSON: {"status": "CONNECTED"}' }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errMsg = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
        return { success: false, message: `Gemini Error: ${errMsg}` };
      }

      return { success: true, message: `Successfully connected to ${model}!` };
    } catch (err: any) {
      return { success: false, message: `Network error: ${err.message}` };
    }
  }

  async generateRecommendations(request: RecommendationRequest): Promise<Recommendation[]> {
    const {
      userRatings,
      candidatePool,
      serendipityLevel = 30,
      selectedVibes = [],
      preferredEras = [],
      apiKey,
      model = 'gemini-2.5-flash',
    } = request;

    if (!apiKey) {
      throw new Error('Gemini API key is required to use the Gemini provider.');
    }

    const candidateMap = new Map<number, Movie>(candidatePool.map((m) => [m.id, m]));

    // Format User Ratings for prompt
    const userRatingsSummary = userRatings.map((r) => ({
      title: r.title,
      user_rating: `${r.rating}/10`,
      genres: r.genres,
      director: r.director || 'Unknown',
      year: r.year,
    }));

    // Format Candidates Pool
    const candidatesSummary = candidatePool.slice(0, 35).map((m) => ({
      id: m.id,
      title: m.title,
      year: m.release_date ? m.release_date.slice(0, 4) : 'Unknown',
      genres: (m.genres || []).map((g) => g.name),
      tmdb_rating: m.vote_average,
      overview: (m.overview || '').slice(0, 160),
    }));

    const serendipityDescription =
      serendipityLevel > 70
        ? 'High Serendipity / Wildcard: Boldly recommend unexpected films, foreign gems, or different genres that share the subtle emotional or structural DNA of what the user loves.'
        : serendipityLevel > 35
        ? 'Balanced Discovery: Mix trusted thematic continuations with 2-3 creative crossover suggestions.'
        : 'Safe Bets: Stick closely to the highest affinity styles, directors, and genres the user explicitly praised.';

    const systemPrompt = `You are Cinephile AI, an expert cinematic curator and recommendation engine.
Analyze the user's movie ratings (1-10 scale), identify their psychological, stylistic, and structural taste patterns (e.g. pacing, tone, dialogue, complexity), and rank the candidate films.

User Profile:
${JSON.stringify(userRatingsSummary, null, 2)}

Serendipity Setting: ${serendipityLevel}% (${serendipityDescription})
User Vibe Filters: ${selectedVibes.join(', ') || 'Any'}
User Era Preferences: ${preferredEras.join(', ') || 'Any'}

Candidate Pool:
${JSON.stringify(candidatesSummary, null, 2)}

Instructions:
1. Select and rank the best 15-20 films from the candidate pool in order of personalized recommendation.
2. For each recommended film, assign:
   - "id": number (matching candidate ID)
   - "score": number between 60 and 99 (personalized match percentage)
   - "reason": A vivid, insightful 1-2 sentence cinephile explanation of why this film is ranked here, connecting it to specific traits they loved or disliked in their rating history. Avoid generic fluff.
   - "serendipityType": One of "safe_bet", "thematic_gem", "director_match", or "wildcard_discovery"
   - "highlightTags": Array of 2-3 short descriptors (e.g. ["Denis Villeneuve", "Philosophical Sci-Fi", "High Tension"])

Output strictly valid JSON with the format:
{
  "rankings": [
    {
      "id": 123,
      "score": 96,
      "reason": "...",
      "serendipityType": "thematic_gem",
      "highlightTags": ["Neo-noir", "Moral Ambiguity"]
    }
  ]
}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        }),
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

    let parsed: { rankings: any[] };
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Clean possible markdown code fence
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    }

    const recommendations: Recommendation[] = [];

    (parsed.rankings || []).forEach((item, index) => {
      const movie = candidateMap.get(Number(item.id));
      if (movie) {
        recommendations.push({
          movie,
          score: Math.min(99, Math.max(50, Number(item.score) || 85)),
          rank: index + 1,
          reason: item.reason || 'Curated specifically based on your unique cinematic profile.',
          serendipityType: item.serendipityType || 'thematic_gem',
          highlightTags: Array.isArray(item.highlightTags) ? item.highlightTags : ['Top Pick'],
        });
      }
    });

    return recommendations;
  }
}
