import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { NAVIGATION } from '../shell/navigation';
import { isLanguage, translator, type Language } from '../shell/locale';
import { AccessState } from '../shell/access-state';
import { isSignedIn } from '../shell/platform-session';

/**
 * The portal's home.
 *
 * It was a card with a `Continue` button that continued to nothing — a control that did not do what
 * it appeared to do, on the first screen anybody sees. It is now what a home should be when the
 * product is a set of screens: the screens, named, in the reader's language, each one a link.
 *
 * It states nothing about the domain and fetches nothing. Every figure an HR administrator would
 * want here — joiners this month, approvals waiting, documents expiring — is a cross-module read
 * that does not exist yet, and inventing one on the home page would be the same failure as the
 * button it replaces.
 *
 * The lockup is in the sidebar now, so the heading is text again: repeating the mark beside the
 * mark is the product's name said twice.
 *
 * **A signed-out reader gets the sign-in state instead of the index.** Listing eighteen screens to
 * somebody who will be refused by every one of them is a menu of dead ends; saying that Platform
 * authenticates them, and where, is the one useful thing this page can do in that condition.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const HomePage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);

  if (!(await isSignedIn())) return <AccessState state="unauthenticated" language={language} />;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('admin.home.title')}</h1>
        <p className="text-sm opacity-80">{t('admin.home.lead')}</p>
      </header>

      {NAVIGATION.map((section) => (
        <Card key={section.key} className="flex flex-col gap-3 p-6">
          <h2 className="text-lg font-medium">{t(`admin.group.${section.key}`)}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {section.destinations.map((entry) => (
              <li key={entry.key}>
                <a
                  href={`${entry.href}?lang=${language}`}
                  className="text-sm underline underline-offset-4"
                >
                  {t(`admin.nav.${entry.key}`)}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <p className="text-xs opacity-70">{t('admin.notice.readOnly')}</p>
    </div>
  );
};

export default HomePage;
