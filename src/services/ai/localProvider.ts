import { IAIProvider, RecommendationRequest } from './types';
import { Recommendation, Movie } from '../../types';

export class LocalProvider implements IAIProvider {
  readonly id = 'local';
  readonly name = 'Local Smart Heuristic (Zero Config)';
  readonly description = 'High-speed client-side multi-factor ranking with theme, director, genre weighting, and serendipity';

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Local Heuristic Engine is always ready.' };
  }

  async generateRecommendations(request: RecommendationRequest): Promise<Recommendation[]> {
    const { userRatings, candidatePool, serendipityLevel = 30, selectedVibes = [], preferredEras = [] } = request;

    if (!userRatings || userRatings.length === 0) {
      // Return top candidate movies as initial baseline
      return candidatePool.slice(0, 15).map((movie, idx) => ({
        movie,
        score: Math.max(60, 95 - idx * 2),
        rank: idx + 1,
        reason: 'Critically acclaimed starter film to help calibrate your taste profile.',
        serendipityType: 'safe_bet',
        highlightTags: (movie.genres || []).map((g) => g.name).slice(0, 2),
      }));
    }

    // 1. Build Taste Affinity Vector
    const genreAffinities = new Map<string, number>();
    const directorAffinities = new Map<string, number>();
    const keywordAffinities = new Map<string, number>();
    const negativeGenres = new Set<string>();

    let totalWeight = 0;

    userRatings.forEach((r) => {
      // Centered around 5.5: 10 is +4.5, 1 is -4.5
      const weight = (r.rating - 5.5) / 4.5;
      totalWeight += Math.abs(weight);

      // Genre affinities
      r.genres.forEach((g) => {
        genreAffinities.set(g, (genreAffinities.get(g) || 0) + weight);
        if (r.rating <= 3) {
          negativeGenres.add(g);
        }
      });

      // Director affinities
      if (r.director) {
        directorAffinities.set(r.director, (directorAffinities.get(r.director) || 0) + weight * 2.0);
      }

      // Keywords
      (r.keywords || []).forEach((k) => {
        keywordAffinities.set(k, (keywordAffinities.get(k) || 0) + weight * 1.5);
      });
    });

    const ratedIds = new Set(userRatings.map((r) => r.movieId));
    const normalizedSerendipity = serendipityLevel / 100; // 0.0 to 1.0

    // 2. Score Candidate Movies
    const scoredCandidates: { movie: Movie; score: number; reason: string; serendipityType: Recommendation['serendipityType']; highlightTags: string[] }[] = [];

    candidatePool.forEach((movie) => {
      if (ratedIds.has(movie.id)) return;

      let score = 50; // base score
      const reasons: string[] = [];
      const tags: string[] = [];

      const movieGenres = (movie.genres || []).map((g) => g.name);

      // Genre Score
      let genreScore = 0;
      movieGenres.forEach((g) => {
        const aff = genreAffinities.get(g) || 0;
        genreScore += aff * 10;
        if (aff > 0.5) tags.push(g);
      });
      score += genreScore;

      // Director Match
      if (movie.director && directorAffinities.has(movie.director)) {
        const dirAff = directorAffinities.get(movie.director) || 0;
        score += dirAff * 20;
        if (dirAff > 0) {
          reasons.push(`Directed by ${movie.director}, whose work you rated highly`);
          tags.push(`Dir: ${movie.director}`);
        }
      }

      // Quality signal (TMDB vote average & vote count)
      const qualityFactor = (movie.vote_average - 6.5) * 4;
      score += qualityFactor;

      // Era Preference Check
      if (preferredEras.length > 0 && movie.release_date) {
        const year = parseInt(movie.release_date.slice(0, 4));
        const matchedEra = preferredEras.some((era) => {
          if (era === '70s' && year >= 1970 && year < 1980) return true;
          if (era === '80s' && year >= 1980 && year < 1990) return true;
          if (era === '90s' && year >= 1990 && year < 2000) return true;
          if (era === '2000s' && year >= 2000 && year < 2010) return true;
          if (era === '2010s' && year >= 2010 && year < 2020) return true;
          if (era === '2020s' && year >= 2020) return true;
          return false;
        });
        if (matchedEra) score += 8;
      }

      // Vibe Match Check
      if (selectedVibes.length > 0) {
        const overview = (movie.overview || '').toLowerCase();
        selectedVibes.forEach((vibe) => {
          if (overview.includes(vibe.toLowerCase())) {
            score += 10;
            tags.push(vibe);
          }
        });
      }

      // Serendipity & Exploration Calculation
      let serendipityType: Recommendation['serendipityType'] = 'safe_bet';

      // Are genres somewhat outside user's primary comfort zone?
      const isUncommonGenre = movieGenres.some((g) => (genreAffinities.get(g) || 0) <= 0.2);
      
      if (normalizedSerendipity > 0.4 && isUncommonGenre && movie.vote_average >= 7.6) {
        // Boost hidden gems when serendipity is high
        const gemBonus = normalizedSerendipity * 25;
        score += gemBonus;
        serendipityType = normalizedSerendipity > 0.7 ? 'wildcard_discovery' : 'thematic_gem';
        reasons.push(
          normalizedSerendipity > 0.7
            ? `Wildcard discovery: Critically acclaimed film with narrative intensity that bridges your taste into a fresh genre.`
            : `Hidden Gem: Matches your favorite tonal depth while introducing a distinct storytelling angle.`
        );
      } else {
        if (reasons.length === 0) {
          const topFavGenre = Array.from(genreAffinities.entries()).sort((a, b) => b[1] - a[1])[0];
          if (topFavGenre && movieGenres.includes(topFavGenre[0])) {
            reasons.push(`Strong synergy with your high affinity for ${topFavGenre[0]} and intelligent pacing.`);
          } else {
            reasons.push(`Harmonizes with the overall themes and quality standards in your movie profile.`);
          }
        }
      }

      // Bound score between 45 and 99
      const finalScore = Math.min(99, Math.max(45, Math.round(score)));

      scoredCandidates.push({
        movie,
        score: finalScore,
        reason: reasons[0] || 'Recommended based on your multidimensional rating profile.',
        serendipityType,
        highlightTags: Array.from(new Set(tags)).slice(0, 3),
      });
    });

    // 3. Sort by score descending and assign ranks
    scoredCandidates.sort((a, b) => b.score - a.score);

    return scoredCandidates.slice(0, 20).map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
  }
}
