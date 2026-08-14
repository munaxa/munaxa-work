import type { ReactNode } from 'react';
import type { DevelopmentPlanDetailView, MobilityRecommendationView } from '@work/career/contracts';

import { civil, count } from './exact';
import { developmentActionsFor, itemActionsFor, mobilityActionsFor } from './lifecycle';
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
 * Development: what somebody agreed to do, whether both parties acknowledged it, and how the items
 * fall across the three categories.
 *
 * **The 70-20-10 mix is counted and never validated** (D-12). The three figures below are counts of
 * items by category, and the verdict beside them is the literal `NOT VERIFIED` the API returns: no
 * balance rule was ever specified, so this product states none. A screen that showed a green tick
 * for "70-20-10 met" would be inventing the rule and the judgement in one step.
 *
 * **Acknowledgement is a recorded fact, not a signature and not an identity.** `party` says which
 * side acknowledged; this product cannot tell which employee or manager is signed in (ADR-0032), so
 * the columns show the day each acknowledgement was recorded and by whom it was *recorded*, which is
 * a different thing from who acknowledged. Joint employee/manager ownership is `NOT VERIFIED`.
 *
 * **A course item references a Learning assignment and carries no status of its own** (ADR-0073).
 * The identifier is shown; whether the course was completed is Learning's answer, asked on Learning's
 * screen, and Career would be quoting a second, staler copy if it showed one here.
 */

export const DevelopmentSection = ({
  t,
  detail,
}: SectionProps & { readonly detail: DevelopmentPlanDetailView | undefined }): ReactNode => (
  <Section t={t} title="developmentPlans" note="career.notice.detailIsFirstRow">
    {detail === undefined ? (
      <Empty t={t} />
    ) : (
      <>
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Figure t={t} label="employment" value={short(detail.plan.employmentId)} />
          <Figure
            t={t}
            label="status"
            value={<Status t={t} group="developmentPlanStatus" status={detail.plan.status} />}
          />
          <Figure t={t} label="startedOn" value={civil(detail.plan.startedOn)} />
          <Figure t={t} label="targetDate" value={civil(detail.plan.targetDate)} />
          {/* The day each acknowledgement was *recorded*. Not a signature, not an identity. */}
          <Figure
            t={t}
            label="employeeAcknowledged"
            value={civil(detail.plan.employeeAcknowledgedOn)}
          />
          <Figure
            t={t}
            label="managerAcknowledged"
            value={civil(detail.plan.managerAcknowledgedOn)}
          />
        </dl>
        <AsOf t={t} asOf={detail.asOf} />
        <Actions t={t} actions={developmentActionsFor(detail.plan, detail.items.length)} />
      </>
    )}
  </Section>
);

/**
 * The items on one development plan, and the mix they fall into.
 *
 * `overdue` is the server's answer against the day it reports, and it is not recomputed here: an
 * item is overdue relative to the day being asked about, and a browser's clock is not that day.
 */
export const ItemsSection = ({
  t,
  detail,
}: SectionProps & { readonly detail: DevelopmentPlanDetailView | undefined }): ReactNode => (
  <Section t={t} title="developmentItems">
    {detail === undefined || detail.items.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table
          t={t}
          headers={[
            'title',
            'category',
            'kind',
            'status',
            'targetDate',
            'overdue',
            'learningAssignment',
            'version',
          ]}
        >
          {detail.items.map((item) => (
            <tr key={item.developmentItemId}>
              <td>{item.title}</td>
              <td>
                <Status t={t} group="developmentCategory" status={item.category} />
              </td>
              <td>
                <Status t={t} group="developmentItemKind" status={item.kind} />
              </td>
              <td>
                <Status t={t} group="developmentItemStatus" status={item.status} />
              </td>
              <td>{civil(item.targetDate)}</td>
              {/* Derived by the server against the day it reports. */}
              <td>{yesNo(item.overdue, t)}</td>
              {/* Learning's identifier. Career stores the reference and no status of its own. */}
              <td>{short(item.learningAssignmentId)}</td>
              <td>{count(item.version)}</td>
            </tr>
          ))}
        </Table>

        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Figure t={t} label="experience" value={count(detail.mix.experience)} />
          <Figure t={t} label="exposure" value={count(detail.mix.exposure)} />
          <Figure t={t} label="education" value={count(detail.mix.education)} />
          {/* The literal the API returns. Counted, never validated — see the file note. */}
          <Figure t={t} label="developmentMix" value={detail.mix.mixVerdict} />
        </dl>
        <p className="text-xs opacity-60">{t('career.withheld.developmentMix')}</p>
        <Actions t={t} actions={itemActionsFor(detail.items[0])} />
      </>
    )}
  </Section>
);

/**
 * One recommendation's cells.
 *
 * Its own component because **the two status columns are the point of the row**: `status` is what
 * somebody decided and stored, `standing` is what the same row reads as on the day being asked
 * about. Keeping them side by side in one small component makes it hard to later "tidy up" the
 * duplication by rendering one of them twice — which would hide the fact that a `proposed`
 * recommendation can stand as `expired` without anything having run (D-13).
 */
const MobilityRow = ({
  t,
  recommendation,
}: {
  readonly t: SectionProps['t'];
  readonly recommendation: MobilityRecommendationView;
}): ReactNode => (
  <tr>
    <td>{short(recommendation.employmentId)}</td>
    <td>
      <Status t={t} group="mobilityKind" status={recommendation.kind} />
    </td>
    <td>{short(recommendation.targetPositionId)}</td>
    <td>{short(recommendation.targetUnitId)}</td>
    {/* What was decided and stored. */}
    <td>
      <Status t={t} group="mobilityStatus" status={recommendation.status} />
    </td>
    {/* What it reads as on the day asked about. Derived, never stored. */}
    <td>
      <Status t={t} group="mobilityStatus" status={recommendation.standing} />
    </td>
    <td>{civil(recommendation.recommendedOn)}</td>
    <td>{civil(recommendation.decidedOn)}</td>
  </tr>
);

/**
 * Mobility: somebody suggesting a move, and somebody agreeing or not.
 *
 * **Nothing here moves anybody** (ADR-0072). `accepted` means a human agreed with a suggestion; no
 * employment changes, no position is filled and no salary is touched, and there is no port through
 * which any of that could happen. A recommendation of kind `promotion` is a *suggestion that
 * somebody be promoted* — the promotion itself is another module's act, taken elsewhere by somebody
 * else, and Career would not know if it happened.
 *
 * **`standing` and `status` are different columns because they are different facts** (D-13). The
 * stored status is what somebody decided; the standing is what the same row reads as on the day
 * being asked about — so a `proposed` recommendation can stand as `expired` without anything having
 * run, and will read as current again if asked about an earlier day. Nothing expires it, nothing is
 * scheduled, and both columns are the server's answers.
 */
export const MobilitySection = ({
  t,
  recommendations,
  total,
  asOf,
}: SectionProps & {
  readonly recommendations: readonly MobilityRecommendationView[];
  readonly total: number;
  readonly asOf: string | undefined;
}): ReactNode => (
  <Section
    t={t}
    title="mobility"
    total={total}
    shown={recommendations.length}
    note="career.withheld.recommendationsOnly"
  >
    {recommendations.length === 0 ? (
      <Empty t={t} />
    ) : (
      <>
        <Table
          t={t}
          headers={[
            'employment',
            'kind',
            'targetPosition',
            'unit',
            'status',
            'standing',
            'recommendedOn',
            'decidedOn',
          ]}
        >
          {recommendations.map((recommendation) => (
            <MobilityRow
              key={recommendation.mobilityRecommendationId}
              t={t}
              recommendation={recommendation}
            />
          ))}
        </Table>
        <AsOf t={t} asOf={asOf} />
        <p className="text-xs opacity-60">{t('career.withheld.mobilityExpiry')}</p>
        <Actions t={t} actions={mobilityActionsFor(recommendations[0])} />
      </>
    )}
  </Section>
);
