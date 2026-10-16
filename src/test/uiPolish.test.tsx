import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { useEffect } from 'react';
import fs from 'fs';
import path from 'path';
import { CineMatchLogo } from '../components/CineMatchLogo';
import { Toast } from '../components/Toast';
import { PaletteSwitcher } from '../components/PaletteSwitcher';
import { Navbar } from '../components/Navbar';
import { CsvImportModal } from '../components/CsvImportModal';
import { SettingsModal } from '../components/SettingsModal';
import { MovieDetailsModal } from '../components/MovieDetailsModal';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { Watchlist } from '../components/Watchlist';
import { MyRatings } from '../components/MyRatings';
import { ShareButton } from '../components/ShareButton';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { DiscoveryFilters } from '../components/DiscoveryFilters';
import { MovieStoreProvider, useMovieStore } from '../store/useMovieStore';

const ToastTrigger: React.FC<{ message: string }> = ({ message }) => {
  const { showToast } = useMovieStore();
  useEffect(() => {
    showToast(message);
  }, [message, showToast]);
  return <Toast />;
};

const MovieDetailsTrigger: React.FC = () => {
  const { setSelectedMovieForModal } = useMovieStore();
  useEffect(() => {
    setSelectedMovieForModal({
      id: 101,
      title: 'Candidate Film A',
      overview: 'Mind-bending sci-fi thriller',
      poster_path: '/posterA.jpg',
      backdrop_path: '/backdropA.jpg',
      release_date: '2022-05-10',
      vote_average: 8.2,
      vote_count: 1500,
      genres: [{ id: 878, name: 'Sci-Fi' }],
    });
  }, [setSelectedMovieForModal]);
  return <MovieDetailsModal />;
};

describe('CIN-17 UI Polish', () => {
  it('renders CineMatchLogo without showGlow prop and confirms no glow elements remain', () => {
    const { container } = render(<CineMatchLogo className="w-8 h-8" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('w-8', 'h-8');
    expect(container.innerHTML).not.toContain('feGaussianBlur');
    expect(container.innerHTML).not.toContain('glow');
  });

  it('renders Toast with solid elevated background and shadow-lg, without backdrop-blur', () => {
    const { container } = render(
      <MovieStoreProvider>
        <ToastTrigger message="Saved successfully" />
      </MovieStoreProvider>
    );

    const toastText = screen.getByText('Saved successfully');
    expect(toastText).toBeInTheDocument();

    const toastCard = toastText.closest('div');
    expect(toastCard).toHaveClass('bg-[var(--bg-surface-elevated)]', 'shadow-lg');
    expect(toastCard?.className).not.toContain('backdrop-blur');
  });

  it('renders PaletteSwitcher Theme Studio button without shadow or redundant focus ring', () => {
    render(<PaletteSwitcher />);
    const studioButton = screen.getByRole('button', { name: /Theme Studio/i });
    expect(studioButton).toBeInTheDocument();
    expect(studioButton.className).not.toContain('shadow-');
    expect(studioButton.className).not.toContain('focus-visible:ring-2');
    expect(studioButton.className).not.toContain('focus-visible:outline-none');
  });

  it('renders Navbar buttons without redundant focus-visible ring styles', () => {
    render(
      <MovieStoreProvider>
        <Navbar onOpenSettings={() => {}} onOpenPalette={() => {}} />
      </MovieStoreProvider>
    );

    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn.className).not.toContain('focus-visible:ring-2');
      expect(btn.className).not.toContain('focus-visible:outline-none');
    });
  });

  it('ensures no undefined CSS tokens (--surface-hover, --text-primary, --text-secondary) exist in source files', () => {
    const srcDir = path.resolve(__dirname, '..');
    const getAllFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...getAllFiles(fullPath));
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
      return files;
    };

    const allFiles = getAllFiles(srcDir);
    expect(allFiles.length).toBeGreaterThan(0);

    const forbiddenTokens = [
      '--' + 'surface-hover',
      '--' + 'text-primary',
      '--' + 'text-secondary',
    ];

    for (const filePath of allFiles) {
      if (filePath.endsWith('uiPolish.test.tsx')) continue;
      const content = fs.readFileSync(filePath, 'utf-8');
      for (const token of forbiddenTokens) {
        expect(
          content,
          `File ${path.relative(srcDir, filePath)} contains undefined token "${token}"`
        ).not.toContain(token);
      }
    }
  });

  it('ensures every className with outline-none also contains a focus-visible:ring or peer-focus-visible:ring replacement', () => {
    const srcDir = path.resolve(__dirname, '..');
    const getAllFiles = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...getAllFiles(fullPath));
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
      return files;
    };

    const sourceFiles = getAllFiles(srcDir).filter(
      (f) =>
        /\.(tsx|jsx|ts|js|html|css)$/.test(f) &&
        !f.endsWith('.test.tsx') &&
        !f.endsWith('.test.ts') &&
        !f.endsWith('.spec.tsx') &&
        !f.endsWith('.spec.ts')
    );
    expect(sourceFiles.length).toBeGreaterThan(0);

    const classNameRegex = /(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)'|{`([\s\S]*?)`}|{([\s\S]*?)})/g;

    let totalOutlineNoneFound = 0;
    for (const filePath of sourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      classNameRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = classNameRegex.exec(content)) !== null) {
        const classValue = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
        if (classValue.includes('outline-none')) {
          totalOutlineNoneFound++;
          const hasReplacement =
            classValue.includes('focus-visible:ring') ||
            classValue.includes('peer-focus-visible:ring');
          expect(
            hasReplacement,
            `File ${path.relative(srcDir, filePath)} has className with "outline-none" but lacks "focus-visible:ring" or "peer-focus-visible:ring":\n${classValue}`
          ).toBe(true);
        }
      }

      // Also ensure that any line containing outline-none or focus:outline-none has a replacement
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        if (line.includes('outline-none')) {
          const hasLineOrSurroundingReplacement =
            line.includes('focus-visible:ring') ||
            line.includes('peer-focus-visible:ring') ||
            content.slice(Math.max(0, content.indexOf(line) - 300), content.indexOf(line) + line.length + 300).includes('focus-visible:ring');
          expect(
            hasLineOrSurroundingReplacement,
            `File ${path.relative(srcDir, filePath)} line ${idx + 1} has "outline-none" without a focus-visible ring replacement:\n${line}`
          ).toBe(true);
        }
      });
    }

    expect(totalOutlineNoneFound).toBeGreaterThan(0);
  });

  it('enforces single shadow tier (shadow-lg) across all modals and popovers', () => {
    // 1. CsvImportModal
    const { container: csvContainer } = render(
      <MovieStoreProvider>
        <CsvImportModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );
    const csvCard = csvContainer.querySelector('.rounded-3xl');
    expect(csvCard).toHaveClass('shadow-lg');
    expect(csvCard?.className).not.toMatch(/shadow-(?!lg\b)[a-z0-9]+/);

    // 2. SettingsModal
    const { container: settingsContainer } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );
    const settingsCard = settingsContainer.querySelector('.rounded-3xl');
    expect(settingsCard).toHaveClass('shadow-lg');
    expect(settingsCard?.className).not.toMatch(/shadow-(?!lg\b)[a-z0-9]+/);

    // 3. MovieDetailsModal
    const { container: detailsContainer } = render(
      <MovieStoreProvider>
        <MovieDetailsTrigger />
      </MovieStoreProvider>
    );
    const detailsCard = detailsContainer.querySelector('.rounded-3xl');
    expect(detailsCard).toHaveClass('shadow-lg');
    expect(detailsCard?.className).not.toMatch(/shadow-(?!lg\b)[a-z0-9]+/);

    // 4. PaletteSwitcher modal
    const { container: paletteContainer } = render(
      <PaletteSwitcher isOpen={true} onClose={() => {}} />
    );
    const paletteCard = paletteContainer.querySelector('.rounded-2xl');
    expect(paletteCard).toHaveClass('shadow-lg');
    expect(paletteCard?.className).not.toMatch(/shadow-(?!lg\b)[a-z0-9]+/);

    // 5. ErrorBoundary modal card
    const ThrowingComponent = () => {
      throw new Error('Test boundary crash');
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container: errorContainer } = render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    consoleSpy.mockRestore();
    const errorCard = errorContainer.querySelector('.rounded-2xl');
    expect(errorCard).toHaveClass('shadow-lg');
    expect(errorCard?.className).not.toMatch(/shadow-(?!lg\b)[a-z0-9]+/);
  });

  it('verifies no backdrop-blur remains in Toast, MobileBottomNav, Watchlist, MyRatings, or ShareButton', () => {
    // MobileBottomNav
    const { container: navContainer } = render(
      <MovieStoreProvider>
        <MobileBottomNav onOpenSettings={() => {}} />
      </MovieStoreProvider>
    );
    expect(navContainer.innerHTML).not.toContain('backdrop-blur');

    // Watchlist
    const { container: watchlistContainer } = render(
      <MovieStoreProvider>
        <Watchlist />
      </MovieStoreProvider>
    );
    expect(watchlistContainer.innerHTML).not.toContain('backdrop-blur');

    // MyRatings
    const { container: ratingsContainer } = render(
      <MovieStoreProvider>
        <MyRatings onOpenCsvModal={() => {}} />
      </MovieStoreProvider>
    );
    expect(ratingsContainer.innerHTML).not.toContain('backdrop-blur');

    // ShareButton
    const { container: shareContainer } = render(
      <MovieStoreProvider>
        <ShareButton
          movie={{
            id: 1,
            title: 'Test Movie',
            overview: '',
            poster_path: null,
            backdrop_path: null,
            release_date: '',
            vote_average: 8,
            vote_count: 100,
          }}
        />
      </MovieStoreProvider>
    );
    expect(shareContainer.innerHTML).not.toContain('backdrop-blur');
  });

  it('verifies primary buttons revert to text-black for palette contrast', () => {
    // 1. SettingsModal primary save button
    render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );

    const saveButton = screen.getByRole('button', { name: /Save & Apply Settings/i });
    expect(saveButton).toBeInTheDocument();
    expect(saveButton.className).toContain('text-black');
    expect(saveButton.className).not.toContain('text-[var(--accent-text)]');

    // 2. ErrorBoundary reload button
    const ThrowingComponent = () => {
      throw new Error('Test crash');
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    consoleSpy.mockRestore();

    const reloadButton = screen.getByRole('button', { name: /Reload Application/i });
    expect(reloadButton).toBeInTheDocument();
    expect(reloadButton.className).toContain('text-black');
    expect(reloadButton.className).not.toContain('text-[var(--accent-text)]');

    // 3. CsvImportModal primary buttons (all 4 phases)
    const csvContent = fs.readFileSync(
      path.resolve(__dirname, '../components/CsvImportModal.tsx'),
      'utf-8'
    );
    expect(csvContent).not.toContain('text-[var(--accent-text)]');
    const primaryCsvButtons = csvContent.match(/bg-\[var\(--accent-primary\)\][^>]*text-black/g);
    expect(primaryCsvButtons).not.toBeNull();
    expect(primaryCsvButtons?.length).toBe(4);
  });

  it('verifies keyboard focus indicators on sliders, toggles, and text inputs', () => {
    // 1. Range slider in DiscoveryFilters
    const { container: filterContainer } = render(
      <MovieStoreProvider>
        <DiscoveryFilters />
      </MovieStoreProvider>
    );
    const rangeSlider = filterContainer.querySelector('input[type="range"]');
    expect(rangeSlider).toBeInTheDocument();
    expect(rangeSlider).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-[var(--border-focus)]');
    expect(rangeSlider?.className).not.toContain('focus:outline-none');

    // 2. Toggle track in SettingsModal
    const settingsContent = fs.readFileSync(
      path.resolve(__dirname, '../components/SettingsModal.tsx'),
      'utf-8'
    );
    expect(settingsContent).toContain(
      'peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--border-focus)]'
    );

    // 3. Text inputs in MyRatings, Watchlist, and SettingsModal
    const { container: ratingsContainer } = render(
      <MovieStoreProvider>
        <MyRatings onOpenCsvModal={() => {}} />
      </MovieStoreProvider>
    );
    const ratingsInput = ratingsContainer.querySelector('input[type="text"]');
    expect(ratingsInput).toHaveClass(
      'focus-visible:outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-[var(--border-focus)]'
    );

    const watchlistContent = fs.readFileSync(
      path.resolve(__dirname, '../components/Watchlist.tsx'),
      'utf-8'
    );
    expect(watchlistContent).toContain(
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]'
    );

    expect(settingsContent).toContain(
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]'
    );
  });
});
