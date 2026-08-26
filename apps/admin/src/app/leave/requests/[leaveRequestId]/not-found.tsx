import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { leaveTranslator } from '../../../../leave/locale';

/**
 * No leave request with that identifier, and here that is what it means.
 *
 * Every route before this one had to hedge: a loader that collapsed 404 and 403 into one absent
 * value could not tell "no such record" from "you may not read requests", so its not-found page had
 * to say the API returned nothing and leave the reason open. This route reads the status, renders a
 * refusal as a withheld section on the request page itself, and reaches this page only on a genuine
 * 404 — which for Leave means no such request **in this tenant**, because the module answers 404
 * rather than 403 for a request belonging to another one.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = leaveTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('leave.label.request')}</h1>
        <p className="text-sm opacity-80">{t('leave.label.requestNotFound')}</p>
        <a href="/leave" className="text-sm underline underline-offset-4">
          {t('leave.label.backToLeave')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
