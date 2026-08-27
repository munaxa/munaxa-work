import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { attendanceTranslator } from '../../../../../attendance/locale';

/**
 * No attendance day for that employment on that date.
 *
 * `attendance.read-day` is the module's only 404-capable read, so this page is reached only on a
 * genuine absence: the route reads the status and renders a *refusal* as a withheld section on the
 * day page itself. A caller who merely lacks `attendance.read` is never told the day does not
 * exist.
 *
 * "No day was returned" rather than "this person did not attend": a day the module has not
 * calculated and a day nobody worked are different things, and this page cannot tell them apart.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = attendanceTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('attendance.label.day')}</h1>
        <p className="text-sm opacity-80">{t('attendance.label.dayNotFound')}</p>
        <a href="/attendance" className="text-sm underline underline-offset-4">
          {t('attendance.label.backToAttendance')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
