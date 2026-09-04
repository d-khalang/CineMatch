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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden p-6 sm:p-8 space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Import Movie Ratings CSV</h2>
              <p className="text-xs text-slate-400">Optional: Import your exported IMDb or Letterboxd ratings</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Upload Zone */}
        <div className="border-2 border-dashed border-slate-700 hover:border-indigo-500 rounded-2xl p-6 text-center space-y-3 transition-colors bg-slate-950/40">
          <FileText className="w-10 h-10 text-slate-500 mx-auto" />
          <div className="space-y-1">
            <p className="text-xs text-slate-300 font-semibold">
              {file ? file.name : 'Upload ratings.csv exported from IMDb or Letterboxd'}
            </p>
            <p className="text-[11px] text-slate-500">Supports standard CSV files with Title and Rating columns</p>
          </div>

          <label className="inline-block px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer border border-slate-700 transition-all">
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
                : 'bg-indigo-950/40 border-indigo-800 text-indigo-200'
            }`}
          >
            {importedCount > 0 ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-indigo-400 shrink-0" />
            )}
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-slate-400 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
          <button
            type="button"
            onClick={processCsv}
            disabled={!file || isProcessing}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-950 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isProcessing ? 'Processing & Matching...' : 'Import Ratings'}
          </button>
        </div>
      </div>
    </div>
  );
};
