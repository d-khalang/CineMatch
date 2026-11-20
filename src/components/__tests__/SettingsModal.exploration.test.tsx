import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import { credentialCoordinator } from '../../services/credentialCoordinator';
import { clearInMemoryStoreForTesting } from '../../services/storage';
import {
  loadOutcomeLog,
  saveOutcomeLog,
  type OutcomeLog,
} from '../../services/recommendation/outcomeLog';

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

describe('SettingsModal Exploration Summary & Reset (CIN-13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.forgetAll();
    credentialCoordinator.resetForTesting();
  });

  it('hides exploration summary and Reset button when there are no rated surprise outcomes', () => {
    saveOutcomeLog([
      { movieId: 1, bucket: 'safe_bet', shownAt: 1000, rating: 9, ratedAt: 2000 },
      { movieId: 2, bucket: 'wildcard', shownAt: 1000 },
    ]);

    renderModal();

    expect(screen.queryByText(/surprises rated 8\+/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset exploration history' })).toBeNull();
  });

  it('shows "Exploration is working" when >= 50% of rated surprises are 8+, and Reset clears it', () => {
    const log: OutcomeLog = [
      { movieId: 1, bucket: 'stretch', shownAt: 1000, rating: 8, ratedAt: 2000 },
      { movieId: 2, bucket: 'wildcard', shownAt: 1000, rating: 9, ratedAt: 2000 },
      { movieId: 3, bucket: 'wildcard', shownAt: 1000, rating: 6, ratedAt: 2000 },
    ];
    saveOutcomeLog(log);

    renderModal();

    expect(
      screen.getByText('Exploration is working: 2 of 3 surprises rated 8+')
    ).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: 'Reset exploration history' });
    expect(resetBtn).toHaveAttribute('type', 'button');

    fireEvent.click(resetBtn);

    expect(loadOutcomeLog()).toEqual([]);
    expect(screen.queryByText(/surprises rated 8\+/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset exploration history' })).toBeNull();
  });

  it('shows "so far" phrasing when fewer than 50% of rated surprises are 8+', () => {
    const log: OutcomeLog = [
      { movieId: 1, bucket: 'stretch', shownAt: 1000, rating: 9, ratedAt: 2000 },
      { movieId: 2, bucket: 'wildcard', shownAt: 1000, rating: 5, ratedAt: 2000 },
      { movieId: 3, bucket: 'stretch', shownAt: 1000, rating: 4, ratedAt: 2000 },
    ];
    saveOutcomeLog(log);

    renderModal();

    expect(
      screen.getByText('Exploration: 1 of 3 surprises rated 8+ so far')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Reset exploration history' })
    ).toBeInTheDocument();
  });
});
