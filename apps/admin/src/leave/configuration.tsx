import type { ReactNode } from 'react';
import { Card } from '@munaxa/ui';
import type {
  EntitlementView,
  LeaveAdjustmentView,
  LeaveCalendarEntryView,
  LeavePolicyView,
  LeaveTypeView,
} from '@work/leave/contracts';

import { Empty, instant, minutes, short, type Translate } from './sections';
import { textIn, type Language } from './locale';

/**
 * The configuration half of the leave screen, the calendar, and the boundary statement.
 *
 * **The type and policy lists start empty and that is the point.** Nothing is seeded: a tenant that
 * has configured no leave types has none, and this screen says so rather than showing a set the
 * product chose for them. Codes are rendered exactly as stored, because a leave-type code and a
 * paid-treatment code are the tenant's or a country pack's and this product does not know what they
 * mean (00B).
 *
 * **The adjustments list carries its actor and its written reason.** It is the one movement in the
 * ledger that no rule produced and no request explains, which makes it the one an auditor looks at
 * first — so it is a section of its own rather than a filter on the ledger.
 */

interface SectionProps {
  readonly t: Translate;
  readonly language: Language;
}

export const TypesSection = ({
  t,
  language,
  types,
}: SectionProps & { readonly types: readonly LeaveTypeView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.types')}</h2>

    {types.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('leave.label.code')}</th>
            <th className="text-start">{t('leave.label.name')}</th>
            <th className="text-start">{t('leave.label.unit')}</th>
            <th className="text-start">{t('leave.label.status')}</th>
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type.leaveTypeId}>
              {/* A code is the tenant's, rendered as stored and never translated. */}
              <td>{type.code}</td>
              <td>{textIn(type.name, language)}</td>
              <td>{type.unit}</td>
              <td>{type.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const PoliciesSection = ({
  t,
  language,
  policies,
}: SectionProps & { readonly policies: readonly LeavePolicyView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.policies')}</h2>

    {policies.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('leave.label.name')}</th>
            <th className="text-start">{t('leave.label.status')}</th>
            <th className="text-start">{t('leave.label.durationBasis')}</th>
            <th className="text-start">{t('leave.label.accrualMethod')}</th>
            <th className="text-start">{t('leave.label.carryOverMethod')}</th>
            <th className="text-start">{t('leave.label.approvalsRequired')}</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy.leavePolicyId}>
              <td>{textIn(policy.name, language)}</td>
              <td>{policy.status}</td>
              <td>{policy.durationBasis}</td>
              <td>{policy.accrualMethod}</td>
              <td>{policy.carryOverMethod}</td>
              <td>{policy.approvalsRequired}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const EntitlementsSection = ({
  t,
  entitlements,
}: SectionProps & { readonly entitlements: readonly EntitlementView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.entitlements')}</h2>

    {entitlements.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('leave.label.employment')}</th>
            <th className="text-start">{t('leave.label.leaveYear')}</th>
            <th className="text-start">{t('leave.label.granted')}</th>
            <th className="text-start">{t('leave.label.source')}</th>
          </tr>
        </thead>
        <tbody>
          {entitlements.map((entitlement) => (
            <tr key={entitlement.entitlementId}>
              <td>{short(entitlement.employmentId)}</td>
              <td>{entitlement.leaveYearStart}</td>
              <td>{minutes(t, entitlement.grantedMinutes)}</td>
              <td>{entitlement.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

/** Who is away. A list for planning a rota, not a file on anybody: no reason text. */
export const CalendarSection = ({
  t,
  calendar,
}: SectionProps & { readonly calendar: readonly LeaveCalendarEntryView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.calendar')}</h2>

    {calendar.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('leave.label.onDate')}</th>
            <th className="text-start">{t('leave.label.employment')}</th>
            <th className="text-start">{t('leave.label.portion')}</th>
            <th className="text-start">{t('leave.label.total')}</th>
          </tr>
        </thead>
        <tbody>
          {calendar.map((entry) => (
            <tr key={`${entry.leaveRequestId}-${entry.onDate}`}>
              <td>{entry.onDate}</td>
              <td>{short(entry.employmentId)}</td>
              <td>{entry.portion}</td>
              <td>{minutes(t, entry.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

export const AdjustmentsSection = ({
  t,
  language,
  adjustments,
}: SectionProps & { readonly adjustments: readonly LeaveAdjustmentView[] }): ReactNode => (
  <Card className="flex flex-col gap-3 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.adjustments')}</h2>

    {adjustments.length === 0 ? (
      <Empty t={t} />
    ) : (
      <table className="w-full text-start text-sm">
        <thead className="opacity-70">
          <tr>
            <th className="text-start">{t('leave.label.employment')}</th>
            <th className="text-start">{t('leave.label.total')}</th>
            <th className="text-start">{t('leave.label.reason')}</th>
            <th className="text-start">{t('leave.label.adjustedBy')}</th>
            <th className="text-start">{t('leave.label.effectiveOn')}</th>
          </tr>
        </thead>
        <tbody>
          {adjustments.map((adjustment) => (
            <tr key={adjustment.adjustmentId}>
              <td>{short(adjustment.employmentId)}</td>
              <td>{minutes(t, adjustment.minutes)}</td>
              <td>{adjustment.reasonCode}</td>
              <td>{adjustment.adjustedBy}</td>
              <td>{instant(adjustment.adjustedAt, language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Card>
);

/**
 * What Leave does not hold, stated on the screen rather than only in a document.
 *
 * A boundary written down where somebody looks for a feature is a boundary that survives the
 * conversation about adding it.
 */
export const BoundariesSection = ({ t }: SectionProps): ReactNode => (
  <Card className="flex flex-col gap-2 p-6">
    <h2 className="text-lg font-medium">{t('leave.label.boundaries')}</h2>
    <ul className="flex list-disc flex-col gap-1 ps-5 text-sm opacity-80">
      <li>{t('leave.label.noMoney')}</li>
      <li>{t('leave.label.noAttendance')}</li>
      <li>{t('leave.label.noEmploymentStatus')}</li>
      <li>{t('leave.label.noStatutory')}</li>
      <li>{t('leave.label.noDocuments')}</li>
      <li>{t('leave.label.readOnly')}</li>
    </ul>
  </Card>
);
