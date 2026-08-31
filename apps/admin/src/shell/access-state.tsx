import type { ReactNode } from 'react';
import { loadPortalProcessEnvironment } from '@work/config';

import type { ApiState } from './api-request.js';
import { translator, type Language } from './locale.js';

/**
 * What a screen says when it has no data, and why.
 *
 * Every one of these was `undefined` before, and every one of them rendered the same empty state.
 * A person who was never signed in, a person whose token expired, a person who belongs to no
 * tenant, a person without a permission and a person looking at a genuinely empty list were all
 * told the same thing — which is the difference between "sign in" and "this product is broken".
 *
 * The states are the API's own distinctions, not a richer vocabulary invented here: the guard
 * separates "not authenticated" from "no tenant resolved", the pipeline separates a refusal from
 * a not-found, and this renders that separation rather than inventing one.
 *
 * **This decides nothing.** A hidden control is not authorization and an unhidden one is not a
 * grant: every state here is a report of what the server already answered. Nothing is asked of the
 * browser, and no screen consults a permission to decide what the server will allow.
 */

/** The sign-in destination, or nothing when no Platform service is configured. */
const signInUrl = (): string | undefined => loadPortalProcessEnvironment().PLATFORM_SIGN_IN_URL;

const KEYS: Record<ApiState, { readonly title: string; readonly detail: string }> = {
  ok: { title: 'admin.access.ok.title', detail: 'admin.access.ok.detail' },
  unauthenticated: {
    title: 'admin.access.signedOut.title',
    detail: 'admin.access.signedOut.detail',
  },
  'no-membership': {
    title: 'admin.access.noMembership.title',
    detail: 'admin.access.noMembership.detail',
  },
  forbidden: { title: 'admin.access.withheld.title', detail: 'admin.access.withheld.detail' },
  missing: { title: 'admin.access.notFound.title', detail: 'admin.access.notFound.detail' },
  unavailable: {
    title: 'admin.access.unavailable.title',
    detail: 'admin.access.unavailable.detail',
  },
};

export interface AccessStateProps {
  readonly state: ApiState;
  readonly language: Language;
}

/**
 * The panel a screen renders instead of data.
 *
 * Server-rendered like everything else in this portal, so the sign-in destination is read from the
 * server's configuration and never shipped to the browser as a variable somebody could rewrite.
 */
export const AccessState = ({ state, language }: AccessStateProps): ReactNode => {
  const t = translator(language);
  const keys = KEYS[state];
  const destination = signInUrl();

  return (
    <section
      // `role="status"` rather than `alert`: this is the page's content, not an interruption, and
      // a screen reader should reach it in reading order like any other section.
      role="status"
      className="mx-auto flex max-w-2xl flex-col gap-2 p-8"
    >
      <h2 className="text-lg font-medium">{t(keys.title)}</h2>
      <p className="text-sm leading-relaxed opacity-80">{t(keys.detail)}</p>

      {state === 'unauthenticated' &&
        (destination === undefined ? (
          // No Platform sign-in service is configured, so there is nowhere honest to send anybody.
          // Saying that beats a button that fails, and it is the true state of this deployment.
          <p className="text-sm leading-relaxed opacity-70">
            {t('admin.access.signInUnconfigured')}
          </p>
        ) : (
          <p className="text-sm">
            <a className="underline underline-offset-4" href={destination} rel="noreferrer">
              {t('admin.access.signIn')}
            </a>
          </p>
        ))}
    </section>
  );
};
