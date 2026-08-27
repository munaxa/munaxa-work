import type { ReactNode } from 'react';

import { loadLetters } from '../../letters/api';
import { directionOf, isLanguage, translator, type Language } from '../../letters/locale';
import {
  FindingsSection,
  IssuedSection,
  LetterContentSection,
  RequestsSection,
  TemplatesSection,
} from '../../letters/sections';

/**
 * The letters screen.
 *
 * Presentation only: it consumes the module's published contracts through the API and holds no
 * business logic of its own — no rule about who may approve, no variable resolved a second time, no
 * template rendered here. **It reaches no repository and no database.**
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control.
 *
 * **Nothing on this page produces a file.** An issued letter carries its content and no artefact,
 * because no renderer exists in this repository — and nothing here claims a signature, because no
 * signature provider exists either.
 */
export default async function LettersPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const parameters = (await searchParams) ?? {};
  const requested = parameters['lang'];
  const language: Language = isLanguage(typeof requested === 'string' ? requested : undefined)
    ? (requested as Language)
    : 'en';
  const t = translator(language);
  const letters = await loadLetters();
  const props = { t, language };

  return (
    <div dir={directionOf(language)} className="flex flex-col gap-6 p-8">
      <h1 className="text-2xl font-medium">{t('letters.label.letters')}</h1>

      <TemplatesSection {...props} templates={letters.templates} versions={letters.versions} />
      <RequestsSection
        {...props}
        requests={letters.requests}
        decisions={letters.decisions}
        unavailable={letters.unavailable}
      />
      <IssuedSection {...props} issued={letters.issued} />
      <LetterContentSection {...props} detail={letters.detail} withheld={letters.valuesWithheld} />
      <FindingsSection {...props} findings={letters.findings} />
    </div>
  );
}
