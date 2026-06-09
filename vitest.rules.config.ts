import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Vitest config — Firestore SECURITY-RULES tests.
//
// Separate from vitest.config.ts (component tests) because these:
//   - need a running Firestore emulator (java), not jsdom;
//   - are slower (real emulator round-trips);
//   - run via `npm run test:rules`, which boots the emulator with
//     `firebase emulators:exec` and points the SDK at 127.0.0.1:8080.
//
// They are intentionally NOT in the default `vitest run` include glob
// (tests/components/**), so `npm run test:ui` stays emulator-free.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    // The emulator + initializeTestEnvironment cold start can exceed the
    // 5s default on a fresh JVM.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // One worker — all tests share the single emulator instance and the
    // global clearFirestore() between tests would race across workers.
    fileParallelism: false,
  },
});
