import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { relationsTranslator } from '../../../../relations/locale';

/**
 * No violation with that identifier — in this tenant.
 *
 * The module answers not-found for an identifier it does not hold **and** for one belonging to
 * another tenant, deliberately, so that an identifier cannot be used to probe for a disciplinary
 * record's existence elsewhere. This page is written to be true in both cases: it says this
 * organization holds no such violation, which is what this tenant can observe.
 *
 * A caller who merely lacks `relations.violation.read` receives a refusal instead and is shown a
 * withheld page by the route, never sent here.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = relationsTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('relations.label.violation')}</h1>
        <p className="text-sm opacity-80">{t('relations.withheld.caseNotFound')}</p>
        <a href="/employment" className="text-sm underline underline-offset-4">
          {t('admin.record.backToDirectory')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
