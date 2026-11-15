import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DiscoveryFilters } from './DiscoveryFilters';
import { MovieStoreProvider } from '../store/useMovieStore';

describe('DiscoveryFilters accessibility', () => {
  it('gives the serendipity slider an accessible name and aria-valuetext', () => {
    render(
      <MovieStoreProvider>
        <DiscoveryFilters />
      </MovieStoreProvider>
    );

    const slider = screen.getByRole('slider', { name: 'Recommendation serendipity' });
    expect(slider).toBeInTheDocument();
    expect(slider).toHaveAttribute('aria-label', 'Recommendation serendipity');
    // Default serendipity level in DEFAULT_SETTINGS is 40 -> Balanced Discovery
    expect(slider).toHaveAttribute('aria-valuetext', '40% — Balanced Discovery');
  });

  it('updates aria-valuetext when serendipity level is changed', () => {
    render(
      <MovieStoreProvider>
        <DiscoveryFilters />
      </MovieStoreProvider>
    );

    const slider = screen.getByRole('slider', { name: 'Recommendation serendipity' });

    // Change to 70% (Hidden Gems)
    fireEvent.change(slider, { target: { value: '70' } });
    expect(slider).toHaveAttribute('aria-valuetext', '70% — Hidden Gems');

    // Change to 15% (Safe Bets)
    fireEvent.change(slider, { target: { value: '15' } });
    expect(slider).toHaveAttribute('aria-valuetext', '15% — Safe Bets');

    // Change to 95% (Wildcard Horizon)
    fireEvent.change(slider, { target: { value: '95' } });
    expect(slider).toHaveAttribute('aria-valuetext', '95% — Wildcard Horizon');
  });

  it('handles boundary values (0% Safe Bets and 100% Wildcard Horizon)', () => {
    render(
      <MovieStoreProvider>
        <DiscoveryFilters />
      </MovieStoreProvider>
    );

    const slider = screen.getByRole('slider', { name: 'Recommendation serendipity' });

    // Change to 0% (Safe Bets boundary)
    fireEvent.change(slider, { target: { value: '0' } });
    expect(slider).toHaveAttribute('aria-valuetext', '0% — Safe Bets');

    // Change to 100% (Wildcard Horizon boundary)
    fireEvent.change(slider, { target: { value: '100' } });
    expect(slider).toHaveAttribute('aria-valuetext', '100% — Wildcard Horizon');
  });

});
