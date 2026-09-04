import React, { useState, useEffect, useRef } from 'react';
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
  CheckCircle2,
} from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { IMAGE_BASE_URL } from '../services/tmdb';
import { RatingControl } from './RatingControl';
import { DiscoveryFilters } from './DiscoveryFilters';
import { ShareButton } from './ShareButton';
import { Movie } from '../types';

export const RankedFeed: React.FC = () => {
  const {
    recommendations,
    ratings,
    watchlist,
    isGeneratingRecs,
    generateRankings,
    lastProviderUsed,
    recommendationError,
    aiTasteAnalysis,
    setRating,
    removeRating,
    toggleWatchlist,
    dismissRecommendation,
    setSelectedMovieForModal,
    setActiveTab,
    showToast,
  } = useMovieStore();

  const [pendingRemovalIds, setPendingRemovalIds] = useState<Record<number, boolean>>({});
  const pendingTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingTimersRef.current).forEach((t) => clearTimeout(t));
    };
  }, []);

  const ratedCount = Object.keys(ratings).length;

  const handleRateRecommendedMovie = (movie: Movie, val: number) => {
    setRating(movie, val);
    showToast(`Rated "${movie.title}" ${val}/10 — saved to My Ratings!`);

    if (pendingTimersRef.current[movie.id]) {
      clearTimeout(pendingTimersRef.current[movie.id]);
    }
    setPendingRemovalIds((prev) => ({ ...prev, [movie.id]: true }));

    pendingTimersRef.current[movie.id] = setTimeout(() => {
      dismissRecommendation(movie.id);
      setPendingRemovalIds((prev) => {
        const next = { ...prev };
        delete next[movie.id];
        return next;
      });
      delete pendingTimersRef.current[movie.id];
    }, 2500);
  };

  const handleClearRecommendedMovie = (movieId: number) => {
    if (pendingTimersRef.current[movieId]) {
      clearTimeout(pendingTimersRef.current[movieId]);
      delete pendingTimersRef.current[movieId];
    }
    setPendingRemovalIds((prev) => {
      const next = { ...prev };
      delete next[movieId];
      return next;
    });
    removeRating(movieId);
  };

  // Keep unrated movies AND movies currently in grace period
  const visibleRecommendations = recommendations.filter(
    (rec) => !ratings[rec.movie.id] || Boolean(pendingRemovalIds[rec.movie.id])
  );

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
      case 'ai_cinephile_discovery':
        return (
          <span className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full bg-gradient-to-r from-purple-500/25 via-pink-500/25 to-indigo-500/25 text-pink-200 border border-pink-500/40 font-bold shadow-lg shadow-purple-950/40 animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-pink-300 fill-pink-400/20" />
            <span>🧠 AI Cinephile Discovery (Cross-Genre)</span>
          </span>
        );
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

      {/* AI Psychological Taste DNA card if available */}
      {aiTasteAnalysis && (
        <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl glass-panel border border-purple-500/30 bg-gradient-to-r from-purple-950/40 via-slate-900/60 to-indigo-950/40 shadow-xl relative overflow-hidden">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 shrink-0">
              <Sparkles className="w-5 h-5 text-purple-300" />
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide uppercase">
                  AI Psychological Taste Synthesis
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-semibold border border-purple-500/30">
                  Cross-Genre DNA
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-serif italic">
                "{aiTasteAnalysis}"
              </p>
            </div>
          </div>
        </div>
      )}

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
      ) : visibleRecommendations.length === 0 ? (
        <div className="text-center py-16 glass-panel rounded-2xl p-8 space-y-4">
          <p className="text-slate-300">
            {recommendations.length > 0
              ? "You've rated all recommended movies in this batch! Click below to discover your next batch."
              : 'Click below to compute your personalized recommendations.'}
          </p>
          <button
            onClick={generateRankings}
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm shadow-lg shadow-indigo-950 cursor-pointer"
          >
            Generate AI Rankings
          </button>
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {visibleRecommendations.map((rec, index) => {
            const { movie, score, reason, serendipityType, highlightTags } = rec;
            const displayRank = index + 1;
            const inWatchlist = watchlist.includes(movie.id);
            const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : null;
            const year = movie.release_date ? movie.release_date.slice(0, 4) : '';
            const isPendingRemoval = Boolean(pendingRemovalIds[movie.id]);

            return (
              <div
                key={movie.id}
                className={`group relative flex flex-col md:flex-row gap-4 sm:gap-6 rounded-2xl sm:rounded-3xl p-4 sm:p-5 glass-panel glass-panel-hover border transition-all duration-300 overflow-hidden ${
                  isPendingRemoval
                    ? 'ring-2 ring-indigo-400 border-indigo-400 shadow-xl shadow-indigo-950/80 bg-slate-900/95 scale-[1.01]'
                    : serendipityType === 'ai_cinephile_discovery'
                    ? 'border-purple-500/40 shadow-lg shadow-purple-950/20 ring-1 ring-purple-500/30 bg-slate-950/90'
                    : 'border-slate-800'
                }`}
              >
                {/* Rank Number Badge */}
                <div
                  className={`absolute top-4 left-4 z-10 w-9 h-9 rounded-xl flex items-center justify-center text-sm border shadow-lg ${getRankBadgeStyle(
                    displayRank
                  )}`}
                >
                  #{displayRank}
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

                    {/* Mobile Match pill, Watchlist & Share buttons */}
                    <div className="absolute top-4 right-4 md:hidden flex items-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWatchlist(movie);
                        }}
                        className={`p-1.5 rounded-lg backdrop-blur-md border transition-all cursor-pointer ${
                          inWatchlist
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-md'
                            : 'bg-slate-950/80 text-slate-300 border-slate-700/60 hover:text-white'
                        }`}
                        title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                      >
                        {inWatchlist ? <BookmarkCheck className="w-4 h-4 text-amber-400" /> : <Bookmark className="w-4 h-4" />}
                      </button>
                      <ShareButton movie={movie} variant="icon" iconSize="w-4 h-4" />
                      <div className="px-2.5 py-1 rounded-full bg-slate-950/80 backdrop-blur-md text-xs font-bold text-emerald-400 border border-emerald-500/30">
                        {score}% Match
                      </div>
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

                        {/* Desktop Match Score & Watchlist & Share */}
                        <div className="hidden md:flex items-center gap-2">
                          <div className="text-right mr-1">
                            <div className="text-lg font-extrabold text-emerald-400">{score}%</div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                              Taste Match
                            </div>
                          </div>

                          <button
                            onClick={() => toggleWatchlist(movie)}
                            className={`p-2.5 rounded-xl border transition-colors cursor-pointer ${
                              inWatchlist
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                            }`}
                            title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                          >
                            {inWatchlist ? <BookmarkCheck className="w-5 h-5" /> : <Bookmark className="w-5 h-5" />}
                          </button>

                          <ShareButton
                            movie={movie}
                            variant="icon"
                            iconSize="w-5 h-5"
                            className="p-2.5 rounded-xl bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700"
                          />
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
                    <div
                      className={`p-3 sm:p-3.5 rounded-xl flex items-start gap-2.5 ${
                        serendipityType === 'ai_cinephile_discovery'
                          ? 'bg-gradient-to-r from-purple-950/50 via-pink-950/30 to-indigo-950/50 border border-pink-500/40 shadow-md'
                          : 'bg-indigo-950/30 border border-indigo-500/20'
                      }`}
                    >
                      <Sparkles
                        className={`w-4 h-4 shrink-0 mt-0.5 ${
                          serendipityType === 'ai_cinephile_discovery' ? 'text-pink-400' : 'text-indigo-400'
                        }`}
                      />
                      <div
                        className={`text-xs leading-relaxed ${
                          serendipityType === 'ai_cinephile_discovery' ? 'text-pink-100' : 'text-indigo-200'
                        }`}
                      >
                        <span className="font-semibold text-white">
                          {serendipityType === 'ai_cinephile_discovery'
                            ? `Why this AI Cinephile Discovery (#${displayRank}): `
                            : `Why ranked #${displayRank}: `}
                        </span>
                        {reason}
                      </div>
                    </div>
                  </div>

                  {/* Rating Strip at the bottom of the card */}
                  <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="w-full sm:max-w-md space-y-1">
                      {isPendingRemoval && (
                        <div className="flex items-center justify-between text-[10px] text-indigo-200 bg-indigo-950/70 px-2 py-0.5 rounded border border-indigo-500/30 animate-pulse">
                          <span className="font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Grade saved! Adjust or leaves queue in 2s...
                          </span>
                        </div>
                      )}

                      <RatingControl
                        currentRating={ratings[movie.id]?.rating}
                        onRate={(val) => handleRateRecommendedMovie(movie, val)}
                        onClear={() => handleClearRecommendedMovie(movie.id)}
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
