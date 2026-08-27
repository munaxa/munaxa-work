import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';

import { assetsTranslator } from '../../../assets/locale';

/**
 * No asset with that identifier — in this tenant.
 *
 * The module answers not-found for an identifier it does not hold **and** for one belonging to
 * another tenant, deliberately, so that an identifier cannot be used to probe for existence
 * elsewhere. This page is written to be true in both cases: it says the inventory holds no such
 * asset, which is what this tenant can observe, rather than claiming the asset does not exist.
 *
 * A caller who merely lacks `assets.asset.read` receives a refusal instead and is shown a withheld
 * page by the route, never sent here.
 *
 * A `not-found.tsx` cannot read the request's search parameters, so it renders in the reference
 * language; the reader's choice is one click away in the shell.
 */
const NotFound = (): ReactNode => {
  const t = assetsTranslator('en');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <Card className="flex flex-col gap-3 p-6">
        <h1 className="text-lg font-medium">{t('assets.label.asset')}</h1>
        <p className="text-sm opacity-80">{t('assets.withheld.assetNotFound')}</p>
        <a href="/assets" className="text-sm underline underline-offset-4">
          {t('assets.label.backToAssets')}
        </a>
      </Card>
    </div>
  );
};

export default NotFound;
