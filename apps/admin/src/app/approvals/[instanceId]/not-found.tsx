import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { translator } from '../../../shell/locale';

/**
 * No approval with that identifier.
 *
 * It says the API returned nothing for this identifier rather than "not found", because in this
 * deployment the two most likely reasons are that nobody is authenticated and that the caller may
 * not read instances — and neither is the approval being absent. Guessing which one would be
 * inventing a diagnosis the server deliberately did not give.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = translator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('admin.approvals.approval')}</h1>
        <p className="text-sm opacity-80">{t('admin.approvals.notFound')}</p>
        <p className="text-sm opacity-70">{t('admin.notice.notSignedIn')}</p>
        <a href="/approvals" className="text-sm underline underline-offset-4">
          {t('admin.approvals.backToQueue')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
