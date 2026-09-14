import React, { useState, useEffect } from 'react';
import { Palette, Type, Check, X } from 'lucide-react';

export interface PaletteOption {
  id: string;
  name: string;
  subtitle: string;
  badge: string;
  swatches: string[];
}

export const PALETTES: PaletteOption[] = [
  {
    id: 'maple',
    name: 'Autumn Maple & Moss',
    subtitle: 'Warm scarlet maple, sage eucalyptus & deep forest pine',
    badge: 'User Photo Palette',
    swatches: ['#121c17', '#192721', '#e6283b', '#8ab894'],
  },
  {
    id: 'criterion',
    name: 'Criterion Noir & Gold',
    subtitle: 'Archival prestige, champagne gold & vintage charcoal',
    badge: 'Classic Cinema',
    swatches: ['#181410', '#231c17', '#d4af37', '#ebd59b'],
  },
  {
    id: 'a24',
    name: 'A24 Midnight Velvet',
    subtitle: 'Midnight blackberry, plum & neon crimson',
    badge: 'Indie Arthouse',
    swatches: ['#160e22', '#211534', '#f43f5e', '#c084fc'],
  },
  {
    id: 'mubi',
    name: 'MUBI Scandi Cyan',
    subtitle: 'Deep arctic navy & icy fjord cerulean',
    badge: 'European Minimalist',
    swatches: ['#0a1624', '#102237', '#0ea5e9', '#7dd3fc'],
  },
  {
    id: 'celluloid',
    name: 'Celluloid 35mm',
    subtitle: 'Kodak analog warmth, amber & vintage jade',
    badge: '35mm Film Stock',
    swatches: ['#191208', '#261b0d', '#f59e0b', '#10b981'],
  },
  {
    id: 'slate',
    name: 'Neo-Noir Slate',
    subtitle: 'Tailored obsidian & electric indigo',
    badge: 'Modern Bespoke',
    swatches: ['#0e1220', '#151b2e', '#6366f1', '#a5b4fc'],
  },
];

export interface FontOption {
  id: string;
  name: string;
  category: string;
  preview: string;
  styleClass: string;
}

export const FONTS: FontOption[] = [
  {
    id: 'bricolage',
    name: 'Bricolage Grotesque',
    category: 'Characterful Neo-Grotesque (Distinct & Highly Readable)',
    preview: 'CINEMATCH 2026',
    styleClass: "font-['Bricolage_Grotesque'] font-extrabold tracking-tight",
  },
  {
    id: 'fraunces',
    name: 'Fraunces',
    category: 'Warm Vintage Soft-Serif (Literary & Editorial, Criterion Style)',
    preview: 'CineMatch 2026',
    styleClass: "font-['Fraunces'] font-bold tracking-tight",
  },
  {
    id: 'space',
    name: 'Space Grotesk',
    category: 'Architectural Geometric Sans (Clean with Quirk)',
    preview: 'CINEMATCH 2026',
    styleClass: "font-['Space_Grotesk'] font-bold tracking-wide",
  },
  {
    id: 'syne',
    name: 'Syne',
    category: 'Arthouse Sculptural Display (High Concept)',
    preview: 'CINEMATCH 2026',
    styleClass: "font-['Syne'] font-extrabold tracking-tight",
  },
  {
    id: 'cinzel',
    name: 'Cinzel',
    category: 'Classic Cinema Roman Capital Serif',
    preview: 'CINEMATCH 2026',
    styleClass: "font-['Cinzel'] font-bold tracking-wider",
  },
  {
    id: 'dmserif',
    name: 'DM Serif Display',
    category: 'Criterion Editorial Film Serif',
    preview: 'CineMatch 2026',
    styleClass: "font-['DM_Serif_Display'] italic font-normal tracking-wide",
  },
];

interface PaletteSwitcherProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export const PaletteSwitcher: React.FC<PaletteSwitcherProps> = ({ isOpen: controlledOpen, onClose: controlledClose }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activePalette, setActivePalette] = useState<string>(() => {
    return localStorage.getItem('cinematch-palette') || 'maple';
  });
  const [activeFont, setActiveFont] = useState<string>(() => {
    return localStorage.getItem('cinematch-font') || 'bricolage';
  });

  const showModal = controlledOpen !== undefined ? controlledOpen : isOpen;
  const handleClose = controlledClose !== undefined ? controlledClose : () => setIsOpen(false);

  // Synchronize DOM with preferences on mount/change
  useEffect(() => {
    document.documentElement.setAttribute('data-palette', activePalette);
    document.documentElement.setAttribute('data-font', activeFont);
  }, [activePalette, activeFont]);

  const handleSelectPalette = (paletteId: string) => {
    setActivePalette(paletteId);
    document.documentElement.setAttribute('data-palette', paletteId);
    localStorage.setItem('cinematch-palette', paletteId);
  };

  const handleSelectFont = (fontId: string) => {
    setActiveFont(fontId);
    document.documentElement.setAttribute('data-font', fontId);
    localStorage.setItem('cinematch-font', fontId);
  };

  return (
    <>
      {/* Floating Launcher Pill (only shown when not controlled externally via header) */}
      {controlledOpen === undefined && (
        <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40">
          <button
            onClick={() => setIsOpen(true)}
            className="group flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-[var(--bg-surface-elevated)] hover:bg-[var(--bg-surface-hover)] text-slate-200 hover:text-white border border-[var(--border-subtle)] hover:border-[var(--border-focus)] shadow-2xl backdrop-blur-md transition-all active:scale-95 cursor-pointer"
            title="Open Cinematic Palette & Font Studio"
          >
            <div className="w-5 h-5 rounded-full flex items-center justify-center bg-[var(--accent-primary)] text-[var(--accent-text)] font-black shadow-sm">
              <Palette className="w-3.5 h-3.5 fill-current" />
            </div>
            <span className="text-xs font-bold tracking-wide">Theme Studio</span>
            <span className="hidden sm:inline-block text-[10px] px-1.5 py-0.5 rounded-full palette-tag-secondary font-semibold">
              {PALETTES.find((p) => p.id === activePalette)?.name.split(' ')[0]}
            </span>
          </button>
        </div>
      )}

      {/* Interactive Modal / Studio Drawer */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-[var(--bg-canvas)]/85 backdrop-blur-md animate-fadeIn"
          onClick={handleClose}
        >
          <div
            className="relative w-full max-w-xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Studio Header */}
            <div className="p-5 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--bg-surface-elevated)]/80">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-full palette-tag-secondary">
                  <Palette className="w-5 h-5 text-[var(--accent-secondary)]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                    Cinematic Style Studio
                    <span className="text-[10px] px-2 py-0.5 rounded-full palette-tag-primary font-bold">
                      Live Preview
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Switch color palettes and title typography in real-time.
                  </p>
                </div>
              </div>

              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Options Body */}
            <div className="p-5 space-y-6 overflow-y-auto">
              {/* Section 1: Color Palettes */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Palette className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
                    Color Palette Combinations
                  </h4>
                  <span className="text-[11px] text-slate-400">Atmosphere, cards & accents</span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {PALETTES.map((p) => {
                    const isSelected = activePalette === p.id;
                    return (
                      <div
                        key={p.id}
                        onClick={() => handleSelectPalette(p.id)}
                        className={`group p-3.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-[var(--bg-surface-elevated)] border-[var(--border-focus)] shadow-lg shadow-[var(--accent-glow)] ring-1 ring-[var(--border-focus)]'
                            : 'bg-[var(--bg-surface-elevated)]/40 border-[var(--border-subtle)] hover:bg-[var(--bg-surface-elevated)] hover:border-[var(--border-focus)]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Color Swatch Circles */}
                          <div className="flex items-center -space-x-1.5 shrink-0">
                            {p.swatches.map((color, idx) => (
                              <div
                                key={idx}
                                className="w-5 h-5 rounded-full border-2 border-[var(--bg-surface)] shadow-sm"
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white group-hover:text-[var(--accent-secondary)] transition-colors">
                                {p.name}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded palette-tag-secondary font-medium">
                                {p.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {p.subtitle}
                            </p>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="w-6 h-6 rounded-full bg-[var(--accent-primary)] text-[var(--accent-text)] flex items-center justify-center shrink-0 shadow-md">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Headline Typography */}
              <div className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Type className="w-3.5 h-3.5 text-[var(--accent-secondary)]" />
                    Distinctive Headline Typography
                  </h4>
                  <span className="text-[11px] text-slate-400">Applies to big titles & website logo</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {FONTS.map((font) => {
                    const isSelected = activeFont === font.id;
                    return (
                      <div
                        key={font.id}
                        onClick={() => handleSelectFont(font.id)}
                        className={`group p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'bg-[var(--bg-surface-elevated)] border-[var(--border-focus)] shadow-md ring-1 ring-[var(--border-focus)]'
                            : 'bg-[var(--bg-surface-elevated)]/40 border-[var(--border-subtle)] hover:bg-[var(--bg-surface-elevated)] hover:border-[var(--border-focus)]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{font.name}</span>
                          {isSelected && (
                            <div className="w-4 h-4 rounded-full bg-[var(--accent-primary)] text-[var(--accent-text)] flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </div>
                          )}
                        </div>

                        {/* Visual Specimen */}
                        <div className={`text-base text-slate-100 py-1 ${font.styleClass}`}>
                          {font.preview}
                        </div>

                        <span className="text-[10px] text-slate-400 line-clamp-1">
                          {font.category}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Studio Footer */}
            <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-surface-elevated)]/80 flex items-center justify-between text-xs">
              <span className="text-slate-400">
                Preferences are auto-saved in your browser.
              </span>
              <button
                onClick={handleClose}
                className="btn-tactile btn-tactile-primary px-5 py-2 text-xs font-bold"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
