'use client';

import { useEffect, type ReactNode } from 'react';

import { IDENTITY_REFRESH_PATH, refreshAndReturn } from './session-continuity';

export interface SessionRefreshProps {
  readonly returnTo: string;
  readonly signInUrl: string | undefined;
  readonly message: string;
}

/**
 * Renews the session from the browser, then returns to the page that was asked for.
 *
 * A client component because the refresh token is only ever sent by the browser, to Identity's
 * path-scoped endpoint on the shared origin; the portal's server never sees it. It renders a single
 * status line, holds no data and decides nothing: the outcome is `refreshAndReturn`'s.
 */
export const SessionRefresh = ({
  returnTo,
  signInUrl,
  message,
}: SessionRefreshProps): ReactNode => {
  useEffect(() => {
    void refreshAndReturn(
      { returnTo, signInUrl, refreshPath: IDENTITY_REFRESH_PATH },
      {
        fetch: (input, init) => window.fetch(input, init),
        replace: (url) => {
          window.location.replace(url);
        },
      },
    );
  }, [returnTo, signInUrl]);

  return (
    <p role="status" className="text-sm opacity-80">
      {message}
    </p>
  );
};
