import type { ReactNode } from 'react';

import { loadRegister } from '../../people/api';
import { directionOf, isLanguage, translator, type Language } from '../../people/locale';
import { BoundariesSection, DuplicatesSection, RegisterSection } from '../../people/sections';

/**
 * The people administration screen.
 *
 * Presentation only: it consumes the module's published contracts and the API, and holds no
 * business logic of its own — no rule about who may see a date of birth, no idea what makes two
 * records a duplicate. Those live in the domain and the application service, and a screen that
 * reimplemented the redaction would be a second, weaker answer to a question the API already
 * decided.
 *
 * Three things on this page are the phase's claims made visible:
 *
 * **`?asOf=`** renders the register as at a date. A person's legal name has a history, so "who is
 * this person" is a question about a date rather than about now (ADR-0037).
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is
 * never a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **Nothing sensitive is on it.** No date of birth, no identifier — not even the masked form — and
 * no note. A register listing is a screen somebody leaves open on a shared desk. Where a field was
 * withheld, the page says so rather than rendering a blank that reads as missing data.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const PeoplePage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const asOf = single(parameters['asOf']);
  const t = translator(language);
  const register = await loadRegister(asOf);

  return (
    <main
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('people.label.register')}</h1>
        <p className="text-sm opacity-80">{t('people.hint.identityIsPermanent')}</p>
      </header>

      <RegisterSection
        t={t}
        language={language}
        people={register.people}
        unavailable={register.unavailable}
        asOf={asOf}
      />
      <DuplicatesSection t={t} duplicates={register.duplicates} />
      <BoundariesSection t={t} />
    </main>
  );
};

export default PeoplePage;
