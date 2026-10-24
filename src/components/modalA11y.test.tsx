import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MovieStoreProvider, useMovieStore } from '../store/useMovieStore';
import { SettingsModal } from './SettingsModal';
import { PaletteSwitcher } from './PaletteSwitcher';
import { MovieDetailsModal } from './MovieDetailsModal';
import { CsvImportModal } from './CsvImportModal';
import { useModalA11y, getFocusableElements, isFocusable } from './useModalA11y';
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

    function ConditionalSettingsFixture() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setIsOpen(true)}>Open Settings Real</button>
          {isOpen && <SettingsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />}
        </div>
      );
    }

    function HiddenFilmsFixture() {
      const [isOpen, setIsOpen] = useState(false);
      const { hideFilm } = useMovieStore();
      return (
        <div>
          <button onClick={() => hideFilm(999, 'seen', 'Interstellar')}>Hide Interstellar</button>
          <button onClick={() => setIsOpen(true)}>Open Settings</button>
          {isOpen && <SettingsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />}
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

    it('Settings rendered as {open && <SettingsModal isOpen onClose={...}/>} gets focus inside and returns it on close', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <ConditionalSettingsFixture />
        </MovieStoreProvider>
      );

      const opener = screen.getByRole('button', { name: 'Open Settings Real' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      for (let i = 0; i < 10; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(document.activeElement).toBe(opener);
    });

    it('preserves Hidden films focus behaviour: restoring the only film moves focus to heading, and next Tab proceeds in DOM order', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <HiddenFilmsFixture />
        </MovieStoreProvider>
      );

      // Seed hidden film
      await user.click(screen.getByRole('button', { name: 'Hide Interstellar' }));

      // Open settings
      const opener = screen.getByRole('button', { name: 'Open Settings' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();

      // Find restore button
      const restoreBtn = screen.getByRole('button', { name: /Restore: Interstellar/i });
      expect(restoreBtn).toBeInTheDocument();

      // Click restore: the list becomes empty, so focus moves to hidden films heading (tabindex=-1)
      await user.click(restoreBtn);

      const heading = screen.getByRole('heading', { name: /Hidden films \(0\)/i });
      expect(heading).toBeInTheDocument();
      expect(document.activeElement).toBe(heading);

      // Press Tab from the tabindex=-1 heading:
      // Native Tab proceeds to next control in DOM order (Cancel button in footer), NOT jumping to first control (Close button)
      await user.tab();
      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      expect(document.activeElement).toBe(cancelBtn);

      // Next Tab moves to Save & Apply Settings
      await user.tab();
      const saveBtn = screen.getByRole('button', { name: /Save & Apply Settings/i });
      expect(document.activeElement).toBe(saveBtn);

      // Next Tab wraps around to the Close button at top of modal
      await user.tab();
      const closeBtn = screen.getByRole('button', { name: 'Close settings' });
      expect(document.activeElement).toBe(closeBtn);

      // Escape closes dialog and returns focus to opener
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    function ConditionalPaletteFixture() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setIsOpen(true)}>Open Palette Real</button>
          {isOpen && <PaletteSwitcher isOpen={isOpen} onClose={() => setIsOpen(false)} />}
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

    it('when mounted conditionally as {open && <PaletteSwitcher isOpen onClose={...}/>}, gets focus inside and returns it on close', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <ConditionalPaletteFixture />
        </MovieStoreProvider>
      );

      const opener = screen.getByRole('button', { name: 'Open Palette Real' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      for (let i = 0; i < 10; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    function ConditionalCsvFixture() {
      const [isOpen, setIsOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setIsOpen(true)}>Open CSV Real</button>
          {isOpen && <CsvImportModal isOpen={isOpen} onClose={() => setIsOpen(false)} />}
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

    it('when mounted conditionally as {open && <CsvImportModal isOpen onClose={...}/>}, gets focus inside and returns it on close', async () => {
      const user = userEvent.setup();
      render(
        <MovieStoreProvider>
          <ConditionalCsvFixture />
        </MovieStoreProvider>
      );

      const opener = screen.getByRole('button', { name: 'Open CSV Real' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toContainElement(document.activeElement as HTMLElement | null);

      for (let i = 0; i < 10; i++) {
        await user.tab();
        expect(dialog).toContainElement(document.activeElement as HTMLElement | null);
      }

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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

    function TailwindModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
      const containerRef = useModalA11y<HTMLDivElement>(isOpen, onClose);
      if (!isOpen) return null;
      return (
        <div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="tailwind-heading">
          <h2 id="tailwind-heading">Responsive Dialog</h2>
          <button data-testid="btn-first">First Button</button>
          <button data-testid="btn-responsive" className="hidden sm:inline-flex">
            Desktop Responsive Button
          </button>
          <button data-testid="btn-last">Last Button</button>
          <button data-testid="btn-display-none" style={{ display: 'none' }}>
            Hidden Style Button
          </button>
          <button data-testid="btn-hidden-attr" hidden>
            Hidden Attr Button
          </button>
          <button data-testid="btn-aria-hidden" aria-hidden="true">
            Aria Hidden Button
          </button>
        </div>
      );
    }

    it('a Tailwind-style hidden sm:inline-flex button that is visible (no computed display:none in jsdom) stays in the trap list', async () => {
      const user = userEvent.setup();
      function TailwindFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open Responsive</button>
            <TailwindModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </div>
        );
      }

      render(<TailwindFixture />);
      const opener = screen.getByRole('button', { name: 'Open Responsive' });
      await user.click(opener);

      const dialog = screen.getByRole('dialog');
      const firstBtn = screen.getByTestId('btn-first');
      const responsiveBtn = screen.getByTestId('btn-responsive');
      const lastBtn = screen.getByTestId('btn-last');

      const focusables = getFocusableElements(dialog);
      expect(focusables).toContain(responsiveBtn);
      expect(focusables).toContain(firstBtn);
      expect(focusables).toContain(lastBtn);
      expect(focusables).not.toContain(screen.getByTestId('btn-display-none'));
      expect(focusables).not.toContain(screen.getByTestId('btn-hidden-attr'));
      expect(focusables).not.toContain(screen.getByTestId('btn-aria-hidden'));

      expect(isFocusable(responsiveBtn)).toBe(true);
      expect(isFocusable(screen.getByTestId('btn-display-none'))).toBe(false);
      expect(isFocusable(screen.getByTestId('btn-hidden-attr'))).toBe(false);
      expect(isFocusable(screen.getByTestId('btn-aria-hidden'))).toBe(false);

      expect(document.activeElement).toBe(firstBtn);

      // Tab from first moves to the Tailwind responsive button (stays in trap list)
      await user.tab();
      expect(document.activeElement).toBe(responsiveBtn);

      // Next Tab moves to last button (skipping display:none, hidden attr, and aria-hidden)
      await user.tab();
      expect(document.activeElement).toBe(lastBtn);

      // Next Tab wraps around back to first button
      await user.tab();
      expect(document.activeElement).toBe(firstBtn);

      // Shift+Tab wraps back to last button
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(lastBtn);

      // Shift+Tab from last moves to responsive button
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(responsiveBtn);
    });

    function UnlistedElementsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
      const containerRef = useModalA11y<HTMLDivElement>(isOpen, onClose);
      if (!isOpen) return null;
      return (
        <div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="unlisted-title">
          <h2 id="unlisted-title" data-testid="top-heading" tabIndex={-1}>Top Heading</h2>
          <button data-testid="btn-first">First Control</button>
          <h3 data-testid="mid-heading" tabIndex={-1}>Mid Section Heading</h3>
          <button data-testid="btn-middle">Middle Control</button>
          <button data-testid="btn-last">Last Control</button>
          <p data-testid="bottom-text" tabIndex={-1}>Bottom Disclaimer</p>
        </div>
      );
    }

    it('with focus on a heading with tabindex=-1 inside the modal, Tab moves to the next control in DOM order, not the first', async () => {
      const user = userEvent.setup();
      function UnlistedFixture() {
        const [isOpen, setIsOpen] = useState(false);
        return (
          <div>
            <button onClick={() => setIsOpen(true)}>Open Unlisted</button>
            <UnlistedElementsModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
          </div>
        );
      }

      render(<UnlistedFixture />);
      await user.click(screen.getByRole('button', { name: 'Open Unlisted' }));

      const firstBtn = screen.getByTestId('btn-first');
      const midHeading = screen.getByTestId('mid-heading');
      const middleBtn = screen.getByTestId('btn-middle');
      const lastBtn = screen.getByTestId('btn-last');
      const topHeading = screen.getByTestId('top-heading');
      const bottomText = screen.getByTestId('bottom-text');

      // 1. Focus sits on mid-heading (an unlisted element between first and middle controls)
      midHeading.focus();
      expect(document.activeElement).toBe(midHeading);

      // Tab should move to the next control in DOM order (btn-middle), NOT jumping to btn-first
      await user.tab();
      expect(document.activeElement).toBe(middleBtn);

      // Shift+Tab from mid-heading should move backward in DOM order to btn-first
      midHeading.focus();
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(firstBtn);

      // 2. Focus on an unlisted element preceding the first control (top-heading)
      topHeading.focus();
      // Tab moves forward to the first focusable control
      await user.tab();
      expect(document.activeElement).toBe(firstBtn);

      topHeading.focus();
      // Shift+Tab would leave the container backward, so it wraps to last control
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(lastBtn);

      // 3. Focus on an unlisted element following the last control (bottom-text)
      bottomText.focus();
      // Tab would leave the container forward, so it wraps to first control
      await user.tab();
      expect(document.activeElement).toBe(firstBtn);

      bottomText.focus();
      // Shift+Tab moves backward in DOM order to last control
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(lastBtn);
    });
  });
});
