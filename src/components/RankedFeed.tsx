import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  Loader2,
} from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { IMAGE_BASE_URL } from '../services/tmdb';
import { RatingControl } from './RatingControl';
import { DiscoveryFilters } from './DiscoveryFilters';
import { ShareButton } from './ShareButton';
import { TonightPicks } from './TonightPicks';
import { selectTonightPicks } from '../services/recommendation/tonightPicks';
import { Movie, Recommendation } from '../types';
import { Bucket } from '../services/recommendation/types';

/** CIN-25: the "Tonight" picks only show for a list long enough to scroll past. */
const TONIGHT_MIN_LIST = 8;

/** CIN-52: grace period before a newly rated card is dismissed from the feed. */
const RATED_DISMISS_GRACE_MS = 8000;

type BucketFilter = 'all' | 'safe_bet' | 'stretch' | 'wildcard';

const BUCKET_FILTER_OPTIONS: { id: BucketFilter; label: string; emptyNoun: string }[] = [
  { id: 'all', label: 'All', emptyNoun: '' },
  { id: 'safe_bet', label: 'Safe', emptyNoun: 'safe' },
  { id: 'stretch', label: 'Stretch', emptyNoun: 'stretch' },
  { id: 'wildcard', label: 'Wildcard', emptyNoun: 'wildcard' },
];

const BUCKET_BADGE_CONFIG: Record<
  Bucket,
  {
    label: string;
    Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    iconClass: string;
  }
> = {
  safe_bet: {
    label: 'Safe pick',
    Icon: Award,
    iconClass: 'w-3 h-3 text-[var(--accent-secondary)]',
  },
  stretch: {
    label: 'A stretch for you',
    Icon: Compass,
    iconClass: 'w-3 h-3 text-[var(--accent-secondary)]',
  },
  wildcard: {
    label: 'Wildcard',
    Icon: Flame,
    iconClass: 'w-3 h-3 text-[var(--accent-primary)]',
  },
  below_floor: {
    label: 'Long shot',
    Icon: Compass,
    iconClass: 'w-3 h-3 text-slate-400',
  },
};

export const BucketBadge: React.FC<{ bucket: Bucket }> = ({ bucket }) => {
  const config = BUCKET_BADGE_CONFIG[bucket];
  if (!config) return null;
  const { label, Icon, iconClass } = config;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-md palette-tag-secondary font-semibold">
      <Icon className={iconClass} aria-hidden={true} />
      <span>{label}</span>
    </span>
  );
};

interface RestoredRecEntry {
  rec: Recommendation;
  beforeIds: number[];
  afterIds: number[];
  fallbackIndex: number;
  batchTimestamp: number | null;
}

export const RankedFeed: React.FC = () => {
  const {
    recommendations,
    cachedRecsTimestamp,
    ratings,
    watchlist,
    hiddenFilms,
    isGeneratingRecs,
    isLoadingMore,
    loadMoreStatus,
    generateRankings,
    loadMoreRankings,
    lastProviderUsed,
    lastRunRatedCount,
    recommendationError,
    aiTasteAnalysis,
    setRating,
    removeRating,
    toggleWatchlist,
    dismissRecommendation,
    setSelectedMovieForModal,
    setActiveTab,
    showToast,
    hideFilm,
    restoreFilm,
  } = useMovieStore();

  const [pendingRemovalIds, setPendingRemovalIds] = useState<Record<number, boolean>>({});
  const pendingTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pendingRemovalRef = useRef<Set<number>>(new Set());
  const focusedCardsRef = useRef<Set<number>>(new Set());
  const pointerInsideCardsRef = useRef<Set<number>>(new Set());
  const isMountedRef = useRef<boolean>(true);
  const ratingsRef = useRef(ratings);

  useEffect(() => {
    ratingsRef.current = ratings;
  }, [ratings]);

  // Clean up timers on unmount
  useEffect(() => {
    isMountedRef.current = true;
    const timers = pendingTimersRef.current;
    const pendingIds = pendingRemovalRef.current;
    return () => {
      isMountedRef.current = false;
      Object.entries(timers).forEach(([id, t]) => {
        clearTimeout(t);
        delete timers[Number(id)];
      });
      pendingIds.clear();
    };
  }, []);

  const ratedCount = Object.keys(ratings).length;
  const analyzedRatedCount = lastRunRatedCount ?? ratedCount;
  const hasNewSince = lastRunRatedCount !== null && ratedCount > lastRunRatedCount;
  const newSinceCount = hasNewSince ? ratedCount - lastRunRatedCount : 0;

  const profileSig = Object.entries(ratings)
    .map(([id, r]) => `${id}:${r.rating}`)
    .sort()
    .join(',');
  const autoAttemptedProfileRef = useRef<string | null>(null);
  const profileSigRef = useRef<string>(profileSig);
  const pendingFocusRef = useRef<{ type: 'card'; movieId: number } | { type: 'heading' } | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const awaitingLoadMoreRef = useRef<{ prevIds: Set<number>; timestamp: number | null } | null>(null);
  const seenButtonsRef = useRef<Record<number, HTMLButtonElement | null>>({});
  const shouldFocusRatingRef = useRef<number | null>(null);
  const ratingContainerRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [seenPromptMovieId, setSeenPromptMovieId] = useState<number | null>(null);
  const [restoredRecs, setRestoredRecs] = useState<RestoredRecEntry[]>([]);
  const [bucketFilter, setBucketFilter] = useState<BucketFilter>('all');

  useEffect(() => {
    profileSigRef.current = profileSig;
  }, [profileSig]);

  const hiddenMovieIds = useMemo(
    () => new Set((hiddenFilms || []).map((h) => h.movieId)),
    [hiddenFilms]
  );

  const effectiveRecommendations = useMemo(() => {
    const list = [...recommendations];
    const existingIds = new Set(list.map((r) => r.movie.id));

    for (const entry of restoredRecs) {
      if (entry.batchTimestamp !== cachedRecsTimestamp) continue;
      if (existingIds.has(entry.rec.movie.id)) continue;

      let insertAt = -1;
      for (const afterId of entry.afterIds) {
        const idx = list.findIndex((r) => r.movie.id === afterId);
        if (idx !== -1) {
          insertAt = idx;
          break;
        }
      }
      if (insertAt === -1) {
        for (let i = entry.beforeIds.length - 1; i >= 0; i--) {
          const idx = list.findIndex((r) => r.movie.id === entry.beforeIds[i]);
          if (idx !== -1) {
            insertAt = idx + 1;
            break;
          }
        }
      }
      if (insertAt === -1) {
        insertAt = Math.min(entry.fallbackIndex, list.length);
      }

      list.splice(insertAt, 0, entry.rec);
      existingIds.add(entry.rec.movie.id);
    }

    return list;
  }, [recommendations, restoredRecs, cachedRecsTimestamp]);

  // Keep unrated movies AND movies currently in grace period, strictly excluding hidden films
  const visibleRecommendations = effectiveRecommendations.filter(
    (rec) =>
      !hiddenMovieIds.has(rec.movie.id) &&
      (!ratings[rec.movie.id] || Boolean(pendingRemovalIds[rec.movie.id]))
  );

  const hasBucketData = visibleRecommendations.some((rec) => Boolean(rec.bucket));
  const activeBucketFilter: BucketFilter = hasBucketData ? bucketFilter : 'all';

  const filteredRecommendations = useMemo(() => {
    if (activeBucketFilter === 'all') {
      return visibleRecommendations;
    }
    return visibleRecommendations.filter((rec) => rec.bucket === activeBucketFilter);
  }, [visibleRecommendations, activeBucketFilter]);

  // CIN-25: three confident picks highlighted above the unfiltered list. The full list stays below,
  // so every film keeps its rate, hide and watchlist actions and its rank number.
  const { picks: tonightPicks } = useMemo(
    () =>
      // Only worth highlighting when the list is long enough to scroll past.
      activeBucketFilter === 'all' && hasBucketData && filteredRecommendations.length >= TONIGHT_MIN_LIST
        ? selectTonightPicks(filteredRecommendations)
        : { picks: [] as Recommendation[], rest: filteredRecommendations },
    [activeBucketFilter, hasBucketData, filteredRecommendations]
  );

  const clearPendingTimer = useCallback((movieId: number) => {
    if (pendingTimersRef.current[movieId]) {
      clearTimeout(pendingTimersRef.current[movieId]);
      delete pendingTimersRef.current[movieId];
    }
  }, []);

  const schedulePendingDismiss = useCallback((movieId: number) => {
    clearPendingTimer(movieId);
    if (!isMountedRef.current || !pendingRemovalRef.current.has(movieId)) {
      return;
    }
    if (focusedCardsRef.current.has(movieId) || pointerInsideCardsRef.current.has(movieId)) {
      return;
    }
    pendingTimersRef.current[movieId] = setTimeout(() => {
      delete pendingTimersRef.current[movieId];
      if (!isMountedRef.current || !pendingRemovalRef.current.has(movieId)) {
        return;
      }
      pendingRemovalRef.current.delete(movieId);
      focusedCardsRef.current.delete(movieId);
      pointerInsideCardsRef.current.delete(movieId);
      if (ratingsRef.current[movieId]) {
        dismissRecommendation(movieId);
      }
      setRestoredRecs((prev) => prev.filter((e) => e.rec.movie.id !== movieId));
      setPendingRemovalIds((prev) => {
        if (!prev[movieId]) return prev;
        const next = { ...prev };
        delete next[movieId];
        return next;
      });
    }, RATED_DISMISS_GRACE_MS);
  }, [clearPendingTimer, dismissRecommendation]);

  const handleCardFocus = (movieId: number) => {
    focusedCardsRef.current.add(movieId);
    clearPendingTimer(movieId);
  };

  const handleCardBlur = (movieId: number, e: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = e.relatedTarget as Node | null;
    if (nextTarget && e.currentTarget.contains(nextTarget)) {
      return;
    }
    focusedCardsRef.current.delete(movieId);
    if (pendingRemovalRef.current.has(movieId)) {
      schedulePendingDismiss(movieId);
    }
  };

  const handleCardPointerEnter = (movieId: number) => {
    pointerInsideCardsRef.current.add(movieId);
    clearPendingTimer(movieId);
  };

  const handleCardPointerLeave = (movieId: number) => {
    pointerInsideCardsRef.current.delete(movieId);
    if (pendingRemovalRef.current.has(movieId)) {
      schedulePendingDismiss(movieId);
    }
  };

  const handleRateRecommendedMovie = (movie: Movie, val: number) => {
    setSeenPromptMovieId((prev) => (prev === movie.id ? null : prev));
    setRating(movie, val);
    showToast(`Rated "${movie.title}" ${val}/10 — saved to My Ratings!`);

    const cardEl = cardRefs.current[movie.id];
    if (cardEl && document.activeElement && cardEl.contains(document.activeElement)) {
      focusedCardsRef.current.add(movie.id);
    }

    pendingRemovalRef.current.add(movie.id);
    setPendingRemovalIds((prev) => (prev[movie.id] ? prev : { ...prev, [movie.id]: true }));
    schedulePendingDismiss(movie.id);
  };

  const handleClearRecommendedMovie = (movieId: number) => {
    clearPendingTimer(movieId);
    pendingRemovalRef.current.delete(movieId);
    setPendingRemovalIds((prev) => {
      if (!prev[movieId]) return prev;
      const next = { ...prev };
      delete next[movieId];
      return next;
    });
    removeRating(movieId);
  };

  const handleUndoRating = (movieId: number) => {
    handleClearRecommendedMovie(movieId);
    const container = ratingContainerRefs.current[movieId];
    const radioBtn = container?.querySelector<HTMLButtonElement>('button[role="radio"]');
    radioBtn?.focus();
  };

  const handleToggleSeenPrompt = (movieId: number) => {
    if (seenPromptMovieId === movieId) {
      shouldFocusRatingRef.current = null;
      setSeenPromptMovieId(null);
    } else {
      shouldFocusRatingRef.current = movieId;
      setSeenPromptMovieId(movieId);
    }
  };

  const handleHideFilm = (movieId: number, reason: 'seen' | 'not_for_me', rawTitle?: string) => {
    autoAttemptedProfileRef.current = profileSig;

    const hiddenRecIndex = effectiveRecommendations.findIndex((rec) => rec.movie.id === movieId);
    const hiddenRec = hiddenRecIndex !== -1 ? effectiveRecommendations[hiddenRecIndex] : null;
    const beforeIds =
      hiddenRecIndex !== -1
        ? effectiveRecommendations.slice(0, hiddenRecIndex).map((r) => r.movie.id)
        : [];
    const afterIds =
      hiddenRecIndex !== -1
        ? effectiveRecommendations.slice(hiddenRecIndex + 1).map((r) => r.movie.id)
        : [];
    const capturedTimestamp = cachedRecsTimestamp;

    const currentIndex = filteredRecommendations.findIndex((rec) => rec.movie.id === movieId);
    if (currentIndex !== -1) {
      if (filteredRecommendations.length <= 1) {
        pendingFocusRef.current = { type: 'heading' };
      } else if (currentIndex < filteredRecommendations.length - 1) {
        pendingFocusRef.current = {
          type: 'card',
          movieId: filteredRecommendations[currentIndex + 1].movie.id,
        };
      } else {
        pendingFocusRef.current = {
          type: 'card',
          movieId: filteredRecommendations[currentIndex - 1].movie.id,
        };
      }
    }

    setSeenPromptMovieId((prev) => (prev === movieId ? null : prev));
    setRestoredRecs((prev) => {
      if (!prev.some((e) => e.rec.movie.id === movieId)) return prev;
      return prev.filter((e) => e.rec.movie.id !== movieId);
    });

    const title = rawTitle && rawTitle.trim() ? rawTitle.trim() : `#${movieId}`;
    clearPendingTimer(movieId);
    pendingRemovalRef.current.delete(movieId);
    focusedCardsRef.current.delete(movieId);
    pointerInsideCardsRef.current.delete(movieId);
    setPendingRemovalIds((prev) => {
      if (!prev[movieId]) return prev;
      const next = { ...prev };
      delete next[movieId];
      return next;
    });
    hideFilm(movieId, reason, title);
    showToast(`Hidden "${title}". Restore it in Settings → Hidden films.`, {
      label: 'Undo',
      onAction: () => {
        autoAttemptedProfileRef.current = profileSigRef.current;
        pendingFocusRef.current = { type: 'card', movieId };
        restoreFilm(movieId);
        if (hiddenRec) {
          setRestoredRecs((prev) => [
            ...prev.filter((e) => e.rec.movie.id !== movieId),
            {
              rec: hiddenRec,
              beforeIds,
              afterIds,
              fallbackIndex: hiddenRecIndex,
              batchTimestamp: capturedTimestamp,
            },
          ]);
        }
      },
    });
  };

  useEffect(() => {
    if (shouldFocusRatingRef.current === null) return;
    const targetMovieId = shouldFocusRatingRef.current;
    shouldFocusRatingRef.current = null;

    if (seenPromptMovieId !== targetMovieId) return;
    const container = ratingContainerRefs.current[targetMovieId];
    const radioBtn =
      container?.querySelector<HTMLButtonElement>('button[role="radio"][aria-checked="true"]') ||
      container?.querySelector<HTMLButtonElement>('button[role="radio"]');
    radioBtn?.focus();
  }, [seenPromptMovieId]);

  useEffect(() => {
    if (seenPromptMovieId === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) {
        const targetId = seenPromptMovieId;
        setSeenPromptMovieId(null);
        seenButtonsRef.current[targetId]?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [seenPromptMovieId]);

  useEffect(() => {
    if (!pendingFocusRef.current) return;
    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;

    if (target.type === 'heading') {
      headingRef.current?.focus();
    } else if (target.type === 'card') {
      const btn =
        seenButtonsRef.current[target.movieId] ||
        document.querySelector<HTMLButtonElement>(`button[aria-label^="Seen it:"][data-movie-id="${target.movieId}"]`);
      if (btn) {
        btn.focus();
      } else {
        headingRef.current?.focus();
      }
    }
  });

  useEffect(() => {
    setSeenPromptMovieId((prev) => (prev !== null ? null : prev));
    Object.entries(pendingTimersRef.current).forEach(([id, t]) => {
      clearTimeout(t);
      delete pendingTimersRef.current[Number(id)];
    });
    pendingRemovalRef.current.clear();
    focusedCardsRef.current.clear();
    pointerInsideCardsRef.current.clear();
    setPendingRemovalIds((prev) => (Object.keys(prev).length > 0 ? {} : prev));
  }, [cachedRecsTimestamp]);

  // Cards unmount during regeneration without firing blur/pointerleave; clear stale interaction flags
  // so pending cards do not remain permanently paused if generation fails and remounts the old list.
  useEffect(() => {
    if (!isGeneratingRecs) return;
    focusedCardsRef.current.clear();
    pointerInsideCardsRef.current.clear();
    pendingRemovalRef.current.forEach((movieId) => {
      schedulePendingDismiss(movieId);
    });
  }, [isGeneratingRecs, schedulePendingDismiss]);

  useEffect(() => {
    // If we have ratings and no recommendations yet, auto-generate ONLY ONCE per profile signature
    // and never continuously retry if generation errored or returned empty.
    if (
      effectiveRecommendations.length === 0 &&
      ratedCount >= 1 &&
      !isGeneratingRecs &&
      !recommendationError &&
      autoAttemptedProfileRef.current !== profileSig
    ) {
      autoAttemptedProfileRef.current = profileSig;
      generateRankings();
    }
  }, [ratedCount, effectiveRecommendations.length, generateRankings, isGeneratingRecs, recommendationError, profileSig]);

  const handleManualGenerate = () => {
    autoAttemptedProfileRef.current = profileSig;
    generateRankings();
  };

  const handleLoadMore = () => {
    awaitingLoadMoreRef.current = {
      prevIds: new Set(effectiveRecommendations.map((r) => r.movie.id)),
      timestamp: cachedRecsTimestamp,
    };
    loadMoreRankings();
  };

  useEffect(() => {
    if (isGeneratingRecs) {
      awaitingLoadMoreRef.current = null;
      return;
    }
    if (isLoadingMore || !awaitingLoadMoreRef.current) return;

    const pending = awaitingLoadMoreRef.current;
    awaitingLoadMoreRef.current = null;

    if (pending.timestamp !== cachedRecsTimestamp || loadMoreStatus === 'error') {
      return;
    }

    const firstNewRec = filteredRecommendations.find((rec) => !pending.prevIds.has(rec.movie.id));
    if (firstNewRec) {
      cardRefs.current[firstNewRec.movie.id]?.focus();
    }
  }, [isGeneratingRecs, isLoadingMore, loadMoreStatus, cachedRecsTimestamp, filteredRecommendations]);

  const getRankBadgeStyle = (rank: number) => {
    if (rank === 1) {
      return 'bg-[var(--accent-primary)] text-[var(--accent-text)] font-black border border-[var(--border-focus)]';
    }
    if (rank === 2) {
      return 'bg-[var(--bg-surface-elevated)] text-[var(--accent-secondary)] font-black border border-[var(--border-subtle)]';
    }
    if (rank === 3) {
      return 'bg-[var(--bg-surface-hover)] text-slate-200 font-bold border border-[var(--border-subtle)]';
    }
    return 'bg-[var(--bg-surface-elevated)] text-slate-400 font-bold border border-[var(--border-subtle)]';
  };

  const getSerendipityBadge = (rec: Recommendation) => {
    if (rec.bucket) {
      return <BucketBadge bucket={rec.bucket} />;
    }

    switch (rec.serendipityType) {
      case 'ai_cinephile_discovery':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-md palette-tag-secondary font-semibold">
            <Sparkles className="w-3 h-3 text-[var(--accent-secondary)]" aria-hidden={true} />
            <span>Discovery pick</span>
          </span>
        );
      case 'wildcard_discovery':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-md palette-tag-secondary font-semibold">
            <Flame className="w-3 h-3 text-[var(--accent-primary)]" aria-hidden={true} /> Wildcard Discovery
          </span>
        );
      case 'thematic_gem':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-md palette-tag-secondary font-semibold">
            <Compass className="w-3 h-3 text-[var(--accent-secondary)]" aria-hidden={true} /> Thematic Gem
          </span>
        );
      case 'director_match':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-md palette-tag-secondary font-semibold">
            <Clapperboard className="w-3 h-3 text-[var(--accent-secondary)]" aria-hidden={true} /> Director Match
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-md palette-tag-secondary font-semibold">
            <Award className="w-3 h-3 text-[var(--accent-secondary)]" aria-hidden={true} /> Safe Bet (High Match)
          </span>
        );
    }
  };

  if (ratedCount < 2) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-6">
        <div className="w-20 h-20 mx-auto rounded-3xl palette-tag-secondary flex items-center justify-center">
          <Trophy className="w-10 h-10 text-[var(--accent-secondary)]" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white">Your Rank List Needs Calibration</h2>
          <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
            Rate 3 films you love to get started. Your list grows sharper with every rating.
          </p>
        </div>
        <button
          onClick={() => setActiveTab('calibration')}
          className="btn-tactile btn-tactile-primary px-6 py-3 text-sm font-bold mx-auto"
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
            <Trophy className="w-6 h-6 text-[var(--accent-primary)]" />
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-heading text-2xl sm:text-3xl font-extrabold text-white tracking-tight focus:outline-none"
            >
              Top Ranked Movies for You
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1 flex flex-wrap items-center gap-2">
            <span>
              Ranked by AI analyzing {analyzedRatedCount} of your ratings
              {hasNewSince && ` · ${newSinceCount} new since`}
            </span>
            {lastProviderUsed && (
              <>
                <span>•</span>
                <span className="text-[var(--accent-secondary)] font-medium">{lastProviderUsed}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Discovery & Serendipity Controls */}
      <DiscoveryFilters />

      {/* Taste summary card if available */}
      {aiTasteAnalysis && (
        <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl glass-panel border border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)] relative overflow-hidden">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl palette-tag-secondary shrink-0">
              <Sparkles className="w-5 h-5 text-[var(--accent-secondary)]" aria-hidden={true} />
            </div>
            <div className="space-y-1">
              <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                Your taste, in a sentence
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-serif italic">
                "{aiTasteAnalysis}"
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Notification / Error alert if any */}
      {recommendationError && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden={true} />
            <div>
              <span className="font-bold">Note:</span> {recommendationError}
            </div>
          </div>
          <button
            onClick={handleManualGenerate}
            disabled={isGeneratingRecs}
            className="px-3 py-1.5 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-semibold text-xs shrink-0 self-start sm:self-auto cursor-pointer disabled:opacity-50 transition-colors"
          >
            Retry Generation
          </button>
        </div>
      )}

      {/* Bucket Filter Chips */}
      {!isGeneratingRecs && hasBucketData && (
        <div
          role="group"
          aria-label="Filter recommendations by category"
          className="flex flex-wrap items-center gap-2"
        >
          {BUCKET_FILTER_OPTIONS.map((option) => {
            const isSelected = activeBucketFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setBucketFilter(option.id)}
                className={`btn-tactile text-xs px-3.5 py-1.5 rounded-lg focus-ring ${
                  isSelected ? 'btn-tactile-primary' : 'btn-tactile-secondary'
                }`}
              >
                {option.label}
              </button>
            );
          })}
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
            onClick={handleManualGenerate}
            disabled={isGeneratingRecs}
            className="btn-tactile btn-tactile-primary px-6 py-3 text-sm font-bold disabled:opacity-50"
          >
            {recommendations.length > 0 ? 'Discover Next Batch' : 'Generate AI Rankings'}
          </button>
        </div>
      ) : filteredRecommendations.length === 0 ? (
        <div className="text-center py-12 glass-panel rounded-2xl p-6 space-y-3">
          <p className="text-sm text-slate-300">
            No {BUCKET_FILTER_OPTIONS.find((o) => o.id === activeBucketFilter)?.emptyNoun} picks in this list.
          </p>
          <button
            type="button"
            onClick={() => setBucketFilter('all')}
            className="btn-tactile btn-tactile-secondary px-4 py-2 text-xs font-semibold focus-ring"
          >
            Show all picks
          </button>
        </div>
      ) : (
        <div className="space-y-6 sm:space-y-8">
          <TonightPicks picks={tonightPicks} onOpen={(rec) => setSelectedMovieForModal(rec.movie)} />
          {tonightPicks.length > 0 && (
            <h2 className="text-lg sm:text-xl font-bold text-white">Your full ranked list</h2>
          )}
        <div className="space-y-4 sm:space-y-6">
          {filteredRecommendations.map((rec, index) => {
            const { movie, reason, serendipityType, highlightTags } = rec;
            const originalIndex = visibleRecommendations.findIndex((r) => r.movie.id === movie.id);
            const displayRank = originalIndex !== -1 ? originalIndex + 1 : index + 1;
            const inWatchlist = watchlist.includes(movie.id);
            const posterUrl = movie.poster_path ? `${IMAGE_BASE_URL}${movie.poster_path}` : null;
            const year = movie.release_date ? movie.release_date.slice(0, 4) : '';
            const isPendingRemoval = Boolean(pendingRemovalIds[movie.id]);
            const ratedScore = ratings[movie.id]?.rating;
            const isSeenPromptOpen = seenPromptMovieId === movie.id;
            const displayTitle = movie.title && movie.title.trim() ? movie.title.trim() : `#${movie.id}`;

            return (
              <div
                key={movie.id}
                ref={(el) => {
                  if (el) {
                    cardRefs.current[movie.id] = el;
                  } else {
                    delete cardRefs.current[movie.id];
                  }
                }}
                tabIndex={-1}
                data-movie-id={movie.id}
                onFocus={() => handleCardFocus(movie.id)}
                onBlur={(e) => handleCardBlur(movie.id, e)}
                onPointerEnter={() => handleCardPointerEnter(movie.id)}
                onPointerLeave={() => handleCardPointerLeave(movie.id)}
                onMouseEnter={() => handleCardPointerEnter(movie.id)}
                onMouseLeave={() => handleCardPointerLeave(movie.id)}
                className={`group relative flex flex-col md:flex-row gap-4 sm:gap-6 rounded-2xl sm:rounded-3xl p-4 sm:p-5 glass-panel glass-panel-hover border transition-colors duration-200 overflow-hidden focus-ring ${
                  isPendingRemoval
                    ? 'bg-[var(--bg-surface-elevated)] border-[var(--border-subtle)]'
                    : serendipityType === 'ai_cinephile_discovery'
                    ? 'border-[var(--border-focus)]'
                    : 'border-[var(--border-subtle)]'
                }`}
              >
                {/* Active Pending Grace Indicator Strip */}
                {isPendingRemoval && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-[var(--accent-secondary)] z-30" />
                )}

                {/* Rank Number Badge */}
                <div
                  className={`absolute top-4 left-4 z-10 w-9 h-9 rounded-xl flex items-center justify-center text-sm ${getRankBadgeStyle(
                    displayRank
                  )}`}
                >
                  #{displayRank}
                </div>

                {/* Poster Box */}
                <div
                  onClick={() => setSelectedMovieForModal(movie)}
                  className="relative w-full md:w-44 aspect-[2/3] md:aspect-auto md:h-64 rounded-xl sm:rounded-2xl overflow-hidden bg-[var(--bg-canvas)] shrink-0 cursor-pointer"
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

                  <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-surface)] via-transparent to-transparent opacity-60 md:hidden" />

                  {/* Mobile Watchlist & Share buttons */}
                  <div className="absolute top-4 right-4 md:hidden flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(movie);
                      }}
                      className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                        inWatchlist
                          ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-hover)] border-[var(--border-focus)]'
                          : 'bg-[var(--bg-surface)] text-slate-300 border-[var(--border-subtle)] hover:text-white'
                      }`}
                      title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                    >
                      {inWatchlist ? <BookmarkCheck className="w-4 h-4 text-[var(--accent-hover)]" /> : <Bookmark className="w-4 h-4" />}
                    </button>
                    <ShareButton movie={movie} variant="icon" iconSize="w-4 h-4" />
                  </div>
                </div>

                {/* Content & Reasoning Body */}
                <div className="flex flex-col justify-between flex-grow space-y-3">
                  <div className="space-y-2">
                    {/* Header Row */}
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {getSerendipityBadge(rec)}
                          {highlightTags &&
                            highlightTags.map((tag, idx) => (
                              <span
                                key={idx}
                                className="text-[11px] px-2.5 py-0.5 rounded-md palette-tag-secondary font-medium tracking-wide"
                              >
                                {tag}
                              </span>
                            ))}
                        </div>

                        <h2
                          onClick={() => setSelectedMovieForModal(movie)}
                          className="text-lg sm:text-xl font-bold text-white hover:text-[var(--accent-secondary)] transition-colors cursor-pointer flex items-center gap-2"
                        >
                          {movie.title}
                          {year && <span className="text-slate-400 font-normal text-sm">({year})</span>}
                        </h2>
                      </div>

                      {/* Desktop Watchlist & Share */}
                      <div className="hidden md:flex items-center gap-2">
                        <button
                          onClick={() => toggleWatchlist(movie)}
                          className={`p-2.5 rounded-xl border transition-colors cursor-pointer ${
                            inWatchlist
                              ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-hover)] border-[var(--border-focus)]'
                              : 'bg-[var(--bg-surface-elevated)] text-slate-400 border-[var(--border-subtle)] hover:text-white'
                          }`}
                          title={inWatchlist ? 'Remove from Watchlist' : 'Add to Watchlist'}
                        >
                          {inWatchlist ? <BookmarkCheck className="w-5 h-5 text-[var(--accent-hover)]" /> : <Bookmark className="w-5 h-5" />}
                        </button>

                        <ShareButton
                          movie={movie}
                          variant="icon"
                          iconSize="w-5 h-5"
                          className="p-2.5 rounded-xl bg-[var(--bg-surface-elevated)] text-slate-400 border-[var(--border-subtle)] hover:text-white"
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

                    {/* Explanation Box */}
                    <div
                      className="p-3 sm:p-3.5 rounded-xl flex items-start gap-2.5 border border-[var(--border-subtle)] border-l-2 border-l-[var(--accent-primary)] bg-[var(--bg-surface-elevated)]/90"
                    >
                      <Sparkles
                        className="w-4 h-4 shrink-0 mt-0.5 text-[var(--accent-primary)]"
                        aria-hidden={true}
                      />
                      <div className="text-xs leading-relaxed text-slate-200">
                        <span className="font-semibold text-white">
                          Why this one:{' '}
                        </span>
                        {reason}
                      </div>
                    </div>
                  </div>

                  {/* Rating Strip at the bottom of the card */}
                  <div className="pt-2 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div
                      ref={(el) => {
                        if (el) {
                          ratingContainerRefs.current[movie.id] = el;
                        } else {
                          delete ratingContainerRefs.current[movie.id];
                        }
                      }}
                      className={`w-full sm:max-w-md ${
                        isSeenPromptOpen
                          ? 'p-3 rounded-xl bg-[var(--bg-surface-elevated)] border border-[var(--border-focus)]'
                          : ''
                      }`}
                    >
                      {isSeenPromptOpen && (
                        <p className="text-xs font-semibold text-slate-200 mb-1.5">
                          Already seen it? Rate it below to sharpen your picks, or skip.
                        </p>
                      )}

                      <div role="status" aria-live="polite">
                        {isPendingRemoval && ratedScore !== undefined && (
                          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-white bg-[var(--bg-surface-elevated)] px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)]">
                            <span className="font-bold flex items-center gap-1.5 text-[var(--accent-secondary)]">
                              Rated {ratedScore}/10, moved to My Ratings
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUndoRating(movie.id)}
                              aria-label={`Undo rating for ${displayTitle}`}
                              className="shrink-0 px-2 py-0.5 rounded-md font-bold text-[var(--accent-primary)] hover:text-[var(--accent-hover)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors cursor-pointer focus-ring"
                            >
                              Undo
                            </button>
                          </div>
                        )}
                      </div>

                      <RatingControl
                        currentRating={ratedScore}
                        onRate={(val) => handleRateRecommendedMovie(movie, val)}
                        onClear={() => handleClearRecommendedMovie(movie.id)}
                        compact={true}
                      />

                      {isSeenPromptOpen && (
                        <div className="flex justify-end pt-1 mt-1.5">
                          <button
                            type="button"
                            onClick={() => handleHideFilm(movie.id, 'seen', displayTitle)}
                            className="text-xs font-semibold text-slate-300 hover:text-white px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] transition-colors cursor-pointer focus-ring"
                          >
                            Skip
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 self-end sm:self-center">
                      <button
                        ref={(el) => {
                          if (el) {
                            seenButtonsRef.current[movie.id] = el;
                          } else {
                            delete seenButtonsRef.current[movie.id];
                          }
                        }}
                        data-movie-id={movie.id}
                        type="button"
                        aria-expanded={isSeenPromptOpen}
                        onClick={() => handleToggleSeenPrompt(movie.id)}
                        aria-label={`Seen it: ${displayTitle}`}
                        className={`text-xs transition-colors cursor-pointer focus-ring rounded px-1.5 py-2 sm:py-0.5 ${
                          isSeenPromptOpen
                            ? 'text-white font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Seen it
                      </button>
                      <button
                        type="button"
                        onClick={() => handleHideFilm(movie.id, 'not_for_me', displayTitle)}
                        aria-label={`Not for me: ${displayTitle}`}
                        className="text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer focus-ring rounded px-1.5 py-2 sm:py-0.5"
                      >
                        Not for me
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedMovieForModal(movie)}
                        className="text-xs text-[var(--accent-primary)] hover:text-[var(--accent-hover)] hover:underline font-bold transition-colors cursor-pointer focus-ring rounded px-1.5 py-0.5"
                      >
                        Trailer & Details
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}

      {!isGeneratingRecs && visibleRecommendations.length > 0 && (
        <div className="pt-4 flex flex-col items-center gap-3">
          {loadMoreStatus === 'error' && (
            <p role="alert" className="text-xs text-amber-200 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden={true} />
              <span>Couldn't load more recommendations right now.</span>
            </p>
          )}
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isLoadingMore || loadMoreStatus === 'loading' || loadMoreStatus === 'exhausted'}
            aria-busy={isLoadingMore || loadMoreStatus === 'loading'}
            className="btn-tactile btn-tactile-secondary px-6 py-3 text-sm font-bold focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {(isLoadingMore || loadMoreStatus === 'loading') && (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden={true} />
            )}
            <span>
              {isLoadingMore || loadMoreStatus === 'loading'
                ? 'Loading more...'
                : loadMoreStatus === 'exhausted'
                ? 'No more right now'
                : loadMoreStatus === 'error'
                ? 'Try again'
                : 'Show more'}
            </span>
          </button>
          <p className="sr-only" role="status" aria-live="polite">
            {isLoadingMore || loadMoreStatus === 'loading'
              ? 'Loading more recommendations'
              : loadMoreStatus === 'exhausted'
              ? 'There are no more recommendations right now'
              : ''}
          </p>
        </div>
      )}
    </div>
  );
};
