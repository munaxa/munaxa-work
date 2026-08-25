import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { payrollTranslator } from '../../../../payroll/locale';

/**
 * No payroll result with that identifier.
 *
 * Three reasons reach this page and the screen does not guess between them: nobody is authenticated,
 * the caller does not hold `payroll.read-result`, or no such result exists. Payroll separates
 * reading a run from reading what a named person was paid, so "you may not see this figure" is the
 * likeliest of the three — and none of them is worth inventing a diagnosis for.
 */
const NotFound = (): ReactNode => {
  const t = payrollTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('payroll.label.result')}</h1>
        <p className="text-sm opacity-80">{t('payroll.label.resultNotFound')}</p>
        <p className="text-sm opacity-70">{t('payroll.label.figuresWithheld')}</p>
        <a href="/payroll" className="text-sm underline underline-offset-4">
          {t('payroll.label.backToPayroll')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
