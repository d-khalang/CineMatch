import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Upload, FileText, CheckCircle, Loader2, AlertCircle, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { UserRating } from '../types';
import { searchMovies, findMovieByExternalId } from '../services/tmdb';
import { credentialStore } from '../services/credentialStore';
import { parseMovieCsv, CsvParseResult, ParsedCsvMovie } from '../services/csvService';
import { titlesMatch } from '../services/titleMatcher';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ImportPhase = 'select' | 'resolving' | 'review' | 'committed';

const IMDB_ID_REGEX = /^tt\d{7,10}$/;

export const CsvImportModal: React.FC<CsvImportModalProps> = ({ isOpen, onClose }) => {
  const { importRatingsList, replaceRatingsList, generateRankings, ratings } = useMovieStore();
  const [parseResult, setParseResult] = useState<CsvParseResult | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [importPhase, setImportPhase] = useState<ImportPhase>('select');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Two-phase state: resolved results held for user review before committing
  const [pendingRatings, setPendingRatings] = useState<UserRating[]>([]);
  const [unresolvedItems, setUnresolvedItems] = useState<{ title: string; year?: string; reason: string }[]>([]);

  // Cancellation: abort in-flight lookups on close/reset and invalidate stale commits
  const abortControllerRef = useRef<AbortController | null>(null);
  const operationVersionRef = useRef<number>(0);

  // Cancel any in-flight import when the modal closes or component unmounts
  const cancelImport = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    operationVersionRef.current++;
  }, []);

  // On close: cancel any pending import, then call parent onClose
  const handleClose = useCallback(() => {
    cancelImport();
    onClose();
  }, [cancelImport, onClose]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelImport();
    };
  }, [cancelImport]);

  if (!isOpen) return null;

  const resetState = () => {
    cancelImport();
    setParseResult(null);
    setIsProcessing(false);
    setStatusMessage(null);
    setImportPhase('select');
    setErrorMessage(null);
    setPendingRatings([]);
    setUnresolvedItems([]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    setParseResult(null);
    setPendingRatings([]);
    setUnresolvedItems([]);
    setImportPhase('select');

    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.size > 2 * 1024 * 1024) {
        setErrorMessage('File exceeds the maximum 2 MB limit. Please select a smaller export file.');
        return;
      }

      try {
        const text = await selectedFile.text();
        const result = parseMovieCsv(text);
        if (result.accepted.length === 0) {
          setErrorMessage('Could not find any valid movie rating rows in this CSV.');
        } else {
          setParseResult(result);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to parse CSV file';
        setErrorMessage(msg);
      }
    }
  };

  /**
   * Phase 1: Resolve movies via TMDB. Results are stored as pending, NOT committed.
   * Uses AbortController for cancellation and operation versioning to invalidate stale results.
   */
  const resolveImport = async () => {
    if (!parseResult || parseResult.accepted.length === 0) return;

    // Cancel any previous in-flight resolution
    cancelImport();

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const thisOperationVersion = ++operationVersionRef.current;

    setIsProcessing(true);
    setImportPhase('resolving');
    setErrorMessage(null);
    setStatusMessage('Matching films with TMDB database...');
    setPendingRatings([]);
    setUnresolvedItems([]);

    try {
      const hasTmdb = credentialStore.hasTmdb();
      const importedRatings: UserRating[] = [];
      const unresolved: { title: string; year?: string; reason: string }[] = [];
      const moviesToProcess = parseResult.accepted;

      // Run bounded parallel searches (chunks of 4) to avoid TMDB 429
      const chunkSize = 4;
      for (let i = 0; i < moviesToProcess.length; i += chunkSize) {
        // Check cancellation between chunks
        if (controller.signal.aborted || operationVersionRef.current !== thisOperationVersion) {
          return;
        }

        const chunk = moviesToProcess.slice(i, i + chunkSize);
        setStatusMessage(
          `Matching films ${i + 1} to ${Math.min(i + chunkSize, moviesToProcess.length)} of ${
            moviesToProcess.length
          }...`
        );

        await Promise.all(
          chunk.map(async (item: ParsedCsvMovie) => {
            if (controller.signal.aborted) return;

            // Case 1: CineMatch CSV export already preserves TMDB_ID
            if (item.tmdbId && item.tmdbId > 0) {
              importedRatings.push({
                movieId: item.tmdbId,
                title: item.title,
                rating: item.rating,
                posterPath: null,
                year: item.year,
                genres: item.genres || [],
                director: item.director,
                ratedAt: Date.now(),
              });
              return;
            }

            // Case 2: Resolve via IMDb external ID if available (stable identifier)
            if (hasTmdb && item.sourceId && IMDB_ID_REGEX.test(item.sourceId)) {
              try {
                const found = await findMovieByExternalId(item.sourceId, 'imdb_id', controller.signal);
                if (controller.signal.aborted) return;
                if (found) {
                  importedRatings.push({
                    movieId: found.id,
                    title: found.title,
                    rating: item.rating,
                    posterPath: found.poster_path,
                    year: found.release_date ? found.release_date.slice(0, 4) : item.year,
                    genres: (found.genres || []).map((g) => g.name),
                    director: item.director,
                    ratedAt: Date.now(),
                  });
                  return;
                }
                // IMDb ID lookup returned nothing — fall through to search
              } catch {
                if (controller.signal.aborted) return;
                // Fall through to search
              }
            }

            // Case 3: Resolve via TMDB search with title verification
            if (hasTmdb) {
              try {
                const searchRes = await searchMovies(item.title, 1, controller.signal);
                if (controller.signal.aborted) return;

                if (searchRes.movies.length > 0) {
                  let match = null;
                  if (item.year) {
                    const parsedYear = parseInt(item.year, 10);
                    // Match requires both year proximity AND title similarity.
                    // If multiple candidates qualify, treat as ambiguous.
                    const candidates = searchRes.movies.filter((m) => {
                      if (!m.release_date) return false;
                      const mYear = parseInt(m.release_date.slice(0, 4), 10);
                      if (isNaN(mYear) || Math.abs(mYear - parsedYear) > 1) return false;
                      return titlesMatch(item.title, m.title);
                    });
                    match = candidates.length === 1 ? candidates[0] : null;
                  } else {
                    // No year specified: check for exact title matches across candidates
                    const exactMatches = searchRes.movies.filter(
                      (m) => m.title.toLowerCase() === item.title.toLowerCase()
                    );
                    if (exactMatches.length === 1) {
                      match = exactMatches[0];
                    } else if (exactMatches.length === 0) {
                      // No exact matches: check if exactly one candidate has high title similarity
                      const similarCandidates = searchRes.movies.filter((m) =>
                        titlesMatch(item.title, m.title)
                      );
                      if (similarCandidates.length === 1) {
                        match = similarCandidates[0];
                      }
                      // 0 or >1 similar candidates: ambiguous, leave unresolved (match remains null)
                    }
                    // Multiple exact matches (e.g. remakes without year): ambiguous, leave unresolved (match remains null)
                  }

                  if (match) {
                    importedRatings.push({
                      movieId: match.id,
                      title: match.title,
                      rating: item.rating,
                      posterPath: match.poster_path,
                      year: match.release_date ? match.release_date.slice(0, 4) : item.year,
                      genres: (match.genres || []).map((g) => g.name),
                      director: item.director,
                      ratedAt: Date.now(),
                    });
                    return;
                  }
                }
                // No verified match
                unresolved.push({
                  title: item.title,
                  year: item.year,
                  reason: item.year
                    ? `No verified TMDB match with matching title released around ${item.year}`
                    : 'Ambiguous or unverified TMDB title match',
                });
                return;
              } catch {
                if (controller.signal.aborted) return;
                unresolved.push({
                  title: item.title,
                  year: item.year,
                  reason: 'TMDB network lookup failed',
                });
                return;
              }
            }

            // Case 4: No TMDB credentials and no TMDB_ID provided
            unresolved.push({
              title: item.title,
              year: item.year,
              reason: 'TMDB credential required to resolve external film titles',
            });
          })
        );
      }

      // Final cancellation/staleness check before updating state
      if (controller.signal.aborted || operationVersionRef.current !== thisOperationVersion) {
        return;
      }

      setUnresolvedItems(unresolved);
      setPendingRatings(importedRatings);

      if (importedRatings.length === 0) {
        setImportPhase('select');
        setErrorMessage(
          `None of the ${moviesToProcess.length} films could be verified. ` +
          (unresolved.length > 0 ? `(${unresolved[0].reason})` : '')
        );
      } else {
        // Move to review phase — results are shown but NOT committed yet
        setImportPhase('review');
        setStatusMessage(
          `Resolution complete: ${importedRatings.length} matched, ${unresolved.length} unresolved, ${parseResult.rejected.length} skipped. Review results below and confirm.`
        );
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      if (operationVersionRef.current !== thisOperationVersion) return;
      const msg = err instanceof Error ? err.message : 'Import failed';
      setErrorMessage(msg);
      setImportPhase('select');
    } finally {
      if (operationVersionRef.current === thisOperationVersion) {
        setIsProcessing(false);
      }
    }
  };

  /**
   * Phase 2: User has reviewed the results and explicitly confirms the commit.
   * Only runs if the operation version is still current (not cancelled or superseded).
   */
  const confirmImport = () => {
    if (pendingRatings.length === 0) return;

    // Final staleness check
    const currentVersion = operationVersionRef.current;

    if (importMode === 'replace') {
      replaceRatingsList(pendingRatings);
    } else {
      const merged = Object.values(ratings);
      const existingMap = new Map(merged.map((r) => [r.movieId, r]));
      pendingRatings.forEach((r) => existingMap.set(r.movieId, r));
      importRatingsList(Array.from(existingMap.values()));
    }

    // Verify the commit wasn't superseded during synchronous execution
    if (operationVersionRef.current !== currentVersion) return;

    setImportPhase('committed');
    setStatusMessage(
      `Import complete: ${pendingRatings.length} imported, ${unresolvedItems.length} unresolved, ${parseResult?.rejected.length || 0} skipped.`
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-xl max-h-[90dvh] flex flex-col rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden p-6 sm:p-8 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
                Import Movie Ratings
              </h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Import from IMDb or Letterboxd CSV exports (Max 2 MB)
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto space-y-4 flex-1 pr-1">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {!parseResult && (
            <div className="border-2 border-dashed border-[var(--border-subtle)] rounded-2xl p-8 text-center space-y-3 hover:border-[var(--accent-primary)]/50 transition-colors">
              <FileText className="w-10 h-10 mx-auto text-[var(--text-secondary)]" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  Select your exported CSV file
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Supports ratings from IMDb (ratings.csv) and Letterboxd (ratings.csv)
                </p>
              </div>
              <label className="inline-block px-4 py-2 rounded-xl bg-[var(--surface-hover)] text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--border-subtle)] cursor-pointer transition-colors">
                Browse Files
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          )}

          {/* Import Preview */}
          {parseResult && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[var(--surface-hover)] border border-[var(--border-subtle)] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-primary)]">
                    Detected Format:{' '}
                    <span className="capitalize text-[var(--accent-primary)]">
                      {parseResult.format}
                    </span>
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {parseResult.accepted.length} films ready
                  </span>
                </div>

                {parseResult.rejected.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      {parseResult.rejected.length} row(s) had missing titles or invalid ratings and will be skipped.
                    </span>
                  </div>
                )}

                {/* Sample preview */}
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {parseResult.accepted.slice(0, 5).map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-black/20"
                    >
                      <span className="truncate max-w-[280px] font-medium text-[var(--text-primary)]">
                        {item.title} {item.year ? `(${item.year})` : ''}
                      </span>
                      <span className="font-bold text-[var(--accent-primary)] shrink-0">
                        {item.rating}/10
                      </span>
                    </div>
                  ))}
                  {parseResult.accepted.length > 5 && (
                    <p className="text-[11px] text-center text-[var(--text-secondary)] pt-1">
                      ...and {parseResult.accepted.length - 5} more films
                    </p>
                  )}
                </div>
              </div>

              {/* Mode Selection — only before resolution or during review */}
              {(importPhase === 'select' || importPhase === 'review') && (
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-[var(--text-secondary)]">
                    Import Action:
                  </label>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setImportMode('merge')}
                      disabled={importPhase === 'review'}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        importMode === 'merge'
                          ? 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)] text-[var(--text-primary)]'
                          : 'bg-[var(--surface-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
                      } disabled:opacity-60`}
                    >
                      <span className="font-semibold block text-[var(--text-primary)]">Merge</span>
                      Keep existing ratings and update/add imported films.
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportMode('replace')}
                      disabled={importPhase === 'review'}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        importMode === 'replace'
                          ? 'bg-[var(--accent-primary)]/10 border-[var(--accent-primary)] text-[var(--text-primary)]'
                          : 'bg-[var(--surface-hover)] border-[var(--border-subtle)] text-[var(--text-secondary)]'
                      } disabled:opacity-60`}
                    >
                      <span className="font-semibold block text-[var(--text-primary)]">Replace</span>
                      Replace all currently stored ratings with this file.
                    </button>
                  </div>
                </div>
              )}

              {statusMessage && (
                <div className="text-xs text-[var(--accent-primary)] flex items-center gap-2">
                  {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{statusMessage}</span>
                </div>
              )}

              {/* Review phase: show resolution results summary */}
              {importPhase === 'review' && pendingRatings.length > 0 && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>{pendingRatings.length} film(s) verified and ready to {importMode}</span>
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                    {pendingRatings.slice(0, 5).map((r, idx) => (
                      <div key={idx} className="text-[11px] text-emerald-200/80 truncate">
                        ✓ {r.title} {r.year ? `(${r.year})` : ''} — {r.rating}/10
                      </div>
                    ))}
                    {pendingRatings.length > 5 && (
                      <div className="text-[10px] text-emerald-200/60 pt-0.5">
                        ...and {pendingRatings.length - 5} more verified films
                      </div>
                    )}
                  </div>
                  {importMode === 'replace' && (
                    <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] flex items-start gap-1.5 mt-1">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        Replace mode will remove your existing {Object.keys(ratings).length} rating(s) and keep only the {pendingRatings.length} matched film(s).
                      </span>
                    </div>
                  )}
                </div>
              )}

              {unresolvedItems.length > 0 && (
                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs space-y-1.5 max-h-32 overflow-y-auto">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{unresolvedItems.length} film(s) could not be matched:</span>
                  </div>
                  {unresolvedItems.slice(0, 10).map((u, idx) => (
                    <div key={idx} className="text-[11px] text-amber-200/80 truncate">
                      • {u.title} {u.year ? `(${u.year})` : ''}: {u.reason}
                    </div>
                  ))}
                  {unresolvedItems.length > 10 && (
                    <div className="text-[10px] text-amber-200/60 pt-0.5">
                      ...and {unresolvedItems.length - 10} more unresolved films
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-[var(--border-subtle)]">
          <button
            onClick={handleClose}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            Cancel
          </button>

          {/* Phase 1 button: Start resolution (not commit) */}
          {parseResult && importPhase === 'select' && (
            <button
              onClick={resolveImport}
              disabled={isProcessing}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent-primary)] hover:brightness-110 text-black font-semibold text-xs transition-all disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Resolving...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Start Import ({parseResult.accepted.length} Films)
                </>
              )}
            </button>
          )}

          {/* Resolving phase: show spinner */}
          {importPhase === 'resolving' && (
            <button
              disabled
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent-primary)] text-black font-semibold text-xs opacity-50"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Matching...
            </button>
          )}

          {/* Phase 2 buttons: Review → Confirm or go back */}
          {importPhase === 'review' && pendingRatings.length > 0 && (
            <>
              <button
                onClick={resetState}
                className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                Start Over
              </button>
              <button
                onClick={confirmImport}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent-primary)] hover:brightness-110 text-black font-semibold text-xs transition-all"
              >
                <CheckCircle className="w-4 h-4" />
                Confirm Import ({pendingRatings.length} Films)
              </button>
            </>
          )}

          {/* Phase 3: Committed — offer recalibration */}
          {importPhase === 'committed' && (
            <button
              onClick={() => {
                handleClose();
                generateRankings().catch(() => {});
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--accent-primary)] hover:brightness-110 text-black font-semibold text-xs transition-all"
            >
              <CheckCircle className="w-4 h-4" />
              Done — Recalibrate AI Recommendations
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
