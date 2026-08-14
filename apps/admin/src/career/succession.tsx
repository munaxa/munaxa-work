import type { ReactNode } from 'react';
import type {
  BenchStrengthView,
  SuccessionPlanDetailView,
  SuccessionPlanView,
} from '@work/career/contracts';

import { civil, count } from './exact';
import { successionActionsFor, successorActionsFor } from './lifecycle';
import {
  Actions,
  AsOf,
  Empty,
  Figure,
  Section,
  Status,
  Table,
  short,
  yesNo,
  type SectionProps,
} from './sections';

/**
 * Succession: the benches a tenant keeps, the people on one of them, and how strong it is.
 *
 * **A position here is a reference the tenant wrote down, and nothing more.** Career stores a
 * `position_id` and no property of it — no title, no grade, and above all no criticality (AD-004,
 * D-4). This screen therefore shows the identifier and captions it as a reference: *listing an
 * organization's critical positions is a capability Career does not have*, there is no filter to ask
 * with, and a heading that read "critical roles" would be a claim with nothing behind it.
 *
 * **No nine-box band, no potential rating and no high-potential flag appears against a nomination**
 * (D-5). Those are Performance's observations of one cycle, this screen consumes no Performance
 * contract, and nothing here infers one from readiness, from pool membership or from a nomination's
 * existence. Where such a band would conventionally sit, the status section says why it is absent
 * rather than leaving a blank that reads as missing data.
 *
 * **`reviewDue` is the server's answer to a question somebody asked** (D-16). Nothing fired, nothing
 * is queued and nobody was notified — a bench comes due because a query was run against a day, and
 * that day is printed beside the answer.
 */

export const SuccessionSection = ({
  t,
  plans,
  total,
  withheld,
}: SectionProps & {
  readonly plans: readonly SuccessionPlanView[];
  readonly total: number;
  readonly withheld: boolean;
}): ReactNode => (
  <Section
    t={t}
    title="succession"
    total={total}
    shown={plans.length}
    note="career.notice.positionsAreReferences"
  >
    {withheld ? (
      // A permission boundary is not an empty tenant, and the two must not read the same.
      <p className="text-sm opacity-70">{t('career.notice.withheld')}</p>
    ) : plans.length === 0 ? (
      <Empty t={t} />
    ) : (
      <Table t={t} headers={['position', 'status', 'reviewOn', 'reviewDue', 'version']}>
        {plans.map((plan) => (
          <tr key={plan.successionPlanId}>
            {/* An identifier the tenant named. Never captioned as a critical position. */}
            <td>{short(plan.positionId)}</td>
            <td>
              <Status t={t} group="successionPlanStatus" status={plan.status} />
            </td>
            <td>{civil(plan.reviewOn)}</td>
            {/* Derived by the server against the day it reports. Nothing fired to produce it. */}
            <td>{yesNo(plan.reviewDue, t)}</td>
            <td>{count(plan.version)}</td>
          </tr>
        ))}
      </Table>
    )}
  </Section>
);

/**
 * The people on one bench, and what has happened to each nomination.
 *
 * One bench, for the first row of the listing above — never one request per plan, and never one per
 * successor.
 *
 * **Nominating and confirming are different acts on different permissions**, and the status column
 * is where the difference is visible: `nominated` is a suggestion, `confirmed` is an organization
 * committing to a name, and `withdrawn` is the record of having taken somebody off the list. None of
 * the three is a deletion.
 *
 * **The readiness level is shown as the identifier it is.** It is the level an assessor cited, and
 * the levels table on this page is where identifiers become rungs. It is not a score: nothing in
 * this product computes readiness (ADR-0074).
 */
export const SuccessorsSection = ({
  t,
  detail,
}: SectionProps & { readonly detail: SuccessionPlanDetailView | undefined }): ReactNode => (
  <Section t={t} title="successors" note="career.notice.detailIsFirstRow">
    {detail === undefined || detail.successors.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table t={t} headers={['employment', 'level', 'rank', 'status', 'nominatedOn', 'version']}>
          {detail.successors.map((successor) => (
            <tr key={successor.successorId}>
              <td>{short(successor.employmentId)}</td>
              {/* An identifier, never a band and never a score. */}
              <td>{short(successor.readinessLevelId)}</td>
              {/* An ordinal a human chose, bounded by the domain at fifty. */}
              <td>{count(successor.rank)}</td>
              <td>
                <Status t={t} group="successorStatus" status={successor.status} />
              </td>
              <td>{civil(successor.nominatedOn)}</td>
              <td>{count(successor.version)}</td>
            </tr>
          ))}
        </Table>
        <AsOf t={t} asOf={detail.asOf} />
        <p className="text-xs opacity-60">{t('career.notice.noNineBoxHere')}</p>
        <Actions t={t} actions={successionActionsFor(detail.plan, detail.successors.length)} />
        <Actions t={t} actions={successorActionsFor(detail.successors[0])} />
      </>
    )}
  </Section>
);

/**
 * How strong one bench is, as the module's own bounded query answered it.
 *
 * **These counts are the API's, not this screen's.** `read-bench-strength` counts nominated and
 * confirmed successors in the database; a screen that counted the rows it happened to fetch would
 * report the size of a page as the strength of a bench, and would be wrong by exactly the amount
 * that matters on a large one.
 *
 * Two numbers and a day. There is no coverage ratio, no "bench depth score" and no traffic light:
 * each of those would be a derived judgement about whether an organization is covered, and no rule
 * in this product produces one.
 */
export const BenchSection = ({
  t,
  bench,
}: SectionProps & { readonly bench: BenchStrengthView | undefined }): ReactNode => (
  <Section t={t} title="bench" note="career.notice.positionsAreReferences">
    {bench === undefined ? (
      <Empty t={t} />
    ) : (
      <>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Figure t={t} label="position" value={short(bench.positionId)} />
          <Figure t={t} label="nominated" value={count(bench.nominated)} />
          <Figure t={t} label="confirmed" value={count(bench.confirmed)} />
          <Figure t={t} label="asOf" value={civil(bench.asOf)} />
        </dl>
        <AsOf t={t} asOf={bench.asOf} />
      </>
    )}
  </Section>
);
