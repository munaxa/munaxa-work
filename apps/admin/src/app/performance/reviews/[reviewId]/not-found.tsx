import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { performanceTranslator } from '../../../../performance/locale';

/**
 * The review route answered 404 — and that is deliberately two different things.
 *
 * `GET /performance/reviews/:reviewId` returns 404 for a review that does not exist **and** for a
 * review the caller is not entitled to. The module chose that: "confirming a review exists is the
 * disclosure, because it says somebody is being appraised". A page that said "no such review" would
 * be false half the time, and the half it was false in is the half where somebody had just learned
 * that a named colleague is under appraisal.
 *
 * So this page says exactly what is true of both cases: **no review was returned for this
 * identifier**, and it may not exist or may not be yours to read. Nothing here narrows it further,
 * because narrowing it is the disclosure.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = performanceTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('performance.label.review')}</h1>
        <p className="text-sm opacity-80">{t('performance.notice.reviewNotReturned')}</p>
        <a href="/performance" className="text-sm underline underline-offset-4">
          {t('performance.label.backToPerformance')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
