import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MovieStoreProvider, useMovieStore } from '../store/useMovieStore';
import { SettingsModal } from './SettingsModal';
import { PaletteSwitcher } from './PaletteSwitcher';
import { MovieDetailsModal } from './MovieDetailsModal';
import { CsvImportModal } from './CsvImportModal';
import { useModalA11y } from './useModalA11y';
import { Movie } from '../types';

const mockMovie: Movie = {
  id: 42,
  title: 'Blade Runner 2049',
  overview: 'A young blade runner unearths a long-buried secret.',
  poster_path: '/br2049.jpg',
  backdrop_path: '/br2049-bg.jpg',
  release_date: '2017-10-06',
  vote_average: 8.0,
  vote_count: 12000,
};

describe('Modal A11y Suite', () => {
  describe('SettingsModal', () => {
    function SettingsFixture() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setIsOpen(true)}>Open Settings</button>
          <SettingsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </div>
      );
    }

    it('has dialog role, aria-modal, and aria-labelledby pointing to its heading', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <SettingsFixture />
        </MovieStoreProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Open Settings' }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const heading = document.getElementById(labelledBy!);
      expect(heading).toBeInTheDocument();
      expect(heading?.textContent).toMatch(/API Credentials & AI Engine/i);
    });

    it('focus is inside after opening, 20 Tabs never leave the modal, Escape closes it, and focus returns to opener', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <SettingsFixture />
        </MovieStoreProvider>
      );

      const opener = screen.getByRole('button', { name: 'Open Settings' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Focus is inside after opening
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      // 20 Tabs never leave the modal
      for (let i = 0; i < 20; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      // Escape closes it
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Focus returns to the opener on close
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('PaletteSwitcher', () => {
    function PaletteFixture() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setIsOpen(true)}>Open Palette Studio</button>
          <PaletteSwitcher isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </div>
      );
    }

    it('has dialog role, aria-modal, and aria-labelledby pointing to its heading', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <PaletteFixture />
        </MovieStoreProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Open Palette Studio' }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const heading = document.getElementById(labelledBy!);
      expect(heading).toBeInTheDocument();
      expect(heading?.textContent).toMatch(/Cinematic Style Studio/i);
    });

    it('focus is inside after opening, 20 Tabs never leave the modal, Escape closes it, and focus returns to opener', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <PaletteFixture />
        </MovieStoreProvider>
      );

      const opener = screen.getByRole('button', { name: 'Open Palette Studio' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Focus is inside after opening
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      // 20 Tabs never leave the modal
      for (let i = 0; i < 20; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      // Escape closes it
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Focus returns to the opener on close
      expect(document.activeElement).toBe(opener);
    });

    it('in uncontrolled mode, opens via launcher pill, traps focus, closes on Escape, and returns focus to launcher', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <PaletteSwitcher />
        </MovieStoreProvider>
      );

      const launcher = screen.getByRole('button', { name: /Theme Studio/i });
      await user.click(launcher);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      for (let i = 0; i < 20; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(launcher);
    });
  });

  describe('MovieDetailsModal', () => {
    function MovieDetailsFixture() {
      const { setSelectedMovieForModal } = useMovieStore();
      return (
        <div>
          <button onClick={() => setSelectedMovieForModal(mockMovie)}>View Blade Runner 2049</button>
          <MovieDetailsModal />
        </div>
      );
    }

    it('has dialog role, aria-modal, and aria-labelledby pointing to its heading', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <MovieDetailsFixture />
        </MovieStoreProvider>
      );

      await user.click(screen.getByRole('button', { name: 'View Blade Runner 2049' }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const heading = document.getElementById(labelledBy!);
      expect(heading).toBeInTheDocument();
      expect(heading?.textContent).toMatch(/Blade Runner 2049/i);
    });

    it('focus is inside after opening, 20 Tabs never leave the modal, Escape closes it, and focus returns to opener', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <MovieDetailsFixture />
        </MovieStoreProvider>
      );

      const opener = screen.getByRole('button', { name: 'View Blade Runner 2049' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Focus is inside after opening
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      // 20 Tabs never leave the modal
      for (let i = 0; i < 20; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      // Escape closes it
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Focus returns to the opener on close
      expect(document.activeElement).toBe(opener);
    });

    function ControlledMovieDetailsFixture() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setIsOpen(true)}>Open Controlled Details</button>
          <MovieDetailsModal isOpen={isOpen} onClose={() => setIsOpen(false)} movie={mockMovie} />
        </div>
      );
    }

    it('works in controlled prop mode: Escape closes it and focus returns to opener', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <ControlledMovieDetailsFixture />
        </MovieStoreProvider>
      );

      const opener = screen.getByRole('button', { name: 'Open Controlled Details' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      for (let i = 0; i < 20; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('CsvImportModal', () => {
    function CsvImportFixture() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setIsOpen(true)}>Open CSV Import</button>
          <CsvImportModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </div>
      );
    }

    it('has dialog role, aria-modal, and aria-labelledby pointing to its heading', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <CsvImportFixture />
        </MovieStoreProvider>
      );

      await user.click(screen.getByRole('button', { name: 'Open CSV Import' }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const heading = document.getElementById(labelledBy!);
      expect(heading).toBeInTheDocument();
      expect(heading?.textContent).toMatch(/Import Movie Ratings/i);
    });

    it('focus is inside after opening, 20 Tabs never leave the modal, Escape closes it, and focus returns to opener', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <CsvImportFixture />
        </MovieStoreProvider>
      );

      const opener = screen.getByRole('button', { name: 'Open CSV Import' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Focus is inside after opening
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      // 20 Tabs never leave the modal
      for (let i = 0; i < 20; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      // Escape closes it
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Focus returns to the opener on close
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('useModalA11y hook specifics', () => {
    function CustomModal({
      isOpen,
      onClose,
      showButtons = true,
      useHeadingFocus = false,
    }: {
      isOpen: boolean;
      onClose: () => void;
      showButtons?: boolean;
      useHeadingFocus?: boolean;
    }) {
      const headingRef = React.useRef<HTMLHeadingElement>(null);
      const containerRef = useModalA11y<HTMLDivElement>(
        isOpen,
        onClose,
        undefined,
        useHeadingFocus ? { initialFocusRef: headingRef } : undefined
      );

      if (!isOpen) return null;

      return (
        <div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="custom-heading">
          <h2 id="custom-heading" ref={headingRef}>
            Custom Dialog
          </h2>
          {showButtons ? (
            <>
              <button data-testid="btn-first">First Button</button>
              <button data-testid="btn-middle">Middle Button</button>
              <button data-testid="btn-last">Last Button</button>
            </>
          ) : (
            <p>No focusable elements here</p>
          )}
        </div>
      );
    }

    it('wraps focus on Shift+Tab from first element to last element', async () => {
      const user = userEvent.setup();
      function ShiftTabFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open Custom</button>
            <CustomModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </div>
        );
      }

      render(<ShiftTabFixture />);
      await user.click(screen.getByRole('button', { name: 'Open Custom' }));

      const firstBtn = screen.getByTestId('btn-first');
      const lastBtn = screen.getByTestId('btn-last');

      expect(document.activeElement).toBe(firstBtn);

      // Shift+Tab from first element should wrap to last element
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(lastBtn);

      // Regular Tab from last element should wrap back to first element
      await user.tab();
      expect(document.activeElement).toBe(firstBtn);
    });

    it('falls back to focusing heading or container if no focusable buttons are present', async () => {
      const user = userEvent.setup();
      function NoButtonsFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open No Buttons</button>
            <CustomModal isOpen={isOpen} onClose={() => setIsOpen(false)} showButtons={false} />
          </div>
        );
      }

      render(<NoButtonsFixture />);
      await user.click(screen.getByRole('button', { name: 'Open No Buttons' }));

      const dialog = screen.getByRole('dialog');
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      const heading = screen.getByRole('heading', { name: 'Custom Dialog' });
      expect(document.activeElement).toBe(heading);
    });

    it('respects initialFocusRef option when provided', async () => {
      const user = userEvent.setup();
      function InitialHeadingFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open Heading Focus</button>
            <CustomModal isOpen={isOpen} onClose={() => setIsOpen(false)} useHeadingFocus={true} />
          </div>
        );
      }

      render(<InitialHeadingFixture />);
      await user.click(screen.getByRole('button', { name: 'Open Heading Focus' }));

      const heading = screen.getByRole('heading', { name: 'Custom Dialog' });
      expect(document.activeElement).toBe(heading);
    });

    it('traps focus when modal contains only a single focusable element', async () => {
      const user = userEvent.setup();
      function SingleItemModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
        const containerRef = useModalA11y<HTMLDivElement>(isOpen, onClose);
        if (!isOpen) return null;
        return (
          <div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="single-title">
            <h2 id="single-title">Single Item Modal</h2>
            <button data-testid="only-button">Only Button</button>
          </div>
        );
      }

      function SingleItemFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open Single Item</button>
            <SingleItemModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </div>
        );
      }

      render(<SingleItemFixture />);
      const opener = screen.getByRole('button', { name: 'Open Single Item' });
      await user.click(opener);

      const onlyButton = screen.getByTestId('only-button');
      expect(document.activeElement).toBe(onlyButton);

      // 20 Tabs never leave the single item
      for (let i = 0; i < 20; i++) {
        await user.tab();
        expect(document.activeElement).toBe(onlyButton);
      }

      // 5 Shift+Tabs also stay on the single item
      for (let i = 0; i < 5; i++) {
        await user.tab({ shift: true });
        expect(document.activeElement).toBe(onlyButton);
      }

      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(opener);
    });

    it('traps Tab on heading when no focusable elements are present', async () => {
      const user = userEvent.setup();
      function EmptyModalFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open Empty</button>
            <CustomModal isOpen={isOpen} onClose={() => setIsOpen(false)} showButtons={false} />
          </div>
        );
      }

      render(<EmptyModalFixture />);
      const opener = screen.getByRole('button', { name: 'Open Empty' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      const heading = screen.getByRole('heading', { name: 'Custom Dialog' });
      expect(document.activeElement).toBe(heading);

      // Tab and Shift+Tab should not escape the dialog
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      await user.tab({ shift: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(opener);
    });

    it('properly returns focus to opener across multiple open and close cycles', async () => {
      const user = userEvent.setup();
      function MultiCycleFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Cycle Opener</button>
            <CustomModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </div>
        );
      }

      render(<MultiCycleFixture />);
      const opener = screen.getByRole('button', { name: 'Cycle Opener' });

      // Cycle 1
      await user.click(opener);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(opener);

      // Cycle 2
      await user.click(opener);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(opener);
    });

    it('returns focus to opener when component is unmounted directly while open', async () => {
      const user = userEvent.setup();
      function ConditionalFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Cond Opener</button>
            {isOpen && <CustomModal isOpen={isOpen} onClose={() => setIsOpen(false)} />}
          </div>
        );
      }

      render(<ConditionalFixture />);
      const opener = screen.getByRole('button', { name: 'Cond Opener' });
      await user.click(opener);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(opener);
    });

  });
});
