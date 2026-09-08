import React, { useState } from 'react';
import { X, Upload, FileText, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { useMovieStore } from '../store/useMovieStore';
import { UserRating } from '../types';
import { searchMovies } from '../services/tmdb';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({ isOpen, onClose }) => {
  const { importRatingsList, generateRankings } = useMovieStore();
  const [file, setFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState<number>(0);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setStatusMessage(null);
    }
  };

  const processCsv = async () => {
    if (!file) return;
    setIsProcessing(true);
    setStatusMessage('Reading CSV data...');

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

      if (lines.length < 2) {
        throw new Error('CSV file appears to be empty or missing data rows.');
      }

      const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim().toLowerCase());
      
      // Look for IMDb or Letterboxd column headers
      const titleIdx = headers.findIndex((h) => h === 'title' || h === 'name' || h === 'film title');
      const ratingIdx = headers.findIndex(
        (h) => h === 'your rating' || h === 'rating' || h === 'letterboxd rating' || h === 'user rating'
      );
      const yearIdx = headers.findIndex((h) => h === 'year' || h === 'release date');

      if (titleIdx === -1 || ratingIdx === -1) {
        throw new Error('Could not find Title or Rating columns in the CSV. Please ensure you exported from IMDb or Letterboxd.');
      }

      setStatusMessage(`Found ${lines.length - 1} rows. Matching films with TMDB...`);

      const importedRatings: UserRating[] = [];
      const dataRows = lines.slice(1);

      // Process first 25-30 movies to prevent overwhelming TMDB rate limits
      const sampleRows = dataRows.slice(0, 30);

      for (let i = 0; i < sampleRows.length; i++) {
        const row = sampleRows[i];
        // Parse CSV row with simple quote handling
        const cols = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || row.split(',');
        const title = (cols[titleIdx] || '').replace(/"/g, '').trim();
        let rawRating = parseFloat((cols[ratingIdx] || '').replace(/"/g, '').trim());

        if (!title || isNaN(rawRating)) continue;

        // If Letterboxd 1-5 scale, convert to 1-10
        if (rawRating <= 5 && rawRating > 0) {
          rawRating = Math.round(rawRating * 2);
        }

        try {
          const searchResult = await searchMovies(title);
          if (searchResult.movies.length > 0) {
            const bestMatch = searchResult.movies[0];
            importedRatings.push({
              movieId: bestMatch.id,
              title: bestMatch.title,
              rating: Math.min(10, Math.max(1, Math.round(rawRating))),
              posterPath: bestMatch.poster_path,
              year: bestMatch.release_date ? bestMatch.release_date.slice(0, 4) : undefined,
              genres: (bestMatch.genres || []).map((g) => g.name),
              ratedAt: Date.now(),
            });
          }
        } catch {
          // ignore single match failures
        }
      }

      if (importedRatings.length === 0) {
        throw new Error('No movies could be matched against TMDB.');
      }

      importRatingsList(importedRatings);
      setImportedCount(importedRatings.length);
      setStatusMessage(`Successfully imported ${importedRatings.length} movie ratings!`);
      generateRankings();
    } catch (err: any) {
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--bg-canvas)]/85 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden p-6 sm:p-8 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-full palette-tag-secondary">
              <Upload className="w-5 h-5 text-[var(--accent-secondary)]" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Import Movie Ratings CSV</h2>
              <p className="text-xs text-slate-400">Optional: Import your exported IMDb or Letterboxd ratings</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload Zone */}
        <div className="border-2 border-dashed border-[var(--border-subtle)] hover:border-[var(--border-focus)] rounded-2xl p-6 text-center space-y-3 transition-colors bg-[var(--bg-surface-elevated)]">
          <FileText className="w-10 h-10 text-[var(--accent-secondary)] mx-auto opacity-70" />
          <div className="space-y-1">
            <p className="text-xs text-slate-200 font-semibold">
              {file ? file.name : 'Upload ratings.csv exported from IMDb or Letterboxd'}
            </p>
            <p className="text-[11px] text-slate-400">Supports standard CSV files with Title and Rating columns</p>
          </div>

          <label className="btn-tactile btn-tactile-secondary inline-flex px-4 py-2 text-xs font-semibold cursor-pointer">
            Choose CSV File
            <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
          </label>
        </div>

        {/* Status Messages */}
        {statusMessage && (
          <div
            className={`p-3.5 rounded-xl text-xs flex items-center gap-2 border ${
              importedCount > 0
                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                : 'bg-[var(--bg-surface-elevated)] border-[var(--border-focus)] text-slate-200'
            }`}
          >
            {importedCount > 0 ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-[var(--accent-primary)] shrink-0" />
            )}
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={onClose}
            className="btn-tactile btn-tactile-secondary px-4 py-2 text-xs font-semibold"
          >
            Close
          </button>
          <button
            type="button"
            onClick={processCsv}
            disabled={!file || isProcessing}
            className="btn-tactile btn-tactile-primary px-5 py-2 text-xs font-bold shadow-lg disabled:opacity-50 flex items-center gap-1.5"
          >
            {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isProcessing ? 'Importing Ratings...' : 'Import Ratings'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
