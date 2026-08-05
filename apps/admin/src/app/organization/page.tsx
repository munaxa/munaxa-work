import type { ReactNode } from 'react';

import { loadOrganization } from '../../organization/api';
import { directionOf, isLanguage, translator, type Language } from '../../organization/locale';
import {
  LegalEntitiesSection,
  SettingsSection,
  StructureSection,
  UnitTypesSection,
} from '../../organization/sections';

/**
 * The organization administration screen.
 *
 * Presentation only: it consumes the module's published contracts and the API, and holds no
 * business logic of its own — no rule about which level may sit under which, no idea what a
 * legal entity means. Those live in the domain, and a screen that reimplemented them would be
 * the second answer to a question the domain already owns.
 *
 * Two things on this page are the phase's claims made visible:
 *
 * **`?asOf=`** re-renders the whole chart as at a date. A query parameter rather than a hidden
 * default, because "what did this look like last March" is an ordinary question here rather than
 * a report somebody builds later.
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is
 * never a separate control — separating them is how a page ends up left-aligned in Arabic.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const OrganizationPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const asOf = single(parameters['asOf']);
  const t = translator(language);
  const organization = await loadOrganization(asOf);

  return (
    <main
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('organization.label.structure')}</h1>
        <p className="text-sm opacity-80">{t('organization.hint.unlimitedDepth')}</p>
        <p className="text-sm opacity-80">{t('organization.hint.noEmployees')}</p>
      </header>

      <StructureSection
        t={t}
        language={language}
        tree={organization.tree}
        unavailable={organization.unavailable}
        asOf={asOf}
      />
      <UnitTypesSection t={t} language={language} unitTypes={organization.unitTypes} />
      <LegalEntitiesSection t={t} language={language} legalEntities={organization.legalEntities} />
      <SettingsSection t={t} settings={organization.settings} />
    </main>
  );
};

export default OrganizationPage;
