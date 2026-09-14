import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../ErrorBoundary';

const ProblemChild: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Crashing render error');
  }
  return <div>Healthy Child Content</div>;
};

describe('ErrorBoundary Component', () => {
  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Healthy Child Content')).toBeInTheDocument();
  });

  it('renders graceful fallback UI when a child component crashes', () => {
    // Suppress console.error during expected throw
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload Application/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset UI State/i })).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('resets state when Reset Workspace State is clicked', async () => {
    const user = userEvent.setup();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let throwError = true;
    const DynamicChild: React.FC = () => {
      if (throwError) {
        throw new Error('Boom');
      }
      return <div>Recovered Content</div>;
    };

    render(
      <ErrorBoundary>
        <DynamicChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something Went Wrong')).toBeInTheDocument();

    throwError = false;
    const resetBtn = screen.getByRole('button', { name: /Reset UI State/i });
    await user.click(resetBtn);

    expect(screen.getByText('Recovered Content')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
