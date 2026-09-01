import { vi } from 'vitest';

/**
 * `next/headers`, for tests that render a server component directly.
 *
 * These screens are rendered with `renderToStaticMarkup` rather than through Next, so there is no
 * request scope and `cookies()` throws — which is what Next means by "called outside a request
 * scope". The portal reads exactly one cookie for authentication and one for tenant selection, so
 * the mock is a jar those two live in.
 *
 * **The default is signed in, deliberately.** Nearly every test here is about what a screen
 * renders, not about who may see it, and a signed-out default would make each of them assert the
 * access panel instead of the thing they were written for. The signed-out and refused paths have
 * their own tests — `shell/api-request.test.ts` and `shell/access-state.test.tsx` — where the
 * distinction is the subject rather than a precondition.
 */
const jar = new Map<string, string>([['__Host-mx_session', 'a-test-session-token']]);

vi.mock('next/headers', () => ({
  cookies: (): Promise<{ get: (name: string) => { value: string } | undefined }> =>
    Promise.resolve({
      get: (name: string) => {
        const value = jar.get(name);
        return value === undefined ? undefined : { value };
      },
    }),
}));

/** Replace the jar's contents for one test. Pass nothing to render as a signed-out reader. */
export const browserCookies = (cookies: Readonly<Record<string, string>> = {}): void => {
  jar.clear();
  for (const [name, value] of Object.entries(cookies)) jar.set(name, value);
};

/** The default: a reader holding a Platform session. */
export const signedIn = (): void => {
  browserCookies({ '__Host-mx_session': 'a-test-session-token' });
};
