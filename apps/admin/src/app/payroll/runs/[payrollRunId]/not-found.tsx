import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { payrollTranslator } from '../../../../payroll/locale';

/**
 * No payroll run with that identifier.
 *
 * It says the API returned nothing for this identifier rather than "not found", because in this
 * deployment the two most likely reasons are that nobody is authenticated and that the caller may
 * not hold `payroll.read` — and neither is the run being absent. Guessing which one would be
 * inventing a diagnosis the server deliberately did not give.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = payrollTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('payroll.label.run')}</h1>
        <p className="text-sm opacity-80">{t('payroll.label.runNotFound')}</p>
        <p className="text-sm opacity-70">{t('payroll.notice.unauthenticated')}</p>
        <a href="/payroll" className="text-sm underline underline-offset-4">
          {t('payroll.label.backToPayroll')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
