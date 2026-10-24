import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import { credentialCoordinator } from '../../services/credentialCoordinator';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';

vi.mock('../../services/nativeCredentialVault', () => ({
  isVaultSupported: () => false,
  readVault: vi.fn(),
  writeVault: vi.fn(),
  clearVault: vi.fn(),
  setRememberEnabled: vi.fn(),
}));

const renderModal = (onClose = vi.fn()) => {
  return render(
    <MovieStoreProvider>
      <SettingsModal isOpen={true} onClose={onClose} />
    </MovieStoreProvider>
  );
};

describe('SettingsModal Hidden Films Section (CIN-42)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.forgetAll();
    credentialCoordinator.resetForTesting();
  });

  it('renders "No hidden films." empty state when there are no hidden films (AC3)', () => {
    renderModal();

    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (0)' })).toBeInTheDocument();
    expect(screen.getByText('No hidden films.')).toBeInTheDocument();
  });

  it('lists hidden films newest first with reasons, and Restore removes the entry (AC3)', () => {
    const hiddenData = [
      {
        movieId: 101,
        title: 'Film Oldest',
        reason: 'seen',
        hiddenAt: 1000,
      },
      {
        movieId: 102,
        title: 'Film Newest',
        reason: 'not_for_me',
        hiddenAt: 3000,
      },
      {
        movieId: 103,
        // no title provided, should fallback to #103
        reason: 'seen',
        hiddenAt: 2000,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(hiddenData));

    renderModal();

    // Section heading shows count
    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (3)' })).toBeInTheDocument();

    // Verify fallback title #103 is rendered
    expect(screen.getByText('#103')).toBeInTheDocument();
    expect(screen.getByText('Film Newest')).toBeInTheDocument();
    expect(screen.getByText('Film Oldest')).toBeInTheDocument();

    // Check reasons are displayed
    expect(screen.getAllByText('Seen')).toHaveLength(2);
    expect(screen.getByText('Not for me')).toBeInTheDocument();

    // Check newest first order
    const listItems = screen.getAllByRole('button', { name: /^Restore:/i });
    expect(listItems).toHaveLength(3);
    expect(listItems[0]).toHaveAccessibleName('Restore: Film Newest');
    expect(listItems[1]).toHaveAccessibleName('Restore: #103');
    expect(listItems[2]).toHaveAccessibleName('Restore: Film Oldest');

    // Restore Film Newest
    fireEvent.click(listItems[0]);

    // Film Newest is removed
    expect(screen.queryByText('Film Newest')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (2)' })).toBeInTheDocument();

    // Stored hidden films in localStorage updated
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]');
    expect(stored.some((h: { movieId: number }) => h.movieId === 102)).toBe(false);

    // Restore remaining films
    const restoreSecond = screen.getByRole('button', { name: 'Restore: #103' });
    fireEvent.click(restoreSecond);

    const restoreThird = screen.getByRole('button', { name: 'Restore: Film Oldest' });
    fireEvent.click(restoreThird);

    // Empty state appears
    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (0)' })).toBeInTheDocument();
    expect(screen.getByText('No hidden films.')).toBeInTheDocument();
  });

  it('bounds list to newest 50 entries and displays "…and K more" when > 50 entries', () => {
    const totalEntries = 55;
    const manyHidden = Array.from({ length: totalEntries }, (_, idx) => ({
      movieId: 1000 + idx,
      title: `Film Number ${idx + 1}`,
      reason: (idx % 2 === 0 ? 'seen' : 'not_for_me') as 'seen' | 'not_for_me',
      hiddenAt: 1000 + idx, // idx 54 has highest hiddenAt (newest)
    }));

    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(manyHidden));

    renderModal();

    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (55)' })).toBeInTheDocument();

    // Only 50 restore buttons are rendered
    const restoreButtons = screen.getAllByRole('button', { name: /^Restore:/i });
    expect(restoreButtons).toHaveLength(50);

    // Newest entry (Film Number 55) is rendered
    expect(screen.getByText('Film Number 55')).toBeInTheDocument();

    // Oldest entries (e.g. Film Number 1 to 5) are not rendered in visible slice
    expect(screen.queryByText('Film Number 1')).toBeNull();
    expect(screen.queryByText('Film Number 5')).toBeNull();

    // "…and 5 more" text appears
    expect(screen.getByText('…and 5 more')).toBeInTheDocument();
  });

  it('restore buttons can be reached by keyboard and have accessible names that include the title (AC4)', () => {
    const hiddenData = [
      {
        movieId: 555,
        title: 'Film X',
        reason: 'seen',
        hiddenAt: 5000,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(hiddenData));

    renderModal();

    // Matches accessible name with title
    const restoreBtn = screen.getByRole('button', { name: /Restore: Film X/i });
    expect(restoreBtn).toBeInTheDocument();
    expect(restoreBtn).toHaveClass('focus-ring');

    // Reachable by keyboard focus
    restoreBtn.focus();
    expect(document.activeElement).toBe(restoreBtn);
  });

  it('handles a single hidden film correctly (single item edge case)', () => {
    const singleData = [
      {
        movieId: 777,
        title: 'Solo Film',
        reason: 'seen' as const,
        hiddenAt: 1000,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(singleData));

    renderModal();

    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (1)' })).toBeInTheDocument();
    expect(screen.getByText('Solo Film')).toBeInTheDocument();
    expect(screen.getByText('Seen')).toBeInTheDocument();
    expect(screen.queryByText(/…and .* more/)).toBeNull();

    const restoreBtn = screen.getByRole('button', { name: 'Restore: Solo Film' });
    fireEvent.click(restoreBtn);

    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (0)' })).toBeInTheDocument();
    expect(screen.getByText('No hidden films.')).toBeInTheDocument();
  });

  it('handles NaN and malformed hiddenAt timestamps without breaking sorting (NaN edge case)', () => {
    const malformedData = [
      {
        movieId: 10,
        title: 'Film Valid Newest',
        reason: 'seen' as const,
        hiddenAt: 5000,
      },
      {
        movieId: 20,
        title: 'Film With NaN',
        reason: 'not_for_me' as const,
        hiddenAt: NaN,
      },
      {
        movieId: 30,
        title: 'Film Undefined Timestamp',
        reason: 'seen' as const,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(malformedData));

    renderModal();

    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (3)' })).toBeInTheDocument();
    expect(screen.getByText('Film Valid Newest')).toBeInTheDocument();
    expect(screen.getByText('Film With NaN')).toBeInTheDocument();
    expect(screen.getByText('Film Undefined Timestamp')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button', { name: /^Restore:/i });
    expect(buttons).toHaveLength(3);
    // Film Valid Newest has highest valid timestamp and sorts first
    expect(buttons[0]).toHaveAccessibleName('Restore: Film Valid Newest');
  });

  it('falls back to #<movieId> when title is whitespace-only', () => {
    const whitespaceTitleData = [
      {
        movieId: 888,
        title: '    ',
        reason: 'not_for_me' as const,
        hiddenAt: 4000,
      },
    ];
    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(whitespaceTitleData));

    renderModal();

    expect(screen.getByText('#888')).toBeInTheDocument();
    const restoreBtn = screen.getByRole('button', { name: 'Restore: #888' });
    expect(restoreBtn).toBeInTheDocument();

    fireEvent.click(restoreBtn);
    expect(screen.getByText('No hidden films.')).toBeInTheDocument();
  });

  it('does not display "…and K more" when there are exactly 50 entries', () => {
    const fiftyHidden = Array.from({ length: 50 }, (_, idx) => ({
      movieId: 2000 + idx,
      title: `Film ${idx + 1}`,
      reason: 'seen' as const,
      hiddenAt: 2000 + idx,
    }));
    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(fiftyHidden));

    renderModal();

    expect(screen.getByRole('heading', { level: 3, name: 'Hidden films (50)' })).toBeInTheDocument();
    const restoreButtons = screen.getAllByRole('button', { name: /^Restore:/i });
    expect(restoreButtons).toHaveLength(50);
    expect(screen.queryByText(/…and .* more/)).toBeNull();
  });
});
