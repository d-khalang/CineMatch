import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Toast } from '../Toast';
import { MovieStoreProvider, useMovieStore } from '../../store/useMovieStore';
import { clearInMemoryStoreForTesting } from '../../services/storage';

const ToastTestConsumer: React.FC = () => {
  const { showToast, clearToast } = useMovieStore();
  return (
    <div>
      <Toast />
      <button onClick={() => showToast('Hidden Film. Restore it in Settings')}>Trigger Toast</button>
      <button onClick={clearToast}>Clear Toast</button>
    </div>
  );
};

describe('Toast live region (CIN-45)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
  });

  it('renders live region with role="status" and aria-live="polite" before any message, and holds message text after showToast', async () => {
    render(
      <MovieStoreProvider>
        <ToastTestConsumer />
      </MovieStoreProvider>
    );

    // Live region must exist before any message is triggered
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveTextContent('');

    // Trigger toast notification
    await act(async () => {
      screen.getByText('Trigger Toast').click();
    });

    // Live region now holds the notification message text
    expect(liveRegion).toHaveTextContent('Hidden Film. Restore it in Settings');

    // Dismiss notification via button
    const dismissButton = screen.getByRole('button', { name: 'Dismiss notification' });
    expect(dismissButton).toBeInTheDocument();

    await act(async () => {
      dismissButton.click();
    });

    // Container stays mounted as an empty live region
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('keeps live region mounted when cleared via store clearToast', async () => {
    render(
      <MovieStoreProvider>
        <ToastTestConsumer />
      </MovieStoreProvider>
    );

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toBeInTheDocument();

    await act(async () => {
      screen.getByText('Trigger Toast').click();
    });
    expect(liveRegion).toHaveTextContent('Hidden Film. Restore it in Settings');

    // Clear via store method directly
    await act(async () => {
      screen.getByText('Clear Toast').click();
    });

    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent('');
  });

  it('updates live region message text when sequential notifications are dispatched', async () => {
    const MultiToastConsumer: React.FC = () => {
      const { showToast } = useMovieStore();
      return (
        <div>
          <Toast />
          <button onClick={() => showToast('First message')}>Show 1</button>
          <button onClick={() => showToast('Updated message')}>Show 2</button>
        </div>
      );
    };

    render(
      <MovieStoreProvider>
        <MultiToastConsumer />
      </MovieStoreProvider>
    );

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveTextContent('');

    await act(async () => {
      screen.getByText('Show 1').click();
    });
    expect(liveRegion).toHaveTextContent('First message');

    await act(async () => {
      screen.getByText('Show 2').click();
    });
    expect(liveRegion).toHaveTextContent('Updated message');
  });
});
