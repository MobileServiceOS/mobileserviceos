// tests/components/setup.ts
// Vitest setup — loaded before every component test file.
// Brings in jest-dom matchers (toBeInTheDocument, etc.) and runs
// an automatic DOM cleanup after each test so suites don't leak
// rendered trees into one another.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
