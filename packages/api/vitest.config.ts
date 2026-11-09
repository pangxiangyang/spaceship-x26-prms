import { defineConfig } from 'vitest/config';

// `vitest --mode firestore` runs the API suite against Firestore (emulator or a
// real project, see test/support/firestoreTarget.ts) instead of in-memory storage.
export default defineConfig(({ mode }) => {
  const firestore = mode === 'firestore';
  return {
    test: {
      include: ['test/**/*.test.ts'],
      env: firestore ? { PRMS_TEST_STORAGE: 'firestore' } : {},
      // Network round-trips make Firestore runs slower than in-memory ones.
      testTimeout: firestore ? 120_000 : 5_000,
      hookTimeout: firestore ? 120_000 : 10_000,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/server.ts', 'src/jobs/**'],
        reporter: ['text', 'html'],
      },
    },
  };
});
