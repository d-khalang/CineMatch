import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RatingControl } from '../RatingControl';

describe('RatingControl Accessibility and Interaction', () => {
  it('renders ARIA radiogroup with 10 accessible radio buttons in expanded mode', () => {
    const onRate = vi.fn();
    const onClear = vi.fn();

    render(<RatingControl currentRating={8} onRate={onRate} onClear={onClear} />);

    const radioGroup = screen.getByRole('radiogroup', { name: /Select your rating from 1 to 10/i });
    expect(radioGroup).toBeInTheDocument();

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(10);

    const button8 = screen.getByRole('radio', { name: /Rate 8 out of 10/i });
    expect(button8).toHaveAttribute('aria-checked', 'true');

    const button7 = screen.getByRole('radio', { name: /Rate 7 out of 10/i });
    expect(button7).toHaveAttribute('aria-checked', 'false');
  });

  it('invokes onRate with the selected score on click', async () => {
    const user = userEvent.setup();
    const onRate = vi.fn();
    const onClear = vi.fn();

    render(<RatingControl onRate={onRate} onClear={onClear} />);

    const button10 = screen.getByRole('radio', { name: /Rate 10 out of 10/i });
    await user.click(button10);

    expect(onRate).toHaveBeenCalledWith(10);
  });

  it('renders clear button when rating exists and invokes onClear on click in expanded mode', async () => {
    const user = userEvent.setup();
    const onRate = vi.fn();
    const onClear = vi.fn();

    render(<RatingControl currentRating={9} onRate={onRate} onClear={onClear} />);

    const clearButton = screen.getByRole('button', { name: /Clear rating/i });
    await user.click(clearButton);

    expect(onClear).toHaveBeenCalled();
  });

  it('supports compact view mode', () => {
    const onRate = vi.fn();
    const onClear = vi.fn();

    render(<RatingControl currentRating={7} onRate={onRate} onClear={onClear} compact />);

    expect(screen.getByRole('radiogroup', { name: /Movie rating from 1 to 10/i })).toBeInTheDocument();
    expect(screen.getByText('7/10')).toBeInTheDocument();
  });
});
