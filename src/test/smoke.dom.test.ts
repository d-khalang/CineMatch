import { describe, it, expect } from 'vitest';

describe('Test Infrastructure Baseline Smoke Test', () => {
  it('verifies that vitest and environment are working correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('verifies that jsdom window and document are available', () => {
    expect(window).toBeDefined();
    expect(document).toBeDefined();
    const div = document.createElement('div');
    div.textContent = 'CineMatch';
    document.body.appendChild(div);
    expect(document.body.textContent).toContain('CineMatch');
    document.body.removeChild(div);
  });
});
