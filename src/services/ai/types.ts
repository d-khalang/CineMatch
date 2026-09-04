import { Movie, Recommendation, UserRating } from '../../types';

export interface RecommendationRequest {
  userRatings: UserRating[];
  candidatePool: Movie[];
  serendipityLevel: number; // 0 (Safe) to 100 (Wildcard/Exploratory)
  selectedVibes?: string[];
  preferredEras?: string[];
  apiKey?: string;
  model?: string;
}

export interface UnconstrainedDiscovery {
  title: string;
  year?: string;
  score: number;
  reason: string;
  highlightTags: string[];
}

export interface AIRecommendationResult {
  recommendations: Recommendation[];
  unconstrainedDiscoveries?: UnconstrainedDiscovery[];
  tasteAnalysis?: string;
}

export interface IAIProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  
  generateRecommendations(request: RecommendationRequest): Promise<AIRecommendationResult>;
  testConnection(apiKey: string, model?: string): Promise<{ success: boolean; message: string }>;
}
