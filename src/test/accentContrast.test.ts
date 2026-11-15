import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

function srgbChannelToLinear(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace(/^#/, '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('palette --accent-text contrast on --accent-primary', () => {
  it('meets WCAG 2.1 AA (at least 4.5:1) across all 7 palette blocks in src/index.css', () => {
    const css = readFileSync('src/index.css', 'utf-8');
    const blockRegex = /(:root|\[data-palette="[^"]+"\])\s*\{([^}]+)\}/g;

    const blocks: Array<{ selector: string; primary: string; text: string; ratio: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(css)) !== null) {
      const selector = match[1];
      const body = match[2];
      const primaryMatch = body.match(/--accent-primary:\s*(#[0-9a-fA-F]{6})\s*;/);
      const textMatch = body.match(/--accent-text:\s*(#[0-9a-fA-F]{6})\s*;/);

      expect(primaryMatch, `Missing --accent-primary in ${selector}`).not.toBeNull();
      expect(textMatch, `Missing --accent-text in ${selector}`).not.toBeNull();

      const primary = primaryMatch![1];
      const text = textMatch![1];
      const ratio = contrastRatio(primary, text);

      blocks.push({ selector, primary, text, ratio });
    }

    expect(blocks).toHaveLength(7);

    for (const block of blocks) {
      expect(
        block.ratio,
        `${block.selector} (${block.text} on ${block.primary}) contrast ratio ${block.ratio.toFixed(2)} is below 4.5:1`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
