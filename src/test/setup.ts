import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './mocks/server';

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
