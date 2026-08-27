import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { performanceTranslator } from '../../../../performance/locale';

/**
 * No goal with that identifier.
 *
 * `performance.read-goal` returns `notFound` only for a row the module does not hold, so unlike the
 * review route this page means exactly one thing. A caller who merely lacks `performance.goal.read`
 * receives a refusal, and the route renders that as a withheld page rather than sending them here.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = performanceTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('performance.label.goal')}</h1>
        <p className="text-sm opacity-80">{t('performance.notice.goalNotFound')}</p>
        <a href="/performance" className="text-sm underline underline-offset-4">
          {t('performance.label.backToPerformance')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
