import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const domTsTests = [
  'src/services/recommendation/__tests__/eraPriority.test.ts',
  'src/services/__tests__/credentialStore.test.ts',
  'src/services/__tests__/storage.test.ts',
  'src/services/__tests__/storageHidden.frozen.test.ts',
  'src/store/__tests__/recommendationUtils.test.ts',
  'src/test/smoke.test.ts',
];

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'android/**',
        '**/*.d.ts',
        'src/test/**',
      ],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts', './src/test/setup.dom.ts'],
          include: ['src/**/*.test.tsx', ...domTsTests],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.ts'],
          exclude: domTsTests,
        },
      },
    ],
  },
});
