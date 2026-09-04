import { IAIProvider, RecommendationRequest, AIRecommendationResult, UnconstrainedDiscovery } from './types';
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

  async generateRecommendations(request: RecommendationRequest): Promise<AIRecommendationResult> {
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

    const systemPrompt = `You are Cinephile AI, a world-class film critic, narrative theorist, and master cinematic curator.
Your mission is to escape the mechanical "genre echo-chamber" and deliver both unconstrained cross-genre film discoveries and top selections from the candidate pool based on the user's deep psychological taste DNA.

STEP 1: DEDUCE PSYCHOLOGICAL TASTE DNA
Analyze the user's movie ratings (1-10 scale). Do NOT merely look at surface genres. Instead, deduce their underlying psychological, structural, and tonal preferences:
- Narrative structure & pacing (e.g. escalating ticking-clock tension, slow-burn psychological dread, non-linear puzzles, character study)
- Emotional & tonal resonance (e.g. moral ambiguity, cynical neo-noir, existential wonder, warm humanism)
- Directorial craft & aesthetic (e.g. claustrophobic staging, grand scale, dialogue-driven chamber pieces)

STEP 2: CURATE UNCONSTRAINED CINEPHILE DISCOVERIES (5-8 FILMS)
Brainstorm 5 to 8 films freely chosen from anywhere in cinema history (any era, country, or genre).
- CRITICAL: These films should transcend the user's explicit genres (e.g. recommending '12 Angry Men' or 'Uncut Gems' to an 'Inception' fan because of high-stakes ticking-clock tension, rather than just more Sci-Fi).
- Specifically explain why this cross-genre choice fits their psychological profile.

STEP 3: RANK CANDIDATE POOL (8-12 FILMS)
Select and rank the top 8-12 films from the provided TMDB candidate pool that best align with their profile.

User Profile:
${JSON.stringify(userRatingsSummary, null, 2)}

Serendipity Setting: ${serendipityLevel}% (${serendipityDescription})
User Vibe Filters: ${selectedVibes.join(', ') || 'Any'}
User Era Preferences: ${preferredEras.join(', ') || 'Any'}

Candidate Pool:
${JSON.stringify(candidatesSummary, null, 2)}

Output strictly valid JSON with this exact schema:
{
  "taste_analysis": "Summary of underlying psychological & structural preferences...",
  "unconstrained_discoveries": [
    {
      "title": "12 Angry Men",
      "year": "1957",
      "score": 97,
      "reason": "You love high-stakes psychological tension and escalating power struggles in modern thrillers; this classic delivers that pure claustrophobic intensity without any reliance on genre tropes.",
      "highlightTags": ["Claustrophobic Tension", "Psychological Stakes"]
    }
  ],
  "pool_rankings": [
    {
      "id": 123,
      "score": 94,
      "reason": "...",
      "serendipityType": "director_match",
      "highlightTags": ["Denis Villeneuve", "Philosophical Sci-Fi"]
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

    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Clean possible markdown code fence
      const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(cleanJson);
    }

    const poolRecommendations: Recommendation[] = [];
    const poolItems = parsed.pool_rankings || parsed.rankings || [];

    poolItems.forEach((item: any, index: number) => {
      const movie = candidateMap.get(Number(item.id));
      if (movie) {
        poolRecommendations.push({
          movie,
          score: Math.min(99, Math.max(50, Number(item.score) || 85)),
          rank: index + 1,
          reason: item.reason || 'Curated specifically based on your unique cinematic profile.',
          serendipityType: item.serendipityType || 'thematic_gem',
          highlightTags: Array.isArray(item.highlightTags) ? item.highlightTags : ['Top Pick'],
        });
      }
    });

    const unconstrainedDiscoveries: UnconstrainedDiscovery[] = (
      parsed.unconstrained_discoveries || []
    )
      .map((item: any) => ({
        title: String(item.title || '').trim(),
        year: item.year ? String(item.year).trim() : undefined,
        score: Math.min(99, Math.max(50, Number(item.score) || 92)),
        reason:
          item.reason ||
          'A cross-genre cinephile discovery matching your psychological and structural taste DNA.',
        highlightTags:
          Array.isArray(item.highlightTags) && item.highlightTags.length > 0
            ? item.highlightTags
            : ['AI Discovery', 'Cross-Genre'],
      }))
      .filter((d: UnconstrainedDiscovery) => Boolean(d.title));

    return {
      recommendations: poolRecommendations,
      unconstrainedDiscoveries,
      tasteAnalysis: parsed.taste_analysis,
    };
  }
}
