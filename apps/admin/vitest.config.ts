import { defineConfig } from 'vitest/config';

/**
 * The Admin portal's test configuration, which exists for exactly one reason.
 *
 * Next compiles this app with `jsx: "preserve"` and applies the automatic runtime itself. Vitest
 * transforms with esbuild, which defaults to the *classic* runtime and emits `React.createElement`
 * — so a `.tsx` test fails with `ReferenceError: React is not defined` rather than with anything
 * that hints at a JSX setting. Naming the automatic runtime here makes the tests compile the way
 * the application does.
 *
 * `setupFiles` supplies `next/headers`, which these screens now read a session cookie from and
 * which throws outside a request scope. See `src/test/setup.ts` for why the default is signed in.
 *
 * **No DOM environment, deliberately.** These screens are server components with no state, no
 * handler and no effect: `renderToStaticMarkup` produces the same HTML a browser receives, and
 * asserting against it needs neither jsdom nor a testing library. Adding either would be test
 * infrastructure for interactivity this portal does not have.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { setupFiles: ['./src/test/setup.ts'] },
});
