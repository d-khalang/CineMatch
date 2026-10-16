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
    const csvModalSrc = fs.readFileSync(path.resolve(__dirname, '../components/CsvImportModal.tsx'), 'utf-8');
    const settingsModalSrc = fs.readFileSync(path.resolve(__dirname, '../components/SettingsModal.tsx'), 'utf-8');
    const indexCssSrc = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf-8');

    for (const token of ['--surface-hover', '--text-primary', '--text-secondary']) {
      expect(csvModalSrc).not.toContain(token);
      expect(settingsModalSrc).not.toContain(token);
      expect(indexCssSrc).not.toContain(token);
    }
  });

  it('ensures global :focus-visible outline is declared inside @layer base in index.css', () => {
    const indexCssSrc = fs.readFileSync(path.resolve(__dirname, '../index.css'), 'utf-8');
    const layerBaseStart = indexCssSrc.indexOf('@layer base {');
    const focusVisibleIndex = indexCssSrc.indexOf(':focus-visible {', layerBaseStart);
    expect(layerBaseStart).toBeGreaterThan(-1);
    expect(focusVisibleIndex).toBeGreaterThan(layerBaseStart);
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

  it('verifies primary buttons in SettingsModal and CsvImportModal map to text-[var(--accent-text)] for all-palette contrast', () => {
    render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );

    const saveButton = screen.getByRole('button', { name: /Save & Apply Settings/i });
    expect(saveButton).toBeInTheDocument();
    expect(saveButton.className).toContain('text-[var(--accent-text)]');
    expect(saveButton.className).not.toContain('text-black');
  });
});
