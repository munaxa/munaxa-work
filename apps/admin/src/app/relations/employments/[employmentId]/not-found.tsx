import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { relationsTranslator } from '../../../../relations/locale';

/**
 * No employment with that identifier — in this tenant.
 *
 * Employment answers not-found for an identifier it does not hold and for one belonging to another
 * tenant alike, so this page states what this tenant can observe rather than claiming the
 * employment does not exist.
 *
 * A caller who merely lacks `employment.read` receives a refusal instead and is shown the
 * relations record under the identifier, never sent here — AD-007 keeps relations access
 * independent of employee access.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = relationsTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('relations.label.register')}</h1>
        <p className="text-sm opacity-80">{t('admin.record.notFound')}</p>
        <a href="/employment" className="text-sm underline underline-offset-4">
          {t('admin.record.backToDirectory')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
