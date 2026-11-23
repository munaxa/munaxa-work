import type { ReactNode } from 'react';
import { loadPortalProcessEnvironment } from '@work/config';

import { isLanguage, translator, type Language } from '../../../shell/locale';
import { safeReturnTo } from '../../../shell/session-continuity';
import { SessionRefresh } from '../../../shell/session-refresh';

/**
 * Where the middleware sends a browser whose access cookie has lapsed (MW-007).
 *
 * The page renews the session at Identity and returns to `returnTo`, which is checked to be a path
 * on this origin before anything uses it. Without JavaScript it offers sign-in instead, which is
 * where a lapsed session ends up anyway.
 */
interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const SessionRefreshPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const returnTo = safeReturnTo(single(parameters['returnTo']));
  const signInUrl = loadPortalProcessEnvironment().PLATFORM_SIGN_IN_URL;
  const fallback =
    signInUrl === undefined ? returnTo : `${signInUrl}?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-2 p-8">
      <SessionRefresh
        returnTo={returnTo}
        signInUrl={signInUrl}
        message={t('admin.session.refreshing')}
      />
      <noscript>
        <p className="text-sm">
          {t('admin.session.noScript')}{' '}
          <a className="underline underline-offset-4" href={fallback}>
            {t('admin.session.continue')}
          </a>
        </p>
      </noscript>
    </section>
  );
};

export default SessionRefreshPage;
