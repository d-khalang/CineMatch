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

export interface IAIProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  
  generateRecommendations(request: RecommendationRequest): Promise<Recommendation[]>;
  testConnection(apiKey: string, model?: string): Promise<{ success: boolean; message: string }>;
}
