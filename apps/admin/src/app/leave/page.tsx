import type { ReactNode } from 'react';

import { loadLeave } from '../../leave/api';
import { directionOf, isLanguage, translator, type Language } from '../../leave/locale';
import {
  BalancesSection,
  DashboardSection,
  LedgerSection,
  RequestsSection,
} from '../../leave/sections';
import {
  AdjustmentsSection,
  BoundariesSection,
  CalendarSection,
  EntitlementsSection,
  PoliciesSection,
  TypesSection,
} from '../../leave/configuration';

/**
 * The leave administration screen.
 *
 * Presentation only: it consumes the module's published contracts and the API, and holds no business
 * logic of its own — no rule about who may approve, no arithmetic on a balance, no idea which dates
 * a request covers. Those live in the domain and the application service, and a screen that
 * reimplemented them would be a second, weaker answer to a question the API already decided.
 *
 * **`?lang=ar`** switches language *and* direction together. Direction follows language and is never
 * a separate control — separating them is how a page ends up left-aligned in Arabic.
 *
 * **It is read-only**, consistent with every module screen before it. Every mutation goes through
 * the API; the write screens are Phase 18/19's, and building them only here would make Leave the one
 * module with them. That includes recalculation: the awaiting count is shown, and the `POST` that
 * acts on it is an operator's.
 *
 * **There is no employee self-service and no manager self-service here**, and no "request leave"
 * button. Those are Phase 18's, and a request form on an administrator's screen would be the
 * beginning of one built in the wrong place.
 */

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const LeavePage = async ({ searchParams }: PageProps): Promise<ReactNode> => {
  const parameters = await searchParams;
  const requested = single(parameters['lang']);
  const language: Language = isLanguage(requested) ? requested : 'en';
  const t = translator(language);
  const leave = await loadLeave();

  return (
    <div
      dir={directionOf(language)}
      lang={language}
      className="mx-auto flex max-w-4xl flex-col gap-6 p-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t('leave.label.leave')}</h1>
      </header>

      <DashboardSection
        t={t}
        language={language}
        dashboard={leave.dashboard}
        unavailable={leave.unavailable}
      />
      <RequestsSection t={t} language={language} requests={leave.approvals} heading="approvals" />
      <BalancesSection t={t} language={language} balances={leave.balances} />
      <LedgerSection t={t} language={language} ledger={leave.ledger} />
      <RequestsSection t={t} language={language} requests={leave.requests} heading="requests" />
      <CalendarSection t={t} language={language} calendar={leave.calendar} />
      <EntitlementsSection t={t} language={language} entitlements={leave.entitlements} />
      <AdjustmentsSection t={t} language={language} adjustments={leave.adjustments} />
      <TypesSection t={t} language={language} types={leave.types} />
      <PoliciesSection t={t} language={language} policies={leave.policies} />
      <BoundariesSection t={t} language={language} />
    </div>
  );
};

export default LeavePage;
