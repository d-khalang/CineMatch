import React, { useState } from 'react';
import {
  Film,
  Search,
  Download,
  Upload,
  BarChart3,
  TrendingUp,
  User,
  Trash2,
  Bookmark,
} from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { IMAGE_BASE_URL } from '../services/tmdb';
import { RatingControl } from './RatingControl';
import { ShareButton } from './ShareButton';
import { generateRatingsCsv } from '../services/csvService';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

interface MyRatingsProps {
  onOpenCsvModal: () => void;
}

export const MyRatings: React.FC<MyRatingsProps> = ({ onOpenCsvModal }) => {
  const { ratings, watchlist, setRating, removeRating, tasteStats, setSelectedMovieForModal, setActiveTab, clearAllData, showToast } = useMovieStore();
  const [filterTier, setFilterTier] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'recent' | 'rating-desc' | 'rating-asc'>('recent');

  const ratingsList = Object.values(ratings);

  // Filter and Sort
  const filteredRatings = ratingsList.filter((item) => {
    // Search
    if (searchQuery.trim() && !item.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }

    // Tier
    if (filterTier === 'masterpieces') return item.rating >= 9;
    if (filterTier === 'great') return item.rating >= 7 && item.rating < 9;
    if (filterTier === 'decent') return item.rating >= 5 && item.rating < 7;
    if (filterTier === 'disliked') return item.rating <= 4;
    return true;
  });

  filteredRatings.sort((a, b) => {
    if (sortBy === 'rating-desc') return b.rating - a.rating;
    if (sortBy === 'rating-asc') return a.rating - b.rating;
    return b.ratedAt - a.ratedAt; // recent
  });

  const exportRatingsToCsv = async () => {
    if (ratingsList.length === 0) return;
    const csvContent = generateRatingsCsv(ratings);

    if (Capacitor.isNativePlatform()) {
      const fileName = `cinematch_ratings_${new Date().toISOString().slice(0, 10)}.csv`;
      let fileUri: string | null = null;
      try {
        const writeResult = await Filesystem.writeFile({
          path: fileName,
          data: csvContent,
          directory: Directory.Cache,
          encoding: Encoding.UTF8,
        });
        fileUri = writeResult.uri;
        await Share.share({
          title: 'CineMatch Ratings Export',
          url: fileUri,
          dialogTitle: 'Export CineMatch Ratings CSV',
        });
        showToast('Ratings exported successfully!');
      } catch {
        // User cancelled, dismissed share sheet, or operation was interrupted.
        // Do NOT fall through to web download on native platforms!
      } finally {
        if (fileUri) {
          try {
            await Filesystem.deleteFile({
              path: fileName,
              directory: Directory.Cache,
            });
          } catch {
            // Non-fatal cache cleanup
          }
        }
      }
      return;
    }

    // Web download fallback
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `cinematch_ratings_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Ratings CSV downloaded!');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-24 space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Film className="w-6 h-6 text-[var(--accent-primary)]" />
            <h1 className="font-heading text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              My Movie Library & Ratings
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {ratingsList.length} total rated movies shaping your recommendation algorithm
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('watchlist')}
            className="btn-tactile btn-tactile-secondary px-3.5 py-1.5 text-xs font-semibold"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Watchlist ({watchlist.length})
          </button>
          <button
            onClick={onOpenCsvModal}
            className="btn-tactile btn-tactile-secondary px-3.5 py-1.5 text-xs font-semibold"
          >
            <Upload className="w-3.5 h-3.5 text-[var(--accent-secondary)]" />
            Import CSV
          </button>
          <button
            onClick={exportRatingsToCsv}
            disabled={ratingsList.length === 0}
            className="btn-tactile btn-tactile-secondary px-3.5 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Analytics & Taste Stats Cards */}
      {ratingsList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Average & Total */}
          <div className="glass-panel p-5 rounded-2xl border border-[var(--border-subtle)] space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-[var(--accent-secondary)]" /> Rating Stats
            </span>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-black text-white">{tasteStats.averageRating}</span>
              <span className="text-xs text-slate-400">/ 10 Average across {tasteStats.totalRated} films</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed pt-1 border-t border-[var(--border-subtle)]">
              {tasteStats.tasteVectorSummary}
            </p>
          </div>

          {/* Top Genres */}
          <div className="glass-panel p-5 rounded-2xl border border-[var(--border-subtle)] space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-[var(--accent-secondary)]" /> Favorite Genres
            </span>
            <div className="space-y-1.5 pt-1">
              {tasteStats.topGenres.length === 0 ? (
                <p className="text-xs text-slate-500">Rate more movies to compute genre affinity</p>
              ) : (
                tasteStats.topGenres.slice(0, 3).map((g) => (
                  <div key={g.genre} className="flex items-center justify-between text-xs">
                    <span className="text-slate-200 font-medium">{g.genre}</span>
                    <span className="text-[var(--accent-primary)] font-bold">
                      {g.count} films ({g.avgRating}★)
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Top Directors */}
          <div className="glass-panel p-5 rounded-2xl border border-[var(--border-subtle)] space-y-2">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-[var(--accent-primary)]" /> Favorite Directors
            </span>
            <div className="space-y-1.5 pt-1">
              {tasteStats.topDirectors.length === 0 ? (
                <p className="text-xs text-slate-500">Rate more movies to uncover director synergies</p>
              ) : (
                tasteStats.topDirectors.slice(0, 3).map((d) => (
                  <div key={d.director} className="flex items-center justify-between text-xs">
                    <span className="text-slate-200 font-medium">{d.director}</span>
                    <span className="text-[var(--accent-secondary)] font-bold">
                      {d.count} films ({d.avgRating}★)
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filter and Sort Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-4 rounded-2xl border border-[var(--border-subtle)]">
        {/* Tier Buttons */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {[
            { id: 'all', label: `All (${ratingsList.length})` },
            { id: 'masterpieces', label: 'Masterpieces (9–10★)' },
            { id: 'great', label: 'Great (7–8★)' },
            { id: 'decent', label: 'Decent (5–6★)' },
            { id: 'disliked', label: 'Disliked (1–4★)' },
          ].map((tier) => (
            <button
              key={tier.id}
              onClick={() => setFilterTier(tier.id)}
              className={`btn-tactile text-xs px-3 py-1.5 whitespace-nowrap transition-all border cursor-pointer ${
                filterTier === tier.id
                  ? 'btn-tactile-primary font-bold shadow-md'
                  : 'btn-tactile-secondary'
              }`}
            >
              {tier.label}
            </button>
          ))}

          <button
            onClick={() => setActiveTab('watchlist')}
            className="btn-tactile btn-tactile-secondary text-xs px-3 py-1.5 whitespace-nowrap transition-all border cursor-pointer flex items-center gap-1.5 ml-1"
          >
            <Bookmark className="w-3.5 h-3.5" />
            Watchlist ({watchlist.length})
          </button>
        </div>

        {/* Search & Sort */}
        <div className="flex items-center gap-3">
          <div className="relative flex-grow sm:w-56">
            <input
              type="text"
              placeholder="Search rated films..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-slate-200 focus:outline-none focus:border-[var(--border-focus)]"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          </div>

          <select
            value={sortBy}
            onChange={(e: any) => setSortBy(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs text-slate-300 focus:outline-none focus:border-[var(--border-focus)] cursor-pointer"
          >
            <option value="recent">Recently Rated</option>
            <option value="rating-desc">Highest Rating</option>
            <option value="rating-asc">Lowest Rating</option>
          </select>
        </div>
      </div>

      {/* Ratings Grid */}
      {ratingsList.length === 0 ? (
        <div className="text-center py-16 glass-panel rounded-2xl p-8 space-y-4 border border-[var(--border-subtle)]">
          <p className="text-slate-400 text-sm">You have not rated any movies yet.</p>
          <button
            onClick={() => setActiveTab('calibration')}
            className="btn-tactile btn-tactile-primary px-5 py-2.5 text-xs font-bold shadow-lg"
          >
            Start in Taste Calibration
          </button>
        </div>
      ) : filteredRatings.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-xs">
          No ratings match your filter.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-6">
          {filteredRatings.map((item) => {
            const posterUrl = item.posterPath ? `${IMAGE_BASE_URL}${item.posterPath}` : null;
            return (
              <div
                key={item.movieId}
                className="group relative flex flex-col rounded-2xl overflow-hidden glass-panel glass-panel-hover border border-[var(--border-subtle)]"
              >
                {/* Poster Box */}
                <div
                  onClick={() =>
                    setSelectedMovieForModal({
                      id: item.movieId,
                      title: item.title,
                      overview: '',
                      poster_path: item.posterPath,
                      backdrop_path: null,
                      release_date: item.year ? `${item.year}-01-01` : '',
                      vote_average: item.rating,
                      vote_count: 0,
                      director: item.director,
                    })
                  }
                  className="relative aspect-[2/3] w-full bg-[var(--bg-canvas)] overflow-hidden cursor-pointer"
                >
                  {posterUrl ? (
                    <img
                      src={posterUrl}
                      alt={item.title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center p-2 text-center text-xs text-slate-500">
                      No Poster
                    </div>
                  )}

                  {/* Top Left: Rating Badge */}
                  <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
                    <div className="px-2 py-0.5 rounded-md bg-[var(--bg-surface)]/90 backdrop-blur-md text-[11px] font-bold text-amber-400 border border-[var(--border-subtle)] shadow-md">
                      ★ {item.rating}/10
                    </div>
                  </div>

                  {/* Top Right: Share Button */}
                  <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
                    <ShareButton
                      movie={{
                        id: item.movieId,
                        title: item.title,
                        overview: '',
                        poster_path: item.posterPath,
                        backdrop_path: null,
                        release_date: item.year ? `${item.year}-01-01` : '',
                        vote_average: item.rating,
                        vote_count: 0,
                        director: item.director,
                      }}
                      variant="icon"
                      iconSize="w-3.5 h-3.5"
                      className="opacity-90 sm:opacity-0 sm:group-hover:opacity-100 bg-[var(--bg-surface)]/90 border border-[var(--border-subtle)]"
                    />
                  </div>
                </div>

                {/* Content Box */}
                <div className="p-3 flex flex-col flex-grow justify-between gap-2 card-content-box">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white line-clamp-1 group-hover:text-[var(--accent-secondary)] transition-colors">
                      {item.title}
                    </h3>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                      {item.year && <span>{item.year}</span>}
                      {item.director && (
                        <>
                          <span>•</span>
                          <span className="line-clamp-1">{item.director}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Rating Control */}
                  <div className="pt-1 border-t border-[var(--border-subtle)]">
                    <RatingControl
                      currentRating={item.rating}
                      onRate={(newScore) =>
                        setRating(
                          {
                            id: item.movieId,
                            title: item.title,
                            overview: '',
                            poster_path: item.posterPath,
                            backdrop_path: null,
                            release_date: item.year ? `${item.year}-01-01` : '',
                            vote_average: 0,
                            vote_count: 0,
                            director: item.director,
                          },
                          newScore
                        )
                      }
                      onClear={() => removeRating(item.movieId)}
                      compact={true}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Danger Zone: Clear Data */}
      {ratingsList.length > 0 && (
        <div className="pt-10 flex justify-end">
          <button
            onClick={() => {
              if (window.confirm('Are you sure you want to reset all ratings and start fresh?')) {
                clearAllData();
              }
            }}
            className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-900/30 hover:bg-rose-950/20 transition-all cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear All Saved Ratings & Reset
          </button>
        </div>
      )}
    </div>
  );
};
