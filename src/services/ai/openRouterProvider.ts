import { IAIProvider, RecommendationRequest } from './types';
import { Recommendation, Movie } from '../../types';

export const OPENROUTER_AVAILABLE_MODELS = [
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', tier: 'Free' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta Llama 3.3 70B (Free)', tier: 'Free' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash Exp (Free)', tier: 'Free' },
  { id: 'mistralai/mistral-small-24b-instruct-2501:free', name: 'Mistral Small 24B (Free)', tier: 'Free' },
];

export class OpenRouterProvider implements IAIProvider {
  readonly id = 'openrouter';
  readonly name = 'OpenRouter AI (Free & Multi-Model)';
  readonly description = 'Access open source and multi-provider AI models with OpenRouter';

  async testConnection(apiKey: string, model = 'deepseek/deepseek-r1:free'): Promise<{ success: boolean; message: string }> {
    if (!apiKey?.trim()) {
      return { success: false, message: 'OpenRouter API key is required.' };
    }

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
          messages: [{ role: 'user', content: 'Say CONNECTED in JSON: {"status": "CONNECTED"}' }],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return { success: false, message: `OpenRouter Error: ${errorData.error?.message || response.statusText}` };
      }

      return { success: true, message: `Successfully connected to OpenRouter (${model})!` };
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
      model = 'deepseek/deepseek-r1:free',
    } = request;

    if (!apiKey) {
      throw new Error('OpenRouter API key is required.');
    }

    const candidateMap = new Map<number, Movie>(candidatePool.map((m) => [m.id, m]));

    const userRatingsSummary = userRatings.map((r) => ({
      title: r.title,
      user_rating: `${r.rating}/10`,
      genres: r.genres,
      director: r.director || 'Unknown',
      year: r.year,
    }));

    const candidatesSummary = candidatePool.slice(0, 30).map((m) => ({
      id: m.id,
      title: m.title,
      year: m.release_date ? m.release_date.slice(0, 4) : 'Unknown',
      genres: (m.genres || []).map((g) => g.name),
      tmdb_rating: m.vote_average,
      overview: (m.overview || '').slice(0, 150),
    }));

    const prompt = `You are a film curator. Recommend and rank the best 15 movies for this user.
Ratings: ${JSON.stringify(userRatingsSummary)}
Serendipity: ${serendipityLevel}%
Vibes: ${selectedVibes.join(', ') || 'Any'}
Candidates: ${JSON.stringify(candidatesSummary)}

Return ONLY valid JSON matching this schema:
{
  "rankings": [
    {
      "id": 123,
      "score": 95,
      "reason": "Why this movie fits",
      "serendipityType": "thematic_gem",
      "highlightTags": ["Atmospheric", "Sci-Fi"]
    }
  ]
}`;

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
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`OpenRouter error: ${err.error?.message || response.statusText}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '';

    // Extract JSON block
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid JSON format received from OpenRouter model.');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const recommendations: Recommendation[] = [];

    (parsed.rankings || []).forEach((item: any, idx: number) => {
      const movie = candidateMap.get(Number(item.id));
      if (movie) {
        recommendations.push({
          movie,
          score: Math.min(99, Math.max(50, Number(item.score) || 85)),
          rank: idx + 1,
          reason: item.reason || 'Curated to align with your cinematic tastes.',
          serendipityType: item.serendipityType || 'thematic_gem',
          highlightTags: Array.isArray(item.highlightTags) ? item.highlightTags : ['Recommended'],
        });
      }
    });

    return recommendations;
  }
}
