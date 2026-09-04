import React, { useEffect } from 'react';
import {
  Trophy,
  Sparkles,
  Bookmark,
  BookmarkCheck,
  Star,
  Compass,
  Flame,
  Award,
  AlertCircle,
  Clapperboard,
  SlidersHorizontal,
} from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { IMAGE_BASE_URL } from '../services/tmdb';
import { RatingControl } from './RatingControl';
import { DiscoveryFilters } from './DiscoveryFilters';

export const RankedFeed: React.FC = () => {
  const {
    recommendations,
    ratings,
    watchlist,
    isGeneratingRecs,
    generateRankings,
    lastProviderUsed,
    recommendationError,
    setRating,
    removeRating,
    toggleWatchlist,
    setSelectedMovieForModal,
    setActiveTab,
  } = useMovieStore();

  const ratedCount = Object.keys(ratings).length;

  useEffect(() => {
    // If we have ratings but no recommendations yet, auto-generate
    if (recommendations.length === 0 && ratedCount >= 1 && !isGeneratingRecs) {
      generateRankings();
    }
  }, [ratedCount, recommendations.length, generateRankings, isGeneratingRecs]);

  const getRankBadgeStyle = (rank: number) => {
    if (rank === 1) {
      return 'bg-gradient-to-r from-amber-400 to-yellow-500 text-slate-950 font-black shadow-lg shadow-amber-500/30 border-amber-300';
    }
    if (rank === 2) {
      return 'bg-gradient-to-r from-slate-200 to-slate-400 text-slate-950 font-black shadow-lg shadow-slate-300/20 border-slate-200';
    }
    if (rank === 3) {
      return 'bg-gradient-to-r from-amber-600 to-orange-700 text-white font-black shadow-lg shadow-orange-700/30 border-orange-400';
    }
    return 'bg-slate-800 text-slate-200 font-bold border-slate-700';
  };

  const getSerendipityBadge = (type: string) => {
    switch (type) {
      case 'wildcard_discovery':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold">
            <Flame className="w-3 h-3 text-rose-400" /> Wildcard Discovery
          </span>
        );
      case 'thematic_gem':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold">
            <Compass className="w-3 h-3 text-purple-400" /> Thematic Gem
          </span>
        );
      case 'director_match':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-semibold">
            <Clapperboard className="w-3 h-3 text-blue-400" /> Director Match
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
            <Award className="w-3 h-3 text-emerald-400" /> Safe Bet (High Match)
          </span>
        );
    }
  };

  if (ratedCount < 2) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-6">
        <div className="w-20 h-20 mx-auto rounded-3xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-2xl">
          <Trophy className="w-10 h-10" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white">Your Rank List Needs Calibration</h2>
          <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
            Rate at least 2 or 3 movies you have seen so Cinephile AI can compute your taste vector and rank candidates.
          </p>
        </div>
        <button
          onClick={() => setActiveTab('calibration')}
          className="px-6 py-3 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-sm shadow-xl shadow-indigo-950 flex items-center gap-2 mx-auto active:scale-95 transition-all cursor-pointer"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Go to Taste Calibration Grid
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-24 space-y-8">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="w-6 h-6 text-amber-400" />
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Top Ranked Movies for You
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 flex items-center gap-2">
            <span>Ranked by AI analyzing {ratedCount} of your ratings</span>
            {lastProviderUsed && (
              <>
                <span>•</span>
                <span className="text-indigo-400 font-medium">{lastProviderUsed}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Discovery & Serendipity Controls */}
      <DiscoveryFilters />

      {/* Notification / Error alert if any */}
      {recommendationError && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">AI Status:</span> {recommendationError}. Using local fallback engine for uninterrupted ranking.
          </div>
        </div>
      )}

      {/* Recommendations Feed List */}
      {isGeneratingRecs ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-44 rounded-2xl glass-panel animate-shimmer" />
          ))}
        </div>
      ) : recommendations.length === 0 ? (
        <div className="text-center py-16 glass-panel rounded-2xl p-8 space-y-4">
          <p className="text-slate-300">Click below to compute your personalized recommendations.</p>
          <button
            onClick={generateRankings}
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-950 cursor-pointer"
          >
            Generate AI Rankings
          </button>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {recommendations.map((rec) => {
            const { movie, rank, score, reason, serendipityType, highlightTags } = rec;
            const userRating = ratings[movie.id]?.rating;
            const inWatchlist = watchlist.includes(movie.id);
            const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : null;
            const year = movie.release_date ? movie.release_date.slice(0, 4) : '';

            return (
              <div
                key={movie.id}
                className="group relative flex flex-col md:flex-row gap-4 sm:gap-6 rounded-2xl sm:rounded-3xl p-4 sm:p-5 glass-panel glass-panel-hover border border-slate-800 transition-all overflow-hidden"
              >
                {/* Rank Number Badge */}
                <div
                  className={`absolute top-4 left-4 z-10 w-9 h-9 rounded-xl flex items-center justify-center text-sm border shadow-lg ${getRankBadgeStyle(
                    rank
                  )}`}
                >
                  #{rank}
                </div>

                {/* Poster Box */}
                <div
                  onClick={() => setSelectedMovieForModal(movie)}
                  className="relative w-full md:w-44 aspect-[2/3] md:aspect-auto md:h-64 rounded-xl sm:rounded-2xl overflow-hidden bg-slate-900 shrink-0 cursor-pointer"
                >
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={movie.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-slate-500 p-2 text-center">
                      No Poster
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60 md:hidden" />

                  {/* Mobile Match pill */}
                  <div className="absolute top-4 right-4 md:hidden px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md text-xs font-bold text-emerald-400 border border-emerald-500/30">
                    {score}% Match
                  </div>
                </div>

                {/* Content & AI Reasoning Body */}
                <div className="flex flex-col justify-between flex-grow space-y-3">
                  <div className="space-y-2">
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {getSerendipityBadge(serendipityType)}
                          {highlightTags &&
                            highlightTags.map((tag, idx) => (
                              <span
                                key={idx}
                                className="text-[11px] px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-300 border border-slate-700/60"
                              >
                                {tag}
                              </span>
                            ))}
                        </div>

                        <h2
                          onClick={() => setSelectedMovieForModal(movie)}
                          className="text-lg sm:text-xl font-bold text-white hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-2"
                        >
                          {movie.title}
                          {year && <span className="text-slate-400 font-normal text-sm">({year})</span>}
                        </h2>
                      </div>

                      {/* Desktop Match Score & Watchlist */}
                      <div className="hidden md:flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-lg font-extrabold text-emerald-400">{score}%</div>
                          <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                            Taste Match
                          </div>
                        </div>

                        <button
                          onClick={() => toggleWatchlist(movie.id)}
                          className={`p-2.5 rounded-xl border transition-colors cursor-pointer ${
                            inWatchlist
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                          }`}
                          title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                        >
                          {inWatchlist ? <BookmarkCheck className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
                        </button>
                      </div>
                    </div>

                    {/* Movie Metadata bar */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="flex items-center gap-1 font-semibold text-amber-400">
                        <Star className="w-3.5 h-3.5 fill-amber-400" />
                        {movie.vote_average.toFixed(1)} TMDB
                      </span>
                      <span>•</span>
                      <span>
                        {(movie.genres || []).map((g) => g.name).join(', ') || 'Feature Film'}
                      </span>
                    </div>

                    {/* Overview snippet */}
                    <p className="text-xs sm:text-sm text-slate-300 line-clamp-2 leading-relaxed">
                      {movie.overview}
                    </p>

                    {/* AI Explanation Box */}
                    <div className="p-3 sm:p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-500/20 flex items-start gap-2.5">
                      <Sparkles className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                      <div className="text-xs text-indigo-200 leading-relaxed">
                        <span className="font-semibold text-white">Why ranked #{rank}: </span>
                        {reason}
                      </div>
                    </div>
                  </div>

                  {/* Rating Strip at the bottom of the card */}
                  <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="w-full sm:max-w-md">
                      <RatingControl
                        currentRating={userRating}
                        onRate={(val) => setRating(movie, val)}
                        onClear={() => removeRating(movie.id)}
                        compact={true}
                      />
                    </div>

                    <button
                      onClick={() => setSelectedMovieForModal(movie)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold self-end sm:self-center transition-colors cursor-pointer"
                    >
                      Trailer & Details →
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
