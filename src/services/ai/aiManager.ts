import { IAIProvider, RecommendationRequest, UnconstrainedDiscovery } from './types';
import { LocalProvider } from './localProvider';
import { GeminiProvider } from './geminiProvider';
import { OpenRouterProvider } from './openRouterProvider';
import { AIProviderId, Recommendation } from '../../types';

export const MIN_RECOMMENDATIONS = 8;

export interface AIGenerationResponse {
  recommendations: Recommendation[];
  unconstrainedDiscoveries?: UnconstrainedDiscovery[];
  tasteAnalysis?: string;
  usedProvider: string;
  error?: string;
}

class AIServiceManager {
  private providers: Map<AIProviderId, IAIProvider> = new Map();

  constructor() {
    this.registerProvider(new LocalProvider());
    this.registerProvider(new GeminiProvider());
    this.registerProvider(new OpenRouterProvider());
  }

  registerProvider(provider: IAIProvider) {
    this.providers.set(provider.id as AIProviderId, provider);
  }

  getProvider(id: AIProviderId): IAIProvider {
    return this.providers.get(id) || this.providers.get('local')!;
  }

  getAllProviders(): IAIProvider[] {
    return Array.from(this.providers.values());
  }

  async generateRecommendations(
    providerId: AIProviderId,
    request: RecommendationRequest,
    signal?: AbortSignal
  ): Promise<AIGenerationResponse> {
    if (signal?.aborted) {
      throw new DOMException('Generation aborted by caller', 'AbortError');
    }

    const provider = this.getProvider(providerId);

    // If Gemini or OpenRouter selected without key, fall back gracefully to Local
    if (providerId === 'gemini' && !request.apiKey?.trim()) {
      const local = this.getProvider('local');
      const res = await local.generateRecommendations(request, signal);
      return {
        recommendations: res.recommendations,
        usedProvider: 'Local Smart Engine (Configure Gemini API Key in Settings for AI synthesis)',
      };
    }

    if (providerId === 'openrouter' && !request.apiKey?.trim()) {
      const local = this.getProvider('local');
      const res = await local.generateRecommendations(request, signal);
      return {
        recommendations: res.recommendations,
        usedProvider: 'Local Smart Engine (Configure OpenRouter Key in Settings)',
      };
    }

    try {
      const result = await provider.generateRecommendations(request, signal);
      if (signal?.aborted) {
        throw new DOMException('Generation aborted by caller', 'AbortError');
      }

      const seenIds = new Set<number>();
      const filteredAiRecs = (result.recommendations || []).filter((r) => {
        if (!r?.movie || seenIds.has(r.movie.id)) return false;
        seenIds.add(r.movie.id);
        return true;
      });

      const finiteAiScores = filteredAiRecs
        .map((r) => r.score)
        .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
      const minAiScore =
        finiteAiScores.length > 0 ? Math.min(...finiteAiScores) : undefined;

      let recommendations: Recommendation[] = filteredAiRecs.map((r) => ({
        ...r,
        origin: r.origin === 'local_backfill' ? undefined : r.origin,
      }));

      if (provider.id !== 'local' && recommendations.length < MIN_RECOMMENDATIONS) {
        try {
          const remainingPool = (request.candidatePool || []).filter((m) => {
            if (!m || seenIds.has(m.id)) return false;
            seenIds.add(m.id);
            return true;
          });

          if (remainingPool.length > 0) {
            const local = this.getProvider('local');
            const localRes = await local.generateRecommendations(
              { ...request, candidatePool: remainingPool },
              signal
            );

            if (signal?.aborted) {
              throw new DOMException('Generation aborted by caller', 'AbortError');
            }

            const needed = MIN_RECOMMENDATIONS - recommendations.length;
            const existingIds = new Set(recommendations.map((r) => r.movie.id));
            const backfill: Recommendation[] = [];

            for (const rec of localRes.recommendations) {
              if (backfill.length >= needed) break;
              if (!rec?.movie || existingIds.has(rec.movie.id)) continue;
              existingIds.add(rec.movie.id);

              const baseScore =
                typeof rec.score === 'number' && Number.isFinite(rec.score) ? rec.score : 50;

              const clampedScore = Math.max(
                1,
                minAiScore !== undefined ? Math.min(baseScore, minAiScore - 1) : baseScore
              );

              backfill.push({
                movie: rec.movie,
                score: clampedScore,
                rank: 0,
                reason: rec.reason,
                serendipityType: rec.serendipityType,
                highlightTags: rec.highlightTags,
                origin: 'local_backfill',
                ...(rec.isAiCurated !== undefined ? { isAiCurated: rec.isAiCurated } : {}),
              });
            }

            recommendations = [...recommendations, ...backfill];
          }
        } catch (backfillErr: unknown) {
          const isAbort =
            signal?.aborted ||
            (backfillErr instanceof DOMException && backfillErr.name === 'AbortError') ||
            (backfillErr instanceof Error && backfillErr.name === 'AbortError') ||
            (typeof backfillErr === 'object' &&
              backfillErr !== null &&
              (backfillErr as any).name === 'AbortError');

          if (isAbort) {
            throw backfillErr;
          }

          console.warn(`Local backfill failed for provider ${provider.name}:`, backfillErr);
          // Keep existing AI recommendations as-is: usedProvider remains AI provider, error is undefined
        }
      }

      recommendations = recommendations.map((rec, idx) => ({
        ...rec,
        rank: idx + 1,
      }));

      return {
        recommendations,
        unconstrainedDiscoveries: result.unconstrainedDiscoveries,
        tasteAnalysis: result.tasteAnalysis,
        usedProvider: provider.name,
      };
    } catch (err: unknown) {
      // Cancellation must not trigger local fallback or show an error
      const isAbort =
        signal?.aborted ||
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError') ||
        (typeof err === 'object' &&
          err !== null &&
          (err as any).name === 'AbortError');

      if (isAbort) {
        throw err;
      }

      console.warn(`Provider ${provider.name} failed:`, err);
      const errMsg = err instanceof Error ? err.message : String(err);

      // Graceful fallback to local heuristic engine on network/provider error
      const local = this.getProvider('local');
      const fallbackRes = await local.generateRecommendations(request, signal);
      return {
        recommendations: fallbackRes.recommendations,
        usedProvider: `Local Engine (Fallback: ${errMsg || 'AI request failed'})`,
        error: errMsg,
      };
    }
  }
}

export const aiManager = new AIServiceManager();
