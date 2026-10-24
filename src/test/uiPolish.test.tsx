import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useEffect } from 'react';
import * as nativeVault from '../services/nativeCredentialVault';
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
import { MovieStoreProvider, useMovieStore } from '../store/useMovieStore';

vi.mock('../services/nativeCredentialVault', async () => {
  const actual = await vi.importActual<typeof import('../services/nativeCredentialVault')>(
    '../services/nativeCredentialVault'
  );
  return {
    ...actual,
    isVaultSupported: vi.fn(() => false),
  };
});

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

async function tabUntilTarget(
  user: ReturnType<typeof userEvent.setup>,
  target: Element,
  maxTabs = 30
): Promise<void> {
  expect(target).toBeInTheDocument();
  expect(document.activeElement).not.toBe(target);
  let tabsCount = 0;
  while (tabsCount < maxTabs) {
    await user.tab();
    tabsCount++;
    if (document.activeElement === target) {
      return;
    }
  }
  throw new Error(`Target element was not reached within ${maxTabs} tab presses`);
}

describe('CIN-17 & CIN-32 UI Polish', () => {
  beforeEach(() => {
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(false);
  });

  it('renders CineMatchLogo and confirms it renders correctly', () => {
    render(<CineMatchLogo className="w-8 h-8" />);
    const logo = screen.getByLabelText(/CineMatch Logo/i);
    expect(logo).toBeInTheDocument();
  });

  it('renders Toast with message and allows dismissing it', async () => {
    const user = userEvent.setup();
    render(
      <MovieStoreProvider>
        <ToastTrigger message="Saved successfully" />
      </MovieStoreProvider>
    );

    const toastText = screen.getByText('Saved successfully');
    expect(toastText).toBeInTheDocument();

    const dismissBtn = screen.getByRole('button');
    expect(dismissBtn).toBeInTheDocument();
    await user.click(dismissBtn);
    expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
  });

  it('renders PaletteSwitcher Theme Studio button', () => {
    render(<PaletteSwitcher />);
    const studioButton = screen.getByRole('button', { name: /Theme Studio/i });
    expect(studioButton).toBeInTheDocument();
  });

  it('renders Navbar buttons with accessible names and triggers action callbacks', async () => {
    const user = userEvent.setup();
    const handleOpenSettings = vi.fn();
    const handleOpenPalette = vi.fn();

    render(
      <MovieStoreProvider>
        <Navbar onOpenSettings={handleOpenSettings} onOpenPalette={handleOpenPalette} />
      </MovieStoreProvider>
    );

    expect(screen.getByRole('button', { name: /Taste Calibration/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Top Ranked/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Watchlist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My Ratings/i })).toBeInTheDocument();

    const paletteBtn = screen.getByRole('button', { name: /Color Palette & Typography/i });
    const aiBtn = screen.getByRole('button', { name: /AI Engine & API Keys/i });
    const settingsBtn = screen.getByRole('button', { name: /^Settings$/i });

    expect(paletteBtn).toBeInTheDocument();
    expect(aiBtn).toBeInTheDocument();
    expect(settingsBtn).toBeInTheDocument();

    await user.click(settingsBtn);
    expect(handleOpenSettings).toHaveBeenCalledTimes(1);

    await user.click(paletteBtn);
    expect(handleOpenPalette).toHaveBeenCalledTimes(1);

    await user.click(aiBtn);
    expect(handleOpenSettings).toHaveBeenCalledTimes(2);
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

  it('renders modals and popovers with accessible roles and headings', () => {
    // 1. CsvImportModal
    const { unmount: unmountCsv } = render(
      <MovieStoreProvider>
        <CsvImportModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );
    expect(screen.getByRole('heading', { name: /Import Movie Ratings/i })).toBeInTheDocument();
    unmountCsv();

    // 2. SettingsModal
    const { unmount: unmountSettings } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );
    expect(screen.getByRole('heading', { name: /API Credentials & AI Engine/i })).toBeInTheDocument();
    unmountSettings();

    // 3. MovieDetailsModal
    const { unmount: unmountDetails } = render(
      <MovieStoreProvider>
        <MovieDetailsTrigger />
      </MovieStoreProvider>
    );
    expect(screen.getByRole('heading', { name: /Candidate Film A/i })).toBeInTheDocument();
    unmountDetails();

    // 4. PaletteSwitcher modal
    const { unmount: unmountPalette } = render(
      <PaletteSwitcher isOpen={true} onClose={() => {}} />
    );
    expect(screen.getByRole('heading', { name: /Cinematic Style Studio/i })).toBeInTheDocument();
    unmountPalette();

    // 5. ErrorBoundary modal card
    const ThrowingComponent = () => {
      throw new Error('Test boundary crash');
    };
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <ThrowingComponent />
      </ErrorBoundary>
    );
    consoleSpy.mockRestore();
    expect(screen.getByRole('heading', { name: /Something Went Wrong/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload Application/i })).toBeInTheDocument();
  });

  it('renders MobileBottomNav, Watchlist, MyRatings, and ShareButton', () => {
    // MobileBottomNav
    const { unmount: unmountNav } = render(
      <MovieStoreProvider>
        <MobileBottomNav onOpenSettings={() => {}} />
      </MovieStoreProvider>
    );
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calibration/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Top Ranked/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Watchlist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ratings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Settings/i })).toBeInTheDocument();
    unmountNav();

    // Watchlist
    const { unmount: unmountWatchlist } = render(
      <MovieStoreProvider>
        <Watchlist />
      </MovieStoreProvider>
    );
    expect(screen.getByRole('heading', { name: /My Watchlist/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Browse Top Ranked/i })).toBeInTheDocument();
    unmountWatchlist();

    // MyRatings
    const { unmount: unmountRatings } = render(
      <MovieStoreProvider>
        <MyRatings onOpenCsvModal={() => {}} />
      </MovieStoreProvider>
    );
    expect(screen.getByRole('heading', { name: /My Movie Library & Ratings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Import CSV/i })).toBeInTheDocument();
    unmountRatings();

    // ShareButton
    const { unmount: unmountShare } = render(
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
    expect(screen.getByRole('button', { name: /Share IMDb page/i })).toBeInTheDocument();
    unmountShare();
  });

  it('exposes the SettingsModal and ErrorBoundary primary buttons by accessible name', () => {
    // 1. SettingsModal primary save button
    const { unmount: unmountSettings } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );

    const saveButton = screen.getByRole('button', { name: /Save & Apply Settings/i });
    expect(saveButton).toBeInTheDocument();
    unmountSettings();

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
  });

  it('tabs to a text input, a slider and a radio button with user-event using capped tab-until-target', async () => {
    const user = userEvent.setup();

    // 1. Text input in SettingsModal
    const { container: settingsContainer, unmount: unmountSettings } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );
    const textInput = settingsContainer.querySelector('input[type="password"]') as HTMLInputElement;
    expect(textInput).toBeInTheDocument();
    expect(document.activeElement).not.toBe(textInput);
    await tabUntilTarget(user, textInput, 30);
    expect(document.activeElement).toBe(textInput);
    unmountSettings();

    // 2. Slider in DiscoveryFilters
    const { container: filterContainer, unmount: unmountFilters } = render(
      <MovieStoreProvider>
        <DiscoveryFilters />
      </MovieStoreProvider>
    );
    const slider = filterContainer.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(document.activeElement).not.toBe(slider);
    await tabUntilTarget(user, slider, 30);
    expect(document.activeElement).toBe(slider);
    unmountFilters();

    // 3. Button in RatingControl
    const { unmount: unmountRating } = render(<RatingControl onRate={() => {}} onClear={() => {}} />);
    const ratingBtn1 = screen.getByRole('radio', { name: /Rate 1 out of 10/i });
    expect(ratingBtn1).toBeInTheDocument();
    expect(document.activeElement).not.toBe(ratingBtn1);
    await tabUntilTarget(user, ratingBtn1, 30);
    expect(document.activeElement).toBe(ratingBtn1);
    unmountRating();
  });

  it('navigates to SettingsModal peer toggle via keyboard and toggles with Space', async () => {
    vi.mocked(nativeVault.isVaultSupported).mockReturnValue(true);
    const user = userEvent.setup();

    const { unmount } = render(
      <MovieStoreProvider>
        <SettingsModal isOpen={true} onClose={() => {}} />
      </MovieStoreProvider>
    );

    const toggle = screen.getByRole('checkbox', { name: /Remember on this device/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();

    expect(document.activeElement).not.toBe(toggle);
    await tabUntilTarget(user, toggle, 30);
    expect(document.activeElement).toBe(toggle);

    // Space toggles it on
    await user.keyboard('[Space]');
    expect(toggle).toBeChecked();

    // Space toggles it off
    await user.keyboard('[Space]');
    expect(toggle).not.toBeChecked();

    unmount();
  });

  it('fails tabUntilTarget if the cap is reached without focusing target', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<button>Tabbable Element</button>);
    const unreachable = document.createElement('input');
    unreachable.tabIndex = -1;
    document.body.appendChild(unreachable);

    try {
      await expect(tabUntilTarget(user, unreachable, 5)).rejects.toThrow(
        'Target element was not reached within 5 tab presses'
      );
    } finally {
      document.body.removeChild(unreachable);
      unmount();
    }
  });

  it('fails tabUntilTarget if target is already the active element', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<button>Already Active</button>);
    const button = screen.getByRole('button', { name: /Already Active/i });
    button.focus();
    expect(document.activeElement).toBe(button);

    await expect(tabUntilTarget(user, button, 5)).rejects.toThrow(/not to be/);
    unmount();
  });
});
