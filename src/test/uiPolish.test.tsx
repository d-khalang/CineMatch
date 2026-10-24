import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useEffect } from 'react';
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
import { RatingControl } from '../components/RatingControl';
import { TasteCalibration } from '../components/TasteCalibration';
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

describe('CIN-17 & CIN-32 UI Polish', () => {
  it('renders CineMatchLogo and confirms it renders correctly', () => {
    const { container } = render(<CineMatchLogo className="w-8 h-8" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass('w-8', 'h-8');
  });

  it('renders Toast with solid elevated background and shadow-lg', () => {
    render(
      <MovieStoreProvider>
        <ToastTrigger message="Saved successfully" />
      </MovieStoreProvider>
    );

    const toastText = screen.getByText('Saved successfully');
    expect(toastText).toBeInTheDocument();

    const toastCard = toastText.closest('div');
    expect(toastCard).toHaveClass('bg-[var(--bg-surface-elevated)]', 'shadow-lg');
  });

  it('renders PaletteSwitcher Theme Studio button', () => {
    render(<PaletteSwitcher />);
    const studioButton = screen.getByRole('button', { name: /Theme Studio/i });
    expect(studioButton).toBeInTheDocument();
  });

  it('renders Navbar buttons', () => {
    render(
      <MovieStoreProvider>
        <Navbar onOpenSettings={() => {}} onOpenPalette={() => {}} />
      </MovieStoreProvider>
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    buttons.forEach((btn) => {
      expect(btn).toBeInTheDocument();
    });
  });

  it('ensures no undefined CSS tokens (--surface-hover, --text-primary, --text-secondary) exist in source files', () => {
    const allSourceFiles: Record<string, string> = import.meta.glob('../**/*.{ts,tsx,css,html}', {
      query: '?raw',
      import: 'default',
      eager: true,
    });

    const fileEntries = Object.entries(allSourceFiles).filter(
      ([filePath]) => !filePath.endsWith('uiPolish.test.tsx')
    );
    expect(fileEntries.length).toBeGreaterThan(0);

    const forbiddenTokens = [
      '--' + 'surface-hover',
      '--' + 'text-primary',
      '--' + 'text-secondary',
    ];

    for (const [filePath, content] of fileEntries) {
      for (const token of forbiddenTokens) {
        expect(
          content,
          `File ${filePath} contains undefined token "${token}"`
        ).not.toContain(token);
      }
    }
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

    // 2. SettingsModal
    const { container: settingsContainer } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );
    const settingsCard = settingsContainer.querySelector('.rounded-3xl');
    expect(settingsCard).toHaveClass('shadow-lg');

    // 3. MovieDetailsModal
    const { container: detailsContainer } = render(
      <MovieStoreProvider>
        <MovieDetailsTrigger />
      </MovieStoreProvider>
    );
    const detailsCard = detailsContainer.querySelector('.rounded-3xl');
    expect(detailsCard).toHaveClass('shadow-lg');

    // 4. PaletteSwitcher modal
    const { container: paletteContainer } = render(
      <PaletteSwitcher isOpen={true} onClose={() => {}} />
    );
    const paletteCard = paletteContainer.querySelector('.rounded-2xl');
    expect(paletteCard).toHaveClass('shadow-lg');

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
  });

  it('renders MobileBottomNav, Watchlist, MyRatings, and ShareButton', () => {
    // MobileBottomNav
    const { container: navContainer } = render(
      <MovieStoreProvider>
        <MobileBottomNav onOpenSettings={() => {}} />
      </MovieStoreProvider>
    );
    expect(navContainer.querySelector('nav')).toBeInTheDocument();

    // Watchlist
    const { container: watchlistContainer } = render(
      <MovieStoreProvider>
        <Watchlist />
      </MovieStoreProvider>
    );
    expect(watchlistContainer.firstChild).toBeInTheDocument();

    // MyRatings
    const { container: ratingsContainer } = render(
      <MovieStoreProvider>
        <MyRatings onOpenCsvModal={() => {}} />
      </MovieStoreProvider>
    );
    expect(ratingsContainer.firstChild).toBeInTheDocument();

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
    expect(shareContainer.querySelector('button')).toBeInTheDocument();
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
    expect(saveButton).toHaveClass('text-black');

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
    expect(reloadButton).toHaveClass('text-black');
  });

  it('verifies focus-ring class on focusable controls in DiscoveryFilters, SettingsModal, MyRatings, Watchlist, TasteCalibration, and RatingControl', () => {
    // 1. Range slider in DiscoveryFilters
    const { container: filterContainer } = render(
      <MovieStoreProvider>
        <DiscoveryFilters />
      </MovieStoreProvider>
    );
    const rangeSlider = filterContainer.querySelector('input[type="range"]');
    expect(rangeSlider).toBeInTheDocument();
    expect(rangeSlider).toHaveClass('focus-ring');

    // 2. Text input in SettingsModal
    const { container: settingsContainer } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );
    const settingsInput = settingsContainer.querySelector('input[type="password"]');
    expect(settingsInput).toBeInTheDocument();
    expect(settingsInput).toHaveClass('focus-ring');

    // 3. Text input in MyRatings
    const { container: ratingsContainer } = render(
      <MovieStoreProvider>
        <MyRatings onOpenCsvModal={() => {}} />
      </MovieStoreProvider>
    );
    const ratingsInput = ratingsContainer.querySelector('input[type="text"]');
    expect(ratingsInput).toBeInTheDocument();
    expect(ratingsInput).toHaveClass('focus-ring');

    // 4. Text input in TasteCalibration
    const { container: calibrationContainer } = render(
      <MovieStoreProvider>
        <TasteCalibration />
      </MovieStoreProvider>
    );
    const calibrationInput = calibrationContainer.querySelector('input[type="text"]');
    expect(calibrationInput).toBeInTheDocument();
    expect(calibrationInput).toHaveClass('focus-ring');

    // 5. Rating buttons in RatingControl
    render(<RatingControl onRate={() => {}} onClear={() => {}} />);
    const ratingButton = screen.getByRole('radio', { name: /Rate 1 out of 10/i });
    expect(ratingButton).toBeInTheDocument();
    expect(ratingButton).toHaveClass('focus-ring');
  });

  it('tabs to a text input, a slider and a button with user-event and asserts each focused element has focus-ring and is activeElement', async () => {
    const user = userEvent.setup();

    // 1. Text input in SettingsModal
    const { container: settingsContainer } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );
    const textInput = settingsContainer.querySelector('input[type="password"]') as HTMLInputElement;
    expect(textInput).toBeInTheDocument();
    await user.tab(); // Close button
    await user.tab(); // Get TMDB Key link
    await user.tab(); // Read Access Token button
    await user.tab(); // API Key button
    await user.tab(); // TMDB Credential Input
    expect(document.activeElement).toBe(textInput);
    expect(textInput).toHaveClass('focus-ring');
    cleanup();

    // 2. Slider in DiscoveryFilters
    const { container: filterContainer } = render(
      <MovieStoreProvider>
        <DiscoveryFilters />
      </MovieStoreProvider>
    );
    const slider = filterContainer.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    await user.tab(); // Re-rank button
    await user.tab(); // Range slider
    expect(document.activeElement).toBe(slider);
    expect(slider).toHaveClass('focus-ring');
    cleanup();

    // 3. Button in RatingControl
    render(<RatingControl onRate={() => {}} onClear={() => {}} />);
    const ratingBtn1 = screen.getByRole('radio', { name: /Rate 1 out of 10/i });
    expect(ratingBtn1).toBeInTheDocument();
    await user.tab(); // 1st radio button
    expect(document.activeElement).toBe(ratingBtn1);
    expect(ratingBtn1).toHaveClass('focus-ring');
  });
});
