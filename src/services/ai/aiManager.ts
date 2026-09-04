import { IAIProvider, RecommendationRequest, UnconstrainedDiscovery } from './types';
import { LocalProvider } from './localProvider';
import { GeminiProvider } from './geminiProvider';
import { OpenRouterProvider } from './openRouterProvider';
import { AIProviderId, Recommendation } from '../../types';

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
    request: RecommendationRequest
  ): Promise<AIGenerationResponse> {
    const provider = this.getProvider(providerId);

    // If Gemini or OpenRouter selected without key, fall back gracefully to Local
    if (providerId === 'gemini' && !request.apiKey?.trim()) {
      const local = this.getProvider('local');
      const res = await local.generateRecommendations(request);
      return {
        recommendations: res.recommendations,
        usedProvider: 'Local Smart Engine (Configure Gemini API Key in Settings for AI synthesis)',
      };
    }

    if (providerId === 'openrouter' && !request.apiKey?.trim()) {
      const local = this.getProvider('local');
      const res = await local.generateRecommendations(request);
      return {
        recommendations: res.recommendations,
        usedProvider: 'Local Smart Engine (Configure OpenRouter Key in Settings)',
      };
    }

    try {
      const result = await provider.generateRecommendations(request);
      return {
        recommendations: result.recommendations,
        unconstrainedDiscoveries: result.unconstrainedDiscoveries,
        tasteAnalysis: result.tasteAnalysis,
        usedProvider: provider.name,
      };
    } catch (err: any) {
      console.warn(`Provider ${provider.name} failed:`, err);
      // Fallback to local heuristic engine
      const local = this.getProvider('local');
      const fallbackRes = await local.generateRecommendations(request);
      return {
        recommendations: fallbackRes.recommendations,
        usedProvider: `Local Engine (Fallback: ${err.message || 'AI request failed'})`,
        error: err.message,
      };
    }
  }
}

export const aiManager = new AIServiceManager();
