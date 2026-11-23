import type { ReactNode } from 'react';

import { AccessState } from '../../../shell/access-state';
import { isLanguage, translator, type Language } from '../../../shell/locale';
import { selectedTenant } from '../../../shell/platform-session';
import { safeReturnTo } from '../../../shell/session-continuity';
import { forgetTenant, selectTenant } from '../../../shell/tenant-selection';
import { memberTenants } from '../../../shell/tenants';

/**
 * The tenant picker (MW-007): the tenants this account may act in, and which one is in use.
 *
 * Each choice is a form posted to a server action that checks it against the API's list before
 * remembering it. Tenants are shown by identifier, which is all the API lists before a tenant is
 * chosen: their names live inside each tenant, behind its row-level security.
 */
interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const TenantPage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const returnTo = safeReturnTo(single(parameters['returnTo']));
  const listed = await memberTenants();
  const current = await selectedTenant();

  if (listed.kind !== 'ok') return <AccessState state={listed.kind} language={language} />;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4 p-8" data-testid="tenant-picker">
      <h1 className="text-2xl font-semibold">{t('admin.tenant.title')}</h1>
      <p className="text-sm opacity-80">{t('admin.tenant.detail')}</p>
      {listed.value.length === 0 ? (
        <p className="text-sm">{t('admin.tenant.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {listed.value.map((tenantId) => (
            <li key={tenantId} className="flex items-center justify-between gap-4">
              <code className="text-sm">{tenantId}</code>
              {tenantId === current ? (
                <span className="text-sm font-medium">{t('admin.tenant.current')}</span>
              ) : (
                <form action={selectTenant}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className="rounded-md px-3 py-1 text-sm underline">
                    {t('admin.tenant.choose')}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {current !== undefined && (
        <form action={forgetTenant}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit" className="text-sm underline">
            {t('admin.tenant.clear')}
          </button>
        </form>
      )}
    </section>
  );
};

export default TenantPage;
