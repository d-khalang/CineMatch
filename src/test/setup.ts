import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './mocks/server';

// A test that touches storage belongs in *.dom.test.ts. Under node, the safe storage
// helpers would swallow a throw and let it pass against their in-memory fallback,
// so the access is also recorded and fails the test afterwards.
if (typeof window === 'undefined') {
  const message = 'localStorage is not available in the node test project. Name this test *.dom.test.ts.';
  let accessed = false;

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      accessed = true;
      throw new Error(message);
    },
  });

  afterEach(() => {
    const failed = accessed;
    accessed = false;
    if (failed) throw new Error(message);
  });
}

// Fail tests on unexpected network requests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});

afterAll(() => {
  server.close();
});
